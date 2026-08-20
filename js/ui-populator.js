/**
 * @file ui-populator.js
 * @description Handles population of UI lists and selectors (Updated V2).
 */

import { dom } from './dom.js';
import { state, DEFAULT_REGEX_RULES } from './state.js';
import { escapeHtml } from './utils.js';

export function populateApiSelector() {
    const currentVal = dom.apiSelector.value;
    dom.apiSelector.innerHTML = '';
    if (Object.keys(state.apiEndpoints).length === 0) {
        dom.apiSelector.innerHTML = '<option value="">请先添加API端点</option>';
    } else {
        const sortedApis = Object.values(state.apiEndpoints)
            .map(api => {
                if (typeof api.sort !== 'number') {
                    api.sort = 0;
                }
                return api;
            })
            .sort((a, b) => (a.sort || 0) - (b.sort || 0));

        sortedApis.forEach(api => {
            dom.apiSelector.innerHTML += `<option value="${api.id}">${api.name}</option>`;
        });
    }
    if (currentVal && state.apiEndpoints[currentVal]) {
        dom.apiSelector.value = currentVal;
    }

    // — 为什么这么写 —
    // 首次导入/添加 API 端点时，当前活动会话的 apiEndpointId 可能尚未设置或失效。
    // 在重新填充下拉框后，自动将下拉框选中的有效 API ID 同步给当前会话，避免准备 API 请求时因缺少 apiEndpointId 产生异常。
    if (state.currentConversationId && state.conversations[state.currentConversationId]) {
        const currentConv = state.conversations[state.currentConversationId];
        if ((!currentConv.apiEndpointId || !state.apiEndpoints[currentConv.apiEndpointId]) && dom.apiSelector.value) {
            currentConv.apiEndpointId = dom.apiSelector.value;
        }
    }
}

export function populatePersonaSelector() {
    const currentVal = dom.personaSelector.value;
    dom.personaSelector.innerHTML = '<option value="default">无角色 (默认)</option>';
    const hasPersonas = Object.keys(state.personas).length > 0;
    Object.values(state.personas).forEach(p => {
        dom.personaSelector.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
    if (state.personas[currentVal]) {
        dom.personaSelector.value = currentVal;
    }
    if (hasPersonas) {
        dom.personaSelector.disabled = false;
    }
}

export function renderApiEndpointsList() {
    dom.apiEndpointList.innerHTML = '';
    if (Object.keys(state.apiEndpoints).length === 0) {
        dom.apiEndpointList.innerHTML = `<p style="color: var(--text-secondary); text-align: center;">还没有API端点，请添加一个。</p>`;
        return;
    }
    
    const apiEndpoints = Object.values(state.apiEndpoints)
        .map(api => {
            if (typeof api.sort !== 'number') {
                api.sort = 0;
            }
            return api;
        })
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    
    apiEndpoints.forEach(api => {
        dom.apiEndpointList.innerHTML += `
            <div class="api-endpoint-item" draggable="true" data-id="${api.id}">
                <div class="api-endpoint-item-details">
                    <div class="api-endpoint-item-name">${api.name}</div>
                    <div class="api-endpoint-item-url">${api.url}</div>
                </div>
                <div class="api-endpoint-item-actions action-btn-group">
                    <span class="api-badge badge-${api.type}">${api.type}</span>
                    <button class="action-btn copy api-copy-btn" data-id="${api.id}" title="复制">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="action-btn edit api-edit-btn" data-id="${api.id}" title="编辑">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn delete api-delete-btn" data-id="${api.id}" title="删除">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

export function renderPersonaModal() {
    dom.personaList.innerHTML = '';
    
    // 乌鸦：确保所有角色都有sort字段，并按sort排序
    const personas = Object.values(state.personas)
        .map(p => {
            if (typeof p.sort !== 'number') {
                p.sort = 0;
            }
            return p;
        })
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    
    if (personas.length === 0) {
        dom.personaList.innerHTML = `<p style="color: var(--text-secondary); text-align: center;">还没有角色，请添加一个。</p>`;
        return;
    }

    personas.forEach(p => {
        dom.personaList.innerHTML += `
            <div class="persona-item" draggable="true">
                <div class="persona-item-details">
                    <div class="persona-item-name">${p.name}</div>
                    <div class="persona-item-prompt">${p.prompt}</div>
                </div>
                <div class="persona-item-actions action-btn-group">
                    <button class="action-btn edit persona-edit-btn" data-id="${p.id}" title="编辑">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn copy persona-copy-btn" data-id="${p.id}" title="复制">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="action-btn delete persona-delete-btn" data-id="${p.id}" title="删除">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
        `;
    });
}

export function renderRegexRulesList() {
    dom.regexRuleList.innerHTML = '';
    const allRules = Object.values(state.regexRules).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES);

    const defaultRules = allRules.filter(rule => defaultRuleKeys.includes(rule.id));
    const customRules = allRules.filter(rule => !defaultRuleKeys.includes(rule.id));

    let html = '';

    const renderRule = (rule) => {
        const scopeTranslations = {
            'request-user': '请求-用户',
            'request-assistant': '请求-AI',
            'display-user': '显示-用户',
            'display-assistant': '显示-AI'
        };
        const stageTranslations = {
            'pre-markdown': '渲染前',
            'post-markdown': '渲染后'
        };

        const scopesHTML = rule.scopes.map(scope => `<span class="scope-badge">${scopeTranslations[scope] || scope}</span>`).join('');
        const stageHTML = `<span class="scope-badge stage-badge-${rule.stage || 'post-markdown'}">${stageTranslations[rule.stage || 'post-markdown']}</span>`;
        const sortHTML = `<span class="scope-badge sort-badge">排序: ${rule.sort || 0}</span>`;

        const checkedAttribute = rule.enabled ? 'checked' : '';
        const ruleNameDiv = document.createElement('div');
        ruleNameDiv.className = 'regex-rule-item-name';
        ruleNameDiv.textContent = `${rule.name} ${rule.enabled ? '' : '(已禁用)'}`;

        const rulePatternDiv = document.createElement('div');
        rulePatternDiv.className = 'regex-rule-item-pattern';
        rulePatternDiv.textContent = `查找: ${rule.find}`;

        return `
            <div class="regex-rule-item" draggable="true">
                <div class="regex-rule-item-details">
                    ${ruleNameDiv.outerHTML}
                    ${rulePatternDiv.outerHTML}
                    <div class="scope-badges">${sortHTML}${stageHTML}${scopesHTML}</div>
                </div>
                <div class="regex-rule-item-actions action-btn-group">
                    <label class="theme-switch small regex-toggle-switch" title="启用/禁用" style="margin-top: 5px;">
                        <input type="checkbox" data-id="${rule.id}" ${checkedAttribute}>
                        <span class="slider round"></span>
                    </label>
                    <button class="action-btn edit regex-edit-btn" data-id="${rule.id}" title="编辑">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn copy regex-copy-btn" data-id="${rule.id}" title="复制表达式">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="action-btn delete regex-delete-btn" data-id="${rule.id}" title="删除">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
        `;
    };

    html += '<div class="regex-rule-header">系统默认规则</div>';
    if (defaultRules.length > 0) {
        html += defaultRules.map(renderRule).join('');
    } else {
        html += `<div class="regex-rule-empty-message">无</div>`;
    }

    html += '<div class="regex-rule-header">自定义规则<span class="drag-sort-hint">当前列表支持拖拽排序</span></div>';
    if (customRules.length > 0) {
        html += customRules.map(renderRule).join('');
    } else {
        html += `<div class="regex-rule-empty-message">无</div>`;
    }

    dom.regexRuleList.innerHTML = html;
}