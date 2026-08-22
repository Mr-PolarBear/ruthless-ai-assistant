/**
 * @file modal-events.js
 * @description Handles all modal-related events including opening, closing, and form submissions.
 */

import { dom } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { processAndFilterMessages, getWorldBookContent, buildApiRequest } from './api-common.js?v=260820-1';
import {
    openSettingsModal, closeSettingsModal, openPersonaModal, openWorldBookModal,
    openApiEditModal, closeApiEditModal, openPersonaEditModal, closePersonaEditModal,
    openMessageEditModal, closeMessageEditModal, closeCropModal, closeConvAvatarCropModal,
    openAvatarPreview, closeAvatarPreview, openConversationAvatarModal, closeConversationAvatarModal,
    openQuickHideModal, closeQuickHideModal, closeConvTitleModal, setupConvTitleModalEvents,
    closeExportConvModal, setupExportConvModalEvents
} from './modals.js?v=260820-1';
import { closeExportConfigModal } from './modals/export-config-modal.js?v=260820-1';
import {
    renderChatMessages,
    populateApiSelector,
    populatePersonaSelector,
    formatMessagePipeline,
    renderFormattedContent
} from './renderer.js?v=260820-1';
import {
    saveToLocalStorage,
    importConfig,
    importConversations,
    calculateConversationStats,
    countTokens,
    escapeHtml,
    showImportTemplate,
    fallbackCopyText
} from './utils.js?v=260820-1';
import { showLoadingOverlay, hideLoadingOverlay, notify, updateSummaryEditorLockState } from './ui-updater.js?v=260820-1';
import { addOrUpdateMessageFooter, updateMessageActions } from './message-manager.js?v=260820-1';
import { switchToConversation, setHideSummaryForCurrentConversation, getHideSummaryForCurrentConversation, getHideSummaryForConversation, setHideSummaryForConversation } from './main.js?v=260820-1';
import { saveConversation } from './db.js?v=260820-1';
import { closeSidebarMobile } from './ui-events.js?v=260820-1';
import {
    DEFAULT_PROMPT_RECURSIVE,
    DEFAULT_PROMPT_APPEND,
    DEFAULT_PROMPT_TABLE,
    DEFAULT_SUMMARY_PROMPT,
    getDefaultPromptForMode,
    normalizeHideSummaryConfig,
    formatSummaryListToText,
    formatTablesToMarkdown,
    parseMarkdownTables,
    getVisibleMessagesForSummary,
    generateSummaryApiCall,
    applySummaryResult,
    recordSummaryVersion,
    autoSummaryContext,
    formatHiddenFloorsBannerInfo
} from './summary-manager.js?v=260820-1';
import { initSummaryHistoryModal, updateHideSummaryHistoryCount } from './modals/summary-history-modal.js?v=260820-1';
import { initSimulateSendModal } from './modals/simulate-send-modal.js?v=260820-1';
import { setupBranchSummaryConfirmModal } from './modals/branch-summary-confirm-modal.js?v=260820-1';

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

    // 分叉重发与记忆联动确认弹窗
    setupBranchSummaryConfirmModal();
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
                case 'export-config-modal':
                    closeModalWithAnimation(modal, closeExportConfigModal);
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

    let currentMemoryMode = 'recursive';
    let currentTableSubtab = 'history'; // 'history' | 'character'
    let isTableRawMode = false;
    let currentTableRowLines = parseInt(localStorage.getItem('ruthless_summary_table_row_lines'), 10) || 3;

    function updateClearBtnState(isUndo) {
        if (!dom.hideSummaryClearBtn) return;
        if (isUndo) {
            dom.hideSummaryClearBtn.textContent = '撤销清空';
            dom.hideSummaryClearBtn.title = '点击撤销清空操作，恢复上一次的记忆内容';
            dom.hideSummaryClearBtn.dataset.isUndo = '1';
            dom.hideSummaryClearBtn.classList.remove('cancel-button');
            dom.hideSummaryClearBtn.classList.add('action-button');
        } else {
            dom.hideSummaryClearBtn.textContent = '清空当前记忆';
            dom.hideSummaryClearBtn.title = '清空当前记忆内容（可随时撤销）';
            dom.hideSummaryClearBtn.dataset.isUndo = '0';
            dom.hideSummaryClearBtn.classList.remove('action-button');
            dom.hideSummaryClearBtn.classList.add('cancel-button');
        }
    }

    function updateHideSummaryCharCounters() {
        if (dom.hideSummaryPrompt && dom.hideSummaryPromptCharCounter) {
            dom.hideSummaryPromptCharCounter.textContent = `${dom.hideSummaryPrompt.value.length} 字`;
        }
        if (dom.hideSummaryResult && dom.hideSummaryResultCharCounter) {
            dom.hideSummaryResultCharCounter.textContent = `${dom.hideSummaryResult.value.length} 字`;
        }
    }

    // 渲染模式 2 卡片流列表
    function renderAppendCardsList(summaryList = []) {
        if (!dom.summaryAppendCardsList) return;
        if (dom.summaryAppendCount) dom.summaryAppendCount.textContent = summaryList.length;

        if (summaryList.length === 0) {
            dom.summaryAppendCardsList.innerHTML = '<div class="summary-append-empty">暂无记忆片段，可点击【立即总结】或手动【新增片段】</div>';
            return;
        }

        dom.summaryAppendCardsList.innerHTML = '';
        summaryList.forEach((item, index) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'summary-append-card';
            cardEl.innerHTML = `
                <div class="summary-append-card-header">
                    <div>
                        <span class="summary-append-card-badge">${index + 1}</span>
                        <strong class="summary-append-card-title">${escapeHtml(item.floorRange || `片段 ${index + 1}`)}</strong>
                        <span class="summary-append-card-time">${escapeHtml(item.time || '')}</span>
                    </div>
                    <div class="summary-append-card-actions">
                        <button type="button" class="summary-append-card-edit-btn" title="编辑内容">✏️</button>
                        <button type="button" class="summary-append-card-del-btn" title="删除片段">🗑️</button>
                    </div>
                </div>
                <div class="summary-append-card-content">${escapeHtml(item.content || '')}</div>
            `;

            // 编辑单张卡片
            cardEl.querySelector('.summary-append-card-edit-btn').addEventListener('click', () => {
                const newContent = prompt('编辑记忆片段内容：', item.content || '');
                if (newContent !== null) {
                    item.content = newContent.trim();
                    const convId = state.currentConversationId;
                    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
                    config.summaryList = summaryList;
                    setHideSummaryForCurrentConversation(config);
                    renderAppendCardsList(summaryList);
                }
            });

            // 删除单张卡片
            cardEl.querySelector('.summary-append-card-del-btn').addEventListener('click', () => {
                if (confirm(`确定要删除第 ${index + 1} 个记忆片段吗？`)) {
                    summaryList.splice(index, 1);
                    const convId = state.currentConversationId;
                    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
                    config.summaryList = summaryList;
                    setHideSummaryForCurrentConversation(config);
                    renderAppendCardsList(summaryList);
                    updateHideSummaryCharCounters();
                }
            });

            dom.summaryAppendCardsList.appendChild(cardEl);
        });
    }

    // 渲染模式 3 可视化双表格
    function renderTableGrid(tableData = { eventHistory: [], characterInfo: [] }) {
        if (!dom.summaryTableHistoryTbody || !dom.summaryTableCharacterTbody) return;

        // 1. 渲染历史记录表
        dom.summaryTableHistoryTbody.innerHTML = '';
        const events = Array.isArray(tableData.eventHistory) ? tableData.eventHistory : [];
        if (events.length === 0) {
            dom.summaryTableHistoryTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:14px;">暂无历史记录，可点击上方【➕ 添加行】或【立即总结】</td></tr>';
        } else {
            events.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><textarea class="summary-table-cell-input" data-col="time" rows="${currentTableRowLines}" title="${escapeHtml(row.time || '')}" placeholder="时间">${escapeHtml(row.time || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="location" rows="${currentTableRowLines}" title="${escapeHtml(row.location || '')}" placeholder="地点">${escapeHtml(row.location || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="characters" rows="${currentTableRowLines}" title="${escapeHtml(row.characters || '')}" placeholder="涉及角色">${escapeHtml(row.characters || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="event" rows="${currentTableRowLines}" title="${escapeHtml(row.event || '')}" placeholder="事件描述">${escapeHtml(row.event || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="items" rows="${currentTableRowLines}" title="${escapeHtml(row.items || '')}" placeholder="物品/道具">${escapeHtml(row.items || '')}</textarea></td>
                    <td style="text-align:center;"><button type="button" class="summary-table-row-del-btn" title="删除此行">🗑️</button></td>
                `;

                tr.querySelectorAll('.summary-table-cell-input').forEach(inp => {
                    inp.addEventListener('input', () => {
                        row[inp.dataset.col] = inp.value;
                        inp.title = inp.value;
                    });
                });

                tr.querySelector('.summary-table-row-del-btn').addEventListener('click', () => {
                    events.splice(idx, 1);
                    tableData.eventHistory = events;
                    renderTableGrid(tableData);
                });

                dom.summaryTableHistoryTbody.appendChild(tr);
            });
        }

        // 2. 渲染角色信息表
        dom.summaryTableCharacterTbody.innerHTML = '';
        const chars = Array.isArray(tableData.characterInfo) ? tableData.characterInfo : [];
        if (chars.length === 0) {
            dom.summaryTableCharacterTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:14px;">暂无角色信息，可点击上方【➕ 添加行】或【立即总结】</td></tr>';
        } else {
            chars.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><textarea class="summary-table-cell-input" data-col="name" rows="${currentTableRowLines}" title="${escapeHtml(row.name || '')}" placeholder="姓名">${escapeHtml(row.name || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="bio" rows="${currentTableRowLines}" title="${escapeHtml(row.bio || '')}" placeholder="简介/身份">${escapeHtml(row.bio || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="status" rows="${currentTableRowLines}" title="${escapeHtml(row.status || '')}" placeholder="最新状态说明">${escapeHtml(row.status || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="items" rows="${currentTableRowLines}" title="${escapeHtml(row.items || '')}" placeholder="持有关键道具">${escapeHtml(row.items || '')}</textarea></td>
                    <td style="text-align:center;"><button type="button" class="summary-table-row-del-btn" title="删除此行">🗑️</button></td>
                `;

                tr.querySelectorAll('.summary-table-cell-input').forEach(inp => {
                    inp.addEventListener('input', () => {
                        row[inp.dataset.col] = inp.value;
                        inp.title = inp.value;
                    });
                });

                tr.querySelector('.summary-table-row-del-btn').addEventListener('click', () => {
                    chars.splice(idx, 1);
                    tableData.characterInfo = chars;
                    renderTableGrid(tableData);
                });

                dom.summaryTableCharacterTbody.appendChild(tr);
            });
        }
    }

    // 切换模式并刷新所有子视图
    function switchMode(mode, save = true) {
        currentMemoryMode = mode;
        const convId = state.currentConversationId;
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        data.memoryMode = mode;

        // 1. 切换模式选项卡高亮
        if (dom.summaryModeTabsBtns) {
            dom.summaryModeTabsBtns.forEach(btn => {
                if (btn.dataset.mode === mode) btn.classList.add('active');
                else btn.classList.remove('active');
            });
        }

        // 2. 切换提示词与标签
        if (dom.hideSummaryPromptLabel) {
            if (mode === 'recursive') dom.hideSummaryPromptLabel.textContent = '总结提示词 (递归滚动专属)';
            else if (mode === 'append') dom.hideSummaryPromptLabel.textContent = '总结提示词 (列表拼接专属)';
            else if (mode === 'table') dom.hideSummaryPromptLabel.textContent = '总结提示词 (跑团双表专属)';
        }
        if (dom.hideSummaryPrompt) {
            dom.hideSummaryPrompt.value = data.prompts?.[mode] || getDefaultPromptForMode(mode);
        }

        // 3. 切换视图容器
        if (dom.summaryModeRecursiveView) dom.summaryModeRecursiveView.style.display = (mode === 'recursive' ? 'block' : 'none');
        if (dom.summaryModeAppendView) dom.summaryModeAppendView.style.display = (mode === 'append' ? 'block' : 'none');
        if (dom.summaryModeTableView) dom.summaryModeTableView.style.display = (mode === 'table' ? 'block' : 'none');

        // 4. 刷新各模式的具体内容展示
        if (mode === 'recursive') {
            if (dom.hideSummaryResult) dom.hideSummaryResult.value = data.summary || '';
        } else if (mode === 'append') {
            renderAppendCardsList(data.summaryList || []);
        } else if (mode === 'table') {
            renderTableGrid(data.tableData);
            if (dom.summaryTableRawTextarea) {
                dom.summaryTableRawTextarea.value = formatTablesToMarkdown(data.tableData.eventHistory, data.tableData.characterInfo);
            }
        }

        if (save) {
            setHideSummaryForCurrentConversation({ memoryMode: mode });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
        }

        updateHideSummaryCharCounters();
    }

    /**
     * 刷新总结弹窗内的 Token 状态概览与当前已隐藏楼层明细展示
     * @param {string} convId - 会话ID
     */
    function updateHideSummaryBannerAndStats(convId = state.currentConversationId) {
        if (!convId) return;
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        const conv = state.conversations[convId];
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
                const info = formatHiddenFloorsBannerInfo(hiddenFloors);
                dom.hideSummaryHiddenFloorsText.textContent = info.mainText;

                if (dom.hideSummaryUnhiddenFloorsRow) {
                    if (info.hasUnhiddenRow && info.unhiddenRanges && info.unhiddenRanges.length > 0) {
                        dom.hideSummaryUnhiddenFloorsRow.style.display = 'flex';
                        if (dom.hideSummaryUnhiddenFloorsText) {
                            dom.hideSummaryUnhiddenFloorsText.innerHTML = '';
                            info.unhiddenRanges.forEach(([start, end]) => {
                                const badge = document.createElement('span');
                                badge.className = 'unhidden-floor-badge';
                                badge.textContent = (start === end ? `第 ${start} 楼` : `第 ${start} ~ ${end} 楼`);
                                dom.hideSummaryUnhiddenFloorsText.appendChild(badge);
                            });
                        }
                    } else {
                        dom.hideSummaryUnhiddenFloorsRow.style.display = 'none';
                        if (dom.hideSummaryUnhiddenFloorsText) {
                            dom.hideSummaryUnhiddenFloorsText.innerHTML = '';
                        }
                    }
                }
            }
        }
    }

    // 暴露供外部或后台自动总结完成后主动刷新的接口
    window.refreshHideSummaryModalViews = () => {
        const convId = state.currentConversationId;
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        updateHideSummaryBannerAndStats(convId);
        switchMode(data.memoryMode || 'recursive', false);
        updateHideSummaryHistoryCount();
        if (dom.hideSummaryEnable) {
            dom.hideSummaryEnable.checked = !!data.enabled;
        }
        updateSummaryEditorLockState();
        updateHideSummaryCharCounters();
    };

    // — 为什么这么写 —
    // 监听后台自动总结的实时流式输出与完成事件。
    // 当用户打开总结弹窗时，即便后台正在自动总结，弹窗内也能实时看到打字机流式进度，并在总结完成后即时刷新隐藏楼层与所有模式视图。
    autoSummaryContext.listeners.add({
        onChunk: (delta, fullText) => {
            if (dom.hideSummaryModal && dom.hideSummaryModal.style.display !== 'none' && state.currentConversationId === autoSummaryContext.convId) {
                if (currentMemoryMode === 'recursive' && dom.hideSummaryResult) {
                    dom.hideSummaryResult.value = fullText;
                    dom.hideSummaryResult.scrollTop = dom.hideSummaryResult.scrollHeight;
                    updateHideSummaryCharCounters();
                } else if (currentMemoryMode === 'table' && dom.summaryTableRawTextarea && dom.summaryTableRawWrapper && dom.summaryTableRawWrapper.style.display !== 'none') {
                    dom.summaryTableRawTextarea.value = fullText;
                    dom.summaryTableRawTextarea.scrollTop = dom.summaryTableRawTextarea.scrollHeight;
                    updateHideSummaryCharCounters();
                }
            }
        },
        onFinish: () => {
            if (dom.hideSummaryModal && dom.hideSummaryModal.style.display !== 'none') {
                if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
            }
        },
        onError: () => {
            if (dom.hideSummaryModal && dom.hideSummaryModal.style.display !== 'none') {
                updateSummaryEditorLockState();
            }
        }
    });

    // 绑定 3 种记忆模式 Tab 切换事件
    if (dom.summaryModeTabsBtns) {
        dom.summaryModeTabsBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode && mode !== currentMemoryMode) {
                    switchMode(mode, true);
                }
            });
        });
    }

    // 恢复该模式默认提示词按钮
    if (dom.hideSummaryResetPromptBtn) {
        dom.hideSummaryResetPromptBtn.addEventListener('click', () => {
            const defaultPrompt = getDefaultPromptForMode(currentMemoryMode);
            if (dom.hideSummaryPrompt) {
                dom.hideSummaryPrompt.value = defaultPrompt;
                updateHideSummaryCharCounters();
            }
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            if (!config.prompts) config.prompts = {};
            config.prompts[currentMemoryMode] = defaultPrompt;
            setHideSummaryForCurrentConversation(config);
            notify.success(`已恢复【${currentMemoryMode === 'recursive' ? '递归滚动' : currentMemoryMode === 'append' ? '列表拼接' : '跑团双表'}】官方默认提示词`);
        });
    }

    // 模式 2：新增记忆片段
    if (dom.summaryAppendAddBtn) {
        dom.summaryAppendAddBtn.addEventListener('click', () => {
            const text = prompt('请输入要新增的记忆摘要内容：');
            if (text && text.trim()) {
                const convId = state.currentConversationId;
                const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
                const now = new Date();
                const pad = n => String(n).padStart(2, '0');
                const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                
                const newChunk = {
                    id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    time: timeStr,
                    floorRange: '手动记录',
                    content: text.trim()
                };
                config.summaryList = [...(config.summaryList || []), newChunk];
                setHideSummaryForCurrentConversation(config);
                renderAppendCardsList(config.summaryList);
                notify.success('✨ 已成功添加记忆片段！');
            }
        });
    }

    // 模式 3：双表格子 Tab 切换（历史记录表 / 角色信息表）
    if (dom.summaryTableSubtabs) {
        dom.summaryTableSubtabs.forEach(tab => {
            tab.addEventListener('click', () => {
                dom.summaryTableSubtabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentTableSubtab = tab.dataset.table;

                if (currentTableSubtab === 'history') {
                    if (dom.summaryTableHistoryWrapper) dom.summaryTableHistoryWrapper.style.display = 'block';
                    if (dom.summaryTableCharacterWrapper) dom.summaryTableCharacterWrapper.style.display = 'none';
                } else {
                    if (dom.summaryTableHistoryWrapper) dom.summaryTableHistoryWrapper.style.display = 'none';
                    if (dom.summaryTableCharacterWrapper) dom.summaryTableCharacterWrapper.style.display = 'block';
                }
            });
        });
    }

    // 模式 3：添加行按钮
    if (dom.summaryTableAddRowBtn) {
        dom.summaryTableAddRowBtn.addEventListener('click', () => {
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            if (!config.tableData) config.tableData = { eventHistory: [], characterInfo: [] };

            if (currentTableSubtab === 'history') {
                config.tableData.eventHistory.push({
                    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    time: '',
                    location: '',
                    characters: '',
                    event: '',
                    items: ''
                });
            } else {
                config.tableData.characterInfo.push({
                    id: `chr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    name: '',
                    bio: '',
                    status: '',
                    items: ''
                });
            }

            renderTableGrid(config.tableData);
            if (dom.summaryTableRawTextarea) {
                dom.summaryTableRawTextarea.value = formatTablesToMarkdown(config.tableData.eventHistory, config.tableData.characterInfo);
            }
        });
    }

    // 模式 3：Markdown 源码视图与表格视图双向切换
    if (dom.summaryTableRawToggleBtn) {
        dom.summaryTableRawToggleBtn.addEventListener('click', () => {
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

            if (!isTableRawMode) {
                // 进入源码模式：序列化当前表格为 Markdown
                isTableRawMode = true;
                dom.summaryTableRawToggleBtn.textContent = '📊 表格模式';
                dom.summaryTableRawToggleBtn.classList.add('primary');
                if (dom.summaryTableGridContainer) dom.summaryTableGridContainer.style.display = 'none';
                if (dom.summaryTableRawWrapper) dom.summaryTableRawWrapper.style.display = 'block';
                if (dom.summaryTableRawTextarea) {
                    dom.summaryTableRawTextarea.value = formatTablesToMarkdown(config.tableData.eventHistory, config.tableData.characterInfo);
                }
            } else {
                // 切回表格模式：反解析 Markdown 为表格对象
                isTableRawMode = false;
                dom.summaryTableRawToggleBtn.textContent = '📝 源码模式';
                dom.summaryTableRawToggleBtn.classList.remove('primary');
                if (dom.summaryTableRawWrapper) dom.summaryTableRawWrapper.style.display = 'none';
                if (dom.summaryTableGridContainer) dom.summaryTableGridContainer.style.display = 'block';

                if (dom.summaryTableRawTextarea) {
                    const parsed = parseMarkdownTables(dom.summaryTableRawTextarea.value);
                    config.tableData = parsed;
                    setHideSummaryForCurrentConversation(config);
                    renderTableGrid(config.tableData);
                }
            }
        });
    }

    // 模式 3：表格放大/全屏编辑窗口切换
    let isTableExpanded = false;
    function setTableExpanded(expanded) {
        isTableExpanded = typeof expanded === 'boolean' ? expanded : !isTableExpanded;
        if (!dom.hideSummaryModal) return;
        if (isTableExpanded) {
            dom.hideSummaryModal.classList.add('table-expanded');
            if (dom.summaryTableExpandBtn) {
                dom.summaryTableExpandBtn.innerHTML = '🗗 还原窗口';
                dom.summaryTableExpandBtn.classList.add('primary');
            }
        } else {
            dom.hideSummaryModal.classList.remove('table-expanded');
            if (dom.summaryTableExpandBtn) {
                dom.summaryTableExpandBtn.innerHTML = '⛶ 放大编辑';
                dom.summaryTableExpandBtn.classList.remove('primary');
            }
        }
    }

    if (dom.summaryTableExpandBtn) {
        dom.summaryTableExpandBtn.addEventListener('click', () => {
            setTableExpanded();
        });
    }

    // 模式 3：单元格默认展示行数变动监听
    if (dom.summaryTableRowLinesSelect) {
        dom.summaryTableRowLinesSelect.value = currentTableRowLines.toString();
        dom.summaryTableRowLinesSelect.addEventListener('change', () => {
            currentTableRowLines = parseInt(dom.summaryTableRowLinesSelect.value, 10) || 3;
            localStorage.setItem('ruthless_summary_table_row_lines', currentTableRowLines.toString());
            // 即时应用到当前弹窗内所有已渲染的单元格 textarea 上
            const cellInputs = dom.hideSummaryModal.querySelectorAll('.summary-table-cell-input');
            cellInputs.forEach(cell => {
                cell.rows = currentTableRowLines;
            });
        });
    }

    // 点击顶栏总结按钮打开弹窗
    dom.hideSummaryBtn.addEventListener('click', () => {
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (dom.summaryTableRowLinesSelect) {
            dom.summaryTableRowLinesSelect.value = currentTableRowLines.toString();
        }
        const convId = state.currentConversationId;
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

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

        // 刷新 Token 概览与隐藏楼层状态
        updateHideSummaryBannerAndStats(convId);

        // 切换模式并渲染对应视图
        switchMode(data.memoryMode || 'recursive', false);

        // 若当前后台正在自动总结该会话，且已有流式文本，直接载入最新流式进度
        if (state.isAutoSummarizing && autoSummaryContext.convId === convId && autoSummaryContext.currentStreamText) {
            if (data.memoryMode === 'recursive' && dom.hideSummaryResult) {
                dom.hideSummaryResult.value = autoSummaryContext.currentStreamText;
                dom.hideSummaryResult.scrollTop = dom.hideSummaryResult.scrollHeight;
            } else if (data.memoryMode === 'table' && dom.summaryTableRawTextarea && dom.summaryTableRawWrapper && dom.summaryTableRawWrapper.style.display !== 'none') {
                dom.summaryTableRawTextarea.value = autoSummaryContext.currentStreamText;
                dom.summaryTableRawTextarea.scrollTop = dom.summaryTableRawTextarea.scrollHeight;
            }
        }

        // 刷新历史版本数量角标
        updateHideSummaryHistoryCount();

        // 检查 AI 输出锁定状态
        updateSummaryEditorLockState();

        // 总结回滚状态检查
        const hasBackup = !!summaryBackupHistory[convId];
        updateClearBtnState(hasBackup);

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
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

            if (isUndo) {
                // 撤销回滚备份
                const backup = summaryBackupHistory[convId];
                if (backup) {
                    if (config.memoryMode === 'recursive') {
                        config.summary = backup.summary || '';
                        if (dom.hideSummaryResult) dom.hideSummaryResult.value = config.summary;
                    } else if (config.memoryMode === 'append') {
                        config.summaryList = backup.summaryList || [];
                        renderAppendCardsList(config.summaryList);
                    } else if (config.memoryMode === 'table') {
                        config.tableData = backup.tableData || { eventHistory: [], characterInfo: [] };
                        renderTableGrid(config.tableData);
                    }

                    setHideSummaryForCurrentConversation(config);
                    updateHideSummaryCharCounters();
                    updateClearBtnState(false);
                    notify.success('✨ 已成功恢复记忆内容！');
                } else {
                    notify.warning('未找到可回滚的记忆备份');
                    updateClearBtnState(false);
                }
            } else {
                // 清空前先备份当前数据
                summaryBackupHistory[convId] = {
                    summary: config.summary,
                    summaryList: JSON.parse(JSON.stringify(config.summaryList || [])),
                    tableData: JSON.parse(JSON.stringify(config.tableData || { eventHistory: [], characterInfo: [] }))
                };

                if (config.memoryMode === 'recursive') {
                    config.summary = '';
                    if (dom.hideSummaryResult) dom.hideSummaryResult.value = '';
                } else if (config.memoryMode === 'append') {
                    config.summaryList = [];
                    renderAppendCardsList([]);
                } else if (config.memoryMode === 'table') {
                    config.tableData = { eventHistory: [], characterInfo: [] };
                    renderTableGrid(config.tableData);
                    if (dom.summaryTableRawTextarea) dom.summaryTableRawTextarea.value = '';
                }

                setHideSummaryForCurrentConversation(config);
                updateHideSummaryCharCounters();
                updateClearBtnState(true);
                notify.info('已清空当前模式记忆（误操作可点击【撤销清空】恢复）');
            }
        });
    }

    dom.hideSummaryModal.querySelector('.modal-close-btn').addEventListener('click', () => {
        if (dom.hideSummaryStartBtn && dom.hideSummaryStartBtn.dataset.summarizing === '1') {
            const shouldClose = confirm('正在总结，是否停止并关闭弹窗？');
            if (!shouldClose) return;
            if (window._hideSummaryAbort) window._hideSummaryAbort.abort();
        }
        setTableExpanded(false);
        closeModalWithAnimation(dom.hideSummaryModal);
    });

    // 实时监听通用开关与参数变动并持久化
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
        dom.hideSummaryWithRole,
        dom.hideSummaryWithWorldBook
    ];

    summaryInputsToSave.forEach(input => {
        if (!input) return;
        input.addEventListener('change', () => {
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

            config.enabled = dom.hideSummaryEnable.checked;
            config.autoSummaryEnabled = dom.autoSummaryEnable ? dom.autoSummaryEnable.checked : false;
            config.autoSummaryType = (dom.autoSummaryTypeTokens && dom.autoSummaryTypeTokens.checked) ? 'tokens' : 'floors';
            config.autoSummaryFloorInterval = parseInt(dom.autoSummaryFloorInterval?.value, 10) || 10;
            config.autoSummaryTokenThreshold = parseInt(dom.autoSummaryTokenThreshold?.value, 10) || 4000;
            config.dropSummarizedFloors = dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true;
            config.keepRecentFloors = dom.autoSummaryKeepRecent ? dom.autoSummaryKeepRecent.checked : true;
            config.keepRecentFloorsCount = parseInt(dom.autoSummaryKeepRecentCount?.value, 10) || 2;
            config.withRole = dom.hideSummaryWithRole.checked;
            config.withWorldBook = dom.hideSummaryWithWorldBook.checked;

            setHideSummaryForCurrentConversation(config);
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (input === dom.hideSummaryEnable) {
                renderChatMessages({ updateVisibilityOnly: true });
            }
        });
    });

    // 提示词输入监听（保存到当前模式对应的 prompts[currentMemoryMode]）
    if (dom.hideSummaryPrompt) {
        dom.hideSummaryPrompt.addEventListener('input', () => {
            updateHideSummaryCharCounters();
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            if (!config.prompts) config.prompts = {};
            config.prompts[currentMemoryMode] = dom.hideSummaryPrompt.value;
            config.prompt = dom.hideSummaryPrompt.value;
            setHideSummaryForCurrentConversation(config);
        });
    }

    if (dom.hideSummaryResult) {
        dom.hideSummaryResult.addEventListener('input', updateHideSummaryCharCounters);
    }
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

                const start = hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1;
                const end = hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1;

                setHideSummaryForCurrentConversation({
                    hiddenFloors,
                    start,
                    end
                });
                saveConversation(conv.id, conv);
                renderChatMessages({ updateVisibilityOnly: true });
                if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
                if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
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
                    end: Math.max(floor, ...hiddenFloors)
                });
                saveConversation(conv.id, conv);
                renderChatMessages({ updateVisibilityOnly: true });
                if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
                if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
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
                end: Math.max(...hiddenFloors)
            });
            saveConversation(conv.id, conv);
            renderChatMessages({ updateVisibilityOnly: true });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
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
                hiddenFloors: []
            });
            renderChatMessages({ updateVisibilityOnly: true });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
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

                        // 提取顶级全量 bundle 元数据（如全量导出的 worldBook 与 hideSummary 及 sessionRegexRules）
                        parsedBundleMetadata = {
                            worldBook: parsedData.worldBook || null,
                            hideSummary: parsedData.hideSummary || null,
                            sessionRegexRules: parsedData.sessionRegexRules || null
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
        dom.importConfigBtn.addEventListener('click', async () => {
            try {
                const success = await importConfig(dom.importConfigTextarea.value);
                if (success) {
                    dom.importConfigTextarea.value = '';
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
    const hideConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const visibleMessages = getVisibleMessagesForSummary(activeBranch, hideConfig);

    if (visibleMessages.length === 0) {
        alert('当前分支中没有可见（未隐藏）的消息可供总结。');
        return;
    }

    lastSummarizedItems = visibleMessages;
    const mode = hideConfig.memoryMode || 'recursive';
    const customPrompt = dom.hideSummaryPrompt.value.trim() || getDefaultPromptForMode(mode);
    if (!hideConfig.prompts) hideConfig.prompts = {};
    hideConfig.prompts[mode] = customPrompt;
    hideConfig.prompt = customPrompt;
    setHideSummaryForCurrentConversation(hideConfig);

    btn.textContent = '停止总结';
    btn.classList.add('summarizing');
    btn.dataset.summarizing = '1';

    if (mode === 'recursive' && dom.hideSummaryResult) {
        dom.hideSummaryResult.value = '';
    }
    updateSummaryEditorLockState();

    window._hideSummaryAbort = new AbortController();

    let finalSummaryText = '';
    try {
        await generateSummaryApiCall({
            convId,
            messagesToSummarize: visibleMessages,
            customPrompt,
            withRole: dom.hideSummaryWithRole.checked,
            withWorldBook: dom.hideSummaryWithWorldBook.checked,
            signal: window._hideSummaryAbort.signal,
            onChunk: (delta, fullText) => {
                finalSummaryText = fullText;
                if (mode === 'recursive' && dom.hideSummaryResult) {
                    dom.hideSummaryResult.value = fullText;
                    dom.hideSummaryResult.scrollTop = dom.hideSummaryResult.scrollHeight;
                } else if (mode === 'table' && dom.summaryTableRawTextarea && dom.summaryTableRawWrapper.style.display !== 'none') {
                    dom.summaryTableRawTextarea.value = fullText;
                    dom.summaryTableRawTextarea.scrollTop = dom.summaryTableRawTextarea.scrollHeight;
                }
                updateHideSummaryCharCounters();
            }
        });

        // 总结成功完成，自动应用并解析到对应模式的数据结构中
        if (finalSummaryText && finalSummaryText.trim()) {
            const dropFloors = dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true;
            await applySummaryResult(convId, finalSummaryText, visibleMessages, dropFloors, '手动总结');
            if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
            updateHideSummaryHistoryCount();
            notify.success('✨ 总结成功完成并已保存为记忆！');
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            if (mode === 'recursive' && dom.hideSummaryResult) {
                dom.hideSummaryResult.value += `\n\n[错误: ${error.message}]`;
            } else {
                notify.error(`总结失败: ${error.message}`);
            }
        } else {
            notify.info('总结已由用户停止');
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
    const convId = state.currentConversationId;
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const mode = config.memoryMode || 'recursive';
    const dropFloors = dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true;

    if (mode === 'recursive') {
        const summary = dom.hideSummaryResult.value;
        if (!summary.trim()) {
            alert('总结内容不能为空。');
            return;
        }
        await applySummaryResult(convId, summary, lastSummarizedItems, dropFloors, '手动保存');
    } else if (mode === 'append') {
        if (!config.summaryList || config.summaryList.length === 0) {
            alert('暂无记忆片段可保存。');
            return;
        }
        const text = formatSummaryListToText(config.summaryList);
        await applySummaryResult(convId, text, lastSummarizedItems, dropFloors, '手动保存');
    } else if (mode === 'table') {
        if (dom.summaryTableRawWrapper && dom.summaryTableRawWrapper.style.display !== 'none' && dom.summaryTableRawTextarea) {
            config.tableData = parseMarkdownTables(dom.summaryTableRawTextarea.value);
        }
        const tablesMd = formatTablesToMarkdown(config.tableData?.eventHistory, config.tableData?.characterInfo);
        if (!tablesMd.trim()) {
            alert('表格内容不能为空。');
            return;
        }
        const conv = state.conversations[convId];
        const activeBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex] : [];
        const currentHiddenFloors = activeBranch
            ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
            : (config.hiddenFloors || []);

        config.hiddenFloors = currentHiddenFloors;
        if (dom.hideSummaryEnable) {
            config.enabled = dom.hideSummaryEnable.checked;
        }
        setHideSummaryForCurrentConversation(config);
        recordSummaryVersion(convId, tablesMd, currentHiddenFloors, '手动保存');
        if (conv) await saveConversation(convId, conv);
        await saveToLocalStorage();
        renderChatMessages({ updateVisibilityOnly: true });
    }

    updateHideSummaryHistoryCount();
    if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
    if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
    notify.success('✨ 记忆已成功保存并应用！');
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