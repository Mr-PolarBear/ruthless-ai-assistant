/**
 * @file summary-manager.js
 * @description 对话记忆与智能总结模块（支持手动总结、自动触发与滚动上下文压缩）
 */

import { state } from './state.js?v=260820-1';
import { dom } from './dom.js?v=260820-1';
import { saveConversation } from './db.js?v=260820-1';
import { saveToLocalStorage, countTokens, isMessageHidden } from './utils.js?v=260820-1';
import { buildApiRequest, processAndFilterMessages } from './api-common.js?v=260820-1';
import { renderChatMessages } from './renderer.js?v=260820-1';
import { notify, updateSummaryEditorLockState } from './ui-updater.js?v=260820-1';
import { getHideSummaryForConversation, setHideSummaryForConversation, getHideSummaryForCurrentConversation, setHideSummaryForCurrentConversation } from './main.js?v=260820-1';

// — 为什么这么写 —
// 默认提供一段全面且条理清晰的长期记忆提取提示词，不限制字数，引导模型提取背景、决策、共识与待办
export const DEFAULT_SUMMARY_PROMPT = '请对上述可见的历史对话内容进行全面、客观且条理清晰的提炼与总结。提取对话的核心背景、关键信息、重要决策、达成的共识及任何待解决的问题。保持逻辑严密完整，作为后续对话的长期记忆参考。';

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
 * 调用 LLM 执行总结请求
 * @param {Object} options
 * @param {string} options.convId - 会话ID
 * @param {Array} options.messagesToSummarize - 待总结的消息列表
 * @param {string} options.customPrompt - 总结提示词
 * @param {boolean} options.withRole - 是否携带角色人设
 * @param {boolean} options.withWorldBook - 是否携带世界书/备忘录
 * @param {AbortSignal} [options.signal] - 中断信号
 * @param {Function} [options.onChunk] - 流式返回回调
 * @returns {Promise<string>} 总结结果文本
 */
export async function generateSummaryApiCall(options) {
    const {
        convId,
        messagesToSummarize,
        customPrompt = DEFAULT_SUMMARY_PROMPT,
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

    const summaryMessages = [...filteredMessages];

    // 2. 添加总结指令
    const promptText = customPrompt && customPrompt.trim() ? customPrompt.trim() : DEFAULT_SUMMARY_PROMPT;
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
 * 记录并沉淀历史总结版本快照
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结文本
 * @param {number[]} hiddenFloors - 当时的隐藏楼层数组
 * @param {string} source - 来源 ('自动总结' | '手动保存')
 */
export function recordSummaryVersion(convId, summaryText, hiddenFloors = [], source = '手动保存') {
    if (!convId || !summaryText || !summaryText.trim()) return;

    const existingConfig = (state.hideSummary && state.hideSummary[convId]) || {};
    const history = Array.isArray(existingConfig.history) ? [...existingConfig.history] : [];

    const trimmedText = summaryText.trim();
    const sortedFloors = [...new Set(hiddenFloors)].sort((a, b) => a - b);

    // 避免连续重复保存相同内容的快照
    if (history.length > 0) {
        const latest = history[0];
        const sameFloors = JSON.stringify(latest.hiddenFloors || []) === JSON.stringify(sortedFloors);
        if (latest.summary === trimmedText && sameFloors) {
            return;
        }
    }

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const newSnapshot = {
        id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        time: timeStr,
        summary: trimmedText,
        hiddenFloors: sortedFloors,
        charCount: trimmedText.length,
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
 * 保存并应用总结结果（若勾选归档，将对应消息批量标记隐藏）
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结结果文本
 * @param {Array<{msg: Object, floor: number}>} summarizedMessages - 本次被总结的消息列表
 * @param {boolean} dropFloors - 是否自动隐藏被总结的楼层
 * @param {string} [source='自动总结'] - 来源标记
 */
export async function applySummaryResult(convId, summaryText, summarizedMessages, dropFloors, source = '自动总结') {
    if (!convId || !summaryText || !summaryText.trim()) return;

    const conv = state.conversations[convId];
    if (!conv) return;

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const existingConfig = getHideSummaryForConversation(convId);

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

    const newConfig = {
        ...existingConfig,
        summary: summaryText.trim(),
        enabled: true,
        hiddenFloors,
        start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
        end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1
    };

    setHideSummaryForConversation(convId, newConfig);
    recordSummaryVersion(convId, summaryText, hiddenFloors, source);

    await saveConversation(convId, conv);
    await saveToLocalStorage();

    // — 为什么这么写 —
    // 仅当总结完成的会话恰好就是用户当前正驻留的活动会话时，才去局部刷新当前聊天流与顶栏徽章，
    // 彻底杜绝后台异步自动总结完成后对新切换会话产生"视觉串台"污染。
    if (convId === state.currentConversationId) {
        renderChatMessages({ updateVisibilityOnly: true });
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
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

    const hideConfig = (state.hideSummary && state.hideSummary[convId]) || {};
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
    updateSummaryEditorLockState();
    autoSummaryContext.convId = convId;
    autoSummaryContext.startTime = Date.now();
    autoSummaryContext.currentStreamText = '';
    autoSummaryContext.abortController = new AbortController();

    try {
        const customPrompt = hideConfig.prompt || DEFAULT_SUMMARY_PROMPT;
        const summaryResult = await generateSummaryApiCall({
            convId,
            messagesToSummarize: visibleItems,
            customPrompt,
            withRole: !!hideConfig.withRole,
            withWorldBook: !!hideConfig.withWorldBook,
            signal: autoSummaryContext.abortController.signal,
            onChunk: (delta, fullText) => {
                autoSummaryContext.currentStreamText = fullText;
                // 广播给所有并发订阅者（如冲突确认弹窗）
                autoSummaryContext.listeners.forEach(listener => {
                    try {
                        if (typeof listener === 'function') listener(delta, fullText);
                        else if (listener && typeof listener.onChunk === 'function') listener.onChunk(delta, fullText);
                    } catch (e) { /* ignore listener error */ }
                });
            }
        });

        if (summaryResult && summaryResult.trim()) {
            await applySummaryResult(convId, summaryResult, visibleItems, !!hideConfig.dropSummarizedFloors);
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
        updateSummaryEditorLockState();
        autoSummaryContext.convId = null;
        autoSummaryContext.startTime = 0;
        autoSummaryContext.currentStreamText = '';
        autoSummaryContext.abortController = null;
    }
}
