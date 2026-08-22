import { state } from './state.js?v=260820-1';
import { getSelectedToolsDescription } from './mcp-tools-selector.js?v=260820-1';
import { parseRegex, getActiveRegexRules } from './regex-engine.js?v=260820-1';
import { isFloorHiddenInConfig, isMessageHidden } from './utils.js?v=260820-1';
import { formatMemoryForApi } from './summary-manager.js?v=260820-1';

/**
 * 处理单条消息的内容，包括文本和附件
 * @param {Object} message - 原始消息对象
 * @param {number} index - 消息索引
 * @returns {Object} 处理后的消息对象
 */
export function processMessageContent(message, index) {
    let content = message.originalContent || message.content;

    // 乌鸦：根据新架构，在发送给AI前，将分析结果拼接到主内容后
    if (message.role === 'assistant' && message.analysisResult) {
        content += `\n\n${message.analysisResult}`;
    }

    // 乌鸦：处理多附件，支持图片和文本混合
    let messageContent = [];

    // 乌鸦：添加文本内容
    if (content && content.trim()) {
        messageContent.push({ type: "text", text: content });
    }

    // 乌鸦：处理附件，支持图片和文本
    if (Array.isArray(message.attachments)) {
        message.attachments.forEach(att => {
            if (att.isImage || att.type?.startsWith('image/')) {
                // 乌鸦：图片附件使用Vision API格式（移除 detail: "auto" 以兼容 Google Gemini 的 OpenAI 格式接口）
                messageContent.push({
                    type: "image_url",
                    image_url: {
                        url: att.base64 || att.content
                    }
                });
            } else {
                // 乌鸦：文本附件保持原有格式
                const textContent = `\n\n--- 附件: ${att.name} ---\n\`\`\`\n${att.content}\n\`\`\``;
                if (messageContent.length > 0 && messageContent[0].type === "text") {
                    messageContent[0].text += textContent;
                } else {
                    messageContent.push({ type: "text", text: textContent });
                }
            }
        });
    } else if (message.attachment) {
        // 乌鸦：兼容旧的单附件格式
        const textContent = `\n\n--- 附件: ${message.attachment.name} ---\n\`\`\`\n${message.attachment.content}\n\`\`\``;
        if (messageContent.length > 0 && messageContent[0].type === "text") {
            messageContent[0].text += textContent;
        } else {
            messageContent.push({ type: "text", text: textContent });
        }
    }

    // 乌鸦：根据内容类型返回不同格式
    const finalContent = messageContent.length === 1 && messageContent[0].type === "text"
        ? messageContent[0].text  // 乌鸦：纯文本消息保持原有格式
        : messageContent;         // 乌鸦：混合内容使用Vision API格式

    return { role: message.role, content: finalContent, _idx: index + 1 };
}

/**
 * 根据隐藏与总结配置过滤消息，并自适应注入 3 种模式的长期记忆
 * @param {Array} allMessages - 所有消息数组
 * @param {Object} hideSummaryConfig - 隐藏与总结配置
 * @param {Array} activeBranch - 当前活跃分支
 * @returns {Array} 过滤后的消息数组
 */
export function filterMessagesByHideSummary(allMessages, hideSummaryConfig, activeBranch) {
    const convId = state.currentConversationId;
    const hideSummaryConfigLocal = hideSummaryConfig || (state.hideSummary && state.hideSummary[convId]);

    // — 为什么这么写 —
    // 1. 过滤掉所有被标记隐藏的消息（基于每条消息自身 hidden 属性及配置）
    // 2. 若开启了记忆总结，根据当前模式 (递归 / 列表拼接 / 角色扮演双表) 动态生成 system 记忆注入到可见消息之前
    const visibleMessages = allMessages.filter(msg => {
        const originalMsg = activeBranch && activeBranch[msg._idx - 1];
        return !isMessageHidden(originalMsg, msg._idx, hideSummaryConfigLocal);
    });

    if (hideSummaryConfigLocal && hideSummaryConfigLocal.enabled) {
        const memoryContent = formatMemoryForApi(hideSummaryConfigLocal);
        if (memoryContent && memoryContent.trim()) {
            const summaryMessage = {
                role: 'system',
                content: memoryContent.trim()
            };
            return [summaryMessage, ...visibleMessages];
        }
    }

    return visibleMessages;
}

/**
 * 过滤无效的API消息（包括所有角色中内容为空的消息）
 * @param {Array} messages - 消息数组
 * @returns {Array} 过滤后的消息数组
 */
export function filterInvalidMessagesForApi(messages) {
    return messages.filter(msg => {
        // 过滤没有任何实际内容的消息，防止严格的 API 抛出 invalid_format
        if (!msg.content || 
            msg.content === '' || 
            (Array.isArray(msg.content) && msg.content.length === 0) ||
            (Array.isArray(msg.content) && msg.content.every(item => !item || (typeof item === 'string' && item.trim() === '')))) {
            console.log(`乌鸦：拦截并过滤掉空内容的 ${msg.role} 消息，防止 API 报错`);
            return false;
        }
        return true;
    });
}

/**
 * 应用消息数量限制
 * @param {Array} messages - 消息数组
 * @param {Object} hideSummaryConfig - 隐藏与总结配置
 * @returns {Array} 应用限制后的消息数组
 */
export function applyMessageLimit(messages, hideSummaryConfig) {
    const messageLimit = hideSummaryConfig?.messageLimit ?? 0;
    if (messageLimit > 0) {
        // 只保留最近的N条消息，但系统消息始终保留
        const systemMessages = messages.filter(msg => msg.role === 'system');
        const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

        // 如果非系统消息数量超过限制，则只取最近的N条
        if (nonSystemMessages.length > messageLimit) {
            return [
                ...systemMessages,
                ...nonSystemMessages.slice(-messageLimit)
            ];
        }
    }
    return messages;
}

/**
 * 组装系统消息
 * @param {Array} chatHistoryMessages - 聊天历史消息
 * @param {Object} currentConv - 当前会话
 * @param {Object} apiEndpoint - API端点
 * @param {Array} enabledWorldBookEntries - 启用的世界书条目
 * @param {boolean} includePersona - 是否包含角色
 * @param {boolean} includeMcp - 是否包含MCP工具
 * @returns {Array} 组装后的消息数组
 */
export function assembleSystemMessages(chatHistoryMessages, currentConv, apiEndpoint, enabledWorldBookEntries, includePersona, includeMcp) {
    // 乌鸦：根据 includePersona 标志决定是否获取角色提示
    const personaMessage = (includePersona && apiEndpoint.type === 'openai-compatible' && currentConv.personaId && state.personas[currentConv.personaId])
        ? { role: 'system', content: state.personas[currentConv.personaId].prompt }
        : null;

    let finalMessages = [];

    // 乌鸦：严格按照 角色 -> MCP -> 备忘录 -> 历史记录 的顺序组装

    // 1. 添加角色提示
    if (personaMessage) {
        finalMessages.push(personaMessage);
    }

    // 2. 添加MCP工具描述，作为独立消息，且在备忘录之前
    // 乌鸦：根据 includeMcp 标志决定是否添加
    if (includeMcp) {
        const toolsDescription = getSelectedToolsDescription();
        if (toolsDescription) {
            finalMessages.push({
                role: 'system',
                content: toolsDescription
            });
        }
    }

    // 2.5 乌鸦：添加选中的数据库表信息和结构
    if (currentConv.dbId && currentConv.dbSelections && currentConv.dbSelections[currentConv.dbId]) {
        const selectedTables = currentConv.dbSelections[currentConv.dbId];
        if (Array.isArray(selectedTables) && selectedTables.length > 0) {
            let contextContent = `【当前数据库上下文】\n已选数据表：${selectedTables.join(', ')}\n\n`;
            
            // 乌鸦：如果有缓存的表结构信息，也一并添加
            if (currentConv.dbTableInfos) {
                const structures = selectedTables
                    .filter(name => currentConv.dbTableInfos[name])
                    .map(name => `表名: ${name}\n表结构信息:\n${currentConv.dbTableInfos[name]}`)
                    .join('\n\n');
                
                if (structures) {
                    contextContent += `【数据表详细结构】\n${structures}\n\n`;
                }
            }

            // 乌鸦：添加硬性约束指令，防止 AI 瞎猜
            contextContent += `指令：请根据上述提供的表结构回答问题或生成 SQL。如果对任何字段的含义不明确，或者发现有任何可能影响 SQL 执行结果准确性的问题（如关联关系不明、数据类型歧义等），你必须先提出疑问，禁止直接生成可能错误的 SQL，请等待用户补充信息。`;
            
            finalMessages.push({
                role: 'system',
                content: contextContent
            });
        }
    }

    // 3. 添加备忘录 (World Book)
    if (enabledWorldBookEntries && enabledWorldBookEntries.length > 0) {
        if (state.appSettings.mergeWorldBook) {
            // 合并模式：将所有备忘录条目合并为一条系统消息
            const mergedWorldBookContent = enabledWorldBookEntries
                .map(entry => entry.content + '; ')
                .join('')
                .trim();
            if (mergedWorldBookContent) {
                finalMessages.push({ role: 'system', content: mergedWorldBookContent });
            }
        } else {
            // 非合并模式：每个条目都是一条单独的消息
            const worldBookMessages = enabledWorldBookEntries.map(entry => ({
                role: entry.role,
                content: entry.content
            }));
            finalMessages.push(...worldBookMessages);
        }
    }

    // 4. 添加聊天记录
    finalMessages.push(...chatHistoryMessages);

    // 5. 乌鸦：如果勾选了"合并发送"，将所有 system 消息合并为一条
    // 这样可以减少 token 开销，同时保证所有上下文（角色/MCP/数据库/备忘录/隐藏总结）
    // 统一以一条 system 消息的形式发给 AI
    if (state.appSettings.mergeWorldBook) {
        const systemContents = [];
        const nonSystemMessages = [];

        for (const msg of finalMessages) {
            if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim()) {
                systemContents.push(msg.content.trim());
            } else {
                nonSystemMessages.push(msg);
            }
        }

        if (systemContents.length > 0) {
            // 乌鸦：合并所有 system 内容，用分隔符连接，保持可读性
            const mergedSystemMessage = {
                role: 'system',
                content: systemContents.join('\n\n---\n\n')
            };
            return [mergedSystemMessage, ...nonSystemMessages];
        }
    }

    return finalMessages;
}

/**
 * Applies active regex rules to message content for requests.
 * @param {Array<object>} messages - The array of message objects, which are the final, visible messages.
 * @param {string} [convId] - 会话ID（默认读取当前会话）
 * @returns {Array<object>} The modified messages array.
 */
export function applyRequestRegex(messages, convId = state.currentConversationId) {
    // 乌鸦：获取针对当前会话生效的所有启用的规则
    const activeRules = getActiveRegexRules(convId);
    if (activeRules.length === 0) {
        return messages; // 如果没有启用规则，直接返回原消息数组
    }

    // 乌鸦：对所有规则进行一次排序，数字越小，优先级越高
    activeRules.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    const totalVisibleMessages = messages.length;

    // 乌鸦：遍历每一条消息，并传入其在可见消息列表中的索引
    return messages.map((message, messageIndex) => {
        // 乌鸦：确保message.content存在且为字符串，避免后续操作报错
        if (typeof message.content !== 'string') {
            return message;
        }

        let modifiedContent = message.content;
        // 乌鸦：确定当前消息需要应用的作用域，例如 'request-user' 或 'request-ai'
        const scopeToApply = `request-${message.role}`;
        // 乌鸦：计算当前消息从后往前的索引，这是楼层逻辑的核心
        const indexFromEnd = totalVisibleMessages - 1 - messageIndex;

        // 乌鸦：遍历所有已排序的规则
        for (const rule of activeRules) {
            // 乌鸦：检查规则的作用域是否匹配当前消息
            if (rule.scopes.includes(scopeToApply)) {

                // --- 乌鸦：在这里注入楼层限制检查逻辑 ---
                const minFloor = parseInt(rule.minFloor, 10) || 0;
                const maxFloor = parseInt(rule.maxFloor, 10) || 0;

                if (minFloor > 0) { // 数量限制：影响最新的 minFloor 条
                    if (indexFromEnd >= minFloor) continue; // 如果当前消息的倒序索引超出了范围，则跳过此规则
                } else if (maxFloor > 0) { // 起始点限制：从倒数 maxFloor+1 条开始
                    if (indexFromEnd < maxFloor) continue; // 如果当前消息的倒序索引未达到起始点，则跳过此规则
                }
                // --- 楼层检查逻辑结束 ---

                try {
                    // 乌鸦：使用与渲染引擎相同的智能解析器来解析正则表达式
                    const { pattern, flags } = parseRegex(rule.find);
                    const finalFlags = flags !== undefined ? flags : (rule.flags || 'g');
                    const regex = new RegExp(pattern, finalFlags);
                    // 乌鸦：执行替换
                    modifiedContent = modifiedContent.replace(regex, rule.replace);
                } catch (e) {
                    // 乌鸦：如果正则表达式有误，忽略该规则以避免整个程序崩溃
                    console.error(`乌鸦：正则表达式规则"${rule.name}"解析失败:`, e);
                }
            }
        }

        // 乌鸦：如果内容有修改，则返回新消息对象，否则返回原对象
        return modifiedContent !== message.content
            ? { ...message, content: modifiedContent }
            : message;
    });
}

/**
 * 乌鸦：获取工具描述
 * @param {string} toolName - 工具名称
 * @returns {string} 工具描述
 */
function getToolDescription(toolName) {
    if (!state.mcpSettings || !state.mcpSettings.enabled) {
        return '';
    }

    // 首先从默认工具中查找
    if (window.DEFAULT_TOOLS && window.DEFAULT_TOOLS[toolName]) {
        return window.DEFAULT_TOOLS[toolName].description || '';
    }

    // 然后从自定义工具中查找
    if (state.mcpCustomTools && state.mcpCustomTools[toolName]) {
        return state.mcpCustomTools[toolName].description || '';
    }

    return '';
}

/**
 * 乌鸦：添加MCP工具调用结果到AI消息内容中
 * @param {Array} chatHistoryMessages - 聊天历史消息数组
 * @param {Array} activeBranch - 当前活跃分支的消息数组
 * @returns {Array} 处理后的聊天历史消息数组
 */
function addMcpToolResultsToMessages(chatHistoryMessages, activeBranch) {
    // 遍历所有消息，为每条有工具调用的AI消息添加对应的工具调用结果
    for (let i = 0; i < chatHistoryMessages.length; i++) {
        const message = chatHistoryMessages[i];

        // 只处理AI消息
        if (message.role === 'assistant') {
            // 找到对应的原始消息（在activeBranch中）
            const originalMessageIndex = message._idx - 1; // _idx是从1开始的，所以减1
            const originalMessage = activeBranch[originalMessageIndex];

            // 检查原始消息是否有工具调用
            if (originalMessage && originalMessage.toolCalls && Array.isArray(originalMessage.toolCalls) && originalMessage.toolCalls.length > 0) {
                // 为这条消息的工具调用生成结果文本
                let messageToolResultsText = '';

                for (const toolCall of originalMessage.toolCalls) {
                    if (toolCall && toolCall.tool) {
                        // 获取工具描述
                        const toolDescription = getToolDescription(toolCall.tool) || '无描述';

                        // 构建工具调用结果文本，使用代码块包裹
                        messageToolResultsText += `\n\n\`\`\`tool-result\n`;
                        messageToolResultsText += `工具名称: ${toolCall.tool}\n`;
                        messageToolResultsText += `工具描述: ${toolDescription}\n`;
                        messageToolResultsText += `调用状态: ${toolCall.success ? '成功' : '失败'}\n`;

                        if (toolCall.success && toolCall.data) {
                            // 将JSON结果转换为字符串，如果超过10万字符则截断
                            let resultStr = '';
                            try {
                                resultStr = JSON.stringify(toolCall.data);
                                if (resultStr.length > 100000) {
                                    resultStr = resultStr.substring(0, 100000) + '\n\n[结果过长，已截断]';
                                }
                            } catch (e) {
                                resultStr = '无法解析的JSON结果';
                            }
                            messageToolResultsText += `返回结果:${resultStr}\n`;
                        } else if (toolCall.error) {
                            messageToolResultsText += `错误信息: ${toolCall.error}\n`;
                        }

                        messageToolResultsText += `\`\`\`\n`;
                    }
                }

                // 将工具调用结果添加到当前AI消息中
                if (messageToolResultsText) {
                    if (typeof message.content === 'string') {
                        // 纯文本消息，直接追加
                        message.content += messageToolResultsText;
                    } else if (Array.isArray(message.content)) {
                        // 多内容格式消息，添加到第一个文本内容块或创建新的文本内容块
                        const textContentIndex = message.content.findIndex(item => item.type === 'text');
                        if (textContentIndex !== -1) {
                            message.content[textContentIndex].text += messageToolResultsText;
                        } else {
                            message.content.push({ type: 'text', text: messageToolResultsText });
                        }
                    }

                    console.log(`乌鸦：已添加MCP工具调用结果到第${i+1}条AI消息中`);
                }
            }
        }
    }

    return chatHistoryMessages;
}

/**
 * 处理并过滤消息，包括消息处理、隐藏与总结区间过滤、MCP工具调用结果添加
 * @param {Array} messages - 原始消息数组
 * @param {Object} options - 配置选项
 * @param {string} options.convId - 会话ID
 * @param {Array} options.activeBranch - 当前活跃分支
 * @param {boolean} options.applyMcpRules - 是否应用MCP规则
 * @param {boolean} options.applyHideSummary - 是否应用隐藏与总结过滤
 * @param {Object} options.hideSummaryConfig - 隐藏与总结配置
 * @returns {Array} 处理后的消息数组
 */
export function processAndFilterMessages(messages, options = {}) {
    const {
        convId = state.currentConversationId,
        activeBranch,
        applyMcpRules = true,
        applyHideSummary = true,
        hideSummaryConfig
    } = options;

    // 处理所有消息内容
    const allMessages = messages.map((m, idx) => processMessageContent(m, idx));

    // 隐藏与总结区间过滤
    let processedMessages = allMessages;
    if (applyHideSummary) {
        const config = hideSummaryConfig || (state.hideSummary && state.hideSummary[convId]);
        processedMessages = filterMessagesByHideSummary(allMessages, config, activeBranch);
    }

    // 添加MCP工具调用结果到AI消息内容中
    if (applyMcpRules && state.mcpSettings && state.mcpSettings.enabled) {
        processedMessages = addMcpToolResultsToMessages(processedMessages, activeBranch);
    }

    // 移除_idx属性
    processedMessages = processedMessages.map(({_idx, ...msg}) => msg);

    // 过滤无效消息
    processedMessages = filterInvalidMessagesForApi(processedMessages);

    // 应用消息数量限制
    if (applyHideSummary) {
        const config = hideSummaryConfig || (state.hideSummary && state.hideSummary[convId]);
        processedMessages = applyMessageLimit(processedMessages, config);
    }

    return processedMessages;
}

/**
 * 获取世界书内容
 * @param {Object} options - 配置选项
 * @param {boolean} options.enabledOnly - 是否只获取启用的条目
 * @param {string} options.convId - 会话ID
 * @returns {Array} 世界书条目数组
 */
export function getWorldBookContent(options = {}) {
    const {
        enabledOnly = true,
        convId = state.currentConversationId
    } = options;

    if (enabledOnly) {
        return Object.values(state.worldBook)
            .filter(entry => {
                if (entry.enabled) return true;
                if (Array.isArray(entry.sessionIds) && entry.sessionIds.includes(convId)) return true;
                return false;
            })
            .sort((a, b) => a.depth - b.depth); // 排序必须在这里再做一次，保证万无一失！
    }

    // 返回所有世界书条目
    return Object.values(state.worldBook).filter(entry =>
        !convId || (entry.sessionIds && entry.sessionIds.includes(convId))
    );
}

/**
 * 构建API请求
 * @param {Object} options - 配置选项
 * @param {string} options.convId - 会话ID
 * @param {Array} options.messages - 消息数组
 * @param {boolean} options.includeWorldBook - 是否包含世界书
 * @param {boolean} options.includePersona - 是否包含角色
 * @param {boolean} options.includeMcp - 是否包含MCP工具
 * @param {boolean} options.applyRegex - 是否应用正则替换规则
 * @returns {Object} API请求配置
 */
export function buildApiRequest(options = {}) {
    const {
        convId = state.currentConversationId,
        messages,
        includeWorldBook = true, // 乌鸦：默认包含世界书
        includePersona = true, // 乌鸦：默认包含角色
        includeMcp = true, // 乌鸦：默认包含MCP
        applyRegex = true
    } = options;

    const currentConv = state.conversations[convId];
    if (!currentConv || !currentConv.apiEndpointId) return null;

    const apiEndpoint = state.apiEndpoints[currentConv.apiEndpointId] || window.API_PRESETS[currentConv.apiEndpointId];
    if (!apiEndpoint) return null;

    // 乌鸦：根据新的布尔标志决定是否获取世界书内容
    const enabledWorldBookEntries = includeWorldBook
        ? getWorldBookContent({enabledOnly: true, convId})
        : [];

    // 组装系统消息，传入includePersona和includeMcp标志
    const finalMessages = assembleSystemMessages(messages, currentConv, apiEndpoint, enabledWorldBookEntries, includePersona, includeMcp);

    // 处理正则替换规则
    const processedMessages = applyRegex ? applyRequestRegex(finalMessages) : finalMessages;

    // 最终检查：确保最后传递的每一条记录都是合法且有内容的
    const cleanedMessages = filterInvalidMessagesForApi(processedMessages);

    // 根据API端点类型构建请求
    if (apiEndpoint.type === 'sse') {
        if (!apiEndpoint.url) return null;

        // 获取最后的用户消息作为prompt
        const lastUserMessage = processedMessages.slice().reverse().find(m => m.role === 'user');
        const prompt = lastUserMessage ? lastUserMessage.content : "";

        // 获取数据库连接信息
        let dbConnectionString = '';
        if (currentConv.dbId && state.dbConnections && state.dbConnections[currentConv.dbId]) {
            const db = state.dbConnections[currentConv.dbId];
            dbConnectionString = `type=${db.type}~host=${db.host}~port=${db.port}~database=${db.database}~username=${db.username}~password=${db.password}`;
        }

        // 获取启用的备忘录文本
        const worldtext = enabledWorldBookEntries.map(entry => entry.content).join('\n---\n');

        // 构建请求体
        const body = {
            prompt: prompt,
            database: dbConnectionString,
            worldtext: worldtext,
            tableName: (currentConv.dbSelections && currentConv.dbSelections[currentConv.dbId]) ? currentConv.dbSelections[currentConv.dbId].join(',') : ''
        };

        return {
            url: apiEndpoint.url,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        };
    }

    if (apiEndpoint.type === 'openai-compatible') {
        if (!apiEndpoint.url) return null;

        let finalUrl = apiEndpoint.url;
        if (!finalUrl.endsWith('/chat/completions')) {
            if (finalUrl.endsWith('/')) finalUrl = finalUrl.slice(0, -1);
            finalUrl += '/chat/completions';
        }

        // 获取当前端点的参数配置（优先端点自有配置，否则 fallback 全局配置）
        const endpointParams = apiEndpoint.modelParams || state.appSettings.modelParams;

        // — 乌鸦：判断是否为 Omni 全模态模型（如美团 LongCat-Flash-Omni） —
        // Omni 模型使用完全不同的请求 Schema：
        // 1. content 必须是数组格式 [{"type":"text","text":"..."}]
        // 2. 图片使用 input_image 而非 image_url
        // 3. 参数用驼峰命名 (topP, topK)
        // 4. 需要 sessionId 和 output_modalities 字段
        if (apiEndpoint.isOmniModel) {
            const body = buildOmniRequestBody(apiEndpoint, cleanedMessages, endpointParams);

            return {
                url: finalUrl,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiEndpoint.key || 'no-key'}` },
                body: body
            };
        }

        const body = {
            model: apiEndpoint.model || 'default-model',
            messages: cleanedMessages,
            stream: endpointParams.streamMode !== undefined 
                ? !!endpointParams.streamMode 
                : (state.appSettings.streamMode !== false),
        };

        // — 为什么这么写 —
        // 当开启流式响应时，增加 stream_options: { include_usage: true }，
        // 促使支持标准的 API 服务商（OpenAI, DeepSeek, SiliconFlow, Qwen 等）在最后一个 SSE chunk 中返回官方权威的 usage Token 统计
        if (body.stream) {
            body.stream_options = { include_usage: true };
        }

        // 乌鸦：严格过滤非数字(NaN)或 null 值，防止引发严格校验的 API 报 json format error
        if (typeof endpointParams.temperature === 'number' && !isNaN(endpointParams.temperature)) {
            body.temperature = endpointParams.temperature;
        }
        
        if (typeof endpointParams.top_p === 'number' && !isNaN(endpointParams.top_p)) {
            body.top_p = endpointParams.top_p;
        }

        // 按需发送 top_k 和 min_p
        if (endpointParams.enableTopK && typeof endpointParams.top_k === 'number' && !isNaN(endpointParams.top_k)) {
            body.top_k = endpointParams.top_k;
        }
        
        if (endpointParams.enableMinP && typeof endpointParams.min_p === 'number' && !isNaN(endpointParams.min_p)) {
            body.min_p = endpointParams.min_p;
        }

        if (typeof endpointParams.max_tokens === 'number' && !isNaN(endpointParams.max_tokens) && endpointParams.max_tokens > 0) {
            body.max_tokens = endpointParams.max_tokens;
        }

        if (apiEndpoint.model && apiEndpoint.model.includes('reasoner')) {
            body.reasoning = true;
        }

        return {
            url: finalUrl,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiEndpoint.key || 'no-key'}` },
            body: body
        };
    }

    return null;
}

/**
 * 乌鸦：构建 Omni 全模态模型的请求体
 * 适配美团 LongCat-Flash-Omni 等使用非标准请求格式的模型
 * 
 * 核心差异：
 * - content 必须是数组 [{"type":"text","text":"..."}]
 * - 图片用 input_image 格式代替 image_url
 * - 参数用驼峰命名 (topP, topK)
 * - 需要 sessionId 和 output_modalities
 * 
 * @param {Object} apiEndpoint - API 端点配置
 * @param {Array} messages - 已清洗的消息数组
 * @param {Object} endpointParams - 参数配置
 * @returns {Object} Omni 格式的请求体
 */
function buildOmniRequestBody(apiEndpoint, messages, endpointParams) {
    // 转换消息的 content 格式
    const omniMessages = messages.map(msg => {
        const converted = { role: msg.role };
        
        // 乌鸦：针对美团 Omni 模型的奇葩规则：
        // Assistant 角色（以及安全起见的 System）的历史消息如果传数组格式（哪怕里面只有纯文本），
        // 也会被其后端的一刀切校验拦截并报错："Assistant message can only contain text data..."
        // 因此非 User 角色统统降级回纯文本字符串！
        if (msg.role !== 'user') {
            if (Array.isArray(msg.content)) {
                converted.content = msg.content
                    .filter(c => c.type === 'text' || !c.type)
                    .map(c => c.text || c)
                    .join('\n');
            } else {
                converted.content = String(msg.content || '');
            }
        } else {
            // 只有 User 消息允许使用 Omni 的多模态数组格式
            converted.content = convertContentToOmniFormat(msg.content);
        }
        
        return converted;
    });

    // 乌鸦：裸包策略确认可用，Omni 模型只需 model + messages + stream
    // 那些破参数 (sessionId/topP/topK/output_modalities/repetitionPenalty) 统统不传
    const body = {
        model: apiEndpoint.model || 'default-model',
        messages: omniMessages,
        stream: endpointParams.streamMode !== undefined 
            ? !!endpointParams.streamMode 
            : (state.appSettings.streamMode !== false)
    };

    return body;
}

/**
 * 乌鸦：将消息的 content 转换为 Omni 格式
 * 
 * 转换规则：
 * - 纯字符串 → [{"type":"text","text":"..."}]
 * - 数组中的 image_url → input_image（base64 或 url）
 * - 数组中的 text → 保持不变
 * 
 * @param {string|Array} content - 原始消息内容
 * @returns {Array} Omni 格式的 content 数组
 */
function convertContentToOmniFormat(content) {
    // 情况1：纯字符串，直接包装成数组
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }

    // 情况2：已经是数组（多模态内容），逐项转换
    if (Array.isArray(content)) {
        return content.map(item => {
            // 文本项保持不变
            if (item.type === 'text') {
                return item;
            }

            // 乌鸦：将 OpenAI 标准的 image_url 转换为长猫 Omni 的 input_image 格式
            // 官方文档确认：图片必须使用 input_image，data 是数组
            if (item.type === 'image_url' && item.image_url) {
                const imageUrl = item.image_url.url || '';
                
                if (imageUrl.startsWith('data:')) {
                    // base64 格式：去掉 "data:image/xxx;base64," 前缀
                    const base64Data = imageUrl.replace(/^data:image\/[^;]+;base64,/, '');
                    return {
                        type: 'input_image',
                        input_image: {
                            type: 'base64',
                            data: [base64Data]
                        }
                    };
                } else {
                    // 普通 URL
                    return {
                        type: 'input_image',
                        input_image: {
                            type: 'url',
                            data: [imageUrl]
                        }
                    };
                }
            }

            // 其他未知类型，原样返回
            return item;
        }).filter(item => {
            // 过滤掉空文本项
            if (item.type === 'text' && (!item.text || item.text.trim() === '')) return false;
            return true;
        });
    }

    // 兜底：不认识的格式，强制包装
    return [{ type: 'text', text: String(content || '') }];
}
