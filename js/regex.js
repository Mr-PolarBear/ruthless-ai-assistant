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

  // 模式3（角色扮演双表记忆）：用于匹配与提取 Markdown 表格各行及表头
  markdownTableRow: /^\|(.+)\|$/gm,
  markdownTableSeparator: new RegExp(`^\\|(?:\\s*:?-+:?\\s*\\|)+$`),
  // 单消息导出 Excel：用于精准检测单行是否为 Markdown 表格行（无全局标志，避免 lastIndex 干扰）
  singleMarkdownTableRow: new RegExp(`^\\|.*\\|$`),
  // 单消息导出：用于精准检测消息开头是否为流式中断未闭合的思考标签（忽略前导空白）
  unclosedThinkLeading: new RegExp(`^\\s*<(?:think|thinking)\\b[^>]*>[\\s\\S]*$`, 'i'),
  // 单消息导出及消息清洗：匹配思考标签的闭合标签（用于流式截断错位恢复）
  thinkCloseTag: new RegExp(`</(?:think|thinking)>`, 'i'),
  eventHistoryHeader: /#{1,4}\s*历史记录表/i,
  characterInfoHeader: /#{1,4}\s*最新角色信息表/i,

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
  dynamicPlaceholder: new RegExp(`\\{\\{([^{}]+)\\}\\}`, 'g')
};

