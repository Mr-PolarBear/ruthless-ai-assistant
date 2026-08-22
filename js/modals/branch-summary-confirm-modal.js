/**
 * @file branch-summary-confirm-modal.js
 * @description 分叉重发与记忆回滚联动提醒弹窗模块
 * — 为什么这么写 —
 * 1. 当用户重发历史楼层时，若当前记忆库包含了分叉点之后的未来废弃剧情，弹窗为小白用户提供极简决策；
 * 2. 自动智能匹配最适合该分叉楼层的历史快照（优先保留用户最近一次手动编辑/保存的版本），一键秒级回滚并重发；
 * 3. 亦提供【保持当前记忆直接重发】与【取消】选项，完全保障用户的知情权与自主选择权。
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { saveToLocalStorage } from '../utils.js?v=260820-1';
import { notify } from '../ui-updater.js?v=260820-1';
import { getHideSummaryForConversation, setHideSummaryForConversation } from '../main.js?v=260820-1';
import { normalizeHideSummaryConfig } from '../summary-manager.js?v=260820-1';

let currentModalState = {
    convId: null,
    branchFromIndex: 0,
    checkResult: null,
    onProceed: null
};

/**
 * 打开分叉重发与记忆回滚确认弹窗
 * @param {object} params
 * @param {string} params.convId - 会话ID
 * @param {number} params.branchFromIndex - 重发分叉截取消息索引（0-indexed）
 * @param {object} params.checkResult - checkBranchMemoryStatus 返回的检测结果
 * @param {Function} params.onProceed - 确认继续执行重发的回调函数
 */
export function openBranchSummaryConfirmModal({ convId, branchFromIndex, checkResult, onProceed }) {
    if (!dom.branchSummaryConfirmModal) return;

    currentModalState = {
        convId,
        branchFromIndex,
        checkResult,
        onProceed
    };

    const branchFloor = branchFromIndex + 1;
    if (dom.branchSummaryTargetFloor) {
        dom.branchSummaryTargetFloor.textContent = branchFloor.toString();
    }
    if (dom.branchSummaryCurrentFloor) {
        dom.branchSummaryCurrentFloor.textContent = (checkResult.currentMemoryFloor || '最新').toString();
    }

    const snap = checkResult.bestSnapshot;
    if (snap) {
        const sourceLabel = snap.source || '历史快照';
        const snapFloor = snap.maxFloor || (snap.hiddenFloors?.length ? Math.max(...snap.hiddenFloors) : branchFloor);
        if (dom.branchSummaryRollbackTitle) {
            dom.branchSummaryRollbackTitle.textContent = `一键恢复至第 ${snapFloor} 楼记忆 (${snap.time || ''} ${sourceLabel}) 并重发`;
        }
        if (dom.branchSummaryRollbackSubtitle) {
            dom.branchSummaryRollbackSubtitle.textContent = '自动恢复到该节点时刻的记忆内容，剥离后续废弃剧情，干净无污染';
        }
    } else {
        // 分叉点早于历史上首次总结生成时刻，推荐重置为无记忆初始状态
        if (dom.branchSummaryRollbackTitle) {
            dom.branchSummaryRollbackTitle.textContent = '一键重置为初始无记忆状态并重发';
        }
        if (dom.branchSummaryRollbackSubtitle) {
            dom.branchSummaryRollbackSubtitle.textContent = '清除当前包含后续剧情的记忆，恢复为干净初始状态';
        }
    }

    dom.branchSummaryConfirmModal.style.display = 'flex';
    dom.branchSummaryConfirmModal.classList.add('visible');
}

/**
 * 关闭分叉重发与记忆回滚确认弹窗
 */
export function closeBranchSummaryConfirmModal() {
    if (!dom.branchSummaryConfirmModal) return;
    dom.branchSummaryConfirmModal.classList.remove('visible');
    setTimeout(() => {
        dom.branchSummaryConfirmModal.style.display = 'none';
        currentModalState = {
            convId: null,
            branchFromIndex: 0,
            checkResult: null,
            onProceed: null
        };
    }, 200);
}

/**
 * 初始化分叉重发确认弹窗事件绑定
 */
export function setupBranchSummaryConfirmModal() {
    if (!dom.branchSummaryConfirmModal) return;

    // 1. 【推荐】一键恢复至匹配历史快照并重发
    if (dom.branchSummaryRollbackBtn) {
        dom.branchSummaryRollbackBtn.addEventListener('click', async () => {
            const { convId, checkResult, onProceed } = currentModalState;
            if (!convId) return;

            const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
            const snap = checkResult?.bestSnapshot;

            if (snap) {
                // 恢复至匹配的历史快照
                if (snap.mode) config.memoryMode = snap.mode;
                config.summary = snap.summary || '';
                if (snap.summaryList) config.summaryList = JSON.parse(JSON.stringify(snap.summaryList));
                if (snap.tableData) config.tableData = JSON.parse(JSON.stringify(snap.tableData));
                
                setHideSummaryForConversation(convId, config);
                await saveToLocalStorage();

                const snapFloor = snap.maxFloor || (snap.hiddenFloors?.length ? Math.max(...snap.hiddenFloors) : '');
                notify.success(`✨ 已恢复至第 ${snapFloor} 楼记忆快照 (${snap.source || '历史版本'})，正在重发...`);
            } else {
                // 重置为初始无记忆状态
                config.summary = '';
                config.summaryList = [];
                config.tableData = { eventHistory: [], characterInfo: [] };
                
                setHideSummaryForConversation(convId, config);
                await saveToLocalStorage();

                notify.success('✨ 已重置为初始无记忆状态，正在重发...');
            }

            if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
            if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
            if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();

            closeBranchSummaryConfirmModal();

            if (typeof onProceed === 'function') {
                onProceed();
            }
        });
    }

    // 2. 保持当前记忆直接重发
    if (dom.branchSummaryKeepBtn) {
        dom.branchSummaryKeepBtn.addEventListener('click', () => {
            const { onProceed } = currentModalState;
            closeBranchSummaryConfirmModal();
            notify.info('已保持当前记忆，正在重发...');
            if (typeof onProceed === 'function') {
                onProceed();
            }
        });
    }

    // 3. 取消重发
    if (dom.branchSummaryCancelBtn) {
        dom.branchSummaryCancelBtn.addEventListener('click', () => {
            closeBranchSummaryConfirmModal();
        });
    }

    if (dom.branchSummaryConfirmCloseBtn) {
        dom.branchSummaryConfirmCloseBtn.addEventListener('click', () => {
            closeBranchSummaryConfirmModal();
        });
    }

    // 点击遮罩外部关闭
    dom.branchSummaryConfirmModal.addEventListener('click', (e) => {
        if (e.target === dom.branchSummaryConfirmModal) {
            closeBranchSummaryConfirmModal();
        }
    });
}
