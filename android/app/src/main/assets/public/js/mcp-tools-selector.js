/**
 * @file mcp-tools-selector.js
 * @description MCP工具选择器 - 用户界面交互
 */

import { state } from './state.js';
import { dom } from './dom.js';
import { DEFAULT_TOOLS } from './mcp-tools-registry.js';
import { saveToLocalStorage } from './utils.js';

/**
 * 乌鸦：初始化MCP工具选择器
 */
export function initMCPToolsSelector() {
    if (!dom.mcpToolsBtn || !dom.mcpToolsMenu) {
        console.warn('MCP工具选择器DOM元素不存在');
        return;
    }

    // 乌鸦：强制重置 selectedTools 为空数组，解决数字显示错误问题
    if (!state.mcpSettings.selectedTools || !Array.isArray(state.mcpSettings.selectedTools)) {
        state.mcpSettings.selectedTools = [];
    }

    // 乌鸦：检查并清理无效的工具ID
    if (state.mcpSettings.selectedTools.length > 0) {
        const allTools = {
            ...DEFAULT_TOOLS,
            ...(state.mcpCustomTools || {})
        };

        // 乌鸦：过滤掉不存在或已禁用的工具
        const validTools = state.mcpSettings.selectedTools.filter(toolId => {
            const tool = allTools[toolId];
            return tool && tool.enabled !== false;
        });

        if (validTools.length !== state.mcpSettings.selectedTools.length) {
            console.log(`乌鸦：清理无效工具，从 ${state.mcpSettings.selectedTools.length} 个减少到 ${validTools.length} 个`);
            state.mcpSettings.selectedTools = validTools;
            saveToLocalStorage();
        }
    }

    console.log('乌鸦：MCP工具选择器初始化，当前选中工具数量:', state.mcpSettings.selectedTools.length);

    // 乌鸦：点击按钮显示/隐藏菜单
    dom.mcpToolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMCPToolsMenu();
    });

    // 乌鸦：点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
        if (!dom.mcpToolsBtn.contains(e.target) && !dom.mcpToolsMenu.contains(e.target)) {
            hideMCPToolsMenu();
        }
    });

    // 乌鸦：初始化时渲染菜单内容
    renderMCPToolsMenu();
    updateSelectedBadge();

    // 乌鸦：监听工具更新事件
    document.addEventListener('mcpToolsUpdated', () => {
        renderMCPToolsMenu();
        updateSelectedBadge();
    });
}

function positionPopupNearButton(button, popup) {
    if (!button || !popup) return;

    const rect = button.getBoundingClientRect();
    const popupWidth = popup.offsetWidth || 700;
    const popupHeight = popup.offsetHeight || 300;
    const gap = 8;

    let left = rect.left;
    let bottom = window.innerHeight - rect.top + gap;

    if (left + popupWidth > window.innerWidth - 10) {
        left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) {
        left = 10;
    }

    if (bottom + popupHeight > window.innerHeight - 10) {
        bottom = window.innerHeight - popupHeight - 10;
    }

    popup.style.left = `${left}px`;
    popup.style.bottom = `${bottom}px`;
}

function toggleMCPToolsMenu() {
    if (dom.mcpToolsMenu.style.display === 'none') {
        showMCPToolsMenu();
    } else {
        hideMCPToolsMenu();
    }
}

function showMCPToolsMenu() {
    renderMCPToolsMenu();
    dom.mcpToolsMenu.style.display = 'flex';
    positionPopupNearButton(dom.mcpToolsBtn, dom.mcpToolsMenu);
}

function hideMCPToolsMenu() {
    dom.mcpToolsMenu.style.display = 'none';
}

/**
 * 乌鸦：渲染MCP工具菜单
 */
function renderMCPToolsMenu() {
    // 乌鸦：获取所有工具（内置 + 自定义）
    const allTools = {
        ...(DEFAULT_TOOLS || {}),
        ...(state.mcpCustomTools || {})
    };
    const tools = Object.values(allTools).filter(tool => tool.enabled);
    const selectedTools = state.mcpSettings.selectedTools || [];

    // 乌鸦：构建菜单头部HTML
    const headerHTML = `
        <div class="mcp-menu-header">
            <div class="mcp-menu-title-row">
                <div class="mcp-menu-title"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>选择MCP工具</div>
                <div class="mcp-menu-actions">
                    <button class="mcp-clear-btn" onclick="clearMCPToolSelection()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>清空选择</button>
                    <button class="mcp-manage-btn" onclick="openMCPManagement()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>管理工具</button>
                </div>
            </div>
            <div class="mcp-menu-subtitle">最多选择5个工具 (${selectedTools.length}/5)</div>
        </div>
    `;

    // 乌鸦：构建工具列表HTML
    let listHTML = '';
    tools.forEach(tool => {
        const isSelected = selectedTools.includes(tool.id);
        const isDisabled = !isSelected && selectedTools.length >= 5;

        listHTML += `
            <div class="mcp-tool-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}"
                 data-tool-id="${tool.id}">
                <input type="checkbox" class="mcp-tool-checkbox" 
                       ${isSelected ? 'checked' : ''} 
                       ${isDisabled ? 'disabled' : ''}>
                <div class="mcp-tool-info">
                    <div class="mcp-tool-name">${tool.name}</div>
                    <div class="mcp-tool-desc">${tool.description.substring(0, 80)}${tool.description.length > 80 ? '...' : ''}</div>
                </div>
            </div>
        `;
    });

    // 乌鸦：将头部和列表组合，列表放在可滚动的容器中
    dom.mcpToolsMenu.innerHTML = headerHTML + `<div class="mcp-tool-list">${listHTML}</div>`;

    // 乌鸦：绑定工具项点击事件
    dom.mcpToolsMenu.querySelectorAll('.mcp-tool-item').forEach(item => {
        item.addEventListener('click', handleToolItemClick);
    });
}

/**
 * 乌鸦：处理工具项点击事件
 */
function handleToolItemClick(e) {
    const toolItem = e.currentTarget;
    const toolId = toolItem.dataset.toolId;
    const checkbox = toolItem.querySelector('.mcp-tool-checkbox');

    // 乌鸦：在函数开头缓存DOM查询结果
    const subtitle = dom.mcpToolsMenu.querySelector('.mcp-menu-subtitle');
    const allToolItems = dom.mcpToolsMenu.querySelectorAll('.mcp-tool-item');

    // 乌鸦：如果是禁用状态，不处理
    if (toolItem.classList.contains('disabled')) {
        e.preventDefault();
        return;
    }

    // 乌鸦：切换选择状态
    const selectedTools = state.mcpSettings.selectedTools || [];
    const isCurrentlySelected = selectedTools.includes(toolId);

    if (isCurrentlySelected) {
        // 乌鸦：取消选择
        state.mcpSettings.selectedTools = selectedTools.filter(id => id !== toolId);
    } else {
        // 乌鸦：添加选择（最多5个）
        if (selectedTools.length < 5) {
            state.mcpSettings.selectedTools = [...selectedTools, toolId];
        }
    }

    // 乌鸦：保存到本地存储
    saveToLocalStorage();

    // 乌鸦：更新选择状态UI（不重新渲染整个菜单）
    toolItem.classList.toggle('selected', !isCurrentlySelected);
    checkbox.checked = !isCurrentlySelected;
    updateSelectedBadge();

    // 乌鸦：更新菜单标题中的计数（使用缓存的元素）
    if (subtitle) {
        const newCount = state.mcpSettings.selectedTools.length;
        subtitle.textContent = `最多选择5个工具 (${newCount}/5)`;
    }

    // 乌鸦：更新其他工具项的禁用状态（使用缓存的NodeList）
    allToolItems.forEach(item => {
        const itemId = item.dataset.toolId;
        const itemSelected = state.mcpSettings.selectedTools.includes(itemId);
        const shouldDisable = !itemSelected && state.mcpSettings.selectedTools.length >= 5;

        item.classList.toggle('disabled', shouldDisable);
        const itemCheckbox = item.querySelector('.mcp-tool-checkbox');
        if (itemCheckbox) {
            itemCheckbox.disabled = shouldDisable;
        }
    });

    // 乌鸦：根据选择的工具数量自动调整并发控制设置
    updateMCPConcurrencySettings();

    console.log('MCP工具选择更新:', state.mcpSettings.selectedTools);
}

/**
 * 乌鸦：根据选择的工具数量自动调整并发控制设置
 */
function updateMCPConcurrencySettings() {
    const selectedToolsCount = state.mcpSettings.selectedTools ? state.mcpSettings.selectedTools.length : 0;

    // 乌鸦：确保mcpSettings对象存在
    if (!state.mcpSettings) {
        state.mcpSettings = {};
    }

    // 乌鸦：根据选择的工具数量调整并发控制设置
    if (selectedToolsCount > 0) {
        // 乌鸦：如果有选中的工具，确保并发控制设置合理
        if (!state.mcpSettings.maxConcurrentPerSession) {
            state.mcpSettings.maxConcurrentPerSession = Math.min(5, Math.max(2, selectedToolsCount));
        }
        if (!state.mcpSettings.maxGlobalConcurrent) {
            state.mcpSettings.maxGlobalConcurrent = Math.min(10, Math.max(3, selectedToolsCount * 2));
        }
        if (!state.mcpSettings.timeout) {
            state.mcpSettings.timeout = 30000;
        }

        // 乌鸦：确保全局并发数不小于单个会话并发数
        if (state.mcpSettings.maxGlobalConcurrent < state.mcpSettings.maxConcurrentPerSession) {
            state.mcpSettings.maxGlobalConcurrent = state.mcpSettings.maxConcurrentPerSession;
        }
    }

    // 乌鸦：保存到本地存储
    saveToLocalStorage();

    // 乌鸦：如果MCP会话管理器已加载，需要更新其配置
    if (window.mcpSessionManager && typeof window.mcpSessionManager.updateSettings === 'function') {
        window.mcpSessionManager.updateSettings({
            maxConcurrentPerSession: state.mcpSettings.maxConcurrentPerSession,
            maxGlobalConcurrent: state.mcpSettings.maxGlobalConcurrent
        });
    }
}

/**
 * 乌鸦：更新选择数量徽章
 */
function updateSelectedBadge() {
    const selectedCount = (state.mcpSettings.selectedTools || []).length;
    const badge = document.getElementById('mcp-selected-count');

    console.log(`乌鸦：更新badge，选中工具数量: ${selectedCount}`);

    if (badge) {
        if (selectedCount > 0) {
            badge.textContent = selectedCount;
            badge.style.display = 'flex';
            console.log(`乌鸦：badge显示数字: ${selectedCount}`);
        } else {
            badge.style.display = 'none';
            console.log('乌鸦：badge隐藏');
        }
    } else {
        console.warn('乌鸦：找不到badge元素');
    }
}

/**
 * 乌鸦：获取用户选择的工具描述（用于系统提示词）
 * @returns {string} 选择的工具描述
 */
export function getSelectedToolsDescription() {
    if (!state.mcpSettings.enabled) {
        return '';
    }

    const selectedToolIds = state.mcpSettings.selectedTools || [];
    if (selectedToolIds.length === 0) {
        return '';
    }

    // 乌鸦：获取所有工具（内置 + 自定义）
    const allTools = {
        ...DEFAULT_TOOLS,
        ...(state.mcpCustomTools || {})
    };

    const tools = Object.values(allTools).filter(tool =>
        tool.enabled && selectedToolIds.includes(tool.id)
    );

    if (tools.length === 0) {
        return '';
    }

    let description = '\n[可用工具]\n';
    tools.forEach(tool => {
        description += `\n**${tool.name}** (${tool.id}):\n`;
        description += `${tool.description}\n`;
        description += '参数:\n';

        Object.entries(tool.parameters || {}).forEach(([paramName, paramConfig]) => {
            const required = paramConfig.required ? '(必需)' : '(可选)';
            description += `- ${paramName} ${required}: ${paramConfig.description}\n`;
        });
    });

    description += '\n使用工具时(如多个工具结果不影响，请一次性使用多个工具，减少用户等待时间，请使用数组格式或者每个工具使用单独的代码块包裹)，请用以下格式：\n';
    description += '```tool_call\n{"tool": "工具ID", "parameters": {"参数名": "参数值"}}\n```\n';
    description += '\n**重要:** 如果你希望在工具执行后，能够看到并分析工具返回的结果(或者用户要求进行结果分析)，请在JSON中增加一个`"process_result": true`字段。系统会在工具执行完毕后，将结果返回给你进行下一步处理。例如：\n';
    description += '```tool_call\n{"tool": "工具ID", "parameters": {"参数名": "参数值"}, "process_result": true}\n```\n';

    // 乌鸦：上下文切换提示——用户可能在不同轮次切换了工具
    description += '\n**注意:** 上述"[可用工具]"列表是用户**当前选择**的工具，可能与之前对话中使用过的工具不同。请**仅使用上述列表中的工具**，不要调用不在列表中的工具。如果用户的新提问与之前的工具结果无关，请直接基于当前可用工具回答新问题。\n';

    // 乌鸦：多轮调用提示
    const maxRounds = state.mcpSettings?.maxToolCallRounds || 10;
    description += `\n**多轮调用:** 你可以在分析工具结果后继续调用新的工具。系统支持最多${maxRounds}轮工具调用，每轮结果会自动返回给你分析。请合理规划调用链，在需要更多信息时继续使用 process_result: true 调用工具。\n`;

    return description;
}

/**
 * 乌鸦：检查工具是否被用户选择
 * @param {string} toolId - 工具ID
 * @returns {boolean} 是否被选择
 */
export function isToolSelected(toolId) {
    return (state.mcpSettings.selectedTools || []).includes(toolId);
}

/**
 * 乌鸦：打开MCP工具管理界面
 */
function openMCPManagement() {
    // 乌鸦：首先隐藏当前菜单
    hideMCPToolsMenu();

    // 乌鸦：打开设置模态框并切换到MCP管理选项卡
    import('./modals.js').then(module => {
        module.openSettingsModal();
        // 乌鸦：切换到MCP管理选项卡（需要先创建这个选项卡）
        setTimeout(() => {
            const mcpTab = document.querySelector('[data-tab="mcp-management"]');
            if (mcpTab) {
                mcpTab.click();
            }
        }, 100);
    });
}

/**
 * 乌鸦：清空MCP工具选择
 */
function clearMCPToolSelection() {
    // 乌鸦：清空选中的工具
    state.mcpSettings.selectedTools = [];

    // 乌鸦：保存到本地存储
    saveToLocalStorage();

    // 乌鸦：更新UI
    updateSelectedBadge();

    // 乌鸦：重新渲染菜单
    renderMCPToolsMenu();

    console.log('乌鸦：已清空MCP工具选择');
}

// 乌鸦：将管理函数暴露到全局作用域
window.openMCPManagement = openMCPManagement;
window.clearMCPToolSelection = clearMCPToolSelection;