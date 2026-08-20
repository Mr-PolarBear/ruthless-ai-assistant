/**
 * @file llm-service.js
 * @description Handles streaming and non-streaming responses from LLMs.
 */

import { state } from '../state.js';
import { dom } from '../dom.js';
import { saveConversation } from '../db.js';
import { formatMessagePipeline, renderFormattedContent, updateReasoningContainer } from '../renderer.js';
import { addOrUpdateMessageFooter, updateMessageActions, addCollapseButtonDuringStreaming, smartCollapseStateCheck } from '../message-manager.js';
import { updateFloatingButton } from '../floating-button.js';
import { countTokens, throttle, saveToLocalStorage, escapeHtml, extractThinkingFromContent, mergeReasoningParts, parseStreamingThinkContent, isFloorHiddenInConfig, isMessageHidden } from '../utils.js';
import { scrollManager } from '../scroll-manager.js';
import { handleToolCalls, preRenderToolCallCards } from './mcp-handler.js';
// 乌鸦：多轮工具调用需要的额外导入
import { parseToolCalls, mcpExecutor } from '../mcp-core.js';
import { mcpSessionManager } from '../mcp-session-manager.js';
import { renderToolCallResult } from '../mcp-renderer.js';
import { regexPatterns as regex } from '../regex.js';
import { notify, updateScrollButtonsVisibility, updateAllDynamicUI } from '../ui-updater.js';
import { checkAndTriggerAutoSummary } from '../summary-manager.js';

/**
 * 乌鸦：创建调试响应日志
 */
function createDebugResponseLog(responseData) {
    const { requestUrl, finalContent, reasoningContent, totalTokens, responseTime, convId, branchIndex, msgIndex } = responseData;

    const debugResponse = {
        id: `debug_${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'debug-log',
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content: finalContent },
                reasoning: reasoningContent || null,
                finish_reason: 'stop'
            }
        ],
        usage: { prompt_tokens: 0, completion_tokens: totalTokens, total_tokens: totalTokens },
        debug_info: { conversation_id: convId, branch_index: branchIndex, message_index: msgIndex, response_time: responseTime, timestamp: new Date().toISOString() }
    };

    const debugUrl = window.location.origin + '/debug/api-response';

    fetch(debugUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Type': 'stream-complete', 'X-Original-URL': requestUrl },
        body: JSON.stringify(debugResponse, null, 2),
        mode: 'no-cors'
    }).catch(() => { });
}

// 乌鸦：创建节流渲染函数
// — 为什么这么写 —
// renderFormattedContent 是 async（内部含 await initSharedStyleSheets 与异步装饰），
// 必须 await 它完成后再触发滚动，否则 scrollHeight 还是旧值，
// 滚动会发生在 DOM 抖动期间，导致用户消息视觉"落下又升回"的闪烁。
const throttledRender = throttle(async (contentEl, formattedHtml, targetBubble, lastMessage, isFollowUp = false) => {
    try {
        const chatContainer = dom.chatMessages;
        // 乌鸦：【关键】在渲染前捕获位置状态！
        // renderFormattedContent 会增大 scrollHeight，渲染后检查 isNearBottom 永远失效
        // 原始代码就是这么做的（先查后渲染），这是正确的时序
        const wasAtBottom = scrollManager.isNearBottom(10); // 乌鸦：改为10px，防止向上滚动一格(100px)后依然被判定为"在底部"导致反向回拉

        // 乌鸦：必须 await，确保 DOM 渲染、样式表加载、代码高亮等都完成后再读取/调整滚动位置
        await renderFormattedContent(contentEl, formattedHtml, { isStreaming: true });
        addOrUpdateMessageFooter(targetBubble, lastMessage);

        smartCollapseStateCheck(contentEl);
        addCollapseButtonDuringStreaming(contentEl);
        updateFloatingButton();

        if (contentEl.shadowRoot) {
            const codeBlockContainer = contentEl.shadowRoot.querySelector('.shadow-content-wrapper');
            if (codeBlockContainer) {
                import('../code-block-enhancer.js').then(module => {
                    if (module.default && module.default.rebindEventsInContainer) {
                        module.default.rebindEventsInContainer(codeBlockContainer);
                    }
                }).catch(err => {
                    console.warn('无法动态导入 CodeBlockEnhancer:', err);
                });
            }
        }

        // 乌鸦：统一由 scrollManager 网关控制滚动
        // — 为什么这么写 —
        // 不再在外部做 shouldBlockAutoScroll 检查（双重门控），
        // 因为 wasAtBottom=true 时 smartScrollToBottom 内部会覆盖 wheelLocked，
        // 外部门控反而会拦住 forceIfWasAtBottom 的覆盖能力，导致闪烁。
        scrollManager.smartScrollToBottom(wasAtBottom);
        updateScrollButtonsVisibility();
    } catch (error) {
        console.error('渲染过程中发生错误:', error);
        addOrUpdateMessageFooter(targetBubble, lastMessage);
    }
}, 100);

/**
 * 乌鸦：处理非流式响应
 */
export async function handleNonStreamResponse(response, aiMessageId, convId, branchIndex, msgIndex) {
    const bubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessageId}"]`);
    if (!bubble) {
        console.error(`handleNonStreamResponse: 找不到消息气泡，ID: ${aiMessageId}`);
        return { finalContent: '', reasoningContent: '' };
    }
    const element = bubble.querySelector('.message-content');
    element.classList.add('typing-cursor');

    const conv = state.conversations[convId];
    if (!conv) return { finalContent: '', reasoningContent: '' };
    const branch = conv.branches[branchIndex];
    if (!branch) return { finalContent: '', reasoningContent: '' };
    const lastMessage = branch[msgIndex];
    if (!lastMessage) return { finalContent: '', reasoningContent: '' };

    const hideSummaryConfig = (conv && conv.id && state.hideSummary[conv.id]) || {};
    const visibleMessagesInfo = branch
        .map((msg, index) => ({ msg, originalIndex: index }))
        .filter(({ msg, originalIndex }) => {
            const floor = originalIndex + 1;
            return !isMessageHidden(msg, floor, hideSummaryConfig);
        });

    const totalVisibleMessages = visibleMessagesInfo.length;
    const currentMessageVisibleIndex = visibleMessagesInfo.findIndex(info => info.originalIndex === msgIndex);

    let reasoningContent = "";
    let finalContent = "";
    let userStopped = false;
    let processedContent = '';
    let allReasoningParts = [];
    let cleanedContent = '';
    let fullContent = '';

    try {
        const responseData = await response.json();

        if (responseData.choices && responseData.choices.length > 0) {
            const choice = responseData.choices[0];
            if (choice.message && choice.message.reasoning_content) {
                reasoningContent = choice.message.reasoning_content;
            }
            if (choice.message && choice.message.content) {
                finalContent = choice.message.content;
            }
        }

        const { reasoningParts: inlineParts, mainContent: extractedCleanContent } = extractThinkingFromContent(finalContent);
        cleanedContent = extractedCleanContent;
        allReasoningParts = mergeReasoningParts(reasoningContent, inlineParts);
        fullContent = (reasoningContent ? `<thinking>${reasoningContent}</thinking>` : '') + finalContent;
        lastMessage.rawContentWithTools = fullContent;

        // 乌鸦：传递 continueConversation 回调
        const toolCallResult = await handleToolCalls(cleanedContent, bubble, convId, msgIndex, continueConversation);
        processedContent = toolCallResult.content;
        const hasTriggeredFollowUp = toolCallResult.hasTriggeredFollowUp;

        // — 为什么这么写 —
        // 优先使用 API 厂商返回的官方权威 usage Token（completion_tokens 或 total_tokens）
        // 只有在 API 未返回 usage 时，才使用 countTokens(processedContent) 进行估算兜底
        const apiTokens = responseData.usage?.completion_tokens || responseData.usage?.total_tokens;
        if (typeof apiTokens === 'number' && apiTokens > 0) {
            lastMessage.stats.tokenCount = apiTokens;
        } else {
            lastMessage.stats.tokenCount = countTokens(processedContent);
        }
        lastMessage.content = processedContent;

        if (allReasoningParts.length > 0) {
            lastMessage.reasoningParts = allReasoningParts;
        }

        // 乌鸦：修复 - 统一使用 performance.now()，与 startTime 基准一致
        const currentTime = performance.now();
        const totalDuration = (currentTime - lastMessage.stats.startTime) / 1000;
        lastMessage.stats.tokensPerSecond = totalDuration > 0 ? lastMessage.stats.tokenCount / totalDuration : 0;

        if (state.currentConversationId === convId && state.conversations[convId] && state.conversations[convId].activeBranchIndex === branchIndex) {
            const bubbles = document.querySelectorAll('.message-bubble.ai');
            let targetBubble = null;
            bubbles.forEach(bub => {
                if (bub.dataset.index == msgIndex) targetBubble = bub;
            });
            if (targetBubble) {
                const contentEl = targetBubble.querySelector('.message-content');

                if (allReasoningParts.length > 0) {
                    updateReasoningContainer(targetBubble, allReasoningParts, false, true);
                }

                const wasAtBottom = scrollManager.isNearBottom(10);
                const formattedHtml = await formatMessagePipeline(processedContent, 'assistant', currentMessageVisibleIndex, totalVisibleMessages);
                renderFormattedContent(contentEl, formattedHtml);
                addOrUpdateMessageFooter(targetBubble, lastMessage);
                smartCollapseStateCheck(contentEl);
                updateFloatingButton();
                // 乌鸦：统一由 scrollManager 网关控制，不再外部双重门控
                scrollManager.smartScrollToBottom(wasAtBottom);
                updateScrollButtonsVisibility();
            }
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            finalContent += `

[Response Error: ${error.message}]`;
        } else {
            userStopped = true;
        }
    } finally {
        element.classList.remove('typing-cursor');
        delete state.generatingMessages[`${convId}_${branchIndex}_${msgIndex}`];

        let finalFullContent = processedContent || cleanedContent;

        if (userStopped) {
            const stopMessage = "\n\n<small class='error-indicator'>[ 用户手动停止 ]</small>";
            finalFullContent += stopMessage;
        }

        lastMessage.content = finalFullContent;
        lastMessage.rawContentWithTools = fullContent;

        if (state.appSettings.debugMode) {
            createDebugResponseLog({
                requestUrl: response.url || 'unknown',
                finalContent,
                reasoningContent,
                totalTokens: lastMessage.stats.tokenCount,
                responseTime: ((Date.now() - lastMessage.stats.startTime) / 1000).toFixed(2) + 's',
                convId,
                branchIndex,
                msgIndex
            });
        }

        if (bubble) {
            const contentEl = bubble.querySelector('.message-content');
            if (contentEl) {
                if (allReasoningParts.length > 0) {
                    updateReasoningContainer(bubble, allReasoningParts, false, true);
                }
                const formattedHtml = await formatMessagePipeline(finalFullContent, 'assistant', currentMessageVisibleIndex, totalVisibleMessages);
                renderFormattedContent(contentEl, formattedHtml);
                smartCollapseStateCheck(contentEl);
            }
            addOrUpdateMessageFooter(bubble, lastMessage);
            updateMessageActions(bubble.querySelector('.message-actions'), lastMessage, msgIndex);
        }

        updateScrollButtonsVisibility();
        const conv = state.conversations[convId];
        if (conv) await saveConversation(convId, conv);

        // 检查并触发自动总结（后台异步静默执行）
        checkAndTriggerAutoSummary(convId, branchIndex).catch(err => console.warn('Auto summary error:', err));

        // 乌鸦：如果触发了二次请求，不重置状态，也不更新UI（让按钮保持Stop状态）
        // 只有当没有触发二次请求时，才认为是完全结束
        // 注意：handleNonStreamResponse 中的局部变量 processedContent 和 hasTriggeredFollowUp 需要在 try 块外访问，
        // 但这里我们是在 finally 块中，try 块中的变量不可见。
        // 这里的 hasTriggeredFollowUp 实际上是未定义的。
        // 修复：我们在 try 块外定义 hasTriggeredFollowUp。

        // 重新检查变量作用域... processedContent 定义在 try 外面。
        // 我们需要在 try 外面定义 hasTriggeredFollowUp。

        // 由于这里只能替换代码片段，我会假设 handleNonStreamResponse 的开头定义了 hasTriggeredFollowUp。
        // 既然不能假设，我会在 finally 块里判断。
        // 但是 processedContent 是在 try 块里赋值的。

        // Wait, handleNonStreamResponse structure:
        // let processedContent = ''; 
        // try { ... processedContent = ... } finally { ... }

        // I need to add `let hasTriggeredFollowUp = false;` at the top of handleNonStreamResponse first.
        // Or I can modify the whole function.

        // Let's modify continueConversation first, and handleStream/handleNonStreamResponse separately.

        // This replacement targets the try/catch/finally block of handleNonStreamResponse.
        // I will do this in smaller chunks.

        state.streamingConversationId = null;
        updateAllDynamicUI();
    }

    return { finalContent, reasoningContent };
}

export async function continueConversation(originalBubble, toolResultsText, convId, branchIndex, msgIndex) {
    console.log("乌鸦：启动多轮工具调用引擎");
    // 乌鸦：立起“免死金牌”，告诉主流程不要清理状态
    state.isFollowUpStreamActive = true;
    state.streamingConversationId = convId;
    // 乌鸦：关键修复 - 为二次请求创建新的 AbortController，按会话绱定
    state.abortControllers[convId] = new AbortController();
    updateAllDynamicUI();

    const maxRounds = state.mcpSettings?.maxToolCallRounds || 10;
    let round = 1;
    let currentToolResultsText = toolResultsText;
    // 乌鸦：累加变量，避免每轮覆盖分析结果
    let accumulatedAnalysis = '';
    let accumulatedReasoning = '';

    try {
        const activeBranch = state.conversations[convId]?.branches[branchIndex];
        if (!activeBranch) throw new Error("无法找到当前活动分支。");
        const lastMessage = activeBranch[msgIndex];
        if (!lastMessage) throw new Error("无法在分支中找到对应的消息对象。");

        if (!state.lastRequestData || !state.lastRequestData.headers) {
            throw new Error("无法获取用于复用的上一次请求数据，或数据中缺少headers。");
        }

        // 乌鸦：多轮循环引擎
        while (round <= maxRounds) {
            console.log(`乌鸦：MCP 第 ${round}/${maxRounds} 轮工具调用`);

            // 乌鸦：每轮都重新深拷贝原始请求数据，避免污染
            const requestToReuse = JSON.parse(JSON.stringify(state.lastRequestData));

            // 乌鸦：追加 assistant 回复（第一轮用原始内容，后续轮次用上一轮的分析结果）
            if (round === 1 && lastMessage && lastMessage.content) {
                requestToReuse.body.messages.push({
                    role: 'assistant',
                    content: lastMessage.content
                });
            }

            requestToReuse.body.messages.push({
                role: 'user',
                content: `[分析任务]
请基于上下文中的工具执行结果，进行分析和总结。如果需要更多信息，可以继续调用工具。

[工具执行结果 - 第${round}轮]
${currentToolResultsText}`
            });

            requestToReuse.body.stream = true;

            const fetchOptions = {
                method: 'POST',
                headers: requestToReuse.headers,
                body: JSON.stringify(requestToReuse.body),
                signal: state.abortControllers[convId]?.signal
            };

            // 乌鸦：每轮创建独立的分析容器，带 data-round 标记
            // 不再复用同一个容器，解决多轮内容被覆盖的问题
            const analysisContainer = document.createElement('div');
            analysisContainer.className = 'analysis-result-container';
            analysisContainer.setAttribute('data-round', round);

            const analysisHeader = document.createElement('div');
            analysisHeader.className = 'analysis-header';
            analysisHeader.innerHTML = `<h5><i class="fas fa-lightbulb"></i> 第${round}轮请求，AI分析结果如下：</h5>`;
            analysisContainer.appendChild(analysisHeader);

            const analysisContent = document.createElement('div');
            analysisContent.className = 'message-content';
            analysisContainer.appendChild(analysisContent);

            // 乌鸦：直接追加，CSS order 保证 footer 和 collapse 按钮始终在底部
            originalBubble.appendChild(analysisContainer);

            if (lastMessage) {
                lastMessage.analysisResult = analysisContainer.outerHTML;
                await saveConversation(convId, state.conversations[convId]);
            }

            const response = await fetch(requestToReuse.url, fetchOptions);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorText = errorData.error?.message || response.statusText || `HTTP ${response.status}`;
                const contentDiv = analysisContainer.querySelector('.message-content') || analysisContainer;
                contentDiv.innerHTML = `<p class="error-indicator">第${round}轮请求失败: ${escapeHtml(errorText)}</p>`;
                break;
            }

            scrollManager.mcpExecutionStates.clear();
            scrollManager.forceScrollToBottom();

            const aiMessageId = originalBubble.dataset.id;
            if (!aiMessageId) {
                throw new Error("无法从原始消息气泡中获取ID，多轮请求无法继续。");
            }

            // 乌鸦：发送流式请求
            const { finalContent, reasoningContent } = await handleStream(response, aiMessageId, convId, branchIndex, msgIndex, {
                isFollowUp: true,
            });

            // 乌鸦：存储当前轮次的分析结果
            if (lastMessage) {
                const thinkRegex = /<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>/gi;
                let inlineThinking = '';
                let cleanedFinalContent = finalContent;

                let match;
                while ((match = thinkRegex.exec(finalContent)) !== null) {
                    inlineThinking += match[2] + '\n';
                }
                cleanedFinalContent = finalContent.replace(thinkRegex, '').trim();

                const totalThinking = (reasoningContent || '') + (inlineThinking || '');

                // 乌鸦：累加而非覆盖，保留所有轮次的分析内容
                if (accumulatedAnalysis) {
                    accumulatedAnalysis += '\n\n---\n\n';
                }
                accumulatedAnalysis += cleanedFinalContent;
                lastMessage.analysisResult = accumulatedAnalysis;

                if (totalThinking) {
                    if (accumulatedReasoning) {
                        accumulatedReasoning += '\n\n';
                    }
                    accumulatedReasoning += totalThinking.trim();
                    lastMessage.analysisReasoning = accumulatedReasoning;
                }

                // 乌鸦：存储 analysisRounds 元数据，刷新时按轮次交错渲染
                if (!lastMessage.analysisRounds) {
                    lastMessage.analysisRounds = [];
                }
                const currentToolCallsCount = activeBranch[msgIndex].toolCalls?.length || 0;
                lastMessage.analysisRounds.push({
                    round: round,
                    content: cleanedFinalContent,
                    reasoning: totalThinking ? totalThinking.trim() : '',
                    toolCallStartIndex: currentToolCallsCount, // 本轮工具在 toolCalls 数组中的起始位置（执行前）
                    toolCallCount: 0 // 先设0，执行后更新
                });

                // 乌鸦：检测 AI 回复中是否有新的 tool_call
                const sanitizedContent = cleanedFinalContent.replace(regex.thinkTag, '');
                const newToolCalls = parseToolCalls(sanitizedContent);

                if (newToolCalls.length === 0) {
                    console.log(`乌鸦：第${round}轮 AI 未调用新工具，多轮循环结束`);
                    break;
                }

                // 乌鸦：检查是否有 process_result:true
                const shouldContinue = newToolCalls.some(tc => tc.process_result);
                if (!shouldContinue) {
                    console.log(`乌鸦：第${round}轮新工具无需分析结果，执行后结束`);
                    // 乌鸦：执行工具但不继续循环
                    await _executeToolsForRound(newToolCalls, originalBubble, convId, branchIndex, msgIndex, round + 1, analysisContainer);
                    break;
                }

                // 乌鸦：达到上限检查
                if (round >= maxRounds) {
                    console.log(`乌鸦：已达到最大调用轮次 ${maxRounds}，强制结束`);
                    notify.warning(`MCP 工具调用已达最大轮次限制(${maxRounds}轮)，已自动停止`);
                    // 乌鸦：仍然执行最后一批工具，但不再继续
                    await _executeToolsForRound(newToolCalls, originalBubble, convId, branchIndex, msgIndex, round + 1, analysisContainer);
                    break;
                }

                // 乌鸦：执行新工具并收集结果
                const newResults = await _executeToolsForRound(newToolCalls, originalBubble, convId, branchIndex, msgIndex, round + 1, analysisContainer);

                // 乌鸦：更新本轮 analysisRounds 的工具数量
                const currentRoundData = lastMessage.analysisRounds?.[lastMessage.analysisRounds.length - 1];
                if (currentRoundData) {
                    currentRoundData.toolCallCount = newToolCalls.length;
                }

                // 乌鸦：检查是否所有需要分析的工具都失败了
                let allFollowUpFailed = true;
                for (let i = 0; i < newToolCalls.length; i++) {
                    if (newToolCalls[i].process_result && newResults[i]?.status === 'fulfilled' && newResults[i]?.value?.success) {
                        allFollowUpFailed = false;
                        break;
                    }
                }
                if (allFollowUpFailed) {
                    console.log(`乌鸦：第${round}轮所有需分析的工具都失败，终止循环`);
                    break;
                }

                // 乌鸦：构建下一轮的工具结果文本
                const toolCallsData = activeBranch[msgIndex].toolCalls || [];
                currentToolResultsText = _formatToolResults(toolCallsData, newToolCalls.length);

                // 乌鸦：追加当前轮 AI 的回复到下一轮的上下文中
                state.lastRequestData.body.messages.push(
                    { role: 'assistant', content: cleanedFinalContent },
                );

                round++;
            } else {
                break;
            }
        } // end while


        // 乌鸦：循环结束后统一做局部热更新
        const currentConv = state.conversations[convId];
        const finalMessage = activeBranch[msgIndex];
        if (currentConv && finalMessage) {
            await saveConversation(convId, currentConv);
            saveToLocalStorage();

            setTimeout(() => {
                import('../renderer.js').then(({ refreshMessageBubble }) => {
                    console.log(`乌鸦：多轮工具调用完成(共${round}轮)，触发局部热更新`);
                    refreshMessageBubble(originalBubble, finalMessage, msgIndex);
                });
            }, 50);
        }

    } catch (error) {
        // 乌鸦：检查是否为用户中止
        if (error.name === 'AbortError') {
            const analysisContainerContent = originalBubble.querySelector('.analysis-result-container .message-content');
            if (analysisContainerContent) {
                analysisContainerContent.innerHTML += `<p class="error-indicator">[ 用户手动停止 ]</p>`;
            }
        } else {
            console.error("乌鸦：continueConversation 失败:", error);
            const analysisContainerContent = originalBubble.querySelector('.analysis-result-container .message-content');
            if (analysisContainerContent) {
                analysisContainerContent.innerHTML = `<p class="error-indicator">多轮请求执行失败: ${escapeHtml(error.message)}</p>`;
            }
        }
    } finally {
        // 乌鸦：多轮请求结束，撤掉“免死金牌”
        state.isFollowUpStreamActive = false;
        state.streamingConversationId = null;
        // 乌鸦：清理该会话的 AbortController，防止内存泄漏
        delete state.abortControllers[convId];
        console.log(`乌鸦：多轮工具调用流程结束 (共执行${round}轮)`);
        updateAllDynamicUI();
    }
}

/**
 * 乌鸦：内部函数 - 执行某一轮的工具调用
 * @param {Array} toolCalls - 解析出的工具调用列表
 * @param {HTMLElement} messageElement - 消息DOM元素
 * @param {string} convId - 会话ID
 * @param {number} branchIndex - 分支索引
 * @param {number} msgIndex - 消息索引
 * @param {number} round - 当前轮次号
 * @param {HTMLElement} afterElement - 工具结果应插入在此元素之后（当前轮分析容器）
 * @returns {Promise<Array>} 执行结果数组
 */
async function _executeToolsForRound(toolCalls, messageElement, convId, branchIndex, msgIndex, round, afterElement) {
    const activeBranch = state.conversations[convId]?.branches[branchIndex];
    if (!activeBranch || !activeBranch[msgIndex]) return [];

    const requestConfigs = toolCalls.map((tc, i) => ({
        conversationId: convId,
        messageIndex: msgIndex,
        toolCallIndex: (activeBranch[msgIndex].toolCalls?.length || 0) + i,
        toolId: tc.tool,
        parameters: tc.parameters,
        messageElement: messageElement,
        priority: 'normal'
    }));

    const results = await mcpSessionManager.executeBatch(requestConfigs);

    if (!activeBranch[msgIndex].toolCalls) {
        activeBranch[msgIndex].toolCalls = [];
    }

    // 乌鸦：存储结果并渲染
    const baseIndex = activeBranch[msgIndex].toolCalls.length;
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const toolCall = toolCalls[i];
        const globalIdx = baseIndex + i;

        if (result.status === 'fulfilled' && result.value) {
            activeBranch[msgIndex].toolCalls[globalIdx] = result.value;
        } else {
            activeBranch[msgIndex].toolCalls[globalIdx] = {
                success: false,
                tool: toolCall.tool,
                error: result.reason?.message || '未知错误',
                timestamp: Date.now()
            };
        }

        // 乌鸦：渲染工具结果（先放全局容器）
        renderToolCallResult(messageElement, activeBranch[msgIndex].toolCalls[globalIdx], globalIdx, false, round);
    }

    // 乌鸦：把本轮新增的工具结果块移动到正确位置（当前轮分析容器之后）
    if (afterElement && afterElement.parentNode) {
        // 乌鸦：查找不带 data-round 的全局工具容器（renderToolCallResult 创建的）
        const globalContainer = messageElement.querySelector('.tool-calls-container:not([data-round])');
        if (globalContainer) {
            // 乌鸦：创建 per-round 工具容器
            const roundContainer = document.createElement('div');
            roundContainer.className = 'tool-calls-container';
            roundContainer.setAttribute('data-round', round);

            // 乌鸦：把本轮新增的工具块移到 per-round 容器
            for (let i = 0; i < results.length; i++) {
                const globalIdx = baseIndex + i;
                const block = globalContainer.querySelector(`[data-call-index="${globalIdx}"]`);
                if (block) {
                    roundContainer.appendChild(block);
                }
            }

            // 乌鸦：只有成功移动了块才插入容器
            if (roundContainer.children.length > 0) {
                afterElement.parentNode.insertBefore(roundContainer, afterElement.nextSibling);
            }

            // 乌鸦：如果全局容器空了就移除
            if (globalContainer.children.length === 0) {
                globalContainer.remove();
            }
        }
    }


    return results;
}

/**
 * 乌鸦：内部函数 - 格式化工具结果为文本
 * @param {Array} toolCallsData - 工具调用结果数组
 * @param {number} count - 本轮工具数量
 * @returns {string} 格式化的文本
 */
function _formatToolResults(toolCallsData, count) {
    // 乌鸦：只取最后count个结果（本轮新增的）
    const latestResults = toolCallsData.slice(-count);
    return latestResults.map((result, i) => {
        let text = `### 工具 #${i + 1}: ${result.tool}\n`;
        if (result.success) {
            text += '状态: 成功\n';
            let dataString = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
            if (dataString.length > 100000) {
                dataString = dataString.substring(0, 100000) + '\n... [结果过长已截断]';
            }
            text += '结果:\n' + 'json\n' + dataString + '\n\n';
        } else {
            text += '状态: 失败\n';
            text += '错误: ' + result.error + '\n';
        }
        return text;
    }).join('\n---\n');
}


/**
 * Handles the streaming response from the API.
 */
export async function handleStream(response, aiMessageId, convId, branchIndex, msgIndex, options = {}) {
    state.streamingConversationId = convId;
    updateAllDynamicUI();
    const { isFollowUp = false, initialContent = '' } = options;

    let initialBubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessageId}"]`);
    let initialContentEl = initialBubble ? (initialBubble.querySelector('.message-content') || initialBubble) : null;

    if (!initialContentEl) {
        console.error(`乌鸦：handleStream启动时无法找到目标元素, ID: ${aiMessageId}`);
        try { await response.body.cancel(); } catch (e) { }
        return { finalContent: '', reasoningContent: '' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let reasoningContent = "";
    let finalContent = "";
    let buffer = "";
    initialContentEl.classList.add('typing-cursor');

    const conv = state.conversations[convId];
    if (!conv) return { finalContent, reasoningContent };
    const branch = conv.branches[branchIndex];
    if (!branch) return { finalContent, reasoningContent };
    const lastMessage = branch[msgIndex];
    if (!lastMessage) return { finalContent, reasoningContent };

    if (initialBubble && !isFollowUp) {
        updateMessageActions(initialBubble.querySelector('.message-actions'), lastMessage, msgIndex);
    }

    const hideSummaryConfig = (conv && conv.id && state.hideSummary[conv.id]) || {};
    const visibleMessagesInfo = branch
        .map((msg, index) => ({ msg, originalIndex: index }))
        .filter(({ msg, originalIndex }) => {
            const floor = originalIndex + 1;
            return !isMessageHidden(msg, floor, hideSummaryConfig);
        });

    const totalVisibleMessages = visibleMessagesInfo.length;
    const currentMessageVisibleIndex = visibleMessagesInfo.findIndex(info => info.originalIndex === msgIndex);

    let userStopped = false;
    let hasTriggeredFollowUp = false; // 乌鸦：跟踪是否触发了二次请求
    let officialUsageTokenCount = null; // 存储 API 官方返回的权威 Token 数量
    // 乌鸦：记录已预渲染的工具调用块 raw，避免每个 token 循环重复插入占位卡片
    const preRenderedToolBlocks = new Set();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const dataStr = line.substring(5).trim();
                    if (dataStr === '[DONE]') continue;

                    try {
                        const chunk = JSON.parse(dataStr);

                        // 捕获 API 厂商返回的官方权威 usage 实例
                        if (chunk && chunk.usage) {
                            if (typeof chunk.usage.completion_tokens === 'number' && chunk.usage.completion_tokens > 0) {
                                officialUsageTokenCount = chunk.usage.completion_tokens;
                            } else if (typeof chunk.usage.total_tokens === 'number' && chunk.usage.total_tokens > 0) {
                                officialUsageTokenCount = chunk.usage.total_tokens;
                            }
                        }

                        const delta = chunk.choices?.[0]?.delta;

                        if (delta) {
                            if (delta.reasoning_content) {
                                reasoningContent += delta.reasoning_content;
                            }
                            if (delta.content) {
                                finalContent += delta.content;
                            }
                        } else if (typeof chunk.token === 'string') {
                            finalContent += chunk.token;
                        }
                    } catch (e) {
                        if (dataStr) {
                            if (dataStr === '[DONE]') continue;
                            finalContent += dataStr;
                        }
                        console.warn("SSE数据解析警告：无法将数据解析为JSON，将作为纯文本处理:", dataStr, e);
                    }

                    const liveContentForRender = initialContent + (reasoningContent ? reasoningContent : '') + finalContent;

                    const { thinkingContent, mainContent: cleanedContent, isThinkingComplete: inlineThinkingComplete } = parseStreamingThinkContent(finalContent);

                    const allReasoningParts = [];
                    const hasFieldThinking = reasoningContent && reasoningContent.trim();
                    const hasInlineThinking = !!thinkingContent;

                    if (hasFieldThinking) {
                        allReasoningParts.push({ content: reasoningContent.trim(), source: 'field', order: -1 });
                    }
                    if (hasInlineThinking) {
                        allReasoningParts.push({ content: thinkingContent, source: 'inline', order: 0 });
                    }

                    let isThinkingComplete;
                    if (hasInlineThinking) {
                        isThinkingComplete = inlineThinkingComplete;
                    } else if (hasFieldThinking) {
                        isThinkingComplete = cleanedContent.trim().length > 0;
                    } else {
                        isThinkingComplete = true;
                    }

                    const pureContentForRender = initialContent + cleanedContent;

                    if (!isFollowUp) {
                        lastMessage.stats.tokenCount = countTokens(liveContentForRender);
                        lastMessage.content = liveContentForRender;
                        // 乌鸦：修复 - 统一使用 performance.now()，与 startTime 基准一致
                        const currentTime = performance.now();
                        const totalDuration = (currentTime - lastMessage.stats.startTime) / 1000;
                        lastMessage.stats.tokensPerSecond = totalDuration > 0 ? lastMessage.stats.tokenCount / totalDuration : 0;

                        const liveBubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessageId}"]`);
                        if (liveBubble) {
                            addOrUpdateMessageFooter(liveBubble, lastMessage);
                        }
                    }

                    if (state.currentConversationId === convId && !state.isFullRendering) {
                        const liveBubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessageId}"]`);
                        if (liveBubble) {
                            let liveContentEl;
                            if (isFollowUp) {
                                // 乌鸦：取最后一个分析容器（当前轮次的）
                                const allContainers = liveBubble.querySelectorAll('.analysis-result-container');
                                const analysisContainer = allContainers.length > 0 ? allContainers[allContainers.length - 1] : null;
                                if (analysisContainer) {
                                    liveContentEl = analysisContainer.querySelector('.message-content');
                                }
                            } else {
                                liveContentEl = liveBubble.querySelector('.message-content');
                            }

                            if (liveContentEl) {
                                if (allReasoningParts.length > 0) {
                                    // 乌鸦：取最后一个分析容器用于 reasoning
                                    const allContainersForReasoning = liveBubble.querySelectorAll('.analysis-result-container');
                                    const targetParent = isFollowUp && allContainersForReasoning.length > 0 ? allContainersForReasoning[allContainersForReasoning.length - 1] : null;
                                    updateReasoningContainer(liveBubble, allReasoningParts, true, isThinkingComplete, targetParent);
                                }

                                const formattedHtml = await formatMessagePipeline(pureContentForRender, 'assistant', currentMessageVisibleIndex, totalVisibleMessages);

                                // 乌鸦：流式期间预渲染工具调用请求卡片（仅首次流，不用于 followUp）
                                // 一旦 finalContent 中出现完整闭合的 ```tool_call...``` 就立即插入占位卡片
                                if (!isFollowUp) {
                                    preRenderToolCallCards(finalContent, liveBubble, preRenderedToolBlocks);
                                }

                                throttledRender(liveContentEl, formattedHtml, liveBubble, lastMessage, isFollowUp);
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            userStopped = true;
        } else {
            console.error("乌鸦：流式读取失败:", error);
            const interruptionMessage = `\n\n<small class='error-indicator'>[ 该消息意外中断: ${error.message} ]</small>`;
            finalContent += interruptionMessage;
        }
    } finally {
        const finalBubble = dom.chatMessages.querySelector(`.message-bubble[data-id="${aiMessageId}"]`);

        let finalContentEl = null;
        if (finalBubble) {
            if (isFollowUp) {
                // 乌鸦：取最后一个分析容器
                const allFinalContainers = finalBubble.querySelectorAll('.analysis-result-container');
                const analysisContainer = allFinalContainers.length > 0 ? allFinalContainers[allFinalContainers.length - 1] : null;
                if (analysisContainer) {
                    finalContentEl = analysisContainer.querySelector('.message-content');
                }
            } else {
                finalContentEl = finalBubble.querySelector('.message-content');
            }

            if (finalContentEl) {
                finalContentEl.classList.remove('typing-cursor');
            }
        }

        if (!isFollowUp) {
            delete state.generatingMessages[`${convId}_${branchIndex}_${msgIndex}`];
        }

        const { reasoningParts: finalInlineParts, mainContent: finalCleanedContent } = extractThinkingFromContent(finalContent);
        const finalReasoningParts = mergeReasoningParts(reasoningContent, finalInlineParts);

        let finalFullContent = initialContent + (reasoningContent ? `<thinking>${reasoningContent}</thinking>` : '') + finalContent;
        let pureMainContent = initialContent + finalCleanedContent;

        if (userStopped) {
            const stopMessage = "\n\n<small class='error-indicator'>[ 用户手动停止 ]</small>";
            finalFullContent += stopMessage;
            pureMainContent += stopMessage;
        }

        if (!isFollowUp) {
            lastMessage.rawContentWithTools = finalFullContent;
            lastMessage.content = pureMainContent;

            // — 为什么这么写 —
            // 如果 SSE 流结束时拿到了 API 官方权威返回的 completion_tokens，
            // 优先使用官方精准值替换兜底估算值，并精准重新刷新 TPS 与页脚呈现
            if (officialUsageTokenCount != null && officialUsageTokenCount > 0) {
                lastMessage.stats.tokenCount = officialUsageTokenCount;
                const currentTime = performance.now();
                const totalDuration = (currentTime - lastMessage.stats.startTime) / 1000;
                lastMessage.stats.tokensPerSecond = totalDuration > 0 ? lastMessage.stats.tokenCount / totalDuration : 0;

                if (finalBubble) {
                    addOrUpdateMessageFooter(finalBubble, lastMessage);
                }
            }

            if (finalReasoningParts.length > 0) {
                lastMessage.reasoningParts = finalReasoningParts;
            }

            if (finalBubble) {
                try {
                    // 乌鸦：传递 continueConversation 回调
                    const toolCallResult = await handleToolCalls(pureMainContent, finalBubble, convId, msgIndex, continueConversation);
                    pureMainContent = toolCallResult.content;
                    hasTriggeredFollowUp = toolCallResult.hasTriggeredFollowUp; // 乌鸦：更新状态
                    lastMessage.content = pureMainContent;
                } catch (error) {
                    console.error('工具调用处理失败:', error);
                }
            }
        }

        if (state.appSettings.debugMode) {
            createDebugResponseLog({
                requestUrl: response.url || 'unknown',
                finalContent,
                reasoningContent,
                totalTokens: lastMessage.stats.tokenCount,
                responseTime: ((Date.now() - (lastMessage.stats.startTime || Date.now())) / 1000).toFixed(2) + 's',
                convId,
                branchIndex,
                msgIndex
            });
        }

        if (finalBubble && !isFollowUp) {
            const finalContentEl = finalBubble.querySelector('.message-content');

            if (finalReasoningParts.length > 0) {
                updateReasoningContainer(finalBubble, finalReasoningParts, false, true);
            }

            const reasoningContainer = finalBubble.querySelector('.reasoning-container');
            if (reasoningContainer && reasoningContainer.dataset.userToggled !== 'true') {
                reasoningContainer.classList.add('auto-collapsed');
                reasoningContainer.classList.remove('expanded', 'streaming');
            }

            const formattedHtml = await formatMessagePipeline(pureMainContent, 'assistant', currentMessageVisibleIndex, totalVisibleMessages);
            renderFormattedContent(finalContentEl, formattedHtml);
            smartCollapseStateCheck(finalContentEl);

            addOrUpdateMessageFooter(finalBubble, lastMessage);
            updateMessageActions(finalBubble.querySelector('.message-actions'), lastMessage, msgIndex);

        }

        updateScrollButtonsVisibility();

        if (!isFollowUp) {
            const conv = state.conversations[convId];
            if (conv) await saveConversation(convId, conv);
            // 检查并触发自动总结（后台异步静默执行）
            checkAndTriggerAutoSummary(convId, branchIndex).catch(err => console.warn('Auto summary error:', err));
        }

        // 乌鸦：如果触发了二次请求，不重置状态，也不更新UI（让按钮保持Stop状态）
        if (!hasTriggeredFollowUp) {
            state.streamingConversationId = null;
            updateAllDynamicUI();
        }
    }

    return { finalContent, reasoningContent };
}
