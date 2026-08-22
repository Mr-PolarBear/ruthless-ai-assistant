/**
 * @file main.js
 * @description The main entry point for the application.
 */

import { dom, initDom, toggleMessageActions } from './dom.js?v=260820-1';
import { getLocalStorageRemainingSpace } from './ls-space.js?v=260820-1';
import { state, API_PRESETS } from './state.js?v=260820-1';
// 挂载 API_PRESETS 到 window，供动态模块（如 db-table-choose.js）访问
window.API_PRESETS = API_PRESETS;
// 挂载 state 到 window，供动态模块（如 db-table-choose.js）访问
window.state = state;
import { prepareRequest, handleStream, handleNonStreamResponse, fetchModels } from './api.js?v=260820-1';
import {
    renderChatMessages, formatMessagePipeline, renderFormattedContent, displayMessage, displayError, populateApiSelector, populatePersonaSelector
} from './renderer.js?v=260820-1';
import { renderHistory } from './sidebar.js?v=260820-1';
import { initBatchDelete } from './batch-delete.js?v=260820-1';
import {
    toggleSendButton, updateBranchNavigator, scrollToBottom, adjustTextareaHeight,
    updateWorldBookButton, updateSendButtonState, updateAllDynamicUI, showLoadingOverlay, hideLoadingOverlay
} from './ui-updater.js?v=260820-1';
import {
    addOrUpdateMessageFooter, updateMessageActions, updateSingleMessageCollapseState
} from './message-manager.js?v=260820-1';
import { clearAttachment } from './attachment.js?v=260820-1';
import { loadFromLocalStorage, loadSettings, saveAppSettings, extractJsonArrayString, jsonToMarkdownTable, saveToLocalStorage } from './utils.js?v=260820-1';
import { setupChatSearch, closeChatSearch } from './chat-search.js?v=260820-1';
import { setupEventListeners } from './events.js?v=260820-1';
// 乌鸦：导入阻止会话切换的检查函数
import { shouldBlockConversationSwitch } from './chat-events.js?v=260820-1';
import { saveConversation, openDB, getIndexedDBUsage, clearAllAvatars } from './db.js?v=260820-1';
import { initDatabaseSettings } from './db-settings.js?v=260820-1';
// 乌鸦：导入代码预览管理器，用于新建会话时关闭侧边栏
import { codePreviewManager } from './code-preview-manager.js?v=260820-1';
// 乌鸦：导入工具箱管理器
import { toolsManager } from './tools-manager.js?v=260820-1';
import { initFloatingCollapseButton } from './floating-button.js?v=260820-1';
import { initializeAppearanceSettings } from './appearance.js?v=260820-1';
import { initializeQuickPrompts } from './quick-prompts.js?v=260820-1';
import { regexPatterns } from './regex.js?v=260820-1';
import { setupUserAvatarUI } from './modals.js?v=260820-1';
import { MCPToolsRegistry, DEFAULT_TOOLS } from './mcp-tools-registry.js?v=260820-1';
import { initMCPToolsSelector } from './mcp-tools-selector.js?v=260820-1';
import { initMCPManagement } from './mcp-management.js?v=260820-1';
import { initBackupReminder } from './services/backup-reminder.js?v=260820-1';
import { applyBubbleCustomStyles } from './settings/bubble-settings.js?v=260820-1';
import { scrollManager } from './scroll-manager.js?v=260820-1';
import { mcpSessionManager } from './mcp-session-manager.js?v=260820-1';
// 乌鸦：导入楼层快速跳转模块
import { initFloorJump } from './floor-jump.js?v=260820-1';

// 挂载 DEFAULT_TOOLS 到 window，供其他模块访问
window.DEFAULT_TOOLS = DEFAULT_TOOLS;

// Flag to track if we are saving to avoid multiple concurrent saves
import { initContentSearchModule } from './content-search.js?v=260820-1';

let isSaving = false;

// 聊天搜索初始化
document.addEventListener('DOMContentLoaded', () => {
    setupChatSearch();
    initContentSearchModule();

    // 乌鸦：360浏览器等旧 Chromium 内核布局偏移自动修复
    // 原理：检测 #app 实际位置偏移，用 transform 补偿，不影响元素尺寸
    window.addEventListener('load', () => {
        const app = document.getElementById('app');
        if (!app) return;
        const offset = app.getBoundingClientRect().top;
        if (Math.abs(offset) > 3) {
            console.warn(`乌鸦：检测到布局偏移 ${offset}px，自动修复`);
            app.style.transform = `translateY(${-offset}px)`;
        }
    });
});

/**
 * The main function to send a message. It handles user input, API communication, and UI updates.
 * @param {object} options - Options for sending, e.g., for branching.
 */
export async function handleSendMessage(options = {}) {
    const { isBranching = false, branchFromIndex = -1 } = options;

    // 乌鸦：检查是否正在解析文件，如果是则阻止发送
    if (state.isParsingFile) {
        const { notify } = await import('./ui-updater.js?v=260820-1');
        notify.warning('文件正在解析中，请稍候...');
        return;
    }
    
    // 乌鸦：检查当前会话是否正在生成消息，如果是则阻止发送
    const currentConvId = state.currentConversationId;
    if (currentConvId && state.generatingMessages) {
        const prefix = `${currentConvId}_`;
        for (const key in state.generatingMessages) {
            if (key.startsWith(prefix)) {
                console.log('[handleSendMessage] Current conversation is generating, blocking send');
                return;
            }
        }
    }

    // 乌鸦：发送新消息时，重置并关闭代码预览侧边栏，以便开启新的自动跟随
    if (typeof codePreviewManager !== 'undefined') {
        codePreviewManager.close();
    }

    let currentConv = state.conversations[state.currentConversationId];
    // — 为什么这么写 —
    // 首次使用系统的用户或清除缓存后，系统没有活动会话 (state.currentConversationId 为 null)。
    // 此处如果直接 return，会导致首次导入 API 设置后点击发送消息静默失败无响应。
    // 规避技巧：如果当前没有任何活动会话，自动自动创建一个新会话，确保后续逻辑正常发出消息。
    if (!currentConv) {
        currentConv = await createNewConversation();
        if (!currentConv) return;
    }
    let activeBranch = currentConv.branches[currentConv.activeBranchIndex];

    const text = dom.messageInput.value.trim();
    const userMessageText = text;
    const userAttachments = Array.isArray(state.attachedFiles) ? state.attachedFiles.slice() : [];

    // — 为什么这么写 —
    // 当后台正在进行自动总结时，若用户发出新消息，会产生并发竞态（旧上下文未压缩即被发送）。
    // 此处拦截发送流程，弹出可视化冲突确认弹窗，向大爷实时展示提炼内容与精确秒表已耗时，由大爷选择【立即发】或【等待完成自动发】
    if (state.isAutoSummarizing && !options.skipAutoSummaryCheck && !isBranching && (userMessageText || userAttachments.length > 0)) {
        const { openAutoSummaryConflictModal } = await import('./modals/auto-summary-conflict-modal.js?v=260820-1');
        openAutoSummaryConflictModal({
            onSkip: () => {
                handleSendMessage({ ...options, skipAutoSummaryCheck: true });
            },
            onWait: () => {
                handleSendMessage({ ...options, skipAutoSummaryCheck: true });
            },
            onCancel: () => {
                // 取消发送，消息文本完整保留在输入框中
            }
        });
        return;
    }

    if (isBranching) {
        // 若未经过分叉联动弹窗，且当前分支截取点之后确实存在会被丢弃的消息，才弹出原生确认
        if (!options.skipBranchSummaryConfirm && activeBranch.length > (branchFromIndex + 2)) {
            if (!confirm("确定要从此消息开始新的分支吗？当前分支后续的消息将不会保留在新分支中。")) return;
        }
        const baseBranch = activeBranch.slice(0, branchFromIndex + 1);
        currentConv.branches.push(baseBranch);
        currentConv.activeBranchIndex = currentConv.branches.length - 1;
        activeBranch = currentConv.branches[currentConv.activeBranchIndex];

        // — 为什么这么写 —
        // 重新生成或创建新分支时，新分支仅保留截取范围内的消息。
        // 此处重新统计新分支上所有消息的实际隐藏状态，避免新分支在后续楼层上意外复用旧分支被丢弃节点的隐藏状态。
        const hiddenFloors = activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean);
        setHideSummaryForCurrentConversation({
            hiddenFloors,
            start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
            end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1
        });
        renderChatMessages();
    } else {
        // 乌鸦：修复图片发送问题 - 允许只有图片附件而没有文本的消息
        if (!userMessageText && userAttachments.length === 0) return;

        // 乌鸦：确保新会话有有效的API端点
        if (!currentConv.apiEndpointId && dom.apiSelector.value) {
            currentConv.apiEndpointId = dom.apiSelector.value;
        }
        addMessageToActiveBranch({
            role: 'user',
            content: userMessageText,
            attachments: userAttachments,
            timestamp: new Date().toISOString()
        });
        dom.messageInput.value = '';
        adjustTextareaHeight();
        clearAttachment();
        renderChatMessages();
    }

    // 乌鸦：修复多会话停止按钮 - 按会话 ID 管理 AbortController
    state.abortControllers[currentConv.id] = new AbortController();
    toggleSendButton(true);

    const aiMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        stats: {
            tokenCount: 0,
            startTime: performance.now(), // 使用高精度计时器
            endTime: null,
            duration: null,
            tokensPerSecond: null
        },
        apiEndpointId: currentConv.apiEndpointId
    };
    addMessageToActiveBranch(aiMessage);

    // 乌鸦：修复双气泡BUG的核心。不再单独调用displayMessage追加，而是统一由renderChatMessages渲染。
    await renderChatMessages({ isNewMessage: true });

    // 保存用户消息和空AI消息到数据库
    currentConv.lastModified = new Date().toISOString();
    await saveConversation(currentConv.id, currentConv);

    const aiMessageIndex = activeBranch.length - 1;
    // 乌鸦：从DOM中找到刚刚由renderChatMessages创建的AI消息气泡
    const aiMessageBubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessage.id}"]`);

    // 乌鸦：如果找不到气泡，说明渲染出了问题，直接报错并终止，防止后续代码出错。
    if (!aiMessageBubble) {
        console.error('严重错误：未能从DOM中找到AI消息气泡。', aiMessage);
        toggleSendButton(false);
        return;
    }

    const aiMessageContent = aiMessageBubble.querySelector('.message-content');
    aiMessageContent.classList.add('typing-cursor');

    // 记录本次请求的归属
    const requestConvId = currentConv.id;
    const requestBranchIndex = currentConv.activeBranchIndex;
    const requestAiMsgIndex = aiMessageIndex;

    // 标记该消息为流式生成中
    state.generatingMessages[`${requestConvId}_${requestBranchIndex}_${requestAiMsgIndex}`] = true;
    toggleMessageActions(aiMessage.id, true);


    try {
        const requestData = prepareRequest();
        state.lastRequestData = requestData; // 乌鸦：保存最后一次的请求数据，供二次请求复用

        if (!requestData) {
            throw new Error(`当前选择的API端点无效，请检查设置。`);
        }

        const response = await fetch(requestData.url, {
            method: requestData.method || 'POST',
            headers: requestData.headers,
            body: requestData.body ? JSON.stringify(requestData.body) : null,
            signal: state.abortControllers[requestConvId]?.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try { errorData = JSON.parse(errorText); } catch (e) { errorData = { error: { message: errorText } }; }
            throw new Error(`API错误: ${response.status} - ${errorData.error?.message || errorText}`);
        }

        // 乌鸦：获取当前API端点配置，以正确判断处理方式
        const apiEndpoint = state.apiEndpoints[currentConv.apiEndpointId] || API_PRESETS[currentConv.apiEndpointId];

        // 乌鸦：根据流式模式设置或API类型选择不同的处理函数
        if ((state.appSettings.streamMode !== false && requestData.body && requestData.body.stream) || (apiEndpoint && apiEndpoint.type === 'sse')) {
            await handleStream(response, aiMessage.id, requestConvId, requestBranchIndex, requestAiMsgIndex);
        } else {
            await handleNonStreamResponse(response, aiMessage.id, requestConvId, requestBranchIndex, requestAiMsgIndex);
        }

    } catch (error) {
        // 乌鸦：底层 handleStream/handleNonStreamResponse 已经处理了具体的错误内容追加
        // 除非内容完全为空（说明底层崩溃了没来得及处理），否则这里不再重复追加
        console.error('乌鸦：handleSendMessage 捕获到错误:', error);

        if (!aiMessage.content && error.name !== 'AbortError') {
            aiMessage.content = `<small class='error-indicator'>[ 错误: ${error.message} ]</small>`;
        }
    } finally {
        // 乌鸦：如果正在进行二次流式请求，则跳过最终的UI清理，避免冲突
        if (state.isFollowUpStreamActive) {
            console.log("乌鸦：检测到二次流式请求，跳过 handleSendMessage 的 finally 清理。");
            return;
        }

        if (aiMessage.content === '') {
            aiMessage.content = '<small class=\'error-indicator\'>[ 生成已中断。 ]</small>';
        }

        currentConv.lastModified = new Date().toISOString();

        // 计算耗时信息
        aiMessage.stats.endTime = performance.now();
        const durationMs = aiMessage.stats.endTime - aiMessage.stats.startTime;
        const durationSeconds = durationMs / 1000;
        aiMessage.stats.duration = durationSeconds;
        aiMessage.stats.durationMs = durationMs; // 保留毫秒精度
        aiMessage.stats.tokensPerSecond = durationSeconds > 0 ? aiMessage.stats.tokenCount / durationSeconds : 0;

        // 乌鸦：无论成功、失败还是中止，最终都要执行的清理工作
        // Final render of the message content and its footer/actions
        // A small delay can prevent weird rendering artifacts if things happen too fast
        setTimeout(async () => {
            const formattedHtml = await formatMessagePipeline(aiMessage.content, 'assistant');
            renderFormattedContent(aiMessageContent, formattedHtml);
            addOrUpdateMessageFooter(aiMessageBubble, aiMessage);
            updateSingleMessageCollapseState(aiMessageBubble);
            updateMessageActions(aiMessageBubble.querySelector('.message-actions'), aiMessage, aiMessageIndex);
        }, 350);

        // Clean up state
        // 乌鸦：清理当前会话的 AbortController
        delete state.abortControllers[requestConvId];
        // 乌鸦：确保在消息中断时也清理流状态
        state.streamingConversationId = null;
        if (state.generatingMessages) {
            // 乌鸦：必须用 requestConvId（闭包中固定的发送方会话ID）而非 state.currentConversationId（可能已切换到别的会话）
            delete state.generatingMessages[`${requestConvId}_${currentConv.activeBranchIndex}_${aiMessageIndex}`];
        }

        // Save data
        await saveConversation(currentConv.id, currentConv);
        await saveToLocalStorage();

        // Update all UI elements to reflect the final state
        updateAllDynamicUI();
        renderHistory();
    }
}

/**
 * Creates a new conversation object and switches to it.
 * @returns {object} The newly created conversation object.
 */
export async function createNewConversation() {
    if (shouldBlockConversationSwitch()) {
        const { notify } = await import('./ui-updater.js?v=260820-1');
        notify.warning('当前会话正在进行包含MCP工具的对话，请等待回复结束后，再新建会话。');
        return;
    }

    codePreviewManager.close();

    const newId = `conv_${Date.now()}`;
    const newConv = {
        id: newId,
        title: "", // 初始为空，便于自动设置为用户消息前10字
        lastModified: new Date().toISOString(),
        apiEndpointId: dom.apiSelector.value,
        branches: [[]],
        activeBranchIndex: 0,
        personaId: null,
        pinned: false // 乌鸦：新增置顶属性
    };

    state.conversations[newId] = newConv;

    // 保存新会话到数据库
    try {
        await saveConversation(newId, newConv);
        await saveToLocalStorage();
    } catch (e) {
        console.error("保存新会话失败:", e);
    }

    await switchToConversation(newId); // 等待切换完成
    return newConv;
}

/**
 * Switches the active view to a different conversation.
 * @param {string|null} convId - The ID of the conversation to switch to, or null to clear.
 * @returns {Promise<void>} A promise that resolves when the switch is complete.
 */
export function switchToConversation(convId) {
    return new Promise(resolve => {
        // 乌鸦：切换会话时，清理所有头像缓存，释放内存
        if (state.avatarUrlCache && state.avatarUrlCache.size > 0) {
            for (const url of state.avatarUrlCache.values()) {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            }
            state.avatarUrlCache.clear();
        }

        closeChatSearch(); // 乌鸦：切换会话时，自动关闭搜索框

        // 切换会话时，关闭可能开启的会话专属弹窗，防止旧会话表单残留或串台
        if (dom.hideSummaryModal && dom.hideSummaryModal.classList.contains('visible')) {
            dom.hideSummaryModal.classList.remove('visible');
            dom.hideSummaryModal.style.display = 'none';
        }
        if (dom.summaryHistoryModal && dom.summaryHistoryModal.classList.contains('visible')) {
            dom.summaryHistoryModal.classList.remove('visible');
            dom.summaryHistoryModal.style.display = 'none';
        }
        if (dom.summaryRollbackConfirmModal && dom.summaryRollbackConfirmModal.classList.contains('visible')) {
            dom.summaryRollbackConfirmModal.classList.remove('visible');
            dom.summaryRollbackConfirmModal.style.display = 'none';
        }
        if (dom.simulateSendModal && dom.simulateSendModal.classList.contains('visible')) {
            dom.simulateSendModal.classList.remove('visible');
            dom.simulateSendModal.style.display = 'none';
        }
        if (dom.systemPromptModal && dom.systemPromptModal.classList.contains('visible')) {
            dom.systemPromptModal.classList.remove('visible');
            dom.systemPromptModal.style.display = 'none';
        }
        if (dom.quickHideModal && dom.quickHideModal.classList.contains('visible')) {
            dom.quickHideModal.classList.remove('visible');
            dom.quickHideModal.style.display = 'none';
        }

        // 乌鸦：仅在切换到有效会话时才显示加载动画，首次进入或无会话时不显示
        if (convId) {
            showLoadingOverlay(); // 使用通用加载覆盖层
        }

        setTimeout(async () => {
            const oldConversationId = state.currentConversationId; // 乌鸦：保存旧会话 ID
            state.currentConversationId = convId;
            const conv = state.conversations[convId];

            // 乌鸦：修复问题2 - 通知MCP会话管理器会话切换
            if (typeof window.mcpSessionManager !== 'undefined' && window.mcpSessionManager) {
                try {
                    window.mcpSessionManager.onConversationSwitch(convId, oldConversationId);
                    console.log('乌鸦：已通知MCP会话管理器会话切换');
                } catch (error) {
                    console.error('乌鸦：MCP会话切换通知失败:', error);
                    // 乌鸦：如果MCP管理器未初始化，尝试动态导入
                    import('./mcp-session-manager.js?v=260820-1').then(module => {
                        if (module.mcpSessionManager) {
                            module.mcpSessionManager.onConversationSwitch(convId, oldConversationId);
                            console.log('乌鸦：动态导入MCP管理器成功，已通知会话切换');
                        }
                    }).catch(err => {
                        console.error('乌鸦：动态导入MCP管理器失败:', err);
                    });
                }
            } else {
                // 乌鸦：如果全局没有mcpSessionManager，尝试动态导入
                import('./mcp-session-manager.js?v=260820-1').then(module => {
                    if (module.mcpSessionManager) {
                        module.mcpSessionManager.onConversationSwitch(convId, oldConversationId);
                        console.log('乌鸦：首次导入MCP管理器成功，已通知会话切换');
                    }
                }).catch(err => {
                    console.error('乌鸦：首次导入MCP管理器失败:', err);
                });
            }

            if (conv) {
                dom.apiSelector.value = conv.apiEndpointId;
                dom.personaSelector.value = conv.personaId || 'default';
                dom.personaSelector.disabled = false;
                // 切换会话时同步数据库按钮状态
                // 乌鸦：数据库按钮现已改为常驻，不再受API类型限制
                /*
                const api = state.apiEndpoints[conv.apiEndpointId] || API_PRESETS[conv.apiEndpointId];
                if (dom.chooseDbBtn) {
                    if (api && api.type === 'sse') {
                        dom.chooseDbBtn.style.display = '';
                    } else {
                        dom.chooseDbBtn.style.display = 'none';
                    }
                }
                if (dom.chooseTableBtn) {
                    if (api && api.type === 'sse') {
                        dom.chooseTableBtn.style.display = '';
                    } else {
                        dom.chooseTableBtn.style.display = 'none';
                    }
                }
                */
            } else {
                // 如果没有活动会话，只有在没有可用角色时才禁用角色选择器
                const hasPersonas = Object.keys(state.personas).length > 0;
                dom.personaSelector.value = 'default';
                dom.personaSelector.disabled = !hasPersonas; // 只有在没有角色时才禁用
                // 乌鸦：数据库按钮常驻，不再隐藏
                // if (dom.chooseDbBtn) dom.chooseDbBtn.style.display = 'none';
                // if (dom.chooseTableBtn) dom.chooseTableBtn.style.display = 'none';
            }

            renderHistory();
            state.isFullRendering = true; // 乌鸦：加锁！开始全量渲染
            renderChatMessages({
                callback: () => { // Callback after rendering and collapsing
                    // 乌鸦：确保只有在显示了加载动画时才隐藏它
                    if (convId) {
                        hideLoadingOverlay(); // 隐藏加载覆盖层
                    }
                    state.isFullRendering = false; // 乌鸦：解锁！渲染完毕
                    resolve();
                }
            });
            updateAllDynamicUI(); // 乌鸦：总指挥在这里发号施令！

        }, 50); // 50毫秒的延迟，用于视觉过渡
    });
}

/**
 * Switches between different branches of the current conversation with a loading overlay.
 * @param {number} direction - -1 for previous, 1 for next.
 */
export async function switchBranch(direction) {
    const conv = state.conversations[state.currentConversationId];
    if (!conv || dom.mainChat.classList.contains('generating')) return;

    showLoadingOverlay();
    setTimeout(async () => {
        const newIndex = conv.activeBranchIndex + direction;
        if (newIndex >= 0 && newIndex < conv.branches.length) {
            conv.activeBranchIndex = newIndex;

            // — 为什么这么写 —
            // 切换到目标分支时，将全局 hideSummary 配置同步为目标分支各消息自身的 hidden 状态
            const targetBranch = conv.branches[newIndex] || [];
            const hiddenFloors = targetBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean);
            setHideSummaryForCurrentConversation({
                hiddenFloors,
                start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
                end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1
            });

            renderChatMessages({
                callback: () => {
                    hideLoadingOverlay();
                }
            });
            updateBranchNavigator();
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
            await saveConversation(conv.id, conv);
            await saveToLocalStorage();
        } else {
            hideLoadingOverlay();
        }
    }, 50);
}

export async function switchBranchTo(targetIndex) {
    const conv = state.conversations[state.currentConversationId];
    if (!conv || dom.mainChat.classList.contains('generating')) return;

    if (targetIndex >= 0 && targetIndex < conv.branches.length && targetIndex !== conv.activeBranchIndex) {
        showLoadingOverlay();
        setTimeout(async () => {
            conv.activeBranchIndex = targetIndex;

            // — 为什么这么写 —
            // 切换到目标分支时，将全局 hideSummary 配置同步为目标分支各消息自身的 hidden 状态
            const targetBranch = conv.branches[targetIndex] || [];
            const hiddenFloors = targetBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean);
            setHideSummaryForCurrentConversation({
                hiddenFloors,
                start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
                end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1
            });

            renderChatMessages({
                callback: () => {
                    hideLoadingOverlay();
                }
            });
            updateBranchNavigator();
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
            await saveConversation(conv.id, conv);
            await saveToLocalStorage();
        }, 50);
    }
}

/**
 * Adds a message object to the currently active branch of the conversation.
 * @param {object} message - The message object to add.
 */
function addMessageToActiveBranch(message) {
    const conv = state.conversations[state.currentConversationId];
    if (conv) {
        conv.branches[conv.activeBranchIndex].push(message);
    }
}

/**
 * Initializes the application.
 */
export async function initialize() {
    // 首先初始化数据库连接
    try {
        await openDB();
        console.log("IndexedDB 数据库连接已成功初始化");
    } catch (err) {
        console.error("IndexedDB 数据库连接失败:", err);
        alert("数据库初始化失败，这可能会影响应用的正常使用。请确保您的浏览器支持 IndexedDB 并且没有禁用它。");
    }

    if (typeof window.marked === 'undefined' || typeof window.hljs === 'undefined') {
        alert("错误：依赖的库文件未能加载，应用无法启动。");
        return;
    }

    window.marked.setOptions({
        highlight: (code, lang) => {
            const language = window.hljs.getLanguage(lang) ? lang : 'plaintext';
            return window.hljs.highlight(code, { language, ignoreIllegals: true }).value;
        },
        gfm: true,
        breaks: true,
    });

    initDom();

    // 将必要的函数挂载到window对象，供其他模块调用
    window.saveToLocalStorage = saveToLocalStorage;
    window.renderChatMessages = renderChatMessages;
    window.renderHistory = renderHistory;
    window.saveAppSettings = saveAppSettings;
    window.updateAllDynamicUI = updateAllDynamicUI;

    loadSettings();

    // 应用气泡外观样式与最大宽度
    applyBubbleCustomStyles();

    // 应用字体大小
    if (state.appSettings && state.appSettings.fontSize) {
        document.documentElement.style.setProperty('--font-size-base', state.appSettings.fontSize + 'px');
    }

    // 乌鸦：修复模型切换BUG，重构事件处理逻辑
    function handleApiSelectorChange() {
        const apiId = dom.apiSelector.value;
        const api = state.apiEndpoints[apiId] || API_PRESETS[apiId];

        // 1. 更新数据库按钮可见性 (保留原功能)
        // 乌鸦：数据库按钮现已改为常驻
        /*
        if (api && api.type === 'sse') {
            dom.chooseDbBtn.style.display = '';
            if (dom.chooseTableBtn) dom.chooseTableBtn.style.display = '';
        } else {
            dom.chooseDbBtn.style.display = 'none';
            if (dom.chooseTableBtn) dom.chooseTableBtn.style.display = 'none';
        }
        */

        // 2. 更新当前会话的API端点 (核心修复)
        if (state.currentConversationId && state.conversations[state.currentConversationId]) {
            const currentConv = state.conversations[state.currentConversationId];
            if (currentConv.apiEndpointId !== apiId) {
                currentConv.apiEndpointId = apiId;
                console.log(`乌鸦：当前会话 ${state.currentConversationId} 的API端点已切换为 ${apiId}`);

                // 重新渲染侧边栏历史记录，以更新API徽章
                renderHistory();

                // 保存更改
                saveToLocalStorage();
            }
        }
    }

    if (dom.apiSelector) {
        dom.apiSelector.addEventListener('change', handleApiSelectorChange);
    }

    // 选择数据库弹窗逻辑
    if (dom.chooseDbBtn) {
        dom.chooseDbBtn.onclick = async function () {
            const currentConv = state.conversations[state.currentConversationId];
            const currentDbId = currentConv && currentConv.dbId ? currentConv.dbId : null;
            const { showDbChooseModal } = await import('./db-choose.js?v=260820-1');
            showDbChooseModal(currentDbId, async (selectedDbId) => {
                if (state.currentConversationId && state.conversations[state.currentConversationId]) {
                    state.conversations[state.currentConversationId].dbId = selectedDbId;
                    await saveConversation(state.currentConversationId, state.conversations[state.currentConversationId]);
                    await saveToLocalStorage();
                    updateAllDynamicUI();
                }
            });
        };
    }

    if (dom.chooseTableBtn) {
        dom.chooseTableBtn.onclick = async function () {
            const currentConv = state.conversations[state.currentConversationId];
            const currentDbId = currentConv && currentConv.dbId ? currentConv.dbId : null;
            if (!currentDbId) {
                alert('请先选择数据库');
                return;
            }
            const { showTableChooseModal } = await import('./db-table-choose.js?v=260820-1');
            showTableChooseModal();
        };
    }

    // 从 IndexedDB 和 localStorage 加载所有数据
    await loadFromLocalStorage();

    initializeQuickPrompts();

    // 乌鸦：初始化MCP工具注册表
    if (state.mcpSettings.enabled) {
        try {
            // 初始化MCP工具选择器
            initMCPToolsSelector();
            console.log('乌鸦：MCP工具选择器初始化完成，自定义工具数量:', Object.keys(state.mcpCustomTools || {}).length);

            // 乌鸦：初始化MCP会话管理器并设置全局引用
            import('./mcp-session-manager.js?v=260820-1').then(module => {
                window.mcpSessionManager = module.mcpSessionManager;
                console.log('乌鸦：MCP会话管理器已设置为全局引用');
            }).catch(error => {
                console.error('乌鸦：导入MCP会话管理器失败:', error);
            });
        } catch (error) {
            console.error('MCP工具初始化失败:', error);
        }
    }


    handleApiSelectorChange(); // 确保基于加载后的状态更新可见性

    saveAppSettings();

    populatePersonaSelector();
    populateApiSelector();

    dom.apiPresetButtonsContainer.innerHTML = '';
    for (const key in API_PRESETS) {
        const preset = API_PRESETS[key];
        const button = document.createElement('button');
        button.textContent = preset.name;
        button.dataset.preset = key;
        dom.apiPresetButtonsContainer.appendChild(button);
    }

    setupEventListeners();

    // 乌鸦：初始化工具箱
    toolsManager.init();

    // 乌鸦：初始化批量删除事件
    initBatchDelete();

    renderHistory();
    const lastConversationId = Object.keys(state.conversations).sort((a, b) => new Date(state.conversations[b].lastModified) - new Date(state.conversations[a].lastModified))[0];
    if (lastConversationId) {
        await switchToConversation(lastConversationId);
    } else {
        // — 为什么这么写 —
        // 首次打开系统的全新用户无任何历史会话，如果传入 null 会导致 currentConversationId 被置空。
        // 自动初始化创建第一个会话，以便用户直接导入设置即可开始对话。
        await createNewConversation();
    }

    initDatabaseSettings();

    // localStorage 剩余空间检测按钮事件
    const btn = document.getElementById('check-ls-space-btn');
    const resultSpan = document.getElementById('ls-space-result');
    if (btn && resultSpan) {
        btn.onclick = () => {
            btn.disabled = true;
            resultSpan.textContent = '检测中...';
            setTimeout(() => {
                const bytes = getLocalStorageRemainingSpace();
                let mb = (bytes / 1024 / 1024).toFixed(2);
                resultSpan.textContent = `剩余约 ${mb} MB (${bytes} 字节)`;
                btn.disabled = false;
            }, 100);
        };
    }

    // IndexedDB 已用空间检测按钮事件
    const idbBtn = document.getElementById('check-idb-space-btn');
    const idbResultSpan = document.getElementById('idb-space-result');
    if (idbBtn && idbResultSpan) {
        idbBtn.onclick = async () => {
            idbBtn.disabled = true;
            idbResultSpan.textContent = '计算中...';
            try {
                const size = await getIndexedDBUsage();
                idbResultSpan.textContent = `已用约 ${size}`;
            } catch (error) {
                idbResultSpan.textContent = '计算失败';
                console.error('Failed to get IndexedDB usage:', error);
            } finally {
                idbBtn.disabled = false;
            }
        };
    }

    // 乌鸦：清空所有头像按钮事件绑定
    if (dom.clearAllAvatarsBtn) {
        dom.clearAllAvatarsBtn.addEventListener('click', async () => {
            if (!confirm('确定要清空所有头像吗？此操作不可恢复，将删除数据库中的所有头像数据。')) {
                return;
            }

            const originalText = dom.clearAllAvatarsBtn.textContent;
            const originalDisabled = dom.clearAllAvatarsBtn.disabled;

            try {
                // 设置按钮为处理中状态
                dom.clearAllAvatarsBtn.textContent = '清理中...';
                dom.clearAllAvatarsBtn.disabled = true;

                // 清空IndexedDB中的所有头像数据
                await clearAllAvatars();

                // 清理内存中的头像缓存和URL
                if (state.avatarUrlCache && state.avatarUrlCache.size > 0) {
                    console.log(`乌鸦：正在释放 ${state.avatarUrlCache.size} 个头像缓存...`);
                    for (const url of state.avatarUrlCache.values()) {
                        if (url.startsWith('blob:')) {
                            URL.revokeObjectURL(url);
                        }
                    }
                    state.avatarUrlCache.clear();
                }

                // 重置用户头像设置为默认状态
                if (state.appSettings.userAvatar) {
                    state.appSettings.userAvatar = null;
                    saveAppSettings();
                }

                // 清理所有会话的头像设置
                for (const convId in state.conversations) {
                    const conv = state.conversations[convId];
                    if (conv.avatar) {
                        conv.avatar = null;
                        await saveConversation(convId, conv);
                    }
                }

                // 保存状态到本地存储
                await saveToLocalStorage();

                // 重新渲染相关UI组件
                renderChatMessages();
                renderHistory();

                // 重置用户头像UI
                setupUserAvatarUI();

                alert('所有头像已成功清空！');

            } catch (error) {
                console.error('清空头像失败:', error);
                alert('清空头像时发生错误，请稍后重试。');
            } finally {
                // 恢复按钮状态
                dom.clearAllAvatarsBtn.textContent = originalText;
                dom.clearAllAvatarsBtn.disabled = originalDisabled;
            }
        });
    }

    // 初始化智能悬浮按钮
    initFloatingCollapseButton();

    // 乌鸦：初始化楼层快速跳转
    initFloorJump();

    // 初始化外观设置
    initializeAppearanceSettings();

    // 初始化本地数据备份健康度提醒服务
    initBackupReminder();

    // 乌鸦：新增页面卸载前的清理工作，用于释放头像缓存占用的内存
    window.addEventListener('beforeunload', () => {
        if (state.avatarUrlCache && state.avatarUrlCache.size > 0) {
            console.log(`乌鸦：正在释放 ${state.avatarUrlCache.size} 个头像缓存...`);
            for (const url of state.avatarUrlCache.values()) {
                // 只有 object URL 需要被 revoke
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            }
            state.avatarUrlCache.clear();
            console.log('乌鸦：头像缓存已全部释放。');
        }
    });
}

// 隐藏与总结功能：保存/切换/表单交互逻辑

/**
 * 设置指定会话的隐藏与总结配置
 * @param {string} convId - 会话ID
 * @param {object} data - 配置增量数据
 */
export function setHideSummaryForConversation(convId, data) {
    if (!convId) return;
    if (!state.hideSummary) state.hideSummary = {};
    state.hideSummary[convId] = {
        ...state.hideSummary[convId],
        ...data
    };
    saveToLocalStorage();
}

/**
 * 设置当前会话的隐藏与总结配置
 * @param {object} data - 配置增量数据
 */
export function setHideSummaryForCurrentConversation(data) {
    setHideSummaryForConversation(state.currentConversationId, data);
}

/**
 * 获取指定会话的隐藏与总结配置
 * @param {string} convId - 会话ID
 * @returns {object} 会话的总结与隐藏配置
 */
export function getHideSummaryForConversation(convId) {
    if (!convId) return {};
    return (state.hideSummary && state.hideSummary[convId]) ? state.hideSummary[convId] : {};
}

/**
 * 获取当前会话的隐藏与总结配置
 * @returns {object} 当前会话的总结与隐藏配置
 */
export function getHideSummaryForCurrentConversation() {
    return getHideSummaryForConversation(state.currentConversationId);
}

/**
 * Handles fetching and displaying the list of available models.
 */
export async function handleFetchModels(apiUrl = null, apiKey = null, modelInput = null) {
    const url = apiUrl || dom.apiUrlInput.value.trim();
    const key = apiKey || dom.apiKeyInput.value.trim();
    const targetModelInput = modelInput || dom.apiModelInput;
    const fetchButton = apiUrl ? dom.apiEditFetchModelsBtn : dom.fetchModelsBtn;

    if (!url) {
        alert('请先输入 API URL。');
        return;
    }

    const originalButtonText = fetchButton.textContent;
    fetchButton.textContent = '获取中...';
    fetchButton.disabled = true;

    try {
        const models = await fetchModels(url, key);
        const modelListContainer = dom.modelListContainer;
        modelListContainer.innerHTML = ''; // Clear previous list

        if (models.length === 0) {
            modelListContainer.textContent = '未找到可用模型。';
        } else {
            models.forEach(modelId => {
                const modelItem = document.createElement('div');
                modelItem.className = 'model-list-item';
                modelItem.textContent = modelId;
                modelItem.addEventListener('click', () => {
                    targetModelInput.value = modelId;
                    // 乌鸦：关闭弹窗 - 需要移除visible类和设置display为none
                    dom.modelListModal.classList.remove('visible');
                    dom.modelListModal.style.display = 'none';
                });
                modelListContainer.appendChild(modelItem);
            });
        }

        // 乌鸦：打开弹窗时需要同时设置display和visible类，这样关闭时closeModalWithAnimation才能正确工作
        dom.modelListModal.style.display = 'flex';
        dom.modelListModal.classList.add('visible');

    } catch (error) {
        alert(`获取模型列表失败: ${error.message}`);
    } finally {
        fetchButton.textContent = originalButtonText;
        fetchButton.disabled = false;
    }
}
