package relay_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"sync-server/internal/config"
	"sync-server/internal/relay"
	"sync-server/internal/store"
)

func setupTestRelayDB(t *testing.T) (*store.DB, func()) {
	tempDir, err := os.MkdirTemp("", "relay-test-*")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}

	db, err := store.OpenDB(tempDir)
	if err != nil {
		t.Fatalf("连接测试数据库失败: %v", err)
	}

	cleanup := func() {
		db.Close()
		os.RemoveAll(tempDir)
	}

	return db, cleanup
}

// TestSubmitTask_Disabled 测试当中转开关关闭时拒绝提交
func TestSubmitTask_Disabled(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = false
	mgr := relay.NewManager(db.DB, cfg)

	_, err := mgr.SubmitTask(context.Background(), "user1", "https://api.openai.com/v1", "Bearer key", []byte(`{"model":"gpt-4o","messages":[]}`))
	if err != relay.ErrRelayDisabled {
		t.Fatalf("期望错误 ErrRelayDisabled，实际: %v", err)
	}
}

// TestSubmitTask_Validation 测试请求体验证 (缺少 model 或 messages)
func TestSubmitTask_Validation(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	mgr := relay.NewManager(db.DB, cfg)

	// 1. 缺少 model
	_, err := mgr.SubmitTask(context.Background(), "user1", "https://api.openai.com/v1", "Bearer key", []byte(`{"messages":[]}`))
	if err == nil || !strings.Contains(err.Error(), "缺少 model") {
		t.Fatalf("期望报缺少 model 错误，实际: %v", err)
	}

	// 2. 缺少 messages
	_, err = mgr.SubmitTask(context.Background(), "user1", "https://api.openai.com/v1", "Bearer key", []byte(`{"model":"gpt-4o"}`))
	if err == nil || !strings.Contains(err.Error(), "缺少 messages") {
		t.Fatalf("期望报缺少 messages 错误，实际: %v", err)
	}
}

// TestSubmitTask_AntiFreeloaderProtection 测试未认证用户尝试蹭刷服务端默认托管 Key 被 401 拦截
func TestSubmitTask_AntiFreeloaderProtection(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.DefaultApiKey = "sk-admin-hosted-key"
	mgr := relay.NewManager(db.DB, cfg)

	// 1. 未传 Authorization 且 userID 为空 (未认证陌生人) -> 必须被拦截 ErrUnauthorizedKey
	_, err := mgr.SubmitTask(context.Background(), "", "https://api.openai.com/v1", "", []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	if err != relay.ErrUnauthorizedKey {
		t.Fatalf("未认证陌生人蹭刷服务端 Key 应返回 ErrUnauthorizedKey，实际: %v", err)
	}

	// 2. 已认证用户 (userID = "user_123") 未传自身 Key -> 允许使用服务端托管 Key
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-admin-hosted-key" {
			http.Error(w, "bad key", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"chatcmpl-test","choices":[{"message":{"role":"assistant","content":"pong"}}]}`))
	}))
	defer upstreamServer.Close()

	task, err := mgr.SubmitTask(context.Background(), "user_123", upstreamServer.URL, "", []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatalf("合法用户使用服务端 Key 提交失败: %v", err)
	}
	if task.ID == "" {
		t.Fatalf("应成功返回 task_id")
	}
}

// TestSubmitTask_Success_Completed 测试后台成功调用上游并完成轮询
func TestSubmitTask_Success_Completed(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	receivedAuth := ""
	receivedStreamFlag := true
	receivedStreamOptions := false

	// 模拟上游 AI 服务端
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		bodyBytes, _ := io.ReadAll(r.Body)
		var bodyMap map[string]interface{}
		_ = json.Unmarshal(bodyBytes, &bodyMap)
		if s, ok := bodyMap["stream"].(bool); ok {
			receivedStreamFlag = s
		}
		if _, ok := bodyMap["stream_options"]; ok {
			receivedStreamOptions = true
		}

		time.Sleep(30 * time.Millisecond) // 模拟大模型计算耗时
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"id": "chatcmpl-test-123",
			"object": "chat.completion",
			"created": 1739280000,
			"model": "deepseek-chat",
			"choices": [
				{
					"index": 0,
					"message": {
						"role": "assistant",
						"content": "你好！我是AI测试助手。"
					},
					"finish_reason": "stop"
				}
			],
			"usage": {
				"prompt_tokens": 10,
				"completion_tokens": 15,
				"total_tokens": 25
			}
		}`))
	}))
	defer upstreamServer.Close()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.ForceNonStream = true
	cfg.AIRelay.DefaultUpstream = upstreamServer.URL
	mgr := relay.NewManager(db.DB, cfg)

	// 客户端传 stream: true 且带 stream_options，但在 ForceNonStream 模式下必须把 stream 改为 false 且移除 stream_options
	clientReq := `{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true,"stream_options":{"include_usage":true}}`
	resp, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer test-cat-key", []byte(clientReq))
	if err != nil {
		t.Fatalf("提交任务失败: %v", err)
	}

	if resp.ID == "" {
		t.Fatalf("期望返回任务 ID，实际为空")
	}

	// 验证秒级返回的初始状态为 pending 或 processing
	statusResp, err := mgr.GetTask(resp.ID, 0)
	if err != nil {
		t.Fatalf("获取初始任务失败: %v", err)
	}
	if statusResp.Status != relay.StatusPending && statusResp.Status != relay.StatusProcessing {
		t.Fatalf("期望初始状态为 pending 或 processing, 实际: %s", statusResp.Status)
	}

	// 轮询等待后台完成 (最多等待 3 秒)
	var finalResp *relay.TaskStatusResponse
	for i := 0; i < 30; i++ {
		time.Sleep(50 * time.Millisecond)
		finalResp, err = mgr.GetTask(resp.ID, 0)
		if err != nil {
			t.Fatalf("轮询任务出错: %v", err)
		}
		if finalResp.Done {
			break
		}
	}

	if !finalResp.Done {
		t.Fatalf("任务在 1.5 秒内未完成")
	}
	if receivedStreamOptions {
		t.Fatalf("ForceNonStream 开启时，上游绝不能收到 stream_options (否则 DeepSeek 报 400)")
	}
	if receivedStreamFlag {
		t.Fatalf("ForceNonStream 开启时，上游收到的 stream 必须为 false")
	}
	if finalResp.Status != relay.StatusCompleted {
		t.Fatalf("期望状态为 completed, 实际: %s (error: %v)", finalResp.Status, finalResp.Error)
	}
	if finalResp.StatusCode != 200 {
		t.Fatalf("期望状态码 200, 实际: %d", finalResp.StatusCode)
	}
	if len(finalResp.Result) == 0 {
		t.Fatalf("期望返回 Result 响应体，实际为空")
	}
	if !strings.Contains(string(finalResp.Result), "你好！我是AI测试助手。") {
		t.Fatalf("Result 未包含预期内容: %s", string(finalResp.Result))
	}

	// 校验兼容性：task_id 必须与 id 一致且非空
	if resp.TaskID != resp.ID || resp.TaskID == "" {
		t.Errorf("提交响应 task_id 期望等于 id (%s), 实际: %s", resp.ID, resp.TaskID)
	}
	if finalResp.TaskID != finalResp.ID || finalResp.TaskID == "" {
		t.Errorf("状态响应 task_id 期望等于 id (%s), 实际: %s", finalResp.ID, finalResp.TaskID)
	}

	// 核心验证：即使 forceNonStream 为 true，也必须自动合成 SSE chunks 供流式客户端 (SillyTavern) 打字机呈现
	if len(finalResp.Chunks) == 0 {
		t.Fatalf("期望服务端自动合成 SSE chunks，实际为空")
	}
	allChunksText := strings.Join(finalResp.Chunks, "")
	if !strings.Contains(allChunksText, "你好！我是AI测试助手。") {
		t.Errorf("合成的 chunks 未包含文本内容: %s", allChunksText)
	}
	if !strings.Contains(allChunksText, "[DONE]") {
		t.Errorf("合成的 chunks 未包含 [DONE] 终结符: %s", allChunksText)
	}

	// 校验传递给上游的鉴权密钥与强制非流式
	if receivedAuth != "Bearer test-cat-key" {
		t.Errorf("期望上游收到 Authorization 'Bearer test-cat-key', 实际: %s", receivedAuth)
	}
	if receivedStreamFlag != false {
		t.Errorf("期望上游收到 stream=false (ForceNonStream生效), 实际: %v", receivedStreamFlag)
	}
}

// TestSubmitTask_UpstreamError 测试上游报错 (429 限流 / 401 密钥失效)
func TestSubmitTask_UpstreamError(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Rate limit exceeded: 5 req/min","type":"requests"}}`))
	}))
	defer upstreamServer.Close()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.DefaultUpstream = upstreamServer.URL
	mgr := relay.NewManager(db.DB, cfg)

	resp, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer invalid-key", []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatalf("提交任务失败: %v", err)
	}

	var finalResp *relay.TaskStatusResponse
	for i := 0; i < 30; i++ {
		time.Sleep(30 * time.Millisecond)
		finalResp, err = mgr.GetTask(resp.ID, 0)
		if err == nil && finalResp.Done {
			break
		}
	}

	if !finalResp.Done {
		t.Fatalf("期望任务完成或失败")
	}
	if finalResp.Status != relay.StatusFailed {
		t.Fatalf("期望状态为 failed, 实际: %s", finalResp.Status)
	}
	if finalResp.StatusCode != 429 {
		t.Fatalf("期望状态码 429, 实际: %d", finalResp.StatusCode)
	}
	if finalResp.Error == nil || !strings.Contains(*finalResp.Error, "Rate limit exceeded") {
		t.Fatalf("期望错误详情包含 Rate limit exceeded, 实际: %v", finalResp.Error)
	}
}

// TestSubmitTask_Stream_UpstreamError 验证流式模式下上游返回 HTTP 401/429 报错时，任务被正确标记为 failed 而非误标为 completed
func TestSubmitTask_Stream_UpstreamError(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}`))
	}))
	defer upstreamServer.Close()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.ForceNonStream = false // 允许真正流式
	cfg.AIRelay.DefaultUpstream = upstreamServer.URL
	mgr := relay.NewManager(db.DB, cfg)

	// 客户端请求流式
	resp, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer bad-key", []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}],"stream":true}`))
	if err != nil {
		t.Fatalf("提交任务失败: %v", err)
	}

	var finalResp *relay.TaskStatusResponse
	for i := 0; i < 30; i++ {
		time.Sleep(30 * time.Millisecond)
		finalResp, err = mgr.GetTask(resp.ID, 0)
		if err == nil && finalResp.Done {
			break
		}
	}

	if !finalResp.Done {
		t.Fatalf("期望任务结束")
	}
	if finalResp.Status != relay.StatusFailed {
		t.Fatalf("上游 401 报错期望状态为 failed, 实际误标为了: %s", finalResp.Status)
	}
	if finalResp.StatusCode != 401 {
		t.Fatalf("期望状态码 401, 实际: %d", finalResp.StatusCode)
	}
	if finalResp.Error == nil || !strings.Contains(*finalResp.Error, "Incorrect API key") {
		t.Fatalf("期望错误详情包含 Incorrect API key, 实际: %v", finalResp.Error)
	}
}

// TestCancelTask 测试主动取消执行中的任务
func TestCancelTask(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	// 模拟慢速响应服务
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer upstreamServer.Close()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.DefaultUpstream = upstreamServer.URL
	mgr := relay.NewManager(db.DB, cfg)

	resp, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer key", []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"slow"}]}`))
	if err != nil {
		t.Fatalf("提交任务失败: %v", err)
	}

	// 稍作等待确保任务进入 processing
	time.Sleep(50 * time.Millisecond)

	// 主动调用取消
	cancelResp, err := mgr.CancelTask(resp.ID)
	if err != nil {
		t.Fatalf("取消任务接口报错: %v", err)
	}
	if cancelResp.Status != string(relay.StatusCancelled) {
		t.Fatalf("期望取消响应状态为 cancelled, 实际: %s", cancelResp.Status)
	}
	if cancelResp.TaskID != cancelResp.ID || cancelResp.TaskID == "" {
		t.Errorf("取消响应 task_id 期望等于 id, 实际: %s", cancelResp.TaskID)
	}

	// 检查任务状态已置为 cancelled 且 Done=true
	taskResp, err := mgr.GetTask(resp.ID, 0)
	if err != nil {
		t.Fatalf("获取任务失败: %v", err)
	}
	if !taskResp.Done {
		t.Fatalf("期望 Done=true")
	}
	if taskResp.Status != relay.StatusCancelled {
		t.Fatalf("期望任务状态为 cancelled, 实际: %s", taskResp.Status)
	}
}

// TestTTL_CleanExpiredTasks 测试 24 小时数据过期物理清理
func TestTTL_CleanExpiredTasks(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.TTLHours = 24
	mgr := relay.NewManager(db.DB, cfg)

	now := time.Now().Unix()

	// 插入 1 条已过期的任务 (expires_at 为 10 秒前)
	_, err := db.Exec(`
		INSERT INTO ai_tasks (
			id, status, model, upstream_url, status_code,
			request_body, response_body, created_at, updated_at, expires_at
		) VALUES ('expired_task', 'completed', 'gpt-4', 'http://upstream', 200, '{}', '{}', ?, ?, ?)
	`, now-86500, now-86500, now-10)
	if err != nil {
		t.Fatalf("插入测试过期任务失败: %v", err)
	}

	// 插入 1 条未过期的任务 (expires_at 为未来 24 小时)
	_, err = db.Exec(`
		INSERT INTO ai_tasks (
			id, status, model, upstream_url, status_code,
			request_body, response_body, created_at, updated_at, expires_at
		) VALUES ('active_task', 'completed', 'gpt-4', 'http://upstream', 200, '{}', '{}', ?, ?, ?)
	`, now, now, now+86400)
	if err != nil {
		t.Fatalf("插入测试未过期任务失败: %v", err)
	}

	// 执行清理
	deleted, err := mgr.CleanExpiredTasks(now)
	if err != nil {
		t.Fatalf("执行 CleanExpiredTasks 失败: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("期望清理 1 条过期任务, 实际清理: %d", deleted)
	}

	// 验证过期任务已物理清除
	_, err = mgr.GetTask("expired_task", 0)
	if err != relay.ErrTaskNotFound {
		t.Fatalf("期望过期任务返回 ErrTaskNotFound，实际: %v", err)
	}

	// 验证未过期任务完好无损
	active, err := mgr.GetTask("active_task", 0)
	if err != nil || active == nil {
		t.Fatalf("未过期任务应完好保留，实际: %v", err)
	}
}

// TestPruneExcessTasks_Max500 测试最多保存 500 个请求容量裁剪 (先进先出)
func TestPruneExcessTasks_Max500(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.MaxTasks = 3 // 测试设为上限 3 条
	mgr := relay.NewManager(db.DB, cfg)

	now := time.Now().Unix()

	// 连续插入 5 条已完成任务
	for i := 1; i <= 5; i++ {
		taskID := fmt.Sprintf("task_%d", i)
		created := now + int64(i)
		_, err := db.Exec(`
			INSERT INTO ai_tasks (
				id, status, model, upstream_url, status_code,
				request_body, response_body, created_at, updated_at, expires_at
			) VALUES (?, 'completed', 'gpt-4', 'http://upstream', 200, '{}', '{}', ?, ?, ?)
		`, taskID, created, created, created+86400)
		if err != nil {
			t.Fatalf("批量插入任务失败: %v", err)
		}
	}

	// 提交一个新任务，应自动触发容量裁剪至 maxTasks (3条)
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer upstreamServer.Close()

	_, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer key", []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"test"}]}`))
	if err != nil {
		t.Fatalf("提交任务触发裁剪失败: %v", err)
	}

	// 检查总数是否被控制在 3 条以内
	list, err := mgr.ListTasks(100, "", "")
	if err != nil {
		t.Fatalf("读取列表失败: %v", err)
	}
	if list.Total > 3 {
		t.Fatalf("期望总数受限 <= 3, 实际: %d", list.Total)
	}

	// 最早的 task_1 和 task_2 应被淘汰
	_, err = mgr.GetTask("task_1", 0)
	if err != relay.ErrTaskNotFound {
		t.Errorf("期望最早的 task_1 已被淘汰裁剪，实际: %v", err)
	}
	_, err = mgr.GetTask("task_2", 0)
	if err != relay.ErrTaskNotFound {
		t.Errorf("期望次早的 task_2 已被淘汰裁剪，实际: %v", err)
	}
}

// TestPruneExcessTasks_ProtectsActiveTasks 验证配额裁剪绝对不会误杀正在 processing/pending 的运行中活跃任务
func TestPruneExcessTasks_ProtectsActiveTasks(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.MaxTasks = 2 // 上限设为 2 条
	mgr := relay.NewManager(db.DB, cfg)

	now := time.Now().Unix()

	// 插入 1 条最早但正在运行的长任务 (processing)
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (id, status, model, created_at, updated_at, expires_at, request_body)
		VALUES ('task_active_slow', 'processing', 'o1-preview', ?, ?, ?, '{}')
	`, now-100, now-100, now+86400)

	// 插入 2 条已完成的普通任务 (completed)
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (id, status, model, created_at, updated_at, expires_at, request_body)
		VALUES ('task_done_1', 'completed', 'gpt-4o', ?, ?, ?, '{}')
	`, now-50, now-50, now+86400)
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (id, status, model, created_at, updated_at, expires_at, request_body)
		VALUES ('task_done_2', 'completed', 'gpt-4o', ?, ?, ?, '{}')
	`, now-10, now-10, now+86400)

	// 目前已有 3 条 (超出 maxTasks=2)，触发裁剪
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer upstreamServer.Close()

	_, err := mgr.SubmitTask(context.Background(), "user1", upstreamServer.URL, "Bearer key", []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"test"}]}`))
	if err != nil {
		t.Fatalf("提交任务触发裁剪失败: %v", err)
	}

	// 验证：尽管 task_active_slow 是时间最早的，但由于其处于 processing 态，绝对不能被裁剪！
	activeTask, err := mgr.GetTask("task_active_slow", 0)
	if err != nil || activeTask == nil {
		t.Fatalf("正在运行中的任务 task_active_slow 被错误裁剪淘汰了！实际: %v", err)
	}

	// 被淘汰的应是最早的已完成任务 task_done_1
	_, err = mgr.GetTask("task_done_1", 0)
	if err != relay.ErrTaskNotFound {
		t.Errorf("最早的已完成任务 task_done_1 应被淘汰，实际: %v", err)
	}
}

// TestDeleteTask_Manual 测试手动物理删除指定任务
func TestDeleteTask_Manual(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	mgr := relay.NewManager(db.DB, cfg)

	now := time.Now().Unix()
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (
			id, status, model, upstream_url, status_code,
			request_body, response_body, created_at, updated_at, expires_at
		) VALUES ('task_manual_del', 'completed', 'gpt-4', 'http://upstream', 200, '{}', '{}', ?, ?, ?)
	`, now, now, now+86400)

	err := mgr.DeleteTask("task_manual_del")
	if err != nil {
		t.Fatalf("手动删除失败: %v", err)
	}

	_, err = mgr.GetTask("task_manual_del", 0)
	if err != relay.ErrTaskNotFound {
		t.Fatalf("期望已删除的任务返回 ErrTaskNotFound，实际: %v", err)
	}
}

// TestStaleTaskRecovery_Startup 验证服务启动自检时将遗留挂起任务重置为中止
func TestStaleTaskRecovery_Startup(t *testing.T) {
	db, cleanup := setupTestRelayDB(t)
	defer cleanup()

	now := time.Now().Unix()
	// 模拟前次服务异常退出遗留的 processing 和 pending 任务
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (id, status, model, created_at, updated_at, expires_at, request_body)
		VALUES ('stale_proc', 'processing', 'gpt-4o', ?, ?, ?, '{}')
	`, now-300, now-300, now+86400)
	_, _ = db.Exec(`
		INSERT INTO ai_tasks (id, status, model, created_at, updated_at, expires_at, request_body)
		VALUES ('stale_pend', 'pending', 'gpt-4o', ?, ?, ?, '{}')
	`, now-300, now-300, now+86400)

	cfg := config.DefaultConfig()
	cfg.AIRelay.Enabled = true
	mgr := relay.NewManager(db.DB, cfg)

	// 启动清理自检
	mgr.StartCleaner()
	defer mgr.Stop()

	// 等待自检完成
	time.Sleep(50 * time.Millisecond)

	tProc, err := mgr.GetTask("stale_proc", 0)
	if err != nil || tProc.Status != relay.StatusFailed || !tProc.Done {
		t.Errorf("遗留 processing 任务未被重置为 failed: %+v", tProc)
	}

	tPend, err := mgr.GetTask("stale_pend", 0)
	if err != nil || tPend.Status != relay.StatusFailed || !tPend.Done {
		t.Errorf("遗留 pending 任务未被重置为 failed: %+v", tPend)
	}
}
