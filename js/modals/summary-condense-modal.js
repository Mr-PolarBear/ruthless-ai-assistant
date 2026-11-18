/**
 * @file summary-condense-modal.js
 * @description 记忆二次浓缩与精炼对比弹窗模块
 * — 为什么这么写 —
 * 1. 随着长线对话发展（如300~500楼深度对话），长期记忆变得庞大冗长，占用大量上下文窗口；
 * 2. 二次浓缩直接以已有记忆自身为输入，进行脱水去重与降维精炼；
 * 3. 采用左右双栏独立滚动对比面板，左栏看原貌，右栏流式打字并支持自由微调；
 * 4. 预设提示词即点即填且完全可自由修改；
 * 5. 替换前自动在历史版本树中生成“二次浓缩前备份”快照，100%提供安全后悔药。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { countTokens, saveToLocalStorage, extractThinkingFromContent } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { saveConversation } from '../db.js?v=temp';
import { getHideSummaryForConversation, setHideSummaryForConversation } from '../main.js?v=temp';
import {
    normalizeHideSummaryConfig,
    formatSummaryListToText,
    formatTablesToMarkdown,
    parseMarkdownTables,
    parseCardsFromCondensedText,
    recordSummaryVersion,
    condenseMemoryApiCall,
    getDefaultCondensePrompt
} from '../summary-manager.js?v=temp';

let currentConvId = null;
let currentMemoryMode = 'recursive';
let originalMemoryText = '';
let originalCharCount = 0;
let originalTokenCount = 0;
let currentStrategy = 'balanced'; // 'balanced' | 'extreme' | 'to_table' | 'to_recursive' | 'to_append'
let isCondensing = false;
let condenseAbortController = null;

const CONDENSE_ICONS = {
    sparkles: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>',
    stop: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="5" y="5" rx="2"></rect></svg>',
    refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>'
};

/**
 * 获取当前记忆模式的人类友好中文名称
 * @param {string} mode - 'recursive' | 'table' | 'append'
 * @returns {string} 模式标签
 */
function getModeLabel(mode) {
    if (mode === 'table') return '结构双表';
    if (mode === 'append') return '列表拼接';
    return '递归滚动';
}

/**
 * 根据所选策略计算目标记忆模式
 * @param {string} sourceMode - 当前记忆模式
 * @param {string} strategy - 策略标识
 * @returns {string} 目标模式
 */
function getTargetModeForStrategy(sourceMode, strategy) {
    if (strategy === 'to_table') return 'table';
    if (strategy === 'to_recursive') return 'recursive';
    if (strategy === 'to_append') return 'append';
    return sourceMode;
}

/**
 * 刷新右栏新记忆的字数、预估Tokens与瘦身百分比徽章
 */
function updateTargetStats() {
    if (!dom.condenseTargetTextarea || !dom.condenseTargetStats) return;
    const text = dom.condenseTargetTextarea.value || '';
    const charCount = text.length;
    const tokenCount = countTokens(text);

    dom.condenseTargetStats.textContent = `${charCount.toLocaleString()} 字符 · ${tokenCount.toLocaleString()} Tokens`;

    if (dom.condenseReductionBadge) {
        if (charCount > 0 && originalCharCount > 0) {
            const ratio = Math.round((1 - charCount / originalCharCount) * 100);
            if (ratio > 0) {
                dom.condenseReductionBadge.textContent = `瘦身 -${ratio}%`;
                dom.condenseReductionBadge.style.display = 'inline-flex';
            } else if (ratio < 0) {
                dom.condenseReductionBadge.textContent = `膨胀 +${Math.abs(ratio)}%`;
                dom.condenseReductionBadge.style.display = 'inline-flex';
            } else {
                dom.condenseReductionBadge.style.display = 'none';
            }
        } else {
            dom.condenseReductionBadge.style.display = 'none';
        }
    }
}

/**
 * 同步底部应用按钮（确认替换/转换为XX并备份）的可用态
 * — 为什么这么写 —
 * 1. 右栏生成完毕后仍支持手动编辑，若用户把内容删空，按钮必须即时回灰，
 *    杜绝"按钮可点、点了才弹内容为空警告"的体验断层；
 * 2. 浓缩进行中（isCondensing）强制灰置，防止流式输出中途误触应用半成品；
 * 3. 中断/失败后右栏若留有部分内容，同样允许直接应用，与"有内容即可用"规则保持一致。
 */
function syncApplyBtnState() {
    if (!dom.summaryCondenseApplyBtn || !dom.condenseTargetTextarea) return;
    const hasTarget = !!dom.condenseTargetTextarea.value.trim();
    dom.summaryCondenseApplyBtn.disabled = isCondensing || !hasTarget;
}

/**
 * 刷新提示词输入框的字数统计
 */
function updatePromptCharCounter() {
    if (dom.summaryCondensePrompt && dom.summaryCondensePromptChars) {
        dom.summaryCondensePromptChars.textContent = `${dom.summaryCondensePrompt.value.length} 字`;
    }
}

/**
 * 切换精炼或跨模式重构策略并灌入对应默认提示词
 * @param {string} strategy - 'balanced' | 'extreme' | 'to_table' | 'to_recursive' | 'to_append'
 * @param {boolean} [forceReset=false] - 是否强制覆盖当前提示词
 */
function applyStrategy(strategy, forceReset = false) {
    currentStrategy = strategy;
    const targetMode = getTargetModeForStrategy(currentMemoryMode, currentStrategy);
    const isCrossMode = targetMode !== currentMemoryMode;

    const pills = dom.condenseStrategyPills || document.querySelectorAll('.condense-strategy-pill');
    if (pills) {
        pills.forEach(pill => {
            if (pill.dataset.strategy === strategy) pill.classList.add('active');
            else pill.classList.remove('active');
        });
    }

    const defaultPrompt = getDefaultCondensePrompt(currentMemoryMode, strategy);

    if (dom.summaryCondensePrompt) {
        // 若强制重置，或当前输入框为空，则灌入默认提示词
        if (forceReset || !dom.summaryCondensePrompt.value.trim()) {
            dom.summaryCondensePrompt.value = defaultPrompt;
        }
        updatePromptCharCounter();
    }

    if (dom.summaryCondenseStartBtn && !isCondensing) {
        dom.summaryCondenseStartBtn.innerHTML = isCrossMode
            ? `${CONDENSE_ICONS.sparkles}<span>开始跨模式重构</span>`
            : `${CONDENSE_ICONS.sparkles}<span>开始二次浓缩</span>`;
    }
    if (dom.summaryCondenseApplyBtnText) {
        dom.summaryCondenseApplyBtnText.textContent = isCrossMode
            ? `转换为【${getModeLabel(targetMode)}】并备份`
            : '确认替换并备份原记忆';
    }
}

/**
 * 打开记忆精炼与跨模式重构中心弹窗
 * @param {object} [options]
 * @param {string} [options.forceSourceMode] - 强制指定源记忆模式 ('recursive'|'append'|'table')
 * @param {string} [options.initialStrategy] - 初始选中的重构/精炼策略 ('balanced'|'extreme'|'to_table'|'to_recursive'|'to_append')
 */
export function openSummaryCondenseModal(options = {}) {
    if (!dom.summaryCondenseModal) return;

    const convId = state.currentConversationId;
    if (!convId) {
        notify.warning('未找到活动会话，请先选择一个对话。');
        return;
    }

    const { forceSourceMode = null, initialStrategy = null } = (typeof options === 'object' && options !== null) ? options : {};

    currentConvId = convId;
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    // — 为什么这么写 —
    // 智能识别跨模式源记忆：
    // 1. 若显式指定了 forceSourceMode（例如从确认弹窗点击“转为xxx”），直接采纳该模式作为源记忆；
    // 2. 若用户在设置中切至某一新模式但内容为空，且存在其他模式历史记忆，自动智能回溯至旧模式作为源记忆载入，
    //    彻底规避“当前记忆内容为空”误判阻断，并允许用户一键跨模式重构为目标记忆！
    let sourceMode = config.memoryMode || 'recursive';
    if (forceSourceMode) {
        sourceMode = forceSourceMode;
    } else {
        const isTableEmpty = (!config.tableData?.eventHistory || config.tableData.eventHistory.length === 0)
            && (!config.tableData?.characterInfo || config.tableData.characterInfo.length === 0);
        const isAppendEmpty = !Array.isArray(config.summaryList) || config.summaryList.length === 0;
        const isRecursiveEmpty = !config.summary || !config.summary.trim();

        if (sourceMode === 'table' && isTableEmpty) {
            if (!isRecursiveEmpty) sourceMode = 'recursive';
            else if (!isAppendEmpty) sourceMode = 'append';
        } else if (sourceMode === 'append' && isAppendEmpty) {
            if (!isRecursiveEmpty) sourceMode = 'recursive';
            else if (!isTableEmpty) sourceMode = 'table';
        } else if (sourceMode === 'recursive' && isRecursiveEmpty) {
            if (!isAppendEmpty) sourceMode = 'append';
            else if (!isTableEmpty) sourceMode = 'table';
        }
    }
    currentMemoryMode = sourceMode;

    // — 为什么这么写 —
    // 动态提取当前模式要被精炼脱水的原始记忆文本：
    // 1. 递归模式：直接读取 summary 文本；
    // 2. 列表拼接模式：将卡片流序列化为拼接列表文本；
    // 3. 结构双表模式：将双表数据序列化为标准 Markdown 表格文本。
    if (currentMemoryMode === 'recursive') {
        originalMemoryText = (config.summary || '').trim();
    } else if (currentMemoryMode === 'append') {
        originalMemoryText = formatSummaryListToText(config.summaryList).trim();
    } else if (currentMemoryMode === 'table') {
        originalMemoryText = formatTablesToMarkdown(config.tableData?.eventHistory, config.tableData?.characterInfo).trim();
    }

    if (!originalMemoryText) {
        notify.info('当前模式下的记忆内容为空，无需进行精炼或跨模式重构。');
        return;
    }

    originalCharCount = originalMemoryText.length;
    originalTokenCount = countTokens(originalMemoryText);

    // 0. 动态控制跨模式重构策略胶囊的显隐（当前源记忆以外的其他模式均可作为重构目标）
    if (dom.condensePillToTable) {
        dom.condensePillToTable.style.display = (currentMemoryMode === 'table') ? 'none' : 'inline-block';
    }
    if (dom.condensePillToRecursive) {
        dom.condensePillToRecursive.style.display = (currentMemoryMode === 'recursive') ? 'none' : 'inline-block';
    }
    if (dom.condensePillToAppend) {
        dom.condensePillToAppend.style.display = (currentMemoryMode === 'append') ? 'none' : 'inline-block';
    }

    // 1. 初始化头部模式标签
    if (dom.summaryCondenseModeTag) {
        dom.summaryCondenseModeTag.textContent = getModeLabel(currentMemoryMode);
    }

    // 2. 填充左栏原记忆内容与统计
    if (dom.condenseOrigTextarea) {
        dom.condenseOrigTextarea.value = originalMemoryText;
        dom.condenseOrigTextarea.scrollTop = 0;
    }
    if (dom.condenseOrigStats) {
        dom.condenseOrigStats.textContent = `${originalCharCount.toLocaleString()} 字符 · ${originalTokenCount.toLocaleString()} Tokens`;
    }

    // 3. 重置右栏目标文本
    if (dom.condenseTargetTextarea) {
        dom.condenseTargetTextarea.value = '';
    }
    updateTargetStats();

    // 3.1 默认重置携带角色与备忘录复选框状态（默认均勾选）
    if (dom.summaryCondenseWithRole) {
        dom.summaryCondenseWithRole.checked = true;
    }
    if (dom.summaryCondenseWithWorldBook) {
        dom.summaryCondenseWithWorldBook.checked = false; // 默认不勾选备忘录
    }

    // 4. 初始化策略与提示词（若指定了 initialStrategy 则优先应用指定策略，否则默认均衡精炼）
    applyStrategy(initialStrategy || 'balanced', true);

    // 5. 重置状态栏与按钮
    if (dom.summaryCondenseStatusText) {
        dom.summaryCondenseStatusText.textContent = '准备就绪，点击开始浓缩提炼或跨模式重构';
        dom.summaryCondenseStatusText.style.color = 'var(--text-secondary)';
    }
    if (dom.summaryCondenseStartBtn) {
        dom.summaryCondenseStartBtn.innerHTML = `${CONDENSE_ICONS.sparkles}<span>开始二次浓缩</span>`;
        dom.summaryCondenseStartBtn.classList.remove('summarizing');
    }
    if (dom.summaryCondenseApplyBtn) {
        dom.summaryCondenseApplyBtn.disabled = true;
    }

    isCondensing = false;
    condenseAbortController = null;

    dom.summaryCondenseModal.style.display = 'flex';
    dom.summaryCondenseModal.classList.add('visible');
}

/**
 * 关闭二次浓缩弹窗
 */
export function closeSummaryCondenseModal() {
    if (!dom.summaryCondenseModal) return;

    if (isCondensing && condenseAbortController) {
        if (!confirm('正在进行二次浓缩提炼，确定要停止并关闭窗口吗？')) {
            return;
        }
        condenseAbortController.abort();
    }

    dom.summaryCondenseModal.classList.remove('visible');
    setTimeout(() => {
        dom.summaryCondenseModal.style.display = 'none';
        isCondensing = false;
        condenseAbortController = null;
    }, 200);
}

/**
 * 执行二次浓缩生成请求
 */
async function startCondenseProcess() {
    if (!currentConvId || !originalMemoryText) return;

    // 若当前正在生成，点击按钮则执行中断
    if (isCondensing) {
        if (condenseAbortController) condenseAbortController.abort();
        return;
    }

    const promptText = dom.summaryCondensePrompt ? dom.summaryCondensePrompt.value.trim() : '';
    if (!promptText) {
        notify.warning('请输入提炼要求提示词。');
        return;
    }

    isCondensing = true;
    condenseAbortController = new AbortController();

    const targetMode = getTargetModeForStrategy(currentMemoryMode, currentStrategy);
    const isCrossMode = targetMode !== currentMemoryMode;

    if (dom.summaryCondenseStartBtn) {
        dom.summaryCondenseStartBtn.innerHTML = `<span class="loading-spinner"></span>${CONDENSE_ICONS.stop}<span>停止生成</span>`;
        dom.summaryCondenseStartBtn.classList.add('summarizing');
    }
    if (dom.summaryCondenseStatusText) {
        dom.summaryCondenseStatusText.textContent = isCrossMode ? 'AI 正在深度实体对齐与跨模式重构中...' : 'AI 正在深度脱水精炼中...';
        dom.summaryCondenseStatusText.style.color = 'var(--accent-blue, #0969da)';
    }
    if (dom.summaryCondenseApplyBtn) {
        dom.summaryCondenseApplyBtn.disabled = true;
    }
    if (dom.condenseTargetTextarea) {
        dom.condenseTargetTextarea.value = '';
    }

    const withRole = dom.summaryCondenseWithRole ? dom.summaryCondenseWithRole.checked : true;
    const withWorldBook = dom.summaryCondenseWithWorldBook ? dom.summaryCondenseWithWorldBook.checked : false;

    try {
        const result = await condenseMemoryApiCall({
            convId: currentConvId,
            memoryText: originalMemoryText,
            prompt: promptText,
            withRole,
            withWorldBook,
            signal: condenseAbortController.signal,
            onChunk: (delta, fullText) => {
                if (dom.condenseTargetTextarea) {
                    dom.condenseTargetTextarea.value = fullText;
                    dom.condenseTargetTextarea.scrollTop = dom.condenseTargetTextarea.scrollHeight;
                    updateTargetStats();
                }
            }
        });

        const { mainContent } = extractThinkingFromContent(result);
        const cleanResult = (mainContent && mainContent.trim()) ? mainContent.trim() : (result || '').trim();

        if (cleanResult) {
            if (dom.condenseTargetTextarea) {
                dom.condenseTargetTextarea.value = cleanResult;
                updateTargetStats();
            }
            if (dom.summaryCondenseStatusText) {
                dom.summaryCondenseStatusText.textContent = isCrossMode
                    ? '跨模式重构生成完毕！请确认无误后点击右下角应用'
                    : '提炼完成！您可以直接在右侧微调，确认无误后点击右下角应用';
                dom.summaryCondenseStatusText.style.color = '#2da44e';
            }
            notify.success(isCrossMode ? '跨模式重构生成完毕！' : '记忆二次浓缩生成完毕！');
        } else {
            throw new Error('模型未返回有效精炼内容。');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            notify.info(isCrossMode ? '已停止本次跨模式重构' : '已停止本次二次浓缩');
            if (dom.summaryCondenseStatusText) {
                dom.summaryCondenseStatusText.textContent = '已由用户手动停止';
                dom.summaryCondenseStatusText.style.color = 'var(--text-secondary)';
            }
        } else {
            console.error('[SummaryCondense] 浓缩失败:', err);
            notify.error(`提炼失败: ${err.message || '网络或接口请求异常'}`);
            if (dom.summaryCondenseStatusText) {
                dom.summaryCondenseStatusText.textContent = `失败: ${err.message}`;
                dom.summaryCondenseStatusText.style.color = 'var(--danger-color, #e53935)';
            }
        }
    } finally {
        isCondensing = false;
        condenseAbortController = null;
        if (dom.summaryCondenseStartBtn) {
            const hasTarget = !!(dom.condenseTargetTextarea && dom.condenseTargetTextarea.value.trim());
            const icon = hasTarget ? CONDENSE_ICONS.refresh : CONDENSE_ICONS.sparkles;
            const text = hasTarget
                ? (isCrossMode ? '重新重构' : '重新浓缩')
                : (isCrossMode ? '开始跨模式重构' : '开始二次浓缩');
            dom.summaryCondenseStartBtn.innerHTML = `${icon}<span>${text}</span>`;
            dom.summaryCondenseStartBtn.classList.remove('summarizing');
        }
        updateTargetStats();
        // 统一收口同步应用按钮可用态：
        // 成功、中断留有部分内容、彻底失败三种结局都在此按"右栏是否有内容"一锤定音
        syncApplyBtnState();
    }
}

/**
 * 确认将精炼记忆替换并自动备份原快照
 */
async function applyCondensedResult() {
    if (!currentConvId) return;
    const newText = dom.condenseTargetTextarea ? dom.condenseTargetTextarea.value.trim() : '';
    if (!newText) {
        notify.warning('生成的新记忆内容为空，无法应用。');
        return;
    }

    const conv = state.conversations[currentConvId];
    if (!conv) return;

    let config = normalizeHideSummaryConfig(getHideSummaryForConversation(currentConvId));
    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const currentHiddenFloors = activeBranch
        ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
        : [];

    const targetMode = getTargetModeForStrategy(currentMemoryMode, currentStrategy);
    const isCrossMode = targetMode !== currentMemoryMode;

    let nextSummaryList = null;
    let nextTableData = null;

    // 前置严格格式校验：防止损坏格式静默破坏已有历史记忆
    if (targetMode === 'table') {
        const parsed = parseMarkdownTables(newText);
        if (parsed && (parsed.eventHistory.length > 0 || parsed.characterInfo.length > 0)) {
            nextTableData = parsed;
        } else {
            notify.error('❌ 结构双表格式提取失败：未能识别出标准的 Markdown 剧情双表！');
            if (window.showSummaryFormatErrorModal) {
                window.showSummaryFormatErrorModal(currentConvId, {
                    source: 'condense',
                    floorRange: '精炼重构',
                    title: '⚠️ 结构双表格式提取失败，未能解析出 Markdown 表格',
                    desc: '系统已启动数据安全保护，<strong>现有记忆未被修改</strong>。AI 未能输出标准的剧情双表格式。请选择手动修改右侧格式，或让 AI 重新生成：',
                    rawContent: newText,
                    onManualEdit: () => {
                        if (dom.condenseTargetTextarea) {
                            dom.condenseTargetTextarea.focus();
                        }
                    },
                    onRetry: () => {
                        startCondenseProcess();
                    }
                });
            }
            return;
        }
    } else if (targetMode === 'append') {
        const parsedCards = parseCardsFromCondensedText(newText, { strict: true });
        if (!parsedCards || parsedCards.length === 0) {
            notify.error('❌ 列表拼接格式提取失败：未能解析出标准的阶段记忆卡片！');
            if (window.showSummaryFormatErrorModal) {
                window.showSummaryFormatErrorModal(currentConvId, {
                    source: 'condense',
                    floorRange: '精炼重构',
                    title: '⚠️ 列表拼接格式提取失败，未能解析出阶段卡片',
                    desc: '系统已启动数据安全保护，<strong>现有记忆未被修改</strong>。AI 未能输出标准的阶段卡片格式（需形如 <code>[阶段 X (阶段名)]: 内容</code> 或 <code>**[阶段 X]**</code>）。请选择手动修改右侧格式，或让 AI 重新生成：',
                    rawContent: newText,
                    onManualEdit: () => {
                        if (dom.condenseTargetTextarea) {
                            dom.condenseTargetTextarea.focus();
                        }
                    },
                    onRetry: () => {
                        startCondenseProcess();
                    }
                });
            }
            return;
        }
        nextSummaryList = parsedCards;
    }

    // — 为什么这么写 —
    // 心血安全保护铁律：在替换前，自动为修改前的原始记忆沉淀快照，
    // 若跨模式则标记为 '跨模式转换前备份: [源模式] -> [目标模式]'，否则标记为 '二次浓缩前备份'
    // 无论模型重构得好与不好，大爷随时可以在【历史版本管理】面板中一键回滚还原！
    const snapshotLabel = isCrossMode
        ? `跨模式转换前备份: ${getModeLabel(currentMemoryMode)} -> ${getModeLabel(targetMode)}`
        : '二次浓缩前备份';
    recordSummaryVersion(currentConvId, originalMemoryText, currentHiddenFloors, snapshotLabel);

    // — 为什么这么写 —
    // 1. recordSummaryVersion 内部已把"转换前备份"快照合并写入存储，此处必须重新拉取 config：
    //    若继续用上方旧引用保存，其携带的旧 history 数组会反向覆盖，刚沉淀的备份快照被静默丢弃；
    // 2. 应用后的新记忆并未沉淀快照，基线指针 appliedVersionId 置空，
    //    历史版本面板与工作台如实显示"未存档内容"，杜绝误指到浓缩前备份。
    config = normalizeHideSummaryConfig(getHideSummaryForConversation(currentConvId));
    config.appliedVersionId = null;
    config.appliedAt = 0;

    // 将内容解析并灌入目标模式数据结构
    if (targetMode === 'recursive') {
        config.summary = newText;
        if (dom.hideSummaryResult) dom.hideSummaryResult.value = newText;
    } else if (targetMode === 'table') {
        config.tableData = nextTableData;
    } else if (targetMode === 'append') {
        config.summaryList = nextSummaryList;
    }

    // 无缝切换目标模式
    config.memoryMode = targetMode;

    setHideSummaryForConversation(currentConvId, config);
    await saveConversation(currentConvId, conv);
    await saveToLocalStorage();

    if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    if (window.updateHideSummaryHistoryCount) window.updateHideSummaryHistoryCount();
    if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
    if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();

    if (isCrossMode) {
        notify.success(`跨模式重构成功！已无缝转换为【${getModeLabel(targetMode)}】并自动沉淀快照备份。`);
    } else {
        const ratio = Math.round((1 - newText.length / originalCharCount) * 100);
        notify.success(`已成功应用精炼记忆！字数精简约 ${ratio > 0 ? ratio : 0}%，原记忆已自动备份。`);
    }

    closeSummaryCondenseModal();
}

/**
 * 初始化二次浓缩弹窗事件绑定
 */
export function initSummaryCondenseModal() {
    // 1. 顶栏二次浓缩按钮
    if (dom.hideSummaryCondenseBtn) {
        dom.hideSummaryCondenseBtn.addEventListener('click', () => {
            openSummaryCondenseModal();
        });
    }

    // 2. 取消按钮与遮罩阴影防误触防御
    if (dom.summaryCondenseCancelBtn) {
        dom.summaryCondenseCancelBtn.addEventListener('click', closeSummaryCondenseModal);
    }
    // — 为什么这么写 —
    // 乌鸦/小鸡：
    // 1. 右上角关闭按钮 .modal-close-btn 已由 modal-events.js 的 setupModalCloseButtons 集中拦截并统一路由至 closeSummaryCondenseModal，避免重复绑定产生多次确认；
    // 2. 精炼与跨模式重构中心弹窗禁止点击遮罩阴影背景关闭，防止正在编辑提示词或等待模型流式输出时误触阴影导致弹窗关闭和状态丢失；
    //    对遮罩本身显式阻断点击冒泡，仅允许通过右上角关闭按钮、底部取消按钮或 Esc 快捷键关闭。
    if (dom.summaryCondenseModal) {
        dom.summaryCondenseModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryCondenseModal) {
                e.stopPropagation();
            }
        });
    }

    // 3. 策略胶囊点击事件（支持即点即填且保持可编辑，增加防误触机制）
    const pills = document.querySelectorAll('.condense-strategy-pill');
    pills.forEach(pill => {
            if (pill.id === 'condense-reset-prompt-btn') {
                pill.addEventListener('click', () => {
                    const defaultPrompt = getDefaultCondensePrompt(currentMemoryMode, currentStrategy);
                    const currentPrompt = dom.summaryCondensePrompt ? dom.summaryCondensePrompt.value.trim() : '';
                    if (currentPrompt === defaultPrompt.trim()) {
                        notify.info('当前已是该策略官方默认提示词，无需还原');
                        return;
                    }
                    if (!confirm('确定要还原为当前策略的官方默认提示词吗？\n当前已编辑的提炼要求将被覆盖。')) {
                        return;
                    }
                    applyStrategy(currentStrategy, true);
                    notify.success('已还原当前策略的官方默认提示词');
                });
            } else {
                pill.addEventListener('click', () => {
                    const targetStrategy = pill.dataset.strategy;
                    if (!targetStrategy || targetStrategy === currentStrategy) return;

                    const defaultPromptOld = getDefaultCondensePrompt(currentMemoryMode, currentStrategy);
                    const currentPrompt = dom.summaryCondensePrompt ? dom.summaryCondensePrompt.value.trim() : '';

                    // 若用户已自定义修改了提示词，切换策略前进行确认防误触
                    if (currentPrompt && currentPrompt !== defaultPromptOld.trim()) {
                        if (!confirm('检测到您已自定义修改了提示词，切换策略将应用新的默认提示词，是否确认切换？')) {
                            return;
                        }
                    }

                    applyStrategy(targetStrategy, true);
                });
            }
        });

    // 4. 键盘 Esc 快捷键关闭监听
    document.addEventListener('keydown', (e) => {
        if (!dom.summaryCondenseModal || !dom.summaryCondenseModal.classList.contains('visible')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSummaryCondenseModal();
        }
    });

    // 4. 提示词输入框打字监听
    if (dom.summaryCondensePrompt) {
        dom.summaryCondensePrompt.addEventListener('input', updatePromptCharCounter);
    }

    // 5. 右栏新记忆打字微调监听（联动更新字数、瘦身率与应用按钮置灰态）
    if (dom.condenseTargetTextarea) {
        dom.condenseTargetTextarea.addEventListener('input', () => {
            updateTargetStats();
            // 手动编辑后实时同步：右栏被删空时按钮立即回灰（流式程序赋值不触发 input，天然不冲突）
            syncApplyBtnState();
        });
    }

    // 6. 开始/停止浓缩按钮
    if (dom.summaryCondenseStartBtn) {
        dom.summaryCondenseStartBtn.addEventListener('click', startCondenseProcess);
    }

    // 7. 确认应用按钮
    if (dom.summaryCondenseApplyBtn) {
        dom.summaryCondenseApplyBtn.addEventListener('click', applyCondensedResult);
    }
}
