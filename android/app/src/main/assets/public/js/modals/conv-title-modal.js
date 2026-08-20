/**
 * @file conv-title-modal.js
 * @description 专职负责修改会话标题的弹窗交互与保存逻辑
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { renderHistory } from '../sidebar.js';
import { saveConversation } from '../db.js';
import { saveToLocalStorage } from '../utils.js';
import { notify } from '../ui-updater.js';

let currentEditingConvId = null;

/**
 * 打开修改会话标题弹窗
 * @param {string} convId - 会话ID
 */
export function openConvTitleModal(convId) {
    if (!convId || !state.conversations[convId]) return;
    if (!dom.editConvTitleModal || !dom.editConvTitleInput) return;

    currentEditingConvId = convId;
    const conv = state.conversations[convId];
    
    dom.editConvTitleInput.value = conv.title || '';
    dom.editConvTitleModal.style.display = 'flex';
    dom.editConvTitleModal.classList.add('visible');

    // 聚焦并全选现有标题
    setTimeout(() => {
        dom.editConvTitleInput.focus();
        dom.editConvTitleInput.select();
    }, 50);
}

/**
 * 关闭修改会话标题弹窗
 */
export function closeConvTitleModal() {
    if (!dom.editConvTitleModal) return;
    
    dom.editConvTitleModal.classList.remove('visible');
    dom.editConvTitleModal.style.display = 'none';
    currentEditingConvId = null;
}

/**
 * 保存修改后的会话标题
 */
export async function handleSaveConvTitle() {
    if (!currentEditingConvId || !state.conversations[currentEditingConvId]) {
        closeConvTitleModal();
        return;
    }

    const newTitle = dom.editConvTitleInput ? dom.editConvTitleInput.value.trim() : '';
    if (!newTitle) {
        notify.warning('对话标题不能为空！');
        if (dom.editConvTitleInput) dom.editConvTitleInput.focus();
        return;
    }

    const conv = state.conversations[currentEditingConvId];
    const oldTitle = conv.title;
    
    if (newTitle !== oldTitle) {
        conv.title = newTitle;
        try {
            await saveConversation(currentEditingConvId, conv);
            await saveToLocalStorage();
            notify.success('标题修改成功');
        } catch (err) {
            console.error('保存会话标题失败:', err);
            notify.error('保存会话标题失败，请重试');
        }
    }

    renderHistory();
    closeConvTitleModal();
}

/**
 * 初始化会话标题弹窗相关事件绑定
 */
export function setupConvTitleModalEvents() {
    if (dom.editConvTitleSaveBtn) {
        dom.editConvTitleSaveBtn.addEventListener('click', handleSaveConvTitle);
    }
    if (dom.editConvTitleCancelBtn) {
        dom.editConvTitleCancelBtn.addEventListener('click', closeConvTitleModal);
    }
    if (dom.editConvTitleInput) {
        dom.editConvTitleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveConvTitle();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeConvTitleModal();
            }
        });
    }
    if (dom.editConvTitleModal) {
        // 点击背景遮罩或右上角叉号关闭
        dom.editConvTitleModal.addEventListener('click', (e) => {
            if (e.target === dom.editConvTitleModal || e.target.classList.contains('modal-close-btn')) {
                closeConvTitleModal();
            }
        });
    }
}
