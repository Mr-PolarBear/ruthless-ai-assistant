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
  nestedCodeBlock: /^\s*`{3,}\s*\n(```[\s\S]*?```)\s*\n`{3,}\s*$/
};
