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

    if (!name || !find) return alert('规则名称和查找内容不能为空！');

    try {
        new RegExp(find);
    } catch (e) {
        return alert(`无效的正则表达式: ${e.message}`);
    }

    const ruleId = id || `regex_${Date.now()}`;
    state.regexRules[ruleId] = {id: ruleId, name, find, replace, scopes, enabled, stage, sort, minFloor, maxFloor};
    saveToLocalStorage();
    renderRegexRulesList();
    resetRegexForm();
    if (enabled) renderChatMessages();
}

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
            if (confirm(`确定要删除规则 "${state.regexRules[id].name}" 吗？`)) {
                delete state.regexRules[id];
                saveToLocalStorage();
                renderRegexRulesList();
            }
        } else if (button.classList.contains('regex-copy-btn')) {
            if (Date.now() - lastRegexCopyTime < 1000) return alert('请勿频繁点击复制！');
            lastRegexCopyTime = Date.now();
            const ruleToCopy = state.regexRules[id];
            if (confirm(`确定要复制规则 "${ruleToCopy.name}" 吗？`)) {
                const newRule = JSON.parse(JSON.stringify(ruleToCopy));
                newRule.id = `regex_${Date.now()}`;
                newRule.name = `${ruleToCopy.name}_copy`;
                state.regexRules[newRule.id] = newRule;
                saveToLocalStorage();
                renderRegexRulesList();
            }
        }
    }
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
