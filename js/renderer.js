/**
 * @file renderer.js
 * @description Core rendering engine, V3 (Refactored). Facade for rendering sub-systems.
 */

import { dom } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { getAvatar } from './db.js?v=260820-1';
import { getChatSearchKeyword } from './chat-search.js?v=260820-1';
import { scrollToBottom } from './ui-updater.js?v=260820-1';
import {
    updateAllMessagesCollapseState,
    addOrUpdateMessageFooter,
    updateMessageActions,
    updateSingleMessageCollapseState
} from './message-manager.js?v=260820-1';
import { openAvatarPreview, DEFAULT_AVATAR } from './modals.js?v=260820-1';
import { extractThinkingFromContent, parseStreamingThinkContent, jsonToMarkdownTable, isFloorHiddenInConfig, isMessageHidden } from './utils.js?v=260820-1';
import CodeBlockEnhancer from './code-block-enhancer.js?v=260820-1';
import { regexPatterns } from './regex.js?v=260820-1';

// --- Sub-system Imports ---
import { initSharedStyleSheets, getSharedStyleSheets, allShadowRoots } from './renderers/style-manager.js?v=260820-1';
import { updateDomPreservingCodeBlocks } from './renderers/stream-renderer.js?v=260820-1';
import { updateReasoningContainer, updateReasoningPartContent } from './renderers/reasoning-renderer.js?v=260820-1';
import { formatMessagePipeline, enhanceJsonCodeBlocks } from './renderers/markdown-engine.js?v=260820-1';
// Re-export UI populators for compatibility with main.js/settings-events.js
export { populateApiSelector, populatePersonaSelector, renderApiEndpointsList, renderPersonaModal, renderRegexRulesList } from './ui-populator.js?v=260820-1';
// Re-export markdown engine for external use if needed
export { formatMessagePipeline };
export { updateReasoningContainer, updateReasoningPartContent };

// --- Avatar Caching ---

/**
 * 乌鸦：新增的头像URL缓存管理器
 */
async function getAvatarUrl(avatarId) {
    if (!avatarId) return DEFAULT_AVATAR;
    if (state.avatarUrlCache.has(avatarId)) {
        return state.avatarUrlCache.get(avatarId);
    }

    try {
        const blob = await getAvatar(avatarId);
        if (blob) {
            const url = URL.createObjectURL(blob);
            state.avatarUrlCache.set(avatarId, url);
            return url;
        }
    } catch (e) {
        console.error(`Failed to get avatar ${avatarId} from DB`, e);
    }

    state.avatarUrlCache.set(avatarId, DEFAULT_AVATAR);
    return DEFAULT_AVATAR;
}

function escapeRegex(str) {
    return str.replace(regexPatterns.escapeSpecialChars, '\\$&');
}

// --- Shadow DOM Rendering ---

export async function renderFormattedContent(element, html, options = {}) {
    if (!element) return;

    const { isStreaming = false } = options;

    // 乌鸦：不再在主界面自动增强 JSON 表格，改为在侧边栏按需渲染
    const finalHtml = html; // enhanceJsonCodeBlocks(html);

    let shadow = element.shadowRoot;
    let contentWrapper;

    if (!shadow) {
        shadow = element.attachShadow({ mode: 'open' });

        await initSharedStyleSheets();
        shadow.adoptedStyleSheets = getSharedStyleSheets();

        allShadowRoots.add(shadow);

        contentWrapper = document.createElement('div');
        contentWrapper.className = 'shadow-content-wrapper';
        shadow.appendChild(contentWrapper);
    } else {
        contentWrapper = shadow.querySelector('.shadow-content-wrapper');
        if (!contentWrapper) {
            // Migration logic for old shadow roots
            await initSharedStyleSheets();
            shadow.adoptedStyleSheets = getSharedStyleSheets();
            allShadowRoots.add(shadow);

            contentWrapper = document.createElement('div');
            contentWrapper.className = 'shadow-content-wrapper';
            const existingNodes = Array.from(shadow.childNodes).filter(n => {
                if (n.nodeType === 1) {
                    return !['STYLE', 'LINK'].includes(n.tagName);
                }
                return n.nodeType === 3 && n.textContent.trim();
            });
            existingNodes.forEach(n => contentWrapper.appendChild(n));
            shadow.querySelectorAll('link, style').forEach(el => el.remove());
            shadow.appendChild(contentWrapper);
        }
    }

    // Preserve details open state
    const detailsStates = [];
    if (contentWrapper && contentWrapper.querySelectorAll) {
        contentWrapper.querySelectorAll('details').forEach((el, index) => {
            if (el.open) {
                detailsStates.push(index);
            }
        });
    }

    // Smart DOM update
    if (contentWrapper) {
        updateDomPreservingCodeBlocks(contentWrapper, finalHtml, isStreaming);
    } else {
        console.warn('[renderFormattedContent] contentWrapper is null, skipping render');
        return;
    }

    // Restore details state
    if (detailsStates.length > 0 && contentWrapper) {
        contentWrapper.querySelectorAll('details').forEach((el, index) => {
            if (detailsStates.includes(index)) {
                el.open = true;
            }
        });
    }

    // Highlight new code blocks
    if (shadow) {
        shadow.querySelectorAll('pre').forEach(pre => {
            const codeBlock = pre.querySelector('code');
            if (codeBlock && !codeBlock.dataset.highlighted) {
                // 乌鸦：修复 language-tool_call 导致的 hljs 警告
                // 如果是 tool_call，我们将其视为 JSON 进行高亮
                if (codeBlock.classList.contains('language-tool_call')) {
                    codeBlock.classList.remove('language-tool_call');
                    codeBlock.classList.add('language-json');
                }

                try {
                    window.hljs.highlightElement(codeBlock);
                } catch (e) {
                    console.warn('HighlightJS failed:', e);
                }
            }
        });
    }

    // Setup event delegation for code block buttons
    if (shadow && shadow.nodeType) {
        CodeBlockEnhancer.setupEventDelegation(shadow);
    }

    // 乌鸦：工具调用申请条的中文名匹配
    // code-block-utils.js 可能在 Worker 中运行，无法访问 DEFAULT_TOOLS
    // 所以在主线程渲染后再匹配中文名
    if (shadow) {
        shadow.querySelectorAll('.tool-call-request-item[data-tool-id]').forEach(item => {
            const toolId = item.dataset.toolId;
            const nameEl = item.querySelector('.tool-call-request-name');
            if (!nameEl || nameEl.dataset.resolved) return;

            // 从注册表查找中文名
            const allTools = {
                ...(window.DEFAULT_TOOLS || {}),
                ...(state.mcpCustomTools || {})
            };
            const tool = Object.values(allTools).find(t => t.id === toolId || t.name === toolId);
            if (tool && tool.name !== toolId) {
                nameEl.textContent = `${tool.name}(${toolId})`;
            }
            nameEl.dataset.resolved = 'true';
        });
    }

    // 乌鸦：渲染 Mermaid 图表
    if (!isStreaming && shadow) {
        renderMermaidDiagrams(shadow);
    }

    // JSON table handlers
    shadow.querySelectorAll('.toggle-json-table-btn').forEach(button => {
        if (button.dataset.listenerAttached) return;
        button.dataset.listenerAttached = 'true';
        button.addEventListener('click', () => {
            const uniqueId = button.dataset.targetId;
            const container = shadow.querySelector(`[data-block-id="${uniqueId}"]`);
            if (!container) return;
            const tableView = container.querySelector('.table-view');
            const codeView = container.querySelector('.code-view');
            if (tableView.style.display === 'none') {
                if (!tableView.innerHTML.trim()) {
                    const jsonString = codeView.querySelector('code.language-json').textContent;
                    const tableHtml = jsonToMarkdownTable(jsonString);
                    tableView.innerHTML = tableHtml || '<p style="color: var(--text-error);">无法渲染无效的JSON数据。</p>';
                }
                tableView.style.display = 'block';
                codeView.style.display = 'none';
                button.textContent = '显示代码';
            } else {
                tableView.style.display = 'none';
                codeView.style.display = 'block';
                button.textContent = '渲染表格';
                const codeBlock = codeView.querySelector('code');
                if (codeBlock) window.hljs.highlightElement(codeBlock);
            }
            const messageBubble = element.closest('.message-bubble');
            if (messageBubble) {
                setTimeout(() => updateSingleMessageCollapseState(messageBubble), 50);
            }
        });
    });

    // Link target fix
    shadow.querySelectorAll('a').forEach(link => {
        if (!link.target) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    });
}

// --- Message Updates & Rendering ---

let currentRenderId = 0;

export async function refreshMessageBubble(originalBubble, message, index) {
    if (!originalBubble || !message) return;

    const wrapper = originalBubble.closest('.message-wrapper');
    if (!wrapper) return;

    const newWrapper = await displayMessage(message, index, null, -1, 0, {
        isInitialRender: false,
        playIntroAnimation: false
    });

    const newBubble = newWrapper.querySelector('.message-bubble');

    if (newWrapper.parentNode) {
        newWrapper.parentNode.removeChild(newWrapper);
    }

    wrapper.replaceWith(newWrapper);

    setTimeout(() => {
        updateSingleMessageCollapseState(newBubble, false);
    }, 50);
}

function autoSetConversationTitle(conv) {
    if (!conv || conv.title) return;
    for (const branch of conv.branches) {
        const userMsg = branch.find(msg => msg.role === 'user' && msg.content && msg.content.trim());
        if (userMsg) {
            conv.title = userMsg.content.trim().slice(0, 10);
            return;
        }
    }
}

export async function displayMessage(message, index, highlightKeyword, visibleIndex, totalVisibleMessages, options = {}) {
    const { isInitialRender = false, playIntroAnimation = false, isPlaceholder = false } = options;
    const { content, role, attachment, attachments, apiEndpointId, id } = message;
    const sender = role === 'user' ? 'user' : 'ai';
    const messageWrapper = document.createElement('div');

    // Placeholder Logic（方案C：卡片式占位符 + 单条加载）
    if (isPlaceholder) {
        messageWrapper.className = `message-wrapper ${sender} placeholder`;

        // 乌鸦：外层气泡壳复用 message-bubble 的布局，追加 collapsed-placeholder-card 作为功能类
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-bubble ${sender} collapsed-placeholder-card`;
        messageDiv.dataset.index = index;
        if (id) messageDiv.dataset.id = id;

        // --- 角色标签（区分用户/AI，带 emoji） ---
        const roleTag = document.createElement('span');
        roleTag.className = 'placeholder-role-tag';
        // 乌鸦：根据角色设置不同图标，让视觉上一目了然
        roleTag.textContent = sender === 'user' ? '👤 用户' : '🤖 AI';

        // --- 楼层号 ---
        const floorTag = document.createElement('span');
        floorTag.className = 'placeholder-floor';
        floorTag.textContent = `#${index + 1}楼`;

        // --- 内容预览（截取60字，换行符转空格） ---
        const contentPreview = message.content.substring(0, 60).replace(/\n/g, ' ');
        const previewText = document.createElement('span');
        previewText.className = 'placeholder-text';
        previewText.textContent = `${contentPreview}${message.content.length > 60 ? '…' : ''}`;

        // --- 加载按钮 ---
        const loadBtn = document.createElement('button');
        loadBtn.className = 'placeholder-load-btn';
        loadBtn.textContent = '加载此消息';

        // 乌鸦：点击后即时渲染这单条消息并替换占位符 DOM
        // 传入 isPlaceholder: false 走正常渲染流程，不影响其他占位符
        loadBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // 避免事件冒泡

            // 乌鸦：按钮防重复点击
            loadBtn.disabled = true;
            loadBtn.textContent = '加载中…';

            const newWrapper = await displayMessage(message, index, undefined, -1, 0, {
                isInitialRender: false,
                playIntroAnimation: true,
                isPlaceholder: false
            });

            // 乌鸦：将新渲染的消息替换当前占位符 wrapper
            messageWrapper.replaceWith(newWrapper);
        });

        messageDiv.append(roleTag, floorTag, previewText, loadBtn);
        messageWrapper.appendChild(messageDiv);
        return messageWrapper;
    }

    let wrapperClass = `message-wrapper ${sender}`;
    if (isInitialRender && sender === 'ai') {
        wrapperClass += ' content-hidden-initial';
    } else if (playIntroAnimation) {
        wrapperClass += ' new-message-animation';
    }
    messageWrapper.className = wrapperClass;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message-bubble ${sender}`;
    messageDiv.dataset.index = index;
    if (id) messageDiv.dataset.id = id;
    const conv = state.conversations[state.currentConversationId];
    if (sender === 'user' && index === 0) {
        autoSetConversationTitle(conv);
    }
    const senderLine = document.createElement('div');
    senderLine.className = 'sender-line';
    let hideTip = null;
    if (isMessageHidden(message, index + 1, state.hideSummary && state.hideSummary[conv?.id])) {
        hideTip = document.createElement('span');
        hideTip.className = 'hide-summary-tip';
        hideTip.textContent = '已隐藏';
    }
    const floorNumber = index + 1;
    const floorSpan = document.createElement('span');
    floorSpan.className = 'message-floor';
    floorSpan.textContent = `${floorNumber}楼`;

    if (sender === 'user') {
        senderLine.style.textAlign = 'right';
        floorSpan.style.marginRight = 'auto';
        senderLine.appendChild(floorSpan);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sender-name';
        nameSpan.textContent = '您';
        if (hideTip) senderLine.appendChild(hideTip);
        senderLine.appendChild(nameSpan);

        // User Avatar Handling
        if (state.appSettings.userAvatar && state.appSettings.userAvatar.type === 'indexeddb') {
            let userAvatarSrc = DEFAULT_AVATAR;
            const userAvatarId = state.appSettings.userAvatar.id;
            if (userAvatarId && state.avatarUrlCache.has(userAvatarId)) {
                userAvatarSrc = state.avatarUrlCache.get(userAvatarId);
            }
            const avatarImg = document.createElement('img');
            avatarImg.src = userAvatarSrc;
            avatarImg.alt = '头像';
            avatarImg.style.cssText = 'width:42px;height:42px;border-radius:50%;object-fit:cover;margin-left:0.5em;border:1px solid var(--border-color);background:#eee;cursor:pointer;';
            avatarImg.onclick = () => openAvatarPreview(userAvatarId, 'indexeddb');
            senderLine.appendChild(avatarImg);
        } else if (state.appSettings.userAvatar) {
            const avatarImg = document.createElement('img');
            avatarImg.src = state.appSettings.userAvatar;
            avatarImg.alt = '头像';
            avatarImg.style.cssText = 'width:42px;height:42px;border-radius:50%;object-fit:cover;margin-left:0.5em;border:1px solid var(--border-color);background:#eee;cursor:pointer;';
            avatarImg.onclick = () => openAvatarPreview(state.appSettings.userAvatar, 'url');
            senderLine.appendChild(avatarImg);
        }
    } else {
        senderLine.style.textAlign = 'left';
        let apiName = 'AI 助手';
        if (apiEndpointId && state.apiEndpoints[apiEndpointId]) {
            apiName = state.apiEndpoints[apiEndpointId].name || 'AI 助手';
        }

        // AI Avatar Handling
        if (conv && conv.avatar && conv.avatar.type === 'indexeddb') {
            let assistantAvatarSrc = DEFAULT_AVATAR;
            const convAvatarId = conv.avatar.id;
            if (convAvatarId && state.avatarUrlCache.has(convAvatarId)) {
                assistantAvatarSrc = state.avatarUrlCache.get(convAvatarId);
            }
            const avatarImg = document.createElement('img');
            avatarImg.src = assistantAvatarSrc;
            avatarImg.alt = '头像';
            avatarImg.style.cssText = 'width:42px;height:42px;border-radius:50%;object-fit:cover;margin-right:0.5em;border:1px solid var(--border-color);background:#eee;cursor:pointer;';
            avatarImg.onclick = () => openAvatarPreview(convAvatarId, 'indexeddb');
            senderLine.appendChild(avatarImg);
        } else if (conv && conv.avatar) {
            const avatarImg = document.createElement('img');
            avatarImg.src = conv.avatar;
            avatarImg.alt = '头像';
            avatarImg.style.cssText = 'width:42px;height:42px;border-radius:50%;object-fit:cover;margin-right:0.5em;border:1px solid var(--border-color);background:#eee;cursor:pointer;';
            avatarImg.onclick = () => openAvatarPreview(conv.avatar, 'url');
            senderLine.appendChild(avatarImg);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'sender-name';
        nameSpan.textContent = apiName;
        senderLine.appendChild(nameSpan);
        if (hideTip) senderLine.appendChild(hideTip);
        senderLine.appendChild(floorSpan);

        // 乌鸦：MCP 工具调用数量徽章
        if (message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            const badge = document.createElement('span');
            badge.className = 'mcp-tool-badge';
            badge.textContent = `MCP ×${message.toolCalls.length}`;
            badge.title = `本条消息调用了 ${message.toolCalls.length} 个工具`;
            // 乌鸦：点击跳转到 MCP 结果区域（如果消息折叠则先展开）
            badge.addEventListener('click', () => {
                const bubble = badge.closest('.message-bubble');
                if (!bubble) return;
                // 如果消息处于折叠状态，先展开
                const contentEl = bubble.querySelector('.message-content');
                if (contentEl && contentEl.classList.contains('collapsible')) {
                    import('./message-manager.js?v=260820-1').then(module => {
                        module.updateSingleMessageCollapseState(bubble, false);
                    });
                }
                // 延迟后跳转到 tool-calls-container
                setTimeout(() => {
                    const mcpContainer = bubble.querySelector('.tool-calls-container');
                    if (mcpContainer) {
                        mcpContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            });
            senderLine.appendChild(badge);
        }
    }

    const headerEl = document.createElement('div');
    headerEl.className = 'message-header';
    if (sender === 'user') {
        headerEl.style.display = 'flex';
        headerEl.style.justifyContent = 'flex-end';
    }
    headerEl.innerHTML = `<div class="message-actions"></div>`;

    updateMessageActions(headerEl.querySelector('.message-actions'), message, index);

    let contentEl = document.createElement('div');
    contentEl.className = 'message-content expanded';
    const defaultMode = role === 'user'
        ? (state.appSettings.userMessageDefaultRenderMode || 'md')
        : (state.appSettings.aiMessageDefaultRenderMode || 'md');
    contentEl.dataset.viewMode = defaultMode;

    if (defaultMode === 'raw') {
        if (contentEl.shadowRoot) {
            const newContentEl = contentEl.cloneNode(false);
            contentEl.parentNode.replaceChild(newContentEl, contentEl);
            contentEl = newContentEl;
        }
        const pre = document.createElement('pre');
        pre.textContent = content;
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-all';
        pre.style.padding = '10px';
        pre.style.boxSizing = 'border-box';
        contentEl.appendChild(pre);
        if (role === 'user') {
            contentEl.classList.add('raw-view-user-bg');
        }
    } else {
        let contentToRender = content;
        let reasoningToRender = message.reasoningParts || null;

        if (sender === 'ai' && content) {
            const { reasoningParts, mainContent } = extractThinkingFromContent(content);
            contentToRender = mainContent;

            if (!reasoningToRender && reasoningParts.length > 0) {
                reasoningToRender = reasoningParts;
            }
        }

        const formattedHtml = await formatMessagePipeline(contentToRender, role, visibleIndex, totalVisibleMessages);
        renderFormattedContent(contentEl, formattedHtml);

        message._tempReasoningParts = reasoningToRender;
    }

    // Keyword highlighting logic
    if (highlightKeyword && typeof content === 'string' && highlightKeyword.trim() && defaultMode === 'md') {
        setTimeout(() => {
            if (!contentEl.shadowRoot) return;

            const kw = escapeRegex(highlightKeyword);
            const regex = new RegExp(`(${kw})`, 'gi');

            function highlightNodeInShadow(node) {
                if (node.nodeType === 3) {
                    if (node.textContent.trim()) {
                        const frag = document.createDocumentFragment();
                        let lastIdx = 0;
                        let m;
                        const text = node.textContent;
                        regex.lastIndex = 0;
                        while ((m = regex.exec(text))) {
                            if (m.index > lastIdx) {
                                frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
                            }
                            const mark = document.createElement('mark');
                            mark.className = 'chat-search-highlight';
                            mark.textContent = m[1];
                            frag.appendChild(mark);
                            lastIdx = m.index + m.length;
                        }
                        if (lastIdx < text.length) {
                            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
                        }
                        if (frag.childNodes.length > 0) {
                            node.parentNode.replaceChild(frag, node);
                        }
                    }
                } else if (node.nodeType === 1 && !['CODE', 'PRE', 'STYLE', 'SCRIPT'].includes(node.tagName)) {
                    Array.from(node.childNodes).forEach(highlightNodeInShadow);
                }
            }

            Array.from(contentEl.shadowRoot.childNodes).forEach(highlightNodeInShadow);
        }, 50);
    }

    messageDiv.append(senderLine, headerEl, contentEl);

    // Render reasoning content (AI only)
    if (sender === 'ai' && message._tempReasoningParts && message._tempReasoningParts.length > 0) {
        updateReasoningContainer(messageDiv, message._tempReasoningParts, false, true);
        delete message._tempReasoningParts;
    }

    // MCP Tool Call rendering
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
        const isInitiallyExpanded = false;
        message.toolCalls.forEach((toolCallResult, index) => {
            if (toolCallResult && toolCallResult.success !== undefined) {
                import('./mcp-renderer.js?v=260820-1').then(module => {
                    module.renderToolCallResult(messageDiv, toolCallResult, index, isInitiallyExpanded);
                });
            }
        });
    }

    // Analysis Result rendering
    // 乌鸦：如果有 analysisRounds 元数据，按轮次交错渲染；否则退回旧逻辑兼容老数据
    if (message.analysisRounds && message.analysisRounds.length > 0) {
        import('./mcp-renderer.js?v=260820-1').then(async ({ renderToolCallResult }) => {
            for (const roundData of message.analysisRounds) {
                // 乌鸦：创建本轮分析容器
                const analysisContainer = document.createElement('div');
                analysisContainer.className = 'analysis-result-container';
                analysisContainer.setAttribute('data-round', roundData.round);

                const analysisHeader = document.createElement('div');
                analysisHeader.className = 'analysis-header';
                analysisHeader.innerHTML = `<h5><i class="fas fa-lightbulb"></i> 第${roundData.round}轮请求，AI分析结果如下：</h5>`;
                analysisContainer.appendChild(analysisHeader);

                const analysisContentEl = document.createElement('div');
                analysisContentEl.className = 'message-content';
                analysisContainer.appendChild(analysisContentEl);
                messageDiv.appendChild(analysisContainer);

                // 乌鸦：渲染本轮分析内容
                let contentToRender = roundData.content;
                if (roundData.reasoning) {
                    updateReasoningContainer(null, [{
                        content: roundData.reasoning,
                        source: 'field',
                        order: 0
                    }], false, true, analysisContainer);
                }

                const formattedHtml = await formatMessagePipeline(contentToRender, 'assistant', visibleIndex, totalVisibleMessages);
                renderFormattedContent(analysisContentEl, formattedHtml);

                // 乌鸦：渲染本轮的工具结果（插在分析容器之后）
                if (roundData.toolCallCount > 0 && message.toolCalls) {
                    const toolContainer = document.createElement('div');
                    toolContainer.className = 'tool-calls-container';
                    toolContainer.setAttribute('data-round', roundData.round + 1);

                    for (let i = 0; i < roundData.toolCallCount; i++) {
                        const toolIdx = roundData.toolCallStartIndex + i;
                        if (message.toolCalls[toolIdx]) {
                            renderToolCallResult(messageDiv, message.toolCalls[toolIdx], toolIdx, false, roundData.round + 1);
                        }
                    }

                    // 乌鸦：把新渲染的工具块从全局容器移到 per-round 容器
                    const globalContainer = messageDiv.querySelector('.tool-calls-container:not([data-round])');
                    if (globalContainer) {
                        for (let i = 0; i < roundData.toolCallCount; i++) {
                            const toolIdx = roundData.toolCallStartIndex + i;
                            const block = globalContainer.querySelector(`[data-call-index="${toolIdx}"]`);
                            if (block) {
                                toolContainer.appendChild(block);
                            }
                        }
                        if (globalContainer.children.length === 0) {
                            globalContainer.remove();
                        }
                    }

                    if (toolContainer.children.length > 0) {
                        messageDiv.appendChild(toolContainer);
                    }
                }
            }
        });
    } else if (message.analysisResult && typeof message.analysisResult === 'string') {
        // 乌鸦：旧数据兼容——单个分析容器
        import('./mcp-renderer.js?v=260820-1').then(async () => {
            let analysisContainer = messageDiv.querySelector('.analysis-result-container');
            if (!analysisContainer) {
                const toolCallsContainer = messageDiv.querySelector('.tool-calls-container');
                analysisContainer = document.createElement('div');
                analysisContainer.className = 'analysis-result-container';

                const analysisHeader = document.createElement('div');
                analysisHeader.className = 'analysis-header';
                analysisHeader.innerHTML = '<h5><i class="fas fa-lightbulb"></i> AI分析结果如下：</h5>';
                analysisContainer.appendChild(analysisHeader);

                const analysisContentEl = document.createElement('div');
                analysisContentEl.className = 'message-content';
                analysisContainer.appendChild(analysisContentEl);

                if (toolCallsContainer) {
                    if (toolCallsContainer.nextSibling) {
                        toolCallsContainer.parentNode.insertBefore(analysisContainer, toolCallsContainer.nextSibling);
                    } else {
                        toolCallsContainer.parentNode.appendChild(analysisContainer);
                    }
                } else {
                    messageDiv.appendChild(analysisContainer);
                }
            }

            const analysisContentEl = analysisContainer.querySelector('.message-content');
            if (analysisContentEl) {
                let contentToRender = message.analysisResult;
                let reasoningPartsToRender = [];

                if (message.analysisReasoning) {
                    reasoningPartsToRender = [{
                        content: message.analysisReasoning,
                        source: 'field',
                        order: 0
                    }];
                } else {
                    const { thinkingContent, mainContent } = parseStreamingThinkContent(contentToRender);
                    if (thinkingContent) {
                        reasoningPartsToRender = [{
                            content: thinkingContent,
                            source: 'inline',
                            order: 0
                        }];
                        contentToRender = mainContent;
                    } else {
                        const extracted = extractThinkingFromContent(contentToRender);
                        reasoningPartsToRender = extracted.reasoningParts;
                        contentToRender = extracted.mainContent;
                    }
                }

                if (reasoningPartsToRender.length > 0) {
                    updateReasoningContainer(null, reasoningPartsToRender, false, true, analysisContainer);
                }

                const formattedHtml = await formatMessagePipeline(contentToRender, 'assistant', visibleIndex, totalVisibleMessages);
                renderFormattedContent(analysisContentEl, formattedHtml);
            }
        });
    }

    const allAttachments = [].concat(attachment ? [attachment] : [], attachments || []);
    if (allAttachments.length > 0) {
        allAttachments.forEach(att => {
            const attachmentEl = document.createElement('div');
            attachmentEl.className = 'attachment-display';
            attachmentEl.title = `点击查看附件: ${att.name}`;
            
            // 乌鸦：计算大小/字数信息，直接显示在附件条上
            let sizeInfo = '';
            const isImage = att.isImage || att.type?.startsWith('image/');
            if (att.isDocument && att.charCount) {
                sizeInfo = `<span style="color:inherit;opacity:0.65;font-size:0.85em;margin-left:4px;">${att.charCount}字</span>`;
            } else if (isImage && att.size) {
                sizeInfo = `<span style="color:inherit;opacity:0.65;font-size:0.85em;margin-left:4px;">${(att.size / 1024).toFixed(0)}KB</span>`;
            } else if (att.content && typeof att.content === 'string' && !att.content.startsWith('data:')) {
                sizeInfo = `<span style="color:inherit;opacity:0.65;font-size:0.85em;margin-left:4px;">${att.content.length}字</span>`;
            }
            
            attachmentEl.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                <span>${att.name}</span>
                ${sizeInfo}
            `;
            attachmentEl.dataset.filename = att.name;
            attachmentEl.dataset.filecontent = att.content;
            messageDiv.appendChild(attachmentEl);
        });
    }
    addOrUpdateMessageFooter(messageDiv, message);
    messageWrapper.appendChild(messageDiv);
    return messageWrapper;
}

export async function renderChatMessages(options) {
    const {
        callback,
        scrollBehavior = 'bottom',
        updateVisibilityOnly = false,
        isNewMessage = false,
        forceLoadAll = false
    } = options || {};

    const conv = state.conversations[state.currentConversationId];

    let hasMCPContent = false;
    if (conv && conv.branches && conv.branches[conv.activeBranchIndex]) {
        const activeBranch = conv.branches[conv.activeBranchIndex];
        hasMCPContent = activeBranch.some(msg =>
            msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
        );
    }

    // Pre-load avatars
    if (conv) {
        try {
            const userAvatarId = state.appSettings.userAvatar?.id;
            const convAvatarId = conv.avatar?.id;
            if (userAvatarId) await getAvatarUrl(userAvatarId);
            if (convAvatarId) await getAvatarUrl(convAvatarId);
        } catch (e) {
            console.error("Avatar pre-loading failed:", e);
        }
    }

    await initSharedStyleSheets();

    if (updateVisibilityOnly) {
        const convId = state.currentConversationId;
        if (!convId) return;

        const summaryConfig = (state.hideSummary && state.hideSummary[convId]) ? state.hideSummary[convId] : {};
        const { enabled, start, end } = summaryConfig;

        const messageWrappers = dom.chatMessages.querySelectorAll('.message-wrapper');
        messageWrappers.forEach(wrapper => {
            const bubble = wrapper.querySelector('.message-bubble');
            if (!bubble) return;

            const index = parseInt(bubble.dataset.index, 10);
            const floor = index + 1;
            const conv = state.conversations[convId];
            const activeBranch = (conv && conv.branches) ? conv.branches[conv.activeBranchIndex] : [];
            const msg = activeBranch ? activeBranch[index] : null;
            const shouldBeHidden = isMessageHidden(msg, floor, summaryConfig);

            const senderLine = bubble.querySelector('.sender-line');
            if (!senderLine) return;
            let hideTip = senderLine.querySelector('.hide-summary-tip');

            if (shouldBeHidden) {
                if (!hideTip) {
                    hideTip = document.createElement('span');
                    hideTip.className = 'hide-summary-tip';
                    hideTip.textContent = '已隐藏';
                    const floorSpan = senderLine.querySelector('.message-floor');
                    if (floorSpan) {
                        floorSpan.insertAdjacentElement('afterend', hideTip);
                    }
                }
            } else {
                if (hideTip) {
                    hideTip.remove();
                }
            }
        });

        if (callback) callback();
        return;
    }

    const scrollBefore = dom.chatMessages.scrollHeight - dom.chatMessages.scrollTop;

    // 乌鸦：生成本次渲染的唯一ID，防止竞态条件
    const thisRenderId = ++currentRenderId;

    dom.chatMessages.style.visibility = 'hidden';
    dom.chatMessages.innerHTML = '';
    if (!conv) {
        displayWelcomeMessage();
        dom.chatMessages.style.visibility = 'visible';
        return;
    }
    const activeBranch = conv.branches[conv.activeBranchIndex] || [];
    const keyword = getChatSearchKeyword && getChatSearchKeyword().trim();

    // 乌鸦：改为异步处理以支持 Web Worker 渲染
    if (keyword) {
        const lower = keyword.toLowerCase();
        const filtered = activeBranch.map((msg, idx) => ({ msg, idx }))
            .filter(({ msg }) => typeof msg.content === 'string' && msg.content.toLowerCase().includes(lower));
        if (filtered.length === 0) {
            dom.chatMessages.innerHTML = '<div style="color:#888;text-align:center;margin:2em 0;">未找到相关消息</div>';
        } else {
            const totalVisible = filtered.length;
            // 乌鸦：使用 for...of 保证顺序
            for (let visibleIdx = 0; visibleIdx < filtered.length; visibleIdx++) {
                // 乌鸦：检查是否已被新的渲染任务打断
                if (thisRenderId !== currentRenderId) return;

                const { msg, idx } = filtered[visibleIdx];
                const wrapper = await displayMessage(msg, idx, keyword, visibleIdx, totalVisible);

                // 乌鸦：再次检查，因为 await 期间可能发生了新的渲染
                if (thisRenderId !== currentRenderId) return;

                dom.chatMessages.appendChild(wrapper);
            }
        }
    } else {
        if (activeBranch.length === 0) {
            displayWelcomeMessage("这是一个新的对话，请开始提问。");
        } else {
            const convId = state.currentConversationId;
            const hideSummaryConfig = (state.hideSummary && state.hideSummary[convId]) || {};

            const visibleMessages = activeBranch
                .map((msg, index) => ({ msg, originalIndex: index }))
                .filter(({ originalIndex }) => {
                    if (!hideSummaryConfig.enabled) return true;
                    const floor = originalIndex + 1;
                    return floor < hideSummaryConfig.start || floor > hideSummaryConfig.end;
                });

            const totalVisible = visibleMessages.length;
            const visibleIndexMap = new Map();
            visibleMessages.forEach(({ originalIndex }, visibleIndex) => {
                visibleIndexMap.set(originalIndex, visibleIndex);
            });

            let recentCount;
            if (forceLoadAll) {
                recentCount = 0;
            } else {
                recentCount = state.appSettings.recentMessageCount !== undefined && state.appSettings.recentMessageCount !== null
                    ? state.appSettings.recentMessageCount
                    : 5;
            }

            // 乌鸦：使用 for...of 保证顺序
            for (let index = 0; index < activeBranch.length; index++) {
                // 乌鸦：检查是否已被新的渲染任务打断
                if (thisRenderId !== currentRenderId) return;

                const msg = activeBranch[index];
                const isVisible = visibleIndexMap.has(index);
                const visibleIndex = isVisible ? visibleIndexMap.get(index) : -1;

                const isRecent = recentCount === 0 || index >= activeBranch.length - recentCount;
                const wrapper = await displayMessage(msg, index, undefined, visibleIndex, totalVisible, {
                    isInitialRender: true,
                    isPlaceholder: !isRecent && recentCount > 0
                });

                // 乌鸦：再次检查
                if (thisRenderId !== currentRenderId) return;

                dom.chatMessages.appendChild(wrapper);
            }

            const shouldShowBtn = recentCount && recentCount > 0 && activeBranch.length > recentCount;
            if (dom.loadAllMessagesBtn) {
                dom.loadAllMessagesBtn.style.display = shouldShowBtn ? 'block' : 'none';
            }
        }
    }

    // 乌鸦：如果在所有 await 结束后，渲染ID仍匹配，则执行收尾工作
    if (thisRenderId !== currentRenderId) return;

    setTimeout(() => {
        updateAllMessagesCollapseState({ isNewMessage });

        const hiddenContents = dom.chatMessages.querySelectorAll('.content-hidden-initial');
        hiddenContents.forEach(el => {
            el.style.transition = 'opacity 0.2s ease-in-out';
            el.classList.remove('content-hidden-initial');
        });

        if (!state.appSettings.autoCollapseMessages) {
            const messageBubbles = dom.chatMessages.querySelectorAll('.message-bubble');
            messageBubbles.forEach(bubble => {
                const contentEl = bubble.querySelector('.message-content');
                if (contentEl && contentEl.classList.contains('expanded')) {
                    const mcpBlocks = bubble.querySelectorAll('.tool-call-block');
                    if (mcpBlocks.length === 0) return;

                    if (state.appSettings.autoCollapseLongMessage === false) {
                        mcpBlocks.forEach(block => {
                            const resultElement = block.querySelector('.tool-call-result');
                            const collapseBtn = block.querySelector('.mcp-collapse-btn');
                            if (resultElement) resultElement.style.display = 'block';
                            if (collapseBtn) {
                                collapseBtn.textContent = '🔽';
                                collapseBtn.title = '折叠结果';
                            }
                        });
                        return;
                    }

                    const contentHeight = contentEl.offsetHeight;
                    let totalMcpHeight = 0;

                    mcpBlocks.forEach(block => {
                        const resultElement = block.querySelector('.tool-call-result');
                        if (resultElement) {
                            resultElement.style.position = 'absolute';
                            resultElement.style.visibility = 'hidden';
                            resultElement.style.display = 'block';
                            totalMcpHeight += resultElement.offsetHeight;
                            resultElement.style.position = '';
                            resultElement.style.visibility = '';
                            resultElement.style.display = 'none';
                        }
                    });

                    if ((contentHeight + totalMcpHeight) <= 250) {
                        mcpBlocks.forEach(block => {
                            const resultElement = block.querySelector('.tool-call-result');
                            const collapseBtn = block.querySelector('.mcp-collapse-btn');
                            if (resultElement) resultElement.style.display = 'block';
                            if (collapseBtn) {
                                collapseBtn.textContent = '🔽';
                                collapseBtn.title = '折叠结果';
                            }
                        });
                    }
                }
            });
        }
    }, 200);

    requestAnimationFrame(() => {
        dom.chatMessages.style.visibility = 'visible';

        if (scrollBehavior === 'bottom') {
            scrollToBottom();
            setTimeout(() => {
                dom.chatMessages.dispatchEvent(new Event('scroll'));
            }, 100);
            setTimeout(scrollToBottom, 50);
            setTimeout(scrollToBottom, 150);
        }

        if (callback) {
            callback();
        }
    });
}

/**
 * 乌鸦：在 Shadow DOM 中渲染 Mermaid 图表
 * @param {ShadowRoot} shadow 
 */
async function renderMermaidDiagrams(shadow) {
    if (!window.mermaid) return;

    const mermaidBlocks = shadow.querySelectorAll('code.language-mermaid');
    if (mermaidBlocks.length === 0) return;

    // 乌鸦：初始化 Mermaid
    window.mermaid.initialize({
        startOnLoad: false,
        theme: state.theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
    });

    for (const block of mermaidBlocks) {
        // 避免重复渲染
        if (block.dataset.mermaidRendered) continue;
        block.dataset.mermaidRendered = 'true';

        const container = block.closest('.code-block-container') || block.parentNode;
        const code = block.innerText.trim();
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);

        try {
            // 创建一个临时容器用于渲染
            // 乌鸦：修复 Mermaid 无法在 display: none 元素中渲染的 bug
            const renderDiv = document.createElement('div');
            renderDiv.style.position = 'absolute';
            renderDiv.style.left = '-99999px';
            renderDiv.style.top = '-99999px';
            document.body.appendChild(renderDiv);

            const { svg } = await window.mermaid.render(id, code, renderDiv);

            // 替换原来的代码块
            const graphDiv = document.createElement('div');
            graphDiv.className = 'mermaid-result-wrapper'; // 乌鸦：统一使用外层包装

            // 乌鸦：添加内容和操作栏
            graphDiv.innerHTML = `
                <div class="mermaid-chart-container">
                    ${svg}
                </div>
                <div class="mermaid-actions">
                    <button class="download-svg-btn" title="下载SVG"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>下载SVG</button>
                    <button class="open-svg-btn" title="全屏查看"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>全屏</button>
                </div>
            `;

            // 绑定事件
            const downloadBtn = graphDiv.querySelector('.download-svg-btn');
            const openBtn = graphDiv.querySelector('.open-svg-btn');

            // 下载功能
            downloadBtn.onclick = () => {
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `chart-${Date.now()}.svg`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            };

            // 全屏功能
            openBtn.onclick = () => {
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
            };

            // 乌鸦：保留一个按钮可以切换回查看源码
            // 乌鸦：隐藏整个 pre 元素而不是只隐藏 code，避免 pre 的 padding/背景留下灰色空间
            const preBlock = block.closest('pre') || block.parentElement;
            const actions = container.querySelector('.code-block-actions');
            if (actions) {
                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'copy-code-btn';
                toggleBtn.textContent = '查看源码';
                toggleBtn.onclick = () => {
                    // 乌鸦：修复 toggle 逻辑 - 切换整个 pre 块的显隐，图表始终保留
                    const isSourceVisible = preBlock.style.display !== 'none';
                    preBlock.style.display = isSourceVisible ? 'none' : 'block';
                    toggleBtn.textContent = isSourceVisible ? '查看源码' : '隐藏源码';
                };
                actions.prepend(toggleBtn);
            }

            // 初始状态隐藏源码显示图表
            preBlock.style.display = 'none';
            container.appendChild(graphDiv);

            document.body.removeChild(renderDiv);
        } catch (error) {
            console.error('Mermaid 渲染失败:', error);
            block.innerHTML += `\n\n<span style="color:var(--accent-red)">[Mermaid 渲染错误: ${error.message}]</span>`;
        }
    }
}

export function displayWelcomeMessage(text = "您好！请选择一个角色和API模型并开始对话。") {
    dom.chatMessages.innerHTML = `<div class="message-wrapper ai"><div class="message-bubble ai"><div class="message-header"><span class="sender-name">AI 助手</span></div><div class="message-content">${text}</div></div></div>`;
}

export async function displayError(bubble, messageContent) {
    bubble.classList.remove('ai');
    bubble.classList.add('error');
    const formattedHtml = await formatMessagePipeline(messageContent, 'assistant');
    renderFormattedContent(bubble.querySelector('.message-content'), formattedHtml);
    bubble.querySelector('.sender-name').textContent = '错误';
    bubble.querySelector('.message-content').classList.remove('typing-cursor');
}
