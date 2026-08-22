/**
 * @file quick-hide-modal.js
 * @description Handles the quick hide confirmation modal.
 */

import { dom } from '../dom.js?v=260823';
import { state } from '../state.js?v=260823';
import { getHideSummaryForCurrentConversation } from '../main.js?v=260823';
import { isMessageHidden } from '../utils.js?v=260823';

/**
 * 将有序楼层数组压缩为易读的区间描述列表
 * 例如：[1, 2, 3, 5, 8, 9] -> ["第 1 ~ 3 楼", "第 5 楼", "第 8 ~ 9 楼"]
 * @param {number[]} floors - 楼层编号数组
 * @returns {string[]} 区间描述字符串数组
 */
function formatHiddenFloorsToRanges(floors) {
    if (!Array.isArray(floors) || floors.length === 0) return [];
    const sorted = [...new Set(floors)].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const curr = sorted[i];
        if (curr === prev + 1) {
            prev = curr;
        } else {
            ranges.push(start === prev ? `第 ${start} 楼` : `第 ${start} ~ ${prev} 楼`);
            start = curr;
            prev = curr;
        }
    }
    ranges.push(start === prev ? `第 ${start} 楼` : `第 ${start} ~ ${prev} 楼`);
    return ranges;
}

/**
 * @function openQuickHideModal
 * @description Opens the quick hide confirmation modal and sets the target floor.
 * @param {number} floor - The message floor number that was clicked.
 */
export function openQuickHideModal(floor) {
    if (!dom.quickHideModal) return;

    // 获取当前会话当前分支的目标消息，优先读取消息自身的隐藏状态
    const conv = state.conversations[state.currentConversationId];
    const activeBranch = (conv && conv.branches) ? conv.branches[conv.activeBranchIndex] : [];
    const message = activeBranch ? activeBranch[floor - 1] : null;
    const hideConfig = getHideSummaryForCurrentConversation();
    const isFloorHidden = isMessageHidden(message, floor, hideConfig);

    // 将楼层号及隐藏状态存储在弹窗元素的 dataset 中，供事件处理函数快速读取
    dom.quickHideModal.dataset.floor = floor;
    dom.quickHideModal.dataset.floorHidden = isFloorHidden ? '1' : '0';

    // — 为什么这么写 —
    // 1. 统计并展示当前分支所有已被标记隐藏的楼层情况，让大爷对当前分支的可见性状态一目了然
    const hiddenFloors = activeBranch
        .map((m, i) => (isMessageHidden(m, i + 1, hideConfig) ? i + 1 : null))
        .filter(Boolean);

    if (dom.quickHideStatusCount) {
        dom.quickHideStatusCount.textContent = `共 ${hiddenFloors.length} 个楼层`;
    }

    if (dom.quickHideStatusTags) {
        if (hiddenFloors.length > 0) {
            const rangeLabels = formatHiddenFloorsToRanges(hiddenFloors);
            dom.quickHideStatusTags.innerHTML = rangeLabels
                .map(label => `<span class="quick-hide-tag">${label}</span>`)
                .join('');
        } else {
            dom.quickHideStatusTags.innerHTML = '<span class="quick-hide-tag-empty">暂无隐藏楼层（全部可见）</span>';
        }
    }

    // — 为什么这么写 —
    // 2. 按钮文案设为【隐藏当前楼层】与【取消隐藏当前楼层】，明确其仅作用于当前楼层、不影响其他已隐藏楼层
    // 3. 避免按钮过多造成排版拥挤，同时提供直观精准的逆向操作入口。
    if (dom.quickHidePromptText) {
        if (isFloorHidden) {
            dom.quickHidePromptText.textContent = `第 ${floor} 楼当前处于已隐藏状态：`;
        } else {
            dom.quickHidePromptText.textContent = `请选择针对第 ${floor} 楼的隐藏操作：`;
        }
    }
    if (dom.quickHideSingleBtn) {
        if (isFloorHidden) {
            dom.quickHideSingleBtn.textContent = '取消隐藏当前楼层';
            dom.quickHideSingleBtn.title = `仅取消第 ${floor} 楼的隐藏，保留其他已隐藏楼层`;
        } else {
            dom.quickHideSingleBtn.textContent = '隐藏当前楼层';
            dom.quickHideSingleBtn.title = `仅隐藏第 ${floor} 楼，不影响其他已隐藏楼层`;
        }
    }
    if (dom.quickHideConfirmBtn) {
        dom.quickHideConfirmBtn.textContent = `隐藏 1 至 ${floor} 楼`;
        dom.quickHideConfirmBtn.title = `将第 1 楼至第 ${floor} 楼全部标记为隐藏`;
    }

    // — 为什么这么写 —
    // 预填区间快捷隐藏输入框（默认 1 至当前点击楼层，最大值限定为当前分支消息总量）
    const totalFloors = activeBranch ? activeBranch.length : floor;
    if (dom.quickHideRangeStart) {
        dom.quickHideRangeStart.value = '1';
        dom.quickHideRangeStart.min = '1';
        dom.quickHideRangeStart.max = String(totalFloors);
    }
    if (dom.quickHideRangeEnd) {
        dom.quickHideRangeEnd.value = String(floor);
        dom.quickHideRangeEnd.min = '1';
        dom.quickHideRangeEnd.max = String(totalFloors);
    }

    // 显示弹窗
    dom.quickHideModal.style.display = 'flex';
    dom.quickHideModal.classList.add('visible');
}

/**
 * @function closeQuickHideModal
 * @description Closes the quick hide confirmation modal.
 */
export function closeQuickHideModal() {
    if (!dom.quickHideModal) return;
    dom.quickHideModal.classList.remove('visible');
    // 动画结束后再隐藏，避免闪烁
    dom.quickHideModal.addEventListener('transitionend', () => {
        dom.quickHideModal.style.display = 'none';
    }, { once: true });
}
