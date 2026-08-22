/**
 * @file chat-events.js
 * @description Handles chat-related events including message operations, history management, and chat interactions.
 */

import { dom } from './dom.js?v=260823';
import { state } from './state.js?v=260823';
import { handleSendMessage, switchToConversation, switchBranch } from './main.js?v=260823';
import { closeSidebarMobile } from './ui-events.js?v=260823';
import { renderHistory } from './sidebar.js?v=260823';
import { renderChatMessages, formatMessagePipeline, renderFormattedContent } from './renderer.js?v=260823';
import {
    enterEditMode, cancelEdit, smartCollapseStateCheck, addOrUpdateMessageFooter, 
    updateMessageActions, showCopyMenu, updateSingleMessageCollapseState, updateToggleButtonState
} from './message-manager.js?v=260823';
import { showFileViewer } from './attachment.js?v=260823';
import { saveToLocalStorage, saveMessageAsFile, isMessageHidden } from './utils.js?v=260823';
import { deleteConversation, saveConversation, getConversation } from './db.js?v=260823';
import { openConversationAvatarModal, openQuickHideModal, openConvTitleModal, openExportConvModal, openBranchSummaryConfirmModal } from './modals.js?v=260823';
import { adjustTextareaHeight, updateSendButtonState, notify } from './ui-updater.js?v=260823';
import { getHideSummaryForConversation } from './main.js?v=260823';
import { checkBranchMemoryStatus } from './summary-manager.js?v=260823';
// 乌鸦：导入代码预览管理器，用于在切换会话时关闭侧边栏
import { codePreviewManager } from './code-preview-manager.js?v=260823';
import { eventBus, EVENTS } from './services/event-bus.js?v=260823';
import { toggleConvSelection } from './batch-delete.js?v=260823';

/**
 * Sets up chat-related event listeners
 */
export function setupChatEvents() {
    // Send button and message input
    setupMessageInputEvents();
    setupChoiceActionDelegation();

    // Chat message actions
    if (dom.chatMessages) dom.chatMessages.addEventListener('click', handleChatMessageActions);

    // History list actions
    if (dom.historyList) dom.historyList.addEventListener('click', handleHistoryListActions);
    // 乌鸦：也要为时间分组列表添加点击监听
    if (dom.historyGroupedList) dom.historyGroupedList.addEventListener('click', handleHistoryListActions);

    // Branch navigation
    if (dom.branchNavigator) dom.branchNavigator.addEventListener('click', (e) => {
        if (Object.keys(state.generatingMessages).length > 0) {
            e.preventDefault();
            e.stopPropagation();
            notify.warning('AI正在输出中，请等待结束后再切换分支');
            return;
        }
        
        if (e.target.closest('#prev-branch-btn')) switchBranch(-1);
        if (e.target.closest('#next-branch-btn')) switchBranch(1);
    });

    // History search
    if (dom.historySearchInput) dom.historySearchInput.addEventListener('input', renderHistory);

    // 乌鸦：汇话历史列表视图切换标签
    setupHistoryViewTabs();

    // API and Persona selectors in sidebar
    setupSidebarSelectors();
}

/**
 * Sets up message input related events
 */
function setupMessageInputEvents() {
    if (dom.messageInput) {
        dom.messageInput.addEventListener('keydown', (e) => {
            const sendKey = state.appSettings.sendKey || 'enter';
            if (sendKey === 'enter' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            } else if (sendKey === 'ctrl-enter' && e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
    }

    if (dom.sendButton) dom.sendButton.addEventListener('click', () => {
        if (dom.sendButton.classList.contains('stop')) {
            // 乌鸦：修复多会话停止 - 按当前会话 ID 取对应的 AbortController
            const currentController = state.abortControllers[state.currentConversationId];
            if (currentController) {
                currentController.abort();
            }
        } else {
            handleSendMessage();
        }
    });
}

/**
 * Sets up sidebar selector events
 */
function setupSidebarSelectors() {
    if (dom.apiSelector) dom.apiSelector.addEventListener('change', () => {
        const conv = state.conversations[state.currentConversationId];
        if (conv) {
            conv.apiEndpointId = dom.apiSelector.value;
            renderHistory();
            saveToLocalStorage();
        }
    });

    if (dom.personaSelector) dom.personaSelector.addEventListener('change', () => {
        const conv = state.conversations[state.currentConversationId];
        if (conv) {
            conv.personaId = dom.personaSelector.value === 'default' ? null : dom.personaSelector.value;
            saveToLocalStorage();
        }
    });
}

/**
 * Handles chat message action button clicks
 */
function handleChatMessageActions(e) {
    const button = e.target.closest('button');
    const attachmentDisplay = e.target.closest('.attachment-display');

    if (attachmentDisplay) {
        const fileName = attachmentDisplay.dataset.filename;
        const fileContent = attachmentDisplay.dataset.filecontent;
        showFileViewer(fileName, fileContent);
        return;
    }

    if (!button) return;

    const messageBubble = button.closest('.message-bubble');
    if (!messageBubble) return;

    const index = parseInt(messageBubble.dataset.index, 10);
    const conv = state.conversations[state.currentConversationId];
    if (!conv) return;
    const activeBranch = conv.branches[conv.activeBranchIndex];
    const message = activeBranch[index];

    if (button.classList.contains('toggle-collapse-btn')) {
        handleToggleCollapse(messageBubble, button);
    } else if (button.classList.contains('quick-hide-btn')) {
        e.stopPropagation();
        const floor = parseInt(messageBubble.dataset.index, 10) + 1;
        openQuickHideModal(floor);
    } else if (button.classList.contains('delete-message-btn')) {
        handleDeleteMessage(activeBranch, index);
    } else if (button.classList.contains('toggle-md-btn')) {
        handleToggleMarkdown(messageBubble, button, message);
    } else if (button.classList.contains('branch-btn')) {
        // 点击重新生成时，关闭代码预览侧边栏，因为旧内容已失效
        if (typeof codePreviewManager !== 'undefined') {
            codePreviewManager.close();
        }
        const branchFromIndex = message.role === 'user' ? index : index - 1;
        if (branchFromIndex < 0) return;

        const convId = state.currentConversationId;
        const conv = state.conversations[convId];
        const currentActiveBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex] : [];
        const targetMsg = currentActiveBranch ? currentActiveBranch[branchFromIndex] : null;
        const hideConfig = getHideSummaryForConversation(convId);
        const branchFloor = branchFromIndex + 1;

        // — 为什么这么写 —
        // 1. 如果要分叉重发的消息本身已被标记为隐藏，拦截并提示用户先解除隐藏，避免新分支产生不可见的逻辑混乱
        if (isMessageHidden(targetMsg, branchFloor, hideConfig)) {
            notify.warning(`第 ${branchFloor} 楼当前处于已隐藏状态，重发前请先取消该消息的隐藏（点击右侧 👁️ 图标即可解除）`);
            return;
        }

        // 2. 智能检测分叉重发楼层与当前长期记忆的时间线因果一致性
        const checkResult = checkBranchMemoryStatus(convId, branchFloor);
        if (checkResult.needPrompt) {
            openBranchSummaryConfirmModal({
                convId,
                branchFromIndex,
                checkResult,
                onProceed: () => {
                    handleSendMessage({ isBranching: true, branchFromIndex, skipBranchSummaryConfirm: true });
                }
            });
            return;
        }

        // 无因果冲突，直接开启重发
        handleSendMessage({ isBranching: true, branchFromIndex, skipBranchSummaryConfirm: true });
    } else if (button.classList.contains('edit-btn')) {
        enterEditMode(messageBubble, message);
    } else if (button.classList.contains('save-edit-btn')) {
        handleSaveEdit(messageBubble, message, index);
    } else if (button.classList.contains('cancel-edit-btn')) {
        cancelEdit(messageBubble);
    } else if (button.classList.contains('copy-message-btn')) {
        showCopyMenu(button, message);
    } else if (button.classList.contains('save-message-btn')) {
        saveMessageAsFile(message);
    }
}

/**
 * Handles history list item clicks
 */
function handleHistoryListActions(e) {
    const item = e.target.closest('.history-item');
    if (!item) return;

    const id = item.dataset.id;
    const button = e.target.closest('button');
    
    if (button && button.classList.contains('pin-conv-btn')) {
        e.stopPropagation();
        handlePinConversation(id);
    } else if (button && button.classList.contains('copy-conv-btn')) {
        e.stopPropagation();
        handleDuplicateConversation(id);
    } else if (button && button.classList.contains('delete-btn')) {
        e.stopPropagation();
        handleDeleteConversation(id);
    } else if (button && button.classList.contains('edit-history-btn')) {
        e.stopPropagation();
        openConvTitleModal(id);
    } else if (button && button.classList.contains('export-conv-btn')) {
        e.stopPropagation();
        openExportConvModal(id);
    } else if (button && button.classList.contains('set-conv-avatar-btn')) {
        const btn = e.target.closest('.set-conv-avatar-btn');
        if (!btn) return;
        const convId = btn.dataset.id;
        if (!convId) return;
        openConversationAvatarModal(convId);
    } else {
        // 批量选择模式下拦截点击，执行勾选切换，不触发会话跳转
        if (state.batchSelectMode) {
            e.stopPropagation();
            toggleConvSelection(id);
            return;
        }

        if (shouldBlockConversationSwitch()) {
            notify.warning('当前会话正在进行包含MCP工具的对话，请等待回复结束后，再进行会话切换。');
            return;
        }
                
                            eventBus.emit(EVENTS.CONVERSATION_SWITCH_START, {
                
                                from: state.currentConversationId,
                
                                to: id
                
                            });
                
                            
                
                            // 乌鸦：旧的直接调用已移除，实现了模块解耦
                
                            // codePreviewManager.close();
                
                            // codePreviewManager.suppress(800); 
                
                            
                
            switchToConversation(id);
            if (window.innerWidth <= 768) {
                closeSidebarMobile();
            }
        }
    }

/**
 * 乌鸦：检查是否应该阻止会话切换
 * 当用户勾选了MCP工具中的任意持久化变量，且系统当前存在处于回复中的消息时，返回true
 */
export function shouldBlockConversationSwitch() {
    // 检查是否勾选了MCP工具中的任意持久化变量
    const hasSelectedTools = state.mcpSettings.selectedTools && state.mcpSettings.selectedTools.length > 0;
    
    // 检查系统当前是否存在处于回复中的消息
    let hasGeneratingMessage = false;
    if (state.generatingMessages) {
        hasGeneratingMessage = Object.keys(state.generatingMessages).some(key => {
            return state.generatingMessages[key] === true;
        });
    }
    
    // 检查MCP会话管理器中是否有活跃的请求
    let hasActiveMCPRequests = false;
    if (window.mcpSessionManager && window.mcpSessionManager.activeRequests) {
        hasActiveMCPRequests = window.mcpSessionManager.activeRequests.size > 0;
    }
    
    // 乌鸦：文件解析中也要阻止会话切换（无论是否有MCP工具）
    if (state.isParsingFile) return true;
    
    // 当两个条件都满足时，阻止会话切换
    return hasSelectedTools && (hasGeneratingMessage || hasActiveMCPRequests || state.isFollowUpStreamActive);
}

/**
 * Handles message collapse toggle
 */
function handleToggleCollapse(messageBubble, button) {
    const contentEl = messageBubble.querySelector('.message-content');
    if (!contentEl) return;

    const isNowExpanded = !contentEl.classList.contains('expanded');
    contentEl.classList.toggle('expanded', isNowExpanded);
    contentEl.classList.toggle('collapsible', !isNowExpanded);

    // 乌鸦：联动折叠/展开MCP和二次分析容器
    const mcpContainer = messageBubble.querySelector('.tool-calls-container');
    if (mcpContainer) {
        mcpContainer.style.display = isNowExpanded ? '' : 'none';
    }
    const analysisContainer = messageBubble.querySelector('.analysis-result-container');
    if (analysisContainer) {
        analysisContainer.style.display = isNowExpanded ? '' : 'none';
    }

    // 乌鸦：如果主消息正在被折叠，则强制将所有内部的MCP块也重置为折叠状态
    if (!isNowExpanded) {
        const mcpResultDivs = messageBubble.querySelectorAll('.tool-call-result');
        mcpResultDivs.forEach(resultDiv => {
            resultDiv.style.display = 'none';
        });

        const mcpCollapseBtns = messageBubble.querySelectorAll('.mcp-collapse-btn');
        mcpCollapseBtns.forEach(btn => {
            btn.textContent = '🔼';
            btn.title = '展开结果';
        });
    }

    // 乌鸦：使用统一的状态管理，替换手动按钮文字设置
    updateToggleButtonState(messageBubble, true);
}

/**
 * Handles message deletion
 */
async function handleDeleteMessage(activeBranch, index) {
    if (confirm('确定要删除这条消息吗？此操作不可恢复。')) {
        activeBranch.splice(index, 1);
        const conv = state.conversations[state.currentConversationId];
        if (conv) {
            await saveConversation(state.currentConversationId, conv);
        }
        renderChatMessages();
    }
}

/**
 * Handles markdown display toggle
 */
async function handleToggleMarkdown(messageBubble, button, message) {
    const contentEl = messageBubble.querySelector('.message-content');
    if (!contentEl) return;

    const currentMode = contentEl.dataset.viewMode || 'md';
    const mdSource = message.content;

    if (currentMode === 'md') {
        const newContentEl = contentEl.cloneNode(false);
        
        const pre = document.createElement('pre');
        pre.textContent = mdSource;
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-all';
        pre.style.padding = '10px';
        pre.style.boxSizing = 'border-box';
        newContentEl.appendChild(pre);
        
        newContentEl.dataset.viewMode = 'raw';
        button.title = '切换为Markdown渲染';
        if (message.role === 'user') {
            newContentEl.classList.add('raw-view-user-bg');
        }
        contentEl.parentNode.replaceChild(newContentEl, contentEl);

        updateSingleMessageCollapseState(messageBubble);

    } else {
        const formattedHtml = await formatMessagePipeline(mdSource, message.role);
        renderFormattedContent(contentEl, formattedHtml);
        contentEl.dataset.viewMode = 'md';
        button.title = '切换为原文';
        if (message.role === 'user') {
            contentEl.classList.remove('raw-view-user-bg');
        }
        updateSingleMessageCollapseState(messageBubble);
    }
}

/**
 * Handles saving message edits
 */
async function handleSaveEdit(messageBubble, message, index) {
    const newContent = messageBubble.querySelector('textarea').value;
    delete message.originalContent;
    message.content = newContent;
    message.timestamp = new Date().toISOString();

    messageBubble.classList.remove('editing');
    const actionsEl = messageBubble.querySelector('.message-actions');
    if (actionsEl) actionsEl.style.display = 'flex';

    const contentEl = messageBubble.querySelector('.message-content');
    const formattedHtml = await formatMessagePipeline(newContent, message.role);
    renderFormattedContent(contentEl, formattedHtml);
    contentEl.classList.remove('expanded');

    smartCollapseStateCheck(contentEl);
    addOrUpdateMessageFooter(messageBubble, message);
    updateMessageActions(actionsEl, message, index);

    // 乌鸦：改造 - 直接调用单个会话保存，确保性能和数据一致性
    const conv = state.conversations[state.currentConversationId];
    if (conv) {
        await saveConversation(state.currentConversationId, conv);
    }
}

/**
 * Handles conversation pinning
 */
async function handlePinConversation(id) {
    const conv = state.conversations[id];
    if (conv) {
        conv.pinned = !conv.pinned;
        await saveConversation(id, conv);
        renderHistory();
    }
}

/**
 * 复制对话（深拷贝会话数据、克隆隐藏总结与备忘录关联关系）
 * @param {string} id - 原会话ID
 */
async function handleDuplicateConversation(id) {
    if (!id) return;
    
    // 1. 获取原会话数据（优先从内存，其次从 IndexedDB）
    let origConv = state.conversations[id];
    if (!origConv) {
        try {
            origConv = await getConversation(id);
        } catch (e) {
            console.error('获取待复制会话失败:', e);
        }
    }
    
    if (!origConv) {
        notify.error('原会话不存在或已损坏');
        return;
    }
    
    // 2. 生成新会话ID与深拷贝对象
    const newId = `conv_${Date.now()}`;
    const newConv = JSON.parse(JSON.stringify(origConv));
    newConv.id = newId;
    newConv.title = `${origConv.title || '对话'} (副本)`;
    newConv.pinned = false; // 副本默认不置顶
    newConv.createdAt = Date.now();
    newConv.lastModified = new Date().toISOString();
    
    // 3. 复制该会话关联的隐藏与总结配置及历史版本（state.hideSummary）
    if (state.hideSummary && state.hideSummary[id]) {
        state.hideSummary[newId] = JSON.parse(JSON.stringify(state.hideSummary[id]));
    }
    
    // 4. 复制该会话在备忘录中的局部挂载生效关系（state.worldBook）
    let hasWorldBookSync = false;
    if (state.worldBook && typeof state.worldBook === 'object') {
        Object.values(state.worldBook).forEach(entry => {
            if (entry && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(id)) {
                if (!entry.sessionIds.includes(newId)) {
                    entry.sessionIds.push(newId);
                    hasWorldBookSync = true;
                }
            }
        });
    }

    // 4.5 复制该会话绑定的专属正则（深拷贝创建独立副本给新会话）
    if (state.regexRules && typeof state.regexRules === 'object') {
        Object.values(state.regexRules).forEach(rule => {
            if (rule && rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.includes(id)) {
                const newRuleId = `regex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                state.regexRules[newRuleId] = {
                    ...JSON.parse(JSON.stringify(rule)),
                    id: newRuleId,
                    sessionIds: [newId]
                };
            }
        });
    }
    
    // 5. 保存到 IndexedDB 与内存
    state.conversations[newId] = newConv;
    await saveConversation(newId, newConv);
    await saveToLocalStorage();
    
    // 6. 刷新侧边栏与动态UI
    renderHistory();
    if (hasWorldBookSync && window.updateWorldBookButton) {
        window.updateWorldBookButton();
    }
    
    // 7. 切换到新副本会话
    switchToConversation(newId);
    notify.success(`已复制为新会话: "${newConv.title}"`);
}

/**
 * Handles conversation deletion
 */
function handleDeleteConversation(id) {
    if (!confirm('确定要删除这个对话吗？')) return;

    delete state.conversations[id];
    deleteConversation(id).catch(err => {
        console.error("从数据库中删除会话失败:", err);
    });

    if (id === state.currentConversationId) {
        const firstConvId = Object.keys(state.conversations)[0] || null;
        switchToConversation(firstConvId);
    } else {
        renderHistory();
    }

    saveToLocalStorage();
}

/**
 * 乌鸦：设置汇话历史列表视图切换标签按需
 */
function setupHistoryViewTabs() {
    const tabs = document.querySelectorAll('.history-view-tab[data-view]');
    const simpleView = document.getElementById('history-list');
    const groupedView = document.getElementById('history-grouped-list');

    if (!simpleView || !groupedView) return;

    const currentView = localStorage.getItem('historyViewMode') || 'simple';
    tabs.forEach(tab => {
        if (tab.dataset.view === currentView) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            const viewMode = tab.dataset.view;
            
            if (tab.classList.contains('active')) return;
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            localStorage.setItem('historyViewMode', viewMode);
            
            if (viewMode === 'grouped') {
                simpleView.style.display = 'none';
                groupedView.style.display = 'block';
            } else {
                simpleView.style.display = 'block';
                groupedView.style.display = 'none';
            }
            
            renderHistory();
        });
    });

    // 乌鸦：初始化视图位置
    if (currentView === 'grouped') {
        simpleView.style.display = 'none';
        groupedView.style.display = 'block';
    } else {
        simpleView.style.display = 'block';
        groupedView.style.display = 'none';
    }
}

/**
 * 弹出提示选择插入模式（覆盖、追加到底部、追加在顶部）
 * @param {string} text - 待插入的文本
 */
export function promptChoiceInsertMode(text) {
    if (!text || typeof text !== 'string') return;
    const modal = document.getElementById('choice-insert-action-modal');
    const preview = document.getElementById('choice-insert-preview');
    const replaceBtn = document.getElementById('choice-act-replace');
    const appendBottomBtn = document.getElementById('choice-act-append-bottom');
    const appendTopBtn = document.getElementById('choice-act-append-top');
    const closeBtn = document.getElementById('choice-insert-close-btn');

    if (!modal) {
        // 降级兜底直接填入
        applyInsertTextToInput(text, 'replace');
        return;
    }

    if (preview) {
        preview.textContent = text;
    }

    const close = () => {
        modal.classList.remove('visible');
        modal.style.display = 'none';
        cleanup();
    };

    const handleAction = (mode) => {
        applyInsertTextToInput(text, mode);
        close();
    };

    const onReplace = () => handleAction('replace');
    const onAppendBottom = () => handleAction('append_bottom');
    const onAppendTop = () => handleAction('append_top');

    const cleanup = () => {
        if (replaceBtn) replaceBtn.removeEventListener('click', onReplace);
        if (appendBottomBtn) appendBottomBtn.removeEventListener('click', onAppendBottom);
        if (appendTopBtn) appendTopBtn.removeEventListener('click', onAppendTop);
        if (closeBtn) closeBtn.removeEventListener('click', close);
        modal.removeEventListener('click', onModalClick);
    };

    const onModalClick = (e) => {
        if (e.target === modal) close();
    };

    if (replaceBtn) replaceBtn.addEventListener('click', onReplace);
    if (appendBottomBtn) appendBottomBtn.addEventListener('click', onAppendBottom);
    if (appendTopBtn) appendTopBtn.addEventListener('click', onAppendTop);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', onModalClick);

    modal.style.display = 'flex';
    modal.classList.add('visible');
}

/**
 * 将文本按指定模式注入到输入框
 * @param {string} text - 待插入文本
 * @param {'replace'|'append_bottom'|'append_top'} mode - 插入模式
 */
export function applyInsertTextToInput(text, mode = 'replace') {
    const textarea = dom.messageInput || document.getElementById('message-input');
    if (!textarea) return;

    const current = textarea.value.trim();
    if (mode === 'append_bottom') {
        textarea.value = current ? `${current}\n${text}` : text;
    } else if (mode === 'append_top') {
        textarea.value = current ? `${text}\n${current}` : text;
    } else {
        textarea.value = text;
    }

    // 触发自适应高度
    adjustTextareaHeight();
    // 触发发送按钮激活状态
    updateSendButtonState();

    // 聚焦输入框并将光标移至末尾
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);

    // 顺滑平顺滚动至输入框可视区域
    textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * 全局提供的文本快速填入输入框方法（供正则生成的 HTML/JS 或按钮直接调用）
 * @param {string} text - 要插入到输入框的文本
 * @param {'replace'|'append_bottom'|'append_top'|null} [mode=null] - 插入模式，不传则弹出模式选择弹窗
 */
export function userDefaultClick(text, mode = null) {
    if (text === undefined || text === null) return;
    const content = typeof text === 'string' ? text : String(text);
    if (!content) return;

    if (mode) {
        applyInsertTextToInput(content, mode);
    } else {
        promptChoiceInsertMode(content);
    }
}

// 挂载至全局 window 对象，确保内联 onclick 或外部正则脚本能直接访问
if (typeof window !== 'undefined') {
    window.userDefaultClick = userDefaultClick;
    window.promptChoiceInsertMode = promptChoiceInsertMode;
}

/**
 * 设置针对剧情选项等快速填入卡片的全局点击事件委托代理
 * （规避 DOMPurify 剥离内联 onclick，即便不关闭 XSS 防护也能 100% 触发）
 */
function setupChoiceActionDelegation() {
    document.addEventListener('click', (e) => {
        // 支持 Shadow DOM 内部穿透事件 target 获取
        const path = (e.composedPath && e.composedPath()) || [];
        let target = path[0] || e.target;
        if (!target) return;

        // 如果点击的是 details 的 summary 展开收起，则不拦截
        if (target.tagName === 'SUMMARY' || target.closest('summary')) return;

        let choiceElem = null;
        for (const el of path) {
            if (el.nodeType === 1 && (el.matches('.story-choice-item, .user-default-click-btn, [data-default-text]'))) {
                choiceElem = el;
                break;
            }
        }
        if (!choiceElem && target.closest) {
            choiceElem = target.closest('.story-choice-item, .user-default-click-btn, [data-default-text]');
        }

        if (choiceElem) {
            const defaultText = choiceElem.getAttribute('data-default-text') || choiceElem.textContent.trim();
            if (defaultText) {
                e.preventDefault();
                e.stopPropagation();
                userDefaultClick(defaultText);
            }
        }
    });
}



