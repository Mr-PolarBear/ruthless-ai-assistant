package httpapi_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sync-server/internal/config"
	"sync-server/internal/httpapi"
	"sync-server/internal/snapshot"
	"sync-server/internal/store"
)

func setupTestServer(t *testing.T) (*httptest.Server, *store.DB, *config.Config, *snapshot.Manager, func()) {
	tempDir, err := os.MkdirTemp("", "sync-test-*")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}

	cfg := config.DefaultConfig()
	cfg.DataDir = tempDir
	cfg.ServerSecretFile = filepath.Join(tempDir, "server.secret")
	cfg.KdfMinIter = 1000 // 测试环境下调低以便快速跑通测试

	cfg, err = config.LoadConfig(filepath.Join(tempDir, "config.json"))
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	cfg.KdfMinIter = 1000

	db, err := store.OpenDB(tempDir)
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}

	snapMgr := snapshot.NewManager(db.DB, tempDir, cfg.MaxSnapshotBytes, cfg.MaxSnapshotsPerUser, cfg.MaxTotalStorageBytes)
	api := httpapi.NewServerAPI(cfg, db.DB, snapMgr)
	ts := httptest.NewServer(api.RegisterRoutes())

	cleanup := func() {
		ts.Close()
		db.Close()
		os.RemoveAll(tempDir)
	}

	return ts, db, cfg, snapMgr, cleanup
}

func createTestInvite(t *testing.T, db *store.DB, code string, days int) {
	codeHash := sha256.Sum256([]byte(code))
	now := time.Now().Unix()
	expiresAt := now + int64(days*86400)
	_, err := db.Exec(
		`INSERT INTO invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)`,
		codeHash[:], now, expiresAt,
	)
	if err != nil {
		t.Fatalf("创建测试邀请码失败: %v", err)
	}
}

// TestHealthCheck 测试健康检查
func TestHealthCheck(t *testing.T) {
	ts, _, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	resp, err := http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("状态码期望 200，实际: %d", resp.StatusCode)
	}
}

// TestPreloginPseudoSalt 测试未注册用户伪 salt 稳定一致
func TestPreloginPseudoSalt(t *testing.T) {
	ts, _, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	reqBody := `{"username":"non_exist_user"}`
	resp1, _ := http.Post(ts.URL+"/api/auth/prelogin", "application/json", strings.NewReader(reqBody))
	var res1 struct {
		OK   bool `json:"ok"`
		Data struct {
			KdfSalt string `json:"kdfSalt"`
		} `json:"data"`
	}
	json.NewDecoder(resp1.Body).Decode(&res1)

	resp2, _ := http.Post(ts.URL+"/api/auth/prelogin", "application/json", strings.NewReader(reqBody))
	var res2 struct {
		OK   bool `json:"ok"`
		Data struct {
			KdfSalt string `json:"kdfSalt"`
		} `json:"data"`
	}
	json.NewDecoder(resp2.Body).Decode(&res2)

	if !res1.OK || res1.Data.KdfSalt == "" {
		t.Errorf("prelogin 响应异常")
	}
	if res1.Data.KdfSalt != res2.Data.KdfSalt {
		t.Errorf("对相同未知用户返回的伪 salt 不一致: %s vs %s", res1.Data.KdfSalt, res2.Data.KdfSalt)
	}
}

// TestRegisterAndLoginFlow 测试注册、登录、邀请码一次性、连续失败锁定的完整流程
func TestRegisterAndLoginFlow(t *testing.T) {
	ts, db, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	inviteCode := "test_invite_123456"
	createTestInvite(t, db, inviteCode, 7)

	kdfSalt := hex.EncodeToString([]byte("0123456789abcdef"))
	authHash := hex.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

	// 1. 正常注册
	regPayload := map[string]interface{}{
		"inviteCode": inviteCode,
		"username":   "testuser",
		"kdfSalt":    kdfSalt,
		"kdfIter":    1000,
		"authHash":   authHash,
		"deviceName": "单元测试机器",
	}
	regBytes, _ := json.Marshal(regPayload)
	resp, err := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regBytes))
	if err != nil {
		t.Fatalf("注册请求失败: %v", err)
	}
	var regRes struct {
		OK   bool `json:"ok"`
		Data struct {
			UserID   string `json:"userId"`
			DeviceID string `json:"deviceId"`
			Token    string `json:"token"`
		} `json:"data"`
		Code string `json:"code"`
	}
	json.NewDecoder(resp.Body).Decode(&regRes)
	if !regRes.OK || regRes.Data.Token == "" {
		t.Fatalf("注册未能成功: %+v", regRes)
	}

	// 2. 再次使用相同邀请码注册应被拒绝
	regPayload2 := map[string]interface{}{
		"inviteCode": inviteCode,
		"username":   "another_user",
		"kdfSalt":    kdfSalt,
		"kdfIter":    1000,
		"authHash":   authHash,
		"deviceName": "单元测试机器2",
	}
	regBytes2, _ := json.Marshal(regPayload2)
	resp2, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regBytes2))
	var regRes2 struct {
		OK   bool   `json:"ok"`
		Code string `json:"code"`
	}
	json.NewDecoder(resp2.Body).Decode(&regRes2)
	if regRes2.OK || regRes2.Code != "INVITE_INVALID" {
		t.Errorf("已被使用的邀请码未被拦截: %+v", regRes2)
	}

	// 3. 正常登录
	loginPayload := map[string]interface{}{
		"username":   "testuser",
		"authHash":   authHash,
		"deviceName": "新登录设备",
	}
	loginBytes, _ := json.Marshal(loginPayload)
	respLogin, _ := http.Post(ts.URL+"/api/auth/login", "application/json", bytes.NewReader(loginBytes))
	var loginRes struct {
		OK   bool `json:"ok"`
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(respLogin.Body).Decode(&loginRes)
	if !loginRes.OK || loginRes.Data.Token == "" {
		t.Fatalf("正常登录失败: %+v", loginRes)
	}

	// 4. 密码错误 5 次锁定
	wrongLoginPayload := map[string]interface{}{
		"username":   "testuser",
		"authHash":   hex.EncodeToString([]byte("wrong_hash_wrong_hash_wrong_hash")),
		"deviceName": "攻击设备",
	}
	wrongBytes, _ := json.Marshal(wrongLoginPayload)

	for i := 0; i < 5; i++ {
		respWrong, _ := http.Post(ts.URL+"/api/auth/login", "application/json", bytes.NewReader(wrongBytes))
		var wRes struct {
			OK   bool   `json:"ok"`
			Code string `json:"code"`
		}
		json.NewDecoder(respWrong.Body).Decode(&wRes)
		if i == 4 {
			// 第 5 次触发锁定
			var lockedUntil int64
			_ = db.QueryRow(`SELECT locked_until FROM users WHERE username = 'testuser'`).Scan(&lockedUntil)
			if lockedUntil <= time.Now().Unix() {
				t.Errorf("连续 5 次输错密码未触发账号锁定！")
			}
		}
	}
}

// TestSnapshotUploadDownloadDelete 测试快照上传、下载、防越权及配额扣还
func TestSnapshotUploadDownloadDelete(t *testing.T) {
	ts, db, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	// 准备用户 A 和 用户 B
	createTestInvite(t, db, "inv_A", 1)
	createTestInvite(t, db, "inv_B", 1)

	kdfSalt := hex.EncodeToString([]byte("0123456789abcdef"))
	authHash := hex.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

	// 注册用户 A
	regA, _ := json.Marshal(map[string]interface{}{
		"inviteCode": "inv_A", "username": "user_a", "kdfSalt": kdfSalt, "kdfIter": 1000, "authHash": authHash, "deviceName": "DevA",
	})
	respA, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regA))
	var resA struct {
		Data struct {
			UserID string `json:"userId"`
			Token  string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(respA.Body).Decode(&resA)

	// 注册用户 B
	regB, _ := json.Marshal(map[string]interface{}{
		"inviteCode": "inv_B", "username": "user_b", "kdfSalt": kdfSalt, "kdfIter": 1000, "authHash": authHash, "deviceName": "DevB",
	})
	respB, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regB))
	var resB struct {
		Data struct {
			UserID string `json:"userId"`
			Token  string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(respB.Body).Decode(&resB)

	// 1. 用户 A 上传快照
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fakeCiphertext := []byte("RSYN\x010123456789ABthis_is_encrypted_data_blob")
	h := sha256.Sum256(fakeCiphertext)
	metaJSON, _ := json.Marshal(map[string]interface{}{
		"snapshotId":    "snap_001",
		"formatVersion": 1,
		"size":          len(fakeCiphertext),
		"sha256":        fmt.Sprintf("%x", h),
		"encManifest":   "bWFuaWZlc3RfZGF0YQ==",
	})
	_ = writer.WriteField("meta", string(metaJSON))

	part, _ := writer.CreateFormFile("blob", "snap.bin")
	_, _ = part.Write(fakeCiphertext)
	writer.Close()

	reqUpload, _ := http.NewRequest("POST", ts.URL+"/api/snapshots", body)
	reqUpload.Header.Set("Content-Type", writer.FormDataContentType())
	reqUpload.Header.Set("Authorization", "Bearer "+resA.Data.Token)

	client := &http.Client{}
	respUpload, err := client.Do(reqUpload)
	if err != nil {
		t.Fatalf("上传请求失败: %v", err)
	}
	if respUpload.StatusCode != http.StatusOK {
		t.Fatalf("上传状态码非 200: %d", respUpload.StatusCode)
	}

	// 检查用户 A 的 used_bytes 是否增加
	var usedBytes int64
	_ = db.QueryRow(`SELECT used_bytes FROM users WHERE id = ?`, resA.Data.UserID).Scan(&usedBytes)
	if usedBytes != int64(len(fakeCiphertext)) {
		t.Errorf("配额未正确增加: %d vs %d", usedBytes, len(fakeCiphertext))
	}

	// 2. 越权测试：用户 B 尝试下载用户 A 的快照，应返回 404
	reqCross, _ := http.NewRequest("GET", ts.URL+"/api/snapshots/snap_001", nil)
	reqCross.Header.Set("Authorization", "Bearer "+resB.Data.Token)
	respCross, _ := client.Do(reqCross)
	if respCross.StatusCode != http.StatusNotFound {
		t.Errorf("用户 B 越权下载用户 A 快照未被隔离拦截，状态码: %d", respCross.StatusCode)
	}

	// 3. 用户 A 正常下载并校验内容完整
	reqDown, _ := http.NewRequest("GET", ts.URL+"/api/snapshots/snap_001", nil)
	reqDown.Header.Set("Authorization", "Bearer "+resA.Data.Token)
	respDown, _ := client.Do(reqDown)
	if respDown.StatusCode != http.StatusOK {
		t.Errorf("用户 A 下载快照失败: %d", respDown.StatusCode)
	}
	downBytes, _ := io.ReadAll(respDown.Body)
	if !bytes.Equal(downBytes, fakeCiphertext) {
		t.Errorf("下载的快照二进制内容不一致！")
	}

	// 3.1 验证 RFC 7233 Range 范围分片与 206 断点续传
	reqRange, _ := http.NewRequest("GET", ts.URL+"/api/snapshots/snap_001", nil)
	reqRange.Header.Set("Authorization", "Bearer "+resA.Data.Token)
	reqRange.Header.Set("Range", "bytes=0-3")
	respRange, _ := client.Do(reqRange)
	if respRange.StatusCode != http.StatusPartialContent {
		t.Errorf("Range 请求未返回 206 Partial Content，实际状态码: %d", respRange.StatusCode)
	}
	rangeBytes, _ := io.ReadAll(respRange.Body)
	if !bytes.Equal(rangeBytes, fakeCiphertext[:4]) {
		t.Errorf("Range 分片内容不一致: 期望 %v, 实际 %v", fakeCiphertext[:4], rangeBytes)
	}
	if respRange.Header.Get("Accept-Ranges") != "bytes" {
		t.Errorf("缺少 Accept-Ranges: bytes 响应头")
	}

	// 4. 用户 A 删除快照，检查配额扣回
	reqDel, _ := http.NewRequest("DELETE", ts.URL+"/api/snapshots/snap_001", nil)
	reqDel.Header.Set("Authorization", "Bearer "+resA.Data.Token)
	respDel, _ := client.Do(reqDel)
	if respDel.StatusCode != http.StatusOK {
		t.Errorf("删除快照失败: %d", respDel.StatusCode)
	}

	_ = db.QueryRow(`SELECT used_bytes FROM users WHERE id = ?`, resA.Data.UserID).Scan(&usedBytes)
	if usedBytes != 0 {
		t.Errorf("删除快照后配额未正确归零: %d", usedBytes)
	}
}


func TestDynamicCORSAndRateLimitHotReload(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "hot-reload-api-test-*")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfgPath := filepath.Join(tempDir, "config.json")
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	cfg.DataDir = tempDir
	cfg.RateLimit.RequestsPerMinute = 3
	cfg.RateLimit.CooldownSeconds = 5

	db, err := store.OpenDB(tempDir)
	if err != nil {
		t.Fatalf("创建数据库失败: %v", err)
	}
	defer db.Close()

	snapMgr := snapshot.NewManager(db.DB, tempDir, cfg.MaxSnapshotBytes, cfg.MaxSnapshotsPerUser, cfg.MaxTotalStorageBytes)
	api := httpapi.NewServerAPI(cfg, db.DB, snapMgr)

	watcher := config.NewConfigWatcher(cfgPath, cfg)
	api.AttachWatcher(watcher)

	ts := httptest.NewServer(api.RegisterRoutes())
	defer ts.Close()

	client := &http.Client{}

	// 1. 验证默认通配反射 Origin
	req1, _ := http.NewRequest("GET", ts.URL+"/api/health", nil)
	req1.Header.Set("Origin", "http://untrusted-attacker.com")
	resp1, err := client.Do(req1)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	if resp1.Header.Get("Access-Control-Allow-Origin") != "http://untrusted-attacker.com" {
		t.Errorf("期望默认通配反射 Origin, 实际: %s", resp1.Header.Get("Access-Control-Allow-Origin"))
	}

	// 2. 模拟配置热重载：将 CORS 白名单限定为 https://my-trusted-site.com
	time.Sleep(100 * time.Millisecond)
	cfg.AllowedOrigins = []string{"https://my-trusted-site.com"}
	cfg.RateLimit.RequestsPerMinute = 2 // 将限流调紧为 2 次/分
	cfg.RateLimit.CooldownSeconds = 10
	if err := config.SaveConfig(cfgPath, cfg); err != nil {
		t.Fatalf("保存配置失败: %v", err)
	}
	if !watcher.CheckReload() {
		t.Fatalf("期望 CheckReload 成功热重载")
	}

	// 3. 验证非白名单域名被拦截（不返回 Access-Control-Allow-Origin）
	req2, _ := http.NewRequest("GET", ts.URL+"/api/health", nil)
	req2.Header.Set("Origin", "http://untrusted-attacker.com")
	resp2, _ := client.Do(req2)
	if resp2.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("非白名单域名期望不返回 Access-Control-Allow-Origin，实际返回了: %s", resp2.Header.Get("Access-Control-Allow-Origin"))
	}

	// 4. 验证白名单域名正常放行
	req3, _ := http.NewRequest("GET", ts.URL+"/api/health", nil)
	req3.Header.Set("Origin", "https://my-trusted-site.com")
	resp3, _ := client.Do(req3)
	if resp3.Header.Get("Access-Control-Allow-Origin") != "https://my-trusted-site.com" {
		t.Errorf("白名单域名未放行: %s", resp3.Header.Get("Access-Control-Allow-Origin"))
	}

	// 5. 验证后端熔断限流：前面已请求 3 次，超过了热重载后的 2 次/分上限
	// 下一次请求应立即触发 429 熔断，并携带 Retry-After 标头
	req4, _ := http.NewRequest("GET", ts.URL+"/api/health", nil)
	resp4, _ := client.Do(req4)
	if resp4.StatusCode != http.StatusTooManyRequests {
		t.Errorf("超过限流阈值期望返回 429, 实际状态码: %d", resp4.StatusCode)
	}
	if retryAfter := resp4.Header.Get("Retry-After"); retryAfter == "" {
		t.Errorf("429 响应应包含 Retry-After 标头")
	}
}

// TestServerStorageLimitEnforcement 测试全服总快照存储空间上限熔断与热重载放行
func TestServerStorageLimitEnforcement(t *testing.T) {
	ts, db, cfg, snapMgr, cleanup := setupTestServer(t)
	defer cleanup()

	// 注册用户 A 和用户 B
	createTestInvite(t, db, "inv_storage_A", 1)
	createTestInvite(t, db, "inv_storage_B", 1)

	kdfSalt := hex.EncodeToString([]byte("0123456789abcdef"))
	authHash := hex.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

	regA, _ := json.Marshal(map[string]interface{}{
		"inviteCode": "inv_storage_A", "username": "user_limit_a", "kdfSalt": kdfSalt, "kdfIter": 1000, "authHash": authHash, "deviceName": "DevA",
	})
	respA, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regA))
	var resA struct {
		Data struct {
			UserID string `json:"userId"`
			Token  string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(respA.Body).Decode(&resA)

	regB, _ := json.Marshal(map[string]interface{}{
		"inviteCode": "inv_storage_B", "username": "user_limit_b", "kdfSalt": kdfSalt, "kdfIter": 1000, "authHash": authHash, "deviceName": "DevB",
	})
	respB, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regB))
	var resB struct {
		Data struct {
			UserID string `json:"userId"`
			Token  string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(respB.Body).Decode(&resB)

	// 辅助上传函数
	uploadSnap := func(token, snapID string, data []byte) (int, string, string) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		h := sha256.Sum256(data)
		metaJSON, _ := json.Marshal(map[string]interface{}{
			"snapshotId":    snapID,
			"formatVersion": 1,
			"size":          len(data),
			"sha256":        fmt.Sprintf("%x", h),
			"encManifest":   "bWFuaWZlc3Q=",
		})
		_ = writer.WriteField("meta", string(metaJSON))
		part, _ := writer.CreateFormFile("blob", "snap.bin")
		_, _ = part.Write(data)
		writer.Close()

		req, _ := http.NewRequest("POST", ts.URL+"/api/snapshots", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := (&http.Client{}).Do(req)
		if err != nil {
			t.Fatalf("上传请求发生网络错误: %v", err)
		}
		defer resp.Body.Close()

		var res struct {
			OK      bool   `json:"ok"`
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		json.NewDecoder(resp.Body).Decode(&res)
		return resp.StatusCode, res.Code, res.Message
	}

	// 1. 设置全服总限制为 100 字节，用户单配额仍为 200MB
	cfg.MaxTotalStorageBytes = 100
	snapMgr.UpdateLimits(cfg.MaxSnapshotBytes, cfg.MaxSnapshotsPerUser, 100)

	// 用户 A 上传 60 字节快照 -> 成功 (全服累计 60 字节 <= 100)
	payload60 := bytes.Repeat([]byte("A"), 60)
	status, code, _ := uploadSnap(resA.Data.Token, "snap_user_a_1", payload60)
	if status != http.StatusOK {
		t.Fatalf("用户 A 首次上传期望 200，实际: %d (code=%s)", status, code)
	}

	// 2. 用户 B 上传 50 字节快照 -> 应被全服总配额拒绝 (60 + 50 = 110 > 100)
	payload50 := bytes.Repeat([]byte("B"), 50)
	status, code, msg := uploadSnap(resB.Data.Token, "snap_user_b_1", payload50)
	if status != http.StatusInsufficientStorage {
		t.Errorf("全服总容量超出时期望返回 507 Insufficient Storage，实际状态码: %d (code=%s)", status, code)
	}
	if code != "SERVER_STORAGE_FULL" {
		t.Errorf("期望错误码 SERVER_STORAGE_FULL，实际: %s (msg=%s)", code, msg)
	}

	// 3. 用户 A 删除其 60 字节快照 -> 全服总占用回落为 0
	reqDel, _ := http.NewRequest("DELETE", ts.URL+"/api/snapshots/snap_user_a_1", nil)
	reqDel.Header.Set("Authorization", "Bearer "+resA.Data.Token)
	respDel, err := (&http.Client{}).Do(reqDel)
	if err != nil || respDel.StatusCode != http.StatusOK {
		t.Fatalf("删除快照失败: %v, status=%d", err, respDel.StatusCode)
	}

	// 4. 用户 B 再次上传 50 字节快照 -> 此时全服剩余空间充裕，应立即成功！
	status, code, _ = uploadSnap(resB.Data.Token, "snap_user_b_1", payload50)
	if status != http.StatusOK {
		t.Errorf("删除快照释放全服空间后重新上传期望 200，实际: %d (code=%s)", status, code)
	}
}

// TestAPISnapshotIDValidationAndDuplicateRejection 测试 API 层的快照 ID 安全校验与重复 ID 拦截
func TestAPISnapshotIDValidationAndDuplicateRejection(t *testing.T) {
	ts, db, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	createTestInvite(t, db, "inv_api_sec", 1)
	kdfSalt := hex.EncodeToString([]byte("0123456789abcdef"))
	authHash := hex.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

	reg, _ := json.Marshal(map[string]interface{}{
		"inviteCode": "inv_api_sec", "username": "user_api_sec", "kdfSalt": kdfSalt, "kdfIter": 1000, "authHash": authHash, "deviceName": "DevSec",
	})
	resp, _ := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(reg))
	var res struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	token := res.Data.Token

	uploadSnap := func(snapID string, data []byte) (int, string) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		h := sha256.Sum256(data)
		metaJSON, _ := json.Marshal(map[string]interface{}{
			"snapshotId":    snapID,
			"formatVersion": 1,
			"size":          len(data),
			"sha256":        fmt.Sprintf("%x", h),
			"encManifest":   "bWFuaWZlc3Q=",
		})
		_ = writer.WriteField("meta", string(metaJSON))
		part, _ := writer.CreateFormFile("blob", "snap.bin")
		_, _ = part.Write(data)
		writer.Close()

		req, _ := http.NewRequest("POST", ts.URL+"/api/snapshots", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)

		r, err := (&http.Client{}).Do(req)
		if err != nil {
			t.Fatalf("上传网络异常: %v", err)
		}
		defer r.Body.Close()

		var respData struct {
			Code string `json:"code"`
		}
		json.NewDecoder(r.Body).Decode(&respData)
		return r.StatusCode, respData.Code
	}

	// 1. 尝试使用路径穿越 ID 上传
	status, code := uploadSnap("../../bad_id", []byte("bad_data"))
	if status != http.StatusBadRequest || code != "INVALID_PARAM" {
		t.Errorf("路径穿越 ID 期望 400 INVALID_PARAM, 实际: %d, %s", status, code)
	}

	// 2. 正常上传合法快照
	status, code = uploadSnap("snap_good_001", []byte("valid_content"))
	if status != http.StatusOK {
		t.Fatalf("合法快照上传期望 200, 实际: %d, %s", status, code)
	}

	// 3. 再次上传相同 ID -> 期望 409 SNAPSHOT_EXISTS
	status, code = uploadSnap("snap_good_001", []byte("duplicate_content"))
	if status != http.StatusConflict || code != "SNAPSHOT_EXISTS" {
		t.Errorf("重复快照 ID 期望 409 SNAPSHOT_EXISTS, 实际: %d, %s", status, code)
	}

	// 4. 使用非法 ID 请求下载
	reqDown, _ := http.NewRequest("GET", ts.URL+"/api/snapshots/..%2F..%2Fbad", nil)
	reqDown.Header.Set("Authorization", "Bearer "+token)
	respDown, _ := (&http.Client{}).Do(reqDown)
	if respDown.StatusCode != http.StatusBadRequest {
		t.Errorf("非法快照 ID 下载期望 400, 实际: %d", respDown.StatusCode)
	}

	// 5. 使用非法 ID 请求删除
	reqDel, _ := http.NewRequest("DELETE", ts.URL+"/api/snapshots/..%2F..%2Fbad", nil)
	reqDel.Header.Set("Authorization", "Bearer "+token)
	respDel, _ := (&http.Client{}).Do(reqDel)
	if respDel.StatusCode != http.StatusBadRequest {
		t.Errorf("非法快照 ID 删除期望 400, 实际: %d", respDel.StatusCode)
	}
}

// TestAIRelay_Endpoints 测试 AI 接口中转完整 HTTP 路由生命周期
func TestAIRelay_Endpoints(t *testing.T) {
	// 启动 mock 上游 AI 服务器
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"id": "chatcmpl-mock",
			"object": "chat.completion",
			"choices": [{"index":0,"message":{"role":"assistant","content":"中转成功响应！"},"finish_reason":"stop"}]
		}`))
	}))
	defer upstream.Close()

	ts, _, cfg, _, cleanup := setupTestServer(t)
	defer cleanup()

	// 1. 验证默认未开启时返回 403
	submitURL := ts.URL + "/v1/openai/tasks"
	reqBody := `{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}]}`
	resp1, err := http.Post(submitURL, "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	if resp1.StatusCode != http.StatusForbidden {
		t.Errorf("未开启时期望 403, 实际: %d", resp1.StatusCode)
	}
	resp1.Body.Close()

	// 2. 动态开启 AI 中转
	cfg.AIRelay.Enabled = true
	cfg.AIRelay.DefaultUpstream = upstream.URL
	cfg.AIRelay.ForceNonStream = true

	// 3. 测试 CORS OPTIONS 预检请求包含中转请求头
	client := &http.Client{}
	optionsReq, _ := http.NewRequest(http.MethodOptions, submitURL, nil)
	optionsReq.Header.Set("Origin", "http://localhost:3000")
	optionsResp, err := client.Do(optionsReq)
	if err != nil {
		t.Fatalf("OPTIONS 预检失败: %v", err)
	}
	optionsResp.Body.Close()
	allowHeaders := optionsResp.Header.Get("Access-Control-Allow-Headers")
	if !strings.Contains(allowHeaders, "X-Target-Url") || !strings.Contains(allowHeaders, "X-Upstream-Url") {
		t.Errorf("CORS Allow-Headers 未包含中转请求头: %s", allowHeaders)
	}

	// 4. 提交任务
	submitReq, _ := http.NewRequest(http.MethodPost, submitURL, strings.NewReader(reqBody))
	submitReq.Header.Set("Content-Type", "application/json")
	submitReq.Header.Set("Authorization", "Bearer mock-cat-key")
	submitReq.Header.Set("X-Target-Url", upstream.URL)

	submitResp, err := client.Do(submitReq)
	if err != nil {
		t.Fatalf("提交任务请求失败: %v", err)
	}
	defer submitResp.Body.Close()

	if submitResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(submitResp.Body)
		t.Fatalf("提交任务期望 200, 实际: %d, body: %s", submitResp.StatusCode, string(body))
	}

	var submitData struct {
		ID     string `json:"id"`
		TaskID string `json:"task_id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(submitResp.Body).Decode(&submitData); err != nil {
		t.Fatalf("解析提交响应失败: %v", err)
	}
	if submitData.ID == "" || submitData.TaskID == "" {
		t.Fatalf("期望获得 id 与 task_id，实际: id=%s, task_id=%s", submitData.ID, submitData.TaskID)
	}

	// 5. 轮询获取任务结果
	getURL := ts.URL + "/v1/openai/tasks/" + submitData.ID
	var taskStatus struct {
		ID     string          `json:"id"`
		TaskID string          `json:"task_id"`
		Status string          `json:"status"`
		Done   bool            `json:"done"`
		Result json.RawMessage `json:"result"`
	}

	for i := 0; i < 30; i++ {
		time.Sleep(30 * time.Millisecond)
		getResp, err := http.Get(getURL)
		if err != nil {
			t.Fatalf("轮询失败: %v", err)
		}
		_ = json.NewDecoder(getResp.Body).Decode(&taskStatus)
		getResp.Body.Close()
		if taskStatus.Done {
			break
		}
	}

	if !taskStatus.Done || taskStatus.Status != "completed" {
		t.Fatalf("期望任务完成, 实际: status=%s, done=%v", taskStatus.Status, taskStatus.Done)
	}
	if !strings.Contains(string(taskStatus.Result), "中转成功响应！") {
		t.Fatalf("返回结果未包含预期内容: %s", string(taskStatus.Result))
	}
	if taskStatus.TaskID != submitData.ID {
		t.Errorf("状态返回缺少对齐的 task_id 字段: %s", taskStatus.TaskID)
	}

	// 6. 验证任务列表 GET /v1/openai/tasks
	listResp, err := http.Get(ts.URL + "/v1/openai/tasks?limit=10")
	if err != nil {
		t.Fatalf("获取列表失败: %v", err)
	}
	var listData struct {
		Total int `json:"total"`
	}
	_ = json.NewDecoder(listResp.Body).Decode(&listData)
	listResp.Body.Close()
	if listData.Total < 1 {
		t.Errorf("期望列表中至少有 1 条任务, 实际: %d", listData.Total)
	}

	// 7. 测试删除任务 DELETE /v1/openai/tasks/{id}
	delReq, _ := http.NewRequest(http.MethodDelete, getURL, nil)
	delResp, err := client.Do(delReq)
	if err != nil {
		t.Fatalf("删除任务失败: %v", err)
	}
	delResp.Body.Close()
	if delResp.StatusCode != http.StatusOK {
		t.Errorf("删除任务期望 200, 实际: %d", delResp.StatusCode)
	}

	// 8. 再次查询应返回 404
	afterDelResp, _ := http.Get(getURL)
	defer afterDelResp.Body.Close()
	if afterDelResp.StatusCode != http.StatusNotFound {
		t.Errorf("已删除任务期望 404, 实际: %d", afterDelResp.StatusCode)
	}

	// 9. 测试直接端到端代理 /v1/chat/completions (非流式)
	chatReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/v1/chat/completions", strings.NewReader(`{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}]}`))
	chatReq.Header.Set("Content-Type", "application/json")
	chatReq.Header.Set("Authorization", "Bearer direct-mock-key")
	chatResp, err := client.Do(chatReq)
	if err != nil {
		t.Fatalf("直连 /v1/chat/completions 失败: %v", err)
	}
	chatBody, _ := io.ReadAll(chatResp.Body)
	chatResp.Body.Close()
	if chatResp.StatusCode != http.StatusOK {
		t.Fatalf("直连 /v1/chat/completions 期望 200, 实际: %d, body: %s", chatResp.StatusCode, string(chatBody))
	}
	if !strings.Contains(string(chatBody), "中转成功响应！") {
		t.Fatalf("直连响应未包含预期内容: %s", string(chatBody))
	}

	// 10. 测试直接端到端代理 /v1/chat/completions (流式 SSE)
	streamChatReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/v1/chat/completions", strings.NewReader(`{"model":"deepseek-chat","stream":true,"messages":[{"role":"user","content":"hello"}]}`))
	streamChatReq.Header.Set("Content-Type", "application/json")
	streamChatReq.Header.Set("Authorization", "Bearer direct-mock-key")
	streamChatResp, err := client.Do(streamChatReq)
	if err != nil {
		t.Fatalf("直连流式 /v1/chat/completions 失败: %v", err)
	}
	streamBody, _ := io.ReadAll(streamChatResp.Body)
	streamChatResp.Body.Close()
	if streamChatResp.StatusCode != http.StatusOK {
		t.Fatalf("直连流式 /v1/chat/completions 期望 200, 实际: %d, body: %s", streamChatResp.StatusCode, string(streamBody))
	}
	if !strings.Contains(streamChatResp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("直连流式期望 text/event-stream, 实际: %s", streamChatResp.Header.Get("Content-Type"))
	}
	if !strings.Contains(string(streamBody), "[DONE]") || !strings.Contains(string(streamBody), "中转成功响应！") {
		t.Fatalf("直连流式返回未包含预期分片或 [DONE]: %s", string(streamBody))
	}
}

// TestBatchDeleteSnapshots_API 测试批量删除快照接口（密码验证与原子扣减）
func TestBatchDeleteSnapshots_API(t *testing.T) {
	ts, db, _, _, cleanup := setupTestServer(t)
	defer cleanup()

	// 1. 注册测试用户
	inviteCode := "inv_batch_del_01"
	createTestInvite(t, db, inviteCode, 7)

	kdfSalt := hex.EncodeToString([]byte("1234567890123456"))
	validAuthHash := hex.EncodeToString([]byte("correct_auth_hash_01234567890123"))

	regBody, _ := json.Marshal(map[string]interface{}{
		"inviteCode": inviteCode,
		"username":   "batch_del_user",
		"kdfSalt":    kdfSalt,
		"kdfIter":    1000,
		"authHash":   validAuthHash,
		"deviceName": "PC",
	})
	resp, err := http.Post(ts.URL+"/api/auth/register", "application/json", bytes.NewReader(regBody))
	if err != nil {
		t.Fatalf("注册失败: %v", err)
	}
	defer resp.Body.Close()

	var regRes struct {
		Code int `json:"code"`
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&regRes)
	token := regRes.Data.Token

	// 2. 上传两份快照
	uploadSnapshot := func(snapID string, content []byte) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		h := sha256.Sum256(content)
		metaJSON, _ := json.Marshal(map[string]interface{}{
			"snapshotId":    snapID,
			"formatVersion": 1,
			"size":          len(content),
			"sha256":        fmt.Sprintf("%x", h),
			"encManifest":   "bWFuaWZlc3Q=",
		})
		_ = writer.WriteField("meta", string(metaJSON))
		part, _ := writer.CreateFormFile("blob", "snap.bin")
		_, _ = part.Write(content)
		writer.Close()

		req, _ := http.NewRequest("POST", ts.URL+"/api/snapshots", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		upResp, err := (&http.Client{}).Do(req)
		if err != nil || upResp.StatusCode != http.StatusOK {
			t.Fatalf("上传快照失败: %v, status: %v", err, upResp.StatusCode)
		}
		upResp.Body.Close()
	}

	uploadSnapshot("snap_del_1", []byte("1234567890"))
	uploadSnapshot("snap_del_2", []byte("abcdefghij"))

	// 3. 密码错误测试：提交错误的 authHash
	badReqBody, _ := json.Marshal(map[string]interface{}{
		"snapshotIds": []string{"snap_del_1", "snap_del_2"},
		"authHash":    hex.EncodeToString([]byte("wrong_auth_hash_000000000000000")),
	})
	req, _ := http.NewRequest("POST", ts.URL+"/api/snapshots/batch-delete", bytes.NewReader(badReqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	badResp, err := (&http.Client{}).Do(req)
	if err != nil {
		t.Fatalf("请求批量删除失败: %v", err)
	}
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("密码错误期望返回 401, 实际: %d", badResp.StatusCode)
	}
	badResp.Body.Close()

	// 4. 密码正确测试：提交正确的 authHash
	goodReqBody, _ := json.Marshal(map[string]interface{}{
		"snapshotIds": []string{"snap_del_1", "snap_del_2"},
		"authHash":    validAuthHash,
	})
	goodReq, _ := http.NewRequest("POST", ts.URL+"/api/snapshots/batch-delete", bytes.NewReader(goodReqBody))
	goodReq.Header.Set("Content-Type", "application/json")
	goodReq.Header.Set("Authorization", "Bearer "+token)
	goodResp, err := (&http.Client{}).Do(goodReq)
	if err != nil {
		t.Fatalf("批量删除请求失败: %v", err)
	}
	defer goodResp.Body.Close()

	if goodResp.StatusCode != http.StatusOK {
		t.Fatalf("期望批量删除返回 200, 实际: %d", goodResp.StatusCode)
	}

	var delRes struct {
		Code int `json:"code"`
		Data struct {
			DeletedCount int   `json:"deletedCount"`
			FreedBytes   int64 `json:"freedBytes"`
		} `json:"data"`
	}
	_ = json.NewDecoder(goodResp.Body).Decode(&delRes)
	if delRes.Data.DeletedCount != 2 {
		t.Errorf("期望删除 2 个快照, 实际 %d", delRes.Data.DeletedCount)
	}
	if delRes.Data.FreedBytes != 20 {
		t.Errorf("期望释放 20 字节, 实际 %d", delRes.Data.FreedBytes)
	}
}
