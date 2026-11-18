package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"sync-server/internal/auth"
)

type contextKey string

const (
	contextKeyUserID   contextKey = "userID"
	contextKeyDeviceID contextKey = "deviceID"
)

// GetUserIDFromContext 从上下文读取已认证用户ID
func GetUserIDFromContext(ctx context.Context) string {
	if v := ctx.Value(contextKeyUserID); v != nil {
		return v.(string)
	}
	return ""
}

// GetDeviceIDFromContext 从上下文读取已认证设备ID
func GetDeviceIDFromContext(ctx context.Context) string {
	if v := ctx.Value(contextKeyDeviceID); v != nil {
		return v.(string)
	}
	return ""
}

// DynamicCORSMiddleware 支持动态获取域名白名单的热重载跨域中间件
func DynamicCORSMiddleware(getOrigins func() []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				allowedOrigins := getOrigins()
				allowAll := false
				for _, o := range allowedOrigins {
					if o == "*" {
						allowAll = true
						break
					}
				}

				matched := false
				if allowAll {
					matched = true
				} else {
					for _, o := range allowedOrigins {
						if o == origin {
							matched = true
							break
						}
					}
				}

				if matched {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Requested-With, Range, X-Target-Url, X-Upstream-Url, X-Api-Key, X-Sync-Token")
					w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
					w.Header().Set("Access-Control-Max-Age", "86400")
				}
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// CORSMiddleware 静态跨域中间件（向下兼容静态数组与测试）
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return DynamicCORSMiddleware(func() []string {
		return allowedOrigins
	})
}

// RecoverMiddleware 异常捕获中间件，杜绝崩溃并统一返回 500
func RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[PANIC RECOVER] %v\n", rec)
				JSONError(w, http.StatusInternalServerError, "INTERNAL", "服务器内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// AuthMiddleware 设备令牌鉴权中间件
func AuthMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				JSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "缺少有效的身份令牌")
				return
			}

			token := strings.TrimPrefix(authHeader, "Bearer ")
			tokenHash := auth.HashToken(token)

			var userID, deviceID string
			var userDisabled int
			var lockedUntil sql.NullInt64

			query := `
				SELECT d.user_id, d.id, u.disabled, u.locked_until
				FROM devices d
				JOIN users u ON d.user_id = u.id
				WHERE d.token_hash = ? AND d.revoked_at IS NULL
			`
			err := db.QueryRow(query, tokenHash).Scan(&userID, &deviceID, &userDisabled, &lockedUntil)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					JSONError(w, http.StatusUnauthorized, "UNAUTHORIZED", "令牌已失效或设备已被吊销")
					return
				}
				JSONError(w, http.StatusInternalServerError, "INTERNAL", "鉴权数据库查询失败")
				return
			}

			if userDisabled == 1 {
				JSONError(w, http.StatusForbidden, "AUTH_FAILED", "用户账号已被停用")
				return
			}

			// 注意：lockedUntil 仅针对登录密码输错实施人机交互拦截，
			// 绝不可用于阻断已持有高熵 Token 的受信设备，杜绝针对特定用户名的反向 DoS 锁定漏洞。

			// 异步更新设备最后活跃时间与 IP
			clientIP := GetClientIP(r)
			go func() {
				_, _ = db.Exec(
					`UPDATE devices SET last_seen_at = ?, last_ip = ? WHERE id = ?`,
					time.Now().Unix(), clientIP, deviceID,
				)
			}()

			ctx := context.WithValue(r.Context(), contextKeyUserID, userID)
			ctx = context.WithValue(ctx, contextKeyDeviceID, deviceID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetClientIP 提取请求端真实 IP (优先受信任反代传递的 X-Real-IP，彻底防范 XFF 伪造绕过限流)
func GetClientIP(r *http.Request) string {
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
