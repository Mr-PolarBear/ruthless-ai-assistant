/**
 * @file ai-task-relay.js
 * @description AI 接口后台任务中转核心服务 (Submit-and-Poll 模式与离线自愈)
 *
 * — 为什么这么设计 —
 * 1. 痛点根治：长文本/深度思考模型生成耗时较长，移动端息屏、切后台或网络抖动极易掐断前端直连长连接。
 * 2. 任务异步化：开启中转时前端将请求投递至自建 sync-server (/v1/openai/tasks)，服务端独立在后台长跑，前端凭 taskId 定时增量轮询。
 * 3. 24 小时离线自愈与断网恢复：监听 visibilitychange 与 online 事件；刷新重开浏览器时若检测到未决 taskId，自动向服务端核对状态：
 *    已完成则秒级全量填补，还在生成则无缝接力恢复轮询（绝不误提新任务），超过 24h (404) 则优雅降级展示重试与删除面板，绝不冻结输入。
 * 4. 动态 DOM 映射与会话切换防串：轮询过程中动态感应当前激活会话，切走则静默累积，切回则即刻恢复打字机流式渲染。
 */

import { state } from '../state.js?v=temp';
import { dom } from '../dom.js?v=temp';
import { saveConversation } from '../db.js?v=temp';
import { getSyncSettings } from './sync-client.js?v=temp';
import { getSyncItem } from './sync-store.js?v=temp';
import { formatMessagePipeline, renderFormattedContent, updateReasoningContainer } from '../renderer.js?v=temp';
import { addOrUpdateMessageFooter, smartCollapseStateCheck, addCollapseButtonDuringStreaming } from '../message-manager.js?v=temp';
import { scrollManager } from '../scroll-manager.js?v=temp';
import { countTokens, throttle, escapeHtml, parseStreamingThinkContent } from '../utils.js?v=temp';
import { notify, toggleSendButton, updateScrollButtonsVisibility, updateAllDynamicUI } from '../ui-updater.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';

// 活跃轮询任务 ID 集合，避免多重事件（如切屏 + 定时器）并发重复拉取
const activePollingTaskIds = new Set();
let isWatcherInitialized = false;

/**
 * 可被 AbortSignal 瞬间打断的延时工具
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function abortableSleep(ms, signal) {
    if (!signal) return new Promise(r => setTimeout(r, ms));
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        let timer = null;
        const onAbort = () => {
            if (timer) clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            resolve();
        };
        timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort);
    });
}

/**
 * 确保消息气泡中包含云端任务状态徽章
 * @param {HTMLElement} bubble
 * @returns {HTMLElement|null}
 */
export function ensureRelayStatusBadge(bubble) {
    if (!bubble) return null;
    let badge = bubble.querySelector('.relay-status-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'relay-status-badge processing';
        badge.innerHTML = `
            <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 2s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>
            云端后台稳定执行中 (防断网/切后台保护已生效)
        `;
        const contentEl = bubble.querySelector('.message-content');
        if (contentEl) {
            bubble.insertBefore(badge, contentEl);
        } else {
            bubble.appendChild(badge);
        }
    }
    return badge;
}

/**
 * 移除消息气泡中的云端任务状态徽章
 * @param {HTMLElement} bubble
 */
export function removeRelayStatusBadge(bubble) {
    if (!bubble) return;
    const badge = bubble.querySelector('.relay-status-badge');
    if (badge) badge.remove();
}

/**
 * 检查当前是否满足启用 AI 后台任务中转的先决条件
 * @returns {Promise<{ available: boolean, serverUrl: string, token: string }>}
 */
export async function isRelayAvailable() {
    try {
        const settings = getSyncSettings();
        if (!settings || !settings.enableAiRelay || !settings.serverUrl) {
            return { available: false, serverUrl: '', token: '' };
        }
        const token = await getSyncItem('token');
        if (!token) {
            return { available: false, serverUrl: settings.serverUrl, token: '' };
        }
        return {
            available: true,
            serverUrl: settings.serverUrl.replace(regexPatterns.trailingSlash, ''),
            token
        };
    } catch (e) {
        console.warn('[AIRelay] 检查中转可用性异常:', e);
        return { available: false, serverUrl: '', token: '' };
    }
}

/**
 * 向 sync-server 异步提交 AI 后台任务（秒级响应 < 50ms 获取 task_id）
 * @param {object} params
 * @param {object} params.requestData - 原始通过 buildApiRequest 组装的请求
 * @param {object} params.apiEndpoint - 当前会话绑定的 API 端点配置
 * @param {string} params.token - 云端账号鉴权 token
 * @param {string} params.serverUrl - 云端服务基准 URL
 * @returns {Promise<{ id: string, task_id: string, status: string }>}
 */
export async function submitRelayTask({ requestData, apiEndpoint, token, serverUrl }) {
    const targetUrl = requestData.url || (apiEndpoint && apiEndpoint.url) || '';
    const authHeader = requestData.headers?.['Authorization'] || (apiEndpoint && apiEndpoint.key ? `Bearer ${apiEndpoint.key}` : '');

    const submitUrl = `${serverUrl}/v1/openai/tasks`;
    const headers = {
        'Content-Type': 'application/json',
        'X-Target-Url': targetUrl,
        'X-Sync-Token': token
    };
    if (authHeader) {
        headers['Authorization'] = authHeader;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const resp = await fetch(submitUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestData.body),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
            const errJson = await resp.json().catch(() => ({}));
            const errMsg = errJson.error?.message || errJson.message || `提交中转任务失败 (HTTP ${resp.status})`;
            throw new Error(errMsg);
        }

        const data = await resp.json();
        return {
            id: data.id || data.task_id,
            task_id: data.task_id || data.id,
            status: data.status || 'pending',
            created_at: data.created_at || Math.floor(Date.now() / 1000)
        };
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('向云端中转服务提交任务超时 (15s)，请检查网络连接或自建服务器状态');
        }
        throw err;
    }
}

/**
 * 主动取消云端正在执行的后台任务
 * @param {string} taskId
 * @param {string} serverUrl
 * @param {string} token
 */
export async function cancelRelayTask(taskId, serverUrl, token) {
    if (!taskId || !serverUrl) return;
    try {
        const cancelUrl = `${serverUrl}/v1/openai/tasks/${encodeURIComponent(taskId)}/cancel`;
        await fetch(cancelUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Token': token || ''
            }
        });
    } catch (e) {
        console.warn('[AIRelay] 取消云端任务警告:', e);
    }
}

/**
 * 单次轮询任务当前进度及增量分片
 * @param {string} taskId
 * @param {number} after - 增量分片起始索引
 * @param {string} serverUrl
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
export async function pollTaskStatus(taskId, after = 0, serverUrl, token, signal) {
    const pollUrl = `${serverUrl}/v1/openai/tasks/${encodeURIComponent(taskId)}?after=${Math.max(0, after)}`;
    const headers = {};
    if (token) headers['X-Sync-Token'] = token;

    const resp = await fetch(pollUrl, {
        method: 'GET',
        headers,
        signal
    });

    if (resp.status === 404) {
        return { notFound: true, isExpired: true };
    }

    if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.message || `轮询任务状态失败 (HTTP ${resp.status})`);
    }

    return await resp.json();
}

/**
 * 解析单条 SSE chunk 字符串，提取文本 delta 与 reasoning delta
 * @param {string} chunkStr
 * @returns {{ text: string, reasoning: string, isDone: boolean }}
 */
export function parseSSEChunk(chunkStr) {
    const res = { text: '', reasoning: '', isDone: false };
    if (!chunkStr || typeof chunkStr !== 'string') return res;

    const lines = chunkStr.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !regexPatterns.sseDataLine.test(line)) continue;
        const dataStr = line.replace(regexPatterns.sseDataLine, '').trim();
        if (regexPatterns.sseDoneTag.test(dataStr)) {
            res.isDone = true;
            continue;
        }

        try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            if (!choice) continue;
            if (choice.delta?.content) {
                res.text += choice.delta.content;
            } else if (choice.message?.content) {
                res.text += choice.message.content;
            }
            if (choice.delta?.reasoning_content) {
                res.reasoning += choice.delta.reasoning_content;
            } else if (choice.message?.reasoning_content) {
                res.reasoning += choice.message.reasoning_content;
            } else if (choice.delta?.reasoning) {
                res.reasoning += choice.delta.reasoning;
            }
        } catch (_) {
            // 忽略非标准 chunk 语法错误
        }
    }
    return res;
}

/**
 * 节流渲染消息内容至 DOM 气泡，平滑配合自动滚动
 */
const throttledRelayRender = throttle(async (contentEl, formattedHtml, targetBubble, aiMessage) => {
    try {
        const wasAtBottom = scrollManager.isNearBottom(10);
        await renderFormattedContent(contentEl, formattedHtml, { isStreaming: true });
        addOrUpdateMessageFooter(targetBubble, aiMessage);
        smartCollapseStateCheck(contentEl);
        addCollapseButtonDuringStreaming(contentEl);
        scrollManager.smartScrollToBottom(wasAtBottom);
        updateScrollButtonsVisibility();
    } catch (e) {
        console.error('[AIRelay] 节流渲染异常:', e);
    }
}, 100);

/**
 * 生成 24 小时过期卡片 HTML
 * @param {string} msgId
 * @param {string} [convId]
 * @returns {string}
 */
export function generateExpiredCardHtml(msgId, convId = '') {
    return `
<div class="relay-expired-box" data-msg-id="${escapeHtml(msgId)}" data-conv-id="${escapeHtml(convId)}">
    <div class="relay-expired-title">
        <svg class="sync-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        回复已超过 24 小时云端留存期
    </div>
    <p class="relay-expired-desc">
        此生成任务由自建云端后台接力长跑。根据服务端的磁盘安全回收策略，超过 24 小时的历史任务已自动物理释放。您可以选择从此楼层重新生成，或直接清理此消息。
    </p>
    <div class="relay-expired-actions">
        <button type="button" class="sync-btn sync-btn-primary relay-regenerate-btn" data-msg-id="${escapeHtml(msgId)}" data-conv-id="${escapeHtml(convId)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            重新生成
        </button>
        <button type="button" class="sync-btn sync-btn-secondary relay-delete-msg-btn" data-msg-id="${escapeHtml(msgId)}" data-conv-id="${escapeHtml(convId)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            删除
        </button>
    </div>
</div>
    `.trim();
}

/**
 * 为已渲染的过期卡片中的【重新生成】与【删除】按钮绑定点击事件（双重保障，配合全局事件委托）
 * @param {HTMLElement} container
 * @param {string} convId
 * @param {number} [branchIndex]
 * @param {number} [msgIndex]
 */
export function bindExpiredCardActions(container, convId, branchIndex, msgIndex) {
    if (!container) return;

    const regenBtn = container.querySelector('.relay-regenerate-btn');
    if (regenBtn) {
        regenBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const { handleSendMessage } = await import('../main.js?v=temp');
            let targetMsgIndex = msgIndex;
            if (targetMsgIndex === undefined || targetMsgIndex < 0) {
                const bubble = container.closest('.message-bubble') || container;
                targetMsgIndex = parseInt(bubble.dataset?.index, 10);
            }
            const branchFromIndex = targetMsgIndex - 1;
            if (branchFromIndex >= 0) {
                handleSendMessage({ isBranching: true, branchFromIndex, skipBranchSummaryConfirm: true });
            }
        });
    }

    const delBtn = container.querySelector('.relay-delete-msg-btn');
    if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const targetConvId = convId || state.currentConversationId;
            const conv = state.conversations[targetConvId];
            const targetBranchIndex = branchIndex !== undefined ? branchIndex : (conv?.activeBranchIndex || 0);
            let targetMsgIndex = msgIndex;
            if (targetMsgIndex === undefined || targetMsgIndex < 0) {
                const bubble = container.closest('.message-bubble') || container;
                targetMsgIndex = parseInt(bubble.dataset?.index, 10);
            }
            if (conv && conv.branches?.[targetBranchIndex] && targetMsgIndex >= 0) {
                conv.branches[targetBranchIndex].splice(targetMsgIndex, 1);
                conv.lastModified = new Date().toISOString();
                await saveConversation(targetConvId, conv);
                const { renderChatMessages } = await import('../renderer.js?v=temp');
                renderChatMessages();
                notify.success('已删除过期消息');
            }
        });
    }
}

/**
 * 统一调度：管理常规消息或恢复任务的后台轮询与流式打字机渲染
 *
 * — 为什么这么设计 —
 * 1. 消除冗余与状态分裂：无论是首次发送还是离线恢复，统一由本函数接力轮询；
 * 2. 规避会话切换导致的 DOM 游离失效：每次轮询均动态匹配当前会话与可见气泡，切走则静默累积，切回即刻无缝衔接；
 * 3. 稳健的异常与取消状态机：用户主动取消时立即同步取消云端长跑，防范资源浪费。
 *
 * @param {object} params
 * @param {string} params.taskId - 云端任务唯一标识
 * @param {string} params.convId - 关联会话 ID
 * @param {string} params.msgId - 对应 AI 消息 ID
 * @param {string} params.token - 鉴权凭证
 * @param {string} params.serverUrl - 服务端基准地址
 * @param {AbortSignal} [params.abortSignal] - 用户终止信号
 * @param {number} [params.initialAfter] - 起始分片位置
 * @param {string} [params.initialContent] - 已累积的初始正文
 * @param {string} [params.initialReasoning] - 已累积的初始思考内容
 */
export async function pollAndStreamRelayTask({
    taskId,
    convId,
    msgId,
    token,
    serverUrl,
    abortSignal,
    initialAfter = 0,
    initialContent = '',
    initialReasoning = ''
}) {
    if (!taskId || !serverUrl) return;

    activePollingTaskIds.add(taskId);

    let after = initialAfter;
    let accumulatedContent = initialContent;
    let accumulatedReasoning = initialReasoning;
    let isFinished = false;

    // 辅助获取当前目标会话与消息对象
    const getTargetData = () => {
        const conv = state.conversations[convId];
        if (!conv || !conv.branches) return { conv: null, branch: null, msg: null, branchIndex: 0, msgIndex: -1 };
        const branchIndex = conv.activeBranchIndex || 0;
        const branch = conv.branches[branchIndex] || [];
        const msgIndex = branch.findIndex(m => m.id === msgId);
        const msg = msgIndex >= 0 ? branch[msgIndex] : null;
        return { conv, branch, msg, branchIndex, msgIndex };
    };

    try {
        while (!isFinished) {
            // 1. 检查是否已被用户手动终止
            if (abortSignal?.aborted) {
                await cancelRelayTask(taskId, serverUrl, token);
                const { conv, msg } = getTargetData();
                if (msg) {
                    msg.relayStatus = 'cancelled';
                    msg.isRelayCompleted = true;
                    msg.content = (msg.content || accumulatedContent) + "\n\n<small class='error-indicator'>[ 用户手动停止 ]</small>";
                    if (conv) await saveConversation(convId, conv);
                }
                if (state.currentConversationId === convId) {
                    const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                    if (bubble) {
                        removeRelayStatusBadge(bubble);
                        const contentEl = bubble.querySelector('.message-content') || bubble;
                        contentEl.innerHTML = (msg?.content || accumulatedContent);
                        contentEl.classList.remove('typing-cursor');
                    }
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
                return;
            }

            // 2. 发起单次增量轮询
            let pollData;
            try {
                pollData = await pollTaskStatus(taskId, after, serverUrl, token, abortSignal);
            } catch (pollErr) {
                if (pollErr.name === 'AbortError' || abortSignal?.aborted) {
                    await cancelRelayTask(taskId, serverUrl, token);
                    const { conv, msg } = getTargetData();
                    if (msg) {
                        msg.relayStatus = 'cancelled';
                        msg.isRelayCompleted = true;
                        msg.content = (msg.content || accumulatedContent) + "\n\n<small class='error-indicator'>[ 用户手动停止 ]</small>";
                        if (conv) await saveConversation(convId, conv);
                    }
                    if (state.currentConversationId === convId) {
                        const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                        if (bubble) {
                            removeRelayStatusBadge(bubble);
                            const contentEl = bubble.querySelector('.message-content') || bubble;
                            contentEl.innerHTML = (msg?.content || accumulatedContent);
                            contentEl.classList.remove('typing-cursor');
                        }
                        toggleSendButton(false);
                        updateAllDynamicUI();
                    }
                    return;
                }
                // 网络偶发颠簸保护：等待片刻重试，避免单次网络瞬断打崩整个任务
                console.warn('[AIRelay] 增量轮询瞬断抖动，1.5s 后重试:', pollErr);
                await abortableSleep(1500, abortSignal);
                continue;
            }

            // 3. 任务 404 处理（已超过 24 小时云端留存期）
            if (pollData.notFound) {
                const { conv, msg, branchIndex, msgIndex } = getTargetData();
                if (msg) {
                    msg.relayStatus = 'expired';
                    msg.content = generateExpiredCardHtml(msgId, convId);
                    if (conv) await saveConversation(convId, conv);
                }
                if (state.currentConversationId === convId) {
                    const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                    if (bubble) {
                        removeRelayStatusBadge(bubble);
                        const contentEl = bubble.querySelector('.message-content') || bubble;
                        contentEl.innerHTML = generateExpiredCardHtml(msgId, convId);
                        contentEl.classList.remove('typing-cursor');
                        bindExpiredCardActions(contentEl, convId, branchIndex, msgIndex);
                    }
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
                return;
            }

            // 4. 增量分片解析与实时动态渲染
            if (Array.isArray(pollData.chunks) && pollData.chunks.length > 0) {
                for (const chunkStr of pollData.chunks) {
                    const chunkInfo = parseSSEChunk(chunkStr);
                    if (chunkInfo.text) {
                        accumulatedContent += chunkInfo.text;
                    }
                    if (chunkInfo.reasoning) {
                        accumulatedReasoning += chunkInfo.reasoning;
                    }
                }
                after = (pollData.next_after !== undefined) ? pollData.next_after : (after + pollData.chunks.length);

                const { msg } = getTargetData();
                if (msg) {
                    msg.content = accumulatedContent;
                }

                // 仅当用户正在查看该会话时才调度 DOM 节流渲染，避免跨会话游离渲染
                if (state.currentConversationId === convId && !state.isFullRendering) {
                    const liveBubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                    if (liveBubble) {
                        ensureRelayStatusBadge(liveBubble);
                        const liveContentEl = liveBubble.querySelector('.message-content') || liveBubble;
                        liveContentEl.classList.add('typing-cursor');

                        // 思考链动态解析与渲染
                        const { thinkingContent, mainContent: cleanedContent, isThinkingComplete } = parseStreamingThinkContent(accumulatedContent);
                        const allReasoningParts = [];
                        if (accumulatedReasoning && accumulatedReasoning.trim()) {
                            allReasoningParts.push({ content: accumulatedReasoning.trim(), source: 'field', order: -1 });
                        }
                        if (thinkingContent) {
                            allReasoningParts.push({ content: thinkingContent, source: 'inline', order: 0 });
                        }

                        if (allReasoningParts.length > 0) {
                            if (msg) msg.reasoningParts = allReasoningParts;
                            updateReasoningContainer(liveBubble, allReasoningParts, true, isThinkingComplete);
                        }

                        const renderText = thinkingContent ? cleanedContent : accumulatedContent;
                        const formattedHtml = await formatMessagePipeline(renderText, 'assistant');
                        throttledRelayRender(liveContentEl, formattedHtml, liveBubble, msg || { content: accumulatedContent });
                    }
                }
            }

            // 5. 任务终态判定
            if (pollData.done) {
                isFinished = true;
                const { conv, msg, branchIndex, msgIndex } = getTargetData();

                if (pollData.status === 'completed') {
                    let finalBodyContent = '';
                    let finalReasoning = '';
                    let usageTokens = 0;

                    if (pollData.result) {
                        const firstChoice = pollData.result.choices?.[0];
                        if (firstChoice) {
                            finalBodyContent = firstChoice.message?.content || '';
                            finalReasoning = firstChoice.message?.reasoning_content || '';
                        }
                        usageTokens = pollData.result.usage?.completion_tokens || pollData.result.usage?.total_tokens || 0;
                    }

                    const rawFinalText = finalBodyContent || accumulatedContent;
                    const { thinkingContent, mainContent: cleanedFinal } = parseStreamingThinkContent(rawFinalText);

                    const allReasoningParts = [];
                    const effectiveReasoning = finalReasoning || accumulatedReasoning;
                    if (effectiveReasoning && effectiveReasoning.trim()) {
                        allReasoningParts.push({ type: 'reasoning', content: effectiveReasoning.trim(), source: 'field', order: -1 });
                    }
                    if (thinkingContent) {
                        allReasoningParts.push({ type: 'reasoning', content: thinkingContent, source: 'inline', order: 0 });
                    }

                    const cleanContent = thinkingContent ? cleanedFinal : rawFinalText;

                    if (msg) {
                        msg.content = cleanContent;
                        if (allReasoningParts.length > 0) {
                            msg.reasoningParts = allReasoningParts;
                        }
                        msg.stats = msg.stats || {};
                        msg.stats.tokenCount = usageTokens || countTokens(rawFinalText);
                        msg.relayStatus = 'completed';
                        msg.isRelayCompleted = true;
                        if (pollData.created_at && pollData.updated_at) {
                            msg.stats.duration = Math.max(1, pollData.updated_at - pollData.created_at);
                        }
                    }
                    if (conv) {
                        conv.lastModified = new Date().toISOString();
                        await saveConversation(convId, conv);
                    }

                    if (state.currentConversationId === convId) {
                        const liveBubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                        if (liveBubble) {
                            removeRelayStatusBadge(liveBubble);
                            if (allReasoningParts.length > 0) {
                                updateReasoningContainer(liveBubble, allReasoningParts, false, true);
                            }
                            const liveContentEl = liveBubble.querySelector('.message-content') || liveBubble;
                            const finalHtml = await formatMessagePipeline(cleanContent, 'assistant');
                            await renderFormattedContent(liveContentEl, finalHtml);
                            if (msg) addOrUpdateMessageFooter(liveBubble, msg);
                            liveContentEl.classList.remove('typing-cursor');
                        }
                        toggleSendButton(false);
                        updateAllDynamicUI();
                    }

                    // — 为什么这么写 —
                    // 1. 中转任务成功完成后，必须主动触发自动总结检测；
                    // 2. 此前此处缺失调用导致开启中转后即便达到或超出阈值也永远无法触发自动总结。
                    import('../summary-manager.js?v=temp').then(({ checkAndTriggerAutoSummary }) => {
                        const targetBranchIndex = conv?.activeBranchIndex ?? 0;
                        checkAndTriggerAutoSummary(convId, targetBranchIndex).catch(err => console.warn('[AutoSummary] 中转完成触发总结检测异常:', err));
                    }).catch(err => console.warn('[AutoSummary] 动态引入 summary-manager 异常:', err));

                    return;
                } else if (pollData.status === 'failed') {
                    const errorMsg = pollData.error || pollData.result?.error?.message || '云端执行失败';
                    if (msg) {
                        msg.relayStatus = 'failed';
                        msg.isRelayCompleted = true;
                        msg.content = `<small class='error-indicator'>[ 云端任务执行失败: ${escapeHtml(errorMsg)} ]</small>`;
                    }
                    if (conv) await saveConversation(convId, conv);

                    if (state.currentConversationId === convId) {
                        const liveBubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                        if (liveBubble) {
                            removeRelayStatusBadge(liveBubble);
                            const liveContentEl = liveBubble.querySelector('.message-content') || liveBubble;
                            liveContentEl.innerHTML = msg?.content || '';
                            liveContentEl.classList.remove('typing-cursor');
                        }
                        toggleSendButton(false);
                        updateAllDynamicUI();
                    }
                    return;
                } else if (pollData.status === 'cancelled') {
                    if (msg) {
                        msg.relayStatus = 'cancelled';
                        msg.isRelayCompleted = true;
                        msg.content = (msg.content || accumulatedContent) + "\n\n<small class='error-indicator'>[ 任务已在云端被取消 ]</small>";
                    }
                    if (conv) await saveConversation(convId, conv);

                    if (state.currentConversationId === convId) {
                        const liveBubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
                        if (liveBubble) {
                            removeRelayStatusBadge(liveBubble);
                            const liveContentEl = liveBubble.querySelector('.message-content') || liveBubble;
                            liveContentEl.innerHTML = msg?.content || '';
                            liveContentEl.classList.remove('typing-cursor');
                        }
                        toggleSendButton(false);
                        updateAllDynamicUI();
                    }
                    return;
                }
            }

            // 6. 轮询节奏控制：每 800ms 查询一次，支持取消立即响应
            await abortableSleep(800, abortSignal);
        }
    } finally {
        activePollingTaskIds.delete(taskId);
        if (state.currentConversationId === convId) {
            const liveBubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${msgId}"]`);
            if (liveBubble) {
                const liveContentEl = liveBubble.querySelector('.message-content') || liveBubble;
                liveContentEl.classList.remove('typing-cursor');
            }
        }
    }
}

/**
 * 核心调度：执行常规聊天消息的 AI 后台任务中转与打字机轮询
 * @param {object} params
 */
export async function executeRelayMessage({
    requestData,
    apiEndpoint,
    currentConv,
    aiMessage,
    aiMessageBubble,
    aiMessageContent,
    aiMessageIndex,
    token,
    serverUrl,
    abortSignal
}) {
    // 1. 提交任务至服务端秒级入库
    let submitRes;
    try {
        submitRes = await submitRelayTask({ requestData, apiEndpoint, token, serverUrl });
    } catch (err) {
        aiMessage.content = `<small class='error-indicator'>[ 提交云端中转任务失败: ${escapeHtml(err.message)} ]</small>`;
        aiMessage.relayStatus = 'failed';
        await saveConversation(currentConv.id, currentConv);
        throw err;
    }

    const taskId = submitRes.task_id;
    aiMessage.taskId = taskId;
    aiMessage.relayServerUrl = serverUrl;
    aiMessage.relayStatus = 'processing';
    aiMessage.isRelayTask = true;

    // — 为什么这么写 —
    // 提交成功后立即将 taskId 固化至 IndexedDB，确保即使用户在 1 秒内关闭网页，该会话也具备完整的自愈凭据。
    await saveConversation(currentConv.id, currentConv);

    ensureRelayStatusBadge(aiMessageBubble);
    aiMessageContent.classList.add('typing-cursor');

    // 2. 调度统一的后台轮询与流式打字机渲染
    await pollAndStreamRelayTask({
        taskId,
        convId: currentConv.id,
        msgId: aiMessage.id,
        token,
        serverUrl,
        abortSignal
    });
}

/**
 * 会话加载与离线自愈引擎：检测指定会话末尾是否存在未完成的云端中转任务并执行自动自愈
 * @param {string} convId
 */
export async function recoverRelayTaskForConversation(convId) {
    if (!convId) return;
    const conv = state.conversations[convId];
    if (!conv || !conv.branches) return;
    const branchIndex = conv.activeBranchIndex || 0;
    const branch = conv.branches[branchIndex];
    if (!branch || branch.length === 0) return;

    const lastMsgIndex = branch.length - 1;
    const lastMsg = branch[lastMsgIndex];
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.taskId) {
        return;
    }

    // 已确认为过期卡片，确保输入框不冻结并绑定操作事件
    if (lastMsg.relayStatus === 'expired') {
        if (state.currentConversationId === convId) {
            const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
            if (bubble) {
                const contentEl = bubble.querySelector('.message-content') || bubble;
                contentEl.classList.remove('typing-cursor');
                bindExpiredCardActions(contentEl, convId, branchIndex, lastMsgIndex);
            }
            toggleSendButton(false);
        }
        return;
    }

    // 已终态完成，不重复探测
    if (lastMsg.isRelayCompleted || lastMsg.relayStatus === 'completed') {
        return;
    }

    const taskId = lastMsg.taskId;

    // 若当前任务已在后台轮询中，若切到该会话，确保界面处于生成态
    if (activePollingTaskIds.has(taskId)) {
        if (state.currentConversationId === convId) {
            toggleSendButton(true);
            const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
            if (bubble) {
                const contentEl = bubble.querySelector('.message-content') || bubble;
                contentEl.classList.add('typing-cursor');
                ensureRelayStatusBadge(bubble);
            }
        }
        return;
    }

    const relayInfo = await isRelayAvailable();
    const serverUrl = lastMsg.relayServerUrl || relayInfo.serverUrl;
    const token = relayInfo.token;

    if (!serverUrl) return;

    activePollingTaskIds.add(taskId);

    try {
        // 先进行一次直接探测
        const pollData = await pollTaskStatus(taskId, 0, serverUrl, token);

        if (pollData.notFound) {
            // 分支 3：已超过 24 小时云端清理时限
            lastMsg.relayStatus = 'expired';
            lastMsg.content = generateExpiredCardHtml(lastMsg.id, convId);
            await saveConversation(convId, conv);

            if (state.currentConversationId === convId) {
                const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
                if (bubble) {
                    removeRelayStatusBadge(bubble);
                    const contentEl = bubble.querySelector('.message-content') || bubble;
                    contentEl.innerHTML = lastMsg.content;
                    contentEl.classList.remove('typing-cursor');
                    bindExpiredCardActions(contentEl, convId, branchIndex, lastMsgIndex);
                }
                toggleSendButton(false);
                updateAllDynamicUI();
            }
            notify.warning('检测到一条超过 24 小时云端留存期的未完成回复，已提供重新生成与删除选项。');
            return;
        }

        if (pollData.done) {
            if (pollData.status === 'completed') {
                // 分支 1：离线期间大模型已完成生成，秒级填入并持久化
                let fullContent = '';
                let reasoning = '';
                if (pollData.result) {
                    const choice = pollData.result.choices?.[0];
                    fullContent = choice?.message?.content || '';
                    reasoning = choice?.message?.reasoning_content || '';
                }

                const { thinkingContent, mainContent: cleanedFinal } = parseStreamingThinkContent(fullContent);
                const allReasoningParts = [];
                if (reasoning && reasoning.trim()) {
                    allReasoningParts.push({ type: 'reasoning', content: reasoning.trim(), source: 'field', order: -1 });
                }
                if (thinkingContent) {
                    allReasoningParts.push({ type: 'reasoning', content: thinkingContent, source: 'inline', order: 0 });
                }

                const finalCleanContent = thinkingContent ? cleanedFinal : fullContent;

                lastMsg.content = finalCleanContent;
                if (allReasoningParts.length > 0) {
                    lastMsg.reasoningParts = allReasoningParts;
                }
                const tokens = pollData.result?.usage?.completion_tokens || pollData.result?.usage?.total_tokens;
                lastMsg.stats = lastMsg.stats || {};
                lastMsg.stats.tokenCount = tokens || countTokens(fullContent);
                lastMsg.relayStatus = 'completed';
                lastMsg.isRelayCompleted = true;
                if (pollData.created_at && pollData.updated_at) {
                    lastMsg.stats.duration = Math.max(1, pollData.updated_at - pollData.created_at);
                }
                conv.lastModified = new Date().toISOString();

                await saveConversation(convId, conv);

                if (state.currentConversationId === convId) {
                    const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
                    if (bubble) {
                        removeRelayStatusBadge(bubble);
                        if (allReasoningParts.length > 0) {
                            updateReasoningContainer(bubble, allReasoningParts, false, true);
                        }
                        const contentEl = bubble.querySelector('.message-content') || bubble;
                        const formattedHtml = await formatMessagePipeline(finalCleanContent, 'assistant');
                        await renderFormattedContent(contentEl, formattedHtml);
                        addOrUpdateMessageFooter(bubble, lastMsg);
                        contentEl.classList.remove('typing-cursor');
                    }
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
                notify.success('已自动恢复云端后台生成的完整回复！');

                // — 为什么这么写 —
                // 离线恢复成功秒级补齐后，同样必须触发自动总结检测，防止用户关闭网页再打开后积压的消息漏掉总结。
                import('../summary-manager.js?v=temp').then(({ checkAndTriggerAutoSummary }) => {
                    const targetBranchIndex = conv?.activeBranchIndex ?? branchIndex;
                    checkAndTriggerAutoSummary(convId, targetBranchIndex).catch(err => console.warn('[AutoSummary] 离线自愈触发总结检测异常:', err));
                }).catch(err => console.warn('[AutoSummary] 动态引入 summary-manager 异常:', err));

                return;
            } else if (pollData.status === 'failed') {
                const errorMsg = pollData.error || pollData.result?.error?.message || '云端执行失败';
                lastMsg.relayStatus = 'failed';
                lastMsg.isRelayCompleted = true;
                lastMsg.content = `<small class='error-indicator'>[ 云端任务执行失败: ${escapeHtml(errorMsg)} ]</small>`;
                await saveConversation(convId, conv);

                if (state.currentConversationId === convId) {
                    const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
                    if (bubble) {
                        removeRelayStatusBadge(bubble);
                        const contentEl = bubble.querySelector('.message-content') || bubble;
                        contentEl.innerHTML = lastMsg.content;
                        contentEl.classList.remove('typing-cursor');
                        addOrUpdateMessageFooter(bubble, lastMsg);
                    }
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
                notify.error(`云端任务执行失败: ${errorMsg}`);
                return;
            } else if (pollData.status === 'cancelled') {
                lastMsg.relayStatus = 'cancelled';
                lastMsg.isRelayCompleted = true;
                lastMsg.content += "\n\n<small class='error-indicator'>[ 任务已在云端被取消 ]</small>";
                await saveConversation(convId, conv);

                if (state.currentConversationId === convId) {
                    const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
                    if (bubble) {
                        removeRelayStatusBadge(bubble);
                        const contentEl = bubble.querySelector('.message-content') || bubble;
                        contentEl.innerHTML = lastMsg.content;
                        contentEl.classList.remove('typing-cursor');
                        addOrUpdateMessageFooter(bubble, lastMsg);
                    }
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
                return;
            }
        }

        if (!pollData.done) {
            // 分支 2：还在后台生成中，无缝接力恢复轮询与流式打字机（切勿误提新任务！）
            let accumulatedContent = '';
            let accumulatedReasoning = '';
            let after = 0;

            if (Array.isArray(pollData.chunks) && pollData.chunks.length > 0) {
                for (const chunkStr of pollData.chunks) {
                    const chunkInfo = parseSSEChunk(chunkStr);
                    if (chunkInfo.text) accumulatedContent += chunkInfo.text;
                    if (chunkInfo.reasoning) accumulatedReasoning += chunkInfo.reasoning;
                }
                after = pollData.next_after !== undefined ? pollData.next_after : pollData.chunks.length;
            }

            if (state.currentConversationId === convId) {
                toggleSendButton(true);
                const bubble = dom.chatMessages?.querySelector(`.message-bubble[data-id="${lastMsg.id}"]`);
                if (bubble) {
                    ensureRelayStatusBadge(bubble);
                    const contentEl = bubble.querySelector('.message-content') || bubble;
                    contentEl.classList.add('typing-cursor');
                    if (accumulatedContent) {
                        const formattedHtml = await formatMessagePipeline(accumulatedContent, 'assistant');
                        await renderFormattedContent(contentEl, formattedHtml, { isStreaming: true });
                    }
                }
            }

            state.abortControllers[convId] = new AbortController();

            // 启动后台持续接力轮询，彻底防范重复提交任务
            activePollingTaskIds.delete(taskId); // 交由 pollAndStreamRelayTask 自行管理生命周期
            pollAndStreamRelayTask({
                taskId,
                convId,
                msgId: lastMsg.id,
                token,
                serverUrl,
                abortSignal: state.abortControllers[convId]?.signal,
                initialAfter: after,
                initialContent: accumulatedContent,
                initialReasoning: accumulatedReasoning
            }).finally(() => {
                if (state.currentConversationId === convId) {
                    toggleSendButton(false);
                    updateAllDynamicUI();
                }
            });
        }
    } catch (err) {
        console.warn('[AIRelay] 自愈检测网络故障:', err);
    } finally {
        activePollingTaskIds.delete(taskId);
    }
}

/**
 * 监听手机切后台/息屏恢复 (visibilitychange) 与网络恢复 (online) 全局自愈监听器
 */
export function initVisibilityAndOnlineWatcher() {
    if (isWatcherInitialized) return;
    isWatcherInitialized = true;

    const triggerHealing = () => {
        if (state.currentConversationId) {
            recoverRelayTaskForConversation(state.currentConversationId);
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            triggerHealing();
        }
    });

    window.addEventListener('online', () => {
        triggerHealing();
    });
}

/**
 * 面向自动总结与长记忆提炼的后台任务中转支持
 * @param {object} params
 * @param {object} params.requestData
 * @param {object} params.apiEndpoint
 * @param {AbortSignal} [params.signal]
 * @param {Function} [params.onChunk]
 * @returns {Promise<string>}
 */
export async function executeRelaySummary({ requestData, apiEndpoint, signal, onChunk }) {
    const relayInfo = await isRelayAvailable();
    if (!relayInfo.available) {
        throw new Error('云端后台任务中转不可用');
    }

    const submitRes = await submitRelayTask({
        requestData,
        apiEndpoint,
        token: relayInfo.token,
        serverUrl: relayInfo.serverUrl
    });

    const taskId = submitRes.task_id;
    let after = 0;
    let accumulated = '';

    try {
        while (true) {
            if (signal?.aborted) {
                await cancelRelayTask(taskId, relayInfo.serverUrl, relayInfo.token);
                throw new Error('总结任务已被取消');
            }

            let pollData;
            try {
                pollData = await pollTaskStatus(taskId, after, relayInfo.serverUrl, relayInfo.token, signal);
            } catch (err) {
                if (err.name === 'AbortError' || signal?.aborted) {
                    await cancelRelayTask(taskId, relayInfo.serverUrl, relayInfo.token);
                    throw new Error('总结任务已被取消');
                }
                throw err;
            }

            if (pollData.notFound) {
                throw new Error('总结任务在云端已过期或不存在');
            }

            if (Array.isArray(pollData.chunks) && pollData.chunks.length > 0) {
                for (const chunkStr of pollData.chunks) {
                    const chunkInfo = parseSSEChunk(chunkStr);
                    if (chunkInfo.text) {
                        accumulated += chunkInfo.text;
                        if (typeof onChunk === 'function') {
                            onChunk(chunkInfo.text, accumulated);
                        }
                    }
                }
                after = (pollData.next_after !== undefined) ? pollData.next_after : (after + pollData.chunks.length);
            }

            if (pollData.done) {
                if (pollData.status === 'completed') {
                    const finalContent = pollData.result?.choices?.[0]?.message?.content || accumulated;
                    if (typeof onChunk === 'function' && finalContent !== accumulated) {
                        onChunk(finalContent, finalContent);
                    }
                    return finalContent;
                } else {
                    throw new Error(pollData.error || pollData.result?.error?.message || '云端总结任务失败');
                }
            }

            await abortableSleep(800, signal);
        }
    } catch (err) {
        if (signal?.aborted) {
            await cancelRelayTask(taskId, relayInfo.serverUrl, relayInfo.token);
        }
        throw err;
    }
}
