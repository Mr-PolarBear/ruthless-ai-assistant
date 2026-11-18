package relay

import (
	"encoding/json"
)

// TaskStatus 任务生命周期状态
type TaskStatus string

const (
	// StatusPending 任务已入库排队，等待后台执行
	StatusPending TaskStatus = "pending"
	// StatusProcessing 任务正在向上游 AI 模型发起请求并等待生成
	StatusProcessing TaskStatus = "processing"
	// StatusCompleted 任务生成成功，已保存最终结果
	StatusCompleted TaskStatus = "completed"
	// StatusFailed 任务执行失败（超时、网络故障或上游报错）
	StatusFailed TaskStatus = "failed"
	// StatusCancelled 用户或客户端主动调用取消
	StatusCancelled TaskStatus = "cancelled"
)

// Task 表示单条持久化的 AI 后台任务
type Task struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id,omitempty"`
	Status       TaskStatus `json:"status"`
	Model        string     `json:"model"`
	UpstreamURL  string     `json:"upstream_url"`
	StatusCode   int        `json:"status_code"`
	RequestBody  string     `json:"request_body,omitempty"`
	ResponseBody string     `json:"response_body,omitempty"`
	ErrorMsg     string     `json:"error_msg,omitempty"`
	ChunksJSON   string     `json:"chunks_json,omitempty"`
	CreatedAt    int64      `json:"created_at"`
	UpdatedAt    int64      `json:"updated_at"`
	ExpiresAt    int64      `json:"expires_at"`
}

// SubmitTaskResponse 异步任务提交成功后的秒级响应
// — 为什么这么写 —
// 严格对齐社区 CatieCli / st-catiecli-tasks 规范：客户端发起 POST 提交后秒回 task_id 与 id，
// 双字段同时返回确保同时兼容只读取 id 或只读取 task_id 的各路客户端。
type SubmitTaskResponse struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	Status    string `json:"status"`
	CreatedAt int64  `json:"created_at"`
}

// TaskStatusResponse 轮询获取任务状态与结果数据
// — 为什么这么写 —
// 1. 同时包含 id 与 task_id，保障各路客户端反序列化鲁棒性；
// 2. Chunks 字段不加 omitempty，确保在无分片时序列化为明确的 "chunks": []，防止前端 JS 执行 (env.chunks ?? []) 抛错；
// 3. 包含 status、done、result、next_after，严格支持增量分片拉取与断点续传。
type TaskStatusResponse struct {
	ID         string          `json:"id"`
	TaskID     string          `json:"task_id"`
	Status     TaskStatus      `json:"status"`
	StatusCode int             `json:"status_code"`
	Done       bool            `json:"done"`
	Result     json.RawMessage `json:"result,omitempty"`
	Chunks     []string        `json:"chunks"`
	NextAfter  int             `json:"next_after"`
	Error      *string         `json:"error,omitempty"`
	CreatedAt  int64           `json:"created_at"`
	UpdatedAt  int64           `json:"updated_at,omitempty"`
}

// CancelTaskResponse 取消任务接口响应
type CancelTaskResponse struct {
	ID     string `json:"id"`
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

// TaskListResponse 任务列表分页/综合查看响应
type TaskListResponse struct {
	Total int                   `json:"total"`
	Tasks []*TaskStatusResponse `json:"tasks"`
}
