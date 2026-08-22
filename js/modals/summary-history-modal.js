import { dom } from '../dom.js?v=260823';
import { state } from '../state.js?v=260823';
import { escapeHtml, saveToLocalStorage } from '../utils.js?v=260823';
import { notify } from '../ui-updater.js?v=260823';
import { saveConversation } from '../db.js?v=260823';
import { getHideSummaryForConversation, setHideSummaryForConversation, getHideSummaryForCurrentConversation, setHideSummaryForCurrentConversation } from '../main.js?v=260823';
import { renderChatMessages } from '../renderer.js?v=260823';
import { formatHiddenFloorsBannerInfo } from '../summary-manager.js?v=260823';

let pendingRollbackVersion = null;

/**
 * 刷新总结弹窗中的历史版本数量角标
 */
export function updateHideSummaryHistoryCount() {
    const countEl = dom.hideSummaryHistoryCount;
    if (!countEl) return;
    const convId = state.currentConversationId;
    const config = (state.hideSummary && state.hideSummary[convId]) || {};
    const count = Array.isArray(config.history) ? config.history.length : 0;
    countEl.textContent = count.toString();
}

/**
 * 格式化隐藏楼层为友好展示文本 (复用智能区间压缩算法)
 * @param {number[]} floors - 楼层数组
 * @returns {string} 友好文本
 */
function formatHiddenFloorsText(floors) {
    const info = formatHiddenFloorsBannerInfo(floors);
    return info.mainText;
}

/**
 * 渲染历史总结版本列表
 */
export function renderSummaryHistoryList() {
    const listEl = dom.summaryHistoryList;
    if (!listEl) return;

    const convId = state.currentConversationId;
    const config = (state.hideSummary && state.hideSummary[convId]) || {};
    const history = Array.isArray(config.history) ? config.history : [];

    if (history.length === 0) {
        listEl.innerHTML = '<div class="summary-history-empty">暂无历史总结版本记录</div>';
        return;
    }

    listEl.innerHTML = '';
    history.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'summary-history-item';

        const floorsText = formatHiddenFloorsText(item.hiddenFloors);
        const sourceName = item.source || '手动保存';
        const summaryText = item.summary || '';
        const isLongText = summaryText.length > 80 || summaryText.includes('\n');
        const modeName = item.mode === 'append' ? '📑 列表拼接' : (item.mode === 'table' ? '⚔️ 跑团双表' : '🔄 递归滚动');

        itemEl.innerHTML = `
            <div class="summary-history-item-header">
                <span class="summary-history-time">⏱️ ${escapeHtml(item.time || '未知时间')}</span>
                <span class="summary-history-source-badge">${escapeHtml(modeName)} · ${escapeHtml(sourceName)} · ${item.charCount || summaryText.length} 字</span>
            </div>
            <div class="summary-history-floors-tag">
                <span>📌 当时隐藏楼层:</span>
                <strong>${escapeHtml(floorsText)}</strong>
            </div>
            <div class="summary-history-preview" id="summary-history-preview-${index}">${escapeHtml(summaryText)}</div>
            <div class="summary-history-preview-footer">
                ${isLongText ? `<button type="button" class="summary-history-toggle-btn" data-index="${index}">👁️ 查看全部</button>` : '<span></span>'}
                <div class="summary-history-item-actions">
                    <button type="button" class="summary-history-copy-btn" data-index="${index}" title="复制此版本记忆全文">📋 复制</button>
                    <button type="button" class="summary-history-rollback-btn" data-index="${index}">🔄 回滚</button>
                    <button type="button" class="summary-history-delete-btn" data-index="${index}">🗑️ 删除</button>
                </div>
            </div>
        `;

        // 绑定展开/收起切换
        if (isLongText) {
            const toggleBtn = itemEl.querySelector('.summary-history-toggle-btn');
            const previewEl = itemEl.querySelector(`#summary-history-preview-${index}`);
            if (toggleBtn && previewEl) {
                toggleBtn.addEventListener('click', () => {
                    const isExpanded = previewEl.classList.toggle('expanded');
                    toggleBtn.innerHTML = isExpanded ? '▲ 收起' : '👁️ 查看全部';
                });
            }
        }

        // 绑定复制全文
        const copyBtn = itemEl.querySelector('.summary-history-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                if (!summaryText) {
                    notify.warning('内容为空，无法复制');
                    return;
                }
                try {
                    await navigator.clipboard.writeText(summaryText);
                    notify.success('已复制总结全文到剪贴板');
                } catch (_) {
                    // 兼容旧浏览器
                    const ta = document.createElement('textarea');
                    ta.value = summaryText;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    notify.success('已复制总结全文到剪贴板');
                }
            });
        }

        // 绑定单条回滚
        const rollbackBtn = itemEl.querySelector('.summary-history-rollback-btn');
        rollbackBtn.addEventListener('click', () => {
            openSummaryRollbackConfirmModal(item);
        });

        // 绑定单条删除
        const deleteBtn = itemEl.querySelector('.summary-history-delete-btn');
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`确定要删除 ${item.time} 的历史总结版本吗？`)) return;
            history.splice(index, 1);
            config.history = history;
            setHideSummaryForConversation(convId, config);
            await saveToLocalStorage();
            renderSummaryHistoryList();
            updateHideSummaryHistoryCount();
            notify.success('已删除该历史版本');
        });

        listEl.appendChild(itemEl);
    });
}

/**
 * 打开历史总结版本管理弹窗
 */
export function openSummaryHistoryModal() {
    if (!dom.summaryHistoryModal) return;
    renderSummaryHistoryList();
    dom.summaryHistoryModal.style.display = 'flex';
    dom.summaryHistoryModal.classList.add('visible');
}

/**
 * 关闭历史总结版本管理弹窗
 */
export function closeSummaryHistoryModal() {
    if (!dom.summaryHistoryModal) return;
    dom.summaryHistoryModal.classList.remove('visible');
    dom.summaryHistoryModal.style.display = 'none';
}

/**
 * 打开回滚历史总结确认弹窗
 * @param {Object} version - 目标快照版本
 */
export function openSummaryRollbackConfirmModal(version) {
    if (!dom.summaryRollbackConfirmModal || !version) return;
    pendingRollbackVersion = version;

    const sourceName = version.source || '历史版本';
    const charCount = version.charCount || (version.summary ? version.summary.length : 0);
    dom.summaryRollbackTargetInfo.textContent = `目标版本：${version.time || ''} (${sourceName} · ${charCount} 字)`;
    dom.summaryRollbackFloorsInfo.textContent = formatHiddenFloorsText(version.hiddenFloors);

    dom.summaryRollbackConfirmModal.style.display = 'flex';
    dom.summaryRollbackConfirmModal.classList.add('visible');
}

/**
 * 关闭回滚历史总结确认弹窗
 */
export function closeSummaryRollbackConfirmModal() {
    if (!dom.summaryRollbackConfirmModal) return;
    pendingRollbackVersion = null;
    dom.summaryRollbackConfirmModal.classList.remove('visible');
    dom.summaryRollbackConfirmModal.style.display = 'none';
}

/**
 * 执行回滚操作
 * @param {boolean} restoreFloors - 是否同步恢复楼层隐藏
 */
async function executeRollback(restoreFloors) {
    if (!pendingRollbackVersion) return;
    const version = pendingRollbackVersion;
    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (!conv) return;

    const config = getHideSummaryForCurrentConversation();

    // 1. 同步恢复楼层隐藏状态
    if (restoreFloors) {
        const targetFloors = Array.isArray(version.hiddenFloors) ? version.hiddenFloors : [];
        const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
        if (activeBranch) {
            activeBranch.forEach((msg, index) => {
                const floor = index + 1;
                msg.hidden = targetFloors.includes(floor);
            });
        }
        config.hiddenFloors = targetFloors;
        config.start = targetFloors.length > 0 ? Math.min(...targetFloors) : 1;
        config.end = targetFloors.length > 0 ? Math.max(...targetFloors) : 1;

        await saveConversation(convId, conv);
        renderChatMessages({ updateVisibilityOnly: true });
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
    }

    // 2. 恢复模式与对应记忆数据结构
    if (version.mode) {
        config.memoryMode = version.mode;
    }
    config.summary = version.summary || '';
    if (version.summaryList) {
        config.summaryList = JSON.parse(JSON.stringify(version.summaryList));
    }
    if (version.tableData) {
        config.tableData = JSON.parse(JSON.stringify(version.tableData));
    }

    setHideSummaryForConversation(convId, config);
    await saveToLocalStorage();

    if (convId === state.currentConversationId) {
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
        if (window.refreshHideSummaryModalViews) {
            window.refreshHideSummaryModalViews();
        } else if (dom.hideSummaryResult) {
            dom.hideSummaryResult.value = config.summary;
            if (dom.hideSummaryResultCharCounter) {
                dom.hideSummaryResultCharCounter.textContent = `${config.summary.length} 字`;
            }
        }
    }

    closeSummaryRollbackConfirmModal();
    closeSummaryHistoryModal();

    notify.success(restoreFloors ? '已同步恢复历史记忆与隐藏楼层状态' : '已恢复历史记忆内容 (楼层状态保持不变)');
}

/**
 * 初始化历史总结版本弹窗事件绑定
 */
export function initSummaryHistoryModal() {
    // 打开历史版本弹窗
    if (dom.hideSummaryHistoryBtn) {
        dom.hideSummaryHistoryBtn.addEventListener('click', () => {
            openSummaryHistoryModal();
        });
    }

    // 关闭历史版本弹窗
    if (dom.summaryHistoryCloseBtn) {
        dom.summaryHistoryCloseBtn.addEventListener('click', closeSummaryHistoryModal);
    }
    if (dom.summaryHistoryCloseBtn2) {
        dom.summaryHistoryCloseBtn2.addEventListener('click', closeSummaryHistoryModal);
    }
    if (dom.summaryHistoryModal) {
        dom.summaryHistoryModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryHistoryModal) {
                closeSummaryHistoryModal();
            }
        });
    }

    // 清空所有历史版本
    if (dom.summaryHistoryClearAllBtn) {
        dom.summaryHistoryClearAllBtn.addEventListener('click', async () => {
            const convId = state.currentConversationId;
            const config = (state.hideSummary && state.hideSummary[convId]) || {};
            const history = Array.isArray(config.history) ? config.history : [];
            if (history.length === 0) {
                notify.info('当前暂无历史版本');
                return;
            }
            if (!confirm('确定要清空当前会话的所有历史总结版本吗？此操作不可恢复。')) return;

            config.history = [];
            setHideSummaryForConversation(convId, config);
            await saveToLocalStorage();
            renderSummaryHistoryList();
            updateHideSummaryHistoryCount();
            notify.success('已清空所有历史总结版本');
        });
    }

    // 回滚确认弹窗事件
    if (dom.summaryRollbackCloseBtn) {
        dom.summaryRollbackCloseBtn.addEventListener('click', closeSummaryRollbackConfirmModal);
    }
    if (dom.summaryRollbackCancelBtn) {
        dom.summaryRollbackCancelBtn.addEventListener('click', closeSummaryRollbackConfirmModal);
    }
    if (dom.summaryRollbackModal) {
        dom.summaryRollbackModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryRollbackModal) {
                closeSummaryRollbackConfirmModal();
            }
        });
    }

    // 仅恢复总结文本
    if (dom.summaryRollbackTextOnlyBtn) {
        dom.summaryRollbackTextOnlyBtn.addEventListener('click', () => {
            executeRollback(false);
        });
    }

    // 同步恢复楼层隐藏与总结
    if (dom.summaryRollbackFullBtn) {
        dom.summaryRollbackFullBtn.addEventListener('click', () => {
            executeRollback(true);
        });
    }

    // 暴露全局角标刷新方法
    window.updateHideSummaryHistoryCount = updateHideSummaryHistoryCount;
}
