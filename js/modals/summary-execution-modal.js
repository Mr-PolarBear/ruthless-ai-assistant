/**
 * @file summary-execution-modal.js
 * @description 手动总结执行前确认决策弹窗与完成后报告弹窗
 * — 为什么这么写 —
 * 1. 彻底解决手动总结楼层隐藏的黑盒与不确定性：执行前透明计算并展示当前总楼层、可见楼层范围、预期隐藏区间与保留近期楼层；
 * 2. 空双表断层强提醒防御：当从递归滚动/列表拼接切换至结构双表时，若双表为空且有历史楼层被隐藏，展示红色强提醒卡片，
 *    提供【放开所有楼层隐藏（全量重构）】与【前往精炼与重构（转为结构双表）】两种明确通路，防止历史长期记忆永久断层；
 * 3. 提供【总结并按规则隐藏】、【仅总结 (不隐藏楼层)】与【取消】三级明确决策，支持在弹窗内微调保留楼层数并实时演算；
 * 4. 总结成功后弹出结构化完成报告弹窗，清晰反馈记忆增量与最新隐藏状态，让大爷安心掌控。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { saveConversation } from '../db.js?v=temp';
import { countTokens } from '../utils.js?v=temp';
import { renderChatMessages } from '../renderer.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import {
    getHideSummaryForConversation,
    setHideSummaryForCurrentConversation
} from '../main.js?v=temp';
import {
    formatHiddenFloorsBannerInfo,
    getVisibleMessagesForSummary,
    normalizeHideSummaryConfig
} from '../summary-manager.js?v=temp';
import { openSummaryCondenseModal } from './summary-condense-modal.js?v=temp';

let confirmCallback = null;
let currentConvId = null;
let currentActiveBranch = null;
let currentHideConfig = null;
let currentVisibleMessages = [];
let isWarningActive = false;

/**
 * 刷新弹窗内部的所有楼层指示与预期计算显示
 */
function refreshModalFloorStats() {
    const totalFloors = Array.isArray(currentActiveBranch) ? currentActiveBranch.length : 0;
    const visibleCount = Array.isArray(currentVisibleMessages) ? currentVisibleMessages.length : 0;

    // 统计当前分支已隐藏的楼层
    const currentHiddenFloors = [];
    if (Array.isArray(currentActiveBranch)) {
        currentActiveBranch.forEach((msg, idx) => {
            if (msg.hidden) currentHiddenFloors.push(idx + 1);
        });
    }
    const hiddenInfo = formatHiddenFloorsBannerInfo(currentHiddenFloors);

    // 楼层指示元素注入
    const totalEl = document.getElementById('summary-confirm-total-floors');
    const hiddenEl = document.getElementById('summary-confirm-hidden-floors');
    const visibleEl = document.getElementById('summary-confirm-visible-floors');
    const keepInput = document.getElementById('summary-confirm-keep-count-input');
    const previewEl = document.getElementById('summary-confirm-calc-preview');

    if (totalEl) totalEl.textContent = `${totalFloors} 层`;
    if (hiddenEl) hiddenEl.textContent = hiddenInfo.mainText || '无隐藏楼层';
    if (visibleEl) {
        if (visibleCount > 0) {
            const startF = currentVisibleMessages[0].floor;
            const endF = currentVisibleMessages[visibleCount - 1].floor;
            visibleEl.textContent = `第 ${startF} ~ ${endF} 楼 (共 ${visibleCount} 层)`;
        } else {
            visibleEl.textContent = '0 层';
        }
    }

    if (!previewEl) return;
    const currentKeep = Math.max(0, parseInt(keepInput ? keepInput.value : '0', 10) || 0);

    if (visibleCount === 0) {
        previewEl.innerHTML = '<span class="confirm-calc-tip warning">⚠️ 当前没有可见消息供归档隐藏。</span>';
        return;
    }

    if (currentKeep === 0) {
        const startF = currentVisibleMessages[0].floor;
        const endF = currentVisibleMessages[visibleCount - 1].floor;
        previewEl.innerHTML = `<span class="confirm-calc-tip success">📌 <strong>预期归档：</strong>将自动隐藏 <strong>第 ${startF} ~ ${endF} 楼</strong> (共 ${visibleCount} 层全部释放)。</span>`;
        return;
    }

    if (currentKeep >= visibleCount) {
        previewEl.innerHTML = `<span class="confirm-calc-tip info">📌 <strong>预期归档：</strong>当前可见消息共 ${visibleCount} 层 ≤ 保留楼层数 (${currentKeep} 层)，本次总结后 <strong>所有消息将全部保持可见</strong>。</span>`;
        return;
    }

    const hideCount = visibleCount - currentKeep;
    const hideStartF = currentVisibleMessages[0].floor;
    const hideEndF = currentVisibleMessages[hideCount - 1].floor;
    const keepStartF = currentVisibleMessages[hideCount].floor;
    const keepEndF = currentVisibleMessages[visibleCount - 1].floor;

    previewEl.innerHTML = `<span class="confirm-calc-tip success">📌 <strong>预期归档：</strong>将自动隐藏 <strong>第 ${hideStartF} ~ ${hideEndF} 楼</strong> (共 ${hideCount} 层)；保留 <strong>第 ${keepStartF} ~ ${keepEndF} 楼</strong> (共 ${currentKeep} 层) 供近期语境参考。</span>`;
}

/**
 * 获取记忆模式的人类可读中文名称
 * @param {string} mode - 'recursive' | 'table' | 'append'
 * @returns {string} 中文标签
 */
function getMemoryModeLabel(mode) {
    if (mode === 'table') return '结构双表';
    if (mode === 'append') return '列表拼接';
    return '递归滚动';
}

/**
 * 校验指定模式在当前配置下是否内容为空
 * @param {object} config - 隐藏与总结配置
 * @param {string} mode - 'recursive' | 'table' | 'append'
 * @returns {{ isEmpty: boolean, emptyDetail: string }}
 */
function checkModeIsEmpty(config, mode) {
    if (mode === 'table') {
        const isTableEmpty = (!config?.tableData?.eventHistory || config.tableData.eventHistory.length === 0)
            && (!config?.tableData?.characterInfo || config.tableData.characterInfo.length === 0);
        return { isEmpty: isTableEmpty, emptyDetail: '双表内容为空 (0 个条目)' };
    }
    if (mode === 'append') {
        const isAppendEmpty = !Array.isArray(config?.summaryList) || config.summaryList.length === 0;
        return { isEmpty: isAppendEmpty, emptyDetail: '记忆卡片流为空 (0 个记忆片段)' };
    }
    // recursive
    const isRecursiveEmpty = !config?.summary || !config.summary.trim();
    return { isEmpty: isRecursiveEmpty, emptyDetail: '长文总结内容为空 (0 字符)' };
}

/**
 * 获取可供跨模式重构继承的所有非空源记忆列表及目标转换策略
 * — 为什么这么写 —
 * 1. 之前使用 if-else 硬编码判定单一源，当用户同时沉淀过【结构双表】与【递归长文】时，
 *    系统擅自挑走其中一个，剥夺了用户自主选择继承哪份记忆的权利；
 * 2. 此处遍历排查当前选定目标模式以外的所有其他非空模式记忆，返回完整的来源清单及数据量摘要，
 *    供弹窗并列展示所有可选入口，实现零多余点击的一步直达体验。
 * @param {object} config - 隐藏与总结配置
 * @param {string} targetMode - 当前选定的目标模式 ('recursive' | 'table' | 'append')
 * @returns {{
 *   hasLegacyMemory: boolean,
 *   availableSources: Array<{
 *     sourceMode: string,
 *     sourceModeName: string,
 *     detail: string,
 *     targetStrategy: string,
 *     targetStrategyName: string
 *   }>,
 *   sourceMode: string | null,
 *   sourceModeName: string,
 *   targetStrategy: string,
 *   targetStrategyName: string
 * }}
 */
function getModeTransitionInfo(config, targetMode) {
    let targetStrategy = 'balanced';
    let targetStrategyName = '均衡精炼';
    if (targetMode === 'table') {
        targetStrategy = 'to_table';
        targetStrategyName = '结构双表';
    } else if (targetMode === 'append') {
        targetStrategy = 'to_append';
        targetStrategyName = '列表卡片';
    } else if (targetMode === 'recursive') {
        targetStrategy = 'to_recursive';
        targetStrategyName = '递归长文';
    }

    const availableSources = [];

    // 1. 递归长文来源检查 (非目标模式时)
    if (targetMode !== 'recursive') {
        const recursiveText = (config?.summary || '').trim();
        if (recursiveText) {
            availableSources.push({
                sourceMode: 'recursive',
                sourceModeName: '递归长文',
                detail: `${recursiveText.length.toLocaleString()} 字符`,
                targetStrategy,
                targetStrategyName
            });
        }
    }

    // 2. 结构双表来源检查 (非目标模式时)
    if (targetMode !== 'table') {
        const eventsCount = Array.isArray(config?.tableData?.eventHistory) ? config.tableData.eventHistory.length : 0;
        const charsCount = Array.isArray(config?.tableData?.characterInfo) ? config.tableData.characterInfo.length : 0;
        if (eventsCount > 0 || charsCount > 0) {
            availableSources.push({
                sourceMode: 'table',
                sourceModeName: '结构双表',
                detail: `${eventsCount} 条事件 / ${charsCount} 个角色`,
                targetStrategy,
                targetStrategyName
            });
        }
    }

    // 3. 列表拼接来源检查 (非目标模式时)
    if (targetMode !== 'append') {
        const cardsCount = Array.isArray(config?.summaryList) ? config.summaryList.length : 0;
        if (cardsCount > 0) {
            availableSources.push({
                sourceMode: 'append',
                sourceModeName: '列表卡片',
                detail: `${cardsCount} 个记忆片段`,
                targetStrategy,
                targetStrategyName
            });
        }
    }

    return {
        hasLegacyMemory: availableSources.length > 0,
        availableSources,
        sourceMode: availableSources[0]?.sourceMode || null,
        sourceModeName: availableSources[0]?.sourceModeName || '',
        targetStrategy,
        targetStrategyName
    };
}

/**
 * 处理选择1：放开所有楼层隐藏（全量重构）
 */
function handleUnhideAllFloors() {
    if (!currentConvId || !Array.isArray(currentActiveBranch)) return;

    if (!confirm('确定要放开当前分支的所有隐藏楼层吗？\n\n放开后所有楼层将变为可见状态并全量参与本次总结重构。\n⚠️ 提示：楼层越多消耗 Token 与 API 费用越大，请按需选择。')) {
        return;
    }

    const conv = state.conversations[currentConvId];
    if (conv && conv.branches && conv.branches[conv.activeBranchIndex]) {
        conv.branches[conv.activeBranchIndex].forEach(m => {
            delete m.hidden;
        });
        saveConversation(conv.id, conv);
    }
    setHideSummaryForCurrentConversation({
        hiddenFloors: []
    });
    renderChatMessages({ updateVisibilityOnly: true });
    if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
    if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
    if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();

    // 重新获取最新的可见消息集合并消除警告
    const updatedConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(currentConvId));
    currentHideConfig = updatedConfig;
    currentVisibleMessages = getVisibleMessagesForSummary(currentActiveBranch, updatedConfig);
    isWarningActive = false;

    const warningCard = document.getElementById('summary-confirm-empty-table-warning');
    if (warningCard) warningCard.style.display = 'none';

    refreshModalFloorStats();
    notify.success('已放开所有楼层隐藏，当前全量楼层均已参与本次总结重构。');
}

/**
 * 触发跨模式重构跳转
 * @param {string} sourceMode - 源记忆模式 ('recursive' | 'table' | 'append')
 * @param {string} targetStrategy - 目标策略 ('to_table' | 'to_recursive' | 'to_append')
 * @param {string} sourceModeName - 源模式中文名
 * @param {string} targetStrategyName - 目标策略中文名
 */
function triggerCondenseTransition(sourceMode, targetStrategy, sourceModeName, targetStrategyName) {
    closeSummaryExecutionConfirmModal();
    openSummaryCondenseModal({
        forceSourceMode: sourceMode,
        initialStrategy: targetStrategy
    });

    notify.info(`已为您载入【${sourceModeName || '历史'}】记忆并预设【转为${targetStrategyName}】策略，请点击开始跨模式重构。`);
}

/**
 * 打开总结执行前确认决策弹窗
 * @param {object} params
 * @param {string} params.convId - 会话ID
 * @param {Array<object>} params.activeBranch - 当前活跃分支消息数组
 * @param {object} params.hideConfig - 当前隐藏与总结配置
 * @param {Array<object>} params.visibleMessages - 本次待总结的可见消息集合 [{ msg, floor, index }]
 * @param {Function} params.onProceed - 确认后的回调函数 ({ dropFloors: boolean, keepRecentCount: number, updatedVisibleMessages?: Array }) => void
 */
export function openSummaryExecutionConfirmModal({ convId, activeBranch, hideConfig, visibleMessages, onProceed }) {
    const modal = document.getElementById('summary-execution-confirm-modal');
    if (!modal) return;

    confirmCallback = onProceed;
    currentConvId = convId;
    currentActiveBranch = activeBranch;
    currentHideConfig = hideConfig;
    currentVisibleMessages = Array.isArray(visibleMessages) ? [...visibleMessages] : [];

    const keepInput = document.getElementById('summary-confirm-keep-count-input');

    // 读取保留末尾楼层配置（优先从表单或配置中读取）
    let initialKeep = 2;
    if (dom.autoSummaryKeepRecentCount && !isNaN(parseInt(dom.autoSummaryKeepRecentCount.value, 10))) {
        initialKeep = parseInt(dom.autoSummaryKeepRecentCount.value, 10);
    } else if (hideConfig && typeof hideConfig.keepRecentFloorsCount === 'number') {
        initialKeep = hideConfig.keepRecentFloorsCount;
    }
    if (hideConfig && hideConfig.keepRecentFloors === false) {
        initialKeep = 0;
    }

    if (keepInput) {
        keepInput.value = initialKeep.toString();
        keepInput.oninput = refreshModalFloorStats;
    }

    // 统计当前已隐藏的楼层
    const currentHiddenFloors = [];
    if (Array.isArray(activeBranch)) {
        activeBranch.forEach((msg, idx) => {
            if (msg.hidden) currentHiddenFloors.push(idx + 1);
        });
    }

    // — 为什么这么写 —
    // 空记忆断层强提醒通用防御引擎：
    // 覆盖【结构双表】、【列表拼接】与【递归滚动】全模式！
    // 当任意当前模式内容为空，且存在已隐藏楼层（或存在其他模式的历史记忆），
    // 若直接执行可见消息总结，AI 无法看到被隐藏的历史楼层，且前置无旧记忆参考，必然导致历史记忆断层丢失！
    const mode = hideConfig?.memoryMode || 'recursive';
    const { isEmpty, emptyDetail } = checkModeIsEmpty(hideConfig, mode);
    const { hasLegacyMemory, availableSources, targetStrategy, targetStrategyName } = getModeTransitionInfo(hideConfig, mode);
    const hasHiddenFloors = currentHiddenFloors.length > 0;
    const totalFloors = Array.isArray(activeBranch) ? activeBranch.length : 0;

    isWarningActive = isEmpty && (hasHiddenFloors || hasLegacyMemory);

    const warningCard = document.getElementById('summary-confirm-empty-table-warning');
    const warningTitle = document.getElementById('summary-confirm-warning-title');
    const warningDesc = document.getElementById('summary-confirm-empty-table-desc');
    const unhideOptionItem = document.getElementById('summary-confirm-unhide-option-item');
    const unhideSubDesc = document.getElementById('summary-confirm-unhide-sub-desc');
    const sourcesContainer = document.getElementById('summary-confirm-condense-sources-container');

    if (warningCard) {
        if (isWarningActive) {
            warningCard.style.display = 'flex';
            if (warningTitle) {
                warningTitle.textContent = `检测到【${getMemoryModeLabel(mode)}】尚未初始化，直接总结将丢失历史！`;
            }
            if (warningDesc) {
                if (hasHiddenFloors) {
                    warningDesc.innerHTML = `当前处于【${getMemoryModeLabel(mode)}】模式，但${emptyDetail}，且历史上有 <strong>${currentHiddenFloors.length} 层楼已被隐藏</strong>。若直接基于当前可见消息总结，被隐藏的历史剧情与设定将无法沉淀至当前记忆中，造成长期记忆永久断层！`;
                } else {
                    warningDesc.innerHTML = `当前处于【${getMemoryModeLabel(mode)}】模式，但${emptyDetail}。检测到历史积累的记忆尚未转为【${getMemoryModeLabel(mode)}】，建议先通过【精炼与重构】转换后再来总结！`;
                }
            }
            if (unhideOptionItem) {
                unhideOptionItem.style.display = hasHiddenFloors ? 'flex' : 'none';
            }
            if (unhideSubDesc) {
                unhideSubDesc.textContent = `解除所有楼层隐藏，将全量 ${totalFloors} 楼对话发给 AI 重新生成完整【${getMemoryModeLabel(mode)}】。`;
            }

            // — 为什么这么写 —
            // 多来源重构选项动态渲染引擎：
            // 1. 若只有 1 种历史记忆源：展示单项推荐卡片；
            // 2. 若存在 ≥2 种历史记忆源（如大爷同时沉淀了【结构双表】和【递归长文】）：
            //    并列渲染专属转换按钮，并标明各自的数据量（如 8条事件/3个角色 vs 1,520字符），
            //    让大爷自由挑选以哪份心血记忆作为基底，点击一步到位直达重构！
            if (sourcesContainer) {
                if (!hasLegacyMemory || availableSources.length === 0) {
                    sourcesContainer.innerHTML = '';
                    sourcesContainer.style.display = 'none';
                } else if (availableSources.length === 1) {
                    const src = availableSources[0];
                    sourcesContainer.style.display = 'flex';
                    sourcesContainer.innerHTML = `
                        <div class="confirm-warning-option-item">
                            <div class="option-item-main">
                                <button type="button" class="warning-action-btn primary" data-source-mode="${src.sourceMode}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>
                                    <span>前往精炼与重构（从【${src.sourceModeName}】转为${targetStrategyName}）</span>
                                </button>
                                <span class="option-item-tip success">推荐 · 零损继承历史记忆</span>
                            </div>
                            <div class="option-item-sub">保持楼层隐藏，直接将已沉淀的【${src.sourceModeName}】(${src.detail}) 一键转换为【${targetStrategyName}】后再来总结。</div>
                        </div>
                    `;
                } else {
                    sourcesContainer.style.display = 'flex';
                    let itemsHtml = `
                        <div class="confirm-warning-multi-hint">
                            ✨ 检测到存在多个历史记忆基底，请选择由哪个来源一键重构为【${targetStrategyName}】：
                        </div>
                    `;
                    availableSources.forEach(src => {
                        itemsHtml += `
                            <div class="confirm-warning-option-item">
                                <div class="option-item-main">
                                    <button type="button" class="warning-action-btn primary" data-source-mode="${src.sourceMode}">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>
                                        <span>从【${src.sourceModeName}】转为${targetStrategyName}</span>
                                    </button>
                                    <span class="option-item-tip info">${src.detail}</span>
                                </div>
                                <div class="option-item-sub">保持楼层隐藏，以已沉淀的【${src.sourceModeName}】为基底一键转换为【${targetStrategyName}】后再来总结。</div>
                            </div>
                        `;
                    });
                    sourcesContainer.innerHTML = itemsHtml;
                }
            }
        } else {
            warningCard.style.display = 'none';
        }
    }

    // 刷新楼层统计与动态计算预览
    refreshModalFloorStats();

    modal.style.display = 'flex';
}

/**
 * 关闭总结确认弹窗
 */
export function closeSummaryExecutionConfirmModal() {
    const modal = document.getElementById('summary-execution-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    confirmCallback = null;
    isWarningActive = false;
}

/**
 * 打开总结完成报告模态弹窗
 * @param {object} params
 * @param {string} params.mode - 记忆模式 ('recursive'|'append'|'table')
 * @param {string} params.summaryText - 总结结果正文
 * @param {boolean} params.dropFloors - 是否执行了归档隐藏
 * @param {Array<number>} params.newHiddenFloors - 总结完成后的全部已隐藏楼层集合
 * @param {number} params.totalFloors - 总楼层数
 * @param {number} params.keepCount - 保留近期楼层数
 * @param {Array<object>} params.summarizedMessages - 本次参与总结的楼层列表
 */
export function openSummaryExecutionCompleteModal({
    mode = 'recursive',
    summaryText = '',
    dropFloors = true,
    newHiddenFloors = [],
    totalFloors = 0,
    keepCount = 2,
    summarizedMessages = []
}) {
    const modal = document.getElementById('summary-execution-complete-modal');
    if (!modal) return;

    const modeName = mode === 'recursive' ? '递归滚动' : mode === 'append' ? '列表拼接' : '结构双表';
    const modeBadge = document.getElementById('summary-complete-mode-badge');
    const statsEl = document.getElementById('summary-complete-stats');
    const archiveResultEl = document.getElementById('summary-complete-archive-result');

    if (modeBadge) {
        modeBadge.textContent = modeName;
    }

    if (statsEl) {
        const charCount = (summaryText || '').length;
        const tokenEst = countTokens(summaryText || '');
        statsEl.textContent = `本次提炼约 ${charCount.toLocaleString()} 字符 · 预估 ${tokenEst.toLocaleString()} Tokens`;
    }

    if (archiveResultEl) {
        const hiddenInfo = formatHiddenFloorsBannerInfo(newHiddenFloors);
        if (dropFloors) {
            const visibleCount = summarizedMessages.length;
            if (keepCount > 0 && keepCount < visibleCount) {
                const keepStartF = summarizedMessages[visibleCount - keepCount]?.floor;
                const keepEndF = summarizedMessages[visibleCount - 1]?.floor;
                archiveResultEl.innerHTML = `
                    <div class="complete-archive-status success">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success-color, #1a7f37);"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        <span><strong>已按规则自动归档隐藏历史楼层</strong></span>
                    </div>
                    <div class="complete-archive-details">
                        <div>已隐藏楼层现为：<strong>${hiddenInfo.mainText || '无'}</strong></div>
                        <div style="color: var(--text-secondary); margin-top: 4px;">已保留末尾第 <strong>${keepStartF} ~ ${keepEndF} 楼</strong> (共 ${keepCount} 层) 保持可见，供后续对话参考。</div>
                    </div>
                `;
            } else if (keepCount >= visibleCount) {
                archiveResultEl.innerHTML = `
                    <div class="complete-archive-status info">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-blue, #0969da);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        <span><strong>本次可见楼层未做隐藏 (全数保留)</strong></span>
                    </div>
                    <div class="complete-archive-details">
                        <div>当前参与总结的消息数量 (${visibleCount} 层) 小于或等于保留楼层数 (${keepCount} 层)，已自动全数保留可见。</div>
                        <div style="color: var(--text-secondary); margin-top: 4px;">当前已隐藏楼层维持：<strong>${hiddenInfo.mainText || '无隐藏'}</strong></div>
                    </div>
                `;
            } else {
                archiveResultEl.innerHTML = `
                    <div class="complete-archive-status success">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success-color, #1a7f37);"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        <span><strong>已将本次参与总结的楼层全部归档隐藏</strong></span>
                    </div>
                    <div class="complete-archive-details">
                        <div>已隐藏楼层现为：<strong>${hiddenInfo.mainText || '无'}</strong></div>
                    </div>
                `;
            }
        } else {
            archiveResultEl.innerHTML = `
                <div class="complete-archive-status info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <span><strong>仅生成记忆，未执行楼层归档隐藏</strong></span>
                </div>
                <div class="complete-archive-details">
                    <div>所有消息楼层维持当前可见状态，已隐藏楼层仍为：<strong>${hiddenInfo.mainText || '无'}</strong></div>
                </div>
            `;
        }
    }

    modal.style.display = 'flex';
}

/**
 * 关闭总结完成报告模态弹窗
 */
export function closeSummaryExecutionCompleteModal() {
    const modal = document.getElementById('summary-execution-complete-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 初始化绑定模态弹窗各操作按钮事件
 */
export function setupSummaryExecutionModalEvents() {
    // 1. 确认弹窗操作
    const confirmModal = document.getElementById('summary-execution-confirm-modal');
    const closeBtn = document.getElementById('summary-confirm-close-btn');
    const cancelBtn = document.getElementById('summary-confirm-cancel-btn');
    const proceedHideBtn = document.getElementById('summary-confirm-proceed-hide-btn');
    const proceedNoHideBtn = document.getElementById('summary-confirm-proceed-no-hide-btn');
    const keepInput = document.getElementById('summary-confirm-keep-count-input');
    const unhideAllBtn = document.getElementById('summary-confirm-unhide-all-btn');
    const sourcesContainer = document.getElementById('summary-confirm-condense-sources-container');

    if (closeBtn) closeBtn.addEventListener('click', closeSummaryExecutionConfirmModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSummaryExecutionConfirmModal);

    if (unhideAllBtn) unhideAllBtn.addEventListener('click', handleUnhideAllFloors);

    // 绑定多来源重构卡片点击事件委托
    if (sourcesContainer) {
        sourcesContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-source-mode]');
            if (!btn) return;
            const sourceMode = btn.dataset.sourceMode;
            const config = currentHideConfig || normalizeHideSummaryConfig(getHideSummaryForConversation(currentConvId));
            const mode = config?.memoryMode || 'recursive';
            const { availableSources, targetStrategy, targetStrategyName } = getModeTransitionInfo(config, mode);
            const match = availableSources.find(s => s.sourceMode === sourceMode);
            const srcName = match ? match.sourceModeName : '历史';
            triggerCondenseTransition(sourceMode, targetStrategy, srcName, targetStrategyName);
        });
    }

    if (proceedHideBtn) {
        proceedHideBtn.addEventListener('click', () => {
            if (isWarningActive) {
                const modeLabel = getMemoryModeLabel(currentHideConfig?.memoryMode || 'recursive');
                if (!confirm(`【严重警示】当前【${modeLabel}】内容为空，且有历史楼层已被隐藏。\n若直接总结，被隐藏的历史事实将无法进入当前记忆，导致长期记忆永久断层！\n\n确定仍要执意直接总结吗？（强烈推荐先点击【前往精炼与重构】进行转换）`)) {
                    return;
                }
            }
            const keepCount = Math.max(0, parseInt(keepInput ? keepInput.value : '2', 10) || 0);
            const cb = confirmCallback;
            const targetMsgs = currentVisibleMessages;
            closeSummaryExecutionConfirmModal();
            if (cb) cb({ dropFloors: true, keepRecentCount: keepCount, updatedVisibleMessages: targetMsgs });
        });
    }

    if (proceedNoHideBtn) {
        proceedNoHideBtn.addEventListener('click', () => {
            if (isWarningActive) {
                const modeLabel = getMemoryModeLabel(currentHideConfig?.memoryMode || 'recursive');
                if (!confirm(`【严重警示】当前【${modeLabel}】内容为空，且有历史楼层已被隐藏。\n若直接总结，被隐藏的历史事实将无法进入当前记忆，导致长期记忆永久断层！\n\n确定仍要执意直接总结吗？（强烈推荐先点击【前往精炼与重构】进行转换）`)) {
                    return;
                }
            }
            const cb = confirmCallback;
            const targetMsgs = currentVisibleMessages;
            closeSummaryExecutionConfirmModal();
            if (cb) cb({ dropFloors: false, keepRecentCount: 0, updatedVisibleMessages: targetMsgs });
        });
    }

    // 2. 完成弹窗操作
    const completeModal = document.getElementById('summary-execution-complete-modal');
    const completeCloseBtn = document.getElementById('summary-complete-close-btn');
    const completeOkBtn = document.getElementById('summary-complete-ok-btn');

    if (completeCloseBtn) completeCloseBtn.addEventListener('click', closeSummaryExecutionCompleteModal);
    if (completeOkBtn) completeOkBtn.addEventListener('click', closeSummaryExecutionCompleteModal);
}
