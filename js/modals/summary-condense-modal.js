/**
 * @file summary-condense-modal.js
 * @description 记忆二次浓缩与精炼对比弹窗模块
 * — 为什么这么写 —
 * 1. 随着长线对话发展（如300~500楼跑团），长期记忆变得庞大冗长，占用大量上下文窗口；
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
    recordSummaryVersion,
    condenseMemoryApiCall,
    getDefaultCondensePrompt
} from '../summary-manager.js?v=temp';

let currentConvId = null;
let currentMemoryMode = 'recursive';
let originalMemoryText = '';
let originalCharCount = 0;
let originalTokenCount = 0;
let currentStrategy = 'balanced'; // 'balanced' | 'extreme'
let isCondensing = false;
let condenseAbortController = null;

/**
 * 获取当前记忆模式的人类友好中文名称
 * @param {string} mode - 'recursive' | 'table' | 'append'
 * @returns {string} 模式标签
 */
function getModeLabel(mode) {
    if (mode === 'table') return '⚔️ 跑团双表';
    if (mode === 'append') return '📑 列表拼接';
    return '🔄 递归滚动';
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
 * 刷新提示词输入框的字数统计
 */
function updatePromptCharCounter() {
    if (dom.summaryCondensePrompt && dom.summaryCondensePromptChars) {
        dom.summaryCondensePromptChars.textContent = `${dom.summaryCondensePrompt.value.length} 字`;
    }
}

/**
 * 切换浓缩策略（均衡精炼 / 极限脱水）并灌入对应默认提示词
 * @param {string} strategy - 'balanced' | 'extreme'
 * @param {boolean} [forceReset=false] - 是否强制覆盖当前提示词
 */
function applyStrategy(strategy, forceReset = false) {
    currentStrategy = strategy;

    if (dom.condenseStrategyPills) {
        dom.condenseStrategyPills.forEach(pill => {
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
}

/**
 * 打开记忆二次浓缩与精炼弹窗
 */
export function openSummaryCondenseModal() {
    if (!dom.summaryCondenseModal) return;

    const convId = state.currentConversationId;
    if (!convId) {
        notify.warning('未找到活动会话，请先选择一个对话。');
        return;
    }

    currentConvId = convId;
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    currentMemoryMode = config.memoryMode || 'recursive';

    // — 为什么这么写 —
    // 动态提取当前模式要被精炼脱水的原始记忆文本：
    // 1. 递归模式：直接读取 summary 文本；
    // 2. 列表拼接模式：将卡片流序列化为拼接列表文本；
    // 3. 跑团双表模式：将双表数据序列化为标准 Markdown 表格文本。
    if (currentMemoryMode === 'recursive') {
        originalMemoryText = (config.summary || '').trim();
    } else if (currentMemoryMode === 'append') {
        originalMemoryText = formatSummaryListToText(config.summaryList).trim();
    } else if (currentMemoryMode === 'table') {
        originalMemoryText = formatTablesToMarkdown(config.tableData?.eventHistory, config.tableData?.characterInfo).trim();
    }

    if (!originalMemoryText) {
        notify.info('当前模式下的记忆内容为空，无需进行二次浓缩。');
        return;
    }

    originalCharCount = originalMemoryText.length;
    originalTokenCount = countTokens(originalMemoryText);

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

    // 4. 初始化策略与提示词（默认均衡精炼）
    applyStrategy('balanced', true);

    // 5. 重置状态栏与按钮
    if (dom.summaryCondenseStatusText) {
        dom.summaryCondenseStatusText.textContent = '准备就绪，点击开始浓缩提炼';
        dom.summaryCondenseStatusText.style.color = 'var(--text-secondary)';
    }
    if (dom.summaryCondenseStartBtn) {
        dom.summaryCondenseStartBtn.innerHTML = '<span>✨ 开始二次浓缩</span>';
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

    if (dom.summaryCondenseStartBtn) {
        dom.summaryCondenseStartBtn.innerHTML = '<span class="loading-spinner"></span><span>⏹️ 停止生成</span>';
        dom.summaryCondenseStartBtn.classList.add('summarizing');
    }
    if (dom.summaryCondenseStatusText) {
        dom.summaryCondenseStatusText.textContent = '⚡ AI 正在深度脱水精炼中...';
        dom.summaryCondenseStatusText.style.color = 'var(--accent-blue, #0969da)';
    }
    if (dom.summaryCondenseApplyBtn) {
        dom.summaryCondenseApplyBtn.disabled = true;
    }
    if (dom.condenseTargetTextarea) {
        dom.condenseTargetTextarea.value = '';
    }

    try {
        const result = await condenseMemoryApiCall({
            convId: currentConvId,
            memoryText: originalMemoryText,
            prompt: promptText,
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
                dom.summaryCondenseStatusText.textContent = '✨ 提炼完成！您可以直接在右侧微调，确认无误后点击右下角应用';
                dom.summaryCondenseStatusText.style.color = '#2da44e';
            }
            if (dom.summaryCondenseApplyBtn) {
                dom.summaryCondenseApplyBtn.disabled = false;
            }
            notify.success('✨ 记忆二次浓缩生成完毕！');
        } else {
            throw new Error('模型未返回有效精炼内容。');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            notify.info('已停止本次二次浓缩');
            if (dom.summaryCondenseStatusText) {
                dom.summaryCondenseStatusText.textContent = '已由用户手动停止';
                dom.summaryCondenseStatusText.style.color = 'var(--text-secondary)';
            }
        } else {
            console.error('[SummaryCondense] 浓缩失败:', err);
            notify.error(`提炼失败: ${err.message || '网络或接口请求异常'}`);
            if (dom.summaryCondenseStatusText) {
                dom.summaryCondenseStatusText.textContent = `❌ 失败: ${err.message}`;
                dom.summaryCondenseStatusText.style.color = 'var(--danger-color, #e53935)';
            }
        }
    } finally {
        isCondensing = false;
        condenseAbortController = null;
        if (dom.summaryCondenseStartBtn) {
            dom.summaryCondenseStartBtn.innerHTML = '<span>✨ 重新浓缩</span>';
            dom.summaryCondenseStartBtn.classList.remove('summarizing');
        }
        updateTargetStats();
    }
}

/**
 * 确认将精炼记忆替换并自动备份原快照
 */
async function applyCondensedResult() {
    if (!currentConvId) return;
    const newText = dom.condenseTargetTextarea ? dom.condenseTargetTextarea.value.trim() : '';
    if (!newText) {
        notify.warning('精炼后的新记忆内容为空，无法应用。');
        return;
    }

    const conv = state.conversations[currentConvId];
    if (!conv) return;

    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(currentConvId));
    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const currentHiddenFloors = activeBranch
        ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
        : [];

    // — 为什么这么写 —
    // 心血安全保护铁律：在替换前，自动为浓缩前的原始记忆沉淀快照，标记 source 为 '二次浓缩前备份'
    // 无论模型浓缩得好与不好，大爷随时可以在【历史版本管理】面板中一键回滚还原！
    recordSummaryVersion(currentConvId, originalMemoryText, currentHiddenFloors, '二次浓缩前备份');

    // 将浓缩后的内容反解析回对应的模式结构中
    if (currentMemoryMode === 'recursive') {
        config.summary = newText;
        if (dom.hideSummaryResult) dom.hideSummaryResult.value = newText;
    } else if (currentMemoryMode === 'table') {
        const parsed = parseMarkdownTables(newText);
        if (parsed.eventHistory.length > 0 || parsed.characterInfo.length > 0) {
            config.tableData = parsed;
        } else {
            config.summary = newText;
        }
    } else if (currentMemoryMode === 'append') {
        // 列表模式：将浓缩后的文本重构为精炼大纲卡片
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        config.summaryList = [
            {
                id: `chunk_${Date.now()}_condensed`,
                time: timeStr,
                floorRange: '全局精炼大纲',
                content: newText
            }
        ];
    }

    setHideSummaryForConversation(currentConvId, config);
    await saveConversation(currentConvId, conv);
    await saveToLocalStorage();

    if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    if (window.updateHideSummaryHistoryCount) window.updateHideSummaryHistoryCount();
    if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();

    const ratio = Math.round((1 - newText.length / originalCharCount) * 100);
    notify.success(`✨ 已成功应用精炼记忆！字数精简约 ${ratio > 0 ? ratio : 0}%，原记忆已自动备份。`);

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

    // 2. 关闭与取消按钮
    if (dom.summaryCondenseCloseBtn) {
        dom.summaryCondenseCloseBtn.addEventListener('click', closeSummaryCondenseModal);
    }
    if (dom.summaryCondenseCancelBtn) {
        dom.summaryCondenseCancelBtn.addEventListener('click', closeSummaryCondenseModal);
    }
    if (dom.summaryCondenseModal) {
        dom.summaryCondenseModal.addEventListener('click', (e) => {
            if (e.target === dom.summaryCondenseModal) {
                closeSummaryCondenseModal();
            }
        });
    }

    // 3. 策略胶囊点击事件（支持即点即填且保持可编辑，增加防误触机制）
    if (dom.condenseStrategyPills) {
        dom.condenseStrategyPills.forEach(pill => {
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
    }

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

    // 5. 右栏新记忆打字微调监听（联动更新字数与瘦身率）
    if (dom.condenseTargetTextarea) {
        dom.condenseTargetTextarea.addEventListener('input', updateTargetStats);
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
