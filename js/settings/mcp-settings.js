/**
 * @file mcp-settings.js
 * @description Handles MCP settings events.
 */

import { state } from '../state.js?v=260820-1';
import { saveToLocalStorage } from '../utils.js?v=260820-1';
import { notify } from '../ui-updater.js?v=260820-1';

export function setupMCPEvents() {
    const mcpSettingsSaveBtn = document.getElementById('mcp-settings-save-btn');
    if (mcpSettingsSaveBtn) {
        mcpSettingsSaveBtn.addEventListener('click', saveMCPSettings);
    }

    initMCPSettingsForm();
}

function saveMCPSettings() {
    const maxConcurrentPerSession = document.getElementById('mcp-max-concurrent-per-session');
    const maxGlobalConcurrent = document.getElementById('mcp-max-global-concurrent');
    const timeout = document.getElementById('mcp-timeout');
    const autoConfirm = document.getElementById('mcp-auto-confirm');
    const maxToolCallRounds = document.getElementById('mcp-max-tool-call-rounds');

    if (!maxConcurrentPerSession || !maxGlobalConcurrent || !timeout || autoConfirm === null) {
        notify.error('无法找到所有必要的表单元素！');
        return;
    }

    const maxPerSession = parseInt(maxConcurrentPerSession.value);
    const maxGlobal = parseInt(maxGlobalConcurrent.value);
    const timeoutValue = parseInt(timeout.value);

    if (isNaN(maxPerSession) || maxPerSession < 1 || maxPerSession > 20) {
        notify.error('单个会话最大并发数必须是1-20之间的整数！');
        return;
    }

    if (isNaN(maxGlobal) || maxGlobal < 1 || maxGlobal > 50) {
        notify.error('全局最大并发数必须是1-50之间的整数！');
        return;
    }

    if (isNaN(timeoutValue) || timeoutValue < 5 || timeoutValue > 300) {
        notify.error('超时时间必须是5-300秒之间的整数！');
        return;
    }

    if (maxGlobal < maxPerSession) {
        notify.error('全局最大并发数不能小于单个会话最大并发数！');
        return;
    }

    if (!state.mcpSettings) {
        state.mcpSettings = {};
    }

    state.mcpSettings.maxConcurrentPerSession = maxPerSession;
    state.mcpSettings.maxGlobalConcurrent = maxGlobal;
    state.mcpSettings.timeout = timeoutValue * 1000;
    state.mcpSettings.autoConfirm = autoConfirm.checked;

    // 乌鸦：保存最大调用轮次
    if (maxToolCallRounds) {
        const rounds = parseInt(maxToolCallRounds.value);
        if (!isNaN(rounds) && rounds >= 1 && rounds <= 20) {
            state.mcpSettings.maxToolCallRounds = rounds;
        }
    }

    saveToLocalStorage();

    notify.success('MCP并发控制设置已保存！');

    if (window.mcpSessionManager) {
        window.mcpSessionManager.updateSettings({
            maxConcurrentPerSession: maxPerSession,
            maxGlobalConcurrent: maxGlobal,
            timeout: timeoutValue,
            autoConfirm: autoConfirm.checked
        });
    }

    if (state.mcpSettings.selectedTools && state.mcpSettings.selectedTools.length > 0) {
        if (state.mcpSettings.selectedTools.length > maxPerSession) {
            state.mcpSettings.selectedTools = state.mcpSettings.selectedTools.slice(0, maxPerSession);
            saveToLocalStorage();
        }

        document.dispatchEvent(new CustomEvent('mcpToolsUpdated'));
    }
}

function initMCPSettingsForm() {
    const maxConcurrentPerSession = document.getElementById('mcp-max-concurrent-per-session');
    const maxGlobalConcurrent = document.getElementById('mcp-max-global-concurrent');
    const timeout = document.getElementById('mcp-timeout');
    const autoConfirm = document.getElementById('mcp-auto-confirm');

    if (!maxConcurrentPerSession || !maxGlobalConcurrent || !timeout || autoConfirm === null) {
        return;
    }

    const settings = state.mcpSettings || {};

    maxConcurrentPerSession.value = settings.maxConcurrentPerSession || 5;
    maxGlobalConcurrent.value = settings.maxGlobalConcurrent || 8;
    timeout.value = (settings.timeout || 30000) / 1000;
    autoConfirm.checked = settings.autoConfirm || false;

    // 乌鸦：初始化最大调用轮次
    const maxToolCallRounds = document.getElementById('mcp-max-tool-call-rounds');
    if (maxToolCallRounds) {
        maxToolCallRounds.value = settings.maxToolCallRounds || 10;
    }
}
