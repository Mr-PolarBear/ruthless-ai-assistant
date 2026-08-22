/**
 * @file export-config-modal.js
 * @description 专职负责应用配置多选导出弹窗交互与导出数据打包逻辑。
 * 支持自由多选导出 API、自定义全局正则（自动剔除系统默认规则）、角色预设、世界书、快捷提示词、MCP工具与应用设置。
 */

import { dom } from '../dom.js?v=260823';
import { state, DEFAULT_REGEX_RULES } from '../state.js?v=260823';
import { notify } from '../ui-updater.js?v=260823';

/**
 * 打开配置导出多选弹窗
 */
export function openExportConfigModal() {
    const modal = document.getElementById('export-config-modal');
    if (!modal) return;

    // 默认全选
    setAllConfigCheckboxes(true);

    modal.style.display = 'flex';
    modal.classList.add('visible');
}

/**
 * 关闭配置导出多选弹窗
 */
export function closeExportConfigModal() {
    const modal = document.getElementById('export-config-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    modal.style.display = 'none';
}

/**
 * 批量设置所有配置勾选框状态
 * @param {boolean} checked - 是否勾选
 */
function setAllConfigCheckboxes(checked) {
    const checkboxes = document.querySelectorAll('#export-config-modal input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = checked;
    });
}

/**
 * 执行按选定模块导出配置
 */
export function executeExportConfig() {
    const optApi = document.getElementById('export-opt-api')?.checked;
    const optRegex = document.getElementById('export-opt-regex')?.checked;
    const optPersonas = document.getElementById('export-opt-personas')?.checked;
    const optWorldBook = document.getElementById('export-opt-worldbook')?.checked;
    const optQuickPrompts = document.getElementById('export-opt-quickprompts')?.checked;
    const optMcp = document.getElementById('export-opt-mcp')?.checked;
    const optAppSettings = document.getElementById('export-opt-appsettings')?.checked;

    if (!optApi && !optRegex && !optPersonas && !optWorldBook && !optQuickPrompts && !optMcp && !optAppSettings) {
        if (typeof notify !== 'undefined' && notify.warning) {
            notify.warning('请至少选择一个要导出的配置项！');
        } else {
            alert('请至少选择一个要导出的配置项！');
        }
        return;
    }

    const configToExport = {
        version: '2.0',
        exportedAt: new Date().toISOString()
    };

    let exportedCategories = [];

    // 1. API 端点
    if (optApi) {
        configToExport.apiEndpoints = state.apiEndpoints || {};
        exportedCategories.push('API');
    }

    // 2. 自定义全局正则（严格排除系统默认规则与会话专属规则，仅导出用户创建的自定义全局规则）
    if (optRegex) {
        const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
        const customRules = {};
        if (state.regexRules && typeof state.regexRules === 'object') {
            for (const [id, rule] of Object.entries(state.regexRules)) {
                if (!defaultRuleKeys.includes(id) && (rule.scope === 'global' || !rule.scope)) {
                    customRules[id] = JSON.parse(JSON.stringify(rule));
                }
            }
        }
        configToExport.regexRules = customRules;
        exportedCategories.push('自定义全局正则');
    }

    // 3. 角色设定
    if (optPersonas) {
        configToExport.personas = state.personas || {};
        exportedCategories.push('角色');
    }

    // 4. 世界书 / 备忘录
    if (optWorldBook) {
        configToExport.worldBook = state.worldBook || {};
        exportedCategories.push('世界书');
    }

    // 5. 快捷提示词
    if (optQuickPrompts) {
        configToExport.quickPrompts = state.quickPrompts || [];
        exportedCategories.push('快捷提示词');
    }

    // 6. MCP 工具与全局设置
    if (optMcp) {
        configToExport.mcpSettings = state.mcpSettings || {};
        configToExport.mcpCustomTools = state.mcpCustomTools || {};
        exportedCategories.push('MCP配置');
    }

    // 7. 应用设置
    if (optAppSettings) {
        configToExport.appSettings = state.appSettings || {};
        exportedCategories.push('应用设置');
    }

    // 记录最新配置导出时间戳
    try {
        localStorage.setItem('last_config_backup_time', String(Date.now()));
    } catch (_) {}

    const configString = JSON.stringify(configToExport, null, 2);
    const blob = new Blob([configString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeExportConfigModal();
    if (typeof notify !== 'undefined' && notify.success) {
        notify.success(`配置导出成功 (${exportedCategories.join(', ')})`);
    }
}

/**
 * 初始化配置导出多选弹窗事件
 */
export function setupExportConfigModalEvents() {
    const modal = document.getElementById('export-config-modal');
    if (!modal) return;

    // 关闭按钮与取消按钮
    const closeBtn = document.getElementById('export-config-modal-close-btn');
    const cancelBtn = document.getElementById('export-config-cancel-btn');
    const confirmBtn = document.getElementById('export-config-confirm-btn');
    const selectAllBtn = document.getElementById('export-config-select-all');
    const deselectAllBtn = document.getElementById('export-config-deselect-all');

    if (closeBtn) closeBtn.addEventListener('click', closeExportConfigModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeExportConfigModal);
    if (confirmBtn) confirmBtn.addEventListener('click', executeExportConfig);

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => setAllConfigCheckboxes(true));
    }
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => setAllConfigCheckboxes(false));
    }

    // 点击背景遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeExportConfigModal();
        }
    });

    // 监听键盘 Esc 关闭
    document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('visible')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeExportConfigModal();
        }
    });
}
