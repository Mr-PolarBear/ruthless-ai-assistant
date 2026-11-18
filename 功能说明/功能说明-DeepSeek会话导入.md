# 功能说明 - DeepSeek 官方导出会话导入

> 工具箱（`#tool-box-btn`）下的"DeepSeek 会话导入"工具：上传 DeepSeek 官方导出的会话文件夹，批量识别 JSON、列表预览、逐条查看、导入为本系统会话。

## 1. 文件分工（控大防膨）

| 文件 | 职责 |
|------|------|
| `js/modals/deepseek-import-core.js` | **纯逻辑层**：结构校验、`parent_id` 分支建树、附件路径索引、`convertSession`/`convertMessage` 转换。**零 DOM 依赖**，可被 node 测试脚本直接断言 |
| `js/modals/deepseek-import-modal.js` | **交互层**：弹窗开关、文件选择、列表/预览渲染、导入编排 |
| `css/deepseek-import.css` | 弹窗样式（全 CSS 变量，双主题自适应） |
| `modals.html` 尾部 `#deepseek-import-modal` | 弹窗骨架（双栏布局） |
| `js/tools-manager.js` TOOLS 数组 | 入口挂载，`import()` 懒加载模块 |
| `scripts/test-deepseek-import.js` | node 断言脚本：`node scripts/test-deepseek-import.js [chat_sessions目录]` 可全量验证真实导出文件 |

## 2. DeepSeek 导出格式（实测确认）

```json
{ "id": "uuid", "title": "标题", "pinned": false,
  "inserted_at": "ISO", "updated_at": "ISO",
  "current_message_id": 8,
  "messages": [
    { "id": 5, "parent_id": 4, "role": "USER|ASSISTANT",
      "status": "FINISHED|TIMEOUT|INCOMPLETE|FAILED|CONTENT_FILTER",
      "accumulated_token_usage": 14229, "inserted_at": "ISO",
      "fragments": [
        { "type": "REQUEST", "content": "用户文本" },
        { "type": "FILE", "files": [{ "file_name": "x.png", "file_size": 24870,
            "export_path": "chat_sessions/<convId>_files/<uuid>_x.png",
            "is_image": true, "width": 481, "height": 533 }] },
        { "type": "THINK", "content": "思维链" },
        { "type": "RESPONSE", "content": "AI markdown 正文" },
        { "type": "TEMPLATE_RESPONSE", "content": "拒答/服务器繁忙话术" },
        { "type": "TOOL_SEARCH", "queries": [], "results": [{ "url": "", "title": "", "snippet": "", "site_name": "" }] },
        { "type": "TOOL_OPEN", "url": "", "title": "", "snippet": "" },
        { "type": "CONTENT_RISK", "content": "AI生成声明", "style": "WARNING" },
        { "type": "PARTIAL_FILE_READ", "ratio": 2.27 }
      ] }
  ] }
```

**关键事实（不要用错）**：
- 分支 = 同一 `parent_id` 的兄弟节点（重新生成的回复）；`current_message_id` 指向当前可见链的**叶子**，无任何 selected/variant 标记字段；
- 附件仅 `is_image=true` 有 `export_path` 且文件真实存在于 `<convId>_files/`；**非图片附件 `export_path: null`——DeepSeek 不导出文档内容**，只有元数据；
- `TEMPLATE_RESPONSE` 是拒答（CONTENT_FILTER）/繁忙时用户真正看到的文案，**当 RESPONSE 缺失时必须兜底为 AI 正文**；
- `CONTENT_RISK`/`PARTIAL_FILE_READ` 纯元数据，忽略。

## 3. 转换映射（core.js 唯一权威实现）

| DeepSeek | 系统 |
|----------|------|
| `id` | `conv.id = 'ds_<uuid>'`（重复导入走系统冲突弹窗/副本） |
| `title` / `updated_at` / `pinned` | `conv.title` / `lastModified` / `pinned` |
| root→leaf 每条路径 | `conv.branches[i]`（分支全量消息数组） |
| `current_message_id` 路径 | `conv.activeBranchIndex` |
| `REQUEST.content` | `msg.role='user' + content` |
| `RESPONSE.content` ?? `TEMPLATE_RESPONSE.content` | `msg.role='assistant' + content + originalContent` |
| `THINK.content` | `msg.reasoningParts[{content,source:'deepseek-import',order}]` |
| `accumulated_token_usage` | `msg.stats.tokenCount` |
| `status !== FINISHED` | `msg.importStatus`（自定义标记，渲染忽略） |
| `FILE.files` | 图片可选嵌入 `attachments[{isImage:true,base64}]`（默认关）；否则尾部 `【附件: 名】` 标注 |
| `TOOL_*` | 默认跳过；勾选时插引用块于正文头（`buildSearchRefBlock`） |

`conv.apiEndpointId=null`、`importSource='deepseek'`——续聊时按当前选择器端点发送。

## 4. 附件路径索引（fileMap）

用户可能选导出根目录/`chat_sessions`/更深层目录，`webkitRelativePath` 前缀不定。
`registerFile` 统一小写正斜杠后做**双路索引**：`chat_sessions/` 起始后缀 + 文件 basename；
`findAttachedFile` 先精确查 `export_path` 再 basename 兜底。

## 5. 导入落库

转换后收口到 `utils.importConversations(convList, {}, {titleSuffix:' (DeepSeek导入)'})`：
ID 冲突决策弹窗、旧版回收站备份、IndexedDB 落库、侧边栏刷新全部复用现成管道，本工具零侵入。

## 6. 安全与资源注意点

- 预览正文：`marked.parse` + `DOMPurify.sanitize`（不套系统自定义正则，预览=原始内容）；
- 预览手工拼接的 `<a href>` 不走 DOMPurify，统一过 `safeHttpUrl` 只放行 http(s)；
- 预览图片用 `createObjectURL`，切换/关闭时统一 `revoke`；
- `innerHTML` 注入点全部经 `escapeHtml` 或 DOMPurify；
- 弹窗每次打开 `resetState` 全量重置，不残留上次会话。

## 7. 验证清单

- [ ] 列表排序（时间倒序⇄标题）、搜索过滤、勾选联动按钮计数
- [ ] 分支会话：列表"分支×N"徽标、预览分支选择器、导入后系统分支可切换
- [ ] 附件图预览真实显示；缺源文件/文档类显示文字标注
- [ ] 思维链折叠展示；CONTENT_FILTER 拒答会话正文为拒答话术
- [ ] 导入后侧边栏出现会话、可打开、可继续发消息（自动绑当前端点）
- [ ] 重复导入走系统冲突弹窗（ds_uuid 撞 ID）
- [ ] 浅色/深色双主题下无白块、文字清晰
- [ ] `node scripts/test-deepseek-import.js deepseek_data-xxxx/chat_sessions` 全绿
