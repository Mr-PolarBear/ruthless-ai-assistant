package relay

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Handler 封装 AI 中转的 HTTP 交互控制层
type Handler struct {
	mgr *Manager
}

// NewHandler 构建处理器
func NewHandler(mgr *Manager) *Handler {
	return &Handler{mgr: mgr}
}

// HandleSubmitTask 处理 POST /v1/openai/tasks 任务异步提交
func (h *Handler) HandleSubmitTask(w http.ResponseWriter, r *http.Request) {
	// 限制请求体上限为 10MB
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"message": "读取请求体失败或内容超出 10MB 上限",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	targetUpstream := r.Header.Get("X-Target-Url")
	if targetUpstream == "" {
		targetUpstream = r.Header.Get("X-Upstream-Url")
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		if apiKey := r.Header.Get("X-Api-Key"); apiKey != "" {
			authHeader = "Bearer " + strings.TrimSpace(apiKey)
		}
	}

	// 提取可选关联用户标识 (支持 Bearer 上下文或 X-Sync-Token 鉴权反查)
	userID := ""
	if v := r.Context().Value("userID"); v != nil {
		if s, ok := v.(string); ok {
			userID = s
		}
	}
	if userID == "" {
		if syncToken := r.Header.Get("X-Sync-Token"); strings.TrimSpace(syncToken) != "" {
			userID = h.mgr.ResolveUserIDByToken(strings.TrimSpace(syncToken))
		}
	}

	task, err := h.mgr.SubmitTask(r.Context(), userID, targetUpstream, authHeader, bodyBytes)
	if err != nil {
		status := http.StatusInternalServerError
		errType := "server_error"
		if errors.Is(err, ErrRelayDisabled) {
			status = http.StatusForbidden
			errType = "relay_disabled"
		} else if errors.Is(err, ErrUnauthorizedKey) {
			status = http.StatusUnauthorized
			errType = "unauthorized"
		} else if errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrUpstreamNotConfigured) {
			status = http.StatusBadRequest
			errType = "invalid_request_error"
		}
		writeJSON(w, status, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    errType,
			},
		})
		return
	}

	// 秒级返回 task_id 与 id
	writeJSON(w, http.StatusOK, task)
}

// HandleGetTask 处理 GET /v1/openai/tasks/{id} 轮询获取任务状态与增量分片
func (h *Handler) HandleGetTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if strings.TrimSpace(taskID) == "" {
		// 容错尾部斜杠 GET /v1/openai/tasks/ 场景
		h.HandleListTasks(w, r)
		return
	}

	after := 0
	if afterStr := r.URL.Query().Get("after"); afterStr != "" {
		if a, err := strconv.Atoi(afterStr); err == nil && a >= 0 {
			after = a
		}
	}

	taskResp, err := h.mgr.GetTask(taskID, after)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]interface{}{
				"error": map[string]interface{}{
					"message": err.Error(),
					"type":    "not_found",
				},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    "server_error",
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, taskResp)
}

// HandleCancelTask 处理 POST /v1/openai/tasks/{id}/cancel 取消后台任务
func (h *Handler) HandleCancelTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if strings.TrimSpace(taskID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"message": "缺少任务 ID",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	resp, err := h.mgr.CancelTask(taskID)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]interface{}{
				"error": map[string]interface{}{
					"message": err.Error(),
					"type":    "not_found",
				},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    "server_error",
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// HandleListTasks 处理 GET /v1/openai/tasks 获取任务列表
func (h *Handler) HandleListTasks(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}
	status := r.URL.Query().Get("status")

	userID := ""
	if v := r.Context().Value("userID"); v != nil {
		if s, ok := v.(string); ok {
			userID = s
		}
	}
	if userID == "" {
		if syncToken := r.Header.Get("X-Sync-Token"); strings.TrimSpace(syncToken) != "" {
			userID = h.mgr.ResolveUserIDByToken(strings.TrimSpace(syncToken))
		}
	}

	resp, err := h.mgr.ListTasks(limit, status, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    "server_error",
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// HandleDeleteTask 处理 DELETE /v1/openai/tasks/{id} 物理删除指定任务
func (h *Handler) HandleDeleteTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if strings.TrimSpace(taskID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"message": "缺少任务 ID",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	err := h.mgr.DeleteTask(taskID)
	if err != nil {
		if errors.Is(err, ErrTaskNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]interface{}{
				"error": map[string]interface{}{
					"message": err.Error(),
					"type":    "not_found",
				},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    "server_error",
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// HandleChatCompletions 代理处理标准 POST /v1/chat/completions 请求
// — 为什么这么写 —
// 针对没有使用 CatieCli 插件的普通原生客户端（包括本项目的 ruthless-ai-assistant 前端、Chatbox、NextChat 等），
// 提供标准端到端中转，并在服务端后台享受任务化持久缓存与防断线保护。
func (h *Handler) HandleChatCompletions(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024)
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"message": "读取请求体失败或内容超出 10MB 上限",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	var rawBody map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &rawBody); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error": map[string]interface{}{
				"message": "请求体必须为合法 JSON",
				"type":    "invalid_request_error",
			},
		})
		return
	}

	targetUpstream := r.Header.Get("X-Target-Url")
	if targetUpstream == "" {
		targetUpstream = r.Header.Get("X-Upstream-Url")
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		if apiKey := r.Header.Get("X-Api-Key"); apiKey != "" {
			authHeader = "Bearer " + strings.TrimSpace(apiKey)
		}
	}

	userID := ""
	if v := r.Context().Value("userID"); v != nil {
		if s, ok := v.(string); ok {
			userID = s
		}
	}
	if userID == "" {
		if syncToken := r.Header.Get("X-Sync-Token"); strings.TrimSpace(syncToken) != "" {
			userID = h.mgr.ResolveUserIDByToken(strings.TrimSpace(syncToken))
		}
	}

	task, err := h.mgr.SubmitTask(r.Context(), userID, targetUpstream, authHeader, bodyBytes)
	if err != nil {
		status := http.StatusInternalServerError
		errType := "server_error"
		if errors.Is(err, ErrRelayDisabled) {
			status = http.StatusForbidden
			errType = "relay_disabled"
		} else if errors.Is(err, ErrUnauthorizedKey) {
			status = http.StatusUnauthorized
			errType = "unauthorized"
		} else if errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrUpstreamNotConfigured) {
			status = http.StatusBadRequest
			errType = "invalid_request_error"
		}
		writeJSON(w, status, map[string]interface{}{
			"error": map[string]interface{}{
				"message": err.Error(),
				"type":    errType,
			},
		})
		return
	}

	// 判断客户端是否期望流式回传 SSE
	clientStream, _ := rawBody["stream"].(bool)

	if clientStream {
		// 流式回传 SSE（无论上游是流式还是非流式，系统均已准备好分片或合成 chunks）
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
				"error": map[string]interface{}{"message": "服务器不支持流式刷新"},
			})
			return
		}

		after := 0
		ticker := time.NewTicker(60 * time.Millisecond)
		defer ticker.Stop()

		for {
			taskResp, err := h.mgr.GetTask(task.ID, after)
			if err != nil {
				return
			}

			if len(taskResp.Chunks) > 0 {
				for _, chunk := range taskResp.Chunks {
					_, _ = w.Write([]byte(chunk))
				}
				flusher.Flush()
				after = taskResp.NextAfter
			}

			if taskResp.Done {
				break
			}

			select {
			case <-r.Context().Done():
				_, _ = h.mgr.CancelTask(task.ID)
				return
			case <-ticker.C:
			}
		}
		return
	}

	// 非流式等待终态
	ticker := time.NewTicker(80 * time.Millisecond)
	defer ticker.Stop()

	for {
		taskResp, err := h.mgr.GetTask(task.ID, 0)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
				"error": map[string]interface{}{"message": err.Error()},
			})
			return
		}

		if taskResp.Done {
			if taskResp.Status == StatusCompleted {
				writeJSONRaw(w, taskResp.StatusCode, taskResp.Result)
			} else if taskResp.Status == StatusFailed {
				if len(taskResp.Result) > 0 {
					writeJSONRaw(w, taskResp.StatusCode, taskResp.Result)
				} else {
					errMsg := "上游请求失败"
					if taskResp.Error != nil {
						errMsg = *taskResp.Error
					}
					writeJSON(w, taskResp.StatusCode, map[string]interface{}{
						"error": map[string]interface{}{"message": errMsg},
					})
				}
			} else {
				writeJSON(w, 499, map[string]interface{}{
					"error": map[string]interface{}{"message": "任务已取消"},
				})
			}
			return
		}

		select {
		case <-r.Context().Done():
			_, _ = h.mgr.CancelTask(task.ID)
			return
		case <-ticker.C:
		}
	}
}

// writeJSONRaw 直接输出原始字节序列 JSON 响应
func writeJSONRaw(w http.ResponseWriter, status int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// writeJSON 统一输出 JSON 响应辅助函数
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
