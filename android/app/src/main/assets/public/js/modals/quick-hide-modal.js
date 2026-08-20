/**
 * @file quick-hide-modal.js
 * @description Handles the quick hide confirmation modal.
 */

import { dom } from '../dom.js';
import { getHideSummaryForCurrentConversation } from '../main.js';
import { isFloorHiddenInConfig } from '../utils.js';

/**
 * @function openQuickHideModal
 * @description Opens the quick hide confirmation modal and sets the target floor.
 * @param {number} floor - The message floor number that was clicked.
 */
export function openQuickHideModal(floor) {
    if (!dom.quickHideModal) return;

    // 获取当前会话隐藏配置，判断目标楼层当前是否已处于隐藏状态（支持离散与区间）
    const hideConfig = getHideSummaryForCurrentConversation();
    const isFloorHidden = isFloorHiddenInConfig(floor, hideConfig);

    // 将楼层号及隐藏状态存储在弹窗元素的 dataset 中，供事件处理函数快速读取
    dom.quickHideModal.dataset.floor = floor;
    dom.quickHideModal.dataset.floorHidden = isFloorHidden ? '1' : '0';

    // — 为什么这么写 —
    // 1. 按钮文案设为【隐藏当前楼层】与【取消隐藏当前楼层】，明确其仅作用于当前楼层、不影响其他已隐藏楼层
    // 2. 避免按钮过多造成排版拥挤，同时提供直观精准的逆向操作入口。
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
