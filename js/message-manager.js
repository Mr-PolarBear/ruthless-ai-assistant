/**
 * @file message-manager.js
 * @description Handles UI interactions and state management for individual messages.
 */

import {dom} from './dom.js?v=260823';
import {state} from './state.js?v=260823';
import {extractJsonArrayString, copyTextToClipboard, countTokens, escapeHtml} from './utils.js?v=260823';
import {openMessageEditModal} from './modals.js?v=260823';
import {regexPatterns} from './regex.js?v=260823';
import {notify} from './ui-updater.js?v=260823';

// ===== NEW: Copy Menu Logic =====

/**
 * 方案A：用正则清理原始的 <thinking> 标签
 * 这个函数专门用于处理未被渲染的原始思考内容
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文本
 */
function removeThinkingTagsRegex(text) {
    // 使用 thinkTag 正则移除 <thinking>...</thinking> 或 <think>...</think> 标签
    return text.replace(regexPatterns.thinkTag, '');
}

/**
 * 方案B：用DOM清理已渲染的 <details> 标签中的思考过程
 * 这个函数专门用于处理已被转换为details代码块的思考内容
 * @param {string} html - 转换后的HTML
 * @returns {string} 清理后的纯文本
 */
function removeThinkingDetailsDOM(html) {
    // 创建一个临时容器放入HTML内容
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // 查找所有 <details> 元素，筛选出标题为"思考过程"的，然后删除
    const detailsElements = tempDiv.querySelectorAll('details');
    detailsElements.forEach(details => {
        const summary = details.querySelector('summary');
        // 检查summary的文本内容是否包含"思考过程"
        if (summary && summary.textContent.includes('思考过程')) {
            details.remove();
        }
    });
    
    // 返回清理后的纯文本
    return tempDiv.textContent || '';
}

/**
 * Creates and shows the copy options menu next to the clicked button.
 * @param {HTMLElement} button - The original copy button that was clicked.
 * @param {object} message - The message object associated with the button.
 */
export function showCopyMenu(button, message) {
    // 检查是否已存在菜单，如果存在则移除，避免重复创建
    const existingMenu = document.getElementById('copy-menu-dynamic');
    if (existingMenu) {
        existingMenu.remove();
    }

    // 创建菜单容器
    const menu = document.createElement('div');
    menu.id = 'copy-menu-dynamic';
    menu.className = 'copy-menu'; // 用于CSS样式

    // 创建“复制MD”按钮
    const copyMdBtn = document.createElement('button');
    copyMdBtn.textContent = '复制MD';
    copyMdBtn.onclick = (e) => {
        e.stopPropagation();
        copyMarkdown(message).finally(() => {
            if (menu.parentNode) {
                menu.remove();
            }
        });
    };

    // 创建“复制纯文本”按钮
    const copyTextBtn = document.createElement('button');
    copyTextBtn.textContent = '复制纯文本';
    copyTextBtn.onclick = (e) => {
        e.stopPropagation();
        copyPlainText(message).finally(() => {
            if (menu.parentNode) {
                menu.remove();
            }
        });
    };

    menu.appendChild(copyMdBtn);
    menu.appendChild(copyTextBtn);
    document.body.appendChild(menu);

    // --- 智能定位逻辑 ---
    const btnRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let top = btnRect.bottom + window.scrollY + 2; // 加2px的间距
    let left = btnRect.left + window.scrollX;

    // 如果菜单超出屏幕右侧，则调整左侧位置，让菜单右对齐按钮右侧
    if (left + menuRect.width > window.innerWidth - 10) { // 减10px作为边距
        left = btnRect.right + window.scrollX - menuRect.width;
    }

    menu.style.position = 'absolute';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // 点击菜单外部时，自动关闭菜单
    const clickOutsideHandler = (event) => {
        if (!menu.contains(event.target)) {
            menu.remove();
            document.removeEventListener('click', clickOutsideHandler, true);
        }
    };
    // 使用事件捕获阶段，确保能监听到所有点击
    document.addEventListener('click', clickOutsideHandler, true);
}

/**
 * Copies the raw Markdown content of a message.
 * 采用A+B组合方案，清理思考内容
 * @param {object} message - The message object.
 * @returns {Promise<void>}
 */
function copyMarkdown(message) {
    let textToCopy = message.originalContent || message.content;
    
    // 方案A：先用正则清理原始的 <thinking> 标签
    textToCopy = removeThinkingTagsRegex(textToCopy);
    
    return copyTextToClipboard(textToCopy).then(() => {
        showCopySuccessToast();
    });
}

/**
 * Copies the plain text version of a message, stripping all Markdown/HTML formatting.
 * 采用A+B组合方案，清理思考内容
 * @param {object} message - The message object.
 * @returns {Promise<void>}
 */
function copyPlainText(message) {
    let markdown = message.originalContent || message.content;
    
    // 方案A：先用正则清理原始的 <thinking> 标签
    markdown = removeThinkingTagsRegex(markdown);
    
    // 借助marked将Markdown转为HTML
    const html = window.marked.parse(markdown);
    
    // 方案B：再用DOM方法清理已渲染的details思考过程块
    const plainText = removeThinkingDetailsDOM(html);
    
    return copyTextToClipboard(plainText).then(() => {
        notify.copy();
    });
}

export function updateToggleButtonState(messageBubble, forceUpdate = false) {
    const contentEl = messageBubble.querySelector('.message-content');
    const toggleBtn = messageBubble.querySelector('.toggle-collapse-btn');

    if (!contentEl || !toggleBtn) return;

    // 乌鸦：统一的状态检查逻辑，以 expanded 类为准
    const isExpanded = contentEl.classList.contains('expanded');
    const spanEl = toggleBtn.querySelector('span');

    if (spanEl) {
        const expectedText = isExpanded ? '收起' : '显示更多';
        if (forceUpdate || spanEl.textContent !== expectedText) {
            spanEl.textContent = expectedText;
            // console.log(`乌鸦：更新按钮状态 - 展开: ${isExpanded}, 按钮文字: ${expectedText}`);
        }
    }
}

// ===== Existing Message Management Logic =====

/**
 * 核心执行者：根据命令更新单个消息气泡的折叠状态
 * @param {HTMLElement} messageBubble - 消息气泡的 DOM 元素
 * @param {boolean} shouldBeCollapsed - 是否应该折叠的命令
 */
export function updateSingleMessageCollapseState(messageBubble, shouldBeCollapsed) {
    const contentEl = messageBubble.querySelector('.message-content');
    if (!contentEl) return;

    const autoCollapse = dom.autoCollapseCheckbox.checked;
    
    // 乌鸦：升级高度计算逻辑，包含 MCP 和分析容器
    let totalHeight = contentEl.scrollHeight;
    
    // 统一获取容器引用，供后续逻辑复用
    const mcpContainers = messageBubble.querySelectorAll('.tool-calls-container');
    mcpContainers.forEach(container => {
        totalHeight += container.offsetHeight;
    });
    
    const analysisContainer = messageBubble.querySelector('.analysis-result-container');
    if (analysisContainer) {
        totalHeight += analysisContainer.offsetHeight;
    }

    // 乌鸦：判断是否为长消息（传入的命令 OR 实际高度超标）
    const isLong = shouldBeCollapsed || (totalHeight > 250); 

    let oldBtn = messageBubble.querySelector('.toggle-collapse-btn');

    // 如果不应该折叠（比如太短或设置关闭），则移除按钮并展开所有内容
    if (!autoCollapse || !isLong) {
        if (oldBtn) oldBtn.remove();
        contentEl.classList.remove('collapsible');
        contentEl.classList.add('expanded');
        // 展开所有相关容器（直接复用变量）
        mcpContainers.forEach(container => container.style.display = 'block');
        if (analysisContainer) analysisContainer.style.display = 'block';
        return; // 任务完成，提前退出
    }

    // --- 如果需要折叠 ---

    // 1. 确保按钮存在
    if (!oldBtn) {
        const btn = document.createElement('button');
        btn.className = 'toggle-collapse-btn';
        btn.innerHTML = `<span></span>`; // 内容由 updateToggleButtonState 填充
        const footerEl = messageBubble.querySelector('.message-footer');
        if (footerEl) {
            footerEl.insertAdjacentElement('afterend', btn);
        } else {
            messageBubble.appendChild(btn);
        }
        oldBtn = btn; // 更新引用
    }

    // 2. 根据命令应用CSS类
    if (shouldBeCollapsed) {
        contentEl.classList.add('collapsible');
        contentEl.classList.remove('expanded');
    } else {
        contentEl.classList.remove('collapsible');
        contentEl.classList.add('expanded');
    }

    // 3. 根据命令显隐相关容器
    const displayStyle = shouldBeCollapsed ? 'none' : 'block';
    // 直接复用变量
    mcpContainers.forEach(container => {
        container.style.display = displayStyle;
    });
    if (analysisContainer) {
        analysisContainer.style.display = displayStyle;
    }

    // 4. 最后，根据最终的CSS状态更新按钮文字
    updateToggleButtonState(messageBubble, true);
}


/**
 * 核心决策者：更新当前聊天窗口所有消息的折叠状态
 * @param {object} options - 选项对象
 * @param {boolean} options.isNewMessage - 是否为新发送的消息
 */
export function updateAllMessagesCollapseState(options = {}) {
    const {isNewMessage = false} = options; // 接收新标志

    const autoCollapse = dom.autoCollapseCheckbox.checked;
    if (!autoCollapse) {
        // 如果关闭了自动折叠，则确保所有消息都展开
        const messageBubbles = dom.chatMessages.querySelectorAll('.message-bubble');
        messageBubbles.forEach(bubble => {
            updateSingleMessageCollapseState(bubble, false);
        });
        return;
    }

    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (!conv) return;
    const branchIndex = conv.activeBranchIndex;

    const messageBubbles = dom.chatMessages.querySelectorAll('.message-bubble');

    messageBubbles.forEach((bubble, index) => {
        const contentEl = bubble.querySelector('.message-content');
        if (!contentEl) return;

        // 计算总高度以做决策
        let totalHeight = contentEl.scrollHeight;
        const mcpContainers = bubble.querySelectorAll('.tool-calls-container');
        mcpContainers.forEach(container => {
            totalHeight += container.offsetHeight;
        });
        const analysisContainer = bubble.querySelector('.analysis-result-container');
        if (analysisContainer) {
            totalHeight += analysisContainer.offsetHeight;
        }
        const isLong = totalHeight > 250;

        // 默认行为：如果内容够长，就应该折叠
        let shouldCollapse = isLong;

        const isLastMessage = index === messageBubbles.length - 1;

        // 增加对“正在生成”状态的判断
        if (isLastMessage) {
            const generatingKey = `${convId}_${branchIndex}_${index}`;
            const isStillGenerating = state.generatingMessages && state.generatingMessages[generatingKey];
            const isStillStreaming = state.streamingConversationId === convId;

            // 如果是新消息，或者消息仍在后台流式输出（包括常规和二次分析），则不折叠
            if (isNewMessage || isStillGenerating || isStillStreaming) {
                shouldCollapse = false;
            }
        }

        // 将最终决策作为命令传给执行者
        updateSingleMessageCollapseState(bubble, shouldCollapse);
    });
}

/**
 * Adds or updates the footer of a message bubble (timestamp, stats).
 * @param {HTMLElement} bubble - The message bubble element.
 * @param {object} message - The corresponding message object.
 */
export function addOrUpdateMessageFooter(bubble, message) {
    if (!bubble || !message) return;
    let footerEl = bubble.querySelector('.message-footer');
    if (!footerEl) {
        footerEl = document.createElement('div');
        footerEl.className = 'message-footer';
        // 乌鸦：如果bubble是临时对象而非DOM元素，跳过DOM操作
        if (bubble instanceof HTMLElement) {
            bubble.appendChild(footerEl);
        }
    }
    const timestampStr = message.timestamp ? new Date(message.timestamp).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }) : '';
    let statsStr = '';

    // — 为什么这么写 —
    // 1. 用户消息：计算正文 + 文本附件的实际字符数与 tokens，动态无缝兼容历史旧消息
    // 2. AI 消息：通过 removeThinkingTagsRegex 剔除 <thinking> 思考过程，精准计算“正文字符”数
    if (message.role === 'user') {
        const rawContent = message.content || '';
        let fullText = rawContent;

        const allAttachments = [].concat(
            message.attachment ? [message.attachment] : [],
            message.attachments || []
        );

        allAttachments.forEach(att => {
            if (att && !att.isImage && att.content && typeof att.content === 'string') {
                fullText += `\n\n--- 附件: ${att.name || ''} ---\n\`\`\`\n${att.content}\n\`\`\``;
            }
        });

        const charCount = fullText.length;
        const tokenCount = (message.stats && message.stats.tokenCount !== undefined)
            ? message.stats.tokenCount
            : countTokens(fullText);

        statsStr = `<div class="message-stats"><span>${charCount} 字符</span><span>${tokenCount} tokens</span></div>`;
    } else {
        const rawContent = message.content || '';
        const mainText = removeThinkingTagsRegex(rawContent);
        const mainCharCount = mainText.length;

        const tokenCount = (message.stats && message.stats.tokenCount !== undefined)
            ? message.stats.tokenCount
            : countTokens(rawContent);

        let tpsStr = '';
        let durationDisplay = '';

        if (message.stats) {
            const { tokensPerSecond, duration } = message.stats;
            if (tokensPerSecond != null && !isNaN(tokensPerSecond)) {
                const tpsVal = tokensPerSecond.toFixed(1);
                tpsStr = `<span>${tpsVal} t/s</span>`;
            }
            if (duration != null && !isNaN(duration)) {
                if (duration < 1) {
                    const durationMs = message.stats.durationMs || (duration * 1000);
                    durationDisplay = `<span class="stat-duration">${Math.round(durationMs)}ms</span>`;
                } else {
                    durationDisplay = `<span class="stat-duration">${duration.toFixed(1)}s</span>`;
                }
            }
        }

        statsStr = `<div class="message-stats"><span>${mainCharCount} 正文字符</span><span>${tokenCount} tokens</span>${tpsStr}${durationDisplay}</div>`;
    }

    let versionBadgeHtml = '';
    const versions = Array.isArray(message.versions) && message.versions.length > 0
        ? message.versions
        : (Array.isArray(message.historyVersions) && message.historyVersions.length > 0
            ? message.historyVersions.map((h, i) => ({ version: i + 1, content: h.content, timestamp: h.timestamp }))
            : []);

    if (versions.length > 1) {
        const activeIdx = message.activeVersionIndex !== undefined ? message.activeVersionIndex : (versions.length - 1);
        const currentVNum = versions[activeIdx] ? versions[activeIdx].version : (activeIdx + 1);
        versionBadgeHtml = `<span class="edit-version-badge" title="点击查看与切换历史编辑版本">v${currentVNum} (已编辑)</span>`;
    }

    // 乌鸦：如果bubble是临时对象而非DOM元素，跳过DOM操作
    if (bubble instanceof HTMLElement) {
        footerEl.innerHTML = `<span class="message-timestamp">${timestampStr}</span> ${versionBadgeHtml} ${statsStr}`;

        const badgeEl = footerEl.querySelector('.edit-version-badge');
        if (badgeEl) {
            badgeEl.onclick = (e) => {
                e.stopPropagation();
                const bubbleIndex = bubble.dataset.index || 0;
                openMessageVersionModal(message, bubbleIndex);
            };
        }
    }
}

// ===== 乌鸦：消息单条多版本历史对比与切换 (v1 ~ vN 固化版本模式) =====
let versionModalEl = null;

export function openMessageVersionModal(message, bubbleIndex) {
    if (!versionModalEl) {
        versionModalEl = document.createElement('div');
        versionModalEl.id = 'message-version-modal';
        versionModalEl.className = 'modal-overlay';
        versionModalEl.innerHTML = `
            <div class="modal-content version-modal-content">
                <div class="modal-header">
                    <h2>消息历史版本与对比</h2>
                    <button class="modal-close-btn" id="version-modal-close">&times;</button>
                </div>
                <div class="modal-body version-modal-body" id="version-modal-body"></div>
            </div>
        `;
        document.body.appendChild(versionModalEl);

        versionModalEl.querySelector('#version-modal-close').onclick = () => {
            versionModalEl.style.display = 'none';
            versionModalEl.classList.remove('visible');
        };
    }

    const bodyEl = versionModalEl.querySelector('#version-modal-body');

    // 兼容过渡：将旧格式 historyVersions 升级为新的固化版本列表 versions
    if (!Array.isArray(message.versions) || message.versions.length === 0) {
        if (Array.isArray(message.historyVersions) && message.historyVersions.length > 0) {
            message.versions = message.historyVersions.map((h, i) => ({
                version: i + 1,
                content: h.content,
                timestamp: h.timestamp
            }));
            message.versions.push({
                version: message.versions.length + 1,
                content: message.content,
                timestamp: message.timestamp || new Date().toISOString()
            });
            message.activeVersionIndex = message.versions.length - 1;
        } else {
            message.versions = [{
                version: 1,
                content: message.content,
                timestamp: message.timestamp || new Date().toISOString()
            }];
            message.activeVersionIndex = 0;
        }
    }

    const versions = message.versions;
    const activeIdx = message.activeVersionIndex !== undefined ? message.activeVersionIndex : (versions.length - 1);

    let itemsHtml = '';

    // 倒序展示：最新版本（大版本号）展示在上方
    [...versions].reverse().forEach((vObj, revIdx) => {
        const actualIdx = versions.length - 1 - revIdx;
        const isActive = actualIdx === activeIdx;
        const timeStr = vObj.timestamp ? new Date(vObj.timestamp).toLocaleString('zh-CN') : '';

        itemsHtml += `
            <div class="version-item ${isActive ? 'active-version' : ''}">
                <div class="version-item-header">
                    <span class="version-tag">v${vObj.version} ${isActive ? '(当前使用中)' : '(历史版本)'}</span>
                    <span class="version-time">${timeStr}</span>
                    ${!isActive ? `<button class="restore-version-btn" data-vindex="${actualIdx}">↩ 切换为此版本</button>` : ''}
                </div>
                <div class="version-text-box">${escapeHtml(vObj.content || '')}</div>
            </div>
        `;
    });

    bodyEl.innerHTML = itemsHtml;

    bodyEl.querySelectorAll('.restore-version-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const targetIdx = parseInt(e.target.dataset.vindex, 10);
            await switchMessageVersion(message, targetIdx, bubbleIndex);
            versionModalEl.style.display = 'none';
            versionModalEl.classList.remove('visible');
        };
    });

    versionModalEl.style.display = 'flex';
    versionModalEl.classList.add('visible');
}

export async function switchMessageVersion(message, targetIdx, bubbleIndex) {
    if (!message || !Array.isArray(message.versions) || targetIdx < 0 || targetIdx >= message.versions.length) {
        return;
    }

    message.activeVersionIndex = targetIdx;
    message.content = message.versions[targetIdx].content;

    const { saveConversation } = await import('./db.js?v=260823');
    const conv = state.conversations[state.currentConversationId];
    if (conv) {
        saveConversation(conv.id, conv);
    }

    const messageElement = document.querySelector(`.message-bubble[data-index="${bubbleIndex}"]`) || document.querySelector(`.message-bubble[data-id="${message.id}"]`);
    if (messageElement) {
        const contentEl = messageElement.querySelector('.message-content');
        if (contentEl) {
            const { formatMessagePipeline, renderFormattedContent } = await import('./renderer.js?v=260823');
            const formattedHtml = await formatMessagePipeline(message.content, message.role);
            renderFormattedContent(contentEl, formattedHtml);
            addOrUpdateMessageFooter(messageElement, message);
        }
    }
}

/**
 * Updates the action buttons (edit, delete, etc.) for a message.
 * @param {HTMLElement} actionsEl - The container for the action buttons.
 * @param {object} message - The message object.
 * @param {number} index - The index of the message.
 */
export function updateMessageActions(actionsEl, message, index, options = {}) {
    if (!actionsEl) return;
    const conv = state.conversations[state.currentConversationId];
    if (!conv) return;
    const branchIndex = conv.activeBranchIndex;

    // 乌鸦：检查消息是否正在生成中
    const isGenerating = state.generatingMessages && state.generatingMessages[`${state.currentConversationId}_${branchIndex}_${index}`];

    // 乌鸦：如果消息正在流式输出，则不应显示任何操作按钮，防止误操作
    if (isGenerating) {
        actionsEl.innerHTML = ''; // 清空所有按钮
        return;
    }

    // 乌鸦：如果生成已结束，则重新构建按钮
    const activeBranch = conv.branches[branchIndex];
    const isLastMessage = index === activeBranch.length - 1;
    const {isInitiallyTable} = options;

    let buttonsHTML = `<button class="edit-btn" title="编辑"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>`;
    buttonsHTML += `<button class="delete-message-btn" title="删除"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
    const branchBtnTitle = message.role === 'user' ? "从此重发" : "重新生成";
    if ((isLastMessage && message.role === 'assistant') || message.role === 'user') {
        buttonsHTML += `<button class="branch-btn" title="${branchBtnTitle}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>`;
    }
    buttonsHTML += `<button class="toggle-md-btn" title="Markdown 渲染/原文"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></button>`;
    buttonsHTML += `<button class="copy-message-btn" title="复制消息内容"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;

    // — 为什么这么写 —
    // 隐藏按钮对用户气泡与AI气泡通用，允许用户对任意楼层（包括提问与回答）执行单楼层或批量隐藏操作
    buttonsHTML += `<button class="quick-hide-btn" title="隐藏消息"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>`;

    if (message.role === 'assistant') {
        buttonsHTML += `<button class="save-message-btn" title="另存为"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>`;
    }


    actionsEl.innerHTML = buttonsHTML;

    const editBtn = actionsEl.querySelector('.edit-btn');
    if (editBtn) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openMessageEditModal(message, index);
        };
    }
}

export function enterEditMode(bubble, message) {
    bubble.classList.add('editing');
    const actionsEl = bubble.querySelector('.message-actions');
    if (actionsEl) actionsEl.style.display = 'none';

    const contentEl = bubble.querySelector('.message-content');
    if (contentEl.classList.contains('collapsible')) {
        contentEl.classList.add('expanded');
    }
    bubble.dataset.originalHtml = contentEl.innerHTML;
    const currentText = message.originalContent || message.content;

    contentEl.innerHTML = `<textarea>${currentText}</textarea><div class="edit-actions"><button class="cancel-edit-btn">取消</button><button class="save-edit-btn">保存</button></div>`;

    smartCollapseStateCheck(contentEl);
    const textarea = contentEl.querySelector('textarea');
    textarea.focus();
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    });
}

export function cancelEdit(bubble) {
    bubble.classList.remove('editing');
    const actionsEl = bubble.querySelector('.message-actions');
    if (actionsEl) actionsEl.style.display = 'flex';

    const contentEl = bubble.querySelector('.message-content');
    if (bubble.dataset.originalHtml) {
        contentEl.innerHTML = bubble.dataset.originalHtml;
    }
    contentEl.classList.remove('expanded');

    smartCollapseStateCheck(contentEl);

    delete bubble.dataset.originalHtml;
}



export function addCollapseButtonDuringStreaming(contentEl) {
    // 乌鸦：此函数用于在消息流式输出时，动态检查并添加折叠按钮
    // 乌鸦：修复竞态条件问题 - 避免在输出过程中重新创建按钮
    if (!contentEl || !dom.autoCollapseCheckbox.checked) {
        return; // 如果没有内容元素，或者没有开启自动折叠长消息，则直接返回
    }

    const messageBubble = contentEl.closest('.message-bubble');
    // 如果找不到消息气泡，或者消息正在编辑中，则不处理
    if (!messageBubble || messageBubble.classList.contains('editing')) {
        return;
    }

    // 乌鸦：关键修复 - 检查是否已经存在折叠按钮，避免重复添加
    const existingBtn = messageBubble.querySelector('.toggle-collapse-btn');
    if (existingBtn) {
        // 乌鸦：如果按钮已存在，只更新状态，不重新创建
        updateToggleButtonState(messageBubble, false);
        // console.log('乌鸦：折叠按钮已存在，仅更新状态');
        return;
    }

    // 乌鸦：计算总高度，包含二次分析结果
    let totalHeight = contentEl.scrollHeight;
    const mcpContainers = messageBubble.querySelectorAll('.tool-calls-container');
    mcpContainers.forEach(container => {
        totalHeight += container.offsetHeight;
    });
    const analysisContainer = messageBubble.querySelector('.analysis-result-container');
    if (analysisContainer) {
        totalHeight += analysisContainer.offsetHeight;
    }
    const isLong = totalHeight > 250;

    if (isLong) {
        // 乌鸦：核心逻辑：创建并设置按钮，但不绑定事件，事件由events.js统一托管
        const btn = document.createElement('button');
        btn.className = 'toggle-collapse-btn';

        // 乌鸦：默认设置为展开状态，只显示按钮
        contentEl.classList.add('expanded');
        contentEl.classList.remove('collapsible');
        // 乌鸦：统一按钮结构，只保留文字，避免对齐和图标问题
        btn.innerHTML = `<span></span>`;

        // 将按钮插入到合适的位置
        const footerEl = messageBubble.querySelector('.message-footer');
        if (footerEl) {
            footerEl.insertAdjacentElement('afterend', btn);
        } else {
            messageBubble.appendChild(btn);
        }

        // 乌鸦：按钮创建后，立即调用统一的状态更新函数
        updateToggleButtonState(messageBubble, true);

        console.log('乌鸦：流式输出过程中添加折叠按钮');
    }
}

/**
 * 乌鸦：新增智能折叠状态检查函数（V2 - 健壮版）
 * 处理内容结构变化（如thinking->details，用户正则替换等）导致的高度突变
 * @param {HTMLElement} contentEl - 触发检查的元素，仅用于定位消息气泡
 */
export function smartCollapseStateCheck(contentEl) {
    if (!contentEl || !dom.autoCollapseCheckbox.checked) {
        return;
    }

    const messageBubble = contentEl.closest('.message-bubble');
    if (!messageBubble || messageBubble.classList.contains('editing')) {
        return;
    }

    // 乌鸦：关键修正 - 必须始终以主内容元素为操作目标
    const mainContentEl = messageBubble.querySelector('.message-content');
    if (!mainContentEl) return;

    const existingBtn = messageBubble.querySelector('.toggle-collapse-btn');

    // 乌鸦：关键修正 - 重写高度计算，确保完整性
    let totalHeight = 0;
    // 1. 主内容高度
    totalHeight += mainContentEl.scrollHeight;
    // 2. 所有MCP工具容器高度
    const mcpContainers = messageBubble.querySelectorAll('.tool-calls-container');
    mcpContainers.forEach(container => {
        totalHeight += container.offsetHeight;
    });
    // 3. AI分析结果容器高度
    const analysisContainer = messageBubble.querySelector('.analysis-result-container');
    if (analysisContainer) {
        totalHeight += analysisContainer.offsetHeight;
    }

    const isLong = totalHeight > 250;

    if (!isLong) {
        // 消息变短了，移除按钮并展开
        if (existingBtn) {
            existingBtn.remove();
        }
        mainContentEl.classList.remove('collapsible');
        mainContentEl.classList.add('expanded');
    } else {
        // 消息够长，需要确保按钮存在
        let btn = existingBtn;
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'toggle-collapse-btn';
            btn.innerHTML = `<span></span>`; // 创建一个空壳按钮

            const footerEl = messageBubble.querySelector('.message-footer');
            if (footerEl) {
                footerEl.insertAdjacentElement('afterend', btn);
            } else {
                messageBubble.appendChild(btn);
            }
        }
        // 乌鸦：无论按钮是旧是新，都调用统一的函数来更新其状态
        updateToggleButtonState(messageBubble, true);
    }
}
