/**
 * @file auto-summary-conflict-modal.js
 * @description 处理用户发消息时后台自动总结并发冲突的交互弹窗（支持实时流式预览与耗时秒表计时）
 */

import { dom } from '../dom.js';
import { autoSummaryContext } from '../summary-manager.js';
import { notify } from '../ui-updater.js';

let timerInterval = null;
let streamUnsubscribe = null;
let currentPendingAction = null;

/**
 * 格式化耗时秒数
 * @param {number} startTime
 * @returns {string}
 */
function getElapsedText(startTime) {
    if (!startTime) return '0.0s';
    const elapsed = Math.max(0, (Date.now() - startTime) / 1000);
    return `${elapsed.toFixed(1)}s`;
}

/**
 * 清理定时器与流式监听
 */
function cleanup() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (typeof streamUnsubscribe === 'function') {
        streamUnsubscribe();
        streamUnsubscribe = null;
    }
    currentPendingAction = null;
}

/**
 * 打开并发冲突提示弹窗
 * @param {Object} options
 * @param {Function} options.onSkip - 立即跳过总结直接发送回调
 * @param {Function} options.onWait - 等待总结完成后发送回调
 * @param {Function} options.onCancel - 取消发送回调
 */
export function openAutoSummaryConflictModal(options = {}) {
    if (!dom.autoSummaryConflictModal) return;

    cleanup();
    currentPendingAction = options;

    // 1. 初始化流式内容与已耗时计时器
    const initialText = autoSummaryContext.currentStreamText;
    if (dom.autoSummaryStreamContent) {
        if (initialText && initialText.trim()) {
            dom.autoSummaryStreamContent.textContent = initialText;
            dom.autoSummaryStreamContent.scrollTop = dom.autoSummaryStreamContent.scrollHeight;
        } else {
            dom.autoSummaryStreamContent.innerHTML = '<span class="auto-summary-typing-placeholder">正在提炼记忆要点，流式输出中...</span>';
        }
    }

    if (dom.autoSummaryElapsedTime) {
        dom.autoSummaryElapsedTime.textContent = `⏱️ 已耗时 ${getElapsedText(autoSummaryContext.startTime)}`;
    }

    // 启动秒表定时器（每 100ms 刷新一次精准已耗时）
    timerInterval = setInterval(() => {
        if (dom.autoSummaryElapsedTime) {
            dom.autoSummaryElapsedTime.textContent = `⏱️ 已耗时 ${getElapsedText(autoSummaryContext.startTime)}`;
        }
    }, 100);

    let isWaitingAutoSend = false;

    // 2. 订阅后台自动总结流式管道
    const listener = {
        onChunk: (delta, fullText) => {
            if (dom.autoSummaryStreamContent) {
                dom.autoSummaryStreamContent.textContent = fullText;
                dom.autoSummaryStreamContent.scrollTop = dom.autoSummaryStreamContent.scrollHeight;
            }
        },
        onFinish: (result) => {
            cleanup();
            if (dom.autoSummaryStreamContent) {
                dom.autoSummaryStreamContent.textContent = result || '✅ 记忆提炼完成';
            }
            if (isWaitingAutoSend) {
                closeAutoSummaryConflictModal();
                if (typeof options.onWait === 'function') {
                    options.onWait(result);
                }
            } else {
                // 如果用户还在弹窗里看，给与提示并自动关闭发送
                notify.success('✨ 后台记忆提炼已完成！');
                closeAutoSummaryConflictModal();
                if (typeof options.onWait === 'function') {
                    options.onWait(result);
                }
            }
        },
        onError: (err) => {
            cleanup();
            notify.warning('后台记忆提炼未完成，将直接发送');
            closeAutoSummaryConflictModal();
            if (typeof options.onSkip === 'function') {
                options.onSkip();
            }
        }
    };

    autoSummaryContext.listeners.add(listener);
    streamUnsubscribe = () => {
        autoSummaryContext.listeners.delete(listener);
    };

    // 3. 绑定操作按钮
    if (dom.autoSummaryCancelSendBtn) {
        dom.autoSummaryCancelSendBtn.onclick = () => {
            cleanup();
            closeAutoSummaryConflictModal();
            if (typeof options.onCancel === 'function') {
                options.onCancel();
            }
            notify.info('已取消发送，消息保留在输入框中');
        };
    }

    if (dom.autoSummarySkipSendBtn) {
        dom.autoSummarySkipSendBtn.onclick = () => {
            cleanup();
            closeAutoSummaryConflictModal();
            if (typeof options.onSkip === 'function') {
                options.onSkip();
            }
        };
    }

    if (dom.autoSummaryWaitSendBtn) {
        dom.autoSummaryWaitSendBtn.textContent = '等待完成自动发';
        dom.autoSummaryWaitSendBtn.disabled = false;
        dom.autoSummaryWaitSendBtn.onclick = () => {
            isWaitingAutoSend = true;
            dom.autoSummaryWaitSendBtn.textContent = '⏳ 正在等待提炼结束...';
            dom.autoSummaryWaitSendBtn.disabled = true;
            notify.info('已设定为等待完成后自动发送');
        };
    }

    if (dom.autoSummaryConflictCloseBtn) {
        dom.autoSummaryConflictCloseBtn.onclick = () => {
            cleanup();
            closeAutoSummaryConflictModal();
            if (typeof options.onCancel === 'function') {
                options.onCancel();
            }
        };
    }

    // 4. 显示弹窗
    dom.autoSummaryConflictModal.style.display = 'flex';
    dom.autoSummaryConflictModal.classList.add('visible');
}

/**
 * 关闭并发冲突提示弹窗
 */
export function closeAutoSummaryConflictModal() {
    if (!dom.autoSummaryConflictModal) return;
    cleanup();
    dom.autoSummaryConflictModal.classList.remove('visible');
    dom.autoSummaryConflictModal.style.display = 'none';
}
