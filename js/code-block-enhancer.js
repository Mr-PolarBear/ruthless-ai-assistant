import { codePreviewManager } from './code-preview-manager.js?v=260820-1';

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

class CodeBlockEnhancer {
    constructor() {
        this.blockCounter = 0;
        this.processedShadowRoots = new WeakMap();
        this.boundClickHandler = null;
        // 跟踪按钮状态，key为 buttonId
        // 状态值: { state: 'copying'|'copied'|'idle', originalText: string }
        this.buttonStates = new Map();
    }

    getFileExtension(language) {
        const lang = (language || '').toLowerCase();
        return FILE_EXTENSIONS[lang] || 'txt';
    }

    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    generateBlockId() {
        this.blockCounter++;
        // 使用确定性 ID，Shadow DOM 会隔离不同消息的 ID 冲突
        // 这样在流式输出的 Diff 过程中，相同位置的代码块 ID 保持不变
        return `code-block-${this.blockCounter}`;
    }

    generateButtonsHtml(language, blockId, isLongCode) {
        const lang = language || 'txt';
        const isHtml = lang === 'html' || lang === 'htm';

        // 检查状态缓存，如果有状态，直接渲染对应状态的按钮
        const copyBtnId = `copy-btn-${blockId}`;
        const copyState = this.buttonStates.get(copyBtnId);

        let copyBtnText = '复制';
        let copyBtnClass = 'copy-code-btn';

        if (copyState) {
            if (copyState.state === 'copying') {
                copyBtnText = '处理中...';
            } else if (copyState.state === 'copied') {
                copyBtnText = '已复制';
                copyBtnClass += ' copied';
            }
        }

        // 使用稳定的ID
        let buttonsHtml = `
            <button id="${copyBtnId}" class="${copyBtnClass}" data-action="copy" data-block-id="${blockId}">${copyBtnText}</button>
            <button id="download-btn-${blockId}" class="download-code-btn" data-action="download" data-block-id="${blockId}" data-language="${language}">下载</button>
        `;

        if (isHtml) {
            buttonsHtml += `
                <button id="preview-btn-${blockId}" class="preview-html-btn" data-action="preview" data-block-id="${blockId}">预览</button>
            `;
        }

        // 乌鸦：新增侧边栏展开按钮
        // 如果代码较长，添加 suggest-expand 类以触发闪烁动画
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

    enhanceCodeBlock(match, language, codeContent) {
        const blockId = this.generateBlockId();
        const escapedLanguage = this.escapeHtml(language || 'txt');

        // 乌鸦：简单估算行数，超过15行认为需要建议展开
        const lineCount = (codeContent.match(/\n/g) || []).length;
        const isLongCode = lineCount > 15;

        const buttonsHtml = this.generateButtonsHtml(language, blockId, isLongCode);

        // 乌鸦：底部浮动条始终生成，由 CSS 的 .truncated 类控制显示/隐藏
        // 因为流式输出时代码块从短到长增长，初始渲染时无法判断最终行数
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

    enhanceAllCodeBlocks(html) {
        if (!html || typeof html !== 'string') return html;

        this.blockCounter = 0;

        // 乌鸦：更新正则以支持无语言类名的代码块
        const codeBlockRegex = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

        return html.replace(codeBlockRegex, (match, language, codeContent) => {
            // 乌鸦：拦截 tool_call 类型，替换为紧凑的工具调用申请条
            if (language === 'tool_call') {
                return this.createToolCallRequestBar(match, codeContent);
            }
            return this.enhanceCodeBlock(match, language, codeContent);
        });
    }

    /**
     * 乌鸦：将 tool_call 代码块替换为紧凑的"工具调用申请条"
     * @param {string} originalMatch - 原始的 <pre><code> HTML
     * @param {string} codeContent - 代码块内容（HTML 转义后的 JSON）
     * @returns {string} 工具调用申请条 HTML
     */
    createToolCallRequestBar(originalMatch, codeContent) {
        const blockId = this.generateBlockId();
        const rawJson = codeContent
            .replace(/<[^>]+>/g, '')  // 乌鸦：先清除 hljs 可能注入的 span 标签
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");

        let toolInfoHtml = '';
        try {
            let toolCalls = JSON.parse(rawJson.trim());
            if (!Array.isArray(toolCalls)) toolCalls = [toolCalls];

            const toolItems = toolCalls.map(tc => {
                const toolId = this.escapeHtml(tc.tool || '未知工具');
                const hasProcessResult = tc.process_result === true;
                return `<span class="tool-call-request-item" data-tool-id="${toolId}">` +
                    `<span class="tool-call-request-name">${toolId}</span>` +
                    (hasProcessResult ? '<span class="tool-call-request-analyze">需分析</span>' : '') +
                    `</span>`;
            });
            toolInfoHtml = toolItems.join('');
        } catch (e) {
            // 乌鸦：降级方案——用正则提取工具名
            const toolRegex = /"tool"\s*:\s*"([^"]+)"/g;
            const processRegex = /"process_result"\s*:\s*true/g;
            let match;
            const tools = [];
            while ((match = toolRegex.exec(rawJson)) !== null) {
                tools.push(match[1]);
            }
            if (tools.length > 0) {
                const hasProcess = processRegex.test(rawJson);
                toolInfoHtml = tools.map(t =>
                    `<span class="tool-call-request-item" data-tool-id="${this.escapeHtml(t)}">` +
                    `<span class="tool-call-request-name">${this.escapeHtml(t)}</span>` +
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
                    <span class="tool-call-request-icon">🔧</span>
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

    /**
     * 获取当前活动的按钮元素（即使 DOM 被替换也能找到）
     * @param {string} buttonId - 按钮 ID
     * @param {Node} contextNode - 上下文节点（用于查找 ShadowRoot）
     */
    findLiveButton(buttonId, contextNode) {
        if (!contextNode) return null;

        // 尝试从 Shadow Root 查找
        let root = contextNode instanceof ShadowRoot ? contextNode : contextNode.getRootNode();
        if (root && (root instanceof ShadowRoot || root instanceof Document)) {
            return root.getElementById(buttonId);
        }

        return document.getElementById(buttonId);
    }

    createClickHandler() {
        if (!this.boundClickHandler) {
            // 定义核心点击处理逻辑（闭包内）
            const coreHandler = (event) => {
                // 乌鸦：同时匹配按钮和底部浮动条的提示文字 span
                const button = event.target.closest('button[data-action]') || event.target.closest('.code-footer-hint[data-action]');
                if (!button) return;

                if (!button.dataset.action) return;

                // 乌鸦：兼容 .code-block-container 和 .tool-call-request-bar 两种容器
                const container = button.closest('.code-block-container') || button.closest('.tool-call-request-bar');
                if (!container) return;

                const codeElement = container.querySelector('code');
                // 乌鸦：对于 tool-call-request-bar，代码块在隐藏的 div 中
                // 如果没有 codeElement 且不是 expand-sidebar，跳过
                const action = button.dataset.action;
                if (!codeElement && action !== 'expand-sidebar') return;

                const codeText = codeElement ? codeElement.innerText : '';

                const buttonId = button.id;
                const shadowRoot = button.getRootNode();

                if (this.buttonStates.get(buttonId)?.state === 'copying') {
                    event.preventDefault();
                    return;
                }

                if (action === 'copy') {
                    // ... (copy logic) ...
                    this.buttonStates.set(buttonId, { state: 'copying', originalText: '复制' });
                    button.textContent = '处理中...';

                    setTimeout(() => {
                        this.handleCopy(codeText, buttonId, shadowRoot).finally(() => {
                            // handleCopy 内部处理 UI 恢复
                        });
                    }, 0);
                } else if (action === 'download') {
                    // ... (download logic) ...
                    const originalText = button.textContent;
                    button.textContent = '下载中';
                    try {
                        this.handleDownload(codeText, button.dataset.language);
                    } finally {
                        setTimeout(() => {
                            const liveBtn = this.findLiveButton(buttonId, shadowRoot);
                            if (liveBtn) liveBtn.textContent = originalText;
                        }, 500);
                    }
                } else if (action === 'preview') {
                    // ... (preview logic) ...
                    this.handlePreview(codeText);
                } else if (action === 'scroll-top' || action === 'scroll-bottom') {
                    // 乌鸦：代码块内滚动置顶/置底
                    const pre = container.querySelector('pre');
                    if (pre) {
                        pre.scrollTo({
                            top: action === 'scroll-top' ? 0 : pre.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                } else if (action === 'expand-sidebar') {
                    // 乌鸦：调用侧边栏管理器打开预览
                    const jsonContainer = container.closest('.json-table-container');

                    // 乌鸦：tool-call-request-bar 中代码块在隐藏的 div 中
                    if (container.classList.contains('tool-call-request-bar')) {
                        const hiddenDiv = container.querySelector('div[style*="display:none"]');
                        if (hiddenDiv) {
                            const codeEl = hiddenDiv.querySelector('code');
                            if (codeEl) {
                                codePreviewManager.open(button.dataset.blockId, container);
                            }
                        }
                    } else if (jsonContainer) {
                        codePreviewManager.open(button.dataset.blockId, jsonContainer);
                    } else {
                        codePreviewManager.open(button.dataset.blockId, container);
                    }
                }
            };

            // 乌鸦：扩展 click handler 以处理遮罩点击
            // 将核心逻辑包装在新的 handler 中
            this.boundClickHandler = (event) => {
                coreHandler(event); // 先执行原来的按钮逻辑

                const container = event.target.closest('.code-block-container');
                // 检查是否点击了遮罩（仅当容器被截断时有效）
                if (container && container.classList.contains('truncated')) {
                    // 检查是否点击了底部区域（遮罩高度约 60px）
                    const rect = container.getBoundingClientRect();
                    const clickY = event.clientY;
                    if (clickY > rect.bottom - 60) {
                        // 且点击的不是按钮
                        if (!event.target.closest('button')) {
                            // 模拟点击展开按钮
                            const expandBtn = container.querySelector('[data-action="expand-sidebar"]');
                            if (expandBtn) expandBtn.click();
                        }
                    }
                }
            };
        }
        return this.boundClickHandler;
    }

    handleCopy(text, buttonId, shadowRoot) {
        return new Promise((resolve) => {
            // 定义完成后的回调，用于更新 UI
            const onComplete = (success) => {
                // 更新状态为 completed
                if (success) {
                    this.buttonStates.set(buttonId, { state: 'copied', originalText: '复制' });

                    // 尝试更新当前 UI
                    const liveBtn = this.findLiveButton(buttonId, shadowRoot);
                    if (liveBtn) {
                        liveBtn.textContent = '已复制';
                        liveBtn.classList.add('copied');
                    }

                    // 2秒后恢复
                    setTimeout(() => {
                        this.buttonStates.delete(buttonId);
                        const liveBtnLater = this.findLiveButton(buttonId, shadowRoot);
                        if (liveBtnLater) {
                            liveBtnLater.textContent = '复制';
                            liveBtnLater.classList.remove('copied');
                        }
                    }, 2000);
                } else {
                    // 失败，立即恢复
                    this.buttonStates.delete(buttonId);
                    const liveBtn = this.findLiveButton(buttonId, shadowRoot);
                    if (liveBtn) liveBtn.textContent = '复制';
                }
                resolve();
            };

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => {
                    onComplete(true);
                }).catch(err => {
                    console.error('复制失败:', err);
                    this.fallbackCopy(text, buttonId, shadowRoot, onComplete);
                });
            } else {
                this.fallbackCopy(text, buttonId, shadowRoot, onComplete);
            }
        });
    }

    fallbackCopy(text, buttonId, shadowRoot, callback) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        let success = false;
        try {
            success = document.execCommand('copy');
        } catch (err) {
            console.error('复制失败:', err);
        } finally {
            document.body.removeChild(textArea);
            callback(success);
        }
    }

    handleDownload(text, language) {
        const extension = this.getFileExtension(language);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `code_${timestamp}.${extension}`;

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    handlePreview(text) {
        const newWindow = window.open('', '_blank');
        if (newWindow) {
            newWindow.document.write(text);
            newWindow.document.close();
        }
    }

    setupEventDelegation(shadowRoot) {
        if (!shadowRoot || typeof shadowRoot !== 'object' || !shadowRoot.nodeType) {
            return;
        }

        if (this.processedShadowRoots.has(shadowRoot)) {
            return;
        }

        const clickHandler = this.createClickHandler();
        shadowRoot.addEventListener('click', clickHandler);
        this.processedShadowRoots.set(shadowRoot, clickHandler);
    }
}

export default new CodeBlockEnhancer();