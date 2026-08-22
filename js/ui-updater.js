/**
 * @file ui-updater.js
 * @description Functions for updating the state and appearance of various small UI components.
 */

import { dom, toggleMessageActions } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { renderHistory } from './sidebar.js?v=260820-1'; // 乌鸦：导入会话历史渲染函数
import { calculateConversationStats } from './utils.js?v=260820-1';
import { renderRegexRulesList } from './ui-populator.js?v=260820-1';

/**
 * Toggles the send button's appearance and state (send/stop).
 * @param {boolean} isSending - True if a message is currently being sent.
 */
export function toggleSendButton(isSending) {
    dom.sendButton.innerHTML = isSending ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>` : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    dom.sendButton.title = isSending ? "停止" : "发送";
    dom.sendButton.classList.toggle('stop', isSending);
    if (!isSending) dom.messageInput.focus();
    updateSummaryEditorLockState();
}

/**
 * 刷新记忆总结输入框的只读锁定状态
 * — 为什么这么写 —
 * 在主对话 AI 输出期间或正在执行总结生成时，将 #hide-summary-result 设为只读并置灰保存按钮，
 * 避免用户在模型并发写回或输出期间产生内容冲突覆盖；一旦输出完毕或用户点击停止，即刻恢复可编辑。
 */
export function updateSummaryEditorLockState() {
    if (!dom.hideSummaryResult) return;

    const isChatGenerating = dom.sendButton && dom.sendButton.classList.contains('stop');
    const isSummaryGenerating = dom.hideSummaryStartBtn && dom.hideSummaryStartBtn.dataset.summarizing === '1';
    // 仅当自动总结属于当前正处于活动状态的会话时才锁定当前编辑框
    const isAutoSummarizingCurrentConv = !!state.isAutoSummarizing && (state.autoSummarizingConvId === state.currentConversationId);

    const shouldLock = isChatGenerating || isSummaryGenerating || isAutoSummarizingCurrentConv;

    if (shouldLock) {
        dom.hideSummaryResult.readOnly = true;
        dom.hideSummaryResult.classList.add('editor-locked');
        dom.hideSummaryResult.setAttribute('title', '⏳ AI 正在输出中，暂不可编辑（生成结束后自动解锁）');
        if (dom.hideSummarySaveBtn) dom.hideSummarySaveBtn.disabled = true;
        if (dom.hideSummaryClearBtn) dom.hideSummaryClearBtn.disabled = true;
    } else {
        dom.hideSummaryResult.readOnly = false;
        dom.hideSummaryResult.classList.remove('editor-locked');
        dom.hideSummaryResult.removeAttribute('title');
        if (dom.hideSummarySaveBtn) dom.hideSummarySaveBtn.disabled = false;
        if (dom.hideSummaryClearBtn) dom.hideSummaryClearBtn.disabled = false;
    }
}

/**
 * Updates the branch navigation UI.
 */
export function updateBranchNavigator() {
    const conv = state.conversations[state.currentConversationId];
    if (conv && conv.branches.length > 1) {
        dom.branchNavigator.classList.add('visible');

        // 乌鸦：更新分拆指示器（当前值/总数分别显示）
        const current = conv.activeBranchIndex + 1;
        const total = conv.branches.length;
        const currentEl = dom.branchIndicator.querySelector('.branch-current');
        const totalEl = dom.branchIndicator.querySelector('.branch-total');
        if (currentEl) currentEl.textContent = current;
        if (totalEl) totalEl.textContent = total;

        dom.prevBranchBtn.disabled = conv.activeBranchIndex === 0;
        dom.nextBranchBtn.disabled = conv.activeBranchIndex === conv.branches.length - 1;
    } else {
        dom.branchNavigator.classList.remove('visible');
    }
}

/**
 * @description 核心：更新所有动态UI组件的状态。这是保证UI一致性的中央函数，避免时序问题。
 */
export function updateAllDynamicUI() {
    // 乌鸦：把所有需要刷新的小弟都叫过来，排好队，一个一个来，谁也别想乱！
    updateBranchNavigator();
    updateSendButtonState();
    updateWorldBookButton();
    updateChooseDbButtonState();
    updateChooseTableButtonState();
    updateHideSummaryBtnColor();
    updateSessionTokenBadge(); // 乌鸦：同步刷新当前会话总 Token 数徽章
    updateInputPlaceholder(); // 乌鸦：根据当前发送快捷键设置同步输入框占位提示
    if (dom.regexRuleList) {
        renderRegexRulesList(); // 乌鸦：同步刷新当前会话专属正则列表
    }
    renderHistory(); // 乌鸦：最后刷新会话列表，确保spinner状态正确
}

/**
 * — 为什么这么写 —
 * 用户可在设置中切换发送快捷键（Enter / Ctrl+Enter），但输入框 placeholder
 * 是写死的"Shift+Enter 换行"，会与实际设置产生矛盾造成困惑。
 * 此函数根据 state.appSettings.sendKey 动态更新 placeholder 文案。
 */
export function updateInputPlaceholder() {
    if (!dom.messageInput) return;
    const sendKey = state.appSettings.sendKey || 'enter';
    if (sendKey === 'ctrl-enter') {
        dom.messageInput.placeholder = '输入消息... (Ctrl+Enter 发送 · Enter 换行)';
    } else {
        dom.messageInput.placeholder = '输入消息... (Enter 发送 · Shift+Enter 换行)';
    }
}

/**
 * @description 乌鸦：根据当前会话是否已选择数据库，更新按钮的高亮状态
 */
export function updateChooseDbButtonState() {
    const conv = state.conversations[state.currentConversationId];
    if (conv && conv.dbId) {
        dom.chooseDbBtn.classList.add('active');
    } else {
        dom.chooseDbBtn.classList.remove('active');
    }
}

export function updateChooseTableButtonState() {
    const conv = state.conversations[state.currentConversationId];
    if (conv && conv.dbId && conv.dbSelections && conv.dbSelections[conv.dbId] && conv.dbSelections[conv.dbId].length > 0) {
        dom.chooseTableBtn.classList.add('active');
    } else {
        dom.chooseTableBtn.classList.remove('active');
    }
}

export function updateScrollButtonsVisibility() {
    const chatContainer = dom.chatMessages;
    const scrollBottomBtn = dom.scrollToBottomBtn;
    const scrollTopBtn = dom.scrollToTopBtn;

    if (!scrollBottomBtn || !scrollTopBtn) return;

    const isNearBottom = (chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop) < 100;
    const isNearTop = chatContainer.scrollTop < (chatContainer.clientHeight / 2);

    if (isNearBottom) {
        scrollBottomBtn.classList.add('hidden');
    } else {
        scrollBottomBtn.classList.remove('hidden');
    }

    if (isNearTop) {
        scrollTopBtn.classList.add('hidden');
    } else {
        scrollTopBtn.classList.remove('hidden');
    }
}

export function adjustTextareaHeight() {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = `${dom.messageInput.scrollHeight}px`;
}

export function applyTheme(theme) {
    document.body.dataset.theme = theme;
    const hljsTheme = document.getElementById('hljs-theme');
    if (hljsTheme) {
        const isLight = (theme === 'light');
        const currentHref = hljsTheme.getAttribute('href') || hljsTheme.href || '';
        const isCdn = currentHref.startsWith('http://') || currentHref.startsWith('https://') || currentHref.startsWith('//');

        if (isCdn) {
            const cdnLight = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
            const cdnDark = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
            hljsTheme.href = isLight ? cdnLight : cdnDark;
        } else {
            hljsTheme.href = isLight ? './libs/atom-one-light.min.css' : './libs/atom-one-dark.min.css';
        }
    }
    // 同步应用气泡自定义样式/退回新主题默认色
    try {
        import('./settings/bubble-settings.js?v=260820-1').then(m => m.applyBubbleCustomStyles());
    } catch (e) {}
}

export function updateWorldBookButton() {
    const convId = state.currentConversationId;
    let enabledCount = 0;
    if (convId) {
        enabledCount = Object.values(state.worldBook).filter(entry => {
            return entry.enabled || (Array.isArray(entry.sessionIds) && entry.sessionIds.includes(convId));
        }).length;
    } else {
        enabledCount = Object.values(state.worldBook).filter(entry => entry.enabled).length;
    }
    if (enabledCount > 0) {
        dom.manageWorldBookBtn.textContent = `备忘录 (${enabledCount})`;
    } else {
        dom.manageWorldBookBtn.textContent = '备忘录';
    }
}

export function updateHideSummaryBtnColor() {
    if (!dom.hideSummaryBtn) return;

    const convId = state.currentConversationId;
    let isHideEnabled = false;
    let isLimitEnabled = false;
    let limitValue = 0;

    if (convId && state.hideSummary && state.hideSummary[convId]) {
        const summaryConfig = state.hideSummary[convId];
        // — 为什么这么写 —
        // 只有当该会话确实开启了记忆总结且对应模式存在有效记忆内容（递归文本/卡片列表/双表格），或者确实存在被标记隐藏的楼层时，
        // 顶栏总结按钮才高亮激活为绿色。绝不能在未开启或内容全为空的会话中误激活，彻底杜绝串台视觉误导。
        const mode = summaryConfig.memoryMode || 'recursive';
        let hasMemoryData = false;
        if (mode === 'recursive') {
            hasMemoryData = !!(summaryConfig.summary && summaryConfig.summary.trim());
        } else if (mode === 'append') {
            hasMemoryData = !!(Array.isArray(summaryConfig.summaryList) && summaryConfig.summaryList.length > 0);
        } else if (mode === 'table') {
            const evts = summaryConfig.tableData?.eventHistory;
            const chars = summaryConfig.tableData?.characterInfo;
            hasMemoryData = (Array.isArray(evts) && evts.length > 0) || (Array.isArray(chars) && chars.length > 0);
        }

        const conv = state.conversations[convId];
        const activeBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex] : [];
        const hasHiddenFloorsInBranch = !!(activeBranch && activeBranch.some(m => m.hidden));
        const hasSummaryContent = !!(summaryConfig.enabled && hasMemoryData);
        const hasHiddenFloors = (Array.isArray(summaryConfig.hiddenFloors) && summaryConfig.hiddenFloors.length > 0) || hasHiddenFloorsInBranch;
        if (hasSummaryContent || hasHiddenFloors) {
            isHideEnabled = true;
        }
        if (summaryConfig.messageLimit && summaryConfig.messageLimit > 0) {
            isLimitEnabled = true;
            limitValue = summaryConfig.messageLimit;
        }
    }

    if (isHideEnabled || isLimitEnabled) {
        dom.hideSummaryBtn.classList.add('active-hide-summary');
    } else {
        dom.hideSummaryBtn.classList.remove('active-hide-summary');
    }

    // 检查是否正在进行后台自动总结或手动总结（仅当总结归属于当前驻留会话时才转圈）
    const isAutoSummarizingCurrent = !!(state.isAutoSummarizing && state.autoSummarizingConvId === convId);
    const isManualSummarizingCurrent = !!(window._hideSummaryAbort && state.currentConversationId === convId);
    const isSpinning = isAutoSummarizingCurrent || isManualSummarizingCurrent;

    if (isSpinning) {
        dom.hideSummaryBtn.classList.add('summarizing-spinning');
        dom.hideSummaryBtn.setAttribute('title', '🔄 正在进行记忆总结中...');
    } else {
        dom.hideSummaryBtn.classList.remove('summarizing-spinning');
        dom.hideSummaryBtn.setAttribute('title', '隐藏与总结');
    }

    // 乌鸦：更新隐藏/总结按钮上的发送限制楼层数角标
    const badge = document.getElementById('hide-summary-limit-badge');
    if (badge) {
        if (limitValue > 0) {
            badge.textContent = limitValue;
            badge.classList.add('active');
        } else {
            badge.textContent = '';
            badge.classList.remove('active');
        }
    }
}

/**
 * — 为什么这么写 —
 * 在数据详情按钮右侧展示当前会话的总预估 Token 数量徽章。
 * 当切换会话或消息更新时实时调用，防止由于会话切换导致显示的预估 Token 数滞后脱节。
 */
export function updateSessionTokenBadge() {
    const badge = document.getElementById('session-token-badge');
    if (!badge) return;

    const textSpan = document.getElementById('session-token-text');

    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (!conv) {
        if (textSpan) textSpan.textContent = '0 Tokens';
        else badge.textContent = '0 Tokens';
        badge.title = '点击查看会话数据详情 (当前实际发送预估: 0 Tokens)';
        return;
    }

    const hideSummaryConfig = state.hideSummary && state.hideSummary[convId];
    const stats = calculateConversationStats(conv, hideSummaryConfig);
    const actualTokens = stats.actualSentEstimatedTokens || 0;
    const totalTokens = stats.totalEstimatedTokens || 0;
    const hiddenTokens = stats.hiddenEstimatedTokens || 0;

    const formattedText = `${actualTokens.toLocaleString()} Tokens`;
    if (textSpan) textSpan.textContent = formattedText;
    else badge.textContent = formattedText;

    badge.title = `点击查看会话数据详情 (当前实际发送预估: ${actualTokens.toLocaleString()} Tokens / 总预估: ${totalTokens.toLocaleString()} / 已隐藏: ${hiddenTokens.toLocaleString()})`;
}

export function showLoadingOverlay() {
    if (dom.globalLoadingOverlay) {
        dom.globalLoadingOverlay.classList.add('visible');
    }
}

export function hideLoadingOverlay() {
    if (dom.globalLoadingOverlay) {
        dom.globalLoadingOverlay.classList.remove('visible');
    }
}

export function updateSendButtonState() {
    const convId = state.currentConversationId;
    const conv = state.conversations[convId];

    // 乌鸦：修正状态判断逻辑，只关心【当前】会话是否在生成
    let isGenerating = false;
    let generatingMessageIndex = -1;

    if (convId) {
        // 检查1：当前会话是否正在进行流式响应
        const isCurrentConvStreaming = state.streamingConversationId === convId;

        // 检查2：当前会话是否有消息标记为“正在生成”
        let isCurrentConvGeneratingMsg = false;
        if (conv && state.generatingMessages) {
            const branchIndex = conv.activeBranchIndex;
            for (const key in state.generatingMessages) {
                if (key.startsWith(convId + '_' + branchIndex + '_')) {
                    isCurrentConvGeneratingMsg = true;
                    generatingMessageIndex = parseInt(key.split('_').pop(), 10);
                    break;
                }
            }
        }

        isGenerating = isCurrentConvStreaming || isCurrentConvGeneratingMsg;
    }

    const messageBubbles = dom.chatMessages.querySelectorAll('.message-bubble');
    messageBubbles.forEach(bubble => {
        const bubbleIndex = parseInt(bubble.dataset.index, 10);
        const messageId = bubble.dataset.id;
        if (isGenerating && bubbleIndex === generatingMessageIndex) {
            toggleMessageActions(messageId, true);
        } else {
            toggleMessageActions(messageId, false);
        }
    });

    dom.sendButton.disabled = false;
    dom.messageInput.disabled = false;
    dom.attachmentBtn.disabled = false;
    toggleSendButton(isGenerating);
}

export function scrollToBottom() {
    dom.chatMessages.scrollTo({ top: dom.chatMessages.scrollHeight, behavior: 'auto' });
}

export function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;

    let iconSvg = '';
    switch (type) {
        case 'success':
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
            break;
        case 'warning':
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
            break;
        case 'error':
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
            break;
        default:
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    notification.innerHTML = `<div class="notification-content">${iconSvg}<span>${message}</span></div>`;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, duration);
}

export const notify = {
    info: (msg, duration) => showNotification(msg, 'info', duration),
    success: (msg, duration) => showNotification(msg, 'success', duration),
    warning: (msg, duration) => showNotification(msg, 'warning', duration),
    error: (msg, duration) => showNotification(msg, 'error', duration),
    alert: (msg, title = '文件解析提示') => showErrorDialog(title, msg),
    copy: (msg = '已复制到剪贴板') => showNotification(msg, 'success', 2000),
    download: (msg = '下载成功') => showNotification(msg, 'success', 2000)
};

/**
 * — 为什么这么写 —
 * 当解析提示或错误文本较长（例如引导用户另存为 .docx 的详细提示）时，Toast 提示框 3 秒即消失，用户来不及看清。
 * 此函数生成一个带阴影蒙层的持久 Alert 弹窗 (Modal)，带有醒目的警告图标、格式化的提示内容和【我知道了】及【复制提示说明】按钮，用户看完手动关闭。
 * 
 * @param {string} title - 弹窗标题
 * @param {string} message - 详细提示信息
 */
export function showErrorDialog(title, message) {
    const existingModal = document.getElementById('custom-error-dialog-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'custom-error-dialog-modal';
    modalOverlay.className = 'modal-overlay active';
    modalOverlay.style.cssText = 'z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); position: fixed; top: 0; left: 0; right: 0; bottom: 0;';

    const formattedMessage = (message || '').replace(/\n/g, '<br>');

    modalOverlay.innerHTML = `
        <div class="modal-content" style="max-width: 520px; width: 90%; background: var(--bg-primary, #ffffff); color: var(--text-primary, #333333); border-radius: 12px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid var(--border-color, #e0e0e0); animation: modalFadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);">
            <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color, #eeeeee); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; color: var(--danger-color, #e53935);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                    ${title || '文件解析提示'}
                </h3>
                <button class="dialog-close-btn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary, #666); line-height: 1;">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 0.95rem; line-height: 1.6; max-height: 60vh; overflow-y: auto; color: var(--text-primary, #444); margin-bottom: 20px;">
                ${formattedMessage}
            </div>
            <div class="modal-actions" style="display: flex; justify-content: flex-end; gap: 10px;">
                <button class="dialog-copy-btn secondary-button" style="padding: 8px 16px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color, #ccc); background: var(--bg-secondary, #f5f5f5); color: var(--text-primary, #333);">复制提示说明</button>
                <button class="dialog-confirm-btn primary-button" style="padding: 8px 20px; border-radius: 6px; cursor: pointer; border: none; background: var(--accent-color, #1976d2); color: #ffffff; font-weight: 500;">我知道了</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    const closeModal = () => {
        modalOverlay.style.opacity = '0';
        modalOverlay.style.transition = 'opacity 0.2s ease';
        setTimeout(() => {
            if (modalOverlay.parentNode) {
                modalOverlay.parentNode.removeChild(modalOverlay);
            }
        }, 200);
    };

    modalOverlay.querySelector('.dialog-close-btn').onclick = closeModal;
    modalOverlay.querySelector('.dialog-confirm-btn').onclick = closeModal;
    modalOverlay.querySelector('.dialog-copy-btn').onclick = () => {
        navigator.clipboard.writeText(message).then(() => {
            showNotification('提示内容已复制到剪贴板', 'success', 2000);
        }).catch(() => {
            showNotification('复制失败', 'error', 2000);
        });
    };
}
