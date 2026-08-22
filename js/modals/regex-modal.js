/**
 * @file regex-modal.js
 * @description Handles regex rules editing and management.
 */

import { dom } from '../dom.js?v=260823';
import { state, DEFAULT_REGEX_RULES } from '../state.js?v=260823';
import { renderRegexRulesList } from '../ui-populator.js?v=260823'; // Re-use from ui-populator to avoid duplication

export { renderRegexRulesList };

/**
 * 辅助函数：批量设置表单控件的可编辑/禁用状态
 * @param {boolean} disabled - 是否禁用
 */
function setRegexFormDisabled(disabled) {
    if (dom.regexNameInput) dom.regexNameInput.disabled = disabled;
    if (dom.regexFindInput) dom.regexFindInput.disabled = disabled;
    if (dom.regexReplaceInput) dom.regexReplaceInput.disabled = disabled;
    if (dom.regexScopeReqUser) dom.regexScopeReqUser.disabled = disabled;
    if (dom.regexScopeReqAssistant) dom.regexScopeReqAssistant.disabled = disabled;
    if (dom.regexScopeDisplayUser) dom.regexScopeDisplayUser.disabled = disabled;
    if (dom.regexScopeDisplayAssistant) dom.regexScopeDisplayAssistant.disabled = disabled;
    if (dom.regexStageSelect) dom.regexStageSelect.disabled = disabled;
    if (dom.regexSortInput) dom.regexSortInput.disabled = disabled;
    if (dom.regexMinFloorInput) dom.regexMinFloorInput.disabled = disabled;
    if (dom.regexMaxFloorInput) dom.regexMaxFloorInput.disabled = disabled;
    if (dom.regexEnabledToggle) dom.regexEnabledToggle.disabled = disabled;

    const globalRadio = document.getElementById('regex-scope-type-global');
    const sessionRadio = document.getElementById('regex-scope-type-session');
    if (globalRadio) globalRadio.disabled = disabled;
    if (sessionRadio) sessionRadio.disabled = disabled;
}

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

    // 规则归属默认选择全局
    const globalRadio = document.getElementById('regex-scope-type-global');
    const sessionRadio = document.getElementById('regex-scope-type-session');
    if (globalRadio) globalRadio.checked = true;
    if (sessionRadio) sessionRadio.checked = false;

    const currentConvId = state.currentConversationId;
    const currentConv = currentConvId ? state.conversations[currentConvId] : null;
    const sessionHint = document.getElementById('regex-current-session-hint');
    const sessionName = document.getElementById('regex-current-session-name');
    if (sessionName) sessionName.textContent = currentConv ? (currentConv.title || '当前会话') : '未选择会话';
    if (sessionHint) sessionHint.style.display = 'none';

    // 恢复所有表单项为可编辑状态
    setRegexFormDisabled(false);

    // 隐藏只读红字警示卡片
    const readonlyHint = document.getElementById('regex-default-readonly-hint');
    if (readonlyHint) readonlyHint.style.display = 'none';

    // 恢复保存按钮与取消按钮
    if (dom.regexSaveBtn) dom.regexSaveBtn.style.display = 'inline-block';
    if (dom.regexCancelBtn) {
        dom.regexCancelBtn.style.display = 'none';
        dom.regexCancelBtn.textContent = '取消编辑';
    }

    updateRegexFloorSummary();
}

export function populateRegexForm(rule) {
    if (!rule) return;
    const isDefaultRule = Boolean(DEFAULT_REGEX_RULES && Object.prototype.hasOwnProperty.call(DEFAULT_REGEX_RULES, rule.id));

    dom.regexIdInput.value = rule.id;
    dom.regexNameInput.value = rule.name || '';
    dom.regexFindInput.value = rule.find || '';
    dom.regexReplaceInput.value = rule.replace !== undefined ? rule.replace : '';
    dom.regexEnabledToggle.checked = Boolean(rule.enabled);

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

    // 规则归属单选与提示联动
    const globalRadio = document.getElementById('regex-scope-type-global');
    const sessionRadio = document.getElementById('regex-scope-type-session');
    const sessionHint = document.getElementById('regex-current-session-hint');
    const sessionName = document.getElementById('regex-current-session-name');

    if (rule.scope === 'session') {
        if (sessionRadio) sessionRadio.checked = true;
        if (globalRadio) globalRadio.checked = false;
        if (sessionHint) sessionHint.style.display = 'block';
        if (sessionName) {
            const targetConvId = Array.isArray(rule.sessionIds) && rule.sessionIds[0];
            const targetConv = targetConvId ? state.conversations[targetConvId] : null;
            sessionName.textContent = targetConv ? (targetConv.title || '会话') : (state.currentConversationId && state.conversations[state.currentConversationId]?.title) || '当前会话';
        }
    } else {
        if (globalRadio) globalRadio.checked = true;
        if (sessionRadio) sessionRadio.checked = false;
        if (sessionHint) sessionHint.style.display = 'none';
    }

    const readonlyHint = document.getElementById('regex-default-readonly-hint');

    if (isDefaultRule) {
        // 系统默认规则：只读模式
        dom.regexFormTitle.textContent = '查看规则 (系统默认)';
        setRegexFormDisabled(true);
        if (readonlyHint) readonlyHint.style.display = 'block';
        if (dom.regexSaveBtn) dom.regexSaveBtn.style.display = 'none';
        if (dom.regexCancelBtn) {
            dom.regexCancelBtn.style.display = 'inline-block';
            dom.regexCancelBtn.textContent = '关闭查看';
        }
    } else {
        // 自定义规则：编辑模式
        dom.regexFormTitle.textContent = rule.scope === 'session' ? '编辑会话专属规则' : '编辑自定义规则';
        setRegexFormDisabled(false);
        if (readonlyHint) readonlyHint.style.display = 'none';
        if (dom.regexSaveBtn) dom.regexSaveBtn.style.display = 'inline-block';
        if (dom.regexCancelBtn) {
            dom.regexCancelBtn.style.display = 'inline-block';
            dom.regexCancelBtn.textContent = '取消编辑';
        }
    }

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
