/**
 * @file mcp-handler.js
 * @description Handles MCP tool calls and execution logic.
 */

import { state } from '../state.js?v=260823';
import { dom } from '../dom.js?v=260823';
import { scrollManager } from '../scroll-manager.js?v=260823';
import { mcpSessionManager } from '../mcp-session-manager.js?v=260823';
import { mcpExecutor, parseToolCalls } from '../mcp-core.js?v=260823';
import { renderToolCallResult, showToolCallLoading } from '../mcp-renderer.js?v=260823';
import { regexPatterns as regex } from '../regex.js?v=260823';
import { escapeHtml } from '../utils.js?v=260823';

/**
 * 乌鸦：处理AI回复中的工具调用
 * @param {string} content - AI回复的内容
 * @param {HTMLElement} messageElement - 消息DOM元素
 * @param {string} convId - 会话ID
 * @param {number} msgIndex - 消息索引
 * @param {Function} continueConversationCallback - 回调函数，用于触发二次对话
 * @returns {Promise<{content: string, hasTriggeredFollowUp: boolean}>} 处理后的内容和是否触发了二次对话
 */
export async function handleToolCalls(content, messageElement, convId, msgIndex, continueConversationCallback) {
    if (!state.mcpSettings.enabled) {
        return { content, hasTriggeredFollowUp: false };
    }

    const currentConv = state.conversations[convId];
    if (!currentConv) return { content, hasTriggeredFollowUp: false };
    const activeBranch = currentConv.branches[currentConv.activeBranchIndex];
    if (!activeBranch || !activeBranch[msgIndex]) return { content, hasTriggeredFollowUp: false };

    const sanitizedContent = content.replace(regex.thinkTag, '');

    const toolCalls = parseToolCalls(sanitizedContent);
    if (toolCalls.length === 0) {
        return { content, hasTriggeredFollowUp: false };
    }

    const initialContent = content;

    scrollManager.saveCurrentScrollState(`handle_tools_${convId}_${msgIndex}`);

    const requestConfigs = toolCalls.map((toolCall, i) => ({
        conversationId: convId,
        messageIndex: msgIndex,
        toolCallIndex: i,
        toolId: toolCall.tool,
        parameters: toolCall.parameters,
        messageElement: messageElement,
        priority: 'normal'
    }));

    try {
        const results = await mcpSessionManager.executeBatch(requestConfigs);

        if (!activeBranch[msgIndex].toolCalls) {
            activeBranch[msgIndex].toolCalls = [];
        }

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const toolCall = toolCalls[i];
            if (result.status === 'fulfilled' && result.value) {
                activeBranch[msgIndex].toolCalls[i] = result.value;
            } else {
                activeBranch[msgIndex].toolCalls[i] = {
                    success: false,
                    tool: toolCall.tool,
                    error: result.reason?.message || '未知错误',
                    timestamp: Date.now()
                };
            }

            import('../mcp-renderer.js?v=260823').then(({ renderToolCallResult }) => {
                renderToolCallResult(messageElement, activeBranch[msgIndex].toolCalls[i], i, false);
            }).catch(err => console.error("渲染工具结果失败:", err));
        }

        const shouldFollowUp = toolCalls.some(tc => tc.process_result);

        if (shouldFollowUp) {
            let allFollowUpToolsFailed = true;
            for (let i = 0; i < toolCalls.length; i++) {
                if (toolCalls[i].process_result) {
                    const result = results[i];
                    if (result && result.status === 'fulfilled' && result.value.success) {
                        allFollowUpToolsFailed = false;
                        break;
                    }
                }
            }

            if (allFollowUpToolsFailed) {
                console.log("乌鸦：所有要求二次分析的工具都调用失败，已取消二次分析。");
                return { content: initialContent.trim(), hasTriggeredFollowUp: false };
            }

            console.log("乌鸦：检测到 process_result: true，准备二次请求。");

            let toolResultsText = activeBranch[msgIndex].toolCalls.map((result, i) => {
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

            if (typeof continueConversationCallback === 'function') {
                // 乌鸦：不需要await，异步执行
                continueConversationCallback(
                    messageElement,
                    toolResultsText,
                    convId,
                    currentConv.activeBranchIndex,
                    msgIndex
                );
                // 乌鸦：返回 true 表示触发了二次请求
                return { content: initialContent.trim(), hasTriggeredFollowUp: true };
            }

            return { content: initialContent.trim(), hasTriggeredFollowUp: false };
        }

    } catch (error) {
        console.error('乌鸦：批量MCP执行失败:', error);
        // 兼容性处理暂不返回 hasTriggeredFollowUp，因为它也是同步的
        const legacyContent = await handleToolCallsLegacy(content, messageElement, convId, msgIndex);
        return { content: legacyContent, hasTriggeredFollowUp: false };
    } finally {
        setTimeout(() => {
            scrollManager.restoreScrollState(`handle_tools_${convId}_${msgIndex}`, {
                respectUserIntention: true
            });
        }, 300);
    }

    return { content: initialContent.trim(), hasTriggeredFollowUp: false };
}

/**
 * 乌鸦：兼容性的单个MCP处理函数（降级使用）
 */
async function handleToolCallsLegacy(content, messageElement, convId, msgIndex) {
    const currentConv = state.conversations[convId];
    const activeBranch = currentConv.branches[currentConv.activeBranchIndex];
    const toolCalls = parseToolCalls(content);
    let processedContent = content;

    for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];

        try {
            const toolBlock = showToolCallLoading(messageElement, toolCall.tool, i);

            if (!toolBlock) {
                console.error(`乌鸦：无法创建工具加载块 ${i}`);
                processedContent = processedContent.replace(toolCall.raw, '');
                continue;
            }

            const mcpId = `legacy_${convId}_${msgIndex}_${i}`;
            scrollManager.onMCPStart(mcpId);

            const result = await mcpExecutor.callTool(
                toolCall.tool,
                toolCall.parameters,
                {
                    conversationId: convId,
                    messageId: msgIndex,
                    toolCallIndex: i
                }
            );

            scrollManager.onMCPEnd(mcpId, result);

            const newToolBlock = renderToolCallResult(messageElement, result, i, true);
            if (toolBlock && toolBlock.parentNode && newToolBlock) {
                try {
                    toolBlock.parentNode.replaceChild(newToolBlock, toolBlock);
                    console.log(`乌鸦：成功替换工具调用块 ${i}`);
                } catch (error) {
                    console.error(`乌鸦：DOM替换失败，尝试保底方案:`, error);
                    if (newToolBlock.innerHTML && newToolBlock.className) {
                        toolBlock.innerHTML = newToolBlock.innerHTML;
                        toolBlock.className = newToolBlock.className;
                        console.log(`乌鸦：保底方案成功 - 已更新工具调用结果`);
                    }
                }
            }

            if (!activeBranch[msgIndex].toolCalls) {
                activeBranch[msgIndex].toolCalls = [];
            }
            activeBranch[msgIndex].toolCalls[i] = result;

            processedContent = processedContent.replace(toolCall.raw, '');

            if (result.success) {
                const summary = generateToolResultSummary(result);
                if (summary) {
                    processedContent += `\n\n${summary}`;
                }
            }

        } catch (error) {
            console.error('工具调用失败:', error);

            const errorResult = {
                success: false,
                tool: toolCall.tool,
                error: error.message,
                timestamp: Date.now()
            };

            renderToolCallResult(messageElement, errorResult, i, true);
            processedContent = processedContent.replace(toolCall.raw, '');
        }
    }

    return processedContent.trim();
}

/**
 * 乌鸦：生成工具调用结果的文字总结
 */
function generateToolResultSummary(result) {
    if (!result.success || !result.data) {
        return '';
    }

    try {
        switch (result.tool) {
            case '天气查询':
                if (result.data.city && result.data.temperature !== undefined) {
                    return `根据查询，${result.data.city}当前温度为${result.data.temperature}°C，${result.data.weather?.description || ''}。`;
                }
                break;

            case '汇率查询':
                if (result.data.base && result.data.rates) {
                    const rateCount = Object.keys(result.data.rates).length;
                    return `已获取${result.data.base}基准的${rateCount}种货币汇率信息。`;
                }
                break;

            case 'IP位置查询':
                if (result.data.country && result.data.city) {
                    return `IP ${result.data.ip} 位于${result.data.country} ${result.data.city}。`;
                }
                break;

            default:
                return `${result.tool}调用成功，已获取相关数据。`;
        }
    } catch (error) {
        console.warn('生成工具结果总结失败:', error);
    }

    return '';
}

/**
 * 乌鸦：获取工具描述
 */
function getToolDescription(toolName) {
    if (!state.mcpSettings || !state.mcpSettings.enabled) {
        return '';
    }
    if (window.DEFAULT_TOOLS && window.DEFAULT_TOOLS[toolName]) {
        return window.DEFAULT_TOOLS[toolName].description || '';
    }
    if (state.mcpCustomTools && state.mcpCustomTools[toolName]) {
        return state.mcpCustomTools[toolName].description || '';
    }
    return '';
}

/**
 * 乌鸦：流式输出期间预渲染已完整闭合的工具调用请求卡片
 * 在 handleStream 的 throttledRender 前调用，实现"块一闭合立刻展示"的效果
 *
 * @param {string} content - 当前已接收的 finalContent
 * @param {HTMLElement} messageElement - 消息 DOM 元素（message-bubble）
 * @param {Set<string>} renderedSet - 已预渲染过的 raw 块 Set，避免重复创建
 */
export function preRenderToolCallCards(content, messageElement, renderedSet) {
    // 乌鸦：MCP 未启用时直接跳过
    if (!state.mcpSettings?.enabled) return;
    if (!messageElement) return;

    // 乌鸦：正则匹配完整的 ```tool_call ... ``` 块（和 parseToolCalls 保持一致）
    const regex = /```tool_call\s*\n([\s\S]*?)\n```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const rawBlock = match[0];

        // 乌鸦：已经渲染过的跳过，避免重复插入
        if (renderedSet.has(rawBlock)) continue;

        let toolName = '';
        try {
            const parsed = JSON.parse(match[1].trim());
            // 乌鸦：兼容数组格式（DeepSeek 等）和单对象格式
            const firstCall = Array.isArray(parsed) ? parsed[0] : parsed;
            if (!firstCall?.tool) continue;
            toolName = firstCall.tool;
        } catch (e) {
            // 乌鸦：JSON 解析失败说明块还不完整，跳过
            continue;
        }

        // 乌鸦：找到消息内容容器（tool-calls-container 挂载点）
        const contentEl = messageElement.querySelector('.message-content');
        if (!contentEl) continue;

        // 乌鸦：找或创建全局 tool-calls-container
        let container = messageElement.querySelector('.tool-calls-container:not([data-round])');
        if (!container) {
            container = document.createElement('div');
            container.className = 'tool-calls-container';
            // 乌鸦：插入到 message-content 之后（在气泡内部最下方）
            const insertAfter = messageElement.querySelector('.message-content');
            if (insertAfter && insertAfter.parentNode) {
                insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);
            } else {
                messageElement.appendChild(container);
            }
        }

        // 乌鸦：查找当前工具在已有预渲染卡片中的序号
        const existingCards = container.querySelectorAll('[data-pre-render="true"]');
        const callIndex = existingCards.length;

        // 乌鸦：构建请求预览卡片（纯展示，不执行调用）
        const card = document.createElement('div');
        card.className = 'tool-call-block';
        card.setAttribute('data-pre-render', 'true');
        card.setAttribute('data-tool-name', toolName);
        card.setAttribute('data-call-index', callIndex);
        card.innerHTML = `
            <div class="tool-call-header calling">
                <span class="tool-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></span>
                <span class="tool-call-request-title">工具调用请求</span>
                <span class="tool-name">${escapeHtml(toolName)}</span>
                <span class="tool-status calling">等待执行...</span>
            </div>
        `;
        container.appendChild(card);

        // 乌鸦：标记为已渲染，防止下次 token 更新时重复插入
        renderedSet.add(rawBlock);
        console.log(`乌鸦：[预渲染] 工具请求卡片已提前插入: ${toolName}`);
    }
}

