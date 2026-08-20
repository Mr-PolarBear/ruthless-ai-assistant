/**
 * @file mcp-management.js
 * @description MCP工具管理界面模块 - 增删改查和拖拽排序
 */

import { state } from './state.js';
import { saveToLocalStorage } from './utils.js';
import { DEFAULT_TOOLS, RISK_LEVELS } from './mcp-tools-registry.js';
import { DraggableList } from './draggable-list.js';
import { notify } from './ui-updater.js';

let mcpToolsDragInstance = null;

/**
 * 乌鸦：初始化MCP管理界面
 */
export function initMCPManagement() {
    const addBtn = document.getElementById('add-new-mcp-tool-btn');
    const importBtn = document.getElementById('import-mcp-tools-btn');
    const exportBtn = document.getElementById('export-mcp-tools-btn');
    const saveBtn = document.getElementById('mcp-tool-save-btn');
    const cancelBtn = document.getElementById('mcp-tool-cancel-btn');
    
    if (addBtn) {
        addBtn.addEventListener('click', showMCPToolForm);
    }
    
    if (importBtn) {
        importBtn.addEventListener('click', importMCPTools);
    }
    
    if (exportBtn) {
        exportBtn.addEventListener('click', exportMCPTools);
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', saveMCPTool);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideMCPToolForm);
    }
    
    // 乌鸦：添加参数按钮
    const addParamBtn = document.getElementById('add-mcp-parameter-btn');
    if (addParamBtn) {
        addParamBtn.addEventListener('click', addMCPParameter);
    }
    
    // 乌鸦：自定义模板切换事件
    const templateToggle = document.getElementById('mcp-tool-template-enabled');
    if (templateToggle) {
        templateToggle.addEventListener('change', toggleTemplateConfig);
    }
    
    // 乌鸦：模板预览按钮 - 功能待开发，暂时禁用
    // const previewBtn = document.getElementById('preview-template-btn');
    // if (previewBtn) {
    //     previewBtn.addEventListener('click', previewTemplate);
    // }
    
    // 乌鸦：初始化渲染
    renderMCPToolsList();
}

/**
 * 乌鸦：渲染MCP工具列表
 */
function renderMCPToolsList() {
    const container = document.getElementById('mcp-tools-list');
    if (!container) return;
    
    const allTools = getEffectiveTools();
    
    const tools = Object.values(allTools)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    
    if (tools.length === 0) {
        container.innerHTML = '<div class="settings-hint">暂无MCP工具，点击上方"添加新工具"按钮来创建。</div>';
        return;
    }
    
    const editSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
    const copySVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    const deleteSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

    let html = '';
    tools.forEach(tool => {
        const isBuiltIn = !!DEFAULT_TOOLS[tool.id];
        const isEnabled = tool.enabled !== false;
        const endpoint = tool.endpoint?.url || '';
        const method = tool.endpoint?.method || 'GET';
        const riskLevel = tool.riskLevel || 'read';
        
        html += `
            <li class="mcp-tool-item ${!isEnabled ? 'disabled' : ''}" data-tool-id="${tool.id}">
                <div class="mcp-tool-item-content">
                    <div class="mcp-tool-name">
                        ${tool.name}
                        ${isBuiltIn ? '<span style="font-size:11px;color:#666;margin-left:8px;">[内置]</span>' : ''}
                    </div>
                    <div class="mcp-tool-desc">${tool.description}</div>
                    <div class="mcp-tool-meta">
                        <span class="mcp-tool-endpoint">${method} ${endpoint}</span>
                        <span class="mcp-tool-risk ${riskLevel}">${getRiskLevelText(riskLevel)}</span>
                    </div>
                </div>
                <div class="mcp-tool-item-actions action-btn-group">
                    <label class="theme-switch small mcp-tool-toggle-switch" title="启用/禁用">
                        <input type="checkbox" data-id="${tool.id}" ${isEnabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                    <button class="action-btn edit mcp-tool-edit-btn" data-tool-id="${tool.id}" title="编辑">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn copy mcp-tool-copy-btn" data-tool-id="${tool.id}" title="复制">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    ${!isBuiltIn ? `
                    <button class="action-btn delete mcp-tool-delete-btn" data-tool-id="${tool.id}" title="删除">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>` : ''}
                </div>
            </li>
        `;
    });
    
    container.innerHTML = html;
    
    bindMCPToolsListEvents();
    initMCPToolsDragSort();
}

/**
 * 乌鸦：绑定工具列表事件
 */
function bindMCPToolsListEvents() {
    const container = document.getElementById('mcp-tools-list');
    if (!container) return;
    
    // 乌鸦：启用/禁用开关事件
    container.querySelectorAll('.mcp-tool-toggle-switch input').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            const toolId = e.target.dataset.id;
            toggleMCPTool(toolId, e.target.checked);
        });
    });
    
    // 乌鸦：编辑按钮事件
    container.querySelectorAll('.mcp-tool-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const toolId = btn.dataset.toolId;
            editMCPTool(toolId);
        });
    });

    // 乌鸦：复制按钮事件
    container.querySelectorAll('.mcp-tool-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const toolId = btn.dataset.toolId;
            copyMCPTool(toolId);
        });
    });
    
    // 乌鸦：删除按钮事件
    container.querySelectorAll('.mcp-tool-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const toolId = btn.dataset.toolId;
            deleteMCPTool(toolId);
        });
    });
}

/**
 * 乌鸦：复制MCP工具
 * @param {string} toolId - 要复制的工具ID
 */
function copyMCPTool(toolId) {
    const allTools = getEffectiveTools();
    const toolToCopy = allTools[toolId];

    if (!toolToCopy) {
        notify.error('未找到要复制的工具！');
        return;
    }

    if (confirm(`确定要复制工具 "${toolToCopy.name}" 吗？`)) {
        const newTool = JSON.parse(JSON.stringify(toolToCopy));
        newTool.id = `custom_${Date.now()}`;
        newTool.name = `${toolToCopy.name}_copy`;
        
        delete newTool.isBuiltIn; 

        if (!state.mcpCustomTools) {
            state.mcpCustomTools = {};
        }
        state.mcpCustomTools[newTool.id] = newTool;
        
        saveToLocalStorage();
        renderMCPToolsList();
        notify.success(`工具 "${toolToCopy.name}" 已成功复制！`);
    }
}


/**
 * 乌鸦：初始化拖拽排序
 */
function initMCPToolsDragSort() {
    const container = document.getElementById('mcp-tools-list');
    if (!container) return;
    
    if (mcpToolsDragInstance) {
        mcpToolsDragInstance.destroy();
    }
    
    mcpToolsDragInstance = new DraggableList(container, {
        itemSelector: '.mcp-tool-item',
        onDrop: (fromIndex, toIndex) => {
            const allTools = getEffectiveTools();
            
            const tools = Object.values(allTools)
                .sort((a, b) => (a.sort || 0) - (b.sort || 0));
            
            if (fromIndex >= tools.length || toIndex >= tools.length) return;
            
            const [movedTool] = tools.splice(fromIndex, 1);
            tools.splice(toIndex, 0, movedTool);
            
            tools.forEach((tool, index) => {
                tool.sort = (index + 1) * 10;
                
                if (DEFAULT_TOOLS[tool.id]) {
                    if (!state.mcpToolStates) state.mcpToolStates = {};
                    if (!state.mcpToolStates[tool.id]) {
                        state.mcpToolStates[tool.id] = { enabled: tool.enabled !== false };
                    }
                    state.mcpToolStates[tool.id].sort = tool.sort;
                } else {
                    if (!state.mcpCustomTools) state.mcpCustomTools = {};
                    if (state.mcpCustomTools[tool.id]) {
                        state.mcpCustomTools[tool.id].sort = tool.sort;
                    }
                }
            });
            
            saveToLocalStorage();
            renderMCPToolsList();
        }
    });
}

/**
 * 乌鸦：获取下一个sort值，确保新工具排在最后
 */
function getNextSortValue() {
    const allTools = getEffectiveTools();
    const sortValues = Object.values(allTools).map(tool => tool.sort || 0);
    
    if (sortValues.length === 0) {
        return 10;
    }
    
    const maxSort = Math.max(...sortValues);
    return maxSort + 10;
}

/**
 * 乌鸦：切换工具启用状态
 */
function toggleMCPTool(toolId, enabled) {
    const tool = getEffectiveTools()[toolId];
    if (!tool) return;
    
    if (DEFAULT_TOOLS[toolId]) {
        if (!state.mcpToolStates) state.mcpToolStates = {};
        state.mcpToolStates[toolId] = { ...(state.mcpToolStates[toolId] || {}), enabled };
    } else {
        if (!state.mcpCustomTools) state.mcpCustomTools = {};
        if (state.mcpCustomTools[toolId]) {
            state.mcpCustomTools[toolId].enabled = enabled;
        }
    }
    
    saveToLocalStorage();
    renderMCPToolsList();
}

/**
 * 乌鸦：显示工具表单
 */
function showMCPToolForm(toolData = null) {
    const container = document.getElementById('mcp-tool-form-container');
    const title = document.getElementById('mcp-tool-form-title');
    const idInput = document.getElementById('mcp-tool-id-input');
    
    if (!container) return;
    
    container.style.display = 'block';
    title.textContent = toolData ? '编辑工具' : '添加工具';
    
    if (toolData) {
        idInput.value = toolData.id;
        fillMCPToolForm(toolData);
    } else {
        idInput.value = '';
        resetMCPToolForm();
    }
    
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 乌鸦：隐藏工具表单
 */
function hideMCPToolForm() {
    const container = document.getElementById('mcp-tool-form-container');
    if (container) {
        container.style.display = 'none';
    }
    resetMCPToolForm();
}

/**
 * 乌鸦：填充工具表单
 */
function fillMCPToolForm(tool) {
    document.getElementById('mcp-tool-name-input').value = tool.name || '';
    document.getElementById('mcp-tool-description-input').value = tool.description || '';
    document.getElementById('mcp-tool-endpoint-input').value = tool.endpoint?.url || '';
    document.getElementById('mcp-tool-method-select').value = tool.endpoint?.method || 'GET';
    document.getElementById('mcp-tool-risk-select').value = tool.riskLevel || 'read';
    document.getElementById('mcp-tool-enabled-toggle').checked = tool.enabled !== false;
    
    renderMCPParameters(tool.parameters || {});
    
    const customTemplate = tool.customTemplate || {};
    const templateToggle = document.getElementById('mcp-tool-template-enabled');
    const htmlTemplate = document.getElementById('mcp-tool-html-template');
    
    if (templateToggle) {
        templateToggle.checked = customTemplate.enabled || false;
        toggleTemplateConfig();
    }
    
    if (htmlTemplate) {
        htmlTemplate.value = customTemplate.htmlTemplate || '';
    }
}

/**
 * 乌鸦：重置工具表单
 */
function resetMCPToolForm() {
    document.getElementById('mcp-tool-name-input').value = '';
    document.getElementById('mcp-tool-description-input').value = '';
    document.getElementById('mcp-tool-endpoint-input').value = '';
    document.getElementById('mcp-tool-method-select').value = 'GET';
    document.getElementById('mcp-tool-risk-select').value = 'read';
    document.getElementById('mcp-tool-enabled-toggle').checked = true;
    
    renderMCPParameters({});
    
    const templateToggle = document.getElementById('mcp-tool-template-enabled');
    const htmlTemplate = document.getElementById('mcp-tool-html-template');
    
    if (templateToggle) {
        templateToggle.checked = false;
        toggleTemplateConfig();
    }
    
    if (htmlTemplate) {
        htmlTemplate.value = '';
    }
}

/**
 * 乌鸦：渲染参数配置
 */
function renderMCPParameters(parameters = {}) {
    const container = document.getElementById('mcp-tool-parameters-container');
    if (!container) return;
    
    let html = '';
    Object.entries(parameters).forEach(([name, config]) => {
        html += createParameterHTML(name, config);
    });
    
    container.innerHTML = html;
    
    container.querySelectorAll('.mcp-parameter-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.mcp-parameter-item').remove();
        });
    });
}

/**
 * 乌鸦：创建参数HTML
 */
function createParameterHTML(name = '', config = {}) {
    return `
        <div class="mcp-parameter-item">
            <div class="form-group">
                <label>参数名</label>
                <input type="text" class="param-name" value="${name}" placeholder="参数名">
            </div>
            <div class="form-group">
                <label>类型</label>
                <select class="param-type">
                    <option value="string" ${config.type === 'string' ? 'selected' : ''}>字符串</option>
                    <option value="number" ${config.type === 'number' ? 'selected' : ''}>数字</option>
                    <option value="boolean" ${config.type === 'boolean' ? 'selected' : ''}>布尔值</option>
                </select>
            </div>
            <div class="form-group">
                <label>描述</label>
                <input type="text" class="param-description" value="${config.description || ''}" placeholder="参数描述">
            </div>
            <div class="form-group">
                <label>是否必需</label>
                <input type="checkbox" class="param-required" ${config.required ? 'checked' : ''}>
            </div>
            <button type="button" class="mcp-parameter-remove-btn">删除</button>
        </div>
    `;
}

/**
 * 乌鸦：添加参数
 */
function addMCPParameter() {
    const container = document.getElementById('mcp-tool-parameters-container');
    if (!container) return;
    
    const paramHTML = createParameterHTML();
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = paramHTML;
    const paramElement = tempDiv.firstElementChild;
    
    container.appendChild(paramElement);
    
    const removeBtn = paramElement.querySelector('.mcp-parameter-remove-btn');
    removeBtn.addEventListener('click', () => {
        paramElement.remove();
    });
}

/**
 * 乌鸦：保存工具
 */
function saveMCPTool() {
    const idInput = document.getElementById('mcp-tool-id-input');
    const nameInput = document.getElementById('mcp-tool-name-input');
    const descInput = document.getElementById('mcp-tool-description-input');
    const endpointInput = document.getElementById('mcp-tool-endpoint-input');
    const methodSelect = document.getElementById('mcp-tool-method-select');
    const riskSelect = document.getElementById('mcp-tool-risk-select');
    const enabledToggle = document.getElementById('mcp-tool-enabled-toggle');
    
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const endpoint = endpointInput.value.trim();
    
    if (!name || !description || !endpoint) {
        alert('请填写完整的工具信息！');
        return;
    }
    
    const parameters = {};
    document.querySelectorAll('.mcp-parameter-item').forEach(item => {
        const paramName = item.querySelector('.param-name').value.trim();
        const paramType = item.querySelector('.param-type').value;
        const paramDesc = item.querySelector('.param-description').value.trim();
        const paramRequired = item.querySelector('.param-required').checked;
        
        if (paramName) {
            parameters[paramName] = {
                type: paramType,
                description: paramDesc,
                required: paramRequired
            };
        }
    });
    
    const customTemplate = {};
    const templateEnabled = document.getElementById('mcp-tool-template-enabled')?.checked;
    const htmlTemplate = document.getElementById('mcp-tool-html-template')?.value;
    
    if (templateEnabled && htmlTemplate) {
        customTemplate.enabled = true;
        customTemplate.htmlTemplate = htmlTemplate || '';
    } else {
        customTemplate.enabled = false;
    }
    
    const toolData = {
        id: idInput.value || `custom_${Date.now()}`,
        name,
        description,
        enabled: enabledToggle.checked,
        riskLevel: riskSelect.value,
        endpoint: {
            url: endpoint,
            method: methodSelect.value,
            headers: { 'Content-Type': 'application/json' }
        },
        parameters,
        customTemplate,
        sort: getNextSortValue()
    };
    
    if (DEFAULT_TOOLS[toolData.id]) {
        alert('内置工具不能被编辑，请创建新的自定义工具。');
        return;
    }
    
    if (!state.mcpCustomTools) {
        state.mcpCustomTools = {};
    }
    state.mcpCustomTools[toolData.id] = toolData;
    
    saveToLocalStorage();
    renderMCPToolsList();
    hideMCPToolForm();
}

/**
 * 乌鸦：编辑工具
 */
function editMCPTool(toolId) {
    const tool = getEffectiveTools()[toolId];
    if (!tool) return;
    
    if (DEFAULT_TOOLS[toolId]) {
        if (confirm('内置工具不能被编辑。\n是否要复制一份该工具来进行修改？')) {
            copyMCPTool(toolId);
        }
        return;
    }
    
    showMCPToolForm(tool);
}

/**
 * 乌鸦：删除工具
 */
function deleteMCPTool(toolId) {
    if (DEFAULT_TOOLS[toolId]) {
        alert('内置工具不能被删除！');
        return;
    }
    
    if (!confirm('确定要删除这个工具吗？此操作不可撤销。')) {
        return;
    }
    
    if (state.mcpCustomTools && state.mcpCustomTools[toolId]) {
        delete state.mcpCustomTools[toolId];
        saveToLocalStorage();
        renderMCPToolsList();
    }
}

/**
 * 乌鸦：导出工具配置
 */
function exportMCPTools() {
    const allTools = getEffectiveTools();
    
    const exportData = {
        mcpTools: allTools,
        mcpToolStates: state.mcpToolStates || {},
        exportTime: new Date().toISOString(),
        version: '1.0'
    };
    
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-tools-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 乌鸦：导入工具配置
 */
function importMCPTools() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importData = JSON.parse(event.target.result);
                
                if (!importData.mcpTools) {
                    alert('导入文件格式错误！');
                    return;
                }
                
                if (!state.mcpCustomTools) {
                    state.mcpCustomTools = {};
                }
                
                let importCount = 0;
                Object.entries(importData.mcpTools).forEach(([id, tool]) => {
                    if (!DEFAULT_TOOLS[id]) {
                        let newId = id;
                        if (state.mcpCustomTools[newId]) {
                            newId = `${id}_${Date.now()}`;
                        }
                        
                        state.mcpCustomTools[newId] = {
                            ...tool,
                            id: newId
                        };
                        importCount++;
                    }
                });
                
                if (importData.mcpToolStates) {
                    state.mcpToolStates = {
                        ...(state.mcpToolStates || {}),
                        ...importData.mcpToolStates
                    };
                }
                
                saveToLocalStorage();
                renderMCPToolsList();
                
                document.dispatchEvent(new CustomEvent('mcpToolsUpdated'));
                
                alert(`成功导入 ${importCount} 个自定义工具！`);
                
            } catch (error) {
                console.error('导入失败:', error);
                alert('导入文件格式错误或文件损坏！');
            }
        };
        
        reader.readAsText(file);
    });
    
    input.click();
}

/**
 * 乌鸦：获取风险等级文本
 */
function getRiskLevelText(riskLevel) {
    const texts = {
        'read': '只读',
        'write': '写入',
        'delete': '删除'
    };
    return texts[riskLevel] || riskLevel;
}

/**
 * 乌鸦：获取有效的工具（包含状态）
 */
export function getEffectiveTools() {
    const allTools = {
        ...DEFAULT_TOOLS,
        ...(state.mcpCustomTools || {})
    };
    
    const toolStates = state.mcpToolStates || {};
    
    Object.keys(allTools).forEach(toolId => {
        if (toolStates[toolId]) {
            allTools[toolId] = {
                ...allTools[toolId],
                ...toolStates[toolId]
            };
        }
    });
    
    return allTools;
}

/**
 * 乌鸦：切换模板配置显示
 */
function toggleTemplateConfig() {
    const toggle = document.getElementById('mcp-tool-template-enabled');
    const configSection = document.getElementById('mcp-template-config');
    
    if (toggle && configSection) {
        configSection.style.display = toggle.checked ? 'block' : 'none';
    }
}

/**
 * 乌鸦：预览模板效果
 */
function previewTemplate() {
    const htmlTemplateInput = document.getElementById('mcp-tool-html-template');
    if (!htmlTemplateInput) {
        alert('无法找到HTML模板输入框');
        return;
    }
    
    const htmlTemplate = htmlTemplateInput.value;
    if (!htmlTemplate) {
        alert('请先输入HTML模板');
        return;
    }
    
    // 乌鸦：先打开预览窗口，显示加载状态，避免卡死的感觉
    const previewWindow = window.open('', '_blank', 'width=600,height=400');
    if (!previewWindow) {
        alert('浏览器拦截了弹窗，请允许弹窗权限后重试');
        return;
    }
    
    // 乌鸦：显示加载中的状态
    previewWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>模板预览</title>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                    margin: 20px; 
                    background: #f5f5f5;
                }
                .loading { text-align: center; color: #666; padding: 40px; }
            </style>
        </head>
        <body>
            <div class="loading">⏳ 预览生成中...</div>
        </body>
        </html>
    `);
    previewWindow.document.close();
    
    const mockData = {
        word: '天行数据',
        type_text: '藏头诗',
        format_text: '五言诗',
        formatted_content: '天地如有知，\n行春潘令至。\n数亩子平居，\n据一陵二小。',
        city: '北京',
        temperature: '25',
        description: '晴天',
        humidity: '60',
        windSpeed: '5.2',
        timestamp: new Date().toLocaleString(),
        api_status: '成功',
        tool_name: '模拟工具'
    };
    
    // 乌鸦：使用 setTimeout 让模块加载异步执行，不阻塞主线程
    setTimeout(() => {
        try {
            import('./mcp-template-engine.js').then(({ processTemplate, preprocessApiData }) => {
                try {
                    const mockTool = {
                        id: 'preview_tool',
                        name: '预览工具',
                        lastCallParams: { word: '天行数据' }
                    };
                    
                    const processedData = preprocessApiData(mockData, mockTool, mockTool.lastCallParams);
                    let previewHtml = processTemplate(htmlTemplate, processedData);
                    
                    // 乌鸦：更新窗口内容
                    previewWindow.document.open();
                    previewWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>模板预览</title>
                            <meta charset="utf-8">
                            <style>
                                body { 
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                                    margin: 20px; 
                                    background: #f5f5f5;
                                }
                            </style>
                        </head>
                        <body>
                            <h2>👁️ 模板预览效果</h2>
                            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                ${previewHtml}
                            </div>
                            <p style="color: #666; margin-top: 20px; font-size: 14px;">
                                ℹ️ 这是使用模拟数据的预览效果，实际数据可能不同。<br/>
                                ✨ 您可以在HTML中直接嵌入 &lt;style&gt; 标签来自定义样式。
                            </p>
                        </body>
                        </html>
                    `);
                    previewWindow.document.close();
                } catch (innerError) {
                    // 乌鸦：模板处理失败，使用简单方式
                    console.warn('模板引擎处理失败，使用简单方式:', innerError);
                    previewWithSimpleReplacement(htmlTemplate, mockData, previewWindow);
                }
            }).catch(importError => {
                // 乌鸦：模块加载失败，使用简单方式
                console.warn('mcp-template-engine加载失败，使用简单方式:', importError);
                previewWithSimpleReplacement(htmlTemplate, mockData, previewWindow);
            });
        } catch (error) {
            console.error('模板预览异常:', error);
            previewWithSimpleReplacement(htmlTemplate, mockData, previewWindow);
        }
    }, 0); // 乌鸦：立即异步执行，释放主线程
}

/**
 * 乌鸦：使用简单替换方法进行预览（兼容旧版本）
 */
function previewWithSimpleReplacement(htmlTemplate, mockData, previewWindow) {
    const allowedExpressions = {
        'new Date().toLocaleString()': () => new Date().toLocaleString(),
        'new Date().toLocaleDateString()': () => new Date().toLocaleDateString(),
        'new Date().toLocaleTimeString()': () => new Date().toLocaleTimeString(),
        'Date.now()': () => Date.now(),
        'Math.random()': () => Math.random().toFixed(6)
    };
    
    let previewHtml = htmlTemplate;
    
    Object.entries(allowedExpressions).forEach(([expression, handler]) => {
        const regex = new RegExp(`\\{\\{\\s*${expression.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
        try {
            const result = handler();
            previewHtml = previewHtml.replace(regex, result);
        } catch (error) {
            console.warn(`动态表达式执行失败: ${expression}`, error);
            previewHtml = previewHtml.replace(regex, '[Expression Error]');
        }
    });
    
    Object.entries(mockData).forEach(([key, value]) => {
        const regex = new RegExp(`\{\{${key}\}\}`, 'g');
        previewHtml = previewHtml.replace(regex, value);
    });
        
    // 乌鸦：使用传入的previewWindow，如果没有则创建新窗口
    if (!previewWindow) {
        const newWindow = window.open('', '_blank', 'width=600,height=400');
        if (!newWindow) {
            alert('浏览器拦截了弹窗，请允许弹窗权限后重试');
            return;
        }
        previewWindow = newWindow;
    } else {
        previewWindow.document.open();
    }
    previewWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>模板预览</title>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                    margin: 20px; 
                    background: #f5f5f5;
                }
            </style>
        </head>
        <body>
            <h2>👁️ 模板预览效果</h2>
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                ${previewHtml}
            </div>
            <p style="color: #666; margin-top: 20px; font-size: 14px;">
                ℹ️ 这是使用模拟数据的预览效果，实际数据可能不同。<br/>
                ✨ 您可以在HTML中直接嵌入 &lt;style&gt; 标签来自定义样式。
            </p>
        </body>
        </html>
    `);
    previewWindow.document.close();
}