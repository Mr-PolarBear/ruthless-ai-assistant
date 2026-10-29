/**
 * @file single-message-exporter.js
 * @description 专职负责单条消息气泡的 Word (.doc) 与 Excel (.xlsx) 纯前端导出服务。
 * 遵循单一职责与高内聚架构设计，避免在 message-manager.js 或 utils.js 中无节制堆砌业务代码。
 *
 * 核心设计：
 * 1. 纯前端零后端交互，依靠浏览器 Blob 与项目内置的 libs/xlsx.full.min.js、libs/marked.min.js；
 * 2. 导出 Word：支持 Markdown 长图文完整语义化排版（标题、段落、代码块背景、表格边框、引用高亮），绝不缺斤少两；
 * 3. 导出 Excel：逐行混排智能解析，非表格文本单独成行（放第一列保留上下文），Markdown 表格精准分列，方便用户后期微调；
 * 4. 自动剔除 <think> / <thinking> 思考过程，保留最干净的正文回答。
 */

import { regexPatterns } from '../regex.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { state } from '../state.js?v=temp';
import { escapeHtml } from '../utils.js?v=temp';

/**
 * 清洗原始文本中的 <think> / <thinking> 思考过程标签及其包裹的内容，提取纯正文
 * 支持成对闭合标签剥离以及开头未闭合流式截断兜底
 * @param {string} rawText - 原始文本内容
 * @returns {string} 过滤思考内容后的纯正文
 */
export function cleanThinkingFromText(rawText) {
    if (!rawText) return '';
    let text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText, null, 2);

    // 1. 过滤已成对闭合的思考标签 <think>...</think> 或 <thinking>...</thinking>
    regexPatterns.thinkTag.lastIndex = 0;
    text = text.replace(regexPatterns.thinkTag, '');

    // 2. 兜底保护：若思考过程在开头流式输出阶段被用户中止截断（未产生闭合标签）
    // — 为什么这么写 —
    // 1. 正常生成的思考过程必定位于回答最开头，并在完成后闭合；
    // 2. 若流式中断恰好停在思考阶段，整条消息自开头起即为未闭合思考，必须安全剔除，防止未完成的内部推理泄露；
    // 3. 必须通过正则限定仅当未闭合标签位于消息开头（忽略前导空白）时才做截断剔除；
    //    严禁使用全文无边界截断（如 text.includes('<think>')），否则正文或代码中单纯讨论 `<think>` 标签时会被腰斩误杀！
    regexPatterns.unclosedThinkLeading.lastIndex = 0;
    if (regexPatterns.unclosedThinkLeading.test(text)) {
        // 如果后面异常错位包含闭合标签，截取闭合标签之后的内容（使用集中管控的正则）
        regexPatterns.thinkCloseTag.lastIndex = 0;
        const parts = text.split(regexPatterns.thinkCloseTag);
        if (parts.length > 1) {
            text = parts.slice(1).join(' ').trim();
        } else {
            // 纯粹的思考阶段中断：整体全属于内部思考过程，清空以保护推理过程不外泄
            text = '';
        }
    }

    return text.trim();
}

/**
 * 清理消息对象中的 <think> / <thinking> 思考过程标签及其包裹的内容，提取纯正文
 * @param {object} message - 消息对象
 * @returns {string} 过滤思考内容后的纯正文
 */
export function getCleanMessageContent(message) {
    if (!message) return '';
    const raw = message.originalContent || message.content || '';
    return cleanThinkingFromText(raw);
}


/**
 * 根据消息内容、角色与当前会话生成安全的文件名
 * @param {object} message - 消息对象
 * @param {string} ext - 扩展名 (如 'doc' 或 'xlsx')
 * @returns {string} 安全的文件名
 */
export function generateExportFileName(message, ext) {
    const rolePrefix = message && message.role === 'user' ? '用户提问' : 'AI回复';
    const cleanText = getCleanMessageContent(message);

    // 提取正文前 15 个有效文字作为标题摘要
    // — 为什么这么写 —
    // 避免对数万字的大长文直接执行全局行首正则清洗（'gm'），先取前 100 字符切片再清洗，大幅降低 CPU 开销
    const snippetSource = cleanText.slice(0, 100);
    regexPatterns.exportTitleSnippetClean.lastIndex = 0;
    regexPatterns.exportFileNameSanitize.lastIndex = 0;
    let snippet = snippetSource
        .replace(regexPatterns.exportTitleSnippetClean, '') // 去除开头的 markdown 标记符号
        .replace(regexPatterns.exportFileNameSanitize, '_') // 过滤文件名非法字符
        .trim()
        .slice(0, 15)
        .trim();

    if (!snippet) {
        snippet = '记录';
    }

    // 尝试获取当前会话标题作为文件名前缀
    let convPrefix = '';
    if (state.currentConversationId && state.conversations && state.conversations[state.currentConversationId]) {
        const title = state.conversations[state.currentConversationId].title;
        if (title && title !== '新的对话' && title !== '新会话') {
            convPrefix = title.replace(regexPatterns.exportFileNameSanitize, '_').slice(0, 12) + '_';
        }
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    return `${convPrefix}${rolePrefix}_${snippet}_${timeStr}.${ext}`;
}

/**
 * 跨协议安全下载器（彻底解决局域网明文 HTTP 环境及本地 file 协议下 Chromium 报 Insecure Connection 的问题）
 * — 为什么这么写 —
 * 1. 在非安全源（如 http://192.168.x.x 局域网IP，非 HTTPS 且非 localhost）或直接双击 file:/// 打开时，
 *    Chromium 默认拦截 blob: 协议的 Office 文档下载或篡改文件名；
 * 2. 此时利用 FileReader 自动降级为 data: 协议的 Base64 编码，URL 自身即数据，不含 http 域名 origin，彻底规避浏览器安全阻断；
 * 3. 在常规安全环境（localhost 或 HTTPS）下使用高效的 Blob URL，并通过 40 秒延迟撤销 URL，避免下载进程建立前 URL 提前失效。
 * @param {Blob|string|ArrayBuffer} content - 下载内容
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 */
function downloadSafeFile(content, filename, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isFileProtocol = window.location.protocol === 'file:';
    const isInsecureContext = (window.location.protocol === 'http:' && !isLocalhost) || isFileProtocol;

    // 局域网 HTTP 或本地 file: 协议离线环境：使用 Data URI Base64 绕过不安全源拦截
    if (isInsecureContext && typeof FileReader !== 'undefined') {
        const reader = new FileReader();
        reader.onload = function (e) {
            const dataUrl = e.target.result;
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                if (a.parentNode) a.parentNode.removeChild(a);
            }, 1000);
        };
        reader.onerror = function () {
            fallbackBlobDownload(blob, filename);
        };
        reader.readAsDataURL(blob);
        return;
    }

    // 安全环境（localhost / HTTPS）走标准高性能 Blob 方案
    fallbackBlobDownload(blob, filename);
}

/**
 * 标准 Blob URL 下载，并采用 40 秒延迟回收，防止异步下载线程中断
 * @param {Blob} blob - Blob 实例
 * @param {string} filename - 下载文件名
 */
function fallbackBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
    }, 40000);
}

// 代码高亮调色板（基于 Atom One Light / GitHub 浅色经典配色，高对比度且专为 Word 白底打印与阅读优化）
// — 为什么这么写 —
// 1. hljs 生成的语法分词包含各种特定类名（包括 class_、function_、hljs-operator 等）；
// 2. Microsoft Word 与 WPS 解析外部 CSS 类能力较弱，但对内联 style 和原生 <font color="..."> 标签拥有 100% 的极佳兼容性；
// 3. 将每个语法分类精准映射到颜色与粗体/斜体，并通过“内联 CSS + <font color>”双轨保险注入，保证任何版本的 Word/WPS 均呈现全彩色代码块。
const HLJS_COLOR_PALETTE = {
    // 关键字、选择器、控制流：经典深红加粗
    'hljs-keyword': { color: '#d73a49', bold: true },
    'hljs-selector-tag': { color: '#d73a49', bold: true },
    'hljs-doctag': { color: '#d73a49', bold: true },

    // 字符串、正则、添加内容：墨绿
    'hljs-string': { color: '#032f62', bold: false },
    'hljs-regexp': { color: '#032f62', bold: false },
    'hljs-addition': { color: '#22863a', bold: false },

    // 注释、引用：斜体中灰
    'hljs-comment': { color: '#6a737d', italic: true },
    'hljs-quote': { color: '#6a737d', italic: true },

    // 数字、常量、布尔字面量、HTML属性名：亮蓝
    'hljs-number': { color: '#005cc5', bold: false },
    'hljs-literal': { color: '#005cc5', bold: false },
    'hljs-attr': { color: '#005cc5', bold: false },
    'hljs-variable': { color: '#e36209', bold: false },
    'hljs-template-variable': { color: '#e36209', bold: false },

    // 函数名、类名、类型、节标题：紫色加粗
    'hljs-title': { color: '#6f42c1', bold: true },
    'hljs-section': { color: '#6f42c1', bold: true },
    'hljs-type': { color: '#6f42c1', bold: true },
    'hljs-attribute': { color: '#6f42c1', bold: false },
    'class_': { color: '#6f42c1', bold: true },
    'function_': { color: '#6f42c1', bold: true },

    // 标签名、CSS选择器、内置函数：翡翠绿/橙红
    'hljs-name': { color: '#22863a', bold: true },
    'hljs-tag': { color: '#24292e', bold: false },
    'hljs-built_in': { color: '#e36209', bold: false },
    'hljs-meta': { color: '#e36209', bold: false },
    'hljs-symbol': { color: '#005cc5', bold: false },
    'hljs-bullet': { color: '#005cc5', bold: false },
    'hljs-selector-class': { color: '#6f42c1', bold: false },
    'hljs-selector-id': { color: '#6f42c1', bold: false },

    // 运算符、标点、参数：深灰
    'hljs-operator': { color: '#d73a49', bold: false },
    'hljs-punctuation': { color: '#24292e', bold: false },
    'hljs-params': { color: '#24292e', bold: false },
    'hljs-subst': { color: '#24292e', bold: false },
    'hljs-deletion': { color: '#b31d28', bold: false }
};

/**
 * 基于离屏 DOM 树深度遍历代码块分词节点，注入内联样式与 Word 原生 <font color> 双保险
 * — 为什么这么写 —
 * 1. 废弃以往脆弱的非递归正则字符串替换方案：hljs 在处理 JS 模板字符串、Bash 变量、
 *    Python f-string、XML 属性等语言时会产生复杂的嵌套 <span> 结构，正则替换必定导致闭合标签错配与 HTML 结构破坏；
 * 2. 利用真实 DOM 树遍历，对所有带有 class 的分词 span 精准挂载内联 CSS（style="color:...; font-weight:..."）；
 * 3. 针对 Word/WPS 解析特性：将 span 内部直接文本节点包裹为原生 <font color="..."> 标签，
 *    直接映射为 Word 底层字形颜色（w:color），且严格保留子元素 span 的层次结构，100% 杜绝标签闭合错乱。
 * @param {HTMLElement} codeElement - 包含高亮 HTML 的 <code> 容器元素
 */
function enrichCodeElementWithWordColors(codeElement) {
    if (!codeElement) return;

    const spans = codeElement.querySelectorAll('span[class]');
    spans.forEach(span => {
        const classNames = span.className || '';
        const classes = classNames.split(regexPatterns.multiWhitespaceGlobal);
        let matchedConfig = null;
        for (const cls of classes) {
            if (HLJS_COLOR_PALETTE[cls]) {
                matchedConfig = HLJS_COLOR_PALETTE[cls];
                break;
            }
        }

        if (!matchedConfig) return;

        const color = matchedConfig.color;
        let style = `color: ${color};`;
        if (matchedConfig.bold) {
            style += ' font-weight: bold;';
        }
        if (matchedConfig.italic) {
            style += ' font-style: italic;';
        }
        span.style.cssText = (span.style.cssText ? span.style.cssText + ' ' : '') + style;

        // Word 双轨保险：为直接文本子节点包裹原生 <font color="..."><b>...</b></font>
        // 仅处理直接文本节点（Node.TEXT_NODE），严禁影响同级的嵌套子 span 元素
        const childNodes = Array.from(span.childNodes);
        childNodes.forEach(node => {
            if (node.nodeType === 3 && node.textContent && node.textContent.length > 0) {
                const font = document.createElement('font');
                font.setAttribute('color', color);
                if (matchedConfig.bold) {
                    const b = document.createElement('b');
                    b.textContent = node.textContent;
                    font.appendChild(b);
                } else {
                    font.textContent = node.textContent;
                }
                span.replaceChild(font, node);
            }
        });
    });
}

/**
 * 对代码块执行深度分词高亮，具备指定语言匹配与 highlightAuto 全自动推断双重保底
 * @param {string} codeText - 原始代码纯文本
 * @param {string} rawLang - Markdown 代码块语言标识（如 js, python, sql, bat, powershell 等）
 * @returns {string} hljs 生成的分词 HTML 片段
 */
function highlightCodeBlock(codeText, rawLang) {
    if (!window.hljs) {
        return escapeHtml(codeText);
    }

    const cleanLang = (rawLang || '').trim().toLowerCase().replace(regexPatterns.exportLanguagePrefix, '');
    let highlightedHtml = '';

    // 1. 优先尝试使用指定的语言分词高亮
    if (cleanLang && typeof window.hljs.getLanguage === 'function' && window.hljs.getLanguage(cleanLang)) {
        try {
            highlightedHtml = window.hljs.highlight(codeText, { language: cleanLang, ignoreIllegals: true }).value;
        } catch (e) {
            console.warn(`[WordExport] 指定语言 (${cleanLang}) 高亮失败，切入自动探测:`, e);
        }
    }

    // 2. 自动推断保底：如果未指定语言，或指定的语言未收录（如 bat, powershell, vue 等），使用 highlightAuto 自动探测分词
    if (!highlightedHtml && typeof window.hljs.highlightAuto === 'function') {
        try {
            const autoRes = window.hljs.highlightAuto(codeText);
            if (autoRes && autoRes.value) {
                highlightedHtml = autoRes.value;
            }
        } catch (e) {
            console.warn('[WordExport] highlightAuto 自动推断分词失败:', e);
        }
    }

    // 3. 终极保底：若均无法分词，做基础 HTML 转义
    if (!highlightedHtml) {
        highlightedHtml = escapeHtml(codeText);
    }

    return highlightedHtml;
}

/**
 * 将单条消息导出为 Word 文档 (.doc)
 * @param {object} message - 消息对象
 */
export function exportSingleMessageToWord(message) {
    try {
        const cleanContent = getCleanMessageContent(message);
        if (!cleanContent) {
            notify.warning('消息内容为空，无法导出');
            return;
        }

        // 1. 将 Markdown 解析为基础 HTML
        let rawHtml = '';
        if (window.marked && typeof window.marked.parse === 'function') {
            rawHtml = window.marked.parse(cleanContent, { gfm: true, breaks: true });
        } else {
            // 降级保护：如果 marked 未加载完成，换行转为段落
            regexPatterns.exportNewlineGlobal.lastIndex = 0;
            rawHtml = cleanContent.split(regexPatterns.exportParagraphSplit).map(p => `<p>${escapeHtml(p).replace(regexPatterns.exportNewlineGlobal, '<br>')}</p>`).join('');
        }

        // 2. 利用离屏 DOM 容器进行精准的代码块转换与排版增强
        const container = document.createElement('div');
        container.innerHTML = rawHtml;

        // — 为什么这么写 —
        // 1. Microsoft Word 打开 HTML 时，如果代码块直接使用 <pre>，Word 会映射为“HTML Preformatted”样式，
        //    不仅不支持灰色背景框和圆角边框，部分版本还会强行重置字符为黑色！
        // 2. 业界最佳实践：将代码块转换为 Word 原生支持的单单元格表格（<table bgcolor="#f6f8fa" border="1">）；
        //    Word 会将 table cell 的 bgcolor 100% 渲染为正规的背景底纹（Shading），并将 border 渲染为整齐的浅灰线框；
        // 3. 表格内部保留 <pre style="...">，配合 Consolas 等宽字体和内联彩色 <font>，完美达到 IDE 代码块视觉效果。
        const codeBlocks = container.querySelectorAll('pre');
        codeBlocks.forEach(pre => {
            const codeEl = pre.querySelector('code');
            const rawCode = codeEl ? codeEl.textContent : pre.textContent;

            // 提取语言标记（如 class="language-javascript"）
            let lang = '';
            if (codeEl && codeEl.className) {
                const match = codeEl.className.match(regexPatterns.exportCodeLangClass);
                if (match) {
                    lang = match[1];
                }
            }

            // 获取 hljs 原始分词 HTML
            const highlightedHtml = highlightCodeBlock(rawCode, lang);

            // 构造 Word 高兼容性表格代码框
            const table = document.createElement('table');
            table.setAttribute('width', '100%');
            table.setAttribute('border', '1');
            table.setAttribute('cellpadding', '8');
            table.setAttribute('cellspacing', '0');
            table.setAttribute('bgcolor', '#f6f8fa');
            table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 10pt 0; background-color: #f6f8fa; border: 1pt solid #e1e4e8;';

            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('bgcolor', '#f6f8fa');
            td.style.cssText = 'background-color: #f6f8fa; border: 1pt solid #e1e4e8; padding: 8pt 12pt; font-family: Consolas, "Courier New", Monaco, monospace; font-size: 9.5pt; line-height: 1.45; white-space: pre-wrap; word-break: break-all;';

            const innerPre = document.createElement('pre');
            innerPre.style.cssText = 'margin: 0; padding: 0; background: transparent; border: none; font-family: Consolas, "Courier New", Monaco, monospace; font-size: 9.5pt; line-height: 1.45; white-space: pre-wrap; word-break: break-all; color: #24292e;';

            const innerCode = document.createElement('code');
            innerCode.style.cssText = 'background: transparent; color: inherit; font-family: inherit; font-size: inherit;';
            innerCode.innerHTML = highlightedHtml;

            // 基于真实 DOM 深度遍历注入内联色彩与 <font> 双重保障（杜绝嵌套标签破坏）
            enrichCodeElementWithWordColors(innerCode);

            innerPre.appendChild(innerCode);
            td.appendChild(innerPre);
            tr.appendChild(td);
            table.appendChild(tr);

            if (pre.parentNode) {
                pre.parentNode.replaceChild(table, pre);
            }
        });

        // 行内代码块样式美化（排除代码框表格内的 code，但保留 Markdown 数据表格内的行内代码）
        const inlineCodes = container.querySelectorAll('code');
        inlineCodes.forEach(codeEl => {
            // 精准排除代码块表格（带 bgcolor="#f6f8fa"），使 Markdown 表格内的行内代码同样享有高亮底色
            if (!codeEl.closest('table[bgcolor="#f6f8fa"]')) {
                codeEl.style.cssText = 'font-family: Consolas, "Courier New", Monaco, monospace; font-size: 9.5pt; background-color: #f1f5f9; padding: 2pt 4pt; border-radius: 2pt; color: #d73a49; border: 1pt solid #e2e8f0;';
                codeEl.innerHTML = `<font color="#d73a49"><b>${codeEl.innerHTML}</b></font>`;
            }
        });

        // 正文 Markdown 表格样式内联增强，保证网格线在 Word 中完美显示
        const contentTables = container.querySelectorAll('table');
        contentTables.forEach(table => {
            // 跳过代码块表格（代码块表格有 bgcolor="#f6f8fa"）
            if (table.getAttribute('bgcolor') === '#f6f8fa') return;

            table.setAttribute('border', '1');
            table.setAttribute('cellpadding', '6');
            table.setAttribute('cellspacing', '0');
            table.style.cssText = 'border-collapse: collapse; width: 100%; margin: 12pt 0; border: 1pt solid #cbd5e1;';
            const ths = table.querySelectorAll('th');
            ths.forEach(th => {
                th.setAttribute('bgcolor', '#f1f5f9');
                th.style.cssText = 'border: 1pt solid #cbd5e1; padding: 6pt 10pt; text-align: left; font-size: 10pt; background-color: #f1f5f9; font-weight: 600;';
            });
            const tds = table.querySelectorAll('td');
            tds.forEach(td => {
                td.style.cssText = 'border: 1pt solid #cbd5e1; padding: 6pt 10pt; text-align: left; font-size: 10pt;';
            });
        });

        const htmlBody = container.innerHTML;

        // 3. 组装 Word 专属 HTML 模板与样式
        // — 为什么这么写 —
        // 1. Word 与 WPS 原生解析带 Office XML 命名空间的 HTML 文档，并以标准打印排版呈现；
        // 2. 注入针对标题、表格网格边框、等宽代码块底色与引用块的高保真样式，保证生成的文档开箱即用且排版整齐；
        // 3. 使用 application/msword 与 UTF-8 编码，彻底避免中文乱码问题。
        const wordDocumentHtml = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
    <meta charset='utf-8'>
    <title>消息导出</title>
    <!--[if gte mso 9]>
    <xml>
        <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
    </xml>
    <![endif]-->
    <style>
        body {
            font-family: 'Microsoft YaHei', '微软雅黑', 'Segoe UI', Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.6;
            color: #24292e;
            padding: 20px;
        }
        h1, h2, h3, h4, h5, h6 {
            color: #1a202c;
            font-weight: 600;
            margin-top: 16pt;
            margin-bottom: 6pt;
        }
        h1 { font-size: 18pt; border-bottom: 1.5pt solid #eaecef; padding-bottom: 4pt; }
        h2 { font-size: 15pt; border-bottom: 1pt solid #eaecef; padding-bottom: 3pt; }
        h3 { font-size: 13pt; }
        h4 { font-size: 11pt; }
        p {
            margin-top: 0;
            margin-bottom: 8pt;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 12pt 0;
        }
        th, td {
            border: 1pt solid #cbd5e1;
            padding: 6pt 10pt;
            text-align: left;
            font-size: 10pt;
        }
        th {
            background-color: #f1f5f9;
            font-weight: 600;
        }
        pre {
            background-color: #f6f8fa;
            border: 1pt solid #e1e4e8;
            border-radius: 4pt;
            padding: 8pt 12pt;
            margin: 8pt 0;
            font-family: 'Consolas', 'Courier New', 'Monaco', monospace;
            font-size: 9.5pt;
            line-height: 1.45;
            color: #24292e;
            white-space: pre-wrap;
            word-break: break-all;
        }
        code {
            font-family: 'Consolas', 'Courier New', 'Monaco', monospace;
            font-size: 9.5pt;
            background-color: #f1f5f9;
            padding: 2pt 4pt;
            border-radius: 2pt;
        }
        pre code {
            background-color: transparent;
            padding: 0;
        }
        /* 代码块语法高亮类定义（与内联样式双重保险） */
        .hljs-keyword { color: #d73a49; font-weight: bold; }
        .hljs-string { color: #032f62; }
        .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
        .hljs-number, .hljs-literal { color: #005cc5; }
        .hljs-title, .hljs-section { color: #6f42c1; font-weight: bold; }
        .hljs-tag, .hljs-name { color: #22863a; }
        .hljs-attr, .hljs-attribute { color: #6f42c1; }
        .hljs-built_in { color: #e36209; }
        .hljs-meta { color: #e36209; }
        blockquote {
            border-left: 3.5pt solid #3b82f6;
            padding-left: 10pt;
            margin-left: 0;
            margin-right: 0;
            color: #475569;
            background-color: #f8fafc;
            padding-top: 4pt;
            padding-bottom: 4pt;
        }
        ul, ol {
            margin-top: 0;
            margin-bottom: 8pt;
            padding-left: 20pt;
        }
        li {
            margin-bottom: 3pt;
        }
        img {
            max-width: 100%;
            height: auto;
            margin: 8pt 0;
        }
    </style>
</head>
<body>
    ${htmlBody}
</body>
</html>`;

        const filename = generateExportFileName(message, 'doc');
        // — 为什么这么写 —
        // 必须注入 UTF-8 BOM (\uFEFF) 字节序前缀！
        // Windows 环境下众多版本的 Microsoft Word / WPS 在直接打开 .doc 扩展名的 HTML 文档时，
        // 若没有 \uFEFF，会默认按系统本地 ANSI 代码页 (CP936/GBK) 解析，导致中文显示为“锟斤拷”乱码或弹窗提示选择编码。
        downloadSafeFile('\uFEFF' + wordDocumentHtml, filename, 'application/msword;charset=utf-8');
        notify.success('Word 文档导出成功');
    } catch (err) {
        console.error('导出 Word 文档失败:', err);
        notify.error('导出 Word 失败，请查看控制台日志');
    }
}

/**
 * 安全拆分 Markdown 表格行，支持连续反斜杠奇偶转义 (\\| vs \|) 与多反引号代码块状态机
 * — 为什么这么写 —
 * 1. 反斜杠转义计算：统计当前竖线 | 前方连续反斜杠的个数，奇数个表示竖线被转义 (\|，不分列)，偶数个表示反斜杠自身转义 (\\\\|，竖线有效需分列)；
 * 2. 代码围栏状态机：支持单反引号与多反引号 (如 ``code | bar``)，统计反引号连续长度，完全闭合前内部所有的管道符均不作为单元格切分；
 * 3. 行尾安全裁剪：严格判断末尾的 | 是否被转义，仅在非转义闭合竖线时裁剪，避免误切最后一个单元格末尾的转义竖线。
 * @param {string} rowStr - 表格行原始字符串
 * @returns {string[]} 切割后的单元格数组
 */
function splitMarkdownTableRow(rowStr) {
    let s = rowStr.trim();
    if (s.startsWith('|')) s = s.slice(1);

    // 检查末尾是否为未转义的闭合竖线 |
    if (s.endsWith('|')) {
        let backslashCount = 0;
        for (let j = s.length - 2; j >= 0 && s[j] === '\\'; j--) {
            backslashCount++;
        }
        // 偶数个反斜杠说明最后的 | 未被转义，是真正的表格闭合边界
        if (backslashCount % 2 === 0) {
            s = s.slice(0, -1);
        }
    }

    const cells = [];
    let current = '';
    let backtickFenceLength = 0; // 0 表示不在代码包裹中，> 0 表示处于对应长度反引号的代码中

    for (let i = 0; i < s.length; i++) {
        const char = s[i];

        // 1. 处理反引号代码围栏
        if (char === '`') {
            // 统计连续反引号长度
            let runLength = 1;
            while (i + 1 < s.length && s[i + 1] === '`') {
                runLength++;
                i++;
            }
            const backticks = '`'.repeat(runLength);

            if (backtickFenceLength === 0) {
                // 进入代码块状态
                backtickFenceLength = runLength;
            } else if (backtickFenceLength === runLength) {
                // 遇到相同长度的反引号串，退出代码块状态
                backtickFenceLength = 0;
            }
            current += backticks;
            continue;
        }

        // 2. 处理管道符 |（仅在不在代码块内时生效）
        if (char === '|' && backtickFenceLength === 0) {
            // 统计前方连续反斜杠数量
            let backslashCount = 0;
            for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) {
                backslashCount++;
            }

            if (backslashCount % 2 === 1) {
                // 奇数个反斜杠：当前竖线被转义 (\|)，替换末尾反斜杠为字面量竖线，继续追加
                current = current.slice(0, -1) + '|';
            } else {
                // 偶数个反斜杠：当前竖线为真正的单元格分隔符
                cells.push(current.trim());
                current = '';
            }
            continue;
        }

        current += char;
    }

    cells.push(current.trim());
    return cells;
}

/**
 * 将单条消息导出为 Excel 工作表 (.xlsx)
 * 智能混合排版：非表格文本独占第一列成行保留完整上下文，Markdown 表格自动拆分为多列单元格
 * @param {object} message - 消息对象
 */
export function exportSingleMessageToExcel(message) {
    try {
        if (typeof window.XLSX === 'undefined') {
            notify.error('Excel 导出组件 (SheetJS) 尚未加载完成，请稍后重试');
            return;
        }

        const cleanContent = getCleanMessageContent(message);
        if (!cleanContent) {
            notify.warning('消息内容为空，无法导出');
            return;
        }

        // 按行拆分文本
        const lines = cleanContent.split(regexPatterns.exportLineSplit);
        const aoa = [];
        let maxCols = 1;
        let inCodeBlock = false;
        let hasMixedText = false;

        // — 为什么这么写 —
        // 1. 严格响应大爷的需求：不仅提取表格，更不丢弃任何前置说明、结论、总结或代码段；
        // 2. 对于普通文字段落，单行直接放入第 1 列（[line]），完整保留行顺序和上下文；
        // 3. 维护 inCodeBlock 状态机：代码块内部（```）的行即使包含 | 也绝不作为表格解析；
        // 4. 遇到 Markdown 表格（| col1 | col2 |）时：
        //    - 过滤忽略 |---|---| 纯对齐修饰行；
        //    - 利用 splitMarkdownTableRow 容错解析，避免把转义 \| 或反引号中的管道符（如 `cat a | grep b`）误劈开导致整行数据错位；
        //    - 将表头及数据行精确对齐到 Excel 的多个单元格中；
        // 5. 用户在 Excel 中打开后既拥有清晰的表格分列，又能在首列读到全部上下文说明，方便后续合并或自由调整。
        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();

            // 1. 维护代码块状态（以 ``` 开头的围栏标记）
            if (trimmed.startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                aoa.push([rawLine]);
                continue;
            }
            if (inCodeBlock) {
                aoa.push([rawLine]);
                continue;
            }

            // 2. 检查是否为 Markdown 表格行（以 | 开头并以 | 结尾）
            regexPatterns.singleMarkdownTableRow.lastIndex = 0;
            if (regexPatterns.singleMarkdownTableRow.test(trimmed)) {
                // 检查是否是表格分隔线（如 |---|---| 或 | :---: | --- |）
                regexPatterns.markdownTableSeparator.lastIndex = 0;
                if (regexPatterns.markdownTableSeparator.test(trimmed)) {
                    // 分隔线纯属排版装饰，在 Excel 网格线中无需生成数据行，直接跳过
                    continue;
                }

                // 拆分各列并去除多余空白（支持连续反斜杠奇偶转义 \| 与多反引号代码内管道符）
                const cells = splitMarkdownTableRow(trimmed);

                if (cells.length > 0) {
                    aoa.push(cells);
                    if (cells.length > maxCols) {
                        maxCols = cells.length;
                    }
                    continue;
                }
            }

            // 3. 非表格内容：作为独立单行放入第 1 列
            if (trimmed) {
                hasMixedText = true;
            }
            aoa.push([rawLine]);
        }

        // 构造 Worksheet（开启 raw: true 保留原始字面量，防止身份证、版本号、工号前导零被强转数值失真）
        const ws = window.XLSX.utils.aoa_to_sheet(aoa, { raw: true });

        // 真实自适应列宽算法（中文与全角字符按 2 权重视角宽度，英文数字按 1 权重）
        // — 为什么这么写 —
        // 1. 传统固定列宽会导致长英文或说明被硬生生遮挡截断，短字段留白过大；
        // 2. 遍历 aoa 二维数组，计算各列单元格的最大显示宽度；
        // 3. 当存在混排说明段落（hasMixedText=true）时，第 1 列设置下限保底 35，上限封顶 60（防止单行长说明拉出数百列宽破坏表格横向浏览）；
        //    若是纯表格消息，第 1 列与后续数据列一致（保底 14，上限 50），避免纯小表格首列突兀空旷；
        // 4. 后续分列表头与数据列设置保底 14，上限封顶 50，动态 +2 呼吸留白，实现真正舒适美观的自适应排版。
        const colWidths = [];
        for (let c = 0; c < maxCols; c++) {
            let maxVisualLen = 0;
            for (let r = 0; r < aoa.length; r++) {
                const row = aoa[r];
                if (row && row[c] !== undefined && row[c] !== null) {
                    const str = String(row[c]);
                    let len = 0;
                    for (let ch = 0; ch < str.length; ch++) {
                        const code = str.charCodeAt(ch);
                        len += (code >= 0x4e00 && code <= 0x9fa5) || code > 0xff ? 2 : 1;
                    }
                    if (len > maxVisualLen) {
                        maxVisualLen = len;
                    }
                }
            }

            if (c === 0 && hasMixedText) {
                // 首列存在混排说明列：保底 35，根据内容自适应，最大不超过 60
                colWidths.push({ wch: Math.min(60, Math.max(35, maxVisualLen + 2)) });
            } else {
                // 数据分列表头与内容列（或纯表格首列）：保底 14，根据内容自适应，最大不超过 50
                colWidths.push({ wch: Math.min(50, Math.max(14, maxVisualLen + 2)) });
            }
        }
        ws['!cols'] = colWidths;

        // 构造 Workbook 并写入文件
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, '消息记录');

        const filename = generateExportFileName(message, 'xlsx');
        // — 为什么这么写 —
        // 不直接调用 SheetJS 内置的 window.XLSX.writeFile，因为其内部硬编码了 URL.createObjectURL，
        // 在局域网明文 HTTP 环境下会被 Chromium 判定为不安全来源拦截。
        // 改用 XLSX.write 输出 ArrayBuffer 二进制流，交由 downloadSafeFile 智能双轨调度（HTTP 下自动走 Data URI Base64）。
        const excelArray = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const excelBlob = new Blob([excelArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        downloadSafeFile(excelBlob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        notify.success('Excel 表格导出成功');
    } catch (err) {
        console.error('导出 Excel 表格失败:', err);
        notify.error('导出 Excel 失败，请查看控制台日志');
    }
}
