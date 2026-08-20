/**
 * @file code-block-utils.js
 * @description Pure string manipulation utilities for code blocks.
 * Shared between Main Thread and Web Worker.
 */

const FILE_EXTENSIONS = {
    html: 'html',
    xml: 'xml',
    css: 'css',
    javascript: 'js',
    js: 'js',
    jsx: 'js',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'ts',
    python: 'py',
    py: 'py',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    csharp: 'cs',
    cs: 'cs',
    php: 'php',
    ruby: 'rb',
    rb: 'rb',
    go: 'go',
    rust: 'rs',
    rs: 'rs',
    swift: 'swift',
    kotlin: 'kt',
    kt: 'kt',
    scala: 'scala',
    sql: 'sql',
    json: 'json',
    yaml: 'yml',
    yml: 'yml',
    markdown: 'md',
    md: 'md',
    bash: 'sh',
    sh: 'sh',
    shell: 'sh',
    powershell: 'ps1',
    ps1: 'ps1',
    batch: 'bat',
    bat: 'bat',
    dockerfile: 'Dockerfile',
    docker: 'Dockerfile',
    plaintext: 'txt',
    text: 'txt',
    txt: 'txt'
};

function getFileExtension(language) {
    const lang = (language || '').toLowerCase();
    return FILE_EXTENSIONS[lang] || 'txt';
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let blockCounter = 0;

export function resetBlockCounter() {
    blockCounter = 0;
}

function generateBlockId() {
    blockCounter++;
    return `code-block-${blockCounter}`;
}

function generateButtonsHtml(language, blockId, isLongCode) {
    const lang = language || 'txt';
    const isHtml = lang === 'html' || lang === 'htm';

    // Note: We cannot check button states here as that requires state management.
    // The worker will generate standard buttons, and the main thread will update them if needed.

    let copyBtnText = '复制';
    let copyBtnClass = 'copy-code-btn';

    let buttonsHtml = `
        <button id="copy-btn-${blockId}" class="${copyBtnClass}" data-action="copy" data-block-id="${blockId}">${copyBtnText}</button>
        <button id="download-btn-${blockId}" class="download-code-btn" data-action="download" data-block-id="${blockId}" data-language="${language}">下载</button>
    `;

    if (isHtml) {
        buttonsHtml += `
            <button id="preview-btn-${blockId}" class="preview-html-btn" data-action="preview" data-block-id="${blockId}">预览</button>
        `;
    }

    const expandClass = isLongCode ? 'expand-code-btn suggest-expand' : 'expand-code-btn';
    buttonsHtml += `
        <button class="${expandClass}" data-action="expand-sidebar" data-block-id="${blockId}" title="在侧边栏展开">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
            展开
        </button>
    `;

    return buttonsHtml;
}

function enhanceCodeBlock(match, language, codeContent) {
    const blockId = generateBlockId();
    const escapedLanguage = escapeHtml(language || 'txt');

    const lineCount = (codeContent.match(/\n/g) || []).length;
    const isLongCode = lineCount > 15;

    const buttonsHtml = generateButtonsHtml(language, blockId, isLongCode);

    // 乌鸦：底部浮动条始终生成，由 CSS 的 .truncated 类控制显示/隐藏
    const footerBarHtml = `
        <div class="code-block-footer-bar">
            <span class="code-footer-hint" data-action="expand-sidebar" data-block-id="${blockId}">点击此处或右上角展开查看完整代码 ⛶</span>
            <div class="code-scroll-btns">
                <button class="code-scroll-btn" data-action="scroll-top" data-block-id="${blockId}" title="滚动到顶部">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button class="code-scroll-btn" data-action="scroll-bottom" data-block-id="${blockId}" title="滚动到底部">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
            </div>
        </div>
    `;

    return `
        <div class="code-block-container" data-block-id="${blockId}">
            <div class="code-block-header">
                <span class="code-lang-tag">${escapedLanguage}</span>
                <div class="code-block-actions">
                    ${buttonsHtml}
                </div>
            </div>
            ${match}
            ${footerBarHtml}
        </div>
    `;
}

export function enhanceAllCodeBlocks(html) {
    if (!html || typeof html !== 'string') return html;

    resetBlockCounter();

    const codeBlockRegex = /<pre><code(?: class="language-([^\"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

    return html.replace(codeBlockRegex, (match, language, codeContent) => {
        // 乌鸦：拦截 tool_call 类型，替换为紧凑的工具调用申请条
        if (language === 'tool_call') {
            return createToolCallRequestBar(match, codeContent);
        }
        return enhanceCodeBlock(match, language, codeContent);
    });
}

/**
 * 乌鸦：将 tool_call 代码块替换为紧凑的"工具调用申请条"
 * 解析 JSON 提取工具名列表，点击"展开"在侧边栏查看原始 JSON
 * @param {string} originalMatch - 原始的 <pre><code> HTML
 * @param {string} codeContent - 代码块内容（HTML 转义后的 JSON）
 * @returns {string} 工具调用申请条 HTML
 */
function createToolCallRequestBar(originalMatch, codeContent) {
    const blockId = generateBlockId();
    // 乌鸦：反转义 HTML 实体以获取原始 JSON
    const rawJson = codeContent
        .replace(/<[^>]+>/g, '')  // 乌鸦：先清除 hljs 可能注入的 span 标签
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");

    // 乌鸦：解析 JSON 提取工具信息
    let toolInfoHtml = '';
    try {
        let toolCalls = JSON.parse(rawJson.trim());
        if (!Array.isArray(toolCalls)) toolCalls = [toolCalls];

        const toolItems = toolCalls.map(tc => {
            const toolId = escapeHtml(tc.tool || '未知工具');
            const hasProcessResult = tc.process_result === true;
            // 乌鸦：这里只输出 data 属性，渲染后由前端 JS 匹配中文名
            return `<span class="tool-call-request-item" data-tool-id="${toolId}">` +
                `<span class="tool-call-request-name">${toolId}</span>` +
                (hasProcessResult ? '<span class="tool-call-request-analyze">需分析</span>' : '') +
                `</span>`;
        });
        toolInfoHtml = toolItems.join('');
    } catch (e) {
        // 乌鸦：降级方案——用正则提取工具名（JSON 可能因 hljs 标签而解析失败）
        const toolRegex = /"tool"\s*:\s*"([^"]+)"/g;
        const processRegex = /"process_result"\s*:\s*true/;
        let match;
        const tools = [];
        while ((match = toolRegex.exec(rawJson)) !== null) {
            tools.push(match[1]);
        }

        // 乌鸦：rawJson 提取不到时，对 originalMatch 做去标签处理后再次尝试
        // 原因：hljs 高亮把 JSON 关键字拆成多个 span，清理后引号对可能断裂
        if (tools.length === 0) {
            const fallbackRaw = originalMatch
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
            const fallbackReg = /"tool"\s*:\s*"([^"]+)"/g;
            let fm;
            while ((fm = fallbackReg.exec(fallbackRaw)) !== null) {
                tools.push(fm[1]);
            }
        }

        if (tools.length > 0) {
            const hasProcess = processRegex.test(rawJson) || processRegex.test(originalMatch);
            toolInfoHtml = tools.map(t =>
                `<span class="tool-call-request-item" data-tool-id="${escapeHtml(t)}">` +
                `<span class="tool-call-request-name">${escapeHtml(t)}</span>` +
                (hasProcess ? '<span class="tool-call-request-analyze">需分析</span>' : '') +
                `</span>`
            ).join('');
        } else {
            toolInfoHtml = '<span class="tool-call-request-item"><span class="tool-call-request-name">解析中...</span></span>';
        }
    }

    // 乌鸦：生成紧凑的申请条，内部隐藏一个原始代码块供侧边栏展开
    return `
        <div class="tool-call-request-bar" data-block-id="${blockId}">
            <div class="tool-call-request-header">
                <span class="tool-call-request-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></span>
                <span class="tool-call-request-title">工具调用请求</span>
                <div class="tool-call-request-tools">${toolInfoHtml}</div>
                <button class="tool-call-request-expand-btn expand-code-btn" data-action="expand-sidebar" data-block-id="${blockId}" title="在侧边栏查看原始JSON">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                    </svg>
                    展开
                </button>
            </div>
            <div style="display:none;">${originalMatch}</div>
        </div>
    `;
}
