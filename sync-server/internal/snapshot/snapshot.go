package snapshot

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrQuotaExceeded     = errors.New("存储空间已超出个人配额上限")
	ErrServerStorageFull = errors.New("服务端总存储空间已达上限，暂无法上传新快照")
	ErrSnapshotLimit     = errors.New("快照数量已达上限，请先删除旧快照")
	ErrHashMismatch      = errors.New("密文数据完整性校验失败 (SHA256 不匹配)")
	ErrPayloadTooLarge   = errors.New("快照体积超过服务端单包限制")
	ErrSnapshotNotFound  = errors.New("快照不存在或已被删除")
	ErrSnapshotExists    = errors.New("快照 ID 已存在，不可重复覆盖")
	ErrInvalidSnapshotID = errors.New("快照 ID 格式不合法")
)

// IsValidSnapshotID 校验快照 ID 安全性 (仅允许 1~64 位字母、数字、下划线与连字符，杜绝路径穿越)
func IsValidSnapshotID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

// SnapshotMeta 快照上传元数据
type SnapshotMeta struct {
	ID                string `json:"id"`
	FormatVersion     int    `json:"formatVersion"`
	Size              int64  `json:"size"`
	SHA256Hex         string `json:"sha256"`
	ConversationCount int    `json:"conversationCount"` // 快照包含的会话数
	EncManifest       []byte `json:"encManifest"`       // 加密后的 manifest base64 解码后的原始字节
}

// SnapshotListItem 快照列表项
type SnapshotListItem struct {
	ID                string `json:"id"`
	CreatedAt         int64  `json:"createdAt"`
	Size              int64  `json:"size"`
	DeviceName        string `json:"deviceName"`
	ConversationCount int    `json:"conversationCount"` // 快照包含的会话总数
	EncManifest       string `json:"encManifest"`       // Base64 编码供前端解密
}

// Manager 快照管理器
type Manager struct {
	mu                   sync.RWMutex
	db                   *sql.DB
	dataDir              string
	maxSnapshotBytes     int64
	maxSnapshotsPerUser  int
	maxTotalStorageBytes int64 // 全服最大总存储空间 (字节, <=0 表示不限制)
}

// NewManager 创建快照管理器
func NewManager(db *sql.DB, dataDir string, maxSnapshotBytes int64, maxSnapshotsPerUser int, maxTotalStorageBytes int64) *Manager {
	return &Manager{
		db:                   db,
		dataDir:              dataDir,
		maxSnapshotBytes:     maxSnapshotBytes,
		maxSnapshotsPerUser:  maxSnapshotsPerUser,
		maxTotalStorageBytes: maxTotalStorageBytes,
	}
}

// UpdateLimits 动态更新快照限制 (支持配置热重载)
func (m *Manager) UpdateLimits(maxSnapshotBytes int64, maxSnapshotsPerUser int, maxTotalStorageBytes int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if maxSnapshotBytes > 0 {
		m.maxSnapshotBytes = maxSnapshotBytes
	}
	if maxSnapshotsPerUser > 0 {
		m.maxSnapshotsPerUser = maxSnapshotsPerUser
	}
	m.maxTotalStorageBytes = maxTotalStorageBytes
}

// GetTotalStorageUsed 查询全服快照当前已使用的总字节数
func (m *Manager) GetTotalStorageUsed() (int64, error) {
	var total int64
	err := m.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM snapshots`).Scan(&total)
	return total, err
}

// GetLimits 线程安全获取当前各项容量限制
func (m *Manager) GetLimits() (maxSnapshotBytes int64, maxSnapshotsPerUser int, maxTotalStorageBytes int64) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.maxSnapshotBytes, m.maxSnapshotsPerUser, m.maxTotalStorageBytes
}

// SaveSnapshot 原子保存快照与密文文件（网络 I/O 彻底移出 SQLite 事务，消除锁堵塞）
func (m *Manager) SaveSnapshot(userID, deviceID string, meta SnapshotMeta, blobReader io.Reader) (*SnapshotListItem, error) {
	m.mu.RLock()
	maxBytes := m.maxSnapshotBytes
	maxSnapshots := m.maxSnapshotsPerUser
	maxTotalBytes := m.maxTotalStorageBytes
	m.mu.RUnlock()

	// 校验快照 ID 格式 (防路径穿越与非法字符)
	if !IsValidSnapshotID(meta.ID) {
		return nil, ErrInvalidSnapshotID
	}

	if meta.Size <= 0 {
		return nil, errors.New("快照体积不合法")
	}

	if meta.Size > maxBytes {
		return nil, ErrPayloadTooLarge
	}

	// 1. 【无事务预检】先行只读检查全服总容量、ID唯一性、个人配额与快照数量，超限立即 Fast-Fail，不耗费磁盘与带宽
	if maxTotalBytes > 0 {
		var totalUsed int64
		err := m.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM snapshots`).Scan(&totalUsed)
		if err != nil {
			return nil, err
		}
		if totalUsed+meta.Size > maxTotalBytes {
			return nil, ErrServerStorageFull
		}
	}

	var exists int
	err := m.db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE id = ?`, meta.ID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, ErrSnapshotExists
	}

	var quotaBytes, usedBytes int64
	err = m.db.QueryRow(`SELECT quota_bytes, used_bytes FROM users WHERE id = ?`, userID).Scan(&quotaBytes, &usedBytes)
	if err != nil {
		return nil, err
	}
	if quotaBytes > 0 && usedBytes+meta.Size > quotaBytes {
		return nil, ErrQuotaExceeded
	}

	var count int
	err = m.db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE user_id = ?`, userID).Scan(&count)
	if err != nil {
		return nil, err
	}
	if count >= maxSnapshots {
		return nil, ErrSnapshotLimit
	}

	// 2. 【事务外网络流落地】准备目录并在无事务下写入临时文件
	userDir := filepath.Join(m.dataDir, userID)
	if err := os.MkdirAll(userDir, 0755); err != nil {
		return nil, fmt.Errorf("创建用户存储目录失败: %w", err)
	}

	// 预先检查目标落地文件是否已存在 (防恶意/意外覆盖已有快照)
	finalPath := filepath.Join(userDir, meta.ID+".bin")
	if _, err := os.Stat(finalPath); err == nil {
		return nil, ErrSnapshotExists
	}

	tempFile, err := os.CreateTemp(userDir, "upload-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("创建临时快照文件失败: %w", err)
	}
	tempPath := tempFile.Name()
	defer os.Remove(tempPath) // 无论后续成功或失败，临时文件句柄关闭后均自动清理

	hasher := sha256.New()
	writer := io.MultiWriter(tempFile, hasher)

	written, err := io.Copy(writer, blobReader)
	tempFile.Close()
	if err != nil {
		return nil, fmt.Errorf("写入快照数据失败: %w", err)
	}

	if written != meta.Size {
		return nil, fmt.Errorf("实际接收大小 (%d) 与声明大小 (%d) 不一致", written, meta.Size)
	}

	actualHash := hasher.Sum(nil)
	actualHashHex := fmt.Sprintf("%x", actualHash)
	if meta.SHA256Hex != "" && meta.SHA256Hex != actualHashHex {
		return nil, ErrHashMismatch
	}

	// 3. 【毫秒级微事务】数据完全落盘后，开启极短事务进行二次确认并写入元数据
	tx, err := m.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 并发二次校验全服总容量 (原子防高并发超卖)
	if maxTotalBytes > 0 {
		var txTotal int64
		err = tx.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM snapshots`).Scan(&txTotal)
		if err != nil {
			return nil, err
		}
		if txTotal+written > maxTotalBytes {
			return nil, ErrServerStorageFull
		}
	}

	// 并发二次校验快照 ID 唯一性 (原子防并发覆盖与冲突)
	var txExists int
	err = tx.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE id = ?`, meta.ID).Scan(&txExists)
	if err != nil {
		return nil, err
	}
	if txExists > 0 {
		return nil, ErrSnapshotExists
	}

	// 并发二次校验个人配额
	err = tx.QueryRow(`SELECT quota_bytes, used_bytes FROM users WHERE id = ?`, userID).Scan(&quotaBytes, &usedBytes)
	if err != nil {
		return nil, err
	}
	if quotaBytes > 0 && usedBytes+written > quotaBytes {
		return nil, ErrQuotaExceeded
	}

	// 并发二次校验个人快照数量上限 (原子防并发上传导致超出快照限额)
	var txCount int
	err = tx.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE user_id = ?`, userID).Scan(&txCount)
	if err != nil {
		return nil, err
	}
	if txCount >= maxSnapshots {
		return nil, ErrSnapshotLimit
	}

	// 最终磁盘落地文件防撞检查
	if _, err := os.Stat(finalPath); err == nil {
		return nil, ErrSnapshotExists
	}

	// 原子 rename 到最终文件
	if err := os.Rename(tempPath, finalPath); err != nil {
		return nil, fmt.Errorf("快照持久化重命名失败: %w", err)
	}

	now := time.Now().Unix()
	_, err = tx.Exec(
		`INSERT INTO snapshots (id, user_id, device_id, created_at, size, sha256, format_version, conversation_count, enc_manifest)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		meta.ID, userID, deviceID, now, written, actualHash, meta.FormatVersion, meta.ConversationCount, meta.EncManifest,
	)
	if err != nil {
		os.Remove(finalPath)
		return nil, err
	}

	_, err = tx.Exec(`UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?`, written, userID)
	if err != nil {
		os.Remove(finalPath)
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		os.Remove(finalPath)
		return nil, err
	}

	return &SnapshotListItem{
		ID:        meta.ID,
		CreatedAt: now,
		Size:      written,
	}, nil
}

// ListSnapshots 分页获取快照列表（按时间倒序）
func (m *Manager) ListSnapshots(userID string, cursor int64, limit int) ([]SnapshotListItem, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	var rows *sql.Rows
	var err error

	query := `
		SELECT s.id, s.created_at, s.size, d.name, s.conversation_count, s.enc_manifest
		FROM snapshots s
		LEFT JOIN devices d ON s.device_id = d.id
		WHERE s.user_id = ? AND (? = 0 OR s.created_at < ?)
		ORDER BY s.created_at DESC
		LIMIT ?
	`
	rows, err = m.db.Query(query, userID, cursor, cursor, limit+1)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var list []SnapshotListItem
	for rows.Next() {
		var item SnapshotListItem
		var devName sql.NullString
		var encManifestBlob []byte
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Size, &devName, &item.ConversationCount, &encManifestBlob); err != nil {
			return nil, 0, err
		}
		if devName.Valid {
			item.DeviceName = devName.String
		} else {
			item.DeviceName = "未知设备"
		}
		item.EncManifest = base64.StdEncoding.EncodeToString(encManifestBlob)
		list = append(list, item)
	}

	var nextCursor int64 = 0
	if len(list) > limit {
		nextCursor = list[limit-1].CreatedAt
		list = list[:limit]
	}

	return list, nextCursor, nil
}

// OpenSnapshotFile 打开密文文件用于下载
func (m *Manager) OpenSnapshotFile(userID, snapshotID string) (*os.File, int64, error) {
	if !IsValidSnapshotID(snapshotID) {
		return nil, 0, ErrInvalidSnapshotID
	}

	var size int64
	err := m.db.QueryRow(`SELECT size FROM snapshots WHERE id = ? AND user_id = ?`, snapshotID, userID).Scan(&size)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, 0, ErrSnapshotNotFound
		}
		return nil, 0, err
	}

	filePath := filepath.Join(m.dataDir, userID, snapshotID+".bin")
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, ErrSnapshotNotFound
	}

	return file, size, nil
}

// DeleteSnapshot 删除快照文件并返还配额
func (m *Manager) DeleteSnapshot(userID, snapshotID string) error {
	if !IsValidSnapshotID(snapshotID) {
		return ErrInvalidSnapshotID
	}

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var size int64
	err = tx.QueryRow(`SELECT size FROM snapshots WHERE id = ? AND user_id = ?`, snapshotID, userID).Scan(&size)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSnapshotNotFound
		}
		return err
	}

	_, err = tx.Exec(`DELETE FROM snapshots WHERE id = ? AND user_id = ?`, snapshotID, userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?`, size, userID)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// 物理删除磁盘文件
	filePath := filepath.Join(m.dataDir, userID, snapshotID+".bin")
	_ = os.Remove(filePath)

	return nil
}

/**
 * BatchDeleteSnapshots 批量删除快照并原子返还用户存储配额
 * @param {string} userID - 归属用户 ID (防越权核心过滤键)
 * @param {[]string} snapshotIDs - 待删除的快照 ID 列表
 * @returns {int, int64, error} - 实际删除数量, 实际释放存储字节数, 错误信息
 */
// — 为什么这么写 —
// 1. 批量删除必须在同一个 SQLite 事务中完成统计和删除，杜绝部分成功部分失败导致的配额不一致
// 2. 强绑定 user_id 作为过滤条件，即使前端传入他人或伪造的快照 ID 也绝无法越权删除
// 3. 磁盘物理文件删除放在事务 Commit 之后执行，保证数据库事务未提交前磁盘文件绝不被提前破坏
func (m *Manager) BatchDeleteSnapshots(userID string, snapshotIDs []string) (int, int64, error) {
	if len(snapshotIDs) == 0 {
		return 0, 0, nil
	}

	// 1. ID 过滤与去重：校验合法字符与格式，剔除恶意非法 ID 防止 SQL 或路径遍历风险
	validIDs := make([]string, 0, len(snapshotIDs))
	seen := make(map[string]bool)
	for _, id := range snapshotIDs {
		trimmed := strings.TrimSpace(id)
		if IsValidSnapshotID(trimmed) && !seen[trimmed] {
			seen[trimmed] = true
			validIDs = append(validIDs, trimmed)
		}
	}
	if len(validIDs) == 0 {
		return 0, 0, nil
	}

	// 2. 开启事务
	tx, err := m.db.Begin()
	if err != nil {
		return 0, 0, fmt.Errorf("开启批量删除事务失败: %w", err)
	}
	defer tx.Rollback()

	// 3. 查询当前用户确实拥有的有效快照及对应的大小（防越权核心）
	placeholders := make([]string, len(validIDs))
	args := make([]interface{}, len(validIDs)+1)
	args[0] = userID
	for i, id := range validIDs {
		placeholders[i] = "?"
		args[i+1] = id
	}

	query := fmt.Sprintf(`SELECT id, size FROM snapshots WHERE user_id = ? AND id IN (%s)`, strings.Join(placeholders, ","))
	rows, err := tx.Query(query, args...)
	if err != nil {
		return 0, 0, fmt.Errorf("查询待删除快照失败: %w", err)
	}
	defer rows.Close()

	var toDeleteIDs []string
	var totalFreedBytes int64
	for rows.Next() {
		var id string
		var size int64
		if err := rows.Scan(&id, &size); err != nil {
			return 0, 0, fmt.Errorf("读取快照记录失败: %w", err)
		}
		toDeleteIDs = append(toDeleteIDs, id)
		totalFreedBytes += size
	}
	rows.Close()

	if len(toDeleteIDs) == 0 {
		// 未匹配到属于该用户的快照，直接安全返回
		return 0, 0, nil
	}

	// 4. 批量删除数据库快照元数据
	delPlaceholders := make([]string, len(toDeleteIDs))
	delArgs := make([]interface{}, len(toDeleteIDs)+1)
	delArgs[0] = userID
	for i, id := range toDeleteIDs {
		delPlaceholders[i] = "?"
		delArgs[i+1] = id
	}
	delQuery := fmt.Sprintf(`DELETE FROM snapshots WHERE user_id = ? AND id IN (%s)`, strings.Join(delPlaceholders, ","))
	if _, err := tx.Exec(delQuery, delArgs...); err != nil {
		return 0, 0, fmt.Errorf("批量清理快照元数据失败: %w", err)
	}

	// 5. 原子扣减用户已用配额
	if _, err := tx.Exec(`UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?`, totalFreedBytes, userID); err != nil {
		return 0, 0, fmt.Errorf("批量返还存储配额失败: %w", err)
	}

	// 6. 提交事务
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("提交批量删除事务失败: %w", err)
	}

	// 7. 物理删除磁盘文件（事务提交确认后再落盘删除）
	for _, id := range toDeleteIDs {
		filePath := filepath.Join(m.dataDir, userID, id+".bin")
		_ = os.Remove(filePath)
	}

	return len(toDeleteIDs), totalFreedBytes, nil
}
