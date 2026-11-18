/**
 * @file settings-modal.js
 * @description Handles the main application settings modal.
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { renderApiEndpointsList, renderPersonaModal, renderRegexRulesList } from '../ui-populator.js?v=temp';
import { resetRegexForm } from './regex-modal.js?v=temp';
import { updateBubbleSettingsUI } from '../settings/bubble-settings.js?v=temp';
import { updateStoragePersistenceUI } from '../services/storage-persistence.js?v=temp';
import { updateVersionCardUI } from '../services/version-checker.js?v=temp';

export async function openSettingsModal(targetTabName = null) {
    dom.autoRenderCheckbox.checked = state.appSettings.autoRenderTable;
    if (dom.autoExpandCodeCheckbox) {
        dom.autoExpandCodeCheckbox.checked = state.appSettings.autoExpandCode !== false; // 默认true
    }
    if (state.appSettings.sendKey === 'ctrl-enter') {
        if (dom.sendKeyCtrlEnter) dom.sendKeyCtrlEnter.checked = true;
    } else if (state.appSettings.sendKey === 'button-only') {
        if (dom.sendKeyButton) dom.sendKeyButton.checked = true;
    } else {
        if (dom.sendKeyEnter) dom.sendKeyEnter.checked = true;
    }
    const params = state.appSettings.modelParams;
    dom.paramTempInput.value = params.temperature;
    dom.paramTempValue.textContent = params.temperature;
    dom.paramTopPInput.value = params.top_p;
    dom.paramTopPValue.textContent = params.top_p;
    dom.paramEnableTopK.checked = !!params.enableTopK;
    dom.paramTopKInput.value = params.top_k;
    dom.paramTopKValue.textContent = params.top_k;
    dom.paramEnableMinP.checked = !!params.enableMinP;
    dom.paramMinPInput.value = params.min_p;
    dom.paramMinPValue.textContent = params.min_p;
    dom.paramMaxTokensInput.value = params.max_tokens;

    if(dom.userRenderModeSelector) {
        dom.userRenderModeSelector.value = state.appSettings.userMessageDefaultRenderMode || 'md';
    }
    if(dom.aiRenderModeSelector) {
        dom.aiRenderModeSelector.value = state.appSettings.aiMessageDefaultRenderMode || 'md';
    }

    // — 为什么这么写 —
    // 每次打开设置弹窗时同步全局数据库接口地址输入框，避免刷新前修改或导入配置后显示陈旧值
    if (dom.globalDbTableUrlInput) {
        dom.globalDbTableUrlInput.value = state.appSettings.dbTableFetchUrl || '';
    }

    renderApiEndpointsList();
    renderPersonaModal();
    renderRegexRulesList();
    resetRegexForm();
    updateBubbleSettingsUI();
    updateStoragePersistenceUI();
    updateVersionCardUI();
    
    // 初始化MCP管理界面
    try {
        const { initMCPManagement } = await import('../mcp-management.js?v=temp');
        initMCPManagement();
    } catch (err) {
        console.warn('❌ MCP管理模块加载失败:', err);
        setTimeout(async () => {
            try {
                const { initMCPManagement } = await import('../mcp-management.js?v=temp');
                initMCPManagement();
            } catch (retryErr) {
                console.error('❌ MCP管理模块重试仍失败:', retryErr);
            }
        }, 1000);
    }

    // — 为什么这么写 —
    // 1. 若外部指定了目标页签 (如 targetTabName = 'regex-settings')，直接精准激活该页签，实现外部快捷键/按钮秒级直达；
    // 2. 若未指定，则保持用户当前已有活跃页签；若均未激活，兜底激活首个页签。
    if (targetTabName) {
        const targetBtn = dom.settingsModal.querySelector(`.modal-tabs .tab-btn[data-tab="${targetTabName}"]`);
        if (targetBtn) {
            dom.settingsModal.querySelectorAll('.modal-tabs .tab-btn').forEach(t => t.classList.remove('active'));
            targetBtn.classList.add('active');
            dom.settingsModal.querySelectorAll('.modal-body > .tab-content').forEach(c => {
                c.classList.toggle('active', c.id === targetTabName);
            });
        }
    } else {
        const activeTabBtn = dom.settingsModal.querySelector('.modal-tabs .tab-btn.active');
        const activeTabContent = dom.settingsModal.querySelector('.modal-body > .tab-content.active');
        if (!activeTabBtn || !activeTabContent) {
            const firstTab = dom.settingsModal.querySelector('.modal-tabs .tab-btn');
            if (firstTab) {
                dom.settingsModal.querySelectorAll('.modal-tabs .tab-btn').forEach(t => t.classList.remove('active'));
                firstTab.classList.add('active');
                const targetContentId = firstTab.dataset.tab;
                dom.settingsModal.querySelectorAll('.modal-body > .tab-content').forEach(c => {
                    c.classList.toggle('active', c.id === targetContentId);
                });
            }
        }
    }

    dom.settingsModal.style.display = 'flex';
    dom.settingsModal.classList.add('visible');

    // — 为什么这么写 —
    // 打开设置弹窗后，若处于移动端单行滚动标签栏环境，确保当前已激活的标签按钮平滑滑入视野正中央
    requestAnimationFrame(() => {
        const currentActiveTab = dom.settingsModal.querySelector('.modal-tabs .tab-btn.active');
        if (currentActiveTab) {
            try {
                currentActiveTab.scrollIntoView({ block: 'nearest', inline: 'center' });
            } catch (_) {}
        }
    });
}

export function closeSettingsModal() {
    dom.settingsModal.classList.remove('visible');
    if (dom.importConfigTextarea) {
        dom.importConfigTextarea.value = '';
    }
    if (dom.importConversationTextarea) {
        dom.importConversationTextarea.value = '';
    }
}
