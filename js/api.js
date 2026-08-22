/**
 * @file api.js
 * @description API module entry point. Facade for API services.
 */

import { state } from './state.js?v=260823';
import { processAndFilterMessages, buildApiRequest } from './api-common.js?v=260823';

// Re-export services
export { fetchModels } from './services/model-fetcher.js?v=260823';
export { handleNonStreamResponse, handleStream, continueConversation } from './services/llm-service.js?v=260823';
export { handleToolCalls } from './services/mcp-handler.js?v=260823';

/**
 * 乌鸦：准备API请求数据
 * 在系统提示词中包含工具描述
 */
export function prepareRequest() {
    const currentConv = state.conversations[state.currentConversationId];
    if (!currentConv || !currentConv.apiEndpointId) return null;

    const activeBranch = currentConv.branches[currentConv.activeBranchIndex];

    // 使用通用函数处理和过滤消息
    const chatHistoryMessages = processAndFilterMessages(activeBranch, {
        convId: state.currentConversationId,
        activeBranch: activeBranch,
        applyMcpRules: true,
        applyHideSummary: true
    });

    // 使用通用函数构建API请求
    return buildApiRequest({
        convId: state.currentConversationId,
        messages: chatHistoryMessages,
        includeWorldBook: true, // 乌鸦：常规请求始终包含世界书
        includePersona: true, // 乌鸦：常规请求始终包含角色
        includeMcp: state.mcpSettings.enabled, // 乌鸦：常规请求根据设置决定是否包含MCP
        applyRegex: true
    });
}
