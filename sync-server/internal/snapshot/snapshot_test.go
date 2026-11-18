package snapshot_test

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"sync-server/internal/auth"
	"sync-server/internal/snapshot"
	"sync-server/internal/store"
)

func setupSnapshotTest(t *testing.T, maxSnapshotBytes int64, maxSnapshots int, maxTotalStorage int64) (*store.DB, *snapshot.Manager, string, string, string, func()) {
	tempDir, err := os.MkdirTemp("", "snap-test-*")
	if err != nil {
		t.Fatalf("创建测试临时目录失败: %v", err)
	}

	db, err := store.OpenDB(tempDir)
	if err != nil {
		t.Fatalf("打开测试数据库失败: %v", err)
	}

	// 插入测试用户
	userID := "user_snap_001"
	deviceID := "dev_snap_001"
	token := "dummy_token_123456"
	tokenHash := auth.HashToken(token)
	now := time.Now().Unix()

	_, err = db.Exec(
		`INSERT INTO users (id, username, kdf_salt, kdf_iter, auth_hash, auth_salt, quota_bytes, used_bytes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		userID, "snap_user", []byte("salt123456789012"), 1000, []byte("hash1234567890123456789012345678"), []byte("salt123456789012"), 200*1024*1024, now,
	)
	if err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}

	_, err = db.Exec(
		`INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		deviceID, userID, "测试设备", tokenHash, now,
	)
	if err != nil {
		t.Fatalf("创建测试设备失败: %v", err)
	}

	mgr := snapshot.NewManager(db.DB, tempDir, maxSnapshotBytes, maxSnapshots, maxTotalStorage)

	cleanup := func() {
		db.Close()
		os.RemoveAll(tempDir)
	}

	return db, mgr, tempDir, userID, deviceID, cleanup
}

func makeSnapshotData(id string, size int) (snapshot.SnapshotMeta, io.Reader) {
	data := bytes.Repeat([]byte("X"), size)
	h := sha256.Sum256(data)
	meta := snapshot.SnapshotMeta{
		ID:                id,
		FormatVersion:     1,
		Size:              int64(size),
		SHA256Hex:         fmt.Sprintf("%x", h),
		ConversationCount: 1,
		EncManifest:       []byte("manifest_enc_data"),
	}
	return meta, bytes.NewReader(data)
}

// TestSnapshotManager_GlobalStorageLimit 测试全服最大快照存储空间上限
func TestSnapshotManager_GlobalStorageLimit(t *testing.T) {
	// 全服上限设为 100 字节，单包 50 字节，每人最多 10 个快照
	_, mgr, tempDir, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 10, 100)
	defer cleanup()

	// 1. 验证 GetLimits 和初始 GetTotalStorageUsed
	maxBytes, maxSnaps, maxTotal := mgr.GetLimits()
	if maxBytes != 50 || maxSnaps != 10 || maxTotal != 100 {
		t.Errorf("GetLimits 返回异常: %d, %d, %d", maxBytes, maxSnaps, maxTotal)
	}

	totalUsed, err := mgr.GetTotalStorageUsed()
	if err != nil || totalUsed != 0 {
		t.Errorf("初始 GetTotalStorageUsed 期望 0, 实际: %d (err=%v)", totalUsed, err)
	}

	// 2. 保存第一份 40 字节快照 -> 成功 (当前累计 40 字节 <= 100)
	meta1, reader1 := makeSnapshotData("snap_01", 40)
	item1, err := mgr.SaveSnapshot(userID, deviceID, meta1, reader1)
	if err != nil {
		t.Fatalf("保存首个快照失败: %v", err)
	}
	if item1.ID != "snap_01" || item1.Size != 40 {
		t.Errorf("返回快照信息异常: %+v", item1)
	}

	totalUsed, _ = mgr.GetTotalStorageUsed()
	if totalUsed != 40 {
		t.Errorf("全服总占用期望 40, 实际: %d", totalUsed)
	}

	// 3. 保存第二份 40 字节快照 -> 成功 (当前累计 80 字节 <= 100)
	meta2, reader2 := makeSnapshotData("snap_02", 40)
	_, err = mgr.SaveSnapshot(userID, deviceID, meta2, reader2)
	if err != nil {
		t.Fatalf("保存第二个快照失败: %v", err)
	}

	totalUsed, _ = mgr.GetTotalStorageUsed()
	if totalUsed != 80 {
		t.Errorf("全服总占用期望 80, 实际: %d", totalUsed)
	}

	// 4. 保存第三份 30 字节快照 -> 应被无事务预检拦截 (80 + 30 = 110 > 100)
	meta3, reader3 := makeSnapshotData("snap_03", 30)
	_, err = mgr.SaveSnapshot(userID, deviceID, meta3, reader3)
	if err != snapshot.ErrServerStorageFull {
		t.Errorf("超出全服存储上限期望返回 ErrServerStorageFull, 实际: %v", err)
	}

	// 验证未产生孤立临时文件
	userDir := filepath.Join(tempDir, userID)
	entries, _ := os.ReadDir(userDir)
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".tmp" {
			t.Errorf("检测到失败后残留的临时文件: %s", entry.Name())
		}
	}

	// 5. 删除第一份快照 (40 字节) -> 全服占用回落为 40 字节
	err = mgr.DeleteSnapshot(userID, "snap_01")
	if err != nil {
		t.Fatalf("删除快照失败: %v", err)
	}

	totalUsed, _ = mgr.GetTotalStorageUsed()
	if totalUsed != 40 {
		t.Errorf("删除后全服总占用期望 40, 实际: %d", totalUsed)
	}

	// 6. 重新保存第三份 30 字节快照 -> 空间已释放 (40 + 30 = 70 <= 100)，应成功保存！
	meta3Retry, reader3Retry := makeSnapshotData("snap_03", 30)
	item3, err := mgr.SaveSnapshot(userID, deviceID, meta3Retry, reader3Retry)
	if err != nil {
		t.Fatalf("释放空间后重新保存快照失败: %v", err)
	}
	if item3.Size != 30 {
		t.Errorf("快照大小期望 30, 实际: %d", item3.Size)
	}

	// 7. 测试热重载 UpdateLimits 将全服配额调整为 0 (解除限制)
	mgr.UpdateLimits(50, 10, 0)
	_, _, newMaxTotal := mgr.GetLimits()
	if newMaxTotal != 0 {
		t.Errorf("UpdateLimits 更新后全服限制期望为 0 (不限), 实际: %d", newMaxTotal)
	}

	// 现在全服累计 70 字节，即使上传 50 字节 (累计 120 > 100) 也应成功放行
	meta4, reader4 := makeSnapshotData("snap_04", 50)
	_, err = mgr.SaveSnapshot(userID, deviceID, meta4, reader4)
	if err != nil {
		t.Fatalf("解除全服存储限制后保存快照失败: %v", err)
	}
}

// TestSnapshotManager_AtomicConcurrentRace 测试并发上传时微事务内的原子二次校验
func TestSnapshotManager_AtomicConcurrentRace(t *testing.T) {
	// 全服上限设为 50 字节，只够容纳 1 份 40 字节的快照
	_, mgr, _, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 10, 50)
	defer cleanup()

	var wg sync.WaitGroup
	successCount := 0
	failServerFullCount := 0
	var mu sync.Mutex

	// 并发启动 5 个上传协程，竞争仅存的 50 字节空间
	for i := 0; i < 5; i++ {
		wg.Add(1)
		snapID := fmt.Sprintf("race_snap_%d", i)
		go func(id string) {
			defer wg.Done()
			meta, reader := makeSnapshotData(id, 40)
			_, err := mgr.SaveSnapshot(userID, deviceID, meta, reader)

			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				successCount++
			} else if err == snapshot.ErrServerStorageFull {
				failServerFullCount++
			}
		}(snapID)
	}

	wg.Wait()

	// 无论多高并发，由于微事务内的原子校验，成功者必须且只能有 1 个，其余 4 个均被精准拒绝
	if successCount != 1 {
		t.Errorf("并发上传期望只有 1 个成功，实际成功: %d", successCount)
	}
	if failServerFullCount != 4 {
		t.Errorf("期望 4 个被 ErrServerStorageFull 拒绝，实际: %d", failServerFullCount)
	}

	totalUsed, _ := mgr.GetTotalStorageUsed()
	if totalUsed != 40 {
		t.Errorf("全服最终已用空间期望 40, 实际: %d", totalUsed)
	}
}

// TestSnapshotManager_EdgeCases 测试边缘边界值与异常处理
func TestSnapshotManager_EdgeCases(t *testing.T) {
	_, mgr, _, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 2, 100)
	defer cleanup()

	// 1. 非法体积 (<= 0) 拦截
	zeroMeta := snapshot.SnapshotMeta{ID: "zero", Size: 0}
	_, err := mgr.SaveSnapshot(userID, deviceID, zeroMeta, bytes.NewReader([]byte{}))
	if err == nil {
		t.Errorf("0 字节体积快照期望返回错误，实际未报错")
	}

	// 2. 单包体积超出限制
	tooLargeMeta, tooLargeReader := makeSnapshotData("too_large", 60) // maxSnapshotBytes = 50
	_, err = mgr.SaveSnapshot(userID, deviceID, tooLargeMeta, tooLargeReader)
	if err != snapshot.ErrPayloadTooLarge {
		t.Errorf("单包超大期望 ErrPayloadTooLarge, 实际: %v", err)
	}

	// 3. 快照数量达到单用户上限 (maxSnapshots = 2)
	meta1, reader1 := makeSnapshotData("s1", 10)
	_, _ = mgr.SaveSnapshot(userID, deviceID, meta1, reader1)
	meta2, reader2 := makeSnapshotData("s2", 10)
	_, _ = mgr.SaveSnapshot(userID, deviceID, meta2, reader2)

	meta3, reader3 := makeSnapshotData("s3", 10)
	_, err = mgr.SaveSnapshot(userID, deviceID, meta3, reader3)
	if err != snapshot.ErrSnapshotLimit {
		t.Errorf("快照数超出上限期望 ErrSnapshotLimit, 实际: %v", err)
	}
}

// TestSnapshotManager_SnapshotIDSecurityAndPathTraversal 测试快照 ID 安全校验与防目录穿越
func TestSnapshotManager_SnapshotIDSecurityAndPathTraversal(t *testing.T) {
	_, mgr, _, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 10, 100)
	defer cleanup()

	// 1. 测试各种非法 ID (路径穿越、特殊字符、超长)
	invalidIDs := []string{
		"../escape",
		"../../etc/passwd",
		"..\\win_escape",
		"sub/folder",
		"sub\\folder",
		"snap*test",
		"snap?test",
		"snap!test",
		"snap space",
		"",
		"a_very_long_snapshot_id_that_exceeds_sixty_four_characters_limit_1234567890",
	}

	for _, badID := range invalidIDs {
		meta, reader := makeSnapshotData(badID, 10)
		_, err := mgr.SaveSnapshot(userID, deviceID, meta, reader)
		if err != snapshot.ErrInvalidSnapshotID {
			t.Errorf("非法快照 ID [%s] 期望返回 ErrInvalidSnapshotID, 实际: %v", badID, err)
		}

		_, _, err = mgr.OpenSnapshotFile(userID, badID)
		if err != snapshot.ErrInvalidSnapshotID {
			t.Errorf("读取非法快照 ID [%s] 期望返回 ErrInvalidSnapshotID, 实际: %v", badID, err)
		}

		err = mgr.DeleteSnapshot(userID, badID)
		if err != snapshot.ErrInvalidSnapshotID {
			t.Errorf("删除非法快照 ID [%s] 期望返回 ErrInvalidSnapshotID, 实际: %v", badID, err)
		}
	}

	// 2. 合法 ID 校验
	validIDs := []string{
		"snap_1700000000_abcdef",
		"550e8400-e29b-41d4-a716-446655440000",
		"SNAP-TEST_01",
	}
	for _, goodID := range validIDs {
		meta, reader := makeSnapshotData(goodID, 10)
		_, err := mgr.SaveSnapshot(userID, deviceID, meta, reader)
		if err != nil {
			t.Errorf("合法快照 ID [%s] 保存失败: %v", goodID, err)
		}
	}
}

// TestSnapshotManager_DuplicateIDRejectionAndNoCorruption 测试重复 ID 拒绝且不破坏原文件
func TestSnapshotManager_DuplicateIDRejectionAndNoCorruption(t *testing.T) {
	_, mgr, _, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 10, 100)
	defer cleanup()

	// 1. 首次保存
	meta1, reader1 := makeSnapshotData("snap_unique_01", 20)
	_, err := mgr.SaveSnapshot(userID, deviceID, meta1, reader1)
	if err != nil {
		t.Fatalf("首个快照保存失败: %v", err)
	}

	// 2. 尝试使用相同 ID 重复上传（内容不同）
	meta2, reader2 := makeSnapshotData("snap_unique_01", 30)
	_, err = mgr.SaveSnapshot(userID, deviceID, meta2, reader2)
	if err != snapshot.ErrSnapshotExists {
		t.Fatalf("重复快照 ID 期望返回 ErrSnapshotExists, 实际: %v", err)
	}

	// 3. 验证原快照文件未被覆盖或误删除
	f, size, err := mgr.OpenSnapshotFile(userID, "snap_unique_01")
	if err != nil {
		t.Fatalf("原快照文件读取失败 (可能被误删): %v", err)
	}
	defer f.Close()
	if size != 20 {
		t.Errorf("原快照体积期望 20, 实际: %d (可能被部分覆写)", size)
	}
}

// TestSnapshotManager_ConcurrentSnapshotCountRace 测试并发上传时微事务内的快照数量限额二次原子校验
func TestSnapshotManager_ConcurrentSnapshotCountRace(t *testing.T) {
	// 限额 2 个快照，全服配额设为足够大
	_, mgr, _, userID, deviceID, cleanup := setupSnapshotTest(t, 50, 2, 1000)
	defer cleanup()

	// 预先写入 1 个快照，此时仅剩 1 个配额槽位
	metaInit, readerInit := makeSnapshotData("snap_initial", 10)
	_, err := mgr.SaveSnapshot(userID, deviceID, metaInit, readerInit)
	if err != nil {
		t.Fatalf("初始化快照保存失败: %v", err)
	}

	var wg sync.WaitGroup
	successCount := 0
	limitRejectedCount := 0
	var mu sync.Mutex

	// 启动 5 个并发协程竞争最后 1 个快照名额
	for i := 0; i < 5; i++ {
		wg.Add(1)
		id := fmt.Sprintf("race_count_%d", i)
		go func(snapID string) {
			defer wg.Done()
			meta, reader := makeSnapshotData(snapID, 10)
			_, err := mgr.SaveSnapshot(userID, deviceID, meta, reader)

			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				successCount++
			} else if err == snapshot.ErrSnapshotLimit {
				limitRejectedCount++
			}
		}(id)
	}

	wg.Wait()

	// 严密验证：成功者必须且只能有 1 个，其余 4 个均被精准限额拦截
	if successCount != 1 {
		t.Errorf("并发上传竞争名额期望只有 1 个成功，实际成功: %d", successCount)
	}
	if limitRejectedCount != 4 {
		t.Errorf("并发上传期望 4 个被 ErrSnapshotLimit 拒绝，实际: %d", limitRejectedCount)
	}

	// 验证快照总列表数量严格为 2，绝无超额
	list, _, _ := mgr.ListSnapshots(userID, 0, 10)
	if len(list) != 2 {
		t.Errorf("快照最终数量期望 2, 实际: %d", len(list))
	}
}

// TestSnapshotManager_BatchDeleteSnapshots 测试批量删除快照与配额返还
func TestSnapshotManager_BatchDeleteSnapshots(t *testing.T) {
	db, mgr, tempDir, userID, deviceID, cleanup := setupSnapshotTest(t, 1024, 10, 2048)
	defer cleanup()

	// 保存 3 份快照 (40B, 60B, 80B)
	meta1, r1 := makeSnapshotData("batch_snap_1", 40)
	meta2, r2 := makeSnapshotData("batch_snap_2", 60)
	meta3, r3 := makeSnapshotData("batch_snap_3", 80)

	_, _ = mgr.SaveSnapshot(userID, deviceID, meta1, r1)
	_, _ = mgr.SaveSnapshot(userID, deviceID, meta2, r2)
	_, _ = mgr.SaveSnapshot(userID, deviceID, meta3, r3)

	var usedBefore int64
	_ = db.QueryRow(`SELECT used_bytes FROM users WHERE id = ?`, userID).Scan(&usedBefore)
	if usedBefore != 180 {
		t.Fatalf("初始已用配额期望 180, 实际 %d", usedBefore)
	}

	// 批量删除前两份 (40B + 60B = 100B)，夹带一个不存在的 ID 和非法 ID
	deletedCount, freedBytes, err := mgr.BatchDeleteSnapshots(userID, []string{"batch_snap_1", "batch_snap_2", "not_exists", "../bad"})
	if err != nil {
		t.Fatalf("批量删除失败: %v", err)
	}
	if deletedCount != 2 {
		t.Errorf("期望删除 2 个快照，实际 %d", deletedCount)
	}
	if freedBytes != 100 {
		t.Errorf("期望释放 100 字节，实际 %d", freedBytes)
	}

	// 检查配额扣减
	var usedAfter int64
	_ = db.QueryRow(`SELECT used_bytes FROM users WHERE id = ?`, userID).Scan(&usedAfter)
	if usedAfter != 80 {
		t.Errorf("删除后已用配额期望 80, 实际 %d", usedAfter)
	}

	// 检查磁盘文件物理清理
	f1 := filepath.Join(tempDir, userID, "batch_snap_1.bin")
	if _, err := os.Stat(f1); !os.IsNotExist(err) {
		t.Errorf("快照 1 文件期望已被删除，但依然存在")
	}
	f3 := filepath.Join(tempDir, userID, "batch_snap_3.bin")
	if _, err := os.Stat(f3); err != nil {
		t.Errorf("快照 3 文件期望保留，但不存在: %v", err)
	}
}

// TestSnapshotManager_BatchDeleteSnapshots_AntiIDOR 核心防越权测试：用户 A 无法批量删除用户 B 的快照
func TestSnapshotManager_BatchDeleteSnapshots_AntiIDOR(t *testing.T) {
	db, mgr, tempDir, userA, _, cleanup := setupSnapshotTest(t, 1024, 10, 2048)
	defer cleanup()

	// 创建用户 B
	userB := "user_snap_002"
	devB := "dev_snap_002"
	now := time.Now().Unix()
	_, _ = db.Exec(
		`INSERT INTO users (id, username, kdf_salt, kdf_iter, auth_hash, auth_salt, quota_bytes, used_bytes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		userB, "user_b", []byte("salt123456789012"), 1000, []byte("hash1234567890123456789012345678"), []byte("salt123456789012"), 200*1024*1024, now,
	)
	_, _ = db.Exec(`INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`, devB, userB, "设备B", "hashB", now)

	// 用户 B 上传一份快照 snap_b_01
	metaB, rB := makeSnapshotData("snap_b_01", 50)
	_, _ = mgr.SaveSnapshot(userB, devB, metaB, rB)

	// 用户 A 尝试发起批量删除，包含用户 B 的快照 ID
	delCount, freed, err := mgr.BatchDeleteSnapshots(userA, []string{"snap_b_01", "non_exist"})
	if err != nil {
		t.Fatalf("批量删除请求发生异常: %v", err)
	}
	if delCount != 0 || freed != 0 {
		t.Errorf("防越权失败！用户 A 删除了不属于自己的快照: count=%d, freed=%d", delCount, freed)
	}

	// 验证用户 B 的快照数据库记录与磁盘文件依然完好
	var countB int
	_ = db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE id = 'snap_b_01' AND user_id = ?`, userB).Scan(&countB)
	if countB != 1 {
		t.Errorf("用户 B 的快照元数据期望依然存在")
	}
	fileB := filepath.Join(tempDir, userB, "snap_b_01.bin")
	if _, err := os.Stat(fileB); err != nil {
		t.Errorf("用户 B 的快照磁盘密文文件期望依然存在: %v", err)
	}
}



