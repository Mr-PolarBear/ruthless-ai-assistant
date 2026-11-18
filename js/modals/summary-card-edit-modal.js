/**
 * @file summary-card-edit-modal.js
 * @description 列表拼接记忆片段多行独立编辑与新增专属模态弹窗
 * 彻底替换原生单行 prompt()，支持阶段范围、生成时间与 Markdown 多行编辑，
 * 提供快捷键保存与字数统计，自适应浅色与暗夜幽蓝双主题。
 */

import { dom } from '../dom.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

/** 当前编辑的上下文缓存 */
let currentCardContext = null;

/**
 * 更新编辑框字数统计
 */
function updateCardEditCharCount() {
    if (!dom.summaryCardEditContent || !dom.summaryCardEditCharCounter) return;
    const len = dom.summaryCardEditContent.value.length;
    dom.summaryCardEditCharCounter.textContent = `${len} 字`;
}

/**
 * 格式化当前时间为 MM-DD HH:mm
 */
function getFormattedTime() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * 打开记忆片段编辑/新增模态弹窗
 * @param {object} context - 上下文对象
 * @param {'edit'|'add'} context.mode - 模式
 * @param {number} context.index - 卡片序号 (0-indexed)
 * @param {object} context.item - 卡片数据 { id, time, floorRange, content }
 * @param {Array<object>} context.summaryList - 当前卡片列表引用
 * @param {Function} context.onSave - 保存回调函数 (updatedItem) => void
 */
export function openSummaryCardEditModal(context) {
    if (!dom.summaryCardEditModal) return;
    currentCardContext = context;
    const isAdd = context.mode === 'add';

    if (dom.summaryCardEditTitle) {
        dom.summaryCardEditTitle.textContent = isAdd ? '新增记忆片段' : `编辑记忆片段 #${context.index + 1}`;
    }
    if (dom.summaryCardEditRange) {
        dom.summaryCardEditRange.value = context.item?.floorRange || (isAdd ? `阶段 ${context.index + 1}` : '');
    }
    if (dom.summaryCardEditTime) {
        dom.summaryCardEditTime.textContent = context.item?.time 
            ? `生成时间: ${context.item.time}` 
            : (isAdd ? '保存时自动生成时间戳' : '时间未知');
    }
    if (dom.summaryCardEditContent) {
        dom.summaryCardEditContent.value = context.item?.content || '';
        updateCardEditCharCount();
    }

    dom.summaryCardEditModal.style.display = 'flex';

    // 自动聚焦多行文本输入框
    setTimeout(() => {
        if (dom.summaryCardEditContent) {
            dom.summaryCardEditContent.focus();
        }
    }, 50);
}

/**
 * 关闭记忆片段编辑/新增模态弹窗
 */
export function closeSummaryCardEditModal() {
    if (dom.summaryCardEditModal) {
        dom.summaryCardEditModal.style.display = 'none';
    }
    currentCardContext = null;
}

/**
 * 保存当前编辑或新增的片段
 */
function handleSaveCard() {
    if (!currentCardContext) return;

    const content = dom.summaryCardEditContent ? dom.summaryCardEditContent.value.trim() : '';
    if (!content) {
        notify.warning('记忆片段内容不能为空');
        if (dom.summaryCardEditContent) dom.summaryCardEditContent.focus();
        return;
    }

    let range = dom.summaryCardEditRange ? dom.summaryCardEditRange.value.trim() : '';
    if (!range) {
        range = currentCardContext.mode === 'add' ? `阶段 ${currentCardContext.index + 1}` : '手动记录';
    }

    const isAdd = currentCardContext.mode === 'add';
    const nowTimeStr = getFormattedTime();

    const updatedItem = {
        id: currentCardContext.item?.id || `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        time: isAdd ? nowTimeStr : (currentCardContext.item?.time || nowTimeStr),
        floorRange: range,
        content: content
    };

    if (typeof currentCardContext.onSave === 'function') {
        currentCardContext.onSave(updatedItem);
    }

    closeSummaryCardEditModal();
}

/**
 * 初始化记忆片段编辑模态弹窗事件监听
 */
export function setupSummaryCardEditModalEvents() {
    if (!dom.summaryCardEditModal) return;

    // 1. 关闭按钮
    if (dom.summaryCardEditCloseBtn) {
        dom.summaryCardEditCloseBtn.addEventListener('click', closeSummaryCardEditModal);
    }

    // 2. 取消按钮
    if (dom.summaryCardEditCancelBtn) {
        dom.summaryCardEditCancelBtn.addEventListener('click', closeSummaryCardEditModal);
    }

    // 3. 点击遮罩空白区域关闭
    dom.summaryCardEditModal.addEventListener('click', (e) => {
        if (e.target === dom.summaryCardEditModal) {
            closeSummaryCardEditModal();
        }
    });

    // 4. 输入框字数实时刷新与快捷键监听
    if (dom.summaryCardEditContent) {
        dom.summaryCardEditContent.addEventListener('input', updateCardEditCharCount);
        dom.summaryCardEditContent.addEventListener('keydown', (e) => {
            // Ctrl + Enter 或 Cmd + Enter 快速保存
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSaveCard();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSummaryCardEditModal();
            }
        });
    }

    // 5. 保存按钮
    if (dom.summaryCardEditSaveBtn) {
        dom.summaryCardEditSaveBtn.addEventListener('click', handleSaveCard);
    }
}
