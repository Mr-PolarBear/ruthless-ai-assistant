/**
 * @file message-editor-modal.js
 * @description Handles message editing modal and choice popover.
 */

import { dom } from '../dom.js?v=260823';
import { setEditingMsg } from './base.js?v=260823';
import { showMessageEditAttachmentPreview } from '../attachment.js?v=260823';

export function openMessageEditModal(message, index) {
    setEditingMsg(message, index);

    // 乌鸦：核心改造点
    // 检查消息是否同时包含初次请求内容和二次分析结果
    if (message.content && message.analysisResult) {
        // 如果两个都有，显示选择弹窗
        showEditChoicePopover(message, index);
    } else {
        // 否则，按原逻辑直接显示编辑框
        _showEditModalWithContent(message.originalContent || message.content, message, index);
    }
}

/**
 * 乌鸦：内部函数，用于显示带有特定内容的消息编辑弹窗
 * @param {string} content - 要填充到编辑框的内容
 * @param {object} message - 消息对象
 * @param {number} index - 消息索引
 */
function _showEditModalWithContent(content, message, index) {
    dom.messageEditTextarea.value = content;
    
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        window._editingMsgRemovedAttachments = [];
        showMessageEditAttachmentPreview(message.attachments, window._editingMsgRemovedAttachments);
    } else {
        dom.messageEditAttachmentPreview.style.display = 'none';
        dom.messageEditAttachmentPreview.innerHTML = '';
    }

    dom.messageEditModal.style.display = 'flex';
    dom.messageEditModal.classList.add('visible');
    setTimeout(() => {
        dom.messageEditTextarea.focus();
        dom.messageEditTextarea.scrollTop = 0;
    }, 100);
}

/**
 * 乌鸦：新增函数，用于显示和处理编辑选择弹窗
 * @param {object} message - 消息对象
 * @param {number} index - 消息索引
 */
function showEditChoicePopover(message, index) {
    const popover = dom.editChoicePopover;
    const editBtn = document.querySelector(`.message-bubble[data-index="${index}"] .edit-btn`);

    if (!popover || !editBtn) return;

    // 定位弹窗
    const rect = editBtn.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 5}px`;
    popover.style.display = 'block';

    // --- 绑定事件 ---
    const primaryBtn = dom.editChoicePrimaryBtn;
    const secondaryBtn = dom.editChoiceSecondaryBtn;

    primaryBtn.onclick = () => {
        popover.style.display = 'none';
        _showEditModalWithContent(message.content, message, index);
    };

    secondaryBtn.onclick = () => {
        popover.style.display = 'none';
        _showEditModalWithContent(message.analysisResult, message, index);
    };

    // 点击外部关闭弹窗
    const outsideClickListener = (event) => {
        if (!popover.contains(event.target) && event.target !== editBtn) {
            popover.style.display = 'none';
            document.removeEventListener('click', outsideClickListener);
        }
    };
    setTimeout(() => document.addEventListener('click', outsideClickListener), 0);
}

export function closeMessageEditModal() {
    dom.messageEditModal.style.display = 'none';
    dom.messageEditModal.classList.remove('visible');
    setEditingMsg(null, null);
}
