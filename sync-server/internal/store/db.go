package store

import (
	"database/sql"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB 封装 SQLite 数据库句柄
type DB struct {
	*sql.DB
}

// OpenDB 连接 SQLite 并自动执行建表迁移
func OpenDB(dataDir string) (*DB, error) {
	dbPath := filepath.Join(dataDir, "sync.db")
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)", filepath.ToSlash(dbPath))

	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}

	// 限制单个写锁连接，WAL 模式下并发读安全
	sqlDB.SetMaxOpenConns(1)

	db := &DB{DB: sqlDB}
	if err := db.migrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("数据库迁移失败: %w", err)
	}

	return db, nil
}

// migrate 执行建表与初始化索引
func (db *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id            TEXT PRIMARY KEY,
		username      TEXT NOT NULL UNIQUE,
		kdf_salt      BLOB NOT NULL,
		kdf_iter      INTEGER NOT NULL,
		auth_hash     BLOB NOT NULL,
		auth_salt     BLOB NOT NULL,
		quota_bytes   INTEGER NOT NULL,
		used_bytes    INTEGER NOT NULL DEFAULT 0,
		disabled      INTEGER NOT NULL DEFAULT 0,
		failed_count  INTEGER NOT NULL DEFAULT 0,
		locked_until  INTEGER,
		note          TEXT,
		invite_code   TEXT,
		created_at    INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS invites (
		code_hash   BLOB PRIMARY KEY,
		raw_code    TEXT,
		note        TEXT,
		created_at  INTEGER NOT NULL,
		expires_at  INTEGER NOT NULL,
		used_by     TEXT,
		used_at     INTEGER
	);

	CREATE TABLE IF NOT EXISTS devices (
		id           TEXT PRIMARY KEY,
		user_id      TEXT NOT NULL REFERENCES users(id),
		name         TEXT NOT NULL,
		token_hash   BLOB NOT NULL UNIQUE,
		created_at   INTEGER NOT NULL,
		last_seen_at INTEGER,
		last_ip      TEXT,
		revoked_at   INTEGER
	);

	CREATE TABLE IF NOT EXISTS snapshots (
		id                 TEXT PRIMARY KEY,
		user_id            TEXT NOT NULL REFERENCES users(id),
		device_id          TEXT NOT NULL REFERENCES devices(id),
		created_at         INTEGER NOT NULL,
		size               INTEGER NOT NULL,
		sha256             BLOB NOT NULL,
		format_version     INTEGER NOT NULL,
		conversation_count INTEGER NOT NULL DEFAULT 0,
		enc_manifest       BLOB NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_snapshots_user_time ON snapshots(user_id, created_at DESC);

	CREATE TABLE IF NOT EXISTS audit_log (
		id        INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id   TEXT,
		device_id TEXT,
		action    TEXT NOT NULL,
		ip        TEXT,
		at        INTEGER NOT NULL,
		detail    TEXT
	);

	CREATE TABLE IF NOT EXISTS ai_tasks (
		id            TEXT PRIMARY KEY,
		user_id       TEXT,
		status        TEXT NOT NULL,
		model         TEXT NOT NULL DEFAULT '',
		upstream_url  TEXT NOT NULL DEFAULT '',
		status_code   INTEGER NOT NULL DEFAULT 200,
		request_body  TEXT NOT NULL,
		response_body TEXT NOT NULL DEFAULT '',
		error_msg     TEXT NOT NULL DEFAULT '',
		chunks_json   TEXT NOT NULL DEFAULT '[]',
		created_at    INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL,
		expires_at    INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_tasks(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_ai_tasks_expires ON ai_tasks(expires_at ASC);
	`
	if _, err := db.Exec(schema); err != nil {
		return err
	}

	// 增量热升级：针对已存在的数据库安全补齐列
	db.addColumnIfNotExists("invites", "raw_code", "TEXT")
	db.addColumnIfNotExists("invites", "note", "TEXT")
	db.addColumnIfNotExists("users", "note", "TEXT")
	db.addColumnIfNotExists("users", "invite_code", "TEXT")
	db.addColumnIfNotExists("snapshots", "conversation_count", "INTEGER NOT NULL DEFAULT 0")

	// 增量将老用户的旧默认配额 500MB (524288000) 统一对齐为 200MB (209715200)
	_, _ = db.Exec("UPDATE users SET quota_bytes = 209715200 WHERE quota_bytes = 524288000")

	return nil
}

func (db *DB) addColumnIfNotExists(table, column, colDef string) {
	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, colDef)
	_, _ = db.Exec(query) // 若已存在则报错并静默忽略，保证幂等性
}
