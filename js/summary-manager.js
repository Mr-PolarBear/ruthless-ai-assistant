/**
 * @file summary-manager.js
 * @description 对话记忆与智能总结模块（支持递归滚动、列表拼接、角色扮演双表3种记忆模式，支持自动触发与滚动上下文压缩）
 */

import { state } from './state.js?v=260820-1';
import { dom } from './dom.js?v=260820-1';
import { saveConversation } from './db.js?v=260820-1';
import { saveToLocalStorage, countTokens, isMessageHidden, extractThinkingFromContent } from './utils.js?v=260820-1';
import { buildApiRequest, processAndFilterMessages } from './api-common.js?v=260820-1';
import { renderChatMessages } from './renderer.js?v=260820-1';
import { notify, updateSummaryEditorLockState } from './ui-updater.js?v=260820-1';
import { getHideSummaryForConversation, setHideSummaryForConversation } from './main.js?v=260820-1';

// — 为什么这么写 —
// 3 种记忆模式官方默认提示词常量：
// 1. 递归滚动模式：全量融合，要求继承旧记忆与融入新进展
// 2. 列表拼接模式：增量追加，仅提炼新楼层，不要复述旧片段
// 3. 双表格跑团模式：结构化更新历史记录表与角色信息表
export const DEFAULT_PROMPT_RECURSIVE = `请结合【已有长期记忆总结】与最新的【新增待总结对话】，提炼并生成一份整合后的全新长期记忆。
1. 继承并保留旧记忆中仍然有效的核心背景、重要设定、关键决策与未决问题；
2. 融合新对话中的最新进展与共识；
3. 剔除已过时的临时对话细节，语言保持精炼完整，整体条理清晰，作为后续对话的长期记忆参考。`;

export const DEFAULT_PROMPT_APPEND = `请参考【已知历史记忆摘要集】，仅针对【本次新增对话内容】进行精炼提炼，输出一条简明扼要的阶段性新增记忆摘要（不要重复上方已有的旧记忆内容）。`;

export const DEFAULT_PROMPT_TABLE = `请根据【最新剧情对话】，结合现有的【历史记录表】和【最新角色信息表】进行结构化更新，并严格按照以下两个 Markdown 表格格式输出完整内容（保持表头字段完全一致）：

### 历史记录表
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |
| ... | ... | ... | ... | ... |

### 最新角色信息表
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |
| ... | ... | ... | ... |`;

// 向下兼容别名
export const DEFAULT_SUMMARY_PROMPT = DEFAULT_PROMPT_RECURSIVE;

/**
 * 根据模式获取默认提示词
 * @param {string} mode - 'recursive' | 'append' | 'table'
 * @returns {string} 提示词内容
 */
export function getDefaultPromptForMode(mode) {
    if (mode === 'append') return DEFAULT_PROMPT_APPEND;
    if (mode === 'table') return DEFAULT_PROMPT_TABLE;
    return DEFAULT_PROMPT_RECURSIVE;
}

/**
 * 标准化并补齐会话隐藏与记忆总结配置结构（向下兼容旧版单文本数据）
 * @param {object} config - 原始配置对象
 * @returns {object} 标准化后的配置对象
 */
export function normalizeHideSummaryConfig(config = {}) {
    const memoryMode = (config && config.memoryMode) ? config.memoryMode : 'recursive';
    const oldPrompt = (config && typeof config.prompt === 'string') ? config.prompt : '';

    const prompts = {
        recursive: (config.prompts && config.prompts.recursive) || (oldPrompt && memoryMode === 'recursive' ? oldPrompt : DEFAULT_PROMPT_RECURSIVE),
        append: (config.prompts && config.prompts.append) || (oldPrompt && memoryMode === 'append' ? oldPrompt : DEFAULT_PROMPT_APPEND),
        table: (config.prompts && config.prompts.table) || (oldPrompt && memoryMode === 'table' ? oldPrompt : DEFAULT_PROMPT_TABLE),
        ...((config && config.prompts) || {})
    };

    return {
        enabled: !!config.enabled,
        memoryMode,
        autoSummaryEnabled: !!config.autoSummaryEnabled,
        autoSummaryType: config.autoSummaryType || 'floors',
        autoSummaryFloorInterval: Number(config.autoSummaryFloorInterval) || 10,
        autoSummaryTokenThreshold: Number(config.autoSummaryTokenThreshold) || 4000,
        dropSummarizedFloors: config.dropSummarizedFloors !== false,
        keepRecentFloors: config.keepRecentFloors !== false,
        keepRecentFloorsCount: Number(config.keepRecentFloorsCount) || 2,
        withRole: !!config.withRole,
        withWorldBook: !!config.withWorldBook,
        messageLimit: Number(config.messageLimit) || 0,
        prompts,
        prompt: prompts[memoryMode] || getDefaultPromptForMode(memoryMode),
        summary: typeof config.summary === 'string' ? config.summary : '',
        summaryList: Array.isArray(config.summaryList) ? config.summaryList : [],
        tableData: {
            eventHistory: (config.tableData && Array.isArray(config.tableData.eventHistory)) ? config.tableData.eventHistory : [],
            characterInfo: (config.tableData && Array.isArray(config.tableData.characterInfo)) ? config.tableData.characterInfo : []
        },
        hiddenFloors: Array.isArray(config.hiddenFloors) ? config.hiddenFloors : [],
        start: Number(config.start) || 1,
        end: Number(config.end) || 1,
        history: Array.isArray(config.history) ? config.history : []
    };
}

/**
 * 将模式2的 summaryList 格式化为纯文本字符串
 * @param {Array<{id, time, floorRange, content}>} summaryList 
 * @returns {string} 格式化文本
 */
export function formatSummaryListToText(summaryList) {
    if (!Array.isArray(summaryList) || summaryList.length === 0) return '';
    return summaryList.map((item, idx) => {
        const title = item.floorRange ? `[阶段 ${idx + 1} (${item.floorRange})]` : `[阶段 ${idx + 1}]`;
        return `${title}: ${item.content || ''}`;
    }).join('\n\n');
}

/**
 * 将模式3的结构化双表对象序列化为标准 Markdown 表格文本
 * @param {Array} eventHistory - 历史记录列表
 * @param {Array} characterInfo - 角色信息列表
 * @returns {string} Markdown 文本
 */
export function formatTablesToMarkdown(eventHistory = [], characterInfo = []) {
    let md = '### 历史记录表\n| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |\n| :--- | :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(eventHistory) && eventHistory.length > 0) {
        eventHistory.forEach(row => {
            const time = (row.time || '-').replace(/\|/g, '&#124;');
            const location = (row.location || '-').replace(/\|/g, '&#124;');
            const characters = (row.characters || '-').replace(/\|/g, '&#124;');
            const event = (row.event || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${time} | ${location} | ${characters} | ${event} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    md += '\n### 最新角色信息表\n| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |\n| :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(characterInfo) && characterInfo.length > 0) {
        characterInfo.forEach(row => {
            const name = (row.name || '-').replace(/\|/g, '&#124;');
            const bio = (row.bio || '-').replace(/\|/g, '&#124;');
            const status = (row.status || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${name} | ${bio} | ${status} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    return md.trim();
}

/**
 * 健壮解析 AI 输出的 Markdown 表格文本为结构化双表对象
 * @param {string} text - 包含 Markdown 表格的响应文本
 * @returns {{ eventHistory: Array, characterInfo: Array }} 结构化表格数据
 */
export function parseMarkdownTables(text) {
    const result = {
        eventHistory: [],
        characterInfo: []
    };
    if (!text || typeof text !== 'string') return result;

    const { mainContent } = extractThinkingFromContent(text);
    const cleanText = mainContent || text;
    const lines = cleanText.split('\n');
    let currentSection = null; // 'history' | 'character'

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.includes('历史记录') || line.includes('事件记录')) {
            currentSection = 'history';
            continue;
        } else if (line.includes('角色信息') || line.includes('人物信息') || line.includes('NPC信息')) {
            currentSection = 'character';
            continue;
        }

        // 识别表格行 (以 | 开头并以 | 结尾)
        if (line.startsWith('|') && line.endsWith('|')) {
            // 过滤 |---|---| 表格分隔线
            if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(line)) continue;

            const cells = line.slice(1, -1).split('|').map(c => c.trim().replace(/&#124;/g, '|'));
            
            // 根据表头智能自动识别或修正当前 Section
            if (cells.includes('时间') || cells.includes('地点') || cells.includes('事件')) {
                currentSection = 'history';
                continue;
            }
            if (cells.includes('姓名') || (cells.includes('简介') && cells.some(c => c.includes('状态')))) {
                currentSection = 'character';
                continue;
            }

            // 过滤全空或占位符行
            if (cells.every(c => !c || c === '-' || c === '(暂无)')) continue;

            if (currentSection === 'history' && cells.length >= 3) {
                result.eventHistory.push({
                    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    time: cells[0] || '',
                    location: cells[1] || '',
                    characters: cells[2] || '',
                    event: cells[3] || '',
                    items: cells[4] || ''
                });
            } else if (currentSection === 'character' && cells.length >= 2) {
                result.characterInfo.push({
                    id: 'chr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    name: cells[0] || '',
                    bio: cells[1] || '',
                    status: cells[2] || '',
                    items: cells[3] || ''
                });
            }
        }
    }

    return result;
}

/**
 * 格式化会话记忆内容，用于注入 API 请求的 System 消息或计算 Token
 * @param {object} config - hideSummary 配置对象
 * @returns {string} 格式化后的完整注入文本（若未开启或内容为空则返回空字符串）
 */
export function formatMemoryForApi(config) {
    if (!config || !config.enabled) return '';
    const norm = normalizeHideSummaryConfig(config);
    const mode = norm.memoryMode;

    if (mode === 'recursive') {
        const summary = norm.summary.trim();
        if (!summary) return '';
        return '本条消息属于对历史对话内容的长期记忆总结，你必须阅读后作为上下文参考再进行回答：\n' + summary;
    } else if (mode === 'append') {
        const stitched = formatSummaryListToText(norm.summaryList);
        if (!stitched) return '';
        return '本条消息属于对历史对话内容的长期记忆摘要集（按阶段排序）：\n' + stitched;
    } else if (mode === 'table') {
        const hasHistory = norm.tableData.eventHistory && norm.tableData.eventHistory.length > 0;
        const hasCharacters = norm.tableData.characterInfo && norm.tableData.characterInfo.length > 0;
        if (!hasHistory && !hasCharacters) {
            if (norm.summary && norm.summary.trim()) {
                return '本条消息属于对历史对话内容的长期记忆总结：\n' + norm.summary.trim();
            }
            return '';
        }
        const tablesMd = formatTablesToMarkdown(norm.tableData.eventHistory, norm.tableData.characterInfo);
        return '本条消息属于对历史剧情与角色状态的长期记忆结构化表格，你必须严格遵循表中的世界线与状态设定：\n\n' + tablesMd;
    }

    return '';
}

/**
 * 智能解析已隐藏楼层与未隐藏空洞区间信息 (Plan B 智能双模算法)
 * @param {number[]} hiddenFloors - 已隐藏楼层数字数组 (1-indexed)
 * @returns {{ mainText: string, hasUnhiddenRow: boolean, unhiddenCount: number, unhiddenRanges: Array<[number, number]> }}
 */
export function formatHiddenFloorsBannerInfo(hiddenFloors) {
    if (!Array.isArray(hiddenFloors) || hiddenFloors.length === 0) {
        return {
            mainText: '无隐藏楼层 (全部可见)',
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    // 1. 升序排序与去重
    const sorted = Array.from(new Set(hiddenFloors.map(n => Number(n)).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return {
            mainText: '无隐藏楼层 (全部可见)',
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    const minFloor = sorted[0];
    const maxFloor = sorted[sorted.length - 1];
    const totalSpan = maxFloor - minFloor + 1;
    const hiddenCount = sorted.length;
    const unhiddenCount = totalSpan - hiddenCount;

    // 2. 将连续数字聚类为区间数组 [[start1, end1], [start2, end2], ...]
    const toRanges = (nums) => {
        if (!nums || nums.length === 0) return [];
        const ranges = [];
        let start = nums[0];
        let prev = nums[0];
        for (let i = 1; i < nums.length; i++) {
            if (nums[i] === prev + 1) {
                prev = nums[i];
            } else {
                ranges.push([start, prev]);
                start = nums[i];
                prev = nums[i];
            }
        }
        ranges.push([start, prev]);
        return ranges;
    };

    // 3. 将区间数组格式化为可读文本 "第 1 ~ 10 楼、第 15 楼"
    const formatRangesText = (ranges) => {
        return ranges.map(([s, e]) => (s === e ? `第 ${s} 楼` : `第 ${s} ~ ${e} 楼`)).join('、');
    };

    const hiddenRanges = toRanges(sorted);

    // Case 1: 完美全覆盖 (中间 0 空洞)
    if (unhiddenCount === 0) {
        const text = (minFloor === maxFloor)
            ? `第 ${minFloor} 楼 (共 1 层)`
            : `第 ${minFloor} ~ ${maxFloor} 楼 (共 ${hiddenCount} 层)`;
        return {
            mainText: text,
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    // 计算区间内的未隐藏楼层
    const hiddenSet = new Set(sorted);
    const unhiddenNums = [];
    for (let f = minFloor; f <= maxFloor; f++) {
        if (!hiddenSet.has(f)) {
            unhiddenNums.push(f);
        }
    }
    const unhiddenRanges = toRanges(unhiddenNums);

    // Case 2: 大面积隐藏，存在少量空洞（大爷关心的核心场景：空洞 <= 15 或 空洞比例 <= 25%）
    // 采用两行制：第一行展示主跨度，第二行展示未隐藏明细
    const unhiddenRatio = unhiddenCount / totalSpan;
    if (unhiddenCount <= 15 || unhiddenRatio <= 0.25) {
        return {
            mainText: `覆盖区间：第 ${minFloor} ~ ${maxFloor} 楼 (已隐藏 ${hiddenCount} 层)`,
            hasUnhiddenRow: true,
            unhiddenCount,
            unhiddenRanges
        };
    }

    // Case 3: 完全离散的多大段隐藏（如仅隐藏 1~10 楼和 490~500 楼，中间空了 480 楼）
    // 直接展示紧凑的多段区间，无误导
    return {
        mainText: `${formatRangesText(hiddenRanges)} (共 ${hiddenCount} 层)`,
        hasUnhiddenRow: false,
        unhiddenCount: 0,
        unhiddenRanges: []
    };
}


/**
 * 获取当前活跃分支上所有尚未被隐藏的可见消息
 * @param {Array} activeBranch - 当前分支消息列表
 * @param {Object} hideConfig - 隐藏配置
 * @returns {Array<{msg: Object, floor: number, index: number}>} 可见消息及其楼层号
 */
export function getVisibleMessagesForSummary(activeBranch, hideConfig) {
    if (!Array.isArray(activeBranch)) return [];
    return activeBranch
        .map((msg, index) => ({ msg, floor: index + 1, index }))
        .filter(({ msg, floor }) => !isMessageHidden(msg, floor, hideConfig));
}

/**
 * 调用 LLM 执行总结请求（自适应 3 种记忆模式）
 * @param {Object} options
 * @param {string} options.convId - 会话ID
 * @param {Array} options.messagesToSummarize - 待总结的消息列表
 * @param {string} [options.customPrompt] - 总结提示词（若未提供则读取该模式配置）
 * @param {boolean} [options.withRole] - 是否携带角色人设
 * @param {boolean} [options.withWorldBook] - 是否携带世界书/备忘录
 * @param {AbortSignal} [options.signal] - 中断信号
 * @param {Function} [options.onChunk] - 流式返回回调
 * @returns {Promise<string>} 总结结果文本
 */
export async function generateSummaryApiCall(options) {
    const {
        convId,
        messagesToSummarize,
        customPrompt,
        withRole = false,
        withWorldBook = false,
        signal,
        onChunk
    } = options;

    const conv = state.conversations[convId];
    if (!conv) throw new Error('未找到当前会话数据。');

    const apiEndpoint = state.apiEndpoints[conv.apiEndpointId];
    if (!apiEndpoint) throw new Error('当前会话未配置有效的 API 端点。');

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const mode = config.memoryMode || 'recursive';

    // 1. 构造对话历史消息
    const conversationMessages = messagesToSummarize.map(({ msg, floor }) => ({
        role: msg.role,
        content: msg.content,
        _idx: floor
    }));

    const filteredMessages = processAndFilterMessages(conversationMessages, {
        convId,
        activeBranch,
        applyMcpRules: false,
        applyHideSummary: false
    });

    const summaryMessages = [];

    // — 为什么这么写 —
    // 关键升级：把当前已有的记忆（全量总结/已有List/已有双表格）作为前置已知背景带给 AI，彻底终结单窗口遗忘
    let existingMemoryContext = '';
    if (mode === 'recursive') {
        const oldSummary = config.summary ? config.summary.trim() : '';
        if (oldSummary) {
            existingMemoryContext = `【已有长期记忆总结】\n${oldSummary}\n\n`;
        }
    } else if (mode === 'append') {
        const oldList = formatSummaryListToText(config.summaryList);
        if (oldList) {
            existingMemoryContext = `【已知历史记忆摘要集】\n${oldList}\n\n`;
        }
    } else if (mode === 'table') {
        const oldTables = formatTablesToMarkdown(config.tableData?.eventHistory, config.tableData?.characterInfo);
        if (oldTables) {
            existingMemoryContext = `【已有剧情与角色状态表】\n${oldTables}\n\n`;
        }
    }

    if (existingMemoryContext) {
        summaryMessages.push({
            role: 'system',
            content: existingMemoryContext.trim()
        });
    }

    summaryMessages.push(...filteredMessages);

    // 2. 添加总结指令提示词
    const promptText = (customPrompt && customPrompt.trim())
        || config.prompts?.[mode]
        || getDefaultPromptForMode(mode);

    summaryMessages.push({ role: 'user', content: promptText });

    // 3. 构建 API 请求
    const requestData = buildApiRequest({
        convId,
        messages: summaryMessages,
        includeWorldBook: withWorldBook,
        includePersona: withRole,
        includeMcp: false,
        applyRegex: true
    });

    if (!requestData) throw new Error('构建 API 请求失败。');

    const response = await fetch(requestData.url, {
        method: 'POST',
        headers: requestData.headers,
        body: JSON.stringify(requestData.body),
        signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errorText}`);
    }

    let summaryResult = '';

    // 4. 解析响应（流式与非流式兼容）
    if (requestData.body.stream && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.substring(5).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        summaryResult += delta;
                        if (typeof onChunk === 'function') onChunk(delta, summaryResult);
                    }
                } catch (e) { /* ignore chunk error */ }
            }
        }
    } else {
        const responseData = await response.json();
        summaryResult = responseData.choices?.[0]?.message?.content || '';
        if (typeof onChunk === 'function') onChunk(summaryResult, summaryResult);
    }

    return summaryResult;
}

/**
 * 记录并沉淀历史总结版本快照（自适应 3 种模式）
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结文本或快照源
 * @param {number[]} hiddenFloors - 当时的隐藏楼层数组
 * @param {string} source - 来源 ('自动总结' | '手动保存')
 */
export function recordSummaryVersion(convId, summaryText, hiddenFloors = [], source = '手动保存') {
    if (!convId) return;

    const existingConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const history = Array.isArray(existingConfig.history) ? [...existingConfig.history] : [];

    const sortedFloors = [...new Set(hiddenFloors)].sort((a, b) => a - b);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const conv = state.conversations[convId];
    const activeBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const currentMaxFloor = activeBranch ? activeBranch.length : (sortedFloors.length ? Math.max(...sortedFloors) : 0);

    const newSnapshot = {
        id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        time: timeStr,
        mode,
        summary: existingConfig.summary,
        summaryList: JSON.parse(JSON.stringify(existingConfig.summaryList || [])),
        tableData: JSON.parse(JSON.stringify(existingConfig.tableData || { eventHistory: [], characterInfo: [] })),
        hiddenFloors: sortedFloors,
        maxFloor: currentMaxFloor,
        charCount: formatMemoryForApi(existingConfig).length,
        source
    };

    history.unshift(newSnapshot);

    // 最大保留 30 条历史快照，防止存储膨胀
    if (history.length > 30) {
        history.length = 30;
    }

    existingConfig.history = history;
    setHideSummaryForConversation(convId, existingConfig);

    if (convId === state.currentConversationId && window.updateHideSummaryHistoryCount) {
        window.updateHideSummaryHistoryCount();
    }
}

/**
 * 校验分叉重发楼层与当前记忆的时间线因果关系，寻找最适合该分叉点的历史快照（最后一次保存的最优版）
 * — 为什么这么写 —
 * 1. 若当前记忆生成时的楼层 <= 重发楼层，说明记忆库里根本没有未来的废弃剧情，不需要弹窗打扰；
 * 2. 若当前记忆生成时的楼层 > 重发楼层，说明包含废弃剧情，算法按倒序在快照树中找到 maxFloor <= branchFloor 的最新一条快照推荐给用户一键恢复。
 * @param {string} convId - 会话ID
 * @param {number} branchFloor - 重发分叉目标楼层（1-indexed）
 * @returns {{ needPrompt: boolean, bestSnapshot: object|null, currentMemoryFloor: number, branchFloor: number }}
 */
export function checkBranchMemoryStatus(convId, branchFloor) {
    if (!convId || !branchFloor) return { needPrompt: false, bestSnapshot: null, currentMemoryFloor: 0, branchFloor: 0 };
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    const mode = config.memoryMode || 'recursive';
    const hasMemory = (mode === 'recursive' && !!config.summary.trim())
        || (mode === 'append' && Array.isArray(config.summaryList) && config.summaryList.length > 0)
        || (mode === 'table' && (
            (Array.isArray(config.tableData?.eventHistory) && config.tableData.eventHistory.length > 0) ||
            (Array.isArray(config.tableData?.characterInfo) && config.tableData.characterInfo.length > 0)
        ));

    const history = Array.isArray(config.history) ? config.history : [];

    // 如果未开启总结且无有效记忆内容，且历史快照为空，则无需提示
    if (!hasMemory && history.length === 0) {
        return { needPrompt: false, bestSnapshot: null, currentMemoryFloor: 0, branchFloor };
    }

    // 获取当前最新记忆对应的发生楼层（以最新快照为准，无快照时以当前隐藏楼层最大值为准）
    const latestSnapshot = history[0];
    const currentMemoryFloor = latestSnapshot
        ? (latestSnapshot.maxFloor || (latestSnapshot.hiddenFloors?.length ? Math.max(...latestSnapshot.hiddenFloors) : 0))
        : (config.hiddenFloors?.length ? Math.max(...config.hiddenFloors) : 0);

    // 如果当前记忆生成时的楼层 <= 重发分叉楼层，因果完全一致，无需回滚提示
    if (currentMemoryFloor <= branchFloor) {
        return { needPrompt: false, bestSnapshot: null, currentMemoryFloor, branchFloor };
    }

    // 当前记忆生成时的楼层 > 重发楼层，说明包含分叉点之后的废弃信息！
    // 逆序查找最适合该分叉楼层的历史快照（即保存时发生楼层 <= branchFloor 的最新一条快照，优先保留大爷最近编辑的心血）
    let bestSnapshot = null;
    for (const snap of history) {
        const snapFloor = snap.maxFloor || (snap.hiddenFloors?.length ? Math.max(...snap.hiddenFloors) : 0);
        if (snapFloor <= branchFloor) {
            bestSnapshot = snap;
            break;
        }
    }

    return {
        needPrompt: true,
        bestSnapshot,
        currentMemoryFloor,
        branchFloor
    };
}

/**
 * 保存并应用总结结果（若勾选归档，将对应消息批量标记隐藏）
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结结果文本
 * @param {Array<{msg: Object, floor: number}>} summarizedMessages - 本次被总结的消息列表
 * @param {boolean} dropFloors - 是否自动隐藏被总结的楼层
 * @param {string} [source='自动总结'] - 来源标记
 */
export async function applySummaryResult(convId, summaryText, summarizedMessages, dropFloors, source = '自动总结') {
    if (!convId || !summaryText || !summaryText.trim()) return;

    const { mainContent } = extractThinkingFromContent(summaryText);
    const cleanSummaryText = (mainContent && mainContent.trim()) ? mainContent.trim() : summaryText.trim();

    const conv = state.conversations[convId];
    if (!conv) return;

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const existingConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    // — 为什么这么写 —
    // 1. 若开启了“总结后抛弃被总结楼层”，将本次参与总结的消息批量标记为 msg.hidden = true
    // 2. 若开启了“保留最后 K 楼不隐藏”，截取排除末尾 K 条消息，保留其可见性以供大模型做格式与近期语境参考
    if (dropFloors && Array.isArray(summarizedMessages) && summarizedMessages.length > 0) {
        const keepCount = existingConfig.keepRecentFloors !== false
            ? (Number(existingConfig.keepRecentFloorsCount) || 2)
            : 0;

        const messagesToHide = (keepCount > 0 && summarizedMessages.length > keepCount)
            ? summarizedMessages.slice(0, summarizedMessages.length - keepCount)
            : summarizedMessages;

        messagesToHide.forEach(({ msg }) => {
            if (msg) msg.hidden = true;
        });
    }

    // 重新统计当前分支的所有隐藏楼层集合
    const hiddenFloors = activeBranch
        ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
        : [];

    const mode = existingConfig.memoryMode || 'recursive';
    const newConfig = {
        ...existingConfig,
        enabled: true,
        hiddenFloors,
        start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
        end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1
    };

    if (mode === 'recursive') {
        newConfig.summary = cleanSummaryText;
    } else if (mode === 'append') {
        const floorRange = (Array.isArray(summarizedMessages) && summarizedMessages.length > 0)
            ? `第 ${summarizedMessages[0].floor}~${summarizedMessages[summarizedMessages.length - 1].floor} 楼`
            : '新增对话';
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        
        newConfig.summaryList = [
            ...(newConfig.summaryList || []),
            {
                id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                time: timeStr,
                floorRange,
                content: cleanSummaryText
            }
        ];
    } else if (mode === 'table') {
        const parsed = parseMarkdownTables(cleanSummaryText);
        if (parsed.eventHistory.length > 0 || parsed.characterInfo.length > 0) {
            newConfig.tableData = parsed;
        } else {
            // 模型没有严格按 Markdown 表格输出时，保底存入 summary
            newConfig.summary = cleanSummaryText;
        }
    }

    setHideSummaryForConversation(convId, newConfig);
    recordSummaryVersion(convId, cleanSummaryText, hiddenFloors, source);

    await saveConversation(convId, conv);
    await saveToLocalStorage();

    // 仅当总结完成的会话恰好就是用户当前正驻留的活动会话时，才去局部刷新当前聊天流与顶栏徽章
    if (convId === state.currentConversationId) {
        renderChatMessages({ updateVisibilityOnly: true });
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
        if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    }
}

/**
 * 全局自动总结上下文（供并发冲突弹窗订阅流式输出与耗时秒表）
 */
export const autoSummaryContext = {
    convId: null,
    startTime: 0,
    currentStreamText: '',
    listeners: new Set(),
    abortController: null
};

/**
 * 自动总结触发检查器（在流式响应结束或用户发送后调用）
 * @param {string} convId - 会话ID
 * @param {number} branchIndex - 分支索引
 */
export async function checkAndTriggerAutoSummary(convId, branchIndex) {
    if (!convId) return;
    if (state.isAutoSummarizing) return; // 避免并发重复触发

    const conv = state.conversations[convId];
    if (!conv || !conv.branches) return;
    const activeBranch = conv.branches[branchIndex ?? conv.activeBranchIndex];
    if (!activeBranch || activeBranch.length === 0) return;

    const hideConfig = normalizeHideSummaryConfig(state.hideSummary && state.hideSummary[convId]);
    if (!hideConfig.autoSummaryEnabled) return;

    // 获取当前分支所有未隐藏的可见消息
    const visibleItems = getVisibleMessagesForSummary(activeBranch, hideConfig);
    if (visibleItems.length === 0) return;

    const autoType = hideConfig.autoSummaryType || 'floors';
    const floorInterval = Number(hideConfig.autoSummaryFloorInterval) || 10;
    const tokenThreshold = Number(hideConfig.autoSummaryTokenThreshold) || 4000;

    let shouldTrigger = false;

    if (autoType === 'floors') {
        if (visibleItems.length >= floorInterval) {
            shouldTrigger = true;
        }
    } else if (autoType === 'tokens') {
        let totalTokens = 0;
        visibleItems.forEach(({ msg }) => {
            totalTokens += countTokens(msg.content || '');
        });
        if (totalTokens >= tokenThreshold) {
            shouldTrigger = true;
        }
    }

    if (!shouldTrigger) return;

    // 异步执行自动总结并维护流式广播上下文
    state.isAutoSummarizing = true;
    state.autoSummarizingConvId = convId;
    updateSummaryEditorLockState();
    autoSummaryContext.convId = convId;
    autoSummaryContext.startTime = Date.now();
    autoSummaryContext.currentStreamText = '';
    autoSummaryContext.abortController = new AbortController();

    // 立即刷新顶栏总结按钮动画与状态
    if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();

    // 立即弹出提示：开始进行自动总结
    notify.info('🔄 开始进行自动记忆总结...');

    try {
        const mode = hideConfig.memoryMode || 'recursive';
        const customPrompt = hideConfig.prompts?.[mode] || getDefaultPromptForMode(mode);

        const summaryResult = await generateSummaryApiCall({
            convId,
            messagesToSummarize: visibleItems,
            customPrompt,
            withRole: !!hideConfig.withRole,
            withWorldBook: !!hideConfig.withWorldBook,
            signal: autoSummaryContext.abortController.signal,
            onChunk: (delta, fullText) => {
                autoSummaryContext.currentStreamText = fullText;
                // 广播给所有并发订阅者
                autoSummaryContext.listeners.forEach(listener => {
                    try {
                        if (typeof listener === 'function') listener(delta, fullText);
                        else if (listener && typeof listener.onChunk === 'function') listener.onChunk(delta, fullText);
                    } catch (e) { /* ignore listener error */ }
                });
            }
        });

        if (summaryResult && summaryResult.trim()) {
            await applySummaryResult(convId, summaryResult, visibleItems, !!hideConfig.dropSummarizedFloors, '自动总结');
            notify.success(`✨ 智能记忆：已自动总结前文对话并压缩了 ${visibleItems.length} 个楼层！`);
        }

        // 通知完成
        autoSummaryContext.listeners.forEach(listener => {
            try {
                if (listener && typeof listener.onFinish === 'function') listener.onFinish(summaryResult);
            } catch (e) {}
        });
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('[AutoSummary] 自动总结失败:', err);
        }
        autoSummaryContext.listeners.forEach(listener => {
            try {
                if (listener && typeof listener.onError === 'function') listener.onError(err);
            } catch (e) {}
        });
    } finally {
        state.isAutoSummarizing = false;
        state.autoSummarizingConvId = null;
        updateSummaryEditorLockState();
        autoSummaryContext.convId = null;
        autoSummaryContext.startTime = 0;
        autoSummaryContext.currentStreamText = '';
        autoSummaryContext.abortController = null;
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    }
}
