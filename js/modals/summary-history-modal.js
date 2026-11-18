import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { escapeHtml, saveToLocalStorage, countTokens } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { saveConversation } from '../db.js?v=temp';
import { getHideSummaryForConversation, setHideSummaryForConversation, getHideSummaryForCurrentConversation, setHideSummaryForCurrentConversation } from '../main.js?v=temp';
import { renderChatMessages } from '../renderer.js?v=temp';
import { formatHiddenFloorsBannerInfo, getSnapshotFullText } from '../summary-manager.js?v=temp';
import { diffLines } from '../text-diff.js?v=temp';

const ICON_CHEVRON_DOWN = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const ICON_CHEVRON_UP = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';

let pendingRollbackVersion = null;
let currentDetailVersion = null;
let currentDetailPrevVersion = null; // 对比上版时的上一版本快照（无则为 null）
let currentDetailView = 'snapshot'; // 'snapshot' | 'compare'
let currentDetailTableSubtab = 'history'; // 'history' | 'character'
let isDetailRawView = false;

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
        const modeName = item.mode === 'append' ? '📑 列表拼接' : (item.mode === 'table' ? '📊 结构双表' : '🔄 递归滚动');

        // 当前记忆基线版本判定：appliedVersionId 指哪版哪版就是"当前"，
        // 无 id 的老快照退化用 timestamp 比对（与 executeRollback 写入逻辑对应）
        const appliedId = config.appliedVersionId;
        const isCurrentVersion = !!(appliedId && String(item.id || item.timestamp) === String(appliedId));
        if (isCurrentVersion) itemEl.classList.add('is-current-version');

        const fullText = getSnapshotFullText(item);

        // AI 原文视图：仅当快照带有 aiRawText（本次应用的原文，如双表 Diff Patch、列表新增卡片）时才可切换
        const hasRawText = !!(item.aiRawText && item.aiRawText.trim());
        // 对比上版：history 按时间倒序排列，index+1 即该版本保存前的上一版本
        // — 为什么这么写 —
        // 对照视图改在详情弹窗内以左右双栏呈现（空间更大、更直观），列表项内不再内嵌统一 diff，
        // 故列表项的「对比上版」改为跳转详情弹窗对照视图的动作按钮。
        const prevItem = index < history.length - 1 ? history[index + 1] : null;
        const showViewBar = hasRawText;

        const isLongText = fullText.length > 80 || fullText.includes('\n');

        itemEl.innerHTML = `
            <div class="summary-history-item-header">
                <span class="summary-history-time">⏱️ ${escapeHtml(item.time || '未知时间')}</span>
                <span class="summary-history-source-badge">${escapeHtml(modeName)} · ${escapeHtml(sourceName)} · ${item.charCount || fullText.length} 字</span>
                ${isCurrentVersion ? '<span class="summary-history-current-badge" title="当前记忆内容基于该版本（回滚或最近应用产生）">✓ 当前版本</span>' : ''}
            </div>
            <div class="summary-history-floors-tag">
                <span>📌 当时隐藏楼层:</span>
                <strong>${escapeHtml(floorsText)}</strong>
            </div>
            ${showViewBar ? `
            <div class="summary-history-view-bar">
                <button type="button" class="summary-history-view-tab active" data-view="snapshot" title="查看该版本保存后的完整记忆">快照</button>
                ${hasRawText ? `<button type="button" class="summary-history-view-tab" data-view="raw" title="查看本次 AI 原始返回内容（应用前的原文）">AI原文</button>` : ''}
            </div>` : ''}
            <div class="summary-history-preview" id="summary-history-preview-${index}">${escapeHtml(fullText)}</div>
            <div class="summary-history-preview-footer">
                ${isLongText ? `<button type="button" class="summary-history-toggle-btn" data-index="${index}" style="display:inline-flex; align-items:center; gap:4px;">${ICON_CHEVRON_DOWN}展开全文</button>` : '<span></span>'}
                <div class="summary-history-item-actions">
                    ${prevItem ? `<button type="button" class="summary-history-compare-btn" data-index="${index}" title="与上一版本 (${escapeHtml(prevItem.time || '未知时间')}) 左右对照对比">对比上版</button>` : ''}
                    <button type="button" class="summary-history-detail-btn" data-index="${index}" title="查看该历史版本的完整内容与楼层明细">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        <span>查看详情</span>
                    </button>
                    <button type="button" class="summary-history-rollback-btn" data-index="${index}" title="回滚至此版本">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                        <span>回滚</span>
                    </button>
                    <button type="button" class="summary-history-delete-btn" data-index="${index}" title="删除此历史版本快照">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                        <span>删除</span>
                    </button>
                </div>
            </div>
        `;

        const previewEl = itemEl.querySelector(`#summary-history-preview-${index}`);
        const toggleBtn = itemEl.querySelector('.summary-history-toggle-btn');

        // 同步展开按钮文案（视图切换会强制展开/还原预览区，按钮状态必须保持一致）
        const syncToggleBtnText = (expanded) => {
            if (toggleBtn) toggleBtn.innerHTML = expanded ? `${ICON_CHEVRON_UP}收起` : `${ICON_CHEVRON_DOWN}展开全文`;
        };

        // 绑定展开/收起切换
        if (isLongText && toggleBtn && previewEl) {
            toggleBtn.addEventListener('click', () => {
                const isExpanded = previewEl.classList.toggle('expanded');
                syncToggleBtnText(isExpanded);
            });
        }

        // — 为什么这么写 —
        // 预览区三视图切换：AI原文/对比上版若仍走 3 行 clamp 截断等于白看，故切换时强制展开；
        // 切回快照视图则恢复折叠态，回归列表概览形态。
        if (showViewBar && previewEl) {
            const viewTabs = itemEl.querySelectorAll('.summary-history-view-tab');
            viewTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    if (tab.classList.contains('active')) return;
                    viewTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const view = tab.dataset.view;
                    if (view === 'raw') {
                        previewEl.textContent = item.aiRawText;
                        previewEl.classList.add('expanded');
                        syncToggleBtnText(true);
                    } else {
                        previewEl.textContent = fullText;
                        previewEl.classList.remove('expanded');
                        syncToggleBtnText(false);
                    }
                });
            });
        }

        // 绑定查看详情弹窗
        const detailBtn = itemEl.querySelector('.summary-history-detail-btn');
        if (detailBtn) {
            detailBtn.addEventListener('click', () => {
                openSummaryHistoryDetailModal(item, prevItem, 'snapshot');
            });
        }

        // 绑定对比上版：直接打开详情弹窗并默认落在左右对照视图
        const compareBtn = itemEl.querySelector('.summary-history-compare-btn');
        if (compareBtn) {
            compareBtn.addEventListener('click', () => {
                openSummaryHistoryDetailModal(item, prevItem, 'compare');
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
            // 若删掉的正是当前基线版本，工作台基线胶囊需即时失效，故顺带全景刷新一次
            if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
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
 * 打开历史总结版本详情查看弹窗
 * @param {Object} item - 目标历史版本快照
 */
export function openSummaryHistoryDetailModal(item, prevItem = null, initialView = 'snapshot') {
    if (!dom.summaryHistoryDetailModal || !item) return;
    currentDetailVersion = item;
    currentDetailPrevVersion = prevItem;
    isDetailRawView = false;
    currentDetailTableSubtab = 'history';

    const mode = item.mode || 'recursive';
    const modeName = mode === 'append' ? '📑 列表拼接' : (mode === 'table' ? '📊 结构双表' : '🔄 递归滚动');
    const sourceName = item.source || '手动保存';
    const floorsText = formatHiddenFloorsText(item.hiddenFloors);

    // 计算全文（与列表预览、aiRawText 去重判定共用同一重建逻辑）
    const fullText = getSnapshotFullText(item);

    const charCount = fullText.length;
    const tokenCount = countTokens(fullText);

    // 填充头部与元数据
    if (dom.summaryHistoryDetailModeBadge) {
        dom.summaryHistoryDetailModeBadge.textContent = modeName;
    }
    if (dom.summaryHistoryDetailTime) {
        dom.summaryHistoryDetailTime.textContent = item.time || '未知时间';
    }
    if (dom.summaryHistoryDetailSource) {
        dom.summaryHistoryDetailSource.textContent = sourceName;
    }
    if (dom.summaryHistoryDetailStats) {
        dom.summaryHistoryDetailStats.textContent = `${charCount.toLocaleString()} 字符 · ${tokenCount.toLocaleString()} Tokens`;
    }
    if (dom.summaryHistoryDetailFloors) {
        dom.summaryHistoryDetailFloors.textContent = floorsText;
    }

    // 填充文本框内容
    if (dom.summaryHistoryDetailTextarea) {
        dom.summaryHistoryDetailTextarea.value = fullText;
        dom.summaryHistoryDetailTextarea.scrollTop = 0;
    }

    // 视图切换条：仅当存在上一版本时才显示"对比上版"入口
    if (dom.summaryHistoryDetailViewBar) {
        dom.summaryHistoryDetailViewBar.style.display = prevItem ? 'flex' : 'none';
    }

    // 结构双表渲染
    if (mode === 'table' && item.tableData) {
        if (dom.summaryHistoryDetailTableBar) dom.summaryHistoryDetailTableBar.style.display = 'flex';
        if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'flex';
        if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'none';

        if (dom.detailTableRawToggleBtn) {
            dom.detailTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>源码视图';
        }

        renderDetailTables(item.tableData);
        switchDetailTableSubtab('history');
    } else {
        // 递归长文或卡片流
        if (dom.summaryHistoryDetailTableBar) dom.summaryHistoryDetailTableBar.style.display = 'none';
        if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'none';
        if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'flex';
    }

    // 默认视图：'snapshot' 走上述常规渲染；'compare' 进入左右对照（会统一接管显隐）
    switchDetailView(initialView === 'compare' && prevItem ? 'compare' : 'snapshot');

    dom.summaryHistoryDetailModal.style.display = 'flex';
    dom.summaryHistoryDetailModal.classList.add('visible');
}

/**
 * 切换详情弹窗主视图（快照 / 对比上版）
 * @param {'snapshot'|'compare'} view
 */
function switchDetailView(view) {
    currentDetailView = view;

    // 对照视图需要确定高度才能让 flex 链条撑满弹窗（快照视图保持内容自适应）
    if (dom.summaryHistoryDetailModal) {
        dom.summaryHistoryDetailModal.classList.toggle('detail-compare-active', view === 'compare' && !!currentDetailPrevVersion);
    }

    // 视图切换条高亮
    if (dom.summaryHistoryDetailViewBar) {
        dom.summaryHistoryDetailViewBar.querySelectorAll('.summary-history-view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.detailView === view);
        });
    }

    const isCompare = view === 'compare' && !!currentDetailPrevVersion;
    if (isCompare) {
        // 对照视图：隐藏所有快照相关容器，独占展示左右双栏
        if (dom.summaryHistoryDetailTableBar) dom.summaryHistoryDetailTableBar.style.display = 'none';
        if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'none';
        if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'none';
        if (dom.summaryHistoryDetailCompareWrapper) dom.summaryHistoryDetailCompareWrapper.style.display = 'flex';
        renderDetailCompareView();
    } else {
        // 快照视图：隐藏对照容器，恢复按记忆模式的常规呈现
        if (dom.summaryHistoryDetailCompareWrapper) dom.summaryHistoryDetailCompareWrapper.style.display = 'none';
        const mode = currentDetailVersion ? (currentDetailVersion.mode || 'recursive') : 'recursive';
        const isTable = mode === 'table' && currentDetailVersion && currentDetailVersion.tableData;
        if (isTable) {
            if (dom.summaryHistoryDetailTableBar) dom.summaryHistoryDetailTableBar.style.display = 'flex';
            if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'flex';
            if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'none';
        } else {
            if (dom.summaryHistoryDetailTableBar) dom.summaryHistoryDetailTableBar.style.display = 'none';
            if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'none';
            if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'flex';
        }
    }
}

/**
 * 渲染详情弹窗"对比上版"左右对照视图
 * — 为什么这么写 —
 * 1. 左右双栏各放完整全文（readonly textarea），比统一 diff 行堆叠更直观，
 *    用户可独立滚动两栏比对任意段落；
 * 2. 顶部用 diffLines 只做"行数增删统计"（不做行级 DOM 渲染），
 *    避免数千行快照生成海量 DOM 节点卡死页面；
 * 3. 双栏滚动按比例联动，长文本下两边视口始终大致对齐。
 */
function renderDetailCompareView() {
    if (!currentDetailVersion || !currentDetailPrevVersion) return;

    const prevText = getSnapshotFullText(currentDetailPrevVersion) || '';
    const curText = getSnapshotFullText(currentDetailVersion) || '';

    // 时间徽章
    if (dom.detailComparePrevTime) {
        dom.detailComparePrevTime.textContent = currentDetailPrevVersion.time || '未知时间';
    }
    if (dom.detailCompareCurTime) {
        dom.detailCompareCurTime.textContent = currentDetailVersion.time || '未知时间';
    }

    // 行级增删统计（仅计数，不渲染行级 DOM）
    if (dom.detailCompareStats) {
        if (prevText.trim() === curText.trim()) {
            dom.detailCompareStats.textContent = '两个版本内容完全一致';
        } else {
            const ops = diffLines(prevText, curText);
            const adds = ops.filter(op => op.type === 'add').length;
            const dels = ops.filter(op => op.type === 'del').length;
            const sameCount = ops.length - adds - dels;
            dom.detailCompareStats.textContent = `+${adds} 行新增 · -${dels} 行删除 · ${sameCount} 行一致`;
        }
    }

    // 双栏全文填充与滚动归零
    if (dom.detailComparePrevTextarea) {
        dom.detailComparePrevTextarea.value = prevText;
        dom.detailComparePrevTextarea.scrollTop = 0;
    }
    if (dom.detailCompareCurTextarea) {
        dom.detailCompareCurTextarea.value = curText;
        dom.detailCompareCurTextarea.scrollTop = 0;
    }
}

/**
 * 渲染详情弹窗内的结构双表
 * @param {object} tableData - { eventHistory, characterInfo }
 */
function renderDetailTables(tableData = {}) {
    const events = Array.isArray(tableData.eventHistory) ? tableData.eventHistory : [];
    const chars = Array.isArray(tableData.characterInfo) ? tableData.characterInfo : [];

    if (dom.detailTableHistoryTbody) {
        dom.detailTableHistoryTbody.innerHTML = '';
        if (events.length === 0) {
            dom.detailTableHistoryTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 18px; color:var(--text-secondary);">(暂无历史事件记录)</td></tr>';
        } else {
            events.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align:center;color:var(--text-secondary);font-size:11px;font-weight:600;width:40px;">${idx + 1}</td>
                    <td>${escapeHtml(row.time || '-')}</td>
                    <td>${escapeHtml(row.location || '-')}</td>
                    <td>${escapeHtml(row.characters || '-')}</td>
                    <td>${escapeHtml(row.event || '-')}</td>
                    <td>${escapeHtml(row.items || '-')}</td>
                `;
                dom.detailTableHistoryTbody.appendChild(tr);
            });
        }
    }

    if (dom.detailTableCharacterTbody) {
        dom.detailTableCharacterTbody.innerHTML = '';
        if (chars.length === 0) {
            dom.detailTableCharacterTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 18px; color:var(--text-secondary);">(暂无实体信息记录)</td></tr>';
        } else {
            chars.forEach((row, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align:center;color:var(--text-secondary);font-size:11px;font-weight:600;width:40px;">${idx + 1}</td>
                    <td style="font-weight:600;">${escapeHtml(row.name || '-')}</td>
                    <td>${escapeHtml(row.bio || '-')}</td>
                    <td>${escapeHtml(row.status || '-')}</td>
                    <td>${escapeHtml(row.items || '-')}</td>
                `;
                dom.detailTableCharacterTbody.appendChild(tr);
            });
        }
    }
}

/**
 * 切换详情弹窗双表子Tab
 * @param {'history' | 'character'} subtab
 */
function switchDetailTableSubtab(subtab) {
    currentDetailTableSubtab = subtab;

    // 若当前处于源码视图，点击表格子标签页时自动切回可视化表格
    if (isDetailRawView) {
        isDetailRawView = false;
        if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'flex';
        if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'none';
        if (dom.detailTableRawToggleBtn) {
            dom.detailTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>源码视图';
        }
    }

    if (dom.detailTableSubtabHistory) {
        if (subtab === 'history') dom.detailTableSubtabHistory.classList.add('active');
        else dom.detailTableSubtabHistory.classList.remove('active');
    }
    if (dom.detailTableSubtabCharacter) {
        if (subtab === 'character') dom.detailTableSubtabCharacter.classList.add('active');
        else dom.detailTableSubtabCharacter.classList.remove('active');
    }

    if (dom.detailTableHistoryWrapper) {
        dom.detailTableHistoryWrapper.style.display = subtab === 'history' ? 'block' : 'none';
    }
    if (dom.detailTableCharacterWrapper) {
        dom.detailTableCharacterWrapper.style.display = subtab === 'character' ? 'block' : 'none';
    }
}

/**
 * 关闭历史总结版本详情弹窗
 */
export function closeSummaryHistoryDetailModal() {
    if (!dom.summaryHistoryDetailModal) return;
    dom.summaryHistoryDetailModal.classList.remove('visible');
    dom.summaryHistoryDetailModal.style.display = 'none';
    currentDetailVersion = null;
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
    if (version.maxFloor) {
        config.lastAutoSummaryFloor = version.maxFloor;
    } else if (Array.isArray(version.hiddenFloors) && version.hiddenFloors.length > 0) {
        config.lastAutoSummaryFloor = Math.max(...version.hiddenFloors);
    }

    // 记录回滚产生的"记忆基线版本"指针（无 id 的老快照退化用 timestamp 匹配），
    // 之后即便大爷手动改动了记忆，界面仍能溯源显示"当前基于哪一版"
    config.appliedVersionId = version.id || String(version.timestamp || '');
    config.appliedAt = Date.now();

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
    closeSummaryHistoryDetailModal();
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
            // 基线快照可能随清空一并消失，顺带刷新工作台基线胶囊
            if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
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
    if (dom.summaryRollbackConfirmModal) {
        dom.summaryRollbackConfirmModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryRollbackConfirmModal) {
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

    // 历史版本详情弹窗事件绑定
    if (dom.summaryHistoryDetailCloseBtn) {
        dom.summaryHistoryDetailCloseBtn.addEventListener('click', closeSummaryHistoryDetailModal);
    }
    if (dom.summaryHistoryDetailCloseBtn2) {
        dom.summaryHistoryDetailCloseBtn2.addEventListener('click', closeSummaryHistoryDetailModal);
    }
    if (dom.summaryHistoryDetailModal) {
        dom.summaryHistoryDetailModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryHistoryDetailModal) {
                closeSummaryHistoryDetailModal();
            }
        });
    }

    // 详情弹窗内一键复制完整文本
    if (dom.summaryHistoryDetailCopyBtn) {
        dom.summaryHistoryDetailCopyBtn.addEventListener('click', async () => {
            if (!currentDetailVersion) return;
            let fullText = (dom.summaryHistoryDetailTextarea && dom.summaryHistoryDetailTextarea.value) || '';
            if (!fullText) {
                fullText = getSnapshotFullText(currentDetailVersion);
            }
            if (!fullText) {
                notify.warning('内容为空，无法复制');
                return;
            }
            try {
                await navigator.clipboard.writeText(fullText);
                notify.success('已复制总结全文到剪贴板');
            } catch (_) {
                const ta = document.createElement('textarea');
                ta.value = fullText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                notify.success('已复制总结全文到剪贴板');
            }
        });
    }

    // 详情弹窗内发起回滚
    if (dom.summaryHistoryDetailRollbackBtn) {
        dom.summaryHistoryDetailRollbackBtn.addEventListener('click', () => {
            if (!currentDetailVersion) return;
            const target = currentDetailVersion;
            closeSummaryHistoryDetailModal();
            openSummaryRollbackConfirmModal(target);
        });
    }

    // 详情弹窗主视图切换（快照 / 对比上版）
    if (dom.summaryHistoryDetailViewBar) {
        dom.summaryHistoryDetailViewBar.querySelectorAll('.summary-history-view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const view = tab.dataset.detailView;
                if (view === 'compare' && !currentDetailPrevVersion) return; // 无上一版本时对照不可用
                switchDetailView(view);
            });
        });
    }

    // 对照双栏滚动比例联动（只绑一次；比值同步保证长文本下视口大致对齐）
    if (dom.detailComparePrevTextarea && dom.detailCompareCurTextarea) {
        let isCompareScrollSyncing = false;
        const syncCompareScroll = (source, target) => {
            if (isCompareScrollSyncing) return;
            isCompareScrollSyncing = true;
            const sMax = source.scrollHeight - source.clientHeight;
            const tMax = target.scrollHeight - target.clientHeight;
            target.scrollTop = sMax > 0 ? (source.scrollTop / sMax) * tMax : 0;
            requestAnimationFrame(() => { isCompareScrollSyncing = false; });
        };
        dom.detailComparePrevTextarea.addEventListener('scroll', () => syncCompareScroll(dom.detailComparePrevTextarea, dom.detailCompareCurTextarea), { passive: true });
        dom.detailCompareCurTextarea.addEventListener('scroll', () => syncCompareScroll(dom.detailCompareCurTextarea, dom.detailComparePrevTextarea), { passive: true });
    }

    // 详情弹窗双表子Tab切换
    if (dom.detailTableSubtabHistory) {
        dom.detailTableSubtabHistory.addEventListener('click', () => switchDetailTableSubtab('history'));
    }
    if (dom.detailTableSubtabCharacter) {
        dom.detailTableSubtabCharacter.addEventListener('click', () => switchDetailTableSubtab('character'));
    }

    // 详情弹窗源码与表格视图切换
    if (dom.detailTableRawToggleBtn) {
        dom.detailTableRawToggleBtn.addEventListener('click', () => {
            isDetailRawView = !isDetailRawView;
            if (isDetailRawView) {
                if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'none';
                if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'flex';
                dom.detailTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="M9 3v18"></path></svg>表格视图';
            } else {
                if (dom.summaryHistoryDetailTableContainer) dom.summaryHistoryDetailTableContainer.style.display = 'flex';
                if (dom.summaryHistoryDetailTextWrapper) dom.summaryHistoryDetailTextWrapper.style.display = 'none';
                dom.detailTableRawToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>源码视图';
            }
        });
    }

    // 键盘 Esc 监听支持自顶向下层级关闭弹窗（回滚确认 -> 详情 -> 历史列表）
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (dom.summaryRollbackConfirmModal && dom.summaryRollbackConfirmModal.classList.contains('visible')) {
            e.preventDefault();
            closeSummaryRollbackConfirmModal();
            return;
        }
        if (dom.summaryHistoryDetailModal && dom.summaryHistoryDetailModal.classList.contains('visible')) {
            e.preventDefault();
            closeSummaryHistoryDetailModal();
            return;
        }
        if (dom.summaryHistoryModal && dom.summaryHistoryModal.classList.contains('visible')) {
            e.preventDefault();
            closeSummaryHistoryModal();
            return;
        }
    });

    // 暴露全局角标刷新方法
    window.updateHideSummaryHistoryCount = updateHideSummaryHistoryCount;
}
