/**
 * @file settings-modal.js
 * @description Handles the main application settings modal.
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { renderApiEndpointsList, renderPersonaModal, renderRegexRulesList } from '../ui-populator.js';
import { updateBubbleSettingsUI } from '../settings/bubble-settings.js';

export async function openSettingsModal() {
    dom.autoRenderCheckbox.checked = state.appSettings.autoRenderTable;
    if (dom.autoExpandCodeCheckbox) {
        dom.autoExpandCodeCheckbox.checked = state.appSettings.autoExpandCode !== false; // 默认true
    }
    if (state.appSettings.sendKey === 'ctrl-enter') {
        dom.sendKeyCtrlEnter.checked = true;
    } else {
        dom.sendKeyEnter.checked = true;
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

    renderApiEndpointsList();
    renderPersonaModal();
    renderRegexRulesList();
    updateBubbleSettingsUI();
    
    // 初始化MCP管理界面
    try {
        const { initMCPManagement } = await import('../mcp-management.js');
        initMCPManagement();
    } catch (err) {
        console.warn('❌ MCP管理模块加载失败:', err);
        setTimeout(async () => {
            try {
                const { initMCPManagement } = await import('../mcp-management.js');
                initMCPManagement();
            } catch (retryErr) {
                console.error('❌ MCP管理模块重试仍失败:', retryErr);
            }
        }, 1000);
    }

    dom.settingsModal.style.display = 'flex';
    dom.settingsModal.classList.add('visible');
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
