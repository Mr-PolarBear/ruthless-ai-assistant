/**
 * @file markdown-worker.js
 * @description Web Worker for off-main-thread Markdown rendering.
 */

/* -------------------------------------------------------------------------- */
/*                                 Worker Scope                               */
/* -------------------------------------------------------------------------- */

self.onmessage = async (e) => {
    const { id, text, role, messageIndex, totalVisibleMessages, config, regexRules } = e.data;

    try {
        if (e.data.type === 'init') {
            await initLibraries(e.data.libs);
            self.postMessage({ id, type: 'init_success' });
            return;
        }

        if (e.data.type === 'render') {
            const html = renderPipeline(text, role, messageIndex, totalVisibleMessages, config, regexRules);
            self.postMessage({ id, type: 'render_result', html });
        }
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err.message });
    }
};

async function initLibraries(paths) {
    // 动态加载库
    if (paths) {
        try {
            // 优先使用主线程传入的精确地址（支持本地绝对路径和页面引入的 CDN 地址）
            importScripts(
                paths.marked,
                paths.highlight
            );
        } catch (e) {
            console.warn('Worker 首选库加载失败，正在尝试公共 CDN 备用地址降级:', e);
            try {
                importScripts(
                    'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js',
                    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
                );
            } catch (fallbackErr) {
                console.error('Worker 公共 CDN 备选地址加载亦失败:', fallbackErr);
                throw fallbackErr;
            }
        }

        // 配置 marked
        if (self.marked) {
            self.marked.setOptions({
                gfm: true,
                breaks: true,
                highlight: function (code, lang) {
                    if (self.hljs) {
                        const language = self.hljs.getLanguage(lang) ? lang : 'plaintext';
                        return self.hljs.highlight(code, { language }).value;
                    }
                    return code;
                }
            });
        }
    }
}

function renderPipeline(text, role, messageIndex, totalVisibleMessages, config, regexRules) {
    let content = text || '';

    // 1. Pre-Markdown Regex
    content = applyPreMarkdownRules(content, role, messageIndex, totalVisibleMessages, regexRules);

    // 2. Marked Parsing
    if (!self.marked) throw new Error('Marked lib not loaded');
    let html = self.marked.parse(content);

    // 3. Sanitization (Moved to Main Thread)
    // Worker cannot run DOMPurify as it lacks DOM APIs.

    // 4. Code Block Enhancement
    html = enhanceAllCodeBlocks(html);

    return html;
}

/* -------------------------------------------------------------------------- */
/*                     Inlined Utils (Copied for Worker)                      */
/* -------------------------------------------------------------------------- */

// --- Regex Utils ---
function parseRegex(findString) {
    const literalRegex = /^\/(.*)\/([gimy]*)$/;
    const match = findString.match(literalRegex);
    if (match) return { pattern: match[1], flags: match[2] || '' };
    return { pattern: findString, flags: undefined };
}

const regexPatterns = {
    codeBlock: /```[\s\S]*?```/g,
    underlineText: /<u\b[^>]*>(.*?)<\/u>/g,
    escapeSpecialChars: /[.*+?^${}()|[\]\\]/g,
    // Add other needed patterns if any
};

function applyPreMarkdownRules(text, role, messageIndex, totalVisibleMessages, regexRules) {
    try {
        let textAfterThinking = text;
        const scope = `display-${role}`;

        let activeRules = [];
        if (regexRules && typeof regexRules === 'object') {
            activeRules = Object.values(regexRules).filter(rule =>
                rule.enabled &&
                (rule.stage === 'pre-markdown') &&
                rule.scopes.includes(scope)
            );
        }

        const internalPreRules = [
            {
                name: 'underlineText',
                sort: 998,
                find: regexPatterns.underlineText.source,
                flags: regexPatterns.underlineText.flags,
                replace: '<span class="underline-text">$1</span>'
            }
        ];

        const allRules = [...activeRules, ...internalPreRules];
        allRules.sort((a, b) => (a.sort || 0) - (b.sort || 0));

        if (allRules.length === 0 && !textAfterThinking.includes('```')) {
            return textAfterThinking;
        }

        const codeBlocks = [];
        const placeholderPrefix = 'GEMINI-CODEBLOCK-ID';
        const placeholderSuffix = '-END';

        let protectedText = textAfterThinking.replace(regexPatterns.codeBlock, (match) => {
            const placeholder = `${placeholderPrefix}${codeBlocks.length}${placeholderSuffix}`;
            codeBlocks.push(match);
            return placeholder;
        });

        let processedText = protectedText;
        for (const rule of allRules) {
            // Floor logic omitted for brevity/safety unless needed inside worker
            // Re-adding simple version
            if (typeof messageIndex === 'number' && typeof totalVisibleMessages === 'number') {
                const indexFromEnd = totalVisibleMessages - 1 - messageIndex;
                const minFloor = parseInt(rule.minFloor, 10) || 0;
                const maxFloor = parseInt(rule.maxFloor, 10) || 0;
                if (minFloor > 0 && indexFromEnd >= minFloor) continue;
                if (maxFloor > 0 && indexFromEnd < maxFloor) continue;
            }

            try {
                const { pattern, flags } = parseRegex(rule.find);
                const finalFlags = flags !== undefined ? flags : (rule.flags || 'g');
                const regex = new RegExp(pattern, finalFlags);
                processedText = processedText.replace(regex, rule.replace);
            } catch (e) {
                // Ignore error
            }
        }

        let finalText = processedText;
        for (let i = 0; i < codeBlocks.length; i++) {
            const placeholder = `${placeholderPrefix}${i}${placeholderSuffix}`;
            finalText = finalText.replace(placeholder, () => codeBlocks[i]);
        }

        return finalText;
    } catch (error) {
        return text;
    }
}

// --- Code Block Utils ---
const FILE_EXTENSIONS = {
    html: 'html', xml: 'xml', css: 'css', javascript: 'js', js: 'js', jsx: 'js',
    typescript: 'ts', ts: 'ts', tsx: 'ts', python: 'py', py: 'py', java: 'java',
    c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', php: 'php',
    ruby: 'rb', rb: 'rb', go: 'go', rust: 'rs', rs: 'rs', swift: 'swift',
    kotlin: 'kt', kt: 'kt', scala: 'scala', sql: 'sql', json: 'json',
    yaml: 'yml', yml: 'yml', markdown: 'md', md: 'md', bash: 'sh', sh: 'sh',
    shell: 'sh', powershell: 'ps1', ps1: 'ps1', batch: 'bat', bat: 'bat',
    dockerfile: 'Dockerfile', docker: 'Dockerfile', plaintext: 'txt', text: 'txt', txt: 'txt'
};

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

let blockCounter = 0;

function enhanceAllCodeBlocks(html) {
    if (!html || typeof html !== 'string') return html;
    blockCounter = 0; // Reset counter per render
    const codeBlockRegex = /<pre><code(?: class="language-([^\"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
    return html.replace(codeBlockRegex, (match, language, codeContent) => {
        // 乌鸦：拦截 tool_call 类型，替换为紧凑的工具调用申请条
        if (language === 'tool_call') {
            return createToolCallRequestBar(match, codeContent);
        }

        blockCounter++;
        const blockId = `code-block-${blockCounter}`;
        const escapedLanguage = escapeHtml(language || 'txt');
        const lineCount = (codeContent.match(/\n/g) || []).length;
        const isLongCode = lineCount > 15;

        // Minimal button generation - only static HTML
        const expandClass = isLongCode ? 'expand-code-btn suggest-expand' : 'expand-code-btn';
        let buttonsHtml = `
            <button id="copy-btn-${blockId}" class="copy-code-btn" data-action="copy" data-block-id="${blockId}">复制</button>
            <button id="download-btn-${blockId}" class="download-code-btn" data-action="download" data-block-id="${blockId}" data-language="${language}">下载</button>
        `;
        if (language === 'html' || language === 'htm') {
            buttonsHtml += `<button id="preview-btn-${blockId}" class="preview-html-btn" data-action="preview" data-block-id="${blockId}">预览</button>`;
        }
        buttonsHtml += `
            <button class="${expandClass}" data-action="expand-sidebar" data-block-id="${blockId}" title="在侧边栏展开">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                展开
            </button>
        `;

        return `
            <div class="code-block-container" data-block-id="${blockId}">
                <div class="code-block-header">
                    <span class="code-lang-tag">${escapedLanguage}</span>
                    <div class="code-block-actions">${buttonsHtml}</div>
                </div>
                ${match}
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
            </div>
        `;
    });
}

/**
 * 乌鸦：Worker 版工具调用申请条
 * 【修复】降级方案中追加对 originalMatch 的二次提取，防止 hljs span 标签导致"解析中"
 */
function createToolCallRequestBar(originalMatch, codeContent) {
    blockCounter++;
    const blockId = `code-block-${blockCounter}`;
    const rawJson = codeContent
        .replace(/<[^>]+>/g, '')  // 乌鸦：先清除 hljs 可能注入的 span 标签
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'");

    let toolInfoHtml = '';
    // 乌鸦：DEBUG - 查看流式时 rawJson 内容
    try {
        let toolCalls = JSON.parse(rawJson.trim());
        if (!Array.isArray(toolCalls)) toolCalls = [toolCalls];
        const toolItems = toolCalls.map(tc => {
            const toolId = escapeHtml(tc.tool || '未知工具');
            const hasProcessResult = tc.process_result === true;
            return `<span class="tool-call-request-item" data-tool-id="${toolId}">` +
                `<span class="tool-call-request-name">${toolId}</span>` +
                (hasProcessResult ? '<span class="tool-call-request-analyze">需分析</span>' : '') +
                `</span>`;
        });
        toolInfoHtml = toolItems.join('');
    } catch (e) {
        // 乌鸦：降级方案——用正则提取工具名（JSON 可能因 hljs 标签或流式不完整而解析失败）
        const toolRegex = /"tool"\s*:\s*"([^"]+)"/g;
        const processRegex = /"process_result"\s*:\s*true/;
        let match;
        const tools = [];
        while ((match = toolRegex.exec(rawJson)) !== null) {
            tools.push(match[1]);
        }

        // 乌鸦：rawJson 里提取不到时，对 originalMatch 做去标签处理后再次尝试
        // 原因：hljs 高亮把 JSON 关键字拆成多个 span，清理后引号对可能断裂导致正则失败
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

    return `
        <div class="tool-call-request-bar" data-block-id="${blockId}">
            <div class="tool-call-request-header">
                <span class="tool-call-request-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></span>
                <span class="tool-call-request-title">工具调用请求</span>
                <div class="tool-call-request-tools">${toolInfoHtml}</div>
                <button class="tool-call-request-expand-btn expand-code-btn" data-action="expand-sidebar" data-block-id="${blockId}" title="在侧边栏查看原始JSON">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    展开
                </button>
            </div>
            <div style="display:none;">${originalMatch}</div>
        </div>
    `;
}

