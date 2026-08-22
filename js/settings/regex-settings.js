/**
 * @file regex-settings.js
 * @description Handles Regex rules settings events.
 */

import { dom } from '../dom.js?v=260820-1';
import { state, DEFAULT_REGEX_RULES } from '../state.js?v=260820-1';
import { saveToLocalStorage, debounce } from '../utils.js?v=260820-1';
import { 
    renderRegexRulesList, resetRegexForm, populateRegexForm, updateRegexFloorSummary
} from '../modals.js?v=260820-1';
import { parseRegex } from '../regex-engine.js?v=260820-1';
import { renderChatMessages } from '../renderer.js?v=260820-1';
import { DraggableList } from '../draggable-list.js?v=260820-1';

let lastRegexCopyTime = 0;
let regexRuleDragInstance = null;

export function setupRegexEvents() {
    if (dom.regexSaveBtn) dom.regexSaveBtn.addEventListener('click', saveRegexRule);
    if (dom.regexCancelBtn) dom.regexCancelBtn.addEventListener('click', resetRegexForm);

    const collapseAllBtn = document.getElementById('regex-collapse-all-btn');
    const expandAllBtn = document.getElementById('regex-expand-all-btn');
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            if (dom.regexRuleList) {
                dom.regexRuleList.querySelectorAll('.regex-group-details').forEach(details => {
                    details.open = false;
                });
            }
        });
    }
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            if (dom.regexRuleList) {
                dom.regexRuleList.querySelectorAll('.regex-group-details').forEach(details => {
                    details.open = true;
                });
            }
        });
    }

    const scopeRadios = document.querySelectorAll('input[name="regex-scope-type"]');
    scopeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const sessionHint = document.getElementById('regex-current-session-hint');
            const sessionName = document.getElementById('regex-current-session-name');
            if (sessionHint && sessionName) {
                const currentConv = state.currentConversationId ? state.conversations[state.currentConversationId] : null;
                sessionName.textContent = currentConv ? (currentConv.title || '当前会话') : '未选择会话';
                sessionHint.style.display = radio.value === 'session' ? 'block' : 'none';
            }
        });
    });

    if (dom.regexRuleList) {
        dom.regexRuleList.addEventListener('click', handleRegexListActions);
        
        if (regexRuleDragInstance) {
            regexRuleDragInstance.destroy();
        }
        regexRuleDragInstance = new DraggableList(dom.regexRuleList, {
            itemSelector: '.regex-rule-item',
            onDrop: (fromIndex, toIndex) => {
                const allItems = [...dom.regexRuleList.querySelectorAll('.regex-rule-item')];
                
                const draggedItem = allItems[fromIndex];
                const targetItem = allItems[toIndex];
                
                if (!draggedItem || !targetItem) return;
                
                const draggedId = draggedItem.querySelector('[data-id]')?.dataset.id;
                const targetId = targetItem.querySelector('[data-id]')?.dataset.id;
                
                if (!draggedId || !targetId) return;
                
                const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
                if (defaultRuleKeys.includes(draggedId) || defaultRuleKeys.includes(targetId)) {
                    renderRegexRulesList();
                    return;
                }
                
                const customRules = Object.values(state.regexRules).filter(rule => 
                    !defaultRuleKeys.includes(rule.id)
                ).sort((a, b) => (a.sort || 0) - (b.sort || 0));
                
                const draggedRuleIndex = customRules.findIndex(rule => rule.id === draggedId);
                const targetRuleIndex = customRules.findIndex(rule => rule.id === targetId);
                
                if (draggedRuleIndex === -1 || targetRuleIndex === -1) return;
                
                const [movedRule] = customRules.splice(draggedRuleIndex, 1);
                customRules.splice(targetRuleIndex, 0, movedRule);
                
                customRules.forEach((rule, index) => {
                    rule.sort = (index + 1) * 10;
                });
                
                saveToLocalStorage();
                renderRegexRulesList();
            }
        });
    }

    const debouncedRegexValidation = debounce(handleRegexValidation, 300);
    if (dom.regexFindInput) dom.regexFindInput.addEventListener('input', debouncedRegexValidation);
    if (dom.regexTestInput) dom.regexTestInput.addEventListener('input', debouncedRegexValidation);

    if (dom.regexMinFloorInput) {
        dom.regexMinFloorInput.addEventListener('input', () => {
            if (dom.regexMinFloorInput.value) {
                dom.regexMaxFloorInput.value = '';
            }
            updateRegexFloorSummary();
        });
    }
    if (dom.regexMaxFloorInput) {
        dom.regexMaxFloorInput.addEventListener('input', () => {
            if (dom.regexMaxFloorInput.value) {
                dom.regexMinFloorInput.value = '';
            }
            updateRegexFloorSummary();
        });
    }
}

function saveRegexRule() {
    const id = dom.regexIdInput.value;

    // 系统默认规则禁止直接保存覆盖防御拦截
    if (id && DEFAULT_REGEX_RULES && Object.prototype.hasOwnProperty.call(DEFAULT_REGEX_RULES, id)) {
        alert('系统默认规则不可直接修改！如需定制，请复制到自定义全局规则区。');
        return;
    }

    const name = dom.regexNameInput.value.trim();
    const find = dom.regexFindInput.value;
    const replace = dom.regexReplaceInput.value;
    const scopes = [];
    if (dom.regexScopeReqUser.checked) scopes.push('request-user');
    if (dom.regexScopeReqAssistant.checked) scopes.push('request-assistant');
    if (dom.regexScopeDisplayUser.checked) scopes.push('display-user');
    if (dom.regexScopeDisplayAssistant.checked) scopes.push('display-assistant');
    const enabled = dom.regexEnabledToggle.checked;
    const stage = dom.regexStageSelect.value;
    const sort = parseInt(dom.regexSortInput.value, 10) || 0;
    const minFloor = parseInt(dom.regexMinFloorInput.value, 10) || 0;
    const maxFloor = parseInt(dom.regexMaxFloorInput.value, 10) || 0;

    // 获取规则归属（global 或 session）
    const scopeTypeRadio = document.querySelector('input[name="regex-scope-type"]:checked');
    const scopeType = scopeTypeRadio ? scopeTypeRadio.value : 'global';

    if (!name || !find) return alert('规则名称和查找内容不能为空！');

    if (scopeType === 'session' && !state.currentConversationId) {
        return alert('当前未选择任何会话，无法创建会话专属规则！请先选择或新建一个会话。');
    }

    try {
        new RegExp(find);
    } catch (e) {
        return alert(`无效的正则表达式: ${e.message}`);
    }

    const ruleId = id || `regex_${Date.now()}`;
    let sessionIds = [];
    if (scopeType === 'session') {
        const existingRule = id ? state.regexRules[id] : null;
        if (existingRule && Array.isArray(existingRule.sessionIds) && existingRule.sessionIds.length > 0) {
            sessionIds = [...existingRule.sessionIds];
            if (state.currentConversationId && !sessionIds.includes(state.currentConversationId)) {
                sessionIds.push(state.currentConversationId);
            }
        } else if (state.currentConversationId) {
            sessionIds = [state.currentConversationId];
        }
    }

    state.regexRules[ruleId] = {
        id: ruleId,
        name,
        find,
        replace,
        scopes,
        enabled,
        stage,
        sort,
        minFloor,
        maxFloor,
        scope: scopeType,
        sessionIds
    };

    saveToLocalStorage();
    renderRegexRulesList();
    resetRegexForm();
    if (enabled) renderChatMessages();
}

let currentTargetRuleForCopy = null;

function handleRegexListActions(e) {
    const target = e.target;
    const button = target.closest('button');
    const switchInput = target.closest('.regex-toggle-switch input');

    if (switchInput) {
        e.stopPropagation();
        const id = switchInput.dataset.id;
        const rule = state.regexRules[id];
        if (rule) {
            rule.enabled = switchInput.checked;
            saveToLocalStorage();
            renderRegexRulesList();
            renderChatMessages();
        }
        return;
    }

    if (button) {
        const id = button.dataset.id;
        if (button.classList.contains('regex-edit-btn')) {
            const rule = state.regexRules[id];
            populateRegexForm(rule);
            const formTitle = document.getElementById('regex-form-title');
            if (formTitle) {
                setTimeout(() => {
                    formTitle.scrollIntoView({ behavior: 'auto', block: 'start' });
                }, 100);
            }
        } else if (button.classList.contains('regex-delete-btn')) {
            // 系统默认规则禁止删除防御拦截
            if (DEFAULT_REGEX_RULES && Object.prototype.hasOwnProperty.call(DEFAULT_REGEX_RULES, id)) {
                alert('系统默认规则不可删除！');
                return;
            }
            if (confirm(`确定要删除规则 "${state.regexRules[id]?.name || ''}" 吗？`)) {
                delete state.regexRules[id];
                saveToLocalStorage();
                renderRegexRulesList();
            }
        } else if (button.classList.contains('regex-copy-btn')) {
            if (Date.now() - lastRegexCopyTime < 500) return;
            lastRegexCopyTime = Date.now();
            const ruleToCopy = state.regexRules[id];
            if (!ruleToCopy) return;

            currentTargetRuleForCopy = ruleToCopy;
            // 无论系统默认、全局规则、还是会话专属规则，点击复制均弹出决策弹窗（复制为全局副本 / 复制到会话）
            openCopyChoiceModal(ruleToCopy);
        }
    }
}

/**
 * 弹出全局规则复制分流决策弹窗
 * @param {object} rule - 目标规则
 */
function openCopyChoiceModal(rule) {
    const modal = document.getElementById('regex-copy-choice-modal');
    const nameEl = document.getElementById('regex-copy-choice-rule-name');
    if (!modal) return;

    if (nameEl) nameEl.textContent = `规则名称：${rule.name}`;

    const closeBtn = document.getElementById('regex-copy-choice-close-btn');
    const globalBtn = document.getElementById('regex-copy-choice-global-btn');
    const sessionBtn = document.getElementById('regex-copy-choice-session-btn');

    const close = () => {
        modal.style.display = 'none';
        cleanup();
    };

    const onGlobalCopy = () => {
        const newRule = JSON.parse(JSON.stringify(rule));
        newRule.id = `regex_${Date.now()}`;
        newRule.name = `${rule.name}_copy`;
        newRule.scope = 'global';
        newRule.sessionIds = [];
        state.regexRules[newRule.id] = newRule;
        saveToLocalStorage();
        renderRegexRulesList();
        close();
    };

    const onSessionCopy = () => {
        close();
        openCopyToSessionModal(rule);
    };

    const cleanup = () => {
        if (closeBtn) closeBtn.removeEventListener('click', close);
        if (globalBtn) globalBtn.removeEventListener('click', onGlobalCopy);
        if (sessionBtn) sessionBtn.removeEventListener('click', onSessionCopy);
        modal.removeEventListener('click', onModalClick);
    };

    const onModalClick = (e) => {
        if (e.target === modal) close();
    };

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (globalBtn) globalBtn.addEventListener('click', onGlobalCopy);
    if (sessionBtn) sessionBtn.addEventListener('click', onSessionCopy);
    modal.addEventListener('click', onModalClick);

    modal.style.display = 'flex';
}

/**
 * 弹出复制规则到指定会话弹窗
 * @param {object} rule - 目标规则
 */
function openCopyToSessionModal(rule) {
    const modal = document.getElementById('regex-copy-to-session-modal');
    const targetNameEl = document.getElementById('regex-copy-session-target-name');
    const listEl = document.getElementById('regex-copy-session-list');
    const searchInput = document.getElementById('regex-copy-session-search');
    const selectAllBtn = document.getElementById('regex-copy-session-select-all');
    const clearAllBtn = document.getElementById('regex-copy-session-clear-all');
    const confirmBtn = document.getElementById('regex-copy-session-confirm-btn');
    const cancelBtn = document.getElementById('regex-copy-session-cancel-btn');
    const closeBtn = document.getElementById('regex-copy-session-close-btn');
    const countBadge = document.getElementById('regex-copy-session-selected-count');

    if (!modal || !listEl) return;

    if (targetNameEl) targetNameEl.textContent = rule.name;
    if (searchInput) searchInput.value = '';

    const allConversations = Object.values(state.conversations || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const renderList = (filterText = '') => {
        listEl.innerHTML = '';
        const keyword = filterText.toLowerCase().trim();
        const filtered = allConversations.filter(c => !keyword || (c.title && c.title.toLowerCase().includes(keyword)));

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">没有找到匹配的会话</div>';
            updateCount();
            return;
        }

        filtered.forEach(conv => {
            const isCurrent = conv.id === state.currentConversationId;
            const itemLabel = document.createElement('label');
            itemLabel.className = 'session-copy-checkbox-item';
            itemLabel.style.display = 'flex';
            itemLabel.style.alignItems = 'center';
            itemLabel.style.gap = '10px';
            itemLabel.style.padding = '8px 12px';
            itemLabel.style.borderRadius = 'var(--radius-sm)';
            itemLabel.style.background = 'var(--bg-surface)';
            itemLabel.style.border = '1px solid var(--border-color)';
            itemLabel.style.cursor = 'pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = conv.id;
            checkbox.className = 'session-copy-checkbox';
            // 重点：默认勾选当前会话
            if (isCurrent) checkbox.checked = true;

            const textDiv = document.createElement('div');
            textDiv.style.flex = '1';
            textDiv.style.display = 'flex';
            textDiv.style.alignItems = 'center';
            textDiv.style.justifyContent = 'space-between';
            textDiv.innerHTML = `
                <span style="font-size: 0.9em; color: var(--text-primary); font-weight: ${isCurrent ? '600' : 'normal'};">
                    ${conv.title || '未命名对话'} ${isCurrent ? '<span style="color: var(--accent-blue); font-size: 0.8em;">(当前会话)</span>' : ''}
                </span>
                <span style="font-size: 0.75em; color: var(--text-tertiary);">${conv.messages ? conv.messages.length : 0}条消息</span>
            `;

            checkbox.addEventListener('change', updateCount);
            itemLabel.appendChild(checkbox);
            itemLabel.appendChild(textDiv);
            listEl.appendChild(itemLabel);
        });

        updateCount();
    };

    const updateCount = () => {
        const checkedCount = listEl.querySelectorAll('.session-copy-checkbox:checked').length;
        if (countBadge) countBadge.textContent = `已选择 ${checkedCount} 个会话`;
    };

    renderList();

    const close = () => {
        modal.style.display = 'none';
        cleanup();
    };

    const onSearch = (e) => renderList(e.target.value);
    const onSelectAll = () => {
        listEl.querySelectorAll('.session-copy-checkbox').forEach(cb => cb.checked = true);
        updateCount();
    };
    const onClearAll = () => {
        listEl.querySelectorAll('.session-copy-checkbox').forEach(cb => cb.checked = false);
        updateCount();
    };

    const onConfirm = () => {
        const checkedBoxes = listEl.querySelectorAll('.session-copy-checkbox:checked');
        const selectedConvIds = Array.from(checkedBoxes).map(cb => cb.value);

        if (selectedConvIds.length === 0) {
            alert('请至少选择一个目标会话！');
            return;
        }

        // 为每个选中的会话深拷贝生成一条全新的会话专属规则
        selectedConvIds.forEach(convId => {
            const newId = `regex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const newRule = JSON.parse(JSON.stringify(rule));
            newRule.id = newId;
            newRule.name = `${rule.name} (会话副本)`;
            newRule.scope = 'session';
            newRule.sessionIds = [convId];
            state.regexRules[newId] = newRule;
        });

        saveToLocalStorage();
        renderRegexRulesList();
        close();
    };

    const cleanup = () => {
        if (searchInput) searchInput.removeEventListener('input', onSearch);
        if (selectAllBtn) selectAllBtn.removeEventListener('click', onSelectAll);
        if (clearAllBtn) clearAllBtn.removeEventListener('click', onClearAll);
        if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm);
        if (cancelBtn) cancelBtn.removeEventListener('click', close);
        if (closeBtn) closeBtn.removeEventListener('click', close);
        modal.removeEventListener('click', onModalClick);
    };

    const onModalClick = (e) => {
        if (e.target === modal) close();
    };

    if (searchInput) searchInput.addEventListener('input', onSearch);
    if (selectAllBtn) selectAllBtn.addEventListener('click', onSelectAll);
    if (clearAllBtn) clearAllBtn.addEventListener('click', onClearAll);
    if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', onModalClick);

    modal.style.display = 'flex';
}

function handleRegexValidation() {
    const findPattern = dom.regexFindInput.value;
    const testString = dom.regexTestInput.value;
    const resultEl = dom.regexTestResult;

    resultEl.className = 'regex-test-result-area';
    resultEl.innerHTML = '';

    if (!findPattern || !testString) {
        resultEl.textContent = '请输入正则表达式和测试文本...';
        resultEl.classList.add('no-match');
        return;
    }

    try {
        const { pattern, flags } = parseRegex(findPattern);
        const finalFlags = flags ? [...new Set(flags + 'g')].join('') : 'g';
        const regex = new RegExp(pattern, finalFlags);

        let match;
        let matches = [];
        while ((match = regex.exec(testString)) !== null) {
            matches.push(match);
        }

        if (matches.length > 0) {
            resultEl.classList.add('success');
            
            const fragment = document.createDocumentFragment();
            const countHeader = document.createElement('div');
            countHeader.textContent = `找到 ${matches.length} 个匹配项:`
            countHeader.style.fontWeight = 'bold';
            countHeader.style.marginBottom = '8px';
            fragment.appendChild(countHeader);

            let lastIndex = 0;
            const highlightedResult = document.createElement('div');

            matches.forEach((m, i) => {
                highlightedResult.appendChild(document.createTextNode(testString.substring(lastIndex, m.index)));
                
                const span = document.createElement('span');
                span.className = 'match-highlight';
                span.textContent = m[0];
                span.title = `匹配 #${i + 1}
位置: ${m.index}-${m.index + m[0].length}
捕获组: ${JSON.stringify(m.slice(1))}`;
                highlightedResult.appendChild(span);

                lastIndex = m.index + m[0].length;
            });

            highlightedResult.appendChild(document.createTextNode(testString.substring(lastIndex)));
            fragment.appendChild(highlightedResult);
            resultEl.appendChild(fragment);
        } else {
            resultEl.classList.add('no-match');
            resultEl.textContent = '未找到匹配项。';
        }
    } catch (e) {
        resultEl.classList.add('error');
        resultEl.textContent = `正则表达式错误: ${e.message}`;
    }
}
