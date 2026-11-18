/**
 * @file modal-events.js
 * @description Handles all modal-related events including opening, closing, and form submissions.
 */

import { dom } from './dom.js?v=temp';
import { openSyncModal } from './modals/sync-modal.js?v=temp';
import { state } from './state.js?v=temp';
import { processAndFilterMessages, getWorldBookContent, buildApiRequest } from './api-common.js?v=temp';
import {
    openSettingsModal, closeSettingsModal, openPersonaModal, openWorldBookModal,
    openApiEditModal, closeApiEditModal, openPersonaEditModal, closePersonaEditModal,
    openMessageEditModal, closeMessageEditModal, closeCropModal, closeConvAvatarCropModal,
    openAvatarPreview, closeAvatarPreview, openConversationAvatarModal, closeConversationAvatarModal,
    openQuickHideModal, closeQuickHideModal, closeConvTitleModal, setupConvTitleModalEvents,
    closeExportConvModal, setupExportConvModalEvents
} from './modals.js?v=temp';
import { closeExportConfigModal } from './modals/export-config-modal.js?v=temp';
import {
    renderChatMessages,
    populateApiSelector,
    populatePersonaSelector,
    formatMessagePipeline,
    renderFormattedContent
} from './renderer.js?v=temp';
import {
    saveToLocalStorage,
    importConfig,
    importConversations,
    calculateConversationStats,
    countTokens,
    escapeHtml,
    showImportTemplate,
    fallbackCopyText
} from './utils.js?v=temp';
import { showLoadingOverlay, hideLoadingOverlay, notify, updateSummaryEditorLockState, updateSessionTokenBadge, updateHideSummaryBtnColor } from './ui-updater.js?v=temp';
import { addOrUpdateMessageFooter, updateMessageActions } from './message-manager.js?v=temp';
import { switchToConversation, setHideSummaryForCurrentConversation, getHideSummaryForCurrentConversation, getHideSummaryForConversation, setHideSummaryForConversation } from './main.js?v=temp';
import { saveConversation } from './db.js?v=temp';
import { closeSidebarMobile } from './ui-events.js?v=temp';
import { updateStoragePersistenceUI } from './services/storage-persistence.js?v=temp';
import { normalizeRealtimeConfig } from './services/realtime-mode.js?v=temp';
import {
    DEFAULT_PROMPT_RECURSIVE,
    DEFAULT_PROMPT_APPEND,
    DEFAULT_PROMPT_TABLE,
    DEFAULT_SUMMARY_PROMPT,
    getDefaultPromptForMode,
    isLegacyDefaultPrompt,
    upgradeLegacyDefaultPrompt,
    normalizeHideSummaryConfig,
    formatSummaryListToText,
    formatTablesToMarkdown,
    parseMarkdownTables,
    getVisibleMessagesForSummary,
    generateSummaryApiCall,
    applySummaryResult,
    recordSummaryVersion,
    autoSummaryContext,
    formatHiddenFloorsBannerInfo,
    calculateAutoSummaryFloorProgress,
    hasValidSummaryContent,
    calculateAutoSummaryTokenProgress,
    resolvePendingSummaryError,
    getSnapshotFullText
} from './summary-manager.js?v=temp';
import { initSummaryHistoryModal, updateHideSummaryHistoryCount } from './modals/summary-history-modal.js?v=temp';
import { initSummaryCondenseModal, closeSummaryCondenseModal } from './modals/summary-condense-modal.js?v=temp';
import { initSimulateSendModal } from './modals/simulate-send-modal.js?v=temp';
import { setupBranchSummaryConfirmModal } from './modals/branch-summary-confirm-modal.js?v=temp';
import { setupLoadAllConfirmModal } from './modals/load-all-confirm-modal.js?v=temp';
import { openSummaryCardEditModal, setupSummaryCardEditModalEvents } from './modals/summary-card-edit-modal.js?v=temp';
import {
    openSummaryExecutionConfirmModal,
    openSummaryExecutionCompleteModal,
    setupSummaryExecutionModalEvents
} from './modals/summary-execution-modal.js?v=temp';
import { initRealtimeModal, openRealtimeModal, closeRealtimeModal } from './modals/realtime-modal.js?v=temp';

let handleHideSummaryModalClose = null;
let currentMemoryMode = 'recursive';

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
        updateStoragePersistenceUI();
    };

    if (dom.settingsBtn) dom.settingsBtn.addEventListener('click', handleOpenSettings);
    if (dom.topSettingsBtn) dom.topSettingsBtn.addEventListener('click', handleOpenSettings);
    const handleOpenSync = () => {
        if (window.innerWidth <= 768) {
            closeSidebarMobile();
        }
        openSyncModal();
    };
    if (dom.topSyncBtn) dom.topSyncBtn.addEventListener('click', handleOpenSync);
    window.openSyncModal = openSyncModal;

    // Modal close buttons
    setupModalCloseButtons();

    // Settings modal tabs
    setupSettingsTabs();

    // Hide & Summary modal
    setupHideSummaryModal();
    setupSummaryFormatErrorModalEvents();
    setupSummaryCardEditModalEvents();
    setupSummaryExecutionModalEvents();

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

    // 记忆二次浓缩与精炼双栏对比弹窗
    initSummaryCondenseModal();

    // 分叉重发与记忆联动确认弹窗
    setupBranchSummaryConfirmModal();

    // 全量渲染与加载全部消息确认弹窗
    setupLoadAllConfirmModal();

    // 实时模式与虚拟历法弹窗
    initRealtimeModal();
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
                    if (typeof handleHideSummaryModalClose === 'function') {
                        handleHideSummaryModalClose();
                    } else {
                        closeModalWithAnimation(dom.hideSummaryModal);
                    }
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
                case 'mcp-error-modal':
                    closeModalWithAnimation(modal, () => {
                        import('./modals/mcp-error-modal.js?v=temp').then(m => m.closeMcpErrorModal());
                    });
                    break;
                case 'summary-condense-modal':
                    closeSummaryCondenseModal();
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

            // — 为什么这么写 —
            // 在移动端窄屏单行横向滑动的标签栏中，点击某个标签时平滑将其居中滑入可视区域，提升触屏操作流畅度
            try {
                tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            } catch (_) {}

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

    currentMemoryMode = 'recursive';
    let currentTableSubtab = 'history'; // 'history' | 'character'
    let isTableRawMode = false;
    let currentTableRowLines = parseInt(localStorage.getItem('ruthless_summary_table_row_lines'), 10) || 3;
    let currentSummaryList = [];
    let currentTableData = { eventHistory: [], characterInfo: [] };

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

    // — 为什么这么写 —
    // 动态提取当前激活记忆视图中大模型实际会收到的完整记忆文本：
    // 1. 递归模式：直接读取当前文本框的输入内容；
    // 2. 列表拼接模式：将当前卡片流按阶段序列化为拼接列表文本；
    // 3. 结构双表模式：源码模式直接读 textarea，可视化模式将当前 tableData 格式化为标准 Markdown 表格。
    function getMemoryContentForCurrentView() {
        if (currentMemoryMode === 'recursive') {
            return dom.hideSummaryResult ? dom.hideSummaryResult.value : '';
        } else if (currentMemoryMode === 'append') {
            return formatSummaryListToText(currentSummaryList);
        } else if (currentMemoryMode === 'table') {
            if (isTableRawMode && dom.summaryTableRawTextarea) {
                return dom.summaryTableRawTextarea.value;
            }
            return formatTablesToMarkdown(currentTableData.eventHistory, currentTableData.characterInfo);
        }
        return '';
    }

    function updateHideSummaryCharCounters() {
        if (dom.hideSummaryPrompt && dom.hideSummaryPromptCharCounter) {
            dom.hideSummaryPromptCharCounter.textContent = `${dom.hideSummaryPrompt.value.length} 字`;
        }
        if (dom.hideSummaryResult && dom.hideSummaryResultCharCounter) {
            const resLen = dom.hideSummaryResult.value.length;
            const resTokens = countTokens(dom.hideSummaryResult.value);
            dom.hideSummaryResultCharCounter.textContent = `${resLen} 字 · 预估 ${resTokens} Tokens`;
        }
        if (dom.summaryMemoryTotalBadge) {
            const memoryText = getMemoryContentForCurrentView();
            const charCount = memoryText.length;
            const tokenCount = countTokens(memoryText);

            dom.summaryMemoryTotalBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>${charCount.toLocaleString()} 字符 · 预估 ${tokenCount.toLocaleString()} Tokens`;
            if (charCount > 0) {
                dom.summaryMemoryTotalBadge.classList.add('has-content');
            } else {
                dom.summaryMemoryTotalBadge.classList.remove('has-content');
            }
        }
    }

    // 渲染模式 2 卡片流列表
    function renderAppendCardsList(summaryList = []) {
        currentSummaryList = summaryList;
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
                        <span class="summary-append-card-badge" title="第 ${index + 1} 行">#${index + 1}</span>
                        <strong class="summary-append-card-title">${escapeHtml(item.floorRange || `片段 ${index + 1}`)}</strong>
                        <span class="summary-append-card-time">${escapeHtml(item.time || '')}</span>
                    </div>
                    <div class="summary-append-card-actions">
                        <button type="button" class="summary-append-card-edit-btn" title="编辑内容"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg></button>
                        <button type="button" class="summary-append-card-del-btn" title="删除片段"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </div>
                </div>
                <div class="summary-append-card-content">${escapeHtml(item.content || '')}</div>
            `;

            // 编辑单张卡片（多行模态编辑弹窗，彻底淘汰原生 prompt）
            cardEl.querySelector('.summary-append-card-edit-btn').addEventListener('click', () => {
                openSummaryCardEditModal({
                    mode: 'edit',
                    index,
                    item,
                    summaryList,
                    onSave: (updatedItem) => {
                        summaryList[index] = updatedItem;
                        const convId = state.currentConversationId;
                        const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
                        config.summaryList = summaryList;
                        setHideSummaryForCurrentConversation(config);
                        renderAppendCardsList(summaryList);
                        updateHideSummaryCharCounters();
                        notify.success('✨ 记忆片段已更新！');
                    }
                });
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
        currentTableData = tableData;
        if (!dom.summaryTableHistoryTbody || !dom.summaryTableCharacterTbody) return;

        // 1. 渲染历史记录表
        dom.summaryTableHistoryTbody.innerHTML = '';
        const events = Array.isArray(tableData.eventHistory) ? tableData.eventHistory : [];
        if (events.length === 0) {
            dom.summaryTableHistoryTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:14px;">暂无历史记录，可点击上方【添加行】或【立即总结】</td></tr>';
        } else {
            events.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="summary-table-row-index" title="第 ${idx + 1} 行">${idx + 1}</td>
                    <td><textarea class="summary-table-cell-input" data-col="time" rows="${currentTableRowLines}" title="${escapeHtml(row.time || '')}" placeholder="时间">${escapeHtml(row.time || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="location" rows="${currentTableRowLines}" title="${escapeHtml(row.location || '')}" placeholder="地点">${escapeHtml(row.location || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="characters" rows="${currentTableRowLines}" title="${escapeHtml(row.characters || '')}" placeholder="涉及角色">${escapeHtml(row.characters || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="event" rows="${currentTableRowLines}" title="${escapeHtml(row.event || '')}" placeholder="事件描述">${escapeHtml(row.event || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="items" rows="${currentTableRowLines}" title="${escapeHtml(row.items || '')}" placeholder="物品/道具">${escapeHtml(row.items || '')}</textarea></td>
                    <td style="text-align:center;"><button type="button" class="summary-table-row-del-btn" title="删除此行"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></td>
                `;

                tr.querySelectorAll('.summary-table-cell-input').forEach(inp => {
                    inp.addEventListener('input', () => {
                        row[inp.dataset.col] = inp.value;
                        inp.title = inp.value;
                        updateHideSummaryCharCounters();
                    });
                });

                tr.querySelector('.summary-table-row-del-btn').addEventListener('click', () => {
                    events.splice(idx, 1);
                    tableData.eventHistory = events;
                    renderTableGrid(tableData);
                    updateHideSummaryCharCounters();
                });

                dom.summaryTableHistoryTbody.appendChild(tr);
            });
        }

        // 2. 渲染角色信息表
        dom.summaryTableCharacterTbody.innerHTML = '';
        const chars = Array.isArray(tableData.characterInfo) ? tableData.characterInfo : [];
        if (chars.length === 0) {
            dom.summaryTableCharacterTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:14px;">暂无实体信息，可点击上方【添加行】或【立即总结】</td></tr>';
        } else {
            chars.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="summary-table-row-index" title="第 ${idx + 1} 行">${idx + 1}</td>
                    <td><textarea class="summary-table-cell-input" data-col="name" rows="${currentTableRowLines}" title="${escapeHtml(row.name || '')}" placeholder="姓名">${escapeHtml(row.name || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="bio" rows="${currentTableRowLines}" title="${escapeHtml(row.bio || '')}" placeholder="简介/身份">${escapeHtml(row.bio || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="status" rows="${currentTableRowLines}" title="${escapeHtml(row.status || '')}" placeholder="最新状态说明">${escapeHtml(row.status || '')}</textarea></td>
                    <td><textarea class="summary-table-cell-input" data-col="items" rows="${currentTableRowLines}" title="${escapeHtml(row.items || '')}" placeholder="持有关键道具">${escapeHtml(row.items || '')}</textarea></td>
                    <td style="text-align:center;"><button type="button" class="summary-table-row-del-btn" title="删除此行"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></td>
                `;

                tr.querySelectorAll('.summary-table-cell-input').forEach(inp => {
                    inp.addEventListener('input', () => {
                        row[inp.dataset.col] = inp.value;
                        inp.title = inp.value;
                        updateHideSummaryCharCounters();
                    });
                });

                tr.querySelector('.summary-table-row-del-btn').addEventListener('click', () => {
                    chars.splice(idx, 1);
                    tableData.characterInfo = chars;
                    renderTableGrid(tableData);
                    updateHideSummaryCharCounters();
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
            else if (mode === 'table') dom.hideSummaryPromptLabel.textContent = '总结提示词 (结构双表专属)';
        }
        if (dom.hideSummaryPrompt) {
            dom.hideSummaryPrompt.value = data.prompts?.[mode] || getDefaultPromptForMode(mode);
        }

        // 3. 切换视图容器（采用 flex 布局，撑开高度并自适应内部元素弹性拉伸）
        if (dom.summaryModeRecursiveView) dom.summaryModeRecursiveView.style.display = (mode === 'recursive' ? 'flex' : 'none');
        if (dom.summaryModeAppendView) dom.summaryModeAppendView.style.display = (mode === 'append' ? 'flex' : 'none');
        if (dom.summaryModeTableView) dom.summaryModeTableView.style.display = (mode === 'table' ? 'flex' : 'none');

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
            setHideSummaryForCurrentConversation({
                memoryMode: mode,
                prompts: data.prompts,
                prompt: dom.hideSummaryPrompt ? dom.hideSummaryPrompt.value : (data.prompts?.[mode] || getDefaultPromptForMode(mode))
            });
            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
        }

        updateHideSummaryCharCounters();
    }

    /**
     * 刷新归档保留楼层的红色警示卡片内容与显示状态
     * — 为什么这么写 —
     * 1. 当用户开启“归档时保留最后 K 楼不隐藏”时，这 K 楼永远保持可见状态；
     * 2. 在接下来的 N 楼新增对话中，这 K 楼将一直作为活跃上下文发送给 AI，直至达到下一次总结阈值；
     * 3. 此时未隐藏活跃楼层将累积达到 (K + N) 楼。因此通过红色警示卡片动态展现该累积上限，并引导用户搭配【发送消息数量限制】进行控流。
     */
    function updateKeepRecentFloorsHint() {
        if (!dom.autoSummaryKeepRecentHint) return;

        const isKeepEnabled = dom.autoSummaryKeepRecent ? dom.autoSummaryKeepRecent.checked : false;
        if (!isKeepEnabled) {
            dom.autoSummaryKeepRecentHint.style.display = 'none';
            return;
        }

        dom.autoSummaryKeepRecentHint.style.display = 'flex';

        const keepCount = parseInt(dom.autoSummaryKeepRecentCount?.value, 10) || 0;
        const isFloorsType = dom.autoSummaryTypeFloors ? dom.autoSummaryTypeFloors.checked : true;
        const interval = parseInt(dom.autoSummaryFloorInterval?.value, 10) || 10;

        if (dom.keepHintCalcText) {
            if (isFloorsType) {
                const totalAccumulated = keepCount + interval;
                dom.keepHintCalcText.innerHTML = `若保留 <strong>${keepCount}</strong> 楼且每隔 <strong>${interval}</strong> 楼总结，下轮触发前最多将累积 <strong>${totalAccumulated}</strong> 楼未隐藏消息发送给AI。`;
            } else {
                const tokenThreshold = parseInt(dom.autoSummaryTokenThreshold?.value, 10) || 4000;
                dom.keepHintCalcText.innerHTML = `若保留 <strong>${keepCount}</strong> 楼，新消息产生时这些楼层将作为近期语境持续发送给AI，直至可见纯正文达到 <strong>${tokenThreshold}</strong> Token 触发下轮总结。`;
            }
        }
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

            const activeIdx = (typeof conv.activeBranchIndex === 'number') ? conv.activeBranchIndex : 0;
            const activeBranch = Array.isArray(conv.branches) ? (conv.branches[activeIdx] || conv.branches[0] || []) : (conv.messages || []);
            const totalFloors = activeBranch.length;
            if (dom.hideSummaryTotalFloorsText) {
                dom.hideSummaryTotalFloorsText.textContent = `${totalFloors} 层`;
            }

            if (dom.hideSummaryHiddenFloorsText) {
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

    /**
     * 刷新自动总结 Token 累积进度胶囊
     * @param {string} convId - 会话ID
     */
        /**
     * 刷新自动总结楼层累积进度胶囊
     * @param {string} convId - 会话ID
     */
    function updateAutoSummaryFloorProgress(convId = state.currentConversationId) {
        if (!dom.autoSummaryFloorProgress) return;
        const conv = state.conversations[convId];
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

        // — 为什么这么写 —
        // 1. 若当前设置弹窗打开且输入框中有用户正在键入的数字，优先取输入框实时数值进行动态演算，
        //    实现“打字即反馈”的丝滑实时体验；
        // 2. 否则读取会话中已持久化的配置。
        if (dom.autoSummaryFloorInterval) {
            const inputVal = parseInt(dom.autoSummaryFloorInterval.value, 10);
            if (!isNaN(inputVal) && inputVal >= 2 && inputVal <= 100) {
                data.autoSummaryFloorInterval = inputVal;
            }
        }

        const progress = calculateAutoSummaryFloorProgress(conv, data);
        const remaining = progress.remainingFloors;
        const delta = progress.deltaFloors;
        const interval = progress.floorInterval;
        const lastFloor = progress.lastFloor;
        const currentTotal = progress.currentTotalFloors;
        const isDropFloors = data.dropSummarizedFloors !== false;

        const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="m12 2 10 5-10 5L2 7l10-5Z"></path><path d="m2 17 10 5 10-5"></path><path d="m2 12 10 5 10-5"></path></svg>`;

        let htmlText = '';
        let titleText = '';

        if (lastFloor > 0) {
            // 已有历史总结基准，属于增量步进阶段
            if (remaining <= 0) {
                htmlText = `${svgIcon}已达总结阈值 (第${lastFloor}楼后新增 <strong>${delta}</strong> / <strong>${interval}</strong> 楼)`;
                titleText = `上次总结保存于第 ${lastFloor} 楼。当前共 ${currentTotal} 楼，已新产生 ${delta} 楼增量消息（达到目标间隔 ${interval} 楼），待下一轮对话完成后将触发下一次总结`;
            } else {
                htmlText = `${svgIcon}还剩 <strong>${remaining}</strong> 楼 (第${lastFloor}楼后新增 <strong>${delta}</strong> / <strong>${interval}</strong> 楼)`;
                titleText = `上次总结保存于第 ${lastFloor} 楼。当前共 ${currentTotal} 楼，已新产生 ${delta} 楼增量消息，距离下次自动总结（目标间隔 ${interval} 楼）还剩 ${remaining} 楼`;
            }
        } else {
            // 尚未进行过总结（全新会话或老会话首次开启）
            if (remaining <= 0) {
                htmlText = `${svgIcon}已达总结阈值 (待触发，共 <strong>${currentTotal}</strong> 楼已达标)`;
                titleText = `当前会话共有 ${currentTotal} 楼未总结，已达到目标间隔 ${interval} 楼，待下一轮对话完成后将自动触发首次记忆总结`;
            } else {
                htmlText = `${svgIcon}还剩 <strong>${remaining}</strong> 楼总结 (已累积 <strong>${delta}</strong> / <strong>${interval}</strong> 楼)`;
                titleText = `当前共 ${currentTotal} 楼，距离首次自动总结（目标间隔 ${interval} 楼）还剩 ${remaining} 楼`;
            }
        }

        if (!isDropFloors) {
            titleText += `\n【提示】当前未开启「自动隐藏」，全部 ${currentTotal} 楼消息仍将同时发送给AI。`;
        }

        dom.autoSummaryFloorProgress.innerHTML = htmlText;
        dom.autoSummaryFloorProgress.title = titleText;

        // 临近阈值预警：还剩 <= 2 楼，或者进度达到 80% 以上时亮起琥珀橙色
        if (remaining <= 2 || (interval > 0 && delta / interval >= 0.8)) {
            dom.autoSummaryFloorProgress.classList.add('near-threshold');
        } else {
            dom.autoSummaryFloorProgress.classList.remove('near-threshold');
        }
    }

    function updateAutoSummaryTokenProgress(convId = state.currentConversationId) {
        if (!dom.autoSummaryTokenProgress) return;
        const conv = state.conversations[convId];
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        const progress = calculateAutoSummaryTokenProgress(conv, data);

        const currentAcc = progress.accumulatedTokens;
        const threshold = progress.tokenThreshold;
        const startFloor = progress.startFloor;

        dom.autoSummaryTokenProgress.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>当前自第 ${startFloor} 楼起已积累 <strong>${currentAcc.toLocaleString()}</strong> / <strong>${threshold.toLocaleString()}</strong> Token`;
        dom.autoSummaryTokenProgress.title = `自上次总结基准（第 ${progress.lastFloor} 楼）之后，当前已新产生的纯正文累积量：${currentAcc.toLocaleString()} Token（阈值：${threshold.toLocaleString()} Token）`;

        if (threshold > 0 && currentAcc / threshold >= 0.8) {
            dom.autoSummaryTokenProgress.classList.add('near-threshold');
        } else {
            dom.autoSummaryTokenProgress.classList.remove('near-threshold');
        }
    }

    /**
     * 刷新工作台"记忆基线版本"胶囊
     * — 为什么这么写 —
     * 指针语义是"基线溯源"而非"内容指纹"：回滚到哪版就指哪版，大爷后续再编辑也不丢锚，
     * 但通过全文比对给"已修改"琥珀标记，如实反映当前记忆已偏离基线。
     * @param {string} convId - 会话ID
     */
    function updateActiveVersionBadge(convId = state.currentConversationId) {
        const badge = dom.summaryActiveVersionBadge;
        if (!badge) return;

        const rawConfig = getHideSummaryForConversation(convId);
        const appliedId = rawConfig.appliedVersionId;
        const history = Array.isArray(rawConfig.history) ? rawConfig.history : [];
        const snap = appliedId
            ? history.find(s => String(s.id || s.timestamp) === String(appliedId))
            : null;

        // 无基线指针或基线快照已被手动删除时，胶囊隐藏，不做误导性展示
        if (!snap) {
            badge.style.display = 'none';
            return;
        }

        // 当前记忆全文 vs 基线快照全文（统一走 getSnapshotFullText 单一来源）
        const norm = normalizeHideSummaryConfig(rawConfig);
        const currentText = getSnapshotFullText({
            mode: norm.memoryMode,
            summary: norm.summary,
            summaryList: norm.summaryList,
            tableData: norm.tableData
        }).trim();
        const baseText = getSnapshotFullText(snap).trim();
        const isDirty = currentText !== baseText;

        badge.textContent = isDirty ? `基线: ${snap.time} (已修改)` : `基线: ${snap.time}`;
        badge.classList.toggle('is-dirty', isDirty);
        const appliedAtText = rawConfig.appliedAt ? new Date(rawConfig.appliedAt).toLocaleString() : '未知';
        badge.title = isDirty
            ? `当前记忆基线版本：${snap.time}（回滚/应用时间：${appliedAtText}）\n⚠️ 当前内容已在该版本基础上发生修改`
            : `当前记忆基线版本：${snap.time}（回滚/应用时间：${appliedAtText}）`;
        badge.style.display = '';
    }

    // 暴露供外部或后台自动总结完成后主动刷新的接口
    window.refreshHideSummaryModalViews = () => {
        const convId = state.currentConversationId;
        const data = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        updateHideSummaryBannerAndStats(convId);
        switchMode(data.memoryMode || 'recursive', false);
        updateHideSummaryHistoryCount();
        updateActiveVersionBadge(convId);
        if (dom.hideSummaryEnable) {
            dom.hideSummaryEnable.checked = !!data.enabled;
        }
        updateSummaryEditorLockState();
        updateHideSummaryCharCounters();
        updateKeepRecentFloorsHint();
        updateAutoSummaryTokenProgress(convId);
        updateAutoSummaryFloorProgress(convId);
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
                const isSummaryGenerating = dom.hideSummaryStartBtn && dom.hideSummaryStartBtn.dataset.summarizing === '1';
                const isAutoSummarizingCurrentConv = !!state.isAutoSummarizing && (state.autoSummarizingConvId === state.currentConversationId);
                const isChatGenerating = dom.sendButton && dom.sendButton.classList.contains('stop');

                if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true' || isSummaryGenerating || isAutoSummarizingCurrentConv || isChatGenerating) {
                    notify.warning('⏳ 正在生成中，暂不可切换记忆模式');
                    return;
                }

                const mode = btn.dataset.mode;
                if (mode && mode !== currentMemoryMode) {
                    switchMode(mode, true);
                }
            });
        });
    }

    // 会话记忆弹窗：高级设置（折叠/展开）交互管理（默认展开）
    function toggleSummaryAdvancedSettings(forceOpen = null) {
        if (!dom.summaryAdvancedSection) return;
        const isCurrentlyOpen = dom.summaryAdvancedSection.classList.contains('open');
        const targetOpen = forceOpen !== null ? forceOpen : !isCurrentlyOpen;
        if (targetOpen) {
            dom.summaryAdvancedSection.classList.add('open');
            const textSpan = dom.summaryAdvancedToggleBtn?.querySelector('.summary-advanced-toggle-text');
            if (textSpan) textSpan.textContent = '收起设置';
        } else {
            dom.summaryAdvancedSection.classList.remove('open');
            const textSpan = dom.summaryAdvancedToggleBtn?.querySelector('.summary-advanced-toggle-text');
            if (textSpan) textSpan.textContent = '展开设置';
        }
        updateHideSummaryCharCounters();
    }

    if (dom.summaryAdvancedToggleBtn) {
        dom.summaryAdvancedToggleBtn.addEventListener('click', () => toggleSummaryAdvancedSettings());
    }

    // — 为什么这么写 —
    // 模式切换条（警示红条 + 三模式标签）CSS 吸顶后，需精确检测"吸顶生效"瞬间补投阴影分界线：
    // 吸顶条与下方滚动内容同为 --bg-medium 底色，无分界时融为一体看不出谁压谁。
    // 用 rAF 节流代替高频 scroll 直接读布局，兼顾性能铁律与判定实时性；
    // 不用 IntersectionObserver 哨兵方案，是为了零改动 modals.html 结构。
    {
        const summaryModalBody = dom.hideSummaryModal ? dom.hideSummaryModal.querySelector('.modal-body') : null;
        const summaryModeBanner = dom.hideSummaryModal ? dom.hideSummaryModal.querySelector('.summary-mode-banner-wrapper') : null;
        if (summaryModalBody && summaryModeBanner) {
            let bannerStickyTicking = false;
            summaryModalBody.addEventListener('scroll', () => {
                if (bannerStickyTicking) return;
                bannerStickyTicking = true;
                requestAnimationFrame(() => {
                    bannerStickyTicking = false;
                    const isStuck = summaryModeBanner.getBoundingClientRect().top <= summaryModalBody.getBoundingClientRect().top + 1;
                    summaryModeBanner.classList.toggle('is-stuck', isStuck);
                });
            }, { passive: true });
        }
    }

    // 恢复该模式默认提示词按钮
    if (dom.hideSummaryResetPromptBtn) {
        dom.hideSummaryResetPromptBtn.addEventListener('click', () => {
            const defaultPrompt = getDefaultPromptForMode(currentMemoryMode);
            const modeName = currentMemoryMode === 'recursive' ? '递归滚动' : currentMemoryMode === 'append' ? '列表拼接' : '结构双表';

            // — 为什么这么写 —
            // 提示词往往经过用户精心调优，直接覆盖可能导致劳动成果丢失，因此增加防误触二次确认
            if (dom.hideSummaryPrompt && dom.hideSummaryPrompt.value.trim() === defaultPrompt.trim()) {
                notify.info(`当前提示词已是【${modeName}】官方默认版本，无需恢复`);
                return;
            }

            if (!confirm(`确定要恢复【${modeName}】的官方默认提示词吗？\n当前已编辑的提示词将被覆盖。`)) {
                return;
            }

            if (dom.hideSummaryPrompt) {
                dom.hideSummaryPrompt.value = defaultPrompt;
                updateHideSummaryCharCounters();
            }
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            if (!config.prompts) config.prompts = {};
            config.prompts[currentMemoryMode] = defaultPrompt;
            config.prompt = defaultPrompt;
            setHideSummaryForCurrentConversation(config);
            notify.success(`已恢复【${modeName}】官方默认提示词`);
        });
    }

    // 模式 2：新增记忆片段（多行模态弹窗）
    if (dom.summaryAppendAddBtn) {
        dom.summaryAppendAddBtn.addEventListener('click', () => {
            const convId = state.currentConversationId;
            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            const list = config.summaryList || [];
            openSummaryCardEditModal({
                mode: 'add',
                index: list.length,
                item: {
                    floorRange: `阶段 ${list.length + 1}`,
                    content: ''
                },
                summaryList: list,
                onSave: (newItem) => {
                    const latestConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
                    latestConfig.summaryList = [...(latestConfig.summaryList || []), newItem];
                    setHideSummaryForCurrentConversation(latestConfig);
                    renderAppendCardsList(latestConfig.summaryList);
                    updateHideSummaryCharCounters();
                    notify.success('✨ 已成功添加记忆片段！');
                }
            });
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
            updateHideSummaryCharCounters();
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
                dom.summaryTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="M9 3v18"></path></svg> 表格模式';
                dom.summaryTableRawToggleBtn.classList.add('primary');
                if (dom.summaryTableGridContainer) dom.summaryTableGridContainer.style.display = 'none';
                if (dom.summaryTableRawWrapper) dom.summaryTableRawWrapper.style.display = 'block';
                if (dom.summaryTableRawTextarea) {
                    dom.summaryTableRawTextarea.value = formatTablesToMarkdown(config.tableData.eventHistory, config.tableData.characterInfo);
                }
            } else {
                // 切回表格模式：反解析 Markdown 为表格对象
                isTableRawMode = false;
                dom.summaryTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg> 源码模式';
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
            updateHideSummaryCharCounters();
        });

        if (dom.summaryTableRawTextarea) {
            dom.summaryTableRawTextarea.addEventListener('input', () => {
                updateHideSummaryCharCounters();
            });
        }
    }

    // 模式 3：表格放大/全屏编辑窗口切换
    let isTableExpanded = false;
    function setTableExpanded(expanded) {
        isTableExpanded = typeof expanded === 'boolean' ? expanded : !isTableExpanded;
        if (!dom.hideSummaryModal) return;
        if (isTableExpanded) {
            dom.hideSummaryModal.classList.add('table-expanded');
            if (dom.summaryTableExpandBtn) {
                dom.summaryTableExpandBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg> 还原窗口';
                dom.summaryTableExpandBtn.classList.add('primary');
            }
        } else {
            dom.hideSummaryModal.classList.remove('table-expanded');
            if (dom.summaryTableExpandBtn) {
                dom.summaryTableExpandBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg> 放大编辑';
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

    // 模式 3 与模式 2：双表与列表拼接滚动到上下边界时，联动整个弹窗主体继续滚动（防卡阻且绝对不影响左右横滚）
    function setupScrollChaining(scrollEl) {
        if (!scrollEl) return;

        // 鼠标滚轮与触控板联动
        scrollEl.addEventListener('wheel', (e) => {
            // 严禁误判横向滚动：若按住 Shift 键或横向位移大于纵向位移，彻底放行原生水平滚动
            if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            if (e.deltaY === 0) return;

            const atTop = scrollEl.scrollTop <= 0;
            const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
            if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
                const modalBody = scrollEl.closest('.modal-body');
                if (modalBody) {
                    modalBody.scrollTop += e.deltaY;
                }
            }
        }, { passive: true });

        // 触屏滑动边界穿透联动（仅在纯纵向滑动且到达边界时联动，横划绝对不干预）
        let touchStartY = 0;
        let touchStartX = 0;
        scrollEl.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches.length === 1) {
                touchStartY = e.touches[0].clientY;
                touchStartX = e.touches[0].clientX;
            }
        }, { passive: true });

        scrollEl.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const currentY = e.touches[0].clientY;
            const currentX = e.touches[0].clientX;
            const deltaY = touchStartY - currentY;
            const deltaX = touchStartX - currentX;

            // 若用户主要是在左右水平拖动（横向滑动），绝不干预，完全交由浏览器原生横向流畅滑动
            if (Math.abs(deltaX) > Math.abs(deltaY)) return;

            const atTop = scrollEl.scrollTop <= 0;
            const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;

            if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
                const modalBody = scrollEl.closest('.modal-body');
                if (modalBody) {
                    modalBody.scrollTop += deltaY * 0.6;
                    touchStartY = currentY;
                }
            }
        }, { passive: true });
    }

    if (dom.summaryTableGridContainer) {
        setupScrollChaining(dom.summaryTableGridContainer);

        // 模式 3：双表容器增加通用鼠标拖拽与触摸平移横滚支持（彻底解决 F12 手机模拟器及桌面鼠标无法顺畅拖拽滚动条的难题）
        const grid = dom.summaryTableGridContainer;
        let isMouseDown = false;
        let startX = 0;
        let startScrollLeft = 0;

        grid.addEventListener('mousedown', (e) => {
            // — 为什么这么写 —
            // 用户在交互控件（按钮、文本框、输入框、下拉框）内点击或拖拽框选文字时，绝不能劫持为整表横向平移，
            // 无论该输入框在此刻是否已经处于激活焦点状态 (document.activeElement)，均必须予以原生交互放行。
            if (['BUTTON', 'TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) {
                return;
            }
            isMouseDown = true;
            startX = e.pageX - grid.offsetLeft;
            startScrollLeft = grid.scrollLeft;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isMouseDown) return;
            const x = e.pageX - grid.offsetLeft;
            const walk = (x - startX);
            if (Math.abs(walk) > 3) {
                grid.scrollLeft = startScrollLeft - walk;
            }
        });

        window.addEventListener('mouseup', () => {
            isMouseDown = false;
        });
    }
    if (dom.summaryAppendCardsList) {
        setupScrollChaining(dom.summaryAppendCardsList);
    }

    // 点击顶栏总结按钮打开弹窗
    dom.hideSummaryBtn.addEventListener('click', () => {
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (dom.summaryTableRowLinesSelect) {
            dom.summaryTableRowLinesSelect.value = currentTableRowLines.toString();
        }
        const convId = state.currentConversationId;
        const rawConfig = getHideSummaryForConversation(convId);
        const data = normalizeHideSummaryConfig(rawConfig);

        // 检查并静默升级旧版默认提示词指纹并安全落盘
        const rawPrompts = rawConfig?.prompts || {};
        const hadLegacy = (
            isLegacyDefaultPrompt(rawPrompts.recursive, 'recursive') ||
            isLegacyDefaultPrompt(rawPrompts.append, 'append') ||
            isLegacyDefaultPrompt(rawPrompts.table, 'table') ||
            (typeof rawConfig?.prompt === 'string' && isLegacyDefaultPrompt(rawConfig.prompt, rawConfig.memoryMode || 'recursive'))
        );
        if (hadLegacy) {
            setHideSummaryForCurrentConversation(data);
        }

        // 默认展开高级设置（放置在工作台上方）
        toggleSummaryAdvancedSettings(true);

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

        const relayPolicy = data.relayAutoSummaryPolicy || 'ask';
        if (dom.autoSummaryRelayPolicyAsk) dom.autoSummaryRelayPolicyAsk.checked = (relayPolicy === 'ask');
        if (dom.autoSummaryRelayPolicyRelay) dom.autoSummaryRelayPolicyRelay.checked = (relayPolicy === 'always_relay');
        if (dom.autoSummaryRelayPolicyLocal) dom.autoSummaryRelayPolicyLocal.checked = (relayPolicy === 'always_local');

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
        updateKeepRecentFloorsHint();
        updateAutoSummaryTokenProgress(convId);
        updateAutoSummaryFloorProgress(convId);

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

        // 刷新历史版本数量角标与记忆基线胶囊
        updateHideSummaryHistoryCount();
        updateActiveVersionBadge(convId);

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

                // 记忆已清空即失去基线意义，指针置空（撤销清空恢复的是内存备份而非快照，同样不指基线）
                config.appliedVersionId = null;
                config.appliedAt = 0;

                setHideSummaryForCurrentConversation(config);
                updateHideSummaryCharCounters();
                updateActiveVersionBadge(convId);
                updateClearBtnState(true);
                notify.info('已清空当前模式记忆（误操作可点击【撤销清空】恢复）');
            }
        });
    }

    // 统一的隐藏与总结弹窗安全关闭逻辑（含正在生成中的拦截与确认）
    handleHideSummaryModalClose = function() {
        if (dom.hideSummaryStartBtn && dom.hideSummaryStartBtn.dataset.summarizing === '1') {
            const shouldClose = confirm('正在总结，是否停止并关闭弹窗？');
            if (!shouldClose) return;
            if (window._hideSummaryAbort) window._hideSummaryAbort.abort();
        }
        setTableExpanded(false);
        closeModalWithAnimation(dom.hideSummaryModal);
    };

    // — 为什么这么写 —
    // 乌鸦：禁用点击遮罩阴影处关闭（避免大爷编辑长篇记忆、调试结构表格或调整参数时手抖误触阴影导致未保存内容丢失）。
    // 用户如需关闭，必须点击右上角关闭按钮或保存按钮。
    /*
    dom.hideSummaryModal.addEventListener('click', (e) => {
        if (e.target === dom.hideSummaryModal) {
            handleHideSummaryModalClose();
        }
    });
    */

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
        dom.autoSummaryRelayPolicyAsk,
        dom.autoSummaryRelayPolicyRelay,
        dom.autoSummaryRelayPolicyLocal,
        dom.hideSummaryWithRole,
        dom.hideSummaryWithWorldBook
    ];

    const handleSummaryInputChange = (input) => {
        const convId = state.currentConversationId;
        const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

        config.enabled = dom.hideSummaryEnable.checked;
        config.autoSummaryEnabled = dom.autoSummaryEnable ? dom.autoSummaryEnable.checked : false;
        config.autoSummaryType = (dom.autoSummaryTypeTokens && dom.autoSummaryTypeTokens.checked) ? 'tokens' : 'floors';
        config.autoSummaryFloorInterval = parseInt(dom.autoSummaryFloorInterval?.value, 10) || 10;
        const rawTokenThreshold = parseInt(dom.autoSummaryTokenThreshold?.value, 10);
        config.autoSummaryTokenThreshold = isNaN(rawTokenThreshold) ? 4000 : Math.max(500, Math.min(100000, rawTokenThreshold));
        config.dropSummarizedFloors = dom.autoSummaryDropFloors ? dom.autoSummaryDropFloors.checked : true;
        config.keepRecentFloors = dom.autoSummaryKeepRecent ? dom.autoSummaryKeepRecent.checked : true;
        config.keepRecentFloorsCount = parseInt(dom.autoSummaryKeepRecentCount?.value, 10) || 2;

        let relayPolicy = 'ask';
        if (dom.autoSummaryRelayPolicyRelay && dom.autoSummaryRelayPolicyRelay.checked) {
            relayPolicy = 'always_relay';
        } else if (dom.autoSummaryRelayPolicyLocal && dom.autoSummaryRelayPolicyLocal.checked) {
            relayPolicy = 'always_local';
        }
        config.relayAutoSummaryPolicy = relayPolicy;

        config.withRole = dom.hideSummaryWithRole.checked;
        config.withWorldBook = dom.hideSummaryWithWorldBook.checked;

        setHideSummaryForCurrentConversation(config);
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (input === dom.hideSummaryEnable) {
            renderChatMessages({ updateVisibilityOnly: true });
        }
        updateKeepRecentFloorsHint();
        updateAutoSummaryTokenProgress(convId);
        updateAutoSummaryFloorProgress(convId);
    };

    summaryInputsToSave.forEach(input => {
        if (!input) return;
        input.addEventListener('change', () => handleSummaryInputChange(input));
        if (input.tagName === 'INPUT' && (input.type === 'number' || input.type === 'text')) {
            input.addEventListener('input', () => handleSummaryInputChange(input));
        }
    });

    // — 为什么这么写 —
    // 1. 输入框失焦（change）时规范化纠正显示数值，确保界面显示与底层配置严格一致，避免输入 200 显示 200 但底层按 500 执行的割裂感；
    // 2. 进度胶囊点击拦截冒泡与默认行为，防止用户选中复制胶囊文本时误触 label 绑定的 radio。
    if (dom.autoSummaryTokenThreshold) {
        dom.autoSummaryTokenThreshold.addEventListener('change', () => {
            const raw = parseInt(dom.autoSummaryTokenThreshold.value, 10);
            const clamped = isNaN(raw) ? 4000 : Math.max(500, Math.min(100000, raw));
            dom.autoSummaryTokenThreshold.value = clamped;
        });
    }
    if (dom.autoSummaryFloorInterval) {
        dom.autoSummaryFloorInterval.addEventListener('change', () => {
            const raw = parseInt(dom.autoSummaryFloorInterval.value, 10);
            const clamped = isNaN(raw) ? 10 : Math.max(2, Math.min(100, raw));
            dom.autoSummaryFloorInterval.value = clamped;
            updateAutoSummaryFloorProgress();
        });
        dom.autoSummaryFloorInterval.addEventListener('input', () => {
            updateAutoSummaryFloorProgress();
        });
    }
    if (dom.autoSummaryFloorProgress) {
        dom.autoSummaryFloorProgress.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }
    if (dom.autoSummaryTokenProgress) {
        dom.autoSummaryTokenProgress.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    // 归档保留楼层累积提示中【发送消息数量限制】锚点跳转事件
    if (dom.keepHintJumpLimit) {
        dom.keepHintJumpLimit.addEventListener('click', (e) => {
            e.preventDefault();
            const slider = dom.messageLimitSlider || document.getElementById('message-limit-slider');
            if (slider) {
                slider.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const group = slider.closest('.summary-top-controls') || slider.closest('.summary-top-control-slider-group') || slider.closest('.form-group');
                if (group) {
                    group.classList.remove('highlight-focus-ring');
                    void group.offsetWidth; // 触发 reflow 重启动画
                    group.classList.add('highlight-focus-ring');
                    setTimeout(() => group.classList.remove('highlight-focus-ring'), 1500);
                }
            }
        });
    }

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
    // 乌鸦：sessionTokenBadge 点击事件已统一委托给模拟发送与提示词预览弹窗 (openSimulateSendModal)

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

                        // 提取顶级全量 bundle 元数据（如全量导出的 worldBook 与 hideSummary 及 regexRules、sessionRegexRules）
                        parsedBundleMetadata = {
                            worldBook: parsedData.worldBook || null,
                            hideSummary: parsedData.hideSummary || null,
                            regexRules: parsedData.regexRules || null,
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
                            const hasRt = !!(conv && conv.realtimeMode && (typeof conv.realtimeMode === 'object' || typeof conv.realtimeMode === 'string') && normalizeRealtimeConfig(conv.realtimeMode).enabled);
                            const rtBadge = hasRt ? `<span style="font-size: 10px; color: var(--success-color, #10b981); background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 3px; padding: 0 4px; margin-left: 6px; flex-shrink: 0;" title="包含实时模式时间与历法配置">实时</span>` : '';

                            listItem.innerHTML = `
                                <input type="checkbox" class="import-item-checkbox" data-index="${index}">
                                <span class="import-conversation-list-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
                                ${rtBadge}
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
                if (conv.realtimeMode) {
                    const rt = normalizeRealtimeConfig(conv.realtimeMode);
                    if (rt.enabled) {
                        const modeDesc = rt.dateMode === 'custom' 
                            ? `虚拟历法: ${rt.customYear}-${String(rt.customMonth).padStart(2, '0')}-${String(rt.customDay).padStart(2, '0')}`
                            : '跟随系统时间';
                        const promptTag = (rt.promptEnabled !== false && rt.prompt) ? ' · 含提示词' : '';
                        previewHtml += `<div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--success-color, #10b981);background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:4px;padding:2px 8px;margin-bottom:8px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            实时模式已开启 (${modeDesc}${promptTag})
                        </div>`;
                    }
                }
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
                const result = await importConversations(conversationsToImport, parsedBundleMetadata);
                const lastImportedId = typeof result === 'string' ? result : (result && result.lastImportedId);
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
        // — 为什么这么写 —
        // 用户拖动滑块时（input）或松开确认时（change），均需要立即同步 messageLimit 配置，
        // 并即时触发 updateSessionTokenBadge() 刷新顶栏 Token 徽章（session-token-text），
        // 彻底杜绝调整限制后 Token 统计滞后脱节的问题。
        const applyMessageLimitChange = () => {
            const value = parseInt(messageLimitSlider.value);
            messageLimitValue.textContent = value === 0 ? '全部' : value.toString();

            const data = getHideSummaryForCurrentConversation();
            data.messageLimit = value;
            setHideSummaryForCurrentConversation(data);

            // 乌鸦：核心修复——立即刷新顶栏会话 Token 徽章
            updateSessionTokenBadge();

            // 乌鸦：若数据详情/记忆弹窗正在展示，联动刷新弹窗内的统计视图
            if (window.refreshHideSummaryModalViews) {
                window.refreshHideSummaryModalViews();
            }

            if (window.updateHideSummaryBtnColor) {
                window.updateHideSummaryBtnColor();
            }
        };

        // 监听滑块拖动中（实时流畅反馈）与松开确认
        messageLimitSlider.addEventListener('input', applyMessageLimitChange);
        messageLimitSlider.addEventListener('change', applyMessageLimitChange);
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

    // — 为什么这么写 —
    // 兼容长期记忆的 3 种模式 (递归 recursive / 列表拼接 append / 结构双表 table)
    // 在结构双表模式下，总结存储在 tableData 中，必须格式化为 Markdown 双表呈现与复制；
    // 在列表拼接模式下，总结存储在 summaryList 中，必须格式化为阶段列表；
    // 递归模式下才直接取 summary 字段。彻底解决结构表格模式下弹窗显示“无总结内容”的问题。
    let summaryContent = '';
    const hideSummaryConfig = state.hideSummary && state.hideSummary[state.currentConversationId];
    if (hideSummaryConfig && hideSummaryConfig.enabled) {
        const mode = hideSummaryConfig.memoryMode || 'recursive';
        if (mode === 'table') {
            summaryContent = formatTablesToMarkdown(hideSummaryConfig.tableData?.eventHistory, hideSummaryConfig.tableData?.characterInfo);
            if (!summaryContent && hideSummaryConfig.summary) {
                summaryContent = hideSummaryConfig.summary;
            }
        } else if (mode === 'append') {
            summaryContent = formatSummaryListToText(hideSummaryConfig.summaryList);
        } else {
            summaryContent = hideSummaryConfig.summary || '';
        }
    }

    if (summaryContent && summaryContent.trim()) {
        dom.systemPromptSummary.innerHTML = escapeHtml(summaryContent.trim());
        dom.currentSummaryContent = summaryContent.trim();
    } else {
        dom.systemPromptSummary.innerHTML = '<span class="empty-prompt-message">无总结内容</span>';
        dom.currentSummaryContent = '无总结内容';
    }

    // 计算和显示对话统计信息
    const convStats = calculateConversationStats(conv, hideSummaryConfig);
    if (dom.actualSentTokens) dom.actualSentTokens.textContent = (convStats.actualSentEstimatedTokens || 0).toLocaleString();
    const actualSentCharsEl = dom.actualSentCharacters || document.getElementById('actual-sent-characters');
    if (actualSentCharsEl) actualSentCharsEl.textContent = (convStats.actualSentCharacters || 0).toLocaleString();
    const actualSentMainTokensEl = dom.actualSentMainTokens || document.getElementById('actual-sent-main-tokens');
    if (actualSentMainTokensEl) actualSentMainTokensEl.textContent = (convStats.actualSentMainTokens || 0).toLocaleString();
    const actualSentSystemTokensEl = dom.actualSentSystemTokens || document.getElementById('actual-sent-system-tokens');
    if (actualSentSystemTokensEl) actualSentSystemTokensEl.textContent = (convStats.actualSentSystemTokens || 0).toLocaleString();
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

    // — 为什么这么写 —
    // 呈现正则过滤排除差额（Plan A 核心透视）：
    // 若实际发送中触发了 request 正则过滤削减，在第一行内联高亮显示 [正则排除: -X]，
    // 并在专项统计栏中呈现削减的 tokens / 字符数；无削减时自动优雅隐藏，保持界面纯净。
    const regexBadgeEl = document.getElementById('actual-sent-regex-badge');
    const regexTokensEl = document.getElementById('actual-sent-regex-tokens');
    const regexExcludedTokensEl = document.getElementById('regex-excluded-tokens');
    const regexExcludedCharsEl = document.getElementById('regex-excluded-chars');
    const regexRowEl = document.getElementById('regex-excluded-stats-row');

    const excludedTokens = convStats.regexExcludedTokens || 0;
    const excludedChars = convStats.regexExcludedCharacters || 0;

    if (regexBadgeEl && regexTokensEl) {
        if (excludedTokens > 0) {
            regexTokensEl.textContent = excludedTokens.toLocaleString();
            regexBadgeEl.style.display = 'inline';
        } else {
            regexBadgeEl.style.display = 'none';
        }
    }

    if (regexExcludedTokensEl) regexExcludedTokensEl.textContent = excludedTokens.toLocaleString();
    if (regexExcludedCharsEl) regexExcludedCharsEl.textContent = excludedChars.toLocaleString();
    if (regexRowEl) {
        regexRowEl.style.display = excludedTokens > 0 ? 'block' : 'none';
    }

    dom.systemPromptModal.style.display = 'flex';
    dom.systemPromptModal.classList.add('visible');

    // 计算并显示tokens预估
    const personaTitleSpan = document.querySelector('#system-prompt-modal details:nth-of-type(1) .details-title');
    const worldbookTitleSpan = document.getElementById('worldbook-title');
    const summaryTitleSpan = document.querySelector('#system-prompt-modal details:nth-of-type(3) .details-title');

    // 获取实际内容并计算Tokens（为空时不计入占位提示词Tokens）
    const hasPersona = dom.systemPromptPersona.querySelector('.empty-prompt-message') === null && dom.currentPersonaContent !== '无角色提示词';
    const hasWorldbook = dom.systemPromptWorldbook.querySelector('.empty-prompt-message') === null && dom.currentWorldbookContent !== '无备忘录内容';
    const hasSummary = dom.systemPromptSummary.querySelector('.empty-prompt-message') === null && dom.currentSummaryContent !== '无总结内容';

    const personaTokens = hasPersona ? countTokens(dom.currentPersonaContent) : 0;
    const worldbookTokens = hasWorldbook ? countTokens(dom.currentWorldbookContent) : 0;
    const summaryTokens = hasSummary ? countTokens(dom.currentSummaryContent) : 0;

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

    // 实时同步当前选中的记忆模式与 DOM 表单中的最新参数
    const activeModeTab = document.querySelector('.summary-mode-tab.active');
    const activeMode = activeModeTab?.dataset?.mode || currentMemoryMode || hideConfig.memoryMode || 'recursive';
    hideConfig.memoryMode = activeMode;
    currentMemoryMode = activeMode;
    if (dom.hideSummaryEnable) hideConfig.enabled = dom.hideSummaryEnable.checked;
    if (dom.autoSummaryDropFloors) hideConfig.dropSummarizedFloors = dom.autoSummaryDropFloors.checked;
    if (dom.autoSummaryKeepRecent) hideConfig.keepRecentFloors = dom.autoSummaryKeepRecent.checked;
    if (dom.autoSummaryKeepRecentCount) hideConfig.keepRecentFloorsCount = parseInt(dom.autoSummaryKeepRecentCount.value, 10) || 2;
    if (dom.hideSummaryWithRole) hideConfig.withRole = dom.hideSummaryWithRole.checked;
    if (dom.hideSummaryWithWorldBook) hideConfig.withWorldBook = dom.hideSummaryWithWorldBook.checked;

    const visibleMessages = getVisibleMessagesForSummary(activeBranch, hideConfig);

    if (visibleMessages.length === 0) {
        alert('当前分支中没有可见（未隐藏）的消息可供总结。');
        return;
    }

    // — 为什么这么写 —
    // 彻底解决用户手动点击总结时楼层归档隐藏的“黑盒”问题：
    // 执行前调起前置确认弹窗，透明展示可见消息范围、动态演算隐藏区间与保留近期楼层，
    // 赋予用户【总结并按规则隐藏】、【仅总结 (不隐藏)】与【取消】的知情决策权。
    openSummaryExecutionConfirmModal({
        convId,
        activeBranch,
        hideConfig,
        visibleMessages,
        onProceed: async ({ dropFloors, keepRecentCount, updatedVisibleMessages }) => {
            // 同步选定的归档隐藏策略到配置与表单
            hideConfig.dropSummarizedFloors = dropFloors;
            hideConfig.keepRecentFloors = (keepRecentCount > 0);
            hideConfig.keepRecentFloorsCount = keepRecentCount;
            if (dom.autoSummaryDropFloors) dom.autoSummaryDropFloors.checked = dropFloors;
            if (dom.autoSummaryKeepRecent) dom.autoSummaryKeepRecent.checked = (keepRecentCount > 0);
            if (dom.autoSummaryKeepRecentCount) dom.autoSummaryKeepRecentCount.value = keepRecentCount.toString();

            const targetMessages = (Array.isArray(updatedVisibleMessages) && updatedVisibleMessages.length > 0)
                ? updatedVisibleMessages
                : visibleMessages;

            await executeSummaryGeneration(convId, conv, activeBranch, hideConfig, targetMessages, dropFloors, keepRecentCount);
        }
    });
}

/**
 * 实际执行总结大模型调用与结果应用流程
 */
async function executeSummaryGeneration(convId, conv, activeBranch, hideConfig, visibleMessages, dropFloors, keepRecentCount) {
    const btn = dom.hideSummaryStartBtn;
    lastSummarizedItems = visibleMessages;
    const mode = hideConfig.memoryMode || 'recursive';
    const customPrompt = dom.hideSummaryPrompt.value.trim() || getDefaultPromptForMode(mode);
    if (!hideConfig.prompts) hideConfig.prompts = {};
    hideConfig.prompts[mode] = customPrompt;
    hideConfig.prompt = customPrompt;
    setHideSummaryForCurrentConversation(hideConfig);

    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: -2px;"><rect width="14" height="14" x="5" y="5" rx="2"></rect></svg><span>停止生成</span>`;
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
            withRole: dom.hideSummaryWithRole ? dom.hideSummaryWithRole.checked : false,
            withWorldBook: dom.hideSummaryWithWorldBook ? dom.hideSummaryWithWorldBook.checked : false,
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
            await applySummaryResult(convId, finalSummaryText, visibleMessages, dropFloors, '手动总结', mode);
            if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
            updateHideSummaryHistoryCount();

            // 获取最新落盘的隐藏楼层集合
            const updatedConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            const newHiddenFloors = updatedConfig.hiddenFloors || [];

            // 若本次总结由于格式异常生成了待处理挂起单，已弹出错误弹窗，不再重复弹完成报告
            if (updatedConfig.pendingSummaryError) {
                return;
            }

            // 弹出完成报告模态弹窗，清晰反馈记忆增量与最新隐藏楼层
            openSummaryExecutionCompleteModal({
                mode,
                summaryText: finalSummaryText,
                dropFloors,
                newHiddenFloors,
                totalFloors: activeBranch ? activeBranch.length : 0,
                keepCount: keepRecentCount,
                summarizedMessages: visibleMessages
            });
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
        btn.innerHTML = '针对当前可见消息立即总结';
        btn.classList.remove('summarizing');
        btn.dataset.summarizing = '0';
        window._hideSummaryAbort = null;
        updateHideSummaryCharCounters();
        updateSummaryEditorLockState();
    }
}

async function handleSaveSummary() {
    const convId = state.currentConversationId;
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    // 实时同步 DOM 表单中的所有最新参数
    if (dom.hideSummaryEnable) config.enabled = dom.hideSummaryEnable.checked;
    if (dom.autoSummaryDropFloors) config.dropSummarizedFloors = dom.autoSummaryDropFloors.checked;
    if (dom.autoSummaryKeepRecent) config.keepRecentFloors = dom.autoSummaryKeepRecent.checked;
    if (dom.autoSummaryKeepRecentCount) config.keepRecentFloorsCount = parseInt(dom.autoSummaryKeepRecentCount.value, 10) || 2;
    if (dom.hideSummaryWithRole) config.withRole = dom.hideSummaryWithRole.checked;
    if (dom.hideSummaryWithWorldBook) config.withWorldBook = dom.hideSummaryWithWorldBook.checked;

    const mode = config.memoryMode || 'recursive';
    if (dom.hideSummaryPrompt) {
        if (!config.prompts) config.prompts = {};
        config.prompts[mode] = dom.hideSummaryPrompt.value;
        config.prompt = dom.hideSummaryPrompt.value;
    }

    setHideSummaryForCurrentConversation(config);
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

// ==================== 记忆总结格式异常弹窗 (Plan A) ====================
let currentSummaryErrorContext = null;

export function showSummaryFormatErrorModal(convId, errorInfo = {}) {
    if (!dom.summaryFormatErrorModal) return;
    currentSummaryErrorContext = { convId, ...errorInfo };
    dom.summaryFormatErrorModal.dataset.convId = convId;

    if (dom.summaryErrorModalTitle) {
        dom.summaryErrorModalTitle.textContent = errorInfo.source === 'condense' ? '记忆精炼格式异常提醒' : '记忆总结格式异常提醒';
    }
    if (dom.summaryErrorTitleText) {
        dom.summaryErrorTitleText.textContent = errorInfo.title || '⚠️ AI 返回的记忆内容格式有误，无法精准解析';
    }
    if (dom.summaryErrorDescText) {
        dom.summaryErrorDescText.innerHTML = errorInfo.desc || '系统已启动数据安全保护，<strong>前文沉淀的历史记忆 100% 完好无损</strong>，未被破坏或冲刷。请选择如何处理本次新增楼层的总结：';
    }
    if (dom.summaryErrorFloorTag) {
        dom.summaryErrorFloorTag.textContent = errorInfo.floorRange || '未知楼层';
    }
    if (dom.summaryErrorRawTextarea) {
        dom.summaryErrorRawTextarea.value = errorInfo.rawContent || '(空)';
    }
    if (dom.summaryErrorRawWrapper) {
        dom.summaryErrorRawWrapper.style.display = 'none';
    }
    if (dom.summaryErrorRawArrow) {
        dom.summaryErrorRawArrow.textContent = '▼';
    }
    if (dom.summaryErrorIgnoreBtnText) {
        dom.summaryErrorIgnoreBtnText.textContent = errorInfo.source === 'condense' ? '手动修改格式' : '忽略本次总结';
    }
    if (dom.summaryErrorRetryBtnText) {
        dom.summaryErrorRetryBtnText.textContent = errorInfo.source === 'condense' ? '重新生成' : '立即重新总结';
    }
    dom.summaryFormatErrorModal.style.display = 'flex';
}
window.showSummaryFormatErrorModal = showSummaryFormatErrorModal;

export function checkAndOpenSummaryErrorModal(convId) {
    if (!convId) return;
    const hideConfig = state.hideSummary?.[convId];
    if (hideConfig && hideConfig.pendingSummaryError) {
        showSummaryFormatErrorModal(convId, hideConfig.pendingSummaryError);
    }
}
window.checkAndOpenSummaryErrorModal = checkAndOpenSummaryErrorModal;

export function setupSummaryFormatErrorModalEvents() {
    if (!dom.summaryFormatErrorModal) return;

    // 折叠展开原始文本
    if (dom.summaryErrorRawToggle) {
        dom.summaryErrorRawToggle.addEventListener('click', () => {
            const isHidden = dom.summaryErrorRawWrapper.style.display === 'none';
            dom.summaryErrorRawWrapper.style.display = isHidden ? 'block' : 'none';
            if (dom.summaryErrorRawArrow) {
                dom.summaryErrorRawArrow.textContent = isHidden ? '▲' : '▼';
            }
        });
    }

    // 关闭按钮 (临时关闭，未处理挂起单在下次进入会话时仍会按 Plan A 弹窗)
    if (dom.summaryFormatErrorCloseBtn) {
        dom.summaryFormatErrorCloseBtn.addEventListener('click', () => {
            dom.summaryFormatErrorModal.style.display = 'none';
        });
    }

    // 忽略本次总结 / 手动修改格式
    if (dom.summaryErrorIgnoreBtn) {
        dom.summaryErrorIgnoreBtn.addEventListener('click', async () => {
            const ctx = currentSummaryErrorContext;
            dom.summaryFormatErrorModal.style.display = 'none';
            if (ctx && ctx.source === 'condense') {
                if (typeof ctx.onManualEdit === 'function') ctx.onManualEdit();
            } else {
                const targetConvId = dom.summaryFormatErrorModal.dataset.convId || state.currentConversationId;
                await resolvePendingSummaryError(targetConvId, 'ignore');
            }
        });
    }

    // 立即重新总结 / 重新生成
    if (dom.summaryErrorRetryBtn) {
        dom.summaryErrorRetryBtn.addEventListener('click', async () => {
            const ctx = currentSummaryErrorContext;
            dom.summaryFormatErrorModal.style.display = 'none';
            if (ctx && ctx.source === 'condense') {
                if (typeof ctx.onRetry === 'function') ctx.onRetry();
            } else {
                const targetConvId = dom.summaryFormatErrorModal.dataset.convId || state.currentConversationId;
                await resolvePendingSummaryError(targetConvId, 'retry');
            }
        });
    }
}

