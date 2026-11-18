package relay

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"sync-server/internal/auth"
	"sync-server/internal/config"
)

var (
	// ErrTaskNotFound 任务未找到或已被清理
	ErrTaskNotFound = errors.New("任务不存在或已过期销毁")
	// ErrRelayDisabled 服务端未开启 AI 接口中转功能
	ErrRelayDisabled = errors.New("AI 接口中转功能未在服务端开启 (config.json aiRelay.enabled=false)")
	// ErrInvalidRequest 请求体非法或缺少核心字段
	ErrInvalidRequest = errors.New("请求体格式错误，必须为合法 JSON 且包含 model 与 messages 字段")
	// ErrUpstreamNotConfigured 未配置上游模型地址
	ErrUpstreamNotConfigured = errors.New("未配置上游 AI 服务地址 (请在 config.json 的 aiRelay.defaultUpstream 中配置或通过 X-Target-Url 请求头传入)")
	// ErrUnauthorizedKey 未携带 API Key 且未验证云账号身份，禁止蹭刷服务端托管 Key
	ErrUnauthorizedKey = errors.New("未提供自身 API Key 且未验证云账号身份，禁止使用服务端托管 Key (请传入 Authorization 或 X-Sync-Token)")
)

// Manager 管理 AI 后台任务生命周期、并发执行、自动清理与配额裁剪
type Manager struct {
	db          *sql.DB
	cfgMu       sync.RWMutex
	baseCfg     *config.Config
	customCfg   *config.AIRelayConfig
	activeMu    sync.RWMutex
	activeTasks map[string]context.CancelFunc // taskId -> cancelFunc
	httpClient  *http.Client
	stopCh      chan struct{}
}

// NewManager 构建 AI 中转任务管理器
func NewManager(db *sql.DB, initialCfg *config.Config) *Manager {
	return &Manager{
		db:          db,
		baseCfg:     initialCfg,
		activeTasks: make(map[string]context.CancelFunc),
		httpClient: &http.Client{
			// — 为什么这么写 —
			// 全局 client 不设固定 Timeout，由每个任务专属的 context.WithTimeout 精确控制超时，
			// 避免长思考大模型 (如 o1/o3/DeepSeek R1) 在耗时几分钟时被全局 http.Client 暴力切断。
			Timeout: 0,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		stopCh: make(chan struct{}),
	}
}

// UpdateConfig 动态更新配置（支持配置文件热重载）
func (m *Manager) UpdateConfig(newCfg config.AIRelayConfig) {
	m.cfgMu.Lock()
	defer m.cfgMu.Unlock()

	if newCfg.MaxTasks <= 0 {
		newCfg.MaxTasks = 500
	}
	if newCfg.TTLHours <= 0 {
		newCfg.TTLHours = 24
	}
	if newCfg.TimeoutMinutes <= 0 {
		newCfg.TimeoutMinutes = 30
	}
	if newCfg.DefaultUpstream == "" {
		newCfg.DefaultUpstream = "https://api.openai.com/v1"
	}
	m.customCfg = &newCfg
}

// getConfig 线程安全读取当前配置
func (m *Manager) getConfig() config.AIRelayConfig {
	m.cfgMu.RLock()
	defer m.cfgMu.RUnlock()

	if m.customCfg != nil {
		return *m.customCfg
	}
	if m.baseCfg != nil {
		c := m.baseCfg.AIRelay
		if c.MaxTasks <= 0 {
			c.MaxTasks = 500
		}
		if c.TTLHours <= 0 {
			c.TTLHours = 24
		}
		if c.TimeoutMinutes <= 0 {
			c.TimeoutMinutes = 30
		}
		if c.DefaultUpstream == "" {
			c.DefaultUpstream = "https://api.openai.com/v1"
		}
		return c
	}
	return config.AIRelayConfig{
		Enabled:         false,
		DefaultUpstream: "https://api.openai.com/v1",
		MaxTasks:        500,
		TTLHours:        24,
		ForceNonStream:  true,
		TimeoutMinutes:  30,
	}
}

// SubmitTask 提交后台异步任务，入库后立即返回 task_id
// — 为什么这么写 —
// 1. 严格检查 model 与 messages 字段合法性；
// 2. 根据 ForceNonStream 配置强制重写 stream 字段为 false，大幅简化存储与上游网络复杂度；
// 3. 毫秒级入库后异步派发 goroutine，秒回 task_id，客户端永不断流。
func (m *Manager) SubmitTask(ctx context.Context, userID, targetUpstream, authHeader string, bodyBytes []byte) (*SubmitTaskResponse, error) {
	currentCfg := m.getConfig()
	if !currentCfg.Enabled {
		return nil, ErrRelayDisabled
	}

	// 1. 解析请求体验证基础结构
	var rawBody map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &rawBody); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
	}

	modelVal, _ := rawBody["model"].(string)
	if strings.TrimSpace(modelVal) == "" {
		return nil, fmt.Errorf("%w: 缺少 model 字段", ErrInvalidRequest)
	}

	messagesVal, hasMessages := rawBody["messages"]
	if !hasMessages {
		return nil, fmt.Errorf("%w: 缺少 messages 字段", ErrInvalidRequest)
	}
	if _, ok := messagesVal.([]interface{}); !ok {
		return nil, fmt.Errorf("%w: messages 必须为数组", ErrInvalidRequest)
	}

	// 2. 流式与非流式处理
	// 用户明确要求："如果开启的话 开启都默认非流式输出就行"
	// — 为什么这么写 —
	// DeepSeek / SiliconFlow / OpenAI 等标准上游有严格校验：
	// 若 stream = false，请求体中绝对不能出现 stream_options（否则直接报 400 "stream_options should be set along with stream = true"）。
	// 因此当强制非流式转向上游时，必须同步剔除 stream_options！
	clientRequestedStream := false
	if s, ok := rawBody["stream"].(bool); ok && s {
		clientRequestedStream = true
	}

	upstreamIsStream := false
	if currentCfg.ForceNonStream {
		rawBody["stream"] = false
		delete(rawBody, "stream_options")
		upstreamIsStream = false
	} else {
		upstreamIsStream = clientRequestedStream
		if !upstreamIsStream {
			delete(rawBody, "stream_options")
		}
	}

	modifiedBodyBytes, err := json.Marshal(rawBody)
	if err != nil {
		return nil, fmt.Errorf("序列化处理后请求体失败: %w", err)
	}

	// 3. 确定并规范化上游目标地址
	finalUpstream := strings.TrimSpace(targetUpstream)
	if finalUpstream == "" {
		finalUpstream = strings.TrimSpace(currentCfg.DefaultUpstream)
	}
	if finalUpstream == "" {
		return nil, ErrUpstreamNotConfigured
	}
	finalUpstream = normalizeUpstreamURL(finalUpstream)

	// 3.5 确定上游鉴权密钥 (优先请求头，支持配置文件 defaultApiKey 兜底)
	finalAuth := strings.TrimSpace(authHeader)
	if finalAuth == "" && strings.TrimSpace(currentCfg.DefaultApiKey) != "" {
		// 防蹭刷校验：使用服务端托管 Key 时必须为已认证的合法云账号 (userID != "")
		if strings.TrimSpace(userID) == "" {
			return nil, ErrUnauthorizedKey
		}
		key := strings.TrimSpace(currentCfg.DefaultApiKey)
		if strings.HasPrefix(key, "Bearer ") {
			finalAuth = key
		} else {
			finalAuth = "Bearer " + key
		}
	}

	// 4. 生成唯一任务 ID 与过期时间 (默认 24 小时)
	now := time.Now().Unix()
	taskID := fmt.Sprintf("task_%d_%s", now, uuid.NewString()[:8])
	expiresAt := now + int64(currentCfg.TTLHours*3600)

	// 5. 存储配额裁剪：若已达到 maxTasks 上限，先淘汰最老已完成/终态任务
	if err := m.pruneExcessTasks(currentCfg.MaxTasks - 1); err != nil {
		log.Printf("[AIRelay] 裁剪超出上限任务警告: %v", err)
	}

	// 6. 入库登记任务 (初始状态 pending)
	query := `
		INSERT INTO ai_tasks (
			id, user_id, status, model, upstream_url, status_code,
			request_body, response_body, error_msg, chunks_json,
			created_at, updated_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '[]', ?, ?, ?)
	`
	_, err = m.db.Exec(
		query,
		taskID, userID, StatusPending, modelVal, finalUpstream, 200,
		string(modifiedBodyBytes), now, now, expiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("登记后台任务入库失败: %w", err)
	}

	// 7. 派发异步后台执行 goroutine
	timeoutDuration := time.Duration(currentCfg.TimeoutMinutes) * time.Minute
	taskCtx, cancel := context.WithTimeout(context.Background(), timeoutDuration)

	m.activeMu.Lock()
	m.activeTasks[taskID] = cancel
	m.activeMu.Unlock()

	go m.executeTask(taskCtx, taskID, finalUpstream, finalAuth, modifiedBodyBytes, clientRequestedStream, upstreamIsStream)

	return &SubmitTaskResponse{
		ID:        taskID,
		TaskID:    taskID,
		Status:    string(StatusPending),
		CreatedAt: now,
	}, nil
}

// executeTask 在后台 goroutine 中真正调用上游 AI 接口
func (m *Manager) executeTask(ctx context.Context, taskID, upstreamURL, authHeader string, bodyBytes []byte, clientRequestedStream, upstreamIsStream bool) {
	defer func() {
		m.activeMu.Lock()
		delete(m.activeTasks, taskID)
		m.activeMu.Unlock()
	}()

	now := time.Now().Unix()
	_, _ = m.db.Exec(`UPDATE ai_tasks SET status = ?, updated_at = ? WHERE id = ?`, StatusProcessing, now, taskID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstreamURL, bytes.NewReader(bodyBytes))
	if err != nil {
		m.markTaskFailed(taskID, 500, fmt.Sprintf("构造上游请求失败: %v", err), nil)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "RuthlessAI-Assistant-Relay/1.0")
	if strings.TrimSpace(authHeader) != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			m.markTaskCancelled(taskID)
			return
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			m.markTaskFailed(taskID, 504, "请求上游超时 (已达最大等待时限)", nil)
			return
		}
		m.markTaskFailed(taskID, 502, fmt.Sprintf("连接上游服务失败: %v", err), nil)
		return
	}
	defer resp.Body.Close()

	// 无论流式还是非流式，若上游返回非 2xx HTTP 状态码，均统一读取错误体并标记失败！
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		errMsg := extractErrorMessage(errBody, resp.StatusCode)
		m.markTaskFailed(taskID, resp.StatusCode, errMsg, errBody)
		return
	}

	// 1. 非流式读取完整响应并存储
	if !upstreamIsStream {
		respBody, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				m.markTaskCancelled(taskID)
				return
			}
			m.markTaskFailed(taskID, 502, fmt.Sprintf("读取上游响应失败: %v", readErr), nil)
			return
		}

		// 核心优化：自动从非流式响应体中合成标准 SSE chunks
		// 这样即使 forceNonStream 开启，流式客户端 (如 SillyTavern + st-catiecli-tasks) 轮询时依然能收到完整的打字机分片与 [DONE]，
		// 彻底根除原版流式客户端因收到空 chunks 导致界面内容瞬间蒸发的严重缺陷！
		chunks := synthesizeSSEChunks(taskID, respBody)
		m.markTaskCompleted(taskID, resp.StatusCode, respBody, chunks)
		return
	}

	// 2. 流式响应分片暂存 (当未强制非流式且客户端传 stream: true 时)
	scanner := bufio.NewScanner(resp.Body)
	// 增大缓冲区至 10MB，防止超长思考块或大图片导致 bufio 抛 ErrTooLong
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	var chunks []string
	var lastSaveTime time.Time = time.Now()

	for scanner.Scan() {
		line := scanner.Text()
		chunk := line + "\n"
		chunks = append(chunks, chunk)

		// 增量暂存：每隔 1 秒或积攒 10 片更新一次数据库，兼顾高频并发与断点进度
		if time.Since(lastSaveTime) > time.Second || len(chunks)%10 == 0 {
			m.updateTaskChunks(taskID, chunks)
			lastSaveTime = time.Now()
		}
	}

	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		if errors.Is(ctx.Err(), context.Canceled) {
			m.markTaskCancelled(taskID)
			return
		}
		m.markTaskFailed(taskID, 502, fmt.Sprintf("流式读取异常中断: %v", err), nil)
		return
	}

	// 从流式 chunks 中组装完整 JSON 响应体，供非流式查询透传
	assembledRespBody := assembleCompletionFromSSEChunks(taskID, chunks)
	m.markTaskCompleted(taskID, resp.StatusCode, assembledRespBody, chunks)
}

// markTaskCompleted 标记任务已完成
func (m *Manager) markTaskCompleted(taskID string, statusCode int, responseBody []byte, chunks []string) {
	now := time.Now().Unix()
	chunksJSON := "[]"
	if len(chunks) > 0 {
		if b, err := json.Marshal(chunks); err == nil {
			chunksJSON = string(b)
		}
	}

	respStr := string(responseBody)
	if respStr == "" && len(chunks) > 0 {
		respStr = string(assembleCompletionFromSSEChunks(taskID, chunks))
	}

	_, _ = m.db.Exec(
		`UPDATE ai_tasks SET status = ?, status_code = ?, response_body = ?, chunks_json = ?, updated_at = ? WHERE id = ?`,
		StatusCompleted, statusCode, respStr, chunksJSON, now, taskID,
	)
}

// markTaskFailed 标记任务失败并记录详细报错，同时为流式客户端合成错误 SSE 分片
func (m *Manager) markTaskFailed(taskID string, statusCode int, errMsg string, rawBody []byte) {
	now := time.Now().Unix()
	respStr := string(rawBody)
	if respStr == "" {
		respStr = fmt.Sprintf(`{"error":{"message":%q,"code":%d}}`, errMsg, statusCode)
	}

	// 为流式客户端合成一个携带错误信息的 SSE chunk，确保前端弹窗与 toast 能解析出具体原因
	errChunk := fmt.Sprintf("data: %s\n\n", respStr)
	chunksJSON, _ := json.Marshal([]string{errChunk, "data: [DONE]\n\n"})

	_, _ = m.db.Exec(
		`UPDATE ai_tasks SET status = ?, status_code = ?, error_msg = ?, response_body = ?, chunks_json = ?, updated_at = ? WHERE id = ?`,
		StatusFailed, statusCode, errMsg, respStr, string(chunksJSON), now, taskID,
	)
}

// markTaskCancelled 标记任务已被取消
func (m *Manager) markTaskCancelled(taskID string) {
	now := time.Now().Unix()
	cancelJSON, _ := json.Marshal([]string{"data: [DONE]\n\n"})
	_, _ = m.db.Exec(
		`UPDATE ai_tasks SET status = ?, status_code = 499, error_msg = '任务已主动取消', chunks_json = ?, updated_at = ? WHERE id = ?`,
		StatusCancelled, string(cancelJSON), now, taskID,
	)
}

// updateTaskChunks 异步暂存流式分片
func (m *Manager) updateTaskChunks(taskID string, chunks []string) {
	if b, err := json.Marshal(chunks); err == nil {
		_, _ = m.db.Exec(`UPDATE ai_tasks SET chunks_json = ?, updated_at = ? WHERE id = ?`, string(b), time.Now().Unix(), taskID)
	}
}

// GetTask 轮询获取任务状态及结果，支持 ?after=N 增量分片获取
func (m *Manager) GetTask(taskID string, after int) (*TaskStatusResponse, error) {
	query := `
		SELECT id, status, status_code, response_body, error_msg, chunks_json, created_at, updated_at
		FROM ai_tasks
		WHERE id = ?
	`
	var t Task
	var responseBody, errorMsg, chunksJSON string
	err := m.db.QueryRow(query, taskID).Scan(
		&t.ID, &t.Status, &t.StatusCode, &responseBody, &errorMsg, &chunksJSON, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("查询任务失败: %w", err)
	}

	done := (t.Status == StatusCompleted || t.Status == StatusFailed || t.Status == StatusCancelled)
	resp := &TaskStatusResponse{
		ID:         t.ID,
		TaskID:     t.ID,
		Status:     t.Status,
		StatusCode: t.StatusCode,
		Done:       done,
		Chunks:     []string{}, // 默认空切片而非 nil，确保序列化为明确的 "chunks": []
		CreatedAt:  t.CreatedAt,
		UpdatedAt:  t.UpdatedAt,
	}

	if t.Status == StatusFailed {
		resp.Error = &errorMsg
		if strings.TrimSpace(responseBody) != "" {
			resp.Result = json.RawMessage(responseBody)
		}
	} else if t.Status == StatusCancelled {
		cancelledMsg := "任务已取消"
		resp.Error = &cancelledMsg
		if strings.TrimSpace(responseBody) != "" {
			resp.Result = json.RawMessage(responseBody)
		}
	} else if t.Status == StatusCompleted {
		if strings.TrimSpace(responseBody) != "" {
			resp.Result = json.RawMessage(responseBody)
		}
	}

	// 处理流式分片切片增量
	if chunksJSON != "" && chunksJSON != "[]" {
		var allChunks []string
		if err := json.Unmarshal([]byte(chunksJSON), &allChunks); err == nil {
			total := len(allChunks)
			if after < 0 {
				after = 0
			}
			if after < total {
				resp.Chunks = allChunks[after:]
			} else {
				resp.Chunks = []string{}
			}
			resp.NextAfter = total
		}
	}

	return resp, nil
}

// CancelTask 取消指定任务
func (m *Manager) CancelTask(taskID string) (*CancelTaskResponse, error) {
	m.activeMu.Lock()
	cancel, found := m.activeTasks[taskID]
	if found {
		cancel()
		delete(m.activeTasks, taskID)
	}
	m.activeMu.Unlock()

	now := time.Now().Unix()
	res, err := m.db.Exec(
		`UPDATE ai_tasks SET status = ?, status_code = 499, error_msg = '任务已主动取消', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
		StatusCancelled, now, taskID, StatusPending, StatusProcessing,
	)
	if err != nil {
		return nil, fmt.Errorf("更新任务取消状态失败: %w", err)
	}

	affected, _ := res.RowsAffected()
	if !found && affected == 0 {
		// 检查任务是否已存在但处于终态
		var status string
		err := m.db.QueryRow(`SELECT status FROM ai_tasks WHERE id = ?`, taskID).Scan(&status)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrTaskNotFound
			}
			return nil, err
		}
		return &CancelTaskResponse{ID: taskID, TaskID: taskID, Status: status}, nil
	}

	return &CancelTaskResponse{ID: taskID, TaskID: taskID, Status: string(StatusCancelled)}, nil
}

// ListTasks 查看近期任务列表 (支持状态过滤与指定用户隔离)
func (m *Manager) ListTasks(limit int, statusFilter, userIDFilter string) (*TaskListResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT id, status, status_code, response_body, error_msg, created_at, updated_at
		FROM ai_tasks
	`
	var whereClauses []string
	var args []interface{}

	if strings.TrimSpace(statusFilter) != "" {
		whereClauses = append(whereClauses, "status = ?")
		args = append(args, strings.TrimSpace(statusFilter))
	}
	if strings.TrimSpace(userIDFilter) != "" {
		whereClauses = append(whereClauses, "user_id = ?")
		args = append(args, strings.TrimSpace(userIDFilter))
	}

	if len(whereClauses) > 0 {
		query += " WHERE " + strings.Join(whereClauses, " AND ")
	}

	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := m.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("读取任务列表失败: %w", err)
	}
	defer rows.Close()

	var list []*TaskStatusResponse
	for rows.Next() {
		var t Task
		var responseBody, errorMsg string
		if err := rows.Scan(&t.ID, &t.Status, &t.StatusCode, &responseBody, &errorMsg, &t.CreatedAt, &t.UpdatedAt); err != nil {
			continue
		}
		done := (t.Status == StatusCompleted || t.Status == StatusFailed || t.Status == StatusCancelled)
		item := &TaskStatusResponse{
			ID:         t.ID,
			TaskID:     t.ID,
			Status:     t.Status,
			StatusCode: t.StatusCode,
			Done:       done,
			Chunks:     []string{},
			CreatedAt:  t.CreatedAt,
			UpdatedAt:  t.UpdatedAt,
		}
		if t.Status == StatusFailed {
			item.Error = &errorMsg
		}
		list = append(list, item)
	}

	countQuery := `SELECT COUNT(*) FROM ai_tasks`
	var countArgs []interface{}
	if len(whereClauses) > 0 {
		countQuery += " WHERE " + strings.Join(whereClauses, " AND ")
		countArgs = args[:len(args)-1] // 去除 limit 参数
	}
	var total int
	_ = m.db.QueryRow(countQuery, countArgs...).Scan(&total)

	return &TaskListResponse{
		Total: total,
		Tasks: list,
	}, nil
}

// DeleteTask 手动删除指定任务记录
func (m *Manager) DeleteTask(taskID string) error {
	m.activeMu.Lock()
	if cancel, found := m.activeTasks[taskID]; found {
		cancel()
		delete(m.activeTasks, taskID)
	}
	m.activeMu.Unlock()

	res, err := m.db.Exec(`DELETE FROM ai_tasks WHERE id = ?`, taskID)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrTaskNotFound
	}
	return nil
}

// CleanExpiredTasks 物理清理所有已超出 TTL 保存期限的任务
func (m *Manager) CleanExpiredTasks(now int64) (int64, error) {
	res, err := m.db.Exec(`DELETE FROM ai_tasks WHERE expires_at < ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// pruneExcessTasks 限制最多保存的任务数量，超出时淘汰最早的已终态任务 (FIFO)
// — 为什么这么写 —
// 1. 严格过滤任务状态：只淘汰处于 completed、failed 或 cancelled 状态的历史任务；
// 2. 绝对不删除处于 pending 或 processing 的进行中活跃任务，防止用户正在等待的大模型长生成被后台盲目斩首；
// 3. 淘汰前在 activeTasks 锁中防御性取消，杜绝内存与 goroutine 泄漏。
func (m *Manager) pruneExcessTasks(maxAllowed int) error {
	if maxAllowed < 0 {
		return nil
	}

	var count int
	if err := m.db.QueryRow(`SELECT COUNT(*) FROM ai_tasks`).Scan(&count); err != nil {
		return err
	}

	if count <= maxAllowed {
		return nil
	}

	excess := count - maxAllowed

	// 查找最早的已终态任务
	rows, err := m.db.Query(`
		SELECT id FROM ai_tasks
		WHERE status IN (?, ?, ?)
		ORDER BY created_at ASC
		LIMIT ?
	`, StatusCompleted, StatusFailed, StatusCancelled, excess)
	if err != nil {
		return err
	}
	defer rows.Close()

	var idsToDelete []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			idsToDelete = append(idsToDelete, id)
		}
	}

	if len(idsToDelete) == 0 {
		// 若当前无已终态任务可供淘汰，则不强行删除正在运行的任务，保障业务连续性
		return nil
	}

	m.activeMu.Lock()
	for _, id := range idsToDelete {
		if cancel, found := m.activeTasks[id]; found {
			cancel()
			delete(m.activeTasks, id)
		}
	}
	m.activeMu.Unlock()

	placeholders := make([]string, len(idsToDelete))
	args := make([]interface{}, len(idsToDelete))
	for i, id := range idsToDelete {
		placeholders[i] = "?"
		args[i] = id
	}

	delQuery := fmt.Sprintf("DELETE FROM ai_tasks WHERE id IN (%s)", strings.Join(placeholders, ","))
	_, err = m.db.Exec(delQuery, args...)
	return err
}

// recoverStaleTasks 服务启动时自检并修复因上一代服务异常中断残留的未决任务
// — 为什么这么写 —
// 若服务端重启或异常退出，数据库中旧的 pending/processing 任务已无对应后台 goroutine 驱动；
// 若不显式将其重置为终止态，客户端轮询将陷入永久等待。
func (m *Manager) recoverStaleTasks() {
	now := time.Now().Unix()
	res, err := m.db.Exec(`
		UPDATE ai_tasks
		SET status = ?, status_code = 500, error_msg = '服务重启，历史未完成任务已自动中止', updated_at = ?
		WHERE status IN (?, ?)
	`, StatusFailed, now, StatusPending, StatusProcessing)
	if err == nil {
		if aff, _ := res.RowsAffected(); aff > 0 {
			log.Printf("[AIRelay] 服务启动恢复：已将 %d 条前次运行残留的挂起任务重置为已中止", aff)
		}
	}
}

// StartCleaner 启动后台常驻清理定时器 (每 5 分钟轮询一次)
func (m *Manager) StartCleaner() {
	go func() {
		// 启动时立即自检
		now := time.Now().Unix()
		m.recoverStaleTasks()
		if deleted, err := m.CleanExpiredTasks(now); err == nil && deleted > 0 {
			log.Printf("[AIRelay] 服务启动自检：已安全清理 %d 条过期历史任务", deleted)
		}

		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				cfg := m.getConfig()
				now := time.Now().Unix()
				if deleted, err := m.CleanExpiredTasks(now); err == nil && deleted > 0 {
					log.Printf("[AIRelay] 自动清理：已物理销毁 %d 条超过 %d 小时保存期的旧任务", deleted, cfg.TTLHours)
				}
				_ = m.pruneExcessTasks(cfg.MaxTasks)
			case <-m.stopCh:
				return
			}
		}
	}()
}

// Stop 停止清理定时器并终止所有执行中的任务
func (m *Manager) Stop() {
	select {
	case <-m.stopCh:
	default:
		close(m.stopCh)
	}

	m.activeMu.Lock()
	for _, cancel := range m.activeTasks {
		cancel()
	}
	m.activeTasks = make(map[string]context.CancelFunc)
	m.activeMu.Unlock()
}

// ResolveUserIDByToken 根据设备令牌反查对应的用户 ID
func (m *Manager) ResolveUserIDByToken(token string) string {
	if token == "" || m.db == nil {
		return ""
	}
	tokenHash := auth.HashToken(token)
	var userID string
	err := m.db.QueryRow(`
		SELECT user_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL
	`, tokenHash).Scan(&userID)
	if err == nil {
		return userID
	}
	return ""
}

// -------------------------------------------------------------
// 内部辅助工具方法
// -------------------------------------------------------------

// normalizeUpstreamURL 规范化上游请求地址，确保路径携带 /chat/completions 且不破坏 URL Query 参数
// — 为什么这么写 —
// 1. 采用 url.Parse 深度解析 Path，杜绝在含有 ?api-version=... 等参数的场景下盲目 HasSuffix 造成 URL 错乱；
// 2. 适配 Azure OpenAI、自建反代等各种复杂上游 URL 变体。
func normalizeUpstreamURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		// 回退轻量字符串处理
		u := strings.TrimRight(raw, "/")
		if strings.HasSuffix(u, "/chat/completions") {
			return u
		}
		return u + "/chat/completions"
	}

	cleanPath := strings.TrimRight(parsed.Path, "/")
	if !strings.HasSuffix(cleanPath, "/chat/completions") {
		parsed.Path = cleanPath + "/chat/completions"
	}
	return parsed.String()
}

// synthesizeSSEChunks 从非流式完整响应体中提取内容，构造出合法的标准 OpenAI SSE 分片流
// — 为什么这么写 —
// 解决致命痛点：开启 forceNonStream 后上游返回单一完整 JSON，若不合成 SSE chunks，
// 流式客户端 (如 SillyTavern + st-catiecli-tasks) 轮询到的 chunks 将始终为空，
// 导致客户端收到 [DONE] 后界面展示完全空白。
func synthesizeSSEChunks(taskID string, responseBody []byte) []string {
	var respMap map[string]interface{}
	if err := json.Unmarshal(responseBody, &respMap); err != nil {
		return nil
	}

	id, _ := respMap["id"].(string)
	if id == "" {
		id = taskID
	}
	model, _ := respMap["model"].(string)
	var created int64 = time.Now().Unix()
	if c, ok := respMap["created"].(float64); ok && c > 0 {
		created = int64(c)
	}

	choices, ok := respMap["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil
	}

	firstChoice, ok := choices[0].(map[string]interface{})
	if !ok {
		return nil
	}

	msg, ok := firstChoice["message"].(map[string]interface{})
	if !ok {
		return nil
	}

	content, _ := msg["content"].(string)
	reasoningContent, _ := msg["reasoning_content"].(string)

	var chunks []string

	// 1. 若包含深度思考模型 (如 DeepSeek R1 / o1 reasoning_content)
	if strings.TrimSpace(reasoningContent) != "" {
		reasoningChunk := map[string]interface{}{
			"id":      id,
			"object":  "chat.completion.chunk",
			"created": created,
			"model":   model,
			"choices": []interface{}{
				map[string]interface{}{
					"index": 0,
					"delta": map[string]interface{}{
						"role":              "assistant",
						"reasoning_content": reasoningContent,
					},
					"finish_reason": nil,
				},
			},
		}
		if b, err := json.Marshal(reasoningChunk); err == nil {
			chunks = append(chunks, "data: "+string(b)+"\n\n")
		}
	}

	// 2. 主内容分片：按约 100 字符切分，呈现平滑打字机动画
	if content != "" {
		contentRunes := []rune(content)
		step := 100
		for i := 0; i < len(contentRunes); i += step {
			end := i + step
			if end > len(contentRunes) {
				end = len(contentRunes)
			}
			part := string(contentRunes[i:end])
			deltaMap := map[string]interface{}{
				"content": part,
			}
			if i == 0 && reasoningContent == "" {
				deltaMap["role"] = "assistant"
			}
			contentChunk := map[string]interface{}{
				"id":      id,
				"object":  "chat.completion.chunk",
				"created": created,
				"model":   model,
				"choices": []interface{}{
					map[string]interface{}{
						"index":         0,
						"delta":         deltaMap,
						"finish_reason": nil,
					},
				},
			}
			if b, err := json.Marshal(contentChunk); err == nil {
				chunks = append(chunks, "data: "+string(b)+"\n\n")
			}
		}
	}

	// 3. 终态分片 (携带 finish_reason 与 usage)
	finishChunk := map[string]interface{}{
		"id":      id,
		"object":  "chat.completion.chunk",
		"created": created,
		"model":   model,
		"choices": []interface{}{
			map[string]interface{}{
				"index":         0,
				"delta":         map[string]interface{}{},
				"finish_reason": "stop",
			},
		},
	}
	if usage, hasUsage := respMap["usage"]; hasUsage {
		finishChunk["usage"] = usage
	}
	if b, err := json.Marshal(finishChunk); err == nil {
		chunks = append(chunks, "data: "+string(b)+"\n\n")
	}

	// 4. 标准 SSE 终止标头
	chunks = append(chunks, "data: [DONE]\n\n")

	return chunks
}

// assembleCompletionFromSSEChunks 从 SSE 流分片中还原完整的 OpenAI 补全响应 JSON
func assembleCompletionFromSSEChunks(taskID string, chunks []string) []byte {
	var contentBuilder strings.Builder
	var reasoningBuilder strings.Builder
	modelName := "ai-model"
	created := time.Now().Unix()

	for _, c := range chunks {
		lines := strings.Split(c, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if payload == "" || payload == "[DONE]" {
				continue
			}

			var chunkMap map[string]interface{}
			if err := json.Unmarshal([]byte(payload), &chunkMap); err != nil {
				continue
			}

			if m, ok := chunkMap["model"].(string); ok && m != "" {
				modelName = m
			}
			if cr, ok := chunkMap["created"].(float64); ok && cr > 0 {
				created = int64(cr)
			}

			choices, ok := chunkMap["choices"].([]interface{})
			if !ok || len(choices) == 0 {
				continue
			}
			firstChoice, ok := choices[0].(map[string]interface{})
			if !ok {
				continue
			}
			delta, ok := firstChoice["delta"].(map[string]interface{})
			if !ok {
				continue
			}

			if text, ok := delta["content"].(string); ok {
				contentBuilder.WriteString(text)
			}
			if rText, ok := delta["reasoning_content"].(string); ok {
				reasoningBuilder.WriteString(rText)
			}
		}
	}

	msgMap := map[string]interface{}{
		"role":    "assistant",
		"content": contentBuilder.String(),
	}
	if reasoningBuilder.Len() > 0 {
		msgMap["reasoning_content"] = reasoningBuilder.String()
	}

	respMap := map[string]interface{}{
		"id":      taskID,
		"object":  "chat.completion",
		"created": created,
		"model":   modelName,
		"choices": []interface{}{
			map[string]interface{}{
				"index":         0,
				"message":       msgMap,
				"finish_reason": "stop",
			},
		},
	}

	b, _ := json.Marshal(respMap)
	return b
}

// extractErrorMessage 从上游返回的错误 JSON 中尽可能提取清晰文案
func extractErrorMessage(body []byte, statusCode int) string {
	if len(body) == 0 {
		return fmt.Sprintf("HTTP %d", statusCode)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err == nil {
		if errObj, ok := data["error"].(map[string]interface{}); ok {
			if msg, ok := errObj["message"].(string); ok && strings.TrimSpace(msg) != "" {
				return msg
			}
		}
		if detail, ok := data["detail"].(string); ok && strings.TrimSpace(detail) != "" {
			return detail
		}
		if msg, ok := data["message"].(string); ok && strings.TrimSpace(msg) != "" {
			return msg
		}
	}

	// 截取前 200 字节避免刷屏
	preview := string(body)
	if len(preview) > 200 {
		preview = preview[:200] + "..."
	}
	return preview
}
