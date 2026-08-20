/**
 * @file regex-modal.js
 * @description Handles regex rules editing and management.
 */

import { dom } from '../dom.js';
import { state, DEFAULT_REGEX_RULES } from '../state.js';
import { renderRegexRulesList } from '../ui-populator.js'; // Re-use from ui-populator to avoid duplication

export { renderRegexRulesList };

export function resetRegexForm() {
    dom.regexIdInput.value = '';
    dom.regexNameInput.value = '';
    dom.regexFindInput.value = '';
    dom.regexReplaceInput.value = '';
    dom.regexScopeReqUser.checked = false;
    dom.regexScopeReqAssistant.checked = false;
    dom.regexScopeDisplayUser.checked = true;
    dom.regexScopeDisplayAssistant.checked = true;
    dom.regexEnabledToggle.checked = true;
    dom.regexStageSelect.value = 'post-markdown';
    dom.regexSortInput.value = 0;
    dom.regexMinFloorInput.value = '';
    dom.regexMaxFloorInput.value = '';
    dom.regexFormTitle.textContent = '添加新规则';
    dom.regexCancelBtn.style.display = 'none';
    updateRegexFloorSummary();
}

export function populateRegexForm(rule) {
    dom.regexIdInput.value = rule.id;
    dom.regexNameInput.value = rule.name;
    dom.regexFindInput.value = rule.find;
    dom.regexReplaceInput.value = rule.replace;
    dom.regexEnabledToggle.checked = rule.enabled;

    dom.regexStageSelect.value = rule.stage || 'post-markdown';
    dom.regexSortInput.value = rule.sort || 0;

    dom.regexMinFloorInput.value = rule.minFloor || '';
    dom.regexMaxFloorInput.value = rule.maxFloor || '';

    dom.regexScopeReqUser.checked = false;
    dom.regexScopeReqAssistant.checked = false;
    dom.regexScopeDisplayUser.checked = false;
    dom.regexScopeDisplayAssistant.checked = false;

    if (Array.isArray(rule.scopes)) {
        rule.scopes.forEach(scope => {
            if (scope === 'request-user') dom.regexScopeReqUser.checked = true;
            if (scope === 'request-assistant') dom.regexScopeReqAssistant.checked = true;
            if (scope === 'display-user') dom.regexScopeDisplayUser.checked = true;
            if (scope === 'display-assistant') dom.regexScopeDisplayAssistant.checked = true;
        });
    }

    dom.regexFormTitle.textContent = '编辑规则';
    dom.regexCancelBtn.style.display = 'inline-block';
    updateRegexFloorSummary();
}

/**
 * @function updateRegexFloorSummary
 * @description 根据楼层输入框的值，更新说明文本
 */
export function updateRegexFloorSummary() {
    if (!dom.regexMinFloorInput || !dom.regexMaxFloorInput || !dom.regexFloorSummary) return;

    const minFloor = parseInt(dom.regexMinFloorInput.value, 10) || 0;
    const maxFloor = parseInt(dom.regexMaxFloorInput.value, 10) || 0;
    let summaryText = '说明：此规则对所有可见消息生效。';

    if (minFloor > 0) {
        summaryText = `说明：此规则仅对最新的 ${minFloor} 条可见消息生效。`;
    } else if (maxFloor > 0) {
        summaryText = `说明：此规则将从倒数第 ${maxFloor + 1} 条可见消息开始，对之前的所有消息生效。`;
    }

    dom.regexFloorSummary.textContent = summaryText;
}
