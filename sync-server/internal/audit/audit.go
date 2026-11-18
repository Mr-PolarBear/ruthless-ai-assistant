package audit

import (
	"database/sql"
	"time"
)

// Log 异步记录一条审计日志
func Log(db *sql.DB, userID, deviceID, action, ip, detail string) {
	go func() {
		now := time.Now().Unix()
		_, _ = db.Exec(
			`INSERT INTO audit_log (user_id, device_id, action, ip, at, detail) VALUES (?, ?, ?, ?, ?, ?)`,
			userID, deviceID, action, ip, now, detail,
		)
	}()
}
