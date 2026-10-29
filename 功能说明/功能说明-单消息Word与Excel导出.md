# 单消息 Word (.doc) 与 Excel (.xlsx) 纯前端导出功能说明

## 1. 功能概述与设计背景

在日常使用 AI 助手的过程中，大模型通常以 Markdown 格式输出长文本方案或结构化数据表格。用户往往需要将某一条精彩的方案、技术文档或数据对比表导出为常用的办公文档格式（Word 或 Excel）以便进行二次编辑、排版或流转汇报。

本项目实现了**完全不依赖任何后端服务**的纯前端单消息导出系统：
1. **导出 Word (.doc)**：针对长方案、技术调研、代码文档等，完整还原 Markdown 排版语义，代码块彩色语法高亮、浅灰边框背景，表格自带网格线与表头底纹，文字结构完整无缺；
2. **导出 Excel (.xlsx)**：针对数据清单、对比表与混排方案，Markdown 表格自动精准分列，非表格的说明、结论、上下文**绝不丢弃，作为独立单行统一放入第一列**，方便用户在 Excel 中自由微调；
3. **剔除深度思考过程**：自动过滤 `<think>` / `<thinking>` 深度推理过程，仅保留干净最终正文，同时精准防御正文讨论思考标签时不被误截断；
4. **全环境跨协议免拦截下载**：兼容解决局域网 HTTP（非 HTTPS、非 localhost）及本地 `file:///` 协议离线双击打开环境下 Chromium 内核拦截 Blob Office 文档下载的问题。

---

## 2. 交互入口与操作流程

- **触发入口**：每条消息气泡右下角的**【复制】**图标按钮；
- **菜单选项**：
  1. **复制MD**：复制原始 Markdown 格式文本（已剔除思考过程）；
  2. **复制纯文本**：复制过滤格式后的纯净纯文本；
  3. **导出 Word**：将当前消息一键导出为 `.doc` 格式下载；
  4. **导出 Excel**：将当前消息一键导出为 `.xlsx` 格式下载；
- **支持角色**：用户提问（User）与 AI 回复（Assistant）均全功能支持；
- **智能视口自适应**：浮动菜单自动计算视口剩余高度与宽度，靠底自动向上翻转弹出，靠右自动向左靠齐，杜绝溢出可视窗口。

---

## 3. 核心架构设计与实现原理

遵循项目架构师“单一职责与高内聚”底线，所有导出业务代码全部独立封装在专属模块中，严禁向已有大体积业务脚本堆砌代码：

```
ruthless-ai-assistant/
├── js/
│   ├── services/
│   │   └── single-message-exporter.js   # 专职单消息导出服务（Word & Excel）
│   ├── message-manager.js               # 消息管理器（挂载复制/导出浮层与视口定位计算）
│   ├── chat-events.js                   # 事件代理（分发气泡复制按钮点击并调起菜单）
│   └── regex.js                         # 集中管理导出相关正则表达式
├── css/
│   └── components.css                   # .copy-menu 浮层组件样式（深浅主题自适应）
└── libs/
    ├── marked.min.js                    # Markdown 解析引擎
    ├── highlight.min.js                 # 语法高亮分词引擎
    └── xlsx.full.min.js                 # SheetJS 纯前端 Excel 构造库
```

### 3.1 深度过滤思考过程 (`cleanThinkingFromText` 与 `getCleanMessageContent`)
- **双重剥离与防误杀机制**：
  1. 利用集中管理的正则 `regexPatterns.thinkTag`，自动将成对闭合的 `<think>...</think>` 与 `<thinking>...</thinking>` 完整剥离并重置正则指针；
  2. **流式中断容错兜底与防误杀**：若大模型在输出思考过程阶段被用户主动停止或网络中断（有开标签无闭标签），通过 `regexPatterns.unclosedThinkLeading` 严格限定**仅当消息开头即为未闭合思考标签时**才进行截断清空；若 `<think>` 标签出现在正文中（如用户提问或代码示例中讨论思考标签），则绝对不截断正文，彻底杜绝正文被腰斩误杀；
  3. **模块化复用与全局打通**：将核心清洗逻辑抽象导出为 `cleanThinkingFromText`，同时赋能给气泡菜单的【复制MD】、【复制纯文本】以及 AI 字数统计，让整个会话生命周期享用同一套坚固的思考内容清洗标准，彻底根绝流式中断场景下的思考外泄。

### 3.2 规范化安全文件名生成 (`generateExportFileName`)
- **命名规范**：`[会话标题_][角色前缀]_[正文摘要前15字]_[时间戳].[doc|xlsx]`
- **轻量截断性能保护**：先截取正文前 100 字符切片再进行正则清洗，避免数万字长文触发全文本全局正则扫描；
- **安全过滤**：通过 `regexPatterns.exportFileNameSanitize` 彻底过滤 Windows 文件名非法字符（`\ / : * ? " < > |` 及换行符、制表符），保证下载文件不会因特殊字符报错。

### 3.3 跨协议安全下载器 (`downloadSafeFile`)
- **问题根因**：Chromium 内核从 86+ 起对明文 HTTP 源（如局域网 `http://192.168.x.x:8081`）实施“不安全下载拦截（Insecure Download Blocking）”，且在直接双击 `file:///` 离线访问时存在沙盒限制，通过 `URL.createObjectURL(blob)` 生成的办公文档下载常被直接阻断或篡改文件名；
- **双轨架构解决**：
  - **非安全环境（局域网 HTTP 或本地 file: 协议）**：自动通过 `FileReader.readAsDataURL` 降级转为 `data:` 协议的 Base64 编码，URL 自身即数据载体，彻底规避浏览器安全阻断；
  - **安全环境（HTTPS 或 localhost）**：走标准高效 Blob 方案，并设置 40 秒延迟撤销 URL，防止大文件异步下载线程尚未完成时 URL 提前失效；
- **UTF-8 BOM 字节序防乱码保障**：Word 文档二进制流开头强制注入 UTF-8 BOM (`\uFEFF`)，从底层杜绝 Windows 版 Word / WPS 默认以系统 ANSI 代码页 (CP936/GBK) 强行解析导致“锟斤拷”乱码或弹窗提示选择编码。

---

## 4. 导出 Word (.doc) 关键技术细节

### 4.1 代码块语法高亮难题与破解
1. **marked v15 废弃 highlight 配置**：项目内置 marked 为高版本，不再执行默认 highlight 回调；
2. **离屏 DOM 真实分词**：使用离屏容器结合项目内置 `libs/highlight.min.js` 进行词法分析；
3. **双重分词引擎（`highlightCodeBlock`）**：
   - 声明了语言且属于内置支持的语言，优先按指定语言高亮；
   - 未声明语言或语言属于未内置分类（如 bat, powershell, vue 等），自动无缝切入 `highlightAuto` 智能语法推断，确保 100% 代码块均被成功分词上色；
4. **离屏 DOM 树遍历内联样式 + 原生 `<font color="...">` 双重保险 (`enrichCodeElementWithWordColors`)**：
   - **摒弃脆弱的非递归正则**：hljs 在处理 Bash 变量/命令替换、JS 模板字符串、Python f-string、XML 属性等语法时，天然会输出嵌套 `<span>`。传统正则字符串替换必定会在第一个遇到内层 `</span>` 时提前截断闭合，造成标签错位与 HTML 严重损坏；
   - **DOM 树精准注入**：将 hljs 原始片段先挂载到离屏 `<code>` DOM 树中，通过 DOM API 深度遍历所有带 class 的 span 挂载内联 CSS（`style="color:...; font-weight:..."`）；
   - **仅包裹直接文本节点**：为 span 的直接文本子节点（`Node.TEXT_NODE`）包裹原生 `<font color="..."><b>...</b></font>`，直接映射为 Word 底层字形颜色（`w:color`），既完美兼容老旧版本 Word/WPS，又彻底杜绝破坏子元素 span 的层次结构。

### 4.2 Word 原生代码块表格底纹框（Table Container）
- Word 直接解析 `<pre>` 时，会映射为 `HTML Preformatted` 样式，既没有背景底色，也没有线框；
- Exporter 将每个代码块升级包裹为 Word 原生 1x1 结构化表格（`<table bgcolor="#f6f8fa" border="1">`）；
- Word 将表格的 `bgcolor` 解析为标准单元格底纹（Shading），将 `border` 解析为细线边框，搭配 Consolas 等宽字体，达到接近现代 IDE 代码框的观感。

### 4.3 表格、行内代码与图片样式增强
- **Markdown 数据表格**：所有 `table`、`th`、`td` 均强制注入内联边框网格线与 `#cbd5e1` 细线边框，表头自动赋予 `#f1f5f9` 底纹与加粗，避免 Word 渲染为无边框散落文本；
- **行内代码 (`code`)**：精准排除代码块表格（`table[bgcolor="#f6f8fa"]`），正文段落与 Markdown 数据表格内部的行内代码均注入浅灰底色与深红强调字（`<font color="#d73a49">`），绝无样式遗漏；
- **图片尺寸自适应 (`img`)**：内置 `max-width: 100%; height: auto;`，杜绝单条消息中包含大图或渲染图表时在 Word 打印版面中横向溢出撑破边距。

---

## 5. 导出 Excel (.xlsx) 关键技术细节

### 5.1 逐行智能混排扫描算法 (`exportSingleMessageToExcel`)
在方案类回答中，往往包含“前言说明”、“要点列举”、“核心对比表格”、“实施步骤代码”与“总结建议”。常规工具通常只提取表格而丢弃其他内容，导致信息割裂。

本导出器采用逐行智能扫描算法：
1. **代码围栏状态机保护 (`inCodeBlock`)**：以 ` ``` ` 围栏行切换状态，代码块内部的行即使包含 `|` 或 ASCII 框图，也严格作为非表格行保留原始缩进并保全在首列，杜绝代码被误拆为表格；
2. **安全表格行拆分 (`splitMarkdownTableRow`)**：
   - **反斜杠奇偶计算**：统计 `|` 前连续反斜杠数量，奇数个表示转义竖线（`\|`，不分列），偶数个表示反斜杠自身转义（`\\|`，竖线有效分列）；
   - **多反引号围栏状态机**：支持单反引号与多反引号（如 ```` ``code | query`` ````），完全闭合前内部所有的管道符均不作为分列；
   - **末尾安全裁剪**：严格校验行末 `|` 是否为未转义的闭合竖线，避免误删最后一个单元格末尾的转义符号；
   - **忽略装饰分隔线**：利用 `regexPatterns.markdownTableSeparator` 自动跳过纯排版对齐行（如 `|---|---|`）；
3. **非表格行保全与混排感知 (`hasMixedText`)**：遇到段落、代码行、无序列表或标题说明时，**将其作为独立数组单项（`[rawLine]`）放入第 1 列**，同时标记存在混排文本状态；
4. **真正智能自适应列宽**：
   - 遍历各列真实内容，全角与中文字符按 2 视觉权重计算，英文字符按 1 权重计算；
   - **首列双模态自适应**：若消息中存在混排说明段落（`hasMixedText=true`），第 1 列保底 35、上限封顶 60；若消息纯粹是表格（`!hasMixedText`），第 1 列与后续数据列一致（保底 14、上限 50），避免纯小表格首列过于空旷；
   - 数据分列表头与内容列设置保底 14，上限封顶 50，并在最大宽度基础上动态附加 +2 呼吸留白；
5. **二进制安全写入与原始字面量保障 (`raw: true`)**：
   - 调用 `XLSX.utils.aoa_to_sheet(aoa, { raw: true })`，彻底封堵 SheetJS 自动将纯数字字符串强转为数值类型的隐患，确保 **前导零工号（如 `00123`）**、**18位身份证号/雪花ID** 与 **版本号（如 `"1.20"`）** 100% 原始不失真；
   - 不调用 SheetJS 的 `XLSX.writeFile`（避免内部硬编码的 blob url 被拦截），而是通过 `XLSX.write(wb, { type: 'array' })` 输出原始 ArrayBuffer，交由跨协议下载器安全落地。

---

## 6. 主题适配与正则表达式规范

1. **主题双模适配（`css/components.css`）**：
   - 气泡复制菜单 `.copy-menu` 遵循 UI 铁律，使用 `var(--bg-deep)` 浅色底色与毛玻璃效果；
   - 在 `body[data-theme="dark"]` 下编写专属暗色投影（`0 6px 20px rgba(0, 0, 0, 0.45)`）与高对比度文字样式，无突兀大白块；
2. **正则集中管控（`js/regex.js`）**：
   - `exportFileNameSanitize`：文件名非法字符清洗；
   - `exportTitleSnippetClean`：正文摘要 Markdown 符号清洗（严格使用双反斜杠转义 `\\s` 与 `\\-`，避免模板字面量误吞英文字母 s）；
   - `singleMarkdownTableRow`：精准判定单行是否为 Markdown 表格行；
   - `markdownTableSeparator`：匹配 Markdown 表格分隔对齐线；
   - `unclosedThinkLeading`：检测消息开头未闭合思考标签（用于中断流式兜底防误杀）；
   - `thinkCloseTag`：匹配思考标签闭合部分（用于流式截断错位恢复）；
   - `exportCodeLangClass`：代码块语言类名提取；
   - `exportLanguagePrefix`：语言前缀清理；
   - `exportParagraphSplit`、`exportNewlineGlobal`、`exportLineSplit`：段落与换行正则；
   - 所有正则统一使用反引号包裹，杜绝斜杠转义异常。

---

## 7. 常见问题与注意事项

- **本地开发缓存**：
  若在本地开发或静态服务调试时发现导出效果未发生变化，是由于浏览器对 ES 模块的强缓存特性（源码统一使用 `?v=temp` 占位符），在浏览器中按下 **`Ctrl + F5`** 强制清空缓存并重新拉取即可生效。
- **内网离线安全性**：
  全流程零网络请求，不向任何第三方或云端发送聊天内容，100% 本地运算与内存构建。
- **关于 Office / WPS 打开 .doc 提示格式不一致**：
  纯前端导出采用带 Office XML 命名空间的 HTML 结构并赋予 `.doc` 后缀，这是免后端依赖实现全彩色语法高亮和高保真排版的通用成熟方案。在部分开启严格沙盒模式的 Office 365 或新版 Word 中打开时，可能会弹出提示“*您尝试打开的文件格式与文件扩展名指定的格式不一致...*”，点击【是】即可正常编辑和排版，文档内容与排版绝对完整无损，大爷可放心使用。
