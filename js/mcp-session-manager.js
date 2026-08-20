/**
 * @file mcp-session-manager.js
 * @description 多MCP请求会话管理模块 - 处理一个会话中的多个MCP请求并发和状态管理
 * @author 乌鸦
 */

import { state } from './state.js?v=260820-1';
import { mcpExecutor } from './mcp-core.js?v=260820-1';
import { scrollManager } from './scroll-manager.js?v=260820-1';
import { renderToolCallResult, showToolCallLoading, updateToolCallStatus } from './mcp-renderer.js?v=260820-1';

/**
 * 乌鸦：MCP会话管理器 - 处理多个MCP请求的并发执行和状态管理
 */
class MCPSessionManager {
    constructor() {
        // 乌鸦：会话级别的MCP请求管理
        this.sessions = new Map(); // conversationId -> sessionData
        this.globalRequestCounter = 0; // 全局请求计数器
        
        // 乌鸦：从state.js中读取并发控制配置
        this.maxConcurrentPerSession = state.mcpSettings.maxConcurrentPerSession || 5; // 每个会话最大并发数
        this.maxGlobalConcurrent = state.mcpSettings.maxGlobalConcurrent || 8; // 全局最大并发数
        
        this.requestTimeouts = new Map(); // 请求超时管理
        
        // 乌鸦：请求队列管理
        this.pendingRequests = new Map(); // 等待执行的请求队列
        this.activeRequests = new Map(); // 正在执行的请求
        this.completedRequests = new Map(); // 已完成的请求
        
        // 乌鸦：工具链支持预备（为未来工具链功能做准备）
        this.toolChainExecutions = new Map(); // 工具链执行状态
        
        // 乌鸦：大哥要求 - 会话切换支持
        this.currentConversationId = null; // 当前活跃会话
        this.conversationSwitchCallbacks = new Set(); // 会话切换回调
        
        this.init();
    }
    
    /**
     * 乌鸦：初始化会话管理器
     */
    init() {
        console.log('乌鸦：MCP会话管理器初始化完成');
        
        // 乌鸦：定期清理过期的会话数据
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60000); // 每分钟清理一次
    }

    /**
     * 乌鸦：更新会话管理器的设置
     * @param {object} settings - 包含新设置的对象
     */
    updateSettings(settings) {
        if (settings.maxConcurrentPerSession) {
            this.maxConcurrentPerSession = settings.maxConcurrentPerSession;
        }
        if (settings.maxGlobalConcurrent) {
            this.maxGlobalConcurrent = settings.maxGlobalConcurrent;
        }
        console.log(`乌鸦：MCP会话管理器设置已更新 - Session Concurrent: ${this.maxConcurrentPerSession}, Global Concurrent: ${this.maxGlobalConcurrent}`);
    }
    
    /**
     * 乌鸦：获取或创建会话数据
     * @param {string} conversationId - 会话ID
     */
    getOrCreateSession(conversationId) {
        if (!this.sessions.has(conversationId)) {
            this.sessions.set(conversationId, {
                id: conversationId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                requests: new Map(), // requestId -> requestData
                activeCount: 0,
                totalCount: 0,
                messageRequests: new Map(), // messageIndex -> requestIds[]
                statistics: {
                    totalRequests: 0,
                    successfulRequests: 0,
                    failedRequests: 0,
                    averageResponseTime: 0,
                    lastRequestTime: 0
                }
            });
        }
        
        const session = this.sessions.get(conversationId);
        session.lastActivity = Date.now();
        return session;
    }
    
    /**
     * 乌鸦：创建MCP请求
     * @param {Object} params - 请求参数
     */
    createRequest(params) {
        const {
            conversationId,
            messageIndex,
            toolCallIndex,
            toolId,
            parameters,
            messageElement,
            priority = 'normal' // 'high' | 'normal' | 'low'
        } = params;
        
        const requestId = `${conversationId}_${messageIndex}_${toolCallIndex}_${++this.globalRequestCounter}`;
        
        const request = {
            id: requestId,
            conversationId,
            messageIndex,
            toolCallIndex,
            toolId,
            parameters,
            messageElement,
            priority,
            status: 'pending', // 'pending' | 'queued' | 'executing' | 'completed' | 'failed' | 'cancelled'
            createdAt: Date.now(),
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            retryCount: 0,
            maxRetries: 2,
            timeout: (state.mcpSettings && state.mcpSettings.timeout) || 30, // 30秒超时
            dependencies: [], // 依赖的其他请求（为工具链做准备）
            metadata: {
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString()
            }
        };
        
        // 乌鸦：添加到会话
        const session = this.getOrCreateSession(conversationId);
        session.requests.set(requestId, request);
        session.totalCount++;
        session.statistics.totalRequests++;
        
        // 乌鸦：按消息分组
        if (!session.messageRequests.has(messageIndex)) {
            session.messageRequests.set(messageIndex, []);
        }
        session.messageRequests.get(messageIndex).push(requestId);
        
        // 乌鸦：添加到全局队列
        this.pendingRequests.set(requestId, request);
        
        console.log(`乌鸦：创建MCP请求 [${requestId}]，工具: ${toolId}`);
        
        return requestId;
    }
    
    /**
     * 乌鸦：执行MCP请求
     * @param {string} requestId - 请求ID
     */
    async executeRequest(requestId) {
        const request = this.pendingRequests.get(requestId) || 
                       this.activeRequests.get(requestId);
        
        if (!request) {
            console.error(`乌鸦：未找到请求 [${requestId}]`);
            return null;
        }
        
        // 乌鸦：检查并发限制
        if (!this.canExecuteRequest(request)) {
            console.log(`乌鸦：请求 [${requestId}] 等待中，达到并发限制`);
            request.status = 'queued';
            return null;
        }
        
        // 乌鸦：移动请求到执行状态
        this.pendingRequests.delete(requestId);
        this.activeRequests.set(requestId, request);
        
        const session = this.getOrCreateSession(request.conversationId);
        session.activeCount++;
        
        request.status = 'executing';
        request.startedAt = Date.now();
        
        // 乌鸦：通知滚动管理器MCP开始
        scrollManager.onMCPStart(requestId, {
            conversationId: request.conversationId,
            messageIndex: request.messageIndex,
            toolId: request.toolId
        });
        
        try {
            // 乌鸦：显示加载状态
            if (request.messageElement) {
                const toolBlock = showToolCallLoading(
                    request.messageElement, 
                    request.toolId, 
                    request.toolCallIndex
                );
                request.toolBlock = toolBlock;
            }
            
            // 乌鸦：设置超时
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`MCP请求超时 (${request.timeout}秒)`));
                }, request.timeout * 1000);
                this.requestTimeouts.set(requestId, timeoutId);
            });
            
            // 乌鸦：执行实际的MCP调用
            const resultPromise = mcpExecutor.callTool(
                request.toolId,
                request.parameters,
                {
                    conversationId: request.conversationId,
                    messageId: request.messageIndex,
                    toolCallIndex: request.toolCallIndex,
                    requestId: requestId
                }
            );
            
            // 乌鸦：竞赛执行
            const result = await Promise.race([resultPromise, timeoutPromise]);
            
            // 乌鸦：清理超时
            const timeoutId = this.requestTimeouts.get(requestId);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.requestTimeouts.delete(requestId);
            }
            
            // 乌鸦：处理成功结果
            request.status = 'completed';
            request.completedAt = Date.now();
            request.result = result;
            
            // 乌鸦：更新统计
            session.statistics.successfulRequests++;
            session.statistics.lastRequestTime = Date.now();
            
            // 乌鸦：计算平均响应时间
            const responseTime = request.completedAt - request.startedAt;
            const totalSuccessful = session.statistics.successfulRequests;
            session.statistics.averageResponseTime = 
                (session.statistics.averageResponseTime * (totalSuccessful - 1) + responseTime) / totalSuccessful;
            
            // 乌鸦：渲染结果
            if (request.messageElement) {
                const newToolBlock = renderToolCallResult(
                    request.messageElement,
                    result,
                    request.toolCallIndex,
                    true  // 乌鸦：新增参数，确保MCP块自动展开
                );
                
                // 乌鸦：安全的DOM替换
                if (request.toolBlock && request.toolBlock.parentNode && newToolBlock) {
                    try {
                        request.toolBlock.parentNode.replaceChild(newToolBlock, request.toolBlock);
                    } catch (error) {
                        console.error('乌鸦：DOM替换失败:', error);
                        // 乌鸦：保底方案
                        if (newToolBlock.innerHTML) {
                            request.toolBlock.innerHTML = newToolBlock.innerHTML;
                            request.toolBlock.className = newToolBlock.className;
                        }
                    }
                }
            }
            
            console.log(`乌鸦：MCP请求完成 [${requestId}]，耗时: ${responseTime}ms`);
            
            return result;
            
        } catch (error) {
            // 乌鸦：处理错误
            request.status = 'failed';
            request.completedAt = Date.now();
            request.error = error.message;
            
            // 乌鸦：更新统计
            session.statistics.failedRequests++;
            
            // 乌鸦：渲染错误结果
            if (request.messageElement) {
                const errorResult = {
                    success: false,
                    tool: request.toolId,
                    error: error.message,
                    timestamp: Date.now()
                };
                
                renderToolCallResult(
                    request.messageElement,
                    errorResult,
                    request.toolCallIndex,
                    true  // 乌鸦：新增参数，确保错误状态的MCP块也自动展开
                );
            }
            
            console.error(`乌鸦：MCP请求失败 [${requestId}]:`, error);
            
            // 乌鸦：检查是否需要重试
            if (request.retryCount < request.maxRetries && 
                !error.message.includes('超时') && 
                !error.message.includes('用户取消')) {
                
                request.retryCount++;
                request.status = 'pending';
                request.startedAt = null;
                request.error = null;
                
                // 乌鸦：延迟重试
                setTimeout(() => {
                    this.pendingRequests.set(requestId, request);
                    this.scheduleNextExecution();
                }, 1000 * request.retryCount); // 递增延迟
                
                console.log(`乌鸦：将重试请求 [${requestId}]，第 ${request.retryCount} 次`);
            }
            
            return null;
            
        } finally {
            // 乌鸦：清理执行状态
            this.activeRequests.delete(requestId);
            this.completedRequests.set(requestId, request);
            
            session.activeCount--;
            
            // 乌鸦：通知滚动管理器MCP结束
            scrollManager.onMCPEnd(requestId, request.result);
            
            // 乌鸦：尝试执行队列中的下一个请求
            this.scheduleNextExecution();
        }
    }
    
    /**
     * 乌鸦：检查是否可以执行请求
     * @param {Object} request - 请求对象
     */
    canExecuteRequest(request) {
        // 乌鸦：检查全局并发限制
        if (this.activeRequests.size >= this.maxGlobalConcurrent) {
            return false;
        }
        
        // 乌鸦：检查会话级并发限制
        const session = this.sessions.get(request.conversationId);
        if (session && session.activeCount >= this.maxConcurrentPerSession) {
            return false;
        }
        
        // 乌鸦：检查依赖关系（为工具链做准备）
        if (request.dependencies.length > 0) {
            const allDependenciesCompleted = request.dependencies.every(depId => {
                const depRequest = this.completedRequests.get(depId);
                return depRequest && depRequest.status === 'completed';
            });
            if (!allDependenciesCompleted) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * 乌鸦：调度下一个执行
     */
    scheduleNextExecution() {
        // 乌鸦：按优先级排序等待中的请求
        const sortedRequests = Array.from(this.pendingRequests.values())
            .sort((a, b) => {
                // 乌鸦：高优先级优先
                const priorityOrder = { high: 3, normal: 2, low: 1 };
                if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                    return priorityOrder[b.priority] - priorityOrder[a.priority];
                }
                
                // 乌鸦：相同优先级按创建时间排序
                return a.createdAt - b.createdAt;
            });
        
        // 乌鸦：尝试执行可以执行的请求
        for (const request of sortedRequests) {
            if (this.canExecuteRequest(request)) {
                // 乌鸦：异步执行，不阻塞
                this.executeRequest(request.id).catch(error => {
                    console.error(`乌鸦：请求执行异常 [${request.id}]:`, error);
                });
                
                // 乌鸦：一次只调度一个，避免并发控制失效
                break;
            }
        }
    }
    
    /**
     * 乌鸦：批量执行多个MCP请求
     * @param {Array} requestConfigs - 请求配置数组
     */
    async executeBatch(requestConfigs) {
        const requestIds = [];
        
        // 乌鸦：创建所有请求
        for (const config of requestConfigs) {
            const requestId = this.createRequest(config);
            requestIds.push(requestId);
        }
        
        // 乌鸦：触发调度
        this.scheduleNextExecution();
        
        // 乌鸦：等待所有请求完成
        const results = await Promise.allSettled(
            requestIds.map(id => this.waitForRequest(id))
        );
        
        return results.map((result, index) => ({
            requestId: requestIds[index],
            status: result.status,
            value: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason : null
        }));
    }
    
    /**
     * 乌鸦：等待请求完成
     * @param {string} requestId - 请求ID
     */
    waitForRequest(requestId) {
        return new Promise((resolve, reject) => {
            const checkStatus = () => {
                const request = this.completedRequests.get(requestId) ||
                               this.activeRequests.get(requestId) ||
                               this.pendingRequests.get(requestId);
                
                if (!request) {
                    reject(new Error(`请求 ${requestId} 不存在`));
                    return;
                }
                
                if (request.status === 'completed') {
                    resolve(request.result);
                } else if (request.status === 'failed') {
                    reject(new Error(request.error));
                } else if (request.status === 'cancelled') {
                    reject(new Error('请求已取消'));
                } else {
                    // 乌鸦：继续等待
                    setTimeout(checkStatus, 100);
                }
            };
            
            checkStatus();
        });
    }
    
    /**
     * 乌鸦：取消请求
     * @param {string} requestId - 请求ID
     */
    cancelRequest(requestId) {
        // 乌鸦：从待执行队列中移除
        const pendingRequest = this.pendingRequests.get(requestId);
        if (pendingRequest) {
            pendingRequest.status = 'cancelled';
            this.pendingRequests.delete(requestId);
            this.completedRequests.set(requestId, pendingRequest);
            console.log(`乌鸦：取消待执行请求 [${requestId}]`);
            return true;
        }
        
        // 乌鸦：正在执行的请求更难取消，但标记状态
        const activeRequest = this.activeRequests.get(requestId);
        if (activeRequest) {
            activeRequest.status = 'cancelled';
            console.log(`乌鸦：标记正在执行的请求为取消 [${requestId}]`);
            return true;
        }
        
        return false;
    }
    
    /**
     * 乌鸦：获取会话统计信息
     * @param {string} conversationId - 会话ID
     */
    getSessionStats(conversationId) {
        const session = this.sessions.get(conversationId);
        if (!session) {
            return null;
        }
        
        return {
            id: conversationId,
            totalRequests: session.statistics.totalRequests,
            successfulRequests: session.statistics.successfulRequests,
            failedRequests: session.statistics.failedRequests,
            successRate: session.statistics.totalRequests > 0 ? 
                (session.statistics.successfulRequests / session.statistics.totalRequests * 100).toFixed(1) + '%' : '0%',
            averageResponseTime: session.statistics.averageResponseTime.toFixed(0) + 'ms',
            activeRequests: session.activeCount,
            lastActivity: new Date(session.lastActivity).toLocaleString()
        };
    }
    
    /**
     * 乌鸦：获取全局统计信息
     */
    getGlobalStats() {
        const totalSessions = this.sessions.size;
        const totalActive = this.activeRequests.size;
        const totalPending = this.pendingRequests.size;
        const totalCompleted = this.completedRequests.size;
        
        return {
            totalSessions,
            totalActive,
            totalPending,
            totalCompleted,
            globalRequestCounter: this.globalRequestCounter,
            concurrentLimits: {
                perSession: this.maxConcurrentPerSession,
                global: this.maxGlobalConcurrent
            }
        };
    }
    
    /**
     * 乌鸦：清理过期的会话数据
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24小时
        
        for (const [conversationId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > maxAge && session.activeCount === 0) {
                // 乌鸦：清理相关的请求数据
                for (const requestId of session.requests.keys()) {
                    this.completedRequests.delete(requestId);
                    this.pendingRequests.delete(requestId);
                }
                
                this.sessions.delete(conversationId);
                console.log(`乌鸦：清理过期会话 [${conversationId}]`);
            }
        }
    }
    
    /**
     * 乌鸦：处理会话切换
     * @param {string} newConversationId - 新的会话 ID
     * @param {string} oldConversationId - 旧的会话 ID
     */
    onConversationSwitch(newConversationId, oldConversationId = null) {
        console.log(`乌鸦：会话切换: ${oldConversationId || 'null'} -> ${newConversationId}`);
        
        this.currentConversationId = newConversationId;
        
        // 乌鸦：通知所有回调
        this.conversationSwitchCallbacks.forEach(callback => {
            try {
                callback(newConversationId, oldConversationId);
            } catch (error) {
                console.error('乌鸦：会话切换回调失败:', error);
            }
        });
        
        // 乌鸦：延迟恢复状态，等待DOM渲染完成
        setTimeout(() => {
            this.restoreSessionState(newConversationId);
        }, 300);
    }
    
    /**
     * 乌鸦：恢复会话状态
     * @param {string} conversationId - 会话 ID
     */
    restoreSessionState(conversationId) {
        const session = this.sessions.get(conversationId);
        if (!session) {
            return;
        }
        
        console.log(`乌鸦：恢复会话 ${conversationId} 的MCP状态`);
        
        // 乌鸦：先检查消息元素是否已存在MCP UI，避免重复渲染
        const existingUIElements = new Set();
        const messageElements = document.querySelectorAll(`[data-conversation-id="${conversationId}"] .message-bubble`);
        
        messageElements.forEach(msgElement => {
            const existingBlocks = msgElement.querySelectorAll('.tool-call-block');
            existingBlocks.forEach(block => {
                const uniqueId = block.getAttribute('data-tool-unique-id');
                if (uniqueId) {
                    existingUIElements.add(uniqueId);
                }
            });
        });
        
        console.log(`乌鸦：发现已存在的MCP UI元素: ${existingUIElements.size}个`);
        
        // 乌鸦：检查正在执行的请求
        const activeSessionRequests = Array.from(this.activeRequests.values())
            .filter(req => req.conversationId === conversationId);
            
        let restoredCount = 0;
        let skippedCount = 0;
        
        if (activeSessionRequests.length > 0) {
            console.log(`乌鸦：发现 ${activeSessionRequests.length} 个正在执行的MCP请求`);
            activeSessionRequests.forEach(request => {
                const uniqueId = `${request.messageIndex}_${request.toolCallIndex}_${request.toolId}`;
                if (existingUIElements.has(uniqueId)) {
                    console.log(`乌鸦：跳过已存在的活跃请求UI ${uniqueId}`);
                    skippedCount++;
                    return;
                }
                this.restoreRequestUI(request);
                restoredCount++;
            });
        }
        
        // 乌鸦：检查已完成但未显示的结果
        const completedSessionRequests = Array.from(this.completedRequests.values())
            .filter(req => req.conversationId === conversationId &&
                          req.status === 'completed' &&
                          !req.uiRestored);
                          
        if (completedSessionRequests.length > 0) {
            console.log(`乌鸦：发现 ${completedSessionRequests.length} 个已完成但未显示的MCP结果`);
            completedSessionRequests.forEach(request => {
                const uniqueId = `${request.messageIndex}_${request.toolCallIndex}_${request.toolId}`;
                if (existingUIElements.has(uniqueId)) {
                    console.log(`乌鸦：跳过已存在的完成请求UI ${uniqueId}`);
                    skippedCount++;
                    return;
                }
                this.restoreCompletedRequestUI(request);
                restoredCount++;
            });
        }
        
        console.log(`乌鸦：会话 ${conversationId} 状态恢复完成 - 恢复: ${restoredCount}, 跳过: ${skippedCount}`);
    }
    
    /**
     * 乌鸦：恢复正在执行的请求UI
     */
    restoreRequestUI(request) {
        const messageElement = this.findMessageElement(request.conversationId, request.messageIndex);
        if (!messageElement) {
            console.warn(`乌鸦：无法定位消息元素 [${request.id}]`);
            return;
        }
        
        request.messageElement = messageElement;
        
        try {
            const toolBlock = showToolCallLoading(
                request.messageElement,
                request.toolId,
                request.toolCallIndex
            );
            request.toolBlock = toolBlock;
            console.log(`乌鸦：恢复加载状态成功 [${request.id}]`);
        } catch (error) {
            console.error(`乌鸦：恢复加载状态失败 [${request.id}]:`, error);
        }
    }
    
    /**
     * 乌鸦：恢复已完成的请求UI
     */
    restoreCompletedRequestUI(request) {
        const messageElement = this.findMessageElement(request.conversationId, request.messageIndex);
        if (!messageElement) {
            console.warn(`乌鸦：无法定位消息元素进行结果恢复 [${request.id}]`);
            return;
        }
        
        request.messageElement = messageElement;
        
        try {
            renderToolCallResult(
                request.messageElement,
                request.result,
                request.toolCallIndex,
                true  // 乌鸦：新增参数，确保恢复的MCP块自动展开
            );
            
            request.uiRestored = true;
            console.log(`乌鸦：恢复完成结果成功 [${request.id}]`);
        } catch (error) {
            console.error(`乌鸦：恢复完成结果失败 [${request.id}]:`, error);
        }
    }
    
    /**
     * 乌鸦：查找消息元素
     */
    findMessageElement(conversationId, messageIndex) {
        const messageBubbles = document.querySelectorAll('.message-bubble');
        for (const bubble of messageBubbles) {
            const bubbleIndex = parseInt(bubble.dataset.index, 10);
            if (bubbleIndex === messageIndex) {
                return bubble;
            }
        }
        return null;
    }
    
    /**
     * 乌鸦：添加会话切换回调
     */
    addConversationSwitchCallback(callback) {
        this.conversationSwitchCallbacks.add(callback);
    }
    
    /**
     * 乌鸦：为工具链功能预留的方法
     */
    createToolChain(chainConfig) {
        // 乌鸦：未来实现工具链功能
        console.log('乌鸦：工具链功能待实现', chainConfig);
    }
}

// 乌鸦：导出单例实例
export const mcpSessionManager = new MCPSessionManager();

/**
 * 乌鸦：便捷方法导出
 */
export const {
    createRequest,
    executeRequest,
    executeBatch,
    cancelRequest,
    getSessionStats,
    getGlobalStats
} = mcpSessionManager;