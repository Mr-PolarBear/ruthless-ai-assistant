/**
 * @file modal-events.js
 * @description Handles all modal-related events including opening, closing, and form submissions.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { processAndFilterMessages, getWorldBookContent, buildApiRequest } from './api-common.js';
import {
    openSettingsModal, closeSettingsModal, openPersonaModal, openWorldBookModal,
    openApiEditModal, closeApiEditModal, openPersonaEditModal, closePersonaEditModal,
    openMessageEditModal, closeMessageEditModal, closeCropModal, closeConvAvatarCropModal,
    openAvatarPreview, closeAvatarPreview, openConversationAvatarModal, closeConversationAvatarModal,
    openQuickHideModal, closeQuickHideModal, closeConvTitleModal, setupConvTitleModalEvents,
    closeExportConvModal, setupExportConvModalEvents
} from './modals.js';
import {
    renderChatMessages,
    populateApiSelector,
    populatePersonaSelector,
    formatMessagePipeline,
    renderFormattedContent
} from './renderer.js';
import {
    saveToLocalStorage,
    importConfig,
    importConversations,
    calculateConversationStats,
    countTokens,
    escapeHtml,
    showImportTemplate,
    fallbackCopyText
} from './utils.js';
import { showLoadingOverlay, hideLoadingOverlay, notify, updateSummaryEditorLockState } from './ui-updater.js';
import { addOrUpdateMessageFooter, updateMessageActions } from './message-manager.js';
import { switchToConversation, setHideSummaryForCurrentConversation, getHideSummaryForCurrentConversation } from './main.js';
import { saveConversation } from './db.js';
import { closeSidebarMobile } from './ui-events.js';
import { DEFAULT_SUMMARY_PROMPT, getVisibleMessagesForSummary, generateSummaryApiCall, applySummaryResult } from './summary-manager.js';
import { initSummaryHistoryModal, updateHideSummaryHistoryCount } from './modals/summary-history-modal.js';
import { initSimulateSendModal } from './modals/simulate-send-modal.js';

/**
 * Sets up modal-related event listeners
 */
export function setupModalEvents() {
    // Settings modal trigger (支持侧边栏设置按钮与顶栏设置按钮)
    const handleOpenSettings = () => {
        if (window.innerWidth <= 768) {
            closeSidebarMobile();
        }
        openSettingsModal();
    };

    if (dom.settingsBtn) dom.settingsBtn.addEventListener('click', handleOpenSettings);
    if (dom.topSettingsBtn) dom.topSettingsBtn.addEventListener('click', handleOpenSettings);

    // Modal close buttons
    setupModalCloseButtons();

    // Settings modal tabs
    setupSettingsTabs();

    // Hide & Summary modal
    setupHideSummaryModal();

    // System Prompt modal
    setupSystemPromptModal();

    // Model list modal
    setupModelListModal();

    // Avatar preview modal
    setupAvatarPreviewModal();

    // File viewer modal
    setupFileViewerModal();

    // HTML Preview modal
    setupHtmlPreviewModal();

    // Quick Hide modal
    setupQuickHideModal();

    // Data import/export in settings
    setupDataImportExport();

    // Message limit slider
    setupMessageLimitSlider();

    // Initialize system prompt modal copy buttons
    initSystemPromptModalCopyButtons();

    // 乌鸦：消息编辑按钮事件处理
    setupMessageEditEvents();

    // 修改会话标题弹窗事件
    setupConvTitleModalEvents();

    // 导出会话弹窗事件
    setupExportConvModalEvents();

    // 历史总结版本管理与回滚确认弹窗
    initSummaryHistoryModal();

    // 模拟发送与提示词透视弹窗
    initSimulateSendModal();
}

/**
 * Sets up modal close button events
 */
function setupModalCloseButtons() {
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const modal = btn.closest('.modal-overlay');
            if (!modal) return;


            switch (modal.id) {
                case 'settings-modal':
                    closeModalWithAnimation(modal, closeSettingsModal);
                    break;
                case 'api-edit-modal':
                    closeModalWithAnimation(modal, closeApiEditModal);
                    break;
                case 'persona-edit-modal':
                    closeModalWithAnimation(modal, closePersonaEditModal);
                    break;
                case 'message-edit-modal':
                    closeModalWithAnimation(modal, closeMessageEditModal);
                    break;
                case 'avatar-crop-modal':
                    closeModalWithAnimation(modal, closeCropModal);
                    break;
                case 'conv-avatar-crop-modal':
                    closeModalWithAnimation(modal, closeConvAvatarCropModal);
                    break;
                case 'avatar-preview-modal':
                    closeModalWithAnimation(modal, closeAvatarPreview);
                    break;
                case 'conversation-avatar-modal':
                    closeModalWithAnimation(modal, closeConversationAvatarModal);
                    break;
                case 'edit-conv-title-modal':
                    closeModalWithAnimation(modal, closeConvTitleModal);
                    break;
                case 'export-conv-modal':
                    closeModalWithAnimation(modal, closeExportConvModal);
                    break;
                case 'hide-summary-modal':
                    closeModalWithAnimation(dom.hideSummaryModal);
                    break;
                case 'system-prompt-modal':
                    closeModalWithAnimation(dom.systemPromptModal);
                    break;
                case 'model-list-modal':
                    closeModalWithAnimation(dom.modelListModal);
                    break;
                case 'file-viewer-modal':
                    closeModalWithAnimation(dom.fileViewerModal, closeFileViewer);
                    break;
                default:
                    closeModalWithAnimation(modal);
                    break;
            }
        });
    });
}

/**
 * Sets up settings modal tab switching
 */
function setupSettingsTabs() {
    dom.settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dom.settingsTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            dom.settingsTabContents.forEach(c => c.classList.remove('active'));
            const activeTabContent = document.getElementById(tab.dataset.tab);
            if (activeTabContent) {
                activeTabContent.classList.add('active');
            }

            if (tab.dataset.tab === 'data-settings') {
                showImportTemplate();
            }
        });
    });
}

/**
 * Sets up Hide & Summary modal events
 */
function setupHideSummaryModal() {
    // 总结内容回滚备份历史（按会话ID隔离维护）
    const summaryBackupHistory = {};

    const updateClearBtnState = (isUndo) => {
        if (!dom.hideSummaryClearBtn) return;
        if (isUndo) {
            dom.hideSummaryClearBtn.textContent = '撤销清空';
            dom.hideSummaryClearBtn.title = '点击撤销清空操作，恢复上一次的总结内容';
            dom.hideSummaryClearBtn.classList.add('undo-state');
            dom.hideSummaryClearBtn.dataset.isUndo = '1';
        } else {
            dom.hideSummaryClearBtn.textContent = '清空总结';
            dom.hideSummaryClearBtn.title = '清空当前总结内容（可随时撤销）';
            dom.hideSummaryClearBtn.classList.remove('undo-state');
            dom.hideSummaryClearBtn.dataset.isUndo = '0';
        }
    };

    dom.hideSummaryBtn.addEventListener('click', () => {
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        const data = getHideSummaryForCurrentConversation();
        dom.hideSummaryEnable.checked = !!data.enabled;
        if (dom.autoSummaryEnable) dom.autoSummaryEnable.checked = !!data.autoSummaryEnabled;

        const autoType = data.autoSummaryType || 'floors';
        if (dom.autoSummaryTypeFloors) dom.autoSummaryTypeFloors.checked = (autoType === 'floors');
        if (dom.autoSummaryTypeTokens) dom.autoSummaryTypeTokens.checked = (autoType === 'tokens');
        if (dom.autoSummaryFloorInterval) dom.autoSummaryFloorInterval.value = data.autoSummaryFloorInterval || 10;
        if (dom.autoSummaryTokenThreshold) dom.autoSummaryTokenThreshold.value = data.autoSummaryTokenThreshold || 4000;
        if (dom.autoSummaryDropFloors) dom.autoSummaryDropFloors.checked = data.dropSummarizedFloors !== false;
        if (dom.autoSummaryKeepRecent) dom.autoSummaryKeepRecent.checked = data.keepRecentFloors !== false;
        if (dom.autoSummaryKeepRecentCount) dom.autoSummaryKeepRecentCount.value = data.keepRecentFloorsCount || 2;

        dom.hideSummaryPrompt.value = data.prompt || DEFAULT_SUMMARY_PROMPT;
        dom.hideSummaryResult.value = data.summary || '';
        dom.hideSummaryWithRole.checked = !!data.withRole;
        dom.hideSummaryWithWorldBook.checked = !!data.withWorldBook;

        // 初始化消息限制滑块
        const messageLimitSlider = document.getElementById('message-limit-slider');
        const messageLimitValue = document.getElementById('message-limit-value');
        if (messageLimitSlider && messageLimitValue) {
            const messageLimit = data.messageLimit ?? 0;
            messageLimitSlider.value = messageLimit;
            messageLimitValue.textContent = messageLimit === 0 ? '全部' : messageLimit.toString();
        }

        // 刷新弹窗顶部的 Token 统计概览与隐藏楼层状态
        const conv = state.conversations[state.currentConversationId];
        if (conv) {
            const stats = calculateConversationStats(conv, data);
            if (dom.hideSummaryActualTokens) dom.hideSummaryActualTokens.textContent = (stats.actualSentEstimatedTokens || 0).toLocaleString();
            if (dom.hideSummaryHiddenTokens) dom.hideSummaryHiddenTokens.textContent = (stats.hiddenEstimatedTokens || 0).toLocaleString();
            if (dom.hideSummaryTotalTokens) dom.hideSummaryTotalTokens.textContent = (stats.totalEstimatedTokens || 0).toLocaleString();

            if (dom.hideSummaryHiddenFloorsText) {
                const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
                const hiddenFloors = [];
                if (activeBranch) {
                    activeBranch.forEach((msg, idx) => {
                        if (msg.hidden) hiddenFloors.push(idx + 1);
                    });
                }
                if (hiddenFloors.length === 0) {
                    dom.hideSummaryHiddenFloorsText.textContent = '无隐藏楼层 (全部可见)';
                } else {
                    const minFloor = Math.min(...hiddenFloors);
                    const maxFloor = Math.max(...hiddenFloors);
                    if (hiddenFloors.length === (maxFloor - minFloor + 1)) {
                        dom.hideSummaryHiddenFloorsText.textContent = `第 ${minFloor} ~ ${maxFloor} 楼 (共 ${hiddenFloors.length} 层)`;
                    } else {
                        dom.hideSummaryHiddenFloorsText.textContent = `第 ${hiddenFloors.join(', ')} 楼 (共 ${hiddenFloors.length} 层)`;
                    }
                }
            }
        }

        // 刷新历史版本数量角标
        updateHideSummaryHistoryCount();

        // 检查 AI 输出状态，若正在输出则锁定总结输入框只读
        updateSummaryEditorLockState();

        // 总结回滚状态检查
        const convId = state.currentConversationId;
        const hasBackup = !!(summaryBackupHistory[convId] && summaryBackupHistory[convId].trim());
        const isCurrentEmpty = !data.summary || !data.summary.trim();
        updateClearBtnState(isCurrentEmpty && hasBackup);

        dom.hideSummaryModal.style.display = 'flex';
        dom.hideSummaryModal.classList.add('visible');
        updateHideSummaryCharCounters();
    });

    if (dom.hideSummaryResult) {
        dom.hideSummaryResult.addEventListener('input', () => {
            if (dom.hideSummaryResult.value.trim()) {
                updateClearBtnState(false);
            }
        });
    }

    if (dom.hideSummaryStartBtn) dom.hideSummaryStartBtn.addEventListener('click', handleStartSummary);
    if (dom.hideSummarySaveBtn) dom.hideSummarySaveBtn.addEventListener('click', handleSaveSummary);
    if (dom.hideSummaryClearBtn) {
        dom.hideSummaryClearBtn.addEventListener('click', () => {
            const convId = state.currentConversationId;
            const isUndo = dom.hideSummaryClearBtn.dataset.isUndo === '1';

            if (isUndo) {
                // — 为什么这么写 —
                // 撤销回滚：从会话备份中恢复被清空的总结文本，防止误触导致内容丢失
                const backup = summaryBackupHistory[convId] || '';
                if (backup) {
                    dom.hideSummaryResult.value = backup;
                    setHideSummaryForCurrentConversation({ summary: backup });
                    updateHideSummaryCharCounters();
                    updateClearBtnState(false);
                    notify.success('✨ 已成功恢复总结记忆内容！');
                } else {
                    notify.warning('未找到可回滚的总结备份');
                    updateClearBtnState(false);
                }
            } else {
                // — 为什么这么写 —
                // 清空前先备份当前内容，并将按钮动态切换为【撤销清空】
                const currentContent = dom.hideSummaryResult.value;
                if (!currentContent.trim()) {
                    notify.info('当前没有可清空的总结内容');
                    return;
                }
                summaryBackupHistory[convId] = currentContent;
                dom.hideSummaryResult.value = '';
                setHideSummaryForCurrentConversation({ summary: '' });
                updateHideSummaryCharCounters();
                updateClearBtnState(true);
                notify.info('已清空总结（误操作可随时点击【撤销清空】恢复）');
            }
        });
    }

    dom.hideSummaryModal.querySelector('.modal-close-btn').addEventListener('click', (e) => {
        if (dom.hideSummaryStartBtn && dom.hideSummaryStartBtn.dataset.summarizing === '1') {
            const shouldClose = confirm('正在总结，是否停止并关闭弹窗？');
            if (!shouldClose) return;
            if (window._hideSummaryAbort) window._hideSummaryAbort.abort();
        }
        closeModalWithAnimation(dom.hideSummaryModal);
    });

    // Save state on input changes
    const summaryInputsToSave = [
        dom.hideSummaryEnable,
        dom.autoSummaryEnable,
        dom.autoSummaryTypeFloors,
        dom.autoSummaryTypeTokens,
        dom.autoSummaryFloorInterval,
        dom.autoSummaryTokenThreshold,
        dom.autoSummaryDropFloors,
        dom.autoSummaryKeepRecent,
        dom.autoSummaryKeepRecentCount,
        dom.hideSummaryPrompt,
        dom.hideSummaryWithRole,
        dom.hideSummaryWithWorldBook
    ];
    summaryInputsToSave.forEach(input => {
        if (!input) return;
        input.addEventListener('change', () => {
            const data = {
                enabled: dom.hideSummaryEnable.checked,
                autoSummaryEnabled: dom.autoSummaryEnable ? dom.autoSummaryEnable.checked : false,
                autoSummaryType: dom.autoSummaryTypeTokens && dom.autoSummaryTypeTokens.checked ? 'tokens' : 'floors',
                autoSummaryFloorInterval: parseInt(dom.autoSummaryFloorInterval?.value, 10) || 10,
                autoSummaryTokenThreshold: parseInt(dom.autoSummaryTokenThreshold?.value, 10) || 4000,
                dropSummarizedFloors: dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true,
                keepRecentFloors: dom.autoSummaryKeepRecent ? dom.autoSummaryKeepRecent.checked : true,
                keepRecentFloorsCount: parseInt(dom.autoSummaryKeepRecentCount?.value, 10) || 2,
                prompt: dom.hideSummaryPrompt.value,
                withRole: dom.hideSummaryWithRole.checked,
                withWorldBook: dom.hideSummaryWithWorldBook.checked,
            };
            setHideSummaryForCurrentConversation(data);
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (input === dom.hideSummaryEnable) {
                renderChatMessages({ updateVisibilityOnly: true });
            }
        });
    });

    dom.hideSummaryPrompt.addEventListener('input', updateHideSummaryCharCounters);
    dom.hideSummaryResult.addEventListener('input', updateHideSummaryCharCounters);
    updateHideSummaryCharCounters();
}

/**
 * Sets up System Prompt modal events
 */
function setupSystemPromptModal() {
    if (dom.systemPromptBtn) dom.systemPromptBtn.addEventListener('click', showSystemPromptModal);
    if (dom.sessionTokenBadge) dom.sessionTokenBadge.addEventListener('click', showSystemPromptModal);

    dom.systemPromptModal.querySelector('.modal-close-btn').addEventListener('click', () => {
        closeModalWithAnimation(dom.systemPromptModal);
    });

    dom.systemPromptModal.addEventListener('click', (e) => {
        if (e.target === dom.systemPromptModal) {
            closeModalWithAnimation(dom.systemPromptModal);
        }
    });
}

/**
 * Sets up Model List modal events
 */
function setupModelListModal() {
    if (dom.modelListModal) {
        // 乌鸦：点击遮罩层关闭Modal
        dom.modelListModal.addEventListener('click', (e) => {
            if (e.target === dom.modelListModal) {
                closeModalWithAnimation(dom.modelListModal);
            }
        });
    }
    // 乌鸦：不需要特殊处理关闭按钮，已经由setupModalCloseButtons()重旣了
}

/**
 * Sets up Avatar Preview modal events
 */
function setupAvatarPreviewModal() {
    if (dom.avatarPreviewCloseBtn) {
        dom.avatarPreviewCloseBtn.onclick = closeAvatarPreview;
    }
    if (dom.avatarPreviewModal) {
        dom.avatarPreviewModal.onclick = function (e) {
            if (e.target === dom.avatarPreviewModal) closeAvatarPreview();
        };
    }
}

/**
 * 乌鸦：设置文件查看器模态框事件
 */
function setupFileViewerModal() {
    // 乌鸦：点击关闭按钮
    const fileViewerCloseBtn = dom.fileViewerModal?.querySelector('.modal-close-btn');
    if (fileViewerCloseBtn) {
        fileViewerCloseBtn.addEventListener('click', () => {
            closeModalWithAnimation(dom.fileViewerModal, closeFileViewer);
        });
    }

    // 乌鸦：点击背景关闭
    if (dom.fileViewerModal) {
        dom.fileViewerModal.addEventListener('click', (e) => {
            if (e.target === dom.fileViewerModal) {
                closeModalWithAnimation(dom.fileViewerModal, closeFileViewer);
            }
        });
    }
}

/**
 * Sets up HTML Preview modal events
 */
function setupHtmlPreviewModal() {
    if (dom.htmlPreviewRefreshBtn) {
        dom.htmlPreviewRefreshBtn.addEventListener('click', () => {
            if (window.currentHtmlCode) {
                previewHtmlCode(window.currentHtmlCode);
            }
        });
    }

    if (dom.htmlPreviewOpenBtn) {
        dom.htmlPreviewOpenBtn.addEventListener('click', () => {
            if (window.currentHtmlCode) {
                const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>HTML 预览</title></head><body>${window.currentHtmlCode}</body></html>`;
                const newWindow = window.open('', '_blank');
                newWindow.document.write(fullHtml);
                newWindow.document.close();
            }
        });
    }

    if (dom.htmlPreviewModal) {
        dom.htmlPreviewModal.addEventListener('click', (e) => {
            if (e.target === dom.htmlPreviewModal) {
                closeModalWithAnimation(dom.htmlPreviewModal);
            }
        });

        const closeBtn = dom.htmlPreviewModal.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closeModalWithAnimation(dom.htmlPreviewModal);
            });
        }
    }
}

/**
 * Sets up Quick Hide modal events
 */
function setupQuickHideModal() {
    // 乌鸦/小鸡：单楼层隐藏 / 取消隐藏切换（离散多楼层独立维护，精准绑定消息对象）
    if (dom.quickHideSingleBtn) {
        dom.quickHideSingleBtn.addEventListener('click', () => {
            const floor = parseInt(dom.quickHideModal.dataset.floor, 10);
            const isFloorHidden = dom.quickHideModal.dataset.floorHidden === '1';
            const conv = state.conversations[state.currentConversationId];
            if (floor && conv) {
                const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
                const targetMsg = activeBranch ? activeBranch[floor - 1] : null;

                if (isFloorHidden) {
                    // — 为什么这么写 —
                    // 仅取消当前消息的隐藏状态
                    if (targetMsg) targetMsg.hidden = false;
                } else {
                    // — 为什么这么写 —
                    // 仅将当前消息标记为隐藏，精准绑定在消息对象自身上
                    if (targetMsg) targetMsg.hidden = true;
                }

                // 统计当前活跃分支上所有被标记隐藏的消息楼层
                const hiddenFloors = activeBranch
                    ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
                    : [];

                const enabled = hiddenFloors.length > 0;
                const start = hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1;
                const end = hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1;

                setHideSummaryForCurrentConversation({
                    hiddenFloors,
                    start,
                    end,
                    enabled
                });
                saveConversation(conv.id, conv);
                renderChatMessages({ updateVisibilityOnly: true });
                if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
                closeModalWithAnimation(dom.quickHideModal);
            }
        });
    }
    // 批量隐藏（将 1 至 floor 楼全部加入隐藏集合）
    if (dom.quickHideConfirmBtn) {
        dom.quickHideConfirmBtn.addEventListener('click', () => {
            const floor = parseInt(dom.quickHideModal.dataset.floor, 10);
            const conv = state.conversations[state.currentConversationId];
            if (floor && conv) {
                // — 为什么这么写 —
                // 增加二次确认框，避免用户在移动端或快速点击时误将大范围历史楼层批量隐藏
                if (!confirm(`确定要将第 1 楼至第 ${floor} 楼全部标记为隐藏吗？`)) {
                    return;
                }

                const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
                if (activeBranch) {
                    for (let i = 0; i < floor && i < activeBranch.length; i++) {
                        activeBranch[i].hidden = true;
                    }
                }
                const hiddenFloors = activeBranch
                    ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
                    : [];

                setHideSummaryForCurrentConversation({
                    hiddenFloors,
                    start: 1,
                    end: Math.max(floor, ...hiddenFloors),
                    enabled: true
                });
                saveConversation(conv.id, conv);
                renderChatMessages({ updateVisibilityOnly: true });
                if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
                closeModalWithAnimation(dom.quickHideModal);
            }
        });
    }
    // 区间快捷隐藏（将指定的 start 至 end 楼层增量加入隐藏集合，绝对不影响已有隐藏楼层）
    if (dom.quickHideRangeBtn) {
        dom.quickHideRangeBtn.addEventListener('click', () => {
            const conv = state.conversations[state.currentConversationId];
            if (!conv) return;
            const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
            if (!activeBranch || activeBranch.length === 0) return;

            const start = parseInt(dom.quickHideRangeStart?.value, 10);
            const end = parseInt(dom.quickHideRangeEnd?.value, 10);

            if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
                notify.warning('请输入有效的起止楼层（起始楼层需大于0且小于等于结束楼层）');
                return;
            }

            // — 为什么这么写 —
            // 增加防误触二次确认框，避免用户误点击导致大范围楼层被批量标记隐藏
            if (!confirm(`确定要将第 ${start} 楼至第 ${end} 楼全部标记为隐藏吗？`)) {
                return;
            }

            // — 为什么这么写 —
            // 1. 增量合并隐藏：只将 [start-1, end-1] 范围内的消息标记为 hidden = true
            // 2. 原本已被隐藏的其它楼层（如之前隐藏的其它楼层）继续保持 hidden = true，绝不被误取消
            for (let i = start - 1; i < end && i < activeBranch.length; i++) {
                activeBranch[i].hidden = true;
            }

            const hiddenFloors = activeBranch
                .map((m, i) => (m.hidden ? i + 1 : null))
                .filter(Boolean);

            setHideSummaryForCurrentConversation({
                hiddenFloors,
                start: Math.min(...hiddenFloors),
                end: Math.max(...hiddenFloors),
                enabled: true
            });
            saveConversation(conv.id, conv);
            renderChatMessages({ updateVisibilityOnly: true });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            notify.success(`已隐藏第 ${start} 至 ${end} 楼`);
            closeModalWithAnimation(dom.quickHideModal);
        });
    }
    if (dom.quickHideResetBtn) {
        dom.quickHideResetBtn.addEventListener('click', () => {
            // — 为什么这么写 —
            // 增加二次确认框，避免误点清空当前会话已配置的所有隐藏标记
            if (!confirm('确定要取消并清除当前分支的所有隐藏标记吗？')) {
                return;
            }

            const conv = state.conversations[state.currentConversationId];
            if (conv && conv.branches && conv.branches[conv.activeBranchIndex]) {
                conv.branches[conv.activeBranchIndex].forEach(m => {
                    delete m.hidden;
                });
                saveConversation(conv.id, conv);
            }
            setHideSummaryForCurrentConversation({
                hiddenFloors: [],
                enabled: false
            });
            renderChatMessages({ updateVisibilityOnly: true });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            closeModalWithAnimation(dom.quickHideModal);
        });
    }
}

/**
 * Sets up data import/export events in settings modal
 */
function setupDataImportExport() {
    // A temporary store for the parsed conversation data from the uploaded file
    let parsedConversations = [];
    let parsedBundleMetadata = {};

    // --- Event Listeners for the new UI ---

    // 1. "选择文件" button triggers the hidden file input
    if (dom.uploadConversationBtn) {
        dom.uploadConversationBtn.addEventListener('click', () => {
            dom.importConversationFileInput.click();
        });
    }

    // 2. Hidden file input handles the file reading and processing
    if (dom.importConversationFileInput) {
        dom.importConversationFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (file.type !== 'application/json') {
                alert('请选择一个.json文件！');
                return;
            }

            const reader = new FileReader();

            reader.onload = (e) => {
                const importData = e.target.result;
                event.target.value = ''; // Clear the file input for re-upload

                showLoadingOverlay('正在解析文件...');

                setTimeout(() => { // Use setTimeout to allow UI to update with loading overlay
                    try {
                        const parsedData = JSON.parse(importData);
                        let conversationsToDisplay = [];

                        // 提取顶级全量 bundle 元数据（如全量导出的 worldBook 与 hideSummary）
                        parsedBundleMetadata = {
                            worldBook: parsedData.worldBook || null,
                            hideSummary: parsedData.hideSummary || null
                        };

                        if (parsedData.conversations && typeof parsedData.conversations === 'object') {
                            conversationsToDisplay = Object.values(parsedData.conversations);
                        } else if (parsedData.id && parsedData.branches) {
                            conversationsToDisplay.push(parsedData);
                        } else {
                            throw new Error('无效的会话数据格式');
                        }

                        if (conversationsToDisplay.length === 0) {
                            alert('没有找到可导入的会话。');
                            hideLoadingOverlay();
                            return;
                        }

                        // Store parsed data for later use
                        parsedConversations = conversationsToDisplay;

                        // Populate the list
                        const listContainer = document.getElementById('import-conversation-list');
                        listContainer.innerHTML = ''; // Clear previous list

                        conversationsToDisplay.forEach((conv, index) => {
                            const listItem = document.createElement('div');
                            listItem.className = 'import-conversation-list-item';
                            listItem.dataset.index = index;

                            const title = conv.title || `对话 ${index + 1}`;

                            listItem.innerHTML = `
                                <input type="checkbox" class="import-item-checkbox" data-index="${index}">
                                <span class="import-conversation-list-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
                            `;
                            listContainer.appendChild(listItem);
                        });

                        // Update count
                        document.getElementById('import-conversation-count').textContent = `${conversationsToDisplay.length} 个对话`;

                        // Show the preview container and import button
                        document.getElementById('import-preview-container').style.display = 'flex';
                        document.getElementById('import-selected-conversations-btn').style.display = 'inline-block';

                        // Reset preview
                        document.getElementById('import-conversation-preview').innerHTML = '<p class="settings-hint">点击左侧列表中的标题以预览内容</p>';

                        // Reset select-all checkbox
                        document.getElementById('import-select-all-checkbox').checked = false;

                    } catch (err) {
                        alert(`文件解析失败: ${err.message}`);
                        console.error("File parsing error:", err);
                    } finally {
                        hideLoadingOverlay();
                    }
                }, 10); // A small delay to ensure loading screen shows up before potential freeze
            };

            reader.onerror = () => {
                alert(`读取文件 ${file.name} 时出错`);
            };
            reader.readAsText(file);
        });
    }

    // 3. "全选" checkbox
    const selectAllCheckbox = document.getElementById('import-select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.import-item-checkbox').forEach(checkbox => {
                checkbox.checked = isChecked;
            });
        });
    }

    // 4. Click on list items for preview (using event delegation)
    const listContainer = document.getElementById('import-conversation-list');
    if (listContainer) {
        listContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.import-conversation-list-item');
            if (!item) return;

            // 乌鸦：新增逻辑 - 如果点击的是标题，则切换复选框的状态
            if (e.target.classList.contains('import-conversation-list-item-title')) {
                const checkbox = item.querySelector('.import-item-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
            }

            // 保留原有逻辑：高亮并显示预览
            document.querySelectorAll('.import-conversation-list-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            const index = parseInt(item.dataset.index, 10);
            const conv = parsedConversations[index];
            const previewContainer = document.getElementById('import-conversation-preview');

            if (conv) {
                let previewHtml = `<h4>${escapeHtml(conv.title || '')}</h4>`;
                if (conv.branches && conv.branches[0]) {
                    conv.branches[0].forEach(msg => {
                        previewHtml += `<div class="preview-message" style="margin-bottom: 1em; border-bottom: 1px solid var(--border-color-light); padding-bottom: 0.5em;"><strong>${escapeHtml(msg.role)}:</strong><p style="margin: 0.2em 0 0 0; white-space: pre-wrap;">${escapeHtml(msg.content.substring(0, 300))}${msg.content.length > 300 ? '...' : ''}</p></div>`;
                    });
                }
                previewContainer.innerHTML = previewHtml;
            }
        });
    }

    // 5. "导入选中" button
    const importSelectedBtn = document.getElementById('import-selected-conversations-btn');
    if (importSelectedBtn) {
        importSelectedBtn.addEventListener('click', async () => {
            const selectedIndices = Array.from(document.querySelectorAll('.import-item-checkbox:checked'))
                .map(cb => parseInt(cb.dataset.index, 10));

            if (selectedIndices.length === 0) {
                alert('请至少选择一个要导入的对话。');
                return;
            }

            const conversationsToImport = selectedIndices.map(index => parsedConversations[index]);

            showLoadingOverlay('正在导入选中的会话...');
            try {
                const lastImportedId = await importConversations(conversationsToImport, parsedBundleMetadata);
                if (lastImportedId) {
                    switchToConversation(lastImportedId);
                }
            } catch (err) {
                // The alert is already handled inside importConversations
                console.error("Import failed:", err);
            } finally {
                hideLoadingOverlay();
            }
        });
    }


    // --- Keep the old config import/export logic ---
    if (dom.importConfigBtn) {
        dom.importConfigBtn.addEventListener('click', () => {
            try {
                if (importConfig(dom.importConfigTextarea.value)) {
                    dom.importConfigTextarea.value = '';
                    alert('配置导入成功！');
                }
            } catch (e) {
                console.error("导入配置时出错:", e);
                alert(`导入配置失败: ${e.message}`);
            }
        });
    }
    if (dom.uploadConfigBtn) {
        dom.uploadConfigBtn.addEventListener('click', () => {
            dom.importConfigFileInput.click();
        });
    }
    if (dom.importConfigFileInput) {
        dom.importConfigFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (file.type !== 'application/json') {
                alert('请选择一个.json文件！');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                dom.importConfigTextarea.value = e.target.result;
                event.target.value = '';
            };
            reader.onerror = () => {
                alert(`读取文件 ${file.name} 时出错`);
            };
            reader.readAsText(file);
        });
    }
}
/**
 * Sets up message limit slider events
 */
function setupMessageLimitSlider() {
    const messageLimitSlider = document.getElementById('message-limit-slider');
    const messageLimitValue = document.getElementById('message-limit-value');

    if (messageLimitSlider && messageLimitValue) {
        // 监听滑块值变化
        messageLimitSlider.addEventListener('input', () => {
            const value = parseInt(messageLimitSlider.value);
            messageLimitValue.textContent = value === 0 ? '全部' : value.toString();
        });

        // 保存滑块值到会话配置
        messageLimitSlider.addEventListener('change', () => {
            const data = getHideSummaryForCurrentConversation();
            data.messageLimit = parseInt(messageLimitSlider.value);
            setHideSummaryForCurrentConversation(data);

            if (window.updateHideSummaryBtnColor) {
                window.updateHideSummaryBtnColor();
            }
        });
    }
}

/**
 * 初始化会话数据详情弹窗的复制按钮事件
 */
function initSystemPromptModalCopyButtons() {
    const copyButtons = document.querySelectorAll('#system-prompt-modal .copy-system-prompt-btn');
    copyButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.target;
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                let textToCopy = '';
                switch (targetId) {
                    case 'system-prompt-persona':
                        textToCopy = dom.currentPersonaContent;
                        break;
                    case 'system-prompt-worldbook':
                        textToCopy = dom.currentWorldbookContent;
                        break;
                    case 'system-prompt-summary':
                        textToCopy = dom.currentSummaryContent;
                        break;
                    default:
                        textToCopy = '';
                }
                textToCopy = textToCopy.trim();

                if (textToCopy === '无角色提示词' ||
                    textToCopy === '无备忘录内容' ||
                    textToCopy === '无总结内容') {
                    textToCopy = '';
                }

                if (textToCopy && textToCopy.length > 0) {
                    if (navigator.clipboard && window.isSecureContext) {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            notify.copy();
                        }).catch(err => {
                            console.error('无法使用 Clipboard API 复制: ', err);
                            fallbackCopyText(textToCopy);
                            notify.copy();
                        });
                    } else {
                        fallbackCopyText(textToCopy);
                        notify.copy();
                    }
                } else {
                    notify.info('没有内容可复制');
                }
            }
        });
    });
}

/**
 * 通用模态框关闭函数，带渐隐动画
 * @param {HTMLElement} modal - The modal element to close.
 * @param {Function} [callback] - Optional callback function to run after closing.
 */
export function closeModalWithAnimation(modal, callback) {
    if (!modal || !modal.classList.contains('visible') || modal.classList.contains('fade-out')) {
        return;
    }

    modal.classList.add('fade-out');

    if (callback) {
        callback();
    }

    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('visible');
        modal.classList.remove('fade-out');
    }, 300);
}

/**
 * 更新隐藏总结字符计数器
 */
function updateHideSummaryCharCounters() {
    if (dom.hideSummaryPromptCharCounter) {
        dom.hideSummaryPromptCharCounter.textContent = `${dom.hideSummaryPrompt.value.length} 字`;
    }
    if (dom.hideSummaryResultCharCounter) {
        dom.hideSummaryResultCharCounter.textContent = `${dom.hideSummaryResult.value.length} 字`;
    }
}

/**
 * 显示系统提示模态框
 */
function showSystemPromptModal() {
    const conv = state.conversations[state.currentConversationId];
    if (!conv) {
        alert('请先创建一个会话！');
        return;
    }

    let personaContent = '无角色提示词';
    if (conv.personaId && state.personas[conv.personaId]) {
        personaContent = state.personas[conv.personaId].prompt || '无角色提示词';
    }
    dom.systemPromptPersona.innerHTML = personaContent ? escapeHtml(personaContent) : '<span class="empty-prompt-message">无角色提示词</span>';
    dom.currentPersonaContent = personaContent;

    const enabledWorldBookEntries = Object.values(state.worldBook)
        .filter(entry => entry.enabled || (entry.sessionIds && entry.sessionIds.includes(state.currentConversationId)))
        .sort((a, b) => a.depth - b.depth);

    if (enabledWorldBookEntries.length > 0) {
        const worldbookContent = enabledWorldBookEntries
            .map(entry => `${escapeHtml(entry.name)}:\n${escapeHtml(entry.content)}`)
            .join('\n\n');
        dom.systemPromptWorldbook.innerHTML = worldbookContent;
        dom.currentWorldbookContent = worldbookContent;
    } else {
        dom.systemPromptWorldbook.innerHTML = '<span class="empty-prompt-message">无备忘录内容</span>';
        dom.currentWorldbookContent = '无备忘录内容';
    }

    const hideSummaryConfig = state.hideSummary && state.hideSummary[state.currentConversationId];
    if (hideSummaryConfig && hideSummaryConfig.enabled && hideSummaryConfig.summary) {
        dom.systemPromptSummary.innerHTML = escapeHtml(hideSummaryConfig.summary);
        dom.currentSummaryContent = hideSummaryConfig.summary;
    } else {
        dom.systemPromptSummary.innerHTML = '<span class="empty-prompt-message">无总结内容</span>';
        dom.currentSummaryContent = '无总结内容';
    }

    // 计算和显示对话统计信息
    const convStats = calculateConversationStats(conv, hideSummaryConfig);
    if (dom.actualSentTokens) dom.actualSentTokens.textContent = (convStats.actualSentEstimatedTokens || 0).toLocaleString();
    const actualSentCharsEl = document.getElementById('actual-sent-characters');
    if (actualSentCharsEl) actualSentCharsEl.textContent = (convStats.actualSentCharacters || 0).toLocaleString();
    dom.totalEstimatedTokens.textContent = (convStats.totalEstimatedTokens || 0).toLocaleString();
    dom.totalCharacters.textContent = (convStats.totalCharacters || 0).toLocaleString();
    if (dom.mainTokens) dom.mainTokens.textContent = (convStats.mainTokens || 0).toLocaleString();
    if (dom.thinkingTokens) dom.thinkingTokens.textContent = (convStats.thinkingTokens || 0).toLocaleString();
    if (dom.mainCharacters) dom.mainCharacters.textContent = (convStats.mainCharacters || 0).toLocaleString();
    if (dom.thinkingCharacters) dom.thinkingCharacters.textContent = (convStats.thinkingCharacters || 0).toLocaleString();
    dom.hiddenTokens.textContent = (convStats.hiddenEstimatedTokens || 0).toLocaleString();
    dom.hiddenCharacters.textContent = (convStats.hiddenCharacters || 0).toLocaleString();

    // 乌鸦：展示附件专项统计与 MCP 专项统计
    const attachmentsTokens = document.getElementById('attachments-tokens');
    const attachmentsChars = document.getElementById('attachments-chars');
    if (attachmentsTokens) attachmentsTokens.textContent = convStats.attachmentsTokens;
    if (attachmentsChars) attachmentsChars.textContent = convStats.attachmentsCharacters;

    const mcpToolCallsCount = document.getElementById('mcp-tool-calls-count');
    const mcpAnalysisTokens = document.getElementById('mcp-analysis-tokens');
    const mcpAnalysisChars = document.getElementById('mcp-analysis-chars');
    const mcpToolDataTokens = document.getElementById('mcp-tool-data-tokens');
    const mcpToolDataChars = document.getElementById('mcp-tool-data-chars');
    if (mcpToolCallsCount) mcpToolCallsCount.textContent = convStats.totalToolCalls;
    if (mcpAnalysisTokens) mcpAnalysisTokens.textContent = convStats.mcpAnalysisTokens;
    if (mcpAnalysisChars) mcpAnalysisChars.textContent = convStats.mcpAnalysisCharacters;
    if (mcpToolDataTokens) mcpToolDataTokens.textContent = convStats.mcpToolDataTokens;
    if (mcpToolDataChars) mcpToolDataChars.textContent = convStats.mcpToolDataCharacters;

    dom.systemPromptModal.style.display = 'flex';
    dom.systemPromptModal.classList.add('visible');

    // 计算并显示tokens预估
    const personaTitleSpan = document.querySelector('#system-prompt-modal details:nth-of-type(1) .details-title');
    const worldbookTitleSpan = document.getElementById('worldbook-title');
    const summaryTitleSpan = document.querySelector('#system-prompt-modal details:nth-of-type(3) .details-title');

    // 获取实际内容，用于tokens计算
    const actualPersonaContent = dom.systemPromptPersona.textContent.trim();
    const actualWorldbookContent = dom.systemPromptWorldbook.textContent.trim();
    const actualSummaryContent = dom.systemPromptSummary.textContent.trim();

    // 计算tokens
    const personaTokens = countTokens(actualPersonaContent);
    const worldbookTokens = countTokens(actualWorldbookContent);
    const summaryTokens = countTokens(actualSummaryContent);

    // 更新标题的innerHTML，追加tokens信息
    if (personaTitleSpan) {
        personaTitleSpan.innerHTML = `角色提示词<span class="token-estimate">(预估tokens:${personaTokens})</span>`;
    }
    if (worldbookTitleSpan) {
        worldbookTitleSpan.innerHTML = `备忘录内容<span class="token-estimate">(预估tokens:${worldbookTokens})</span>`;
    }
    if (summaryTitleSpan) {
        summaryTitleSpan.innerHTML = `总结内容<span class="token-estimate">(预估tokens:${summaryTokens})</span>`;
    }
}

/**
 * Handles the "Start Summary" button click. 开始总结
 */
/**
 * Handles the "Start Summary" button click. 开始总结
 */
let lastSummarizedItems = [];

async function handleStartSummary() {
    const btn = dom.hideSummaryStartBtn;
    if (btn.dataset.summarizing === '1') {
        if (window._hideSummaryAbort) {
            window._hideSummaryAbort.abort();
        }
        return;
    }

    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (!conv) {
        alert('无法进行总结，未找到当前会话。');
        return;
    }

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const hideConfig = getHideSummaryForCurrentConversation();
    const visibleMessages = getVisibleMessagesForSummary(activeBranch, hideConfig);

    if (visibleMessages.length === 0) {
        alert('当前分支中没有可见（未隐藏）的消息可供总结。');
        return;
    }

    lastSummarizedItems = visibleMessages;
    const customPrompt = dom.hideSummaryPrompt.value.trim() || DEFAULT_SUMMARY_PROMPT;
    setHideSummaryForCurrentConversation({ prompt: customPrompt });

    btn.textContent = '停止总结';
    btn.classList.add('summarizing');
    btn.dataset.summarizing = '1';
    dom.hideSummaryResult.value = '';
    updateSummaryEditorLockState();

    window._hideSummaryAbort = new AbortController();

    try {
        await generateSummaryApiCall({
            convId,
            messagesToSummarize: visibleMessages,
            customPrompt,
            withRole: dom.hideSummaryWithRole.checked,
            withWorldBook: dom.hideSummaryWithWorldBook.checked,
            signal: window._hideSummaryAbort.signal,
            onChunk: (delta, fullText) => {
                dom.hideSummaryResult.value = fullText;
                dom.hideSummaryResult.scrollTop = dom.hideSummaryResult.scrollHeight;
                updateHideSummaryCharCounters();
            }
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            dom.hideSummaryResult.value += `\n\n[错误: ${error.message}]`;
        } else {
            dom.hideSummaryResult.value += `\n\n[总结已由用户停止]`;
        }
    } finally {
        btn.textContent = '针对当前可见消息立即总结';
        btn.classList.remove('summarizing');
        btn.dataset.summarizing = '0';
        window._hideSummaryAbort = null;
        updateHideSummaryCharCounters();
        updateSummaryEditorLockState();
    }
}

/**
 * Handles the "Save Summary" button click.
 */
async function handleSaveSummary() {
    const summary = dom.hideSummaryResult.value;
    if (!summary.trim()) {
        alert('总结内容不能为空。');
        return;
    }

    const convId = state.currentConversationId;
    const dropFloors = dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true;
    await applySummaryResult(convId, summary, lastSummarizedItems, dropFloors, '手动保存');
    updateHideSummaryHistoryCount();
    notify.success('✨ 总结已成功保存为记忆并应用！');
    closeModalWithAnimation(dom.hideSummaryModal);
}

/**
 * Preview HTML code in modal
 */
function previewHtmlCode(htmlCode) {
    window.currentHtmlCode = htmlCode;

    const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>HTML 预览</title></head><body>${htmlCode}</body></html>`;

    const iframe = dom.htmlPreviewFrame;
    iframe.srcdoc = fullHtml;

    dom.htmlPreviewModal.classList.add('visible');
    dom.htmlPreviewModal.style.display = 'flex';
}

/**
 * 乌鸦：设置消息编辑按钮事件
 */
function setupMessageEditEvents() {
    // 乌鸦：确保DOM元素存在后再绑定事件
    setTimeout(() => {
        // 乌鸦：消息编辑保存按钮
        const saveBtn = document.getElementById('message-edit-save-btn');
        if (saveBtn) {
            // 乌鸦：先移除可能存在的事件监听器，避免重复绑定
            saveBtn.removeEventListener('click', saveMessageEdit);
            saveBtn.addEventListener('click', saveMessageEdit);
        }

        // 乌鸦：消息编辑取消按钮
        const cancelBtn = document.getElementById('message-edit-cancel-btn2');
        if (cancelBtn) {
            // 乌鸦：先移除可能存在的事件监听器，避免重复绑定
            cancelBtn.removeEventListener('click', handleMessageEditCancel);
            cancelBtn.addEventListener('click', handleMessageEditCancel);
        }
    }, 100); // 乌鸦：延迟100ms确保DOM加载完成
}

/**
 * 乌鸦：处理消息编辑取消事件
 */
function handleMessageEditCancel() {
    closeModalWithAnimation(dom.messageEditModal, closeMessageEditModal);
}

/**
 * 乌鸦：保存消息编辑
 */
async function saveMessageEdit() {
    if (!window._editingMsgObj || window._editingMsgIndex === undefined) {
        return;
    }

    const newContent = dom.messageEditTextarea.value;
    const message = window._editingMsgObj;
    const index = window._editingMsgIndex;

    const oldContent = message.content;
    delete message.originalContent;

    // — 为什么这么写 —
    // 建立单向递增的版本历史 versions = [{ version: 1, content: "你好" }, { version: 2, content: "你好，你是谁" }]，
    // 配合 activeVersionIndex 标记当前使用版本，确保 v1、v2 的内容与版本号永远固化，绝不颠倒混乱
    if (oldContent !== newContent) {
        if (!Array.isArray(message.versions) || message.versions.length === 0) {
            message.versions = [{
                version: 1,
                content: oldContent,
                timestamp: message.timestamp || new Date().toISOString()
            }];
        }

        // 追加新版本
        const nextVNum = message.versions.length + 1;
        message.versions.push({
            version: nextVNum,
            content: newContent,
            timestamp: new Date().toISOString()
        });

        message.activeVersionIndex = message.versions.length - 1;
    }

    message.content = newContent;
    message.timestamp = new Date().toISOString();

    // 乌鸦：处理附件删除
    if (window._editingMsgRemovedAttachments && window._editingMsgRemovedAttachments.length > 0) {
        if (Array.isArray(message.attachments)) {
            // 乌鸦：从后往前删除，避免索引变化
            const sortedRemovedIndexes = window._editingMsgRemovedAttachments.sort((a, b) => b - a);
            sortedRemovedIndexes.forEach(idx => {
                message.attachments.splice(idx, 1);
            });
            // 乌鸦：如果没有附件了，删除整个数组
            if (message.attachments.length === 0) {
                delete message.attachments;
            }
        }
    }

    // 乌鸦：关闭模态框
    closeMessageEditModal();

    // 乌鸦：局部更新消息内容，避免页面跳动
    // 乌鸦：参考原始 events.js.final_fix.js 的实现方式进行局部更新
    const messageElement = document.querySelector(`.message-bubble[data-index="${index}"]`);
    if (messageElement) {
        const contentEl = messageElement.querySelector('.message-content');
        if (contentEl) {
            // 乌鸦：重新渲染消息内容
            const formattedHtml = await formatMessagePipeline(newContent, message.role);
            renderFormattedContent(contentEl, formattedHtml);

            // 乌鸦：更新消息底部信息
            addOrUpdateMessageFooter(messageElement, message);

            // 乌鸦：更新操作按钮
            const actionsEl = messageElement.querySelector('.message-actions');
            if (actionsEl) {
                updateMessageActions(actionsEl, message, index);
            }
        }
    }

    // 乌鸦：改造 - 直接调用单个会话保存
    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (conv) {
        await saveConversation(convId, conv);
    }
}

/**
 * 乌鸦：关闭文件查看器
 */
function closeFileViewer() {
    if (dom.fileViewerModal) {
        dom.fileViewerModal.classList.remove('visible');
        dom.fileViewerModal.style.display = 'none';
        // 乌鸦：清空内容，释放可能的资源
        if (dom.fileViewerContent) {
            dom.fileViewerContent.innerHTML = '';
        }
        if (dom.fileViewerTitle) {
            dom.fileViewerTitle.textContent = '';
        }
    }
}