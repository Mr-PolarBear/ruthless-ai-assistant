package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

var (
	ErrInvalidCredentials = errors.New("用户名或密码错误")
	ErrAccountLocked      = errors.New("登录失败次数过多，账号已临时锁定")
	ErrAccountDisabled    = errors.New("账号已被停用")
	ErrInviteInvalid      = errors.New("邀请码无效或已过期")
	ErrUsernameTaken      = errors.New("用户名已被占用")
	ErrUnauthorized       = errors.New("未授权或令牌已失效")
)

// Argon2id 参数推荐设置 (OWASP 标准：t=3, m=64MB, p=2, keyLen=32)
const (
	ArgonTime    = 3
	ArgonMemory  = 64 * 1024
	ArgonThreads = 2
	ArgonKeyLen  = 32
)

// HashAuthSecret 使用 Argon2id 对客户端上传的 authHash 进行服务侧二次加盐哈希
func HashAuthSecret(authHash, salt []byte) []byte {
	return argon2.IDKey(authHash, salt, ArgonTime, ArgonMemory, ArgonThreads, ArgonKeyLen)
}

// GenerateRandomBytes 生成安全随机字节
func GenerateRandomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// HashToken 计算设备令牌的 SHA-256 哈希值
func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// GenerateDeviceToken 生成 32 字节高熵随机设备令牌（URL 安全 Base64）
func GenerateDeviceToken() (string, error) {
	b, err := GenerateRandomBytes(32)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// GeneratePseudoSalt 为未注册用户生成稳定伪 salt (基于 HMAC-SHA256)
func GeneratePseudoSalt(secret []byte, username string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte("pseudo-salt:" + username))
	sum := h.Sum(nil)
	return sum[:16]
}

// VerifyHash 安全比较两个哈希是否一致（防时序侧信道攻击）
func VerifyHash(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// SimpleRateLimiter 内存令牌桶限流器（按 IP 或 标识）
type SimpleRateLimiter struct {
	mu      sync.Mutex
	records map[string]*rateRecord
	limit   int
	window  time.Duration
}

type rateRecord struct {
	count     int
	resetTime time.Time
}

// NewRateLimiter 创建限流器
func NewRateLimiter(limit int, window time.Duration) *SimpleRateLimiter {
	limiter := &SimpleRateLimiter{
		records: make(map[string]*rateRecord),
		limit:   limit,
		window:  window,
	}

	// 定期清理过期记录防内存泄漏
	go func() {
		ticker := time.NewTicker(window * 2)
		for range ticker.C {
			limiter.mu.Lock()
			now := time.Now()
			for k, v := range limiter.records {
				if now.After(v.resetTime) {
					delete(limiter.records, k)
				}
			}
			limiter.mu.Unlock()
		}
	}()

	return limiter
}

// Allow 判断是否允许请求
func (rl *SimpleRateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	rec, exists := rl.records[key]
	if !exists || now.After(rec.resetTime) {
		rl.records[key] = &rateRecord{
			count:     1,
			resetTime: now.Add(rl.window),
		}
		return true
	}

	if rec.count >= rl.limit {
		return false
	}

	rec.count++
	return true
}

// UpdateConfig 动态更新限流阈值与时间窗口
func (rl *SimpleRateLimiter) UpdateConfig(limit int, window time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if limit > 0 {
		rl.limit = limit
	}
	if window > 0 {
		rl.window = window
	}
}

// GetRemainingCooldownSeconds 获取指定键名当前的剩余冷却秒数 (用于精确返回 Retry-After 标头)
func (rl *SimpleRateLimiter) GetRemainingCooldownSeconds(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if rec, exists := rl.records[key]; exists {
		rem := time.Until(rec.resetTime).Seconds()
		if rem > 0 {
			return int(rem) + 1
		}
	}
	return int(rl.window.Seconds())
}
