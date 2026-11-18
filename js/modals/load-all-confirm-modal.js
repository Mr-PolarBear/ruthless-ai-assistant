/**
 * @file load-all-confirm-modal.js
 * @description 加载全部消息与全量渲染确认提醒弹窗模块
 * — 为什么这么写 —
 * 1. 控大防膨：遵循架构规范，独立封装弹窗控制逻辑，不污染已有庞大文件；
 * 2. 性能知情决策：向用户客观披露全量渲染的性能影响（特别是手机端或超百楼长会话）；
 * 3. 容错指南：明确告知刷新页面即可瞬间恢复默认首屏加载，消除用户心智负担。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { closeModalWithAnimation } from '../modal-events.js?v=temp';

let pendingConfirmCallback = null;

/**
 * 打开全量渲染确认弹窗
 * @param {Function} onConfirm - 用户点击确认加载后的回调函数
 */
export function openLoadAllConfirmModal(onConfirm) {
    if (!dom.loadAllConfirmModal) return;

    pendingConfirmCallback = onConfirm;

    // 动态提取当前分支消息总数
    const conv = state.conversations && state.currentConversationId ? state.conversations[state.currentConversationId] : null;
    const activeBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex || 0] : [];
    const totalCount = activeBranch ? activeBranch.length : 0;

    if (dom.loadAllTotalCount) {
        dom.loadAllTotalCount.textContent = `${totalCount}`;
    }

    dom.loadAllConfirmModal.style.display = 'flex';
    requestAnimationFrame(() => {
        dom.loadAllConfirmModal.classList.add('visible');
    });
}

/**
 * 关闭全量渲染确认弹窗
 */
export function closeLoadAllConfirmModal() {
    if (!dom.loadAllConfirmModal) return;
    pendingConfirmCallback = null;
    closeModalWithAnimation(dom.loadAllConfirmModal);
}

/**
 * 设置弹窗事件监听
 */
export function setupLoadAllConfirmModal() {
    if (dom.loadAllConfirmCloseBtn) {
        dom.loadAllConfirmCloseBtn.addEventListener('click', closeLoadAllConfirmModal);
    }
    if (dom.loadAllCancelBtn) {
        dom.loadAllCancelBtn.addEventListener('click', closeLoadAllConfirmModal);
    }
    if (dom.loadAllConfirmBtn) {
        dom.loadAllConfirmBtn.addEventListener('click', () => {
            const cb = pendingConfirmCallback;
            closeLoadAllConfirmModal();
            if (typeof cb === 'function') {
                cb();
            }
        });
    }
    if (dom.loadAllConfirmModal) {
        dom.loadAllConfirmModal.addEventListener('click', (e) => {
            if (e.target === dom.loadAllConfirmModal) {
                closeLoadAllConfirmModal();
            }
        });
    }
}
