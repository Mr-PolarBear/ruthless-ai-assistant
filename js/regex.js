// regex.js
// This file contains all the regular expressions extracted from the project.

export const regexPatterns = {
  escapeSpecialChars: /[.*+?^${}()|[\]\\]/g,
  timestampFormat: /:/g,
  languageMatch: /language-(\w+)/,
  thinkTag: /<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>\s*/g,
  zeroWidthSpace: /\u200B/g,
  // 乌鸦：新增一个更全面的智能引号匹配，用于显示时高亮。包含了多种语言的引号。
  smartQuotes: /(<[^>]+>)|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(「.*?」)|(『.*?』)|(\uFF02.*?\uFF02)/gim,

  // 用于匹配下划线文本 (__text__)
  underlineText: /__([^_]+)__/g,

  // 用于匹配斜体文本 (*text*)
  // 使用了负向先行断言和负向后行断言，确保只匹配单星号，不匹配双星号（加粗）
  italicText: /(?<!\*)\*([^\*]+)\*(?!\*)/g,

  // 用于匹配Markdown代码块
  codeBlock: /```[\s\S]*?```/g,

  // 乌鸦：新增，用于清理AI返回的、被额外```包裹的“套娃”代码块
  nestedCodeBlock: /^\s*`{3,}\s*\n(```[\s\S]*?```)\s*\n`{3,}\s*$/,

  // 模式3（结构双表记忆）：用于匹配与提取 Markdown 表格各行及表头
  markdownTableRow: /^\|(.+)\|$/gm,
  markdownTableSeparator: new RegExp(`^\\|(?:\\s*:?-+:?\\s*\\|)+$`),
  // 单消息导出 Excel：用于精准检测单行是否为 Markdown 表格行（无全局标志，避免 lastIndex 干扰）
  singleMarkdownTableRow: new RegExp(`^\\|.*\\|$`),
  // 单消息导出：用于精准检测消息开头是否为流式中断未闭合的思考标签（忽略前导空白）
  unclosedThinkLeading: new RegExp(`^\\s*<(?:think|thinking)\\b[^>]*>[\\s\\S]*$`, 'i'),
  // 单消息导出及消息清洗：匹配思考标签的闭合标签（用于流式截断错位恢复）
  thinkCloseTag: new RegExp(`</(?:think|thinking)>`, 'i'),
  eventHistoryHeader: new RegExp(`#{1,4}\\s*(?:历史记录表|事件记录表)`, 'i'),
  characterInfoHeader: new RegExp(`#{1,4}\\s*(?:最新角色信息表|最新实体信息表|角色信息表|实体信息表)`, 'i'),

  // 单消息导出 Word/Excel：用于清理导出文件名中 Windows 不允许的特殊字符与换行
  exportFileNameSanitize: new RegExp(`[\\\\/:*?"<>|\\r\\n\\t]`, 'g'),
  // 单消息导出 Word/Excel：去除正文开头用于生成摘要的 Markdown 标记符号（必须使用双反斜杠转义，避免误吞英文字母 s）
  exportTitleSnippetClean: new RegExp(`^[#>\\s*+\\-` + '`' + `|]+`, 'gm'),

  // 单消息导出 Word：提取代码块 class 中的语言标记（如 class="language-javascript" -> "javascript"）
  exportCodeLangClass: new RegExp(`\\blang(?:uage)?-([\\w-]+)\\b`, 'i'),
  // 单消息导出 Word：清理语言前缀
  exportLanguagePrefix: new RegExp(`^language-`, 'i'),
  // 单消息导出 Word：降级纯文本时匹配多重换行分段
  exportParagraphSplit: new RegExp(`\\n\\n+`),
  // 单消息导出 Word：降级纯文本换行替换
  exportNewlineGlobal: new RegExp(`\\n`, 'g'),
  // 单消息导出 Excel：拆分行
  exportLineSplit: new RegExp(`\\r?\\n`),

  // 楼层快速跳转：用于将换行符替换为空格（示例："\n\nhello\n" -> "  hello "）
  newlineGlobal: /\r?\n+/g,

  // 楼层快速跳转：用于将连续空白字符压缩为单个空格（示例："hello    world" -> "hello world"）
  multiWhitespaceGlobal: /\s+/g,

  // 楼层快速跳转：用于从用户输入中提取楼层纯数字（示例："#5" -> "5", "12楼" -> "12"）
  floorInputNumber: /#?(\d+)/,

  // 版本检测系统：用于从网页标题提取版本号字符串（示例："智能摸鱼 (v260907)" -> "260907"）
  versionFromTitle: new RegExp(`\\(v([^)]+)\\)`),

  // 动态提示词与世界书变量占位符：用于匹配 {{variable}} 宏占位符（示例："{{date}}" -> "date"）
  dynamicPlaceholder: new RegExp(`\\{\\{([^{}]+)\\}\\}`, 'g'),

  // 云同步：校验同步服务器地址格式（支持 http / https）
  syncServerUrl: new RegExp(`^https?:\\/\\/[^\\s]+$`, 'i'),

  // 云同步：校验用户名（3-32位字母数字下划线）
  syncUsername: new RegExp(`^[a-zA-Z0-9_]{3,32}$`),

  // 云同步：校验邀请码（高熵16-64位十六进制）
  syncInviteCode: new RegExp(`^[a-fA-F0-9]{16,64}$`),

  // 云同步：清理 URL 末尾多余斜杠
  trailingSlash: new RegExp(`\\/+$`),

  // 云同步：校验纯十六进制字符串
  hexString: new RegExp(`^[0-9a-fA-F]+$`),

  // 云同步：解析 Content-Range 响应头（示例："bytes 0-1048575/5280897"）
  contentRange: new RegExp(`^bytes\\s+(\\d+)-(\\d+)\\/(?:(\\d+)|\\*)$`, 'i'),

  // DeepSeek导入：.json 文件后缀检测（不区分大小写，示例："abc.json" / "ABC.JSON"）
  deepseekJsonFileExt: new RegExp(`\\.json$`, 'i'),

  // DeepSeek导入：仅放行 http/https 链接协议，防 javascript:/data: 注入（示例："https://a.com" -> true，"javascript:alert(1)" -> false）
  deepseekSafeHttpUrl: new RegExp(`^https?:\\/\\/`, 'i'),

  // DeepSeek导入：Windows 路径反斜杠统一为正斜杠（示例："a\\b\\c.png" -> "a/b/c.png"）
  deepseekBackslashPath: new RegExp(`\\\\`, 'g'),

  // 云同步与导出预览：过滤思考标签与Markdown格式
  thinkingTagThinking: new RegExp(`<thinking>[\\s\\S]*?<\\/thinking>`, 'gi'),
  thinkingTagThink: new RegExp(`<think>[\\s\\S]*?<\\/think>`, 'gi'),
  markdownCodeBlock: new RegExp(`\`\`\`[\\s\\S]*?\`\`\``, 'g'),
  markdownHeading: new RegExp(`#+\\s+`, 'g'),
  multiNewlines: new RegExp(`\\n+`, 'g'),

  // 结构双表 Diff Patch 协议：匹配表1/表2及更新/删除/追加操作块
  diffPatchEventHeader: new RegExp(`#{1,4}\\s*(?:表\\s*1[：:]\\s*)?(?:历史记录表|事件记录表)操作`, 'i'),
  diffPatchCharacterHeader: new RegExp(`#{1,4}\\s*(?:表\\s*2[：:]\\s*)?(?:最新角色信息表|角色信息表|最新实体信息表|实体信息表)操作`, 'i'),
  diffPatchUpdateBlock: new RegExp(`【更新】([\\s\\S]*?)(?=【删除】|【(?:新增追加|追加)】|#{1,4}|$)`, 'i'),
  diffPatchDeleteBlock: new RegExp(`【删除】([\\s\\S]*?)(?=【更新】|【(?:新增追加|追加)】|#{1,4}|$)`, 'i'),
  diffPatchAppendBlock: new RegExp(`【(?:新增追加|追加)】([\\s\\S]*?)(?=【更新】|【删除】|#{1,4}|$)`, 'i'),
  diffPatchEventIndex: new RegExp(`^(?:\\[|【)?(?:E|e)?\\s*(\\d+)(?:\\]|】)?(?:[:：.、\\s]|$)`, 'i'),
  diffPatchCharacterIndex: new RegExp(`^(?:\\[|【)?(?:C|c)?\\s*(\\d+)(?:\\]|】)?(?:[:：.、\\s]|$)`, 'i'),
  diffPatchEventIndexAll: new RegExp(`(?:\\[|【)?(?:E|e)?\\s*(\\d+)(?:\\]|】)?`, 'gi'),
  diffPatchCharacterIndexAll: new RegExp(`(?:\\[|【)?(?:C|c)?\\s*(\\d+)(?:\\]|】)?`, 'gi'),

  // 记忆卡片流解析：支持 **[阶段X（名称）]**、[阶段 X (范围)]: 内容、中国全角括号【阶段 X】、Markdown 标题 ### 阶段 X 及加粗 **阶段 X: 名称**
  summaryCardStage: new RegExp(`(?:^|\\n)(?:[ \\t]*[-*_]{3,}[ \\t]*\\n)?[ \\t]*(?:#{1,4}\\s*)?(?:\\*{1,2}|_{1,2})?(?:\\[\\s*阶段\\s*([^\\]\\n]+?)\\]|【\\s*阶段\\s*([^】\\n]+?)】|阶段\\s*([0-9一二三四五六七八九十IVX0-9]+(?:\\s*[(（][^)）\\n]+[)）])?(?:\\s*[:：]\\s*[^\\n*]+)?))(?:\\*{1,2}|_{1,2})?[ \\t]*[:：]?[ \\t]*\\n?([\\s\\S]*?)(?=(?:\\n[ \\t]*(?:[-*_]{3,}[ \\t]*\\n)?[ \\t]*(?:#{1,4}\\s*)?(?:\\*{1,2}|_{1,2})?(?:\\[\\s*阶段|【\\s*阶段|阶段\\s*[0-9一二三四五六七八九十IVX0-9]+[：:\\s(（]))|$)`, 'g'),
  // 记忆卡片末尾 Markdown 分割线清理（如卡片之间残留的 --- 或 ***）
  summaryCardTrailingDivider: new RegExp(`\\n\\s*[-*_]{3,}\\s*$`),
  // 记忆卡片阶段标题边缘冗余冒号与空白清理
  summaryCardStageClean: new RegExp(`^[:：\\s]+|[:：\\s]+$`, 'g'),
  // 结构双表：智能检测表格第一列是否为 AI 误加的多余序号列（如 [E13]、E13、13、1.、1、[C1]、E24.、第1条 等，用于防错列修正）
  tableIndexPrefix: new RegExp(`^\\s*[\\[【(（]?(?:[EeCc]|序号|编号|No\\.?|NO\\.?|#|第)?\\s*\\d+\\s*(?:条|项|点|个)?[\\]】)）]?[.。、:：]?\\s*$`, 'i'),
  // 发送时移除正文思考内容：匹配首个起始标签至最后一个闭合标签（贪婪匹配，兼容思考内容中携带内部标签）
  thinkingTagGreedy: new RegExp(`<(?:think|thinking)\\b[^>]*>[\\s\\S]*<\\/(?:think|thinking)>\\s*`, 'gi'),

  // 备忘录及多行文本归一化：匹配所有 Windows 风格 CRLF 换行符
  crlfGlobal: new RegExp(`\\r\\n`, 'g'),

  // 实时模式：匹配消息末尾可能残留或用户手动输入的时间戳后缀（用于防重复追加）
  // 匹配形如：\n--2026-11-06 08:12、--2020-02-01 星期六 08:12:30 等
  realtimeTimestampSuffix: new RegExp(`(?:\\r?\\n)?--\\d{4}-\\d{2}-\\d{2}(?:\\s+星期[一二三四五六日])?(?:\\s+\\d{1,2}(?::\\d{1,2}){0,2})?\\s*$`),

  // 回收站与冲突对比：清理 HTML 标签展示纯文本摘要
  stripHtmlTags: new RegExp(`<[^>]*>`, 'g'),

  // AI 后台任务中转：匹配 SSE 数据行前缀
  sseDataLine: new RegExp(`^data:\\s*`),
  // AI 后台任务中转：匹配 SSE [DONE] 终态标记
  sseDoneTag: new RegExp(`^\\[DONE\\]$`)
};
