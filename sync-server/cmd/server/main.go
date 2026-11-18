package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/pbkdf2"

	"sync-server/internal/auth"
	"sync-server/internal/config"
	"sync-server/internal/httpapi"
	"sync-server/internal/relay"
	"sync-server/internal/snapshot"
	"sync-server/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		// 默认直接进入交互式控制台，最适合服务器与本地双击
		interactiveConsole()
		return
	}

	command := os.Args[1]

	switch command {
	case "manage", "console":
		interactiveConsole()
	case "serve":
		serveCmd(os.Args[2:])
	case "invite":
		inviteCmd(os.Args[2:])
	case "user":
		userCmd(os.Args[2:])
	case "-h", "--help", "help":
		printUsage()
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println("=================================================================================")
	fmt.Println("  智能摸鱼云同步服务 (sync-server) 管理工具")
	fmt.Println("=================================================================================")
	fmt.Println("服务启动:")
	fmt.Println("  sync-server serve [-config=config.json]             启动云同步后台服务")
	fmt.Println()
	fmt.Println("邀请码管理 (Invite):")
	fmt.Println("  sync-server invite create [-days=7] [-note=\"备注\"]  生成新邀请码")
	fmt.Println("  sync-server invite list                             查看邀请码列表 (明文、备注与使用账号)")
	fmt.Println("  sync-server invite revoke <code>                    作废指定的未使用的邀请码")
	fmt.Println()
	fmt.Println("用户管理与数据看板 (User):")
	fmt.Println("  sync-server user list                               查看所有用户数据统计看板 (会话/存储/状态)")
	fmt.Println("  sync-server user add <用户名> <密码> [-quota=200] [-note=\"备注\"]  直接创建新用户 (免邀请码)")
	fmt.Println("  sync-server user note <用户名> <备注内容>           修改用户备注说明")
	fmt.Println("  sync-server user quota <用户名> <配额MB>            调整用户存储配额")
	fmt.Println("  sync-server user unlock <用户名>                    解除用户防爆破锁定状态")
	fmt.Println("  sync-server user enable <用户名>                    启用被禁用的用户")
	fmt.Println("  sync-server user disable <用户名>                   禁用指定用户")
	fmt.Println("  sync-server user reset-pwd <用户名> <新密码>        管理员重置用户密码")
	fmt.Println("  sync-server user clear <用户名>                     清空该用户的云端快照数据 (重置存储)")
	fmt.Println("  sync-server user delete <用户名>                    彻底删除用户账号及所有云端快照")
	fmt.Println("=================================================================================")
}

// -------------------------------------------------------------
// 服务启动命令
// -------------------------------------------------------------
func serveCmd(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "配置文件路径")
	_ = fs.Parse(args)

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	db, err := store.OpenDB(cfg.DataDir)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	defer db.Close()

	snapMgr := snapshot.NewManager(db.DB, cfg.DataDir, cfg.MaxSnapshotBytes, cfg.MaxSnapshotsPerUser, cfg.MaxTotalStorageBytes)
	relayMgr := relay.NewManager(db.DB, cfg)
	relayMgr.StartCleaner()
	defer relayMgr.Stop()

	api := httpapi.NewServerAPI(cfg, db.DB, snapMgr, relayMgr)

	// 启动 1 分钟文件监听热重载 (修改保存 config.json 即自动生效，免重启服务)
	watcher := config.NewConfigWatcher(*configPath, cfg)
	watcher.Start()
	defer watcher.Stop()
	api.AttachWatcher(watcher)

	handler := api.RegisterRoutes()

	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,  // 仅限制请求头读取时限，防御 Slowloris 慢速攻击
		ReadTimeout:       600 * time.Second, // 保证大快照上传 (POST) 不被掐断
		WriteTimeout:      0,                  // 关键！0 = 不限制写响应总时长，彻底根除慢速/移动端大文件下载被 60s 掐断的缺陷
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("====================================================")
	log.Printf(" 智能摸鱼云同步服务已启动")
	log.Printf(" 监听地址: %s", cfg.Listen)
	log.Printf(" 数据目录: %s", cfg.DataDir)
	log.Printf(" 跨域策略: %v (通配或白名单)", cfg.AllowedOrigins)
	log.Printf(" 限流熔断: %d 次/分 (熔断冷却: %d 秒)", cfg.RateLimit.RequestsPerMinute, cfg.RateLimit.CooldownSeconds)
	limitDesc := "不限制"
	if cfg.MaxTotalStorageBytes > 0 {
		limitDesc = fmt.Sprintf("%.2f MB", float64(cfg.MaxTotalStorageBytes)/(1024*1024))
	}
	log.Printf(" 快照限制: 单包上限 %d MB, 全服总存储上限: %s", cfg.MaxSnapshotBytes/(1024*1024), limitDesc)
	aiRelayDesc := "已关闭"
	if cfg.AIRelay.Enabled {
		aiRelayDesc = fmt.Sprintf("已开启 (保存%d小时, 最多%d条, 默认非流式:%v, 默认上游:%s)",
			cfg.AIRelay.TTLHours, cfg.AIRelay.MaxTasks, cfg.AIRelay.ForceNonStream, cfg.AIRelay.DefaultUpstream)
	}
	log.Printf(" AI中转:   %s", aiRelayDesc)
	log.Printf(" 热重载:   已启用 (每 1 分钟自动检查 %s 变更并动态热生效)", *configPath)
	log.Printf("====================================================")

	if cfg.TLS.Enabled && cfg.TLS.CertFile != "" && cfg.TLS.KeyFile != "" {
		if err := server.ListenAndServeTLS(cfg.TLS.CertFile, cfg.TLS.KeyFile); err != nil && err != http.ErrServerClosed {
			log.Fatalf("TLS 服务启动异常: %v", err)
		}
	} else {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务启动异常: %v", err)
		}
	}
}

// -------------------------------------------------------------
// 邀请码管理
// -------------------------------------------------------------
func inviteCmd(args []string) {
	if len(args) == 0 {
		fmt.Println("用法: sync-server invite [create|list|revoke]")
		return
	}

	cfg, err := config.LoadConfig("config.json")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := store.OpenDB(cfg.DataDir)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	defer db.Close()

	switch args[0] {
	case "create":
		days := 7
		note := ""
		for _, a := range args[1:] {
			if strings.HasPrefix(a, "-days=") {
				_, _ = fmt.Sscanf(a, "-days=%d", &days)
			} else if strings.HasPrefix(a, "-note=") {
				note = strings.TrimPrefix(a, "-note=")
				note = strings.Trim(note, "\"'")
			}
		}

		rawBytes := make([]byte, 16)
		_, _ = rand.Read(rawBytes)
		code := hex.EncodeToString(rawBytes)
		codeHash := sha256.Sum256([]byte(code))

		now := time.Now().Unix()
		expiresAt := now + int64(days*86400)

		_, err := db.Exec(
			`INSERT INTO invites (code_hash, raw_code, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
			codeHash[:], code, note, now, expiresAt,
		)
		if err != nil {
			log.Fatalf("写入邀请码失败: %v", err)
		}

		fmt.Println("==================================================")
		fmt.Printf(" 成功生成注册邀请码！\n")
		fmt.Printf(" 邀请码: >> %s <<\n", code)
		if note != "" {
			fmt.Printf(" 备  注: %s\n", note)
		}
		fmt.Printf(" 有效期: %d 天 (至 %s)\n", days, time.Unix(expiresAt, 0).Format("2006-01-02 15:04:05"))
		fmt.Println("==================================================")

	case "list":
		rows, err := db.Query(`
			SELECT i.code_hash, i.raw_code, i.note, i.created_at, i.expires_at, i.used_by, i.used_at, u.username
			FROM invites i
			LEFT JOIN users u ON i.used_by = u.id
			ORDER BY i.created_at DESC
		`)
		if err != nil {
			log.Fatalf("查询邀请码失败: %v", err)
		}
		defer rows.Close()

		fmt.Println("=========================================================================================================")
		fmt.Println(" 注册邀请码管理列表")
		fmt.Println("=========================================================================================================")
		fmt.Printf("%-34s | %-12s | %-19s | %-19s | %s\n", "邀请码 (Code)", "备注", "创建时间", "有效期至", "使用状态 / 归属账号")
		fmt.Println("-----------------------------------+--------------+---------------------+---------------------+----------------------------------")

		count := 0
		for rows.Next() {
			var codeHash []byte
			var rawCode, note, usedBy, username sql.NullString
			var createdAt, expiresAt int64
			var usedAt sql.NullInt64

			if err := rows.Scan(&codeHash, &rawCode, &note, &createdAt, &expiresAt, &usedBy, &usedAt, &username); err != nil {
				continue
			}
			count++

			displayCode := rawCode.String
			if displayCode == "" {
				displayCode = hex.EncodeToString(codeHash)[:12] + "..."
			}

			displayNote := "-"
			if note.Valid && note.String != "" {
				displayNote = note.String
			}

			status := "未使用"
			if usedBy.Valid {
				if username.Valid && username.String != "" {
					status = fmt.Sprintf("已使用 (账号: %s)", username.String)
				} else {
					status = fmt.Sprintf("已使用 (ID: %s)", usedBy.String[:8])
				}
			} else if expiresAt < time.Now().Unix() {
				status = "已过期"
			}

			fmt.Printf("%-34s | %-12s | %-19s | %-19s | %s\n",
				displayCode,
				truncateString(displayNote, 12),
				time.Unix(createdAt, 0).Format("2006-01-02 15:04:05"),
				time.Unix(expiresAt, 0).Format("2006-01-02 15:04:05"),
				status,
			)
		}

		if count == 0 {
			fmt.Println("  (暂无邀请码记录)")
		}
		fmt.Println("=========================================================================================================")

	case "revoke":
		if len(args) < 2 {
			fmt.Println("用法: sync-server invite revoke <code>")
			return
		}
		targetCode := strings.TrimSpace(args[1])
		targetHash := sha256.Sum256([]byte(targetCode))

		res, err := db.Exec(
			`DELETE FROM invites WHERE (raw_code = ? OR code_hash = ?) AND used_by IS NULL`,
			targetCode, targetHash[:],
		)
		if err != nil {
			log.Fatalf("作废邀请码失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Println("未找到匹配的未使用邀请码（可能已使用或不存在）")
		} else {
			fmt.Printf("成功作废 %d 个未使用的邀请码\n", affected)
		}
	}
}

// -------------------------------------------------------------
// 用户综合管理与数据看板
// -------------------------------------------------------------
func userCmd(args []string) {
	if len(args) == 0 {
		fmt.Println("用法: sync-server user [list|add|note|quota|clear|delete|unlock|enable|disable|reset-pwd]")
		return
	}

	cfg, err := config.LoadConfig("config.json")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := store.OpenDB(cfg.DataDir)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	defer db.Close()

	sub := args[0]

	switch sub {
	// 1. 用户列表数据看板
	case "list":
		query := `
			SELECT 
				u.id, u.username, u.disabled, u.failed_count, u.locked_until, u.quota_bytes, u.used_bytes, 
				u.note, u.invite_code, u.created_at,
				(SELECT COUNT(*) FROM snapshots s WHERE s.user_id = u.id) AS snap_count,
				(SELECT COALESCE(SUM(s.conversation_count), 0) FROM snapshots s WHERE s.user_id = u.id) AS conv_count,
				(SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS dev_count,
				(SELECT MAX(d.last_seen_at) FROM devices d WHERE d.user_id = u.id) AS last_seen
			FROM users u
			ORDER BY u.created_at DESC
		`
		rows, err := db.Query(query)
		if err != nil {
			log.Fatalf("查询用户列表失败: %v", err)
		}
		defer rows.Close()

		fmt.Println("==================================================================================================================================")
		fmt.Println("  智能摸鱼云同步服务 - 用户数据看板")
		fmt.Println("==================================================================================================================================")
		fmt.Printf("%-16s | %-12s | %-8s | %-18s | %-6s | %-6s | %-24s | %-4s | %-19s\n",
			"用户名", "备注", "状态", "来源邀请码", "快照数", "会话数", "存储空间 (已用/总配额)", "设备", "注册时间")
		fmt.Println("-----------------+--------------+----------+--------------------+--------+--------+--------------------------+------+--------------------")

		count := 0
		now := time.Now().Unix()
		for rows.Next() {
			var id, username string
			var disabled, failedCount int
			var lockedUntil sql.NullInt64
			var quotaBytes, usedBytes, createdAt int64
			var note, inviteCode sql.NullString
			var snapCount, convCount, devCount int
			var lastSeen sql.NullInt64

			if err := rows.Scan(
				&id, &username, &disabled, &failedCount, &lockedUntil, &quotaBytes, &usedBytes,
				&note, &inviteCode, &createdAt,
				&snapCount, &convCount, &devCount, &lastSeen,
			); err != nil {
				continue
			}
			count++

			// 状态判定
			status := "正常"
			if disabled == 1 {
				status = "已禁用"
			} else if lockedUntil.Valid && lockedUntil.Int64 > now {
				status = "锁定中"
			}

			displayNote := "-"
			if note.Valid && note.String != "" {
				displayNote = note.String
			}

			displayInvite := "直接创建"
			if inviteCode.Valid && inviteCode.String != "" {
				displayInvite = inviteCode.String
			}

			storageStr := formatStorage(usedBytes, quotaBytes)

			fmt.Printf("%-16s | %-12s | %-8s | %-18s | %-6d | %-6d | %-24s | %-4d | %-19s\n",
				truncateString(username, 16),
				truncateString(displayNote, 12),
				status,
				truncateString(displayInvite, 18),
				snapCount,
				convCount,
				storageStr,
				devCount,
				time.Unix(createdAt, 0).Format("2006-01-02 15:04:05"),
			)
		}

		if count == 0 {
			fmt.Println("  (当前暂无注册用户)")
		}
		var totalSnapshotsSize int64
		var totalSnapshotsCount int
		var totalConversationsCount int
		_ = db.QueryRow(`SELECT COALESCE(SUM(size), 0), COUNT(*), COALESCE(SUM(conversation_count), 0) FROM snapshots`).Scan(&totalSnapshotsSize, &totalSnapshotsCount, &totalConversationsCount)
		fmt.Println("==================================================================================================================================")
		fmt.Println(" 全服数据汇总统计:")
		fmt.Printf("   注册用户数: %d 位\n", count)
		fmt.Printf("   全服快照数: %d 份 (累计包含 %d 个会话)\n", totalSnapshotsCount, totalConversationsCount)
		if cfg.MaxTotalStorageBytes > 0 {
			pct := float64(totalSnapshotsSize) / float64(cfg.MaxTotalStorageBytes) * 100
			fmt.Printf("   全服总存储: %.2f MB / %.2f MB (%.1f%%) [上限配置: %d 字节]\n",
				float64(totalSnapshotsSize)/(1024*1024), float64(cfg.MaxTotalStorageBytes)/(1024*1024), pct, cfg.MaxTotalStorageBytes)
		} else {
			fmt.Printf("   全服总存储: %.2f MB [未开启全服存储上限]\n", float64(totalSnapshotsSize)/(1024*1024))
		}
		fmt.Println("==================================================================================================================================")

	// 2. 管理员直接创建用户
	case "add":
		if len(args) < 3 {
			fmt.Println("用法: sync-server user add <用户名> <密码> [-quota=200] [-note=\"备注\"]")
			return
		}
		username := strings.TrimSpace(args[1])
		password := strings.TrimSpace(args[2])
		quotaMB := int64(200)
		note := ""

		for _, a := range args[3:] {
			if strings.HasPrefix(a, "-quota=") {
				_, _ = fmt.Sscanf(a, "-quota=%d", &quotaMB)
			} else if strings.HasPrefix(a, "-note=") {
				note = strings.TrimPrefix(a, "-note=")
				note = strings.Trim(note, "\"'")
			}
		}

		if len(username) < 3 || len(username) > 32 {
			fmt.Println("错误: 用户名长度需为 3~32 个字符")
			return
		}
		if len(password) < 6 {
			fmt.Println("错误: 密码长度至少需为 6 个字符")
			return
		}

		// 检查用户名是否已存在
		var existsID string
		err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&existsID)
		if err == nil {
			fmt.Printf("错误: 用户名 [%s] 已存在，无法重复创建\n", username)
			return
		}

		// 1. 生成 16 字节随机 kdfSalt
		kdfSalt, err := auth.GenerateRandomBytes(16)
		if err != nil {
			log.Fatalf("生成盐失败: %v", err)
		}

		// 2. PBKDF2(SHA-256) 派生 masterKey (600,000次迭代)
		masterKey := pbkdf2.Key([]byte(password), kdfSalt, 600000, 32, sha256.New)

		// 3. PBKDF2 派生 authHash (masterKey 作为 password，原 password 作为 salt，iter=1)
		authHash := pbkdf2.Key(masterKey, []byte(password), 1, 32, sha256.New)

		// 4. 服务端生成 16 字节 authSalt 并进行 Argon2id 哈希
		authSalt, err := auth.GenerateRandomBytes(16)
		if err != nil {
			log.Fatalf("生成服务端盐失败: %v", err)
		}
		storedHash := auth.HashAuthSecret(authHash, authSalt)

		userID := uuid.NewString()
		now := time.Now().Unix()
		quotaBytes := quotaMB * 1024 * 1024

		_, err = db.Exec(
			`INSERT INTO users (id, username, kdf_salt, kdf_iter, auth_hash, auth_salt, quota_bytes, note, invite_code, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, username, kdfSalt, 600000, storedHash, authSalt, quotaBytes, note, "管理员后台创建", now,
		)
		if err != nil {
			log.Fatalf("创建用户入库失败: %v", err)
		}

		fmt.Println("==================================================")
		fmt.Printf(" 成功创建新用户！\n")
		fmt.Printf(" 用 户 名: %s\n", username)
		fmt.Printf(" 初始密码: %s\n", password)
		if note != "" {
			fmt.Printf(" 备    注: %s\n", note)
		}
		fmt.Printf(" 存储配额: %d MB\n", quotaMB)
		fmt.Println(" 说明: 该账号已按照端到端加密规范派生入库，可直接在客户端登录！")
		fmt.Println("==================================================")

	// 3. 修改备注
	case "note":
		if len(args) < 3 {
			fmt.Println("用法: sync-server user note <用户名> <备注内容>")
			return
		}
		username := strings.TrimSpace(args[1])
		note := strings.TrimSpace(args[2])

		res, err := db.Exec(`UPDATE users SET note = ? WHERE username = ?`, note, username)
		if err != nil {
			log.Fatalf("更新备注失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Printf("未找到用户: %s\n", username)
		} else {
			fmt.Printf("用户 [%s] 备注已更新为: %s\n", username, note)
		}

	// 4. 调整配额
	case "quota":
		if len(args) < 3 {
			fmt.Println("用法: sync-server user quota <用户名> <配额MB>")
			return
		}
		username := strings.TrimSpace(args[1])
		var quotaMB int64
		_, err := fmt.Sscanf(args[2], "%d", &quotaMB)
		if err != nil || quotaMB <= 0 {
			fmt.Println("配额需为大于 0 的整数 (MB)")
			return
		}
		quotaBytes := quotaMB * 1024 * 1024
		res, err := db.Exec(`UPDATE users SET quota_bytes = ? WHERE username = ?`, quotaBytes, username)
		if err != nil {
			log.Fatalf("更新配额失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Printf("未找到用户: %s\n", username)
		} else {
			fmt.Printf("用户 [%s] 配额已更新为 %d MB\n", username, quotaMB)
		}

	// 5. 清空用户的云端快照数据
	case "clear":
		if len(args) < 2 {
			fmt.Println("用法: sync-server user clear <用户名>")
			return
		}
		username := strings.TrimSpace(args[1])

		var userID string
		err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&userID)
		if err != nil {
			fmt.Printf("未找到用户: %s\n", username)
			return
		}

		// 物理删除快照文件目录
		userDir := filepath.Join(cfg.DataDir, userID)
		_ = os.RemoveAll(userDir)
		_ = os.RemoveAll(filepath.Join(cfg.DataDir, "snapshots", userID))

		// 清理数据库记录（事务保障）
		tx, err := db.Begin()
		if err != nil {
			log.Fatalf("开启事务失败: %v", err)
		}
		if _, err := tx.Exec(`DELETE FROM snapshots WHERE user_id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("清空快照记录失败: %v", err)
		}
		if _, err := tx.Exec(`UPDATE users SET used_bytes = 0 WHERE id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("重置用户存储配额失败: %v", err)
		}
		if err := tx.Commit(); err != nil {
			log.Fatalf("提交事务失败: %v", err)
		}

		fmt.Printf("用户 [%s] 的所有云端快照数据已彻底清空，已占用空间重置为 0 MB。\n", username)

	// 6. 彻底删除用户
	case "delete":
		if len(args) < 2 {
			fmt.Println("用法: sync-server user delete <用户名>")
			return
		}
		username := strings.TrimSpace(args[1])

		var userID string
		err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&userID)
		if err != nil {
			fmt.Printf("未找到用户: %s\n", username)
			return
		}

		// 物理删除快照文件目录
		userDir := filepath.Join(cfg.DataDir, userID)
		_ = os.RemoveAll(userDir)
		_ = os.RemoveAll(filepath.Join(cfg.DataDir, "snapshots", userID))

		// 级联清理数据库记录（事务保障）
		tx, err := db.Begin()
		if err != nil {
			log.Fatalf("开启事务失败: %v", err)
		}
		if _, err := tx.Exec(`DELETE FROM snapshots WHERE user_id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("删除快照记录失败: %v", err)
		}
		if _, err := tx.Exec(`DELETE FROM devices WHERE user_id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("删除设备记录失败: %v", err)
		}
		if _, err := tx.Exec(`DELETE FROM audit_log WHERE user_id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("删除审计日志失败: %v", err)
		}
		if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, userID); err != nil {
			_ = tx.Rollback()
			log.Fatalf("删除用户账号失败: %v", err)
		}
		if err := tx.Commit(); err != nil {
			log.Fatalf("提交事务失败: %v", err)
		}

		fmt.Printf("用户 [%s] 及其所有设备凭据、审计日志与云端快照已彻底删除！\n", username)

	// 7. 解锁防爆破
	case "unlock":
		if len(args) < 2 {
			fmt.Println("用法: sync-server user unlock <用户名>")
			return
		}
		username := strings.TrimSpace(args[1])
		res, err := db.Exec(`UPDATE users SET failed_count = 0, locked_until = NULL WHERE username = ?`, username)
		if err != nil {
			log.Fatalf("解锁失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Printf("未找到用户: %s\n", username)
		} else {
			fmt.Printf("用户 [%s] 锁定状态已解除，密码输错计数已归零。\n", username)
		}

	// 8. 启用用户
	case "enable":
		if len(args) < 2 {
			fmt.Println("用法: sync-server user enable <用户名>")
			return
		}
		username := strings.TrimSpace(args[1])
		res, err := db.Exec(`UPDATE users SET disabled = 0 WHERE username = ?`, username)
		if err != nil {
			log.Fatalf("启用用户失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Printf("未找到用户: %s\n", username)
		} else {
			fmt.Printf("用户 [%s] 已重新启用！\n", username)
		}

	// 9. 禁用用户
	case "disable":
		if len(args) < 2 {
			fmt.Println("用法: sync-server user disable <用户名>")
			return
		}
		username := strings.TrimSpace(args[1])
		res, err := db.Exec(`UPDATE users SET disabled = 1 WHERE username = ?`, username)
		if err != nil {
			log.Fatalf("禁用用户失败: %v", err)
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			fmt.Printf("未找到用户: %s\n", username)
		} else {
			fmt.Printf("用户 [%s] 已被禁用（禁止登录与上传）\n", username)
		}

	// 10. 重置密码
	case "reset-pwd":
		if len(args) < 3 {
			fmt.Println("用法: sync-server user reset-pwd <用户名> <新密码>")
			return
		}
		username := strings.TrimSpace(args[1])
		newPassword := strings.TrimSpace(args[2])
		if len(newPassword) < 6 {
			fmt.Println("错误: 新密码长度至少需为 6 个字符")
			return
		}

		var userID string
		err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&userID)
		if err != nil {
			fmt.Printf("未找到用户: %s\n", username)
			return
		}

		// 重新生成盐与派生哈希
		kdfSalt, _ := auth.GenerateRandomBytes(16)
		masterKey := pbkdf2.Key([]byte(newPassword), kdfSalt, 600000, 32, sha256.New)
		authHash := pbkdf2.Key(masterKey, []byte(newPassword), 1, 32, sha256.New)
		authSalt, _ := auth.GenerateRandomBytes(16)
		storedHash := auth.HashAuthSecret(authHash, authSalt)

		_, err = db.Exec(
			`UPDATE users SET kdf_salt = ?, auth_hash = ?, auth_salt = ?, failed_count = 0, locked_until = NULL WHERE id = ?`,
			kdfSalt, storedHash, authSalt, userID,
		)
		if err != nil {
			log.Fatalf("重置密码失败: %v", err)
		}

		// 吊销现有所有设备令牌，要求重新登录
		_, _ = db.Exec(`UPDATE devices SET revoked_at = ? WHERE user_id = ?`, time.Now().Unix(), userID)

		fmt.Printf("用户 [%s] 密码已成功重置！已强制吊销其所有历史登录会话，需使用新密码重新登录。\n", username)

	default:
		fmt.Printf("未知子命令: %s\n", sub)
		printUsage()
	}
}

// 辅助：格式化存储容量
func formatStorage(used, quota int64) string {
	usedMB := float64(used) / (1024 * 1024)
	quotaMB := float64(quota) / (1024 * 1024)
	pct := float64(0)
	if quota > 0 {
		pct = (float64(used) / float64(quota)) * 100
	}
	return fmt.Sprintf("%.2f MB / %.0f MB (%.1f%%)", usedMB, quotaMB, pct)
}

// 辅助：安全截断字符串并对齐
func truncateString(s string, maxLen int) string {
	r := []rune(s)
	if len(r) > maxLen {
		return string(r[:maxLen-2]) + ".."
	}
	return s
}
