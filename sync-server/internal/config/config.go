package config

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TLSConfig TLS 证书配置
type TLSConfig struct {
	Enabled  bool   `json:"enabled"`
	CertFile string `json:"certFile"`
	KeyFile  string `json:"keyFile"`
}

// RateLimitConfig 单 IP 限流与熔断冷却配置
type RateLimitConfig struct {
	RequestsPerMinute int `json:"requestsPerMinute"` // 单 IP 允许的每分钟最高请求次数 (默认 60)
	CooldownSeconds   int `json:"cooldownSeconds"`   // 超过限流阈值后的熔断静默冷却时间 (秒, 默认 60)
}

// AIRelayConfig AI 接口中转与后台任务配置
type AIRelayConfig struct {
	Enabled         bool   `json:"enabled"`                   // 是否开启 AI 接口中转 (默认 false，按需开启)
	DefaultUpstream string `json:"defaultUpstream"`           // 默认上游 Base URL (如 "https://api.openai.com/v1")
	DefaultApiKey   string `json:"defaultApiKey,omitempty"`   // 默认上游 API Key (可选，客户端未在请求头传 Authorization 或 X-Api-Key 时使用)
	MaxTasks        int    `json:"maxTasks"`                  // 最多保存的任务记录数 (默认 500)
	TTLHours        int    `json:"ttlHours"`                  // 任务数据保存时长 (小时, 默认 24)
	ForceNonStream  bool   `json:"forceNonStream"`            // 是否强制/默认非流式转向上游 (默认 true)
	TimeoutMinutes  int    `json:"timeoutMinutes"`            // 单任务后台上游最长执行等待时间 (分钟, 默认 30)
}

// Config 全局服务端配置
type Config struct {
	Listen              string          `json:"listen"`
	TLS                 TLSConfig       `json:"tls"`
	DataDir             string          `json:"dataDir"`
	AllowedOrigins      []string        `json:"allowedOrigins"`
	RateLimit           RateLimitConfig `json:"rateLimit"`
	AIRelay             AIRelayConfig   `json:"aiRelay"`
	MaxSnapshotBytes     int64           `json:"maxSnapshotBytes"`
	MaxTotalStorageBytes int64           `json:"maxTotalStorageBytes"` // 全服最大总存储空间上限 (字节, 默认 1GB / 1073741824, <=0 表示不限制)
	DefaultQuotaBytes    int64           `json:"defaultQuotaBytes"`
	MaxSnapshotsPerUser  int             `json:"maxSnapshotsPerUser"`
	KdfMinIter           int             `json:"kdfMinIter"`
	ServerSecretFile     string          `json:"serverSecretFile"`
	ServerSecret         []byte          `json:"-"` // 运行时加载的伪 salt 秘钥
}

// DefaultConfig 获取默认配置
func DefaultConfig() *Config {
	return &Config{
		Listen: "0.0.0.0:8443",
		TLS: TLSConfig{
			Enabled:  false, // 默认可关闭 TLS，交给前置反代或由参数开启
			CertFile: "cert.pem",
			KeyFile:  "key.pem",
		},
		DataDir:        "./data",
		AllowedOrigins: []string{"*"}, // 默认支持通配/自动反射 Origin，免去小白用户频繁配置
		RateLimit: RateLimitConfig{
			RequestsPerMinute: 60, // 默认 60 次/分
			CooldownSeconds:   60, // 默认熔断冷却 60 秒
		},
		AIRelay: AIRelayConfig{
			Enabled:         false,
			DefaultUpstream: "https://api.openai.com/v1",
			MaxTasks:        500,
			TTLHours:        24,
			ForceNonStream:  true,
			TimeoutMinutes:  30,
		},
		MaxSnapshotBytes:     50 * 1024 * 1024,   // 50MB
		MaxTotalStorageBytes: 1024 * 1024 * 1024, // 1GB
		DefaultQuotaBytes:    200 * 1024 * 1024,  // 200MB
		MaxSnapshotsPerUser:  200,
		KdfMinIter:           600000,
		ServerSecretFile:     "./data/server.secret",
	}
}

// LoadConfig 从指定 JSON 路径加载配置，并初始化 server.secret
func LoadConfig(path string) (*Config, error) {
	cfg := DefaultConfig()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, fmt.Errorf("读取配置文件失败: %w", err)
			}
			// 文件不存在时自动生成默认配置文件
			if err := SaveConfig(path, cfg); err != nil {
				return nil, fmt.Errorf("生成默认配置文件失败: %w", err)
			}
		} else {
			if err := json.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("解析配置文件失败: %w", err)
			}
		}
	}

	// 补全默认限流参数 (防止老旧 config.json 缺少字段解析为 0)
	if cfg.RateLimit.RequestsPerMinute <= 0 {
		cfg.RateLimit.RequestsPerMinute = 60
	}
	if cfg.RateLimit.CooldownSeconds <= 0 {
		cfg.RateLimit.CooldownSeconds = 60
	}

	// 补全默认 AI 中转参数
	if cfg.AIRelay.MaxTasks <= 0 {
		cfg.AIRelay.MaxTasks = 500
	}
	if cfg.AIRelay.TTLHours <= 0 {
		cfg.AIRelay.TTLHours = 24
	}
	if cfg.AIRelay.TimeoutMinutes <= 0 {
		cfg.AIRelay.TimeoutMinutes = 30
	}
	if cfg.AIRelay.DefaultUpstream == "" {
		cfg.AIRelay.DefaultUpstream = "https://api.openai.com/v1"
	}

	// 确保 DataDir 目录存在
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}

	// 加载或生成 server.secret (32字节随机值)
	secretPath := cfg.ServerSecretFile
	if secretData, err := os.ReadFile(secretPath); err == nil && len(secretData) >= 32 {
		cfg.ServerSecret = secretData[:32]
	} else {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, fmt.Errorf("生成 server.secret 失败: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(secretPath), 0755); err != nil {
			return nil, fmt.Errorf("创建 secret 所在目录失败: %w", err)
		}
		if err := os.WriteFile(secretPath, secret, 0600); err != nil {
			return nil, fmt.Errorf("写入 server.secret 失败: %w", err)
		}
		cfg.ServerSecret = secret
	}

	return cfg, nil
}

// SaveConfig 保存配置到 JSON
func SaveConfig(path string, cfg *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil && filepath.Dir(path) != "." {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// ConfigWatcher 配置文件动态热重载管理器 (零外部依赖，1 分钟轻量轮询 mtime)
type ConfigWatcher struct {
	path       string
	mu         sync.RWMutex
	currentCfg *Config
	lastMod    time.Time
	callbacks  []func(*Config)
	stopCh     chan struct{}
}

// NewConfigWatcher 创建配置文件监听器
func NewConfigWatcher(path string, initialCfg *Config) *ConfigWatcher {
	var initialMod time.Time
	if fi, err := os.Stat(path); err == nil {
		initialMod = fi.ModTime()
	}
	return &ConfigWatcher{
		path:       path,
		currentCfg: initialCfg,
		lastMod:    initialMod,
		stopCh:     make(chan struct{}),
	}
}

// Get 线程安全获取当前最新配置
func (w *ConfigWatcher) Get() *Config {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.currentCfg
}

// OnReload 注册配置热重载回调函数
func (w *ConfigWatcher) OnReload(fn func(*Config)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.callbacks = append(w.callbacks, fn)
}

// Start 启动后台轮询监听 (每 1 分钟检测一次文件修改时间)
func (w *ConfigWatcher) Start() {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				w.CheckReload()
			case <-w.stopCh:
				return
			}
		}
	}()
}

// CheckReload 主动检查并执行热重载（公开供测试或轮询调用）
func (w *ConfigWatcher) CheckReload() bool {
	if w.path == "" {
		return false
	}
	fi, err := os.Stat(w.path)
	if err != nil {
		return false
	}

	// 若修改时间未变，无需重复解析
	if !fi.ModTime().After(w.lastMod) {
		return false
	}

	data, err := os.ReadFile(w.path)
	if err != nil {
		return false
	}

	// 临时对象反序列化，防半写或格式错误搞崩正在运行的服务
	newCfg := DefaultConfig()
	if err := json.Unmarshal(data, newCfg); err != nil {
		log.Printf("[ConfigWatcher] 配置文件变更解析失败 (可能是临时半写入或语法错误)，已安全保持上一版正常配置: %v", err)
		return false
	}

	// 补全限流参数
	if newCfg.RateLimit.RequestsPerMinute <= 0 {
		newCfg.RateLimit.RequestsPerMinute = 60
	}
	if newCfg.RateLimit.CooldownSeconds <= 0 {
		newCfg.RateLimit.CooldownSeconds = 60
	}

	// 补全 AI 中转参数
	if newCfg.AIRelay.MaxTasks <= 0 {
		newCfg.AIRelay.MaxTasks = 500
	}
	if newCfg.AIRelay.TTLHours <= 0 {
		newCfg.AIRelay.TTLHours = 24
	}
	if newCfg.AIRelay.TimeoutMinutes <= 0 {
		newCfg.AIRelay.TimeoutMinutes = 30
	}
	if newCfg.AIRelay.DefaultUpstream == "" {
		newCfg.AIRelay.DefaultUpstream = "https://api.openai.com/v1"
	}

	w.mu.Lock()
	// 保留不可热变的运行时密钥与基础配置
	newCfg.ServerSecret = w.currentCfg.ServerSecret
	newCfg.ServerSecretFile = w.currentCfg.ServerSecretFile
	newCfg.DataDir = w.currentCfg.DataDir
	newCfg.Listen = w.currentCfg.Listen
	newCfg.TLS = w.currentCfg.TLS
	w.currentCfg = newCfg
	w.lastMod = fi.ModTime()

	cbs := make([]func(*Config), len(w.callbacks))
	copy(cbs, w.callbacks)
	w.mu.Unlock()

	limitDesc := "不限制"
	if newCfg.MaxTotalStorageBytes > 0 {
		limitDesc = fmt.Sprintf("%.2fMB", float64(newCfg.MaxTotalStorageBytes)/(1024*1024))
	}

	aiRelayDesc := "关闭"
	if newCfg.AIRelay.Enabled {
		aiRelayDesc = fmt.Sprintf("开启(保留%d小时, 最多%d条)", newCfg.AIRelay.TTLHours, newCfg.AIRelay.MaxTasks)
	}

	log.Printf("[ConfigWatcher] 检测到配置文件变动，已动态热重载新配置！(AllowedOrigins=%v, RateLimit=%d次/分, 熔断冷却=%d秒, 全服存储上限=%s, AI中转=%s)",
		newCfg.AllowedOrigins, newCfg.RateLimit.RequestsPerMinute, newCfg.RateLimit.CooldownSeconds, limitDesc, aiRelayDesc)

	for _, fn := range cbs {
		fn(newCfg)
	}
	return true
}

// Stop 停止监听
func (w *ConfigWatcher) Stop() {
	select {
	case <-w.stopCh:
	default:
		close(w.stopCh)
	}
}
