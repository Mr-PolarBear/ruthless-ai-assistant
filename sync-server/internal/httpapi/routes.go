package httpapi

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"strings"
	"time"

	"github.com/google/uuid"

	"sync-server/internal/audit"
	"sync-server/internal/auth"
	"sync-server/internal/config"
	"sync-server/internal/relay"
	"sync-server/internal/snapshot"
)

// ServerAPI 组织所有 API 路由与业务依赖
type ServerAPI struct {
	mu          sync.RWMutex
	cfgWatcher  *config.ConfigWatcher
	cfg         *config.Config
	db          *sql.DB
	snapMgr     *snapshot.Manager
	relayMgr    *relay.Manager
	ipLimiter   *auth.SimpleRateLimiter
	authLimiter *auth.SimpleRateLimiter
	argonSem    chan struct{} // Argon2id 内存防爆信号量 (限制同时计算并发 <= 2)
}

// NewServerAPI 构建 API 服务实例
func NewServerAPI(cfg *config.Config, db *sql.DB, snapMgr *snapshot.Manager, relayMgr ...*relay.Manager) *ServerAPI {
	rpm := 60
	cd := 60
	if cfg != nil {
		if cfg.RateLimit.RequestsPerMinute > 0 {
			rpm = cfg.RateLimit.RequestsPerMinute
		}
		if cfg.RateLimit.CooldownSeconds > 0 {
			cd = cfg.RateLimit.CooldownSeconds
		}
	}

	var rMgr *relay.Manager
	if len(relayMgr) > 0 && relayMgr[0] != nil {
		rMgr = relayMgr[0]
	} else if db != nil && cfg != nil {
		rMgr = relay.NewManager(db, cfg)
	}

	return &ServerAPI{
		cfg:         cfg,
		db:          db,
		snapMgr:     snapMgr,
		relayMgr:    rMgr,
		ipLimiter:   auth.NewRateLimiter(rpm, time.Duration(cd)*time.Second),
		authLimiter: auth.NewRateLimiter(10, 15*time.Minute), // 15 分钟内最多尝试 10 次登录/注册
		argonSem:    make(chan struct{}, 2),                 // 最大允许 2 个并发 Argon2id 计算 (2 * 64MB = 128MB，绝对防 OOM)
	}
}

// AttachWatcher 关联配置文件监听器，实现跨域白名单与熔断限流阈值动态热生效
func (api *ServerAPI) AttachWatcher(watcher *config.ConfigWatcher) {
	if watcher == nil {
		return
	}
	api.mu.Lock()
	api.cfgWatcher = watcher
	api.mu.Unlock()

	watcher.OnReload(func(newCfg *config.Config) {
		api.mu.Lock()
		api.cfg = newCfg
		api.mu.Unlock()

		rpm := newCfg.RateLimit.RequestsPerMinute
		cd := newCfg.RateLimit.CooldownSeconds
		if rpm <= 0 {
			rpm = 60
		}
		if cd <= 0 {
			cd = 60
		}

		api.ipLimiter.UpdateConfig(rpm, time.Duration(cd)*time.Second)
		if api.snapMgr != nil {
			api.snapMgr.UpdateLimits(newCfg.MaxSnapshotBytes, newCfg.MaxSnapshotsPerUser, newCfg.MaxTotalStorageBytes)
		}
		if api.relayMgr != nil {
			api.relayMgr.UpdateConfig(newCfg.AIRelay)
		}
	})
}

// getConfig 线程安全获取最新配置副本或指针，彻底根除热重载时的并发数据竞争
func (api *ServerAPI) getConfig() *config.Config {
	api.mu.RLock()
	defer api.mu.RUnlock()
	if api.cfgWatcher != nil {
		return api.cfgWatcher.Get()
	}
	return api.cfg
}

// RegisterRoutes 注册路由
func (api *ServerAPI) RegisterRoutes() http.Handler {
	mux := http.NewServeMux()

	// 1. 公开接口
	mux.HandleFunc("GET /api/health", api.handleHealth)
	mux.HandleFunc("POST /api/auth/prelogin", api.handlePrelogin)
	mux.HandleFunc("POST /api/auth/register", api.handleRegister)
	mux.HandleFunc("POST /api/auth/login", api.handleLogin)

	// 2. 鉴权接口
	authHandler := AuthMiddleware(api.db)

	mux.Handle("POST /api/auth/logout", authHandler(http.HandlerFunc(api.handleLogout)))
	mux.Handle("GET /api/devices", authHandler(http.HandlerFunc(api.handleListDevices)))
	mux.Handle("DELETE /api/devices/{id}", authHandler(http.HandlerFunc(api.handleRevokeDevice)))
	mux.Handle("GET /api/account", authHandler(http.HandlerFunc(api.handleAccount)))
	mux.Handle("POST /api/snapshots", authHandler(http.HandlerFunc(api.handleUploadSnapshot)))
	mux.Handle("GET /api/snapshots", authHandler(http.HandlerFunc(api.handleListSnapshots)))
	mux.Handle("GET /api/snapshots/{id}", authHandler(http.HandlerFunc(api.handleDownloadSnapshot)))
	mux.Handle("DELETE /api/snapshots/{id}", authHandler(http.HandlerFunc(api.handleDeleteSnapshot)))
	mux.Handle("POST /api/snapshots/batch-delete", authHandler(http.HandlerFunc(api.handleBatchDeleteSnapshots)))

	// 3. AI 接口中转 / 后台任务 API (CatieCli 规范与 Ruthless API 双向兼容)
	// POST /v1/openai/tasks - 异步提交任务秒回 ID
	// GET  /v1/openai/tasks/{id} - 轮询取结果 (支持 ?after=N 增量分片)
	// POST /v1/openai/tasks/{id}/cancel - 取消任务
	// GET  /v1/openai/tasks - 任务列表
	// DELETE /v1/openai/tasks/{id} - 物理删除任务
	if api.relayMgr != nil {
		rh := relay.NewHandler(api.relayMgr)
		mux.HandleFunc("POST /v1/openai/tasks", rh.HandleSubmitTask)
		mux.HandleFunc("POST /api/ai/tasks", rh.HandleSubmitTask)

		mux.HandleFunc("GET /v1/openai/tasks/{id}", rh.HandleGetTask)
		mux.HandleFunc("GET /api/ai/tasks/{id}", rh.HandleGetTask)

		mux.HandleFunc("POST /v1/openai/tasks/{id}/cancel", rh.HandleCancelTask)
		mux.HandleFunc("POST /api/ai/tasks/{id}/cancel", rh.HandleCancelTask)

		mux.HandleFunc("GET /v1/openai/tasks", rh.HandleListTasks)
		mux.HandleFunc("GET /api/ai/tasks", rh.HandleListTasks)

		mux.HandleFunc("DELETE /v1/openai/tasks/{id}", rh.HandleDeleteTask)
		mux.HandleFunc("DELETE /api/ai/tasks/{id}", rh.HandleDeleteTask)

		// 4. 标准 OpenAI /v1/chat/completions 原生中转代理 (同步直连与流式透传)
		mux.HandleFunc("POST /v1/chat/completions", rh.HandleChatCompletions)
		mux.HandleFunc("POST /api/ai/chat/completions", rh.HandleChatCompletions)
	}

		// 中间件链：IP 限流熔断 -> Recover -> 动态 CORS
	ipLimitedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := GetClientIP(r)
		if !api.ipLimiter.Allow(ip) {
			remSec := api.ipLimiter.GetRemainingCooldownSeconds(ip)
			w.Header().Set("Retry-After", strconv.Itoa(remSec))
			JSONError(w, http.StatusTooManyRequests, "RATE_LIMITED", fmt.Sprintf("IP 请求过于频繁，已自动熔断冷却，请在 %d 秒后再试", remSec))
			return
		}
		mux.ServeHTTP(w, r)
	})

	getOrigins := func() []string {
		api.mu.RLock()
		defer api.mu.RUnlock()
		if api.cfgWatcher != nil {
			return api.cfgWatcher.Get().AllowedOrigins
		}
		if api.cfg != nil {
			return api.cfg.AllowedOrigins
		}
		return []string{"*"}
	}

	handler := RecoverMiddleware(ipLimitedHandler)
	return DynamicCORSMiddleware(getOrigins)(handler)
}

// handleHealth 连通性与健康检查
func (api *ServerAPI) handleHealth(w http.ResponseWriter, r *http.Request) {
	JSONSuccess(w, map[string]interface{}{
		"ok":      true,
		"version": "v1.0.0",
		"time":    time.Now().Unix(),
	})
}

// handlePrelogin 预登录获取 salt
func (api *ServerAPI) handlePrelogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "用户名不能为空")
		return
	}

	var kdfSalt []byte
	var kdfIter int
	err := api.db.QueryRow(`SELECT kdf_salt, kdf_iter FROM users WHERE username = ?`, req.Username).Scan(&kdfSalt, &kdfIter)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 防枚举：生成一致性伪 salt
			cfg := api.getConfig()
			pseudoSalt := auth.GeneratePseudoSalt(cfg.ServerSecret, req.Username)
			JSONSuccess(w, map[string]interface{}{
				"kdfSalt": hex.EncodeToString(pseudoSalt),
				"kdfIter": cfg.KdfMinIter,
			})
			return
		}
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "查询用户失败")
		return
	}

	JSONSuccess(w, map[string]interface{}{
		"kdfSalt": hex.EncodeToString(kdfSalt),
		"kdfIter": kdfIter,
	})
}

// handleRegister 用户凭邀请码注册
func (api *ServerAPI) handleRegister(w http.ResponseWriter, r *http.Request) {
	ip := GetClientIP(r)
	if !api.authLimiter.Allow("reg:" + ip) {
		JSONError(w, http.StatusTooManyRequests, "RATE_LIMITED", "注册过于频繁，请稍后再试")
		return
	}

	var req struct {
		InviteCode  string `json:"inviteCode"`
		Username    string `json:"username"`
		KdfSaltHex string `json:"kdfSalt"`
		KdfIter     int    `json:"kdfIter"`
		AuthHashHex string `json:"authHash"`
		DeviceName  string `json:"deviceName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "请求格式错误")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 3 || len(req.Username) > 32 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "用户名长度需在 3~32 字符之间")
		return
	}

	cfg := api.getConfig()
	if req.KdfIter < cfg.KdfMinIter {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "KDF 迭代次数低于服务端安全策略")
		return
	}

	kdfSalt, err := hex.DecodeString(req.KdfSaltHex)
	authHash, err2 := hex.DecodeString(req.AuthHashHex)
	if err != nil || err2 != nil || len(kdfSalt) < 16 || len(authHash) < 32 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "密钥哈希格式错误")
		return
	}

	tx, err := api.db.Begin()
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "事务创建失败")
		return
	}
	defer tx.Rollback()

	// 1. 验证邀请码 (使用 SHA-256 校验)
	inviteHash := sha256.Sum256([]byte(strings.TrimSpace(req.InviteCode)))
	var expiresAt int64
	var usedBy sql.NullString
	err = tx.QueryRow(`SELECT expires_at, used_by FROM invites WHERE code_hash = ?`, inviteHash[:]).Scan(&expiresAt, &usedBy)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			JSONError(w, http.StatusBadRequest, "INVITE_INVALID", "邀请码不存在或无效")
			return
		}
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "查询邀请码失败")
		return
	}
	if usedBy.Valid || (expiresAt > 0 && expiresAt < time.Now().Unix()) {
		JSONError(w, http.StatusBadRequest, "INVITE_INVALID", "邀请码已被使用或已过期")
		return
	}

	// 2. 检查用户名是否重复
	var existingID string
	err = tx.QueryRow(`SELECT id FROM users WHERE username = ?`, req.Username).Scan(&existingID)
	if err == nil {
		JSONError(w, http.StatusConflict, "USERNAME_TAKEN", "该用户名已被注册")
		return
	}

	// 3. 服务端加盐二次哈希
	authSalt, err := auth.GenerateRandomBytes(16)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "生成盐失败")
		return
	}
	storedHash := auth.HashAuthSecret(authHash, authSalt)

	userID := uuid.NewString()
	now := time.Now().Unix()
	rawInviteCode := strings.TrimSpace(req.InviteCode)

	_, err = tx.Exec(
		`INSERT INTO users (id, username, kdf_salt, kdf_iter, auth_hash, auth_salt, quota_bytes, invite_code, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, req.Username, kdfSalt, req.KdfIter, storedHash, authSalt, cfg.DefaultQuotaBytes, rawInviteCode, now,
	)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "创建用户失败")
		return
	}

	// 标记邀请码已使用
	_, _ = tx.Exec(`UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ?`, userID, now, inviteHash[:])

	// 4. 创建初始设备
	deviceID := uuid.NewString()
	token, err := auth.GenerateDeviceToken()
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "生成令牌失败")
		return
	}
	tokenHash := auth.HashToken(token)

	devName := strings.TrimSpace(req.DeviceName)
	if devName == "" {
		devName = "首选设备"
	}

	_, err = tx.Exec(
		`INSERT INTO devices (id, user_id, name, token_hash, created_at, last_seen_at, last_ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		deviceID, userID, devName, tokenHash, now, now, ip,
	)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "注册设备失败")
		return
	}

	if err := tx.Commit(); err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "提交事务失败")
		return
	}

	audit.Log(api.db, userID, deviceID, "register", ip, "新用户注册成功")

	JSONSuccess(w, map[string]interface{}{
		"userId":   userID,
		"deviceId": deviceID,
		"token":    token,
	})
}

// handleLogin 登录
func (api *ServerAPI) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := GetClientIP(r)

	var req struct {
		Username    string `json:"username"`
		AuthHashHex string `json:"authHash"`
		DeviceName  string `json:"deviceName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "请求参数错误")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if !api.authLimiter.Allow("login:" + req.Username) {
		JSONError(w, http.StatusTooManyRequests, "RATE_LIMITED", "操作过于频繁，请稍后再试")
		return
	}

	var userID string
	var storedHash, authSalt []byte
	var disabled, failedCount int
	var lockedUntil sql.NullInt64

	query := `SELECT id, auth_hash, auth_salt, disabled, failed_count, locked_until FROM users WHERE username = ?`
	err := api.db.QueryRow(query, req.Username).Scan(&userID, &storedHash, &authSalt, &disabled, &failedCount, &lockedUntil)
	if err != nil {
		JSONError(w, http.StatusUnauthorized, "AUTH_FAILED", "用户名或密码错误")
		return
	}

	if disabled == 1 {
		JSONError(w, http.StatusForbidden, "AUTH_FAILED", "账号已被停用")
		return
	}

	now := time.Now().Unix()
	if lockedUntil.Valid && lockedUntil.Int64 > now {
		remainingMin := (lockedUntil.Int64 - now + 59) / 60
		JSONError(w, http.StatusForbidden, "ACCOUNT_LOCKED", fmt.Sprintf("账号因连续输错密码已锁定，请 %d 分钟后再试", remainingMin))
		return
	}

	clientAuthHash, err := hex.DecodeString(req.AuthHashHex)
	if err != nil || len(clientAuthHash) == 0 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "哈希格式错误")
		return
	}

	// 内存防爆保护：限制全服务同时进行的 Argon2id 并发计算，超出立即快速失败，防 OOM 炸弹
	select {
	case api.argonSem <- struct{}{}:
		defer func() { <-api.argonSem }()
	default:
		w.Header().Set("Retry-After", "5")
		JSONError(w, http.StatusTooManyRequests, "BUSY", "系统哈希算力繁忙，请 5 秒后再试")
		return
	}

	computedHash := auth.HashAuthSecret(clientAuthHash, authSalt)
	if !auth.VerifyHash(storedHash, computedHash) {
		newFailed := failedCount + 1
		var lockTime interface{} = nil
		var errMsg string
		if newFailed >= 10 {
			lockTime = now + 3600 // 输错 10 次锁定 60 分钟
			errMsg = "密码连续输错10次，账号已锁定60分钟，请稍后再试"
		} else if newFailed >= 5 {
			lockTime = now + 900 // 输错 5 次锁定 15 分钟
			errMsg = "密码连续输错5次，账号已锁定15分钟，请稍后再试"
		} else if newFailed >= 3 {
			lockTime = now + 300 // 连续输错 3 次锁定 5 分钟
			errMsg = "密码连续输错3次，账号已锁定5分钟，请稍后再试"
		} else {
			remainingAttempts := 3 - newFailed
			errMsg = fmt.Sprintf("用户名或密码错误，还可尝试 %d 次", remainingAttempts)
		}
		_, _ = api.db.Exec(`UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?`, newFailed, lockTime, userID)
		audit.Log(api.db, userID, "", "login_fail", ip, "密码错误")
		if newFailed >= 3 {
			JSONError(w, http.StatusForbidden, "ACCOUNT_LOCKED", errMsg)
		} else {
			JSONError(w, http.StatusUnauthorized, "AUTH_FAILED", errMsg)
		}
		return
	}

	// 密码正确，清零失败计数
	_, _ = api.db.Exec(`UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?`, userID)

	// 生成新设备令牌
	deviceID := uuid.NewString()
	token, err := auth.GenerateDeviceToken()
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "生成令牌失败")
		return
	}
	tokenHash := auth.HashToken(token)

	devName := strings.TrimSpace(req.DeviceName)
	if devName == "" {
		devName = "新设备"
	}

	_, err = api.db.Exec(
		`INSERT INTO devices (id, user_id, name, token_hash, created_at, last_seen_at, last_ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		deviceID, userID, devName, tokenHash, now, now, ip,
	)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "记录设备失败")
		return
	}

	audit.Log(api.db, userID, deviceID, "login", ip, "登录成功")

	JSONSuccess(w, map[string]interface{}{
		"userId":   userID,
		"deviceId": deviceID,
		"token":    token,
	})
}

// handleLogout 退出并吊销当前设备
func (api *ServerAPI) handleLogout(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	deviceID := GetDeviceIDFromContext(r.Context())
	ip := GetClientIP(r)

	now := time.Now().Unix()
	_, _ = api.db.Exec(`UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?`, now, deviceID, userID)
	audit.Log(api.db, userID, deviceID, "revoke", ip, "主动退出吊销设备")

	JSONSuccess(w, map[string]bool{"revoked": true})
}

// handleListDevices 获取用户的所有设备列表
func (api *ServerAPI) handleListDevices(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	currentDeviceID := GetDeviceIDFromContext(r.Context())

	rows, err := api.db.Query(
		`SELECT id, name, created_at, last_seen_at, last_ip, revoked_at
		 FROM devices
		 WHERE user_id = ? AND revoked_at IS NULL
		 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "获取设备列表失败")
		return
	}
	defer rows.Close()

	type DeviceItem struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		CreatedAt  int64  `json:"createdAt"`
		LastSeenAt int64  `json:"lastSeenAt"`
		LastIP     string `json:"lastIp"`
		Current    bool   `json:"current"`
	}

	var list []DeviceItem
	for rows.Next() {
		var item DeviceItem
		var lastSeen sql.NullInt64
		var lastIP sql.NullString
		var revokedAt sql.NullInt64

		if err := rows.Scan(&item.ID, &item.Name, &item.CreatedAt, &lastSeen, &lastIP, &revokedAt); err != nil {
			JSONError(w, http.StatusInternalServerError, "INTERNAL", "读取设备信息失败")
			return
		}
		if lastSeen.Valid {
			item.LastSeenAt = lastSeen.Int64
		}
		if lastIP.Valid {
			item.LastIP = lastIP.String
		}
		item.Current = (item.ID == currentDeviceID)
		list = append(list, item)
	}

	JSONSuccess(w, list)
}

// handleRevokeDevice 吊销指定设备
func (api *ServerAPI) handleRevokeDevice(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	targetDeviceID := r.PathValue("id")
	ip := GetClientIP(r)

	if targetDeviceID == "" {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "设备ID不能为空")
		return
	}

	now := time.Now().Unix()
	res, err := api.db.Exec(`UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?`, now, targetDeviceID, userID)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "吊销设备失败")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		JSONError(w, http.StatusNotFound, "NOT_FOUND", "设备不存在或已被吊销")
		return
	}

	audit.Log(api.db, userID, targetDeviceID, "revoke", ip, "吊销指定设备")
	JSONSuccess(w, map[string]bool{"revoked": true})
}

// handleAccount 获取账户信息与配额
func (api *ServerAPI) handleAccount(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())

	var username string
	var quotaBytes, usedBytes int64
	err := api.db.QueryRow(`SELECT username, quota_bytes, used_bytes FROM users WHERE id = ?`, userID).Scan(&username, &quotaBytes, &usedBytes)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "查询账户失败")
		return
	}

	JSONSuccess(w, map[string]interface{}{
		"userId":     userID,
		"username":   username,
		"quotaBytes": quotaBytes,
		"usedBytes":  usedBytes,
	})
}

// handleUploadSnapshot 上传密文快照 (multipart/form-data)
func (api *ServerAPI) handleUploadSnapshot(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	deviceID := GetDeviceIDFromContext(r.Context())
	ip := GetClientIP(r)

	// 限制请求体上限
	cfg := api.getConfig()
	r.Body = http.MaxBytesReader(w, r.Body, cfg.MaxSnapshotBytes+1024*1024)
	if err := r.ParseMultipartForm(cfg.MaxSnapshotBytes + 1024*1024); err != nil {
		JSONError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "上传内容超过最大体积限制")
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	metaStr := r.FormValue("meta")
	if metaStr == "" {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "缺少元数据字段 (meta)")
		return
	}

	var clientMeta struct {
		SnapshotID        string `json:"snapshotId"`
		FormatVersion     int    `json:"formatVersion"`
		Size              int64  `json:"size"`
		SHA256            string `json:"sha256"`
		ConversationCount int    `json:"conversationCount"`
		EncManifest       string `json:"encManifest"` // Base64
	}
	if err := json.Unmarshal([]byte(metaStr), &clientMeta); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "元数据格式错误")
		return
	}

	if clientMeta.SnapshotID == "" {
		clientMeta.SnapshotID = uuid.NewString()
	} else if !snapshot.IsValidSnapshotID(clientMeta.SnapshotID) {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "快照 ID 格式不合法")
		return
	}

	manifestBytes, err := base64.StdEncoding.DecodeString(clientMeta.EncManifest)
	if err != nil {
		// 容错 hex
		manifestBytes, _ = hex.DecodeString(clientMeta.EncManifest)
	}

	file, fileHeader, err := r.FormFile("blob")
	if err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "缺少快照密文字段 (blob)")
		return
	}
	defer file.Close()

	if clientMeta.Size == 0 {
		clientMeta.Size = fileHeader.Size
	}

	meta := snapshot.SnapshotMeta{
		ID:                clientMeta.SnapshotID,
		FormatVersion:     clientMeta.FormatVersion,
		Size:              clientMeta.Size,
		SHA256Hex:         clientMeta.SHA256,
		ConversationCount: clientMeta.ConversationCount,
		EncManifest:       manifestBytes,
	}

	saved, err := api.snapMgr.SaveSnapshot(userID, deviceID, meta, file)
	if err != nil {
		if errors.Is(err, snapshot.ErrServerStorageFull) {
			audit.Log(api.db, userID, deviceID, "upload_fail", ip, "全服存储空间已达上限")
			JSONError(w, http.StatusInsufficientStorage, "SERVER_STORAGE_FULL", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrQuotaExceeded) {
			JSONError(w, http.StatusForbidden, "QUOTA_EXCEEDED", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrSnapshotLimit) {
			JSONError(w, http.StatusForbidden, "SNAPSHOT_LIMIT", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrSnapshotExists) {
			JSONError(w, http.StatusConflict, "SNAPSHOT_EXISTS", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrInvalidSnapshotID) {
			JSONError(w, http.StatusBadRequest, "INVALID_PARAM", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrHashMismatch) {
			JSONError(w, http.StatusBadRequest, "HASH_MISMATCH", err.Error())
			return
		}
		if errors.Is(err, snapshot.ErrPayloadTooLarge) {
			JSONError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", err.Error())
			return
		}
		JSONError(w, http.StatusInternalServerError, "INTERNAL", err.Error())
		return
	}

	audit.Log(api.db, userID, deviceID, "upload", ip, "成功上传快照: "+saved.ID)

	JSONSuccess(w, map[string]interface{}{
		"snapshotId": saved.ID,
		"createdAt":  saved.CreatedAt,
	})
}

// handleListSnapshots 分页获取快照列表
func (api *ServerAPI) handleListSnapshots(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())

	cursorStr := r.URL.Query().Get("cursor")
	var cursor int64 = 0
	if cursorStr != "" {
		cursor, _ = strconv.ParseInt(cursorStr, 10, 64)
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	list, nextCursor, err := api.snapMgr.ListSnapshots(userID, cursor, limit)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "获取快照列表失败")
		return
	}

	JSONSuccess(w, map[string]interface{}{
		"items":      list,
		"nextCursor": nextCursor,
	})
}

// handleDownloadSnapshot 下载密文二进制流
func (api *ServerAPI) handleDownloadSnapshot(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	snapshotID := r.PathValue("id")
	ip := GetClientIP(r)

	if !snapshot.IsValidSnapshotID(snapshotID) {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "快照 ID 格式不合法")
		return
	}

	file, _, err := api.snapMgr.OpenSnapshotFile(userID, snapshotID)
	if err != nil {
		if errors.Is(err, snapshot.ErrSnapshotNotFound) {
			JSONError(w, http.StatusNotFound, "NOT_FOUND", "快照不存在")
			return
		}
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "读取快照失败")
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	var modTime time.Time
	if err == nil {
		modTime = stat.ModTime()
	} else {
		modTime = time.Now()
	}

	// 告知客户端支持按字节范围请求 (RFC 7233 断点续传)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Type", "application/octet-stream")

	// 使用 http.ServeContent 替代 io.Copy：
	// 1. 若客户端携带 Range 请求头，自动返回 206 Partial Content 及对应分片与 Content-Range；
	// 2. 若无 Range，返回 200 OK 并流式传输全量内容；
	// 3. 边读边发，完全配合 WriteTimeout=0，杜绝慢速网络传输中断。
	http.ServeContent(w, r, snapshotID+".bin", modTime, file)
	audit.Log(api.db, userID, GetDeviceIDFromContext(r.Context()), "download", ip, "下载快照: "+snapshotID)
}

// handleDeleteSnapshot 删除快照
func (api *ServerAPI) handleDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	snapshotID := r.PathValue("id")
	ip := GetClientIP(r)

	if !snapshot.IsValidSnapshotID(snapshotID) {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "快照 ID 格式不合法")
		return
	}

	err := api.snapMgr.DeleteSnapshot(userID, snapshotID)
	if err != nil {
		if errors.Is(err, snapshot.ErrSnapshotNotFound) {
			JSONError(w, http.StatusNotFound, "NOT_FOUND", "快照不存在或已被删除")
			return
		}
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "删除快照失败")
		return
	}

	audit.Log(api.db, userID, GetDeviceIDFromContext(r.Context()), "delete", ip, "删除快照: "+snapshotID)
	JSONSuccess(w, map[string]bool{"deleted": true})
}

// handleBatchDeleteSnapshots 批量删除快照 (带密码哈希二次验密与防爆破锁定保护)
// — 为什么这么写 —
// 1. 批量清理快照属于高危不可逆操作，不仅消耗网络流量还直接物理销毁云端历史版本
// 2. 必须强制要求客户端提交主密码派生的 authHashHex，并在服务端重新计算 Argon2id 对比验证
// 3. 校验失败计入 failed_count，连续输错 3/5/10 次自动触发锁定期，防止恶意脚本撞库破解
// 4. 验证通过后在 SQLite 事务中完成原子扣减配额与物理删除，保证数据一致性
func (api *ServerAPI) handleBatchDeleteSnapshots(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	deviceID := GetDeviceIDFromContext(r.Context())
	ip := GetClientIP(r)

	var req struct {
		SnapshotIDs []string `json:"snapshotIds"`
		AuthHashHex string   `json:"authHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "请求数据解析错误")
		return
	}

	if len(req.SnapshotIDs) == 0 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "请至少选择一个要删除的快照")
		return
	}
	if len(req.SnapshotIDs) > 200 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "单次批量删除数量不能超过 200 个")
		return
	}

	req.AuthHashHex = strings.TrimSpace(req.AuthHashHex)
	if req.AuthHashHex == "" {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "请输入主密码进行安全验证")
		return
	}

	// 1. 查询当前用户的认证凭据与防撞库状态
	var storedHash, authSalt []byte
	var disabled, failedCount int
	var lockedUntil sql.NullInt64

	query := `SELECT auth_hash, auth_salt, disabled, failed_count, locked_until FROM users WHERE id = ?`
	err := api.db.QueryRow(query, userID).Scan(&storedHash, &authSalt, &disabled, &failedCount, &lockedUntil)
	if err != nil {
		JSONError(w, http.StatusUnauthorized, "AUTH_FAILED", "用户账户状态异常")
		return
	}

	if disabled == 1 {
		JSONError(w, http.StatusForbidden, "AUTH_FAILED", "账号已被停用")
		return
	}

	now := time.Now().Unix()
	if lockedUntil.Valid && lockedUntil.Int64 > now {
		remainingMin := (lockedUntil.Int64 - now + 59) / 60
		JSONError(w, http.StatusForbidden, "ACCOUNT_LOCKED", fmt.Sprintf("账号因连续输错密码已锁定，请 %d 分钟后再试", remainingMin))
		return
	}

	clientAuthHash, err := hex.DecodeString(req.AuthHashHex)
	if err != nil || len(clientAuthHash) == 0 {
		JSONError(w, http.StatusBadRequest, "INVALID_PARAM", "密码哈希格式错误")
		return
	}

	// 内存防爆保护：限制全服务并发 Argon2id 计算
	select {
	case api.argonSem <- struct{}{}:
		defer func() { <-api.argonSem }()
	default:
		w.Header().Set("Retry-After", "5")
		JSONError(w, http.StatusTooManyRequests, "BUSY", "系统哈希算力繁忙，请 5 秒后再试")
		return
	}

	// 2. 校验密码哈希
	computedHash := auth.HashAuthSecret(clientAuthHash, authSalt)
	if !auth.VerifyHash(storedHash, computedHash) {
		newFailed := failedCount + 1
		var lockTime interface{} = nil
		var errMsg string
		if newFailed >= 10 {
			lockTime = now + 3600
			errMsg = "密码连续输错 10 次，账号已锁定 60 分钟，请稍后再试"
		} else if newFailed >= 5 {
			lockTime = now + 900
			errMsg = "密码连续输错 5 次，账号已锁定 15 分钟，请稍后再试"
		} else if newFailed >= 3 {
			lockTime = now + 300
			errMsg = "密码连续输错 3 次，账号已锁定 5 分钟，请稍后再试"
		} else {
			remainingAttempts := 3 - newFailed
			errMsg = fmt.Sprintf("密码验证错误，还可尝试 %d 次", remainingAttempts)
		}
		_, _ = api.db.Exec(`UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?`, newFailed, lockTime, userID)
		audit.Log(api.db, userID, deviceID, "batch_delete_fail", ip, "批量删除快照时密码验证失败")
		JSONError(w, http.StatusUnauthorized, "AUTH_FAILED", errMsg)
		return
	}

	// 3. 密码验证通过，重置失败计数
	if failedCount > 0 {
		_, _ = api.db.Exec(`UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?`, userID)
	}

	// 4. 执行批量事务清理
	deletedCount, freedBytes, err := api.snapMgr.BatchDeleteSnapshots(userID, req.SnapshotIDs)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, "INTERNAL", "批量删除快照失败: "+err.Error())
		return
	}

	audit.Log(api.db, userID, deviceID, "batch_delete", ip, fmt.Sprintf("批量删除快照: 成功清理 %d 个快照，释放 %.2f MB 配额", deletedCount, float64(freedBytes)/(1024*1024)))

	JSONSuccess(w, map[string]interface{}{
		"deletedCount": deletedCount,
		"freedBytes":  freedBytes,
	})
}
