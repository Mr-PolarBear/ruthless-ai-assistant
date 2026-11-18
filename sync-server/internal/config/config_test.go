package config_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"sync-server/internal/config"
)

func TestConfigWatcher_HotReloadAndFaultTolerance(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "config-watcher-test-*")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tempDir)

	cfgPath := filepath.Join(tempDir, "config.json")
	initialCfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("初始加载配置失败: %v", err)
	}

	// 验证默认通配 Origins 与默认限流与默认全服 1GB 上限与默认 AI 中转配置
	if len(initialCfg.AllowedOrigins) != 1 || initialCfg.AllowedOrigins[0] != "*" {
		t.Errorf("期望默认 AllowedOrigins 为 [*], 实际: %v", initialCfg.AllowedOrigins)
	}
	if initialCfg.RateLimit.RequestsPerMinute != 60 {
		t.Errorf("期望默认 RateLimit 为 60, 实际: %d", initialCfg.RateLimit.RequestsPerMinute)
	}
	if initialCfg.MaxTotalStorageBytes != 1024*1024*1024 {
		t.Errorf("期望默认 MaxTotalStorageBytes 为 1GB (1073741824), 实际: %d", initialCfg.MaxTotalStorageBytes)
	}
	if initialCfg.AIRelay.Enabled != false {
		t.Errorf("期望默认 AIRelay.Enabled 为 false, 实际: %v", initialCfg.AIRelay.Enabled)
	}
	if initialCfg.AIRelay.MaxTasks != 500 {
		t.Errorf("期望默认 AIRelay.MaxTasks 为 500, 实际: %d", initialCfg.AIRelay.MaxTasks)
	}
	if initialCfg.AIRelay.TTLHours != 24 {
		t.Errorf("期望默认 AIRelay.TTLHours 为 24, 实际: %d", initialCfg.AIRelay.TTLHours)
	}
	if !initialCfg.AIRelay.ForceNonStream {
		t.Errorf("期望默认 AIRelay.ForceNonStream 为 true, 实际: %v", initialCfg.AIRelay.ForceNonStream)
	}

	watcher := config.NewConfigWatcher(cfgPath, initialCfg)

	reloaded := false
	var reloadedOrigins []string
	watcher.OnReload(func(newCfg *config.Config) {
		reloaded = true
		reloadedOrigins = newCfg.AllowedOrigins
	})

	// 1. 模拟修改配置文件
	time.Sleep(100 * time.Millisecond) // 保证 mtime 推进
	initialCfg.AllowedOrigins = []string{"https://my-app.example.com"}
	initialCfg.RateLimit.RequestsPerMinute = 120
	initialCfg.RateLimit.CooldownSeconds = 30
	initialCfg.MaxTotalStorageBytes = 2 * 1024 * 1024 * 1024 // 调整为 2GB
	initialCfg.AIRelay.Enabled = true
	initialCfg.AIRelay.MaxTasks = 300
	initialCfg.AIRelay.TTLHours = 12
	if err := config.SaveConfig(cfgPath, initialCfg); err != nil {
		t.Fatalf("保存修改配置失败: %v", err)
	}

	// 主动触发热重载检测
	if !watcher.CheckReload() {
		t.Fatalf("期望 CheckReload 检测到变动并返回 true")
	}

	if !reloaded {
		t.Fatalf("期望 OnReload 回调被触发")
	}
	if len(reloadedOrigins) != 1 || reloadedOrigins[0] != "https://my-app.example.com" {
		t.Errorf("热重载后 AllowedOrigins 未更新: %v", reloadedOrigins)
	}
	current := watcher.Get()
	if current.RateLimit.RequestsPerMinute != 120 || current.RateLimit.CooldownSeconds != 30 {
		t.Errorf("热重载后 RateLimit 未更新: %+v", current.RateLimit)
	}
	if current.MaxTotalStorageBytes != 2*1024*1024*1024 {
		t.Errorf("热重载后 MaxTotalStorageBytes 未更新为 2GB: %d", current.MaxTotalStorageBytes)
	}
	if !current.AIRelay.Enabled || current.AIRelay.MaxTasks != 300 || current.AIRelay.TTLHours != 12 {
		t.Errorf("热重载后 AIRelay 未按预期更新: %+v", current.AIRelay)
	}

	// 2. 模拟用户编辑文件保存时格式错误（写了半截 JSON）
	time.Sleep(100 * time.Millisecond)
	_ = os.WriteFile(cfgPath, []byte(`{"allowedOrigins": ["broken"`), 0644)

	// CheckReload 遇到语法错误应容错返回 false，且保持上一版本正常配置
	if watcher.CheckReload() {
		t.Errorf("损坏 JSON 期望 CheckReload 返回 false")
	}
	stillValid := watcher.Get()
	if len(stillValid.AllowedOrigins) != 1 || stillValid.AllowedOrigins[0] != "https://my-app.example.com" {
		t.Errorf("损坏 JSON 情况下应保持上一版正常配置，实际: %v", stillValid.AllowedOrigins)
	}
}
