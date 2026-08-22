/**
 * @file mcp-core.js
 * @description MCP核心模块 - 处理工具调用的核心逻辑
 */

import { state } from './state.js?v=260823';
import { MCPToolsRegistry, RISK_LEVELS, DEFAULT_TOOLS } from './mcp-tools-registry.js?v=260823';
import { escapeHtml } from './utils.js?v=260823';

// 乌鸦：初始化工具注册表
const toolsRegistry = new MCPToolsRegistry();

/**
 * 乌鸦：同步自定义工具到注册表
 */
function syncCustomToolsToRegistry() {
    if (state.mcpCustomTools) {
        Object.values(state.mcpCustomTools).forEach(tool => {
            try {
                toolsRegistry.registerTool(tool);
            } catch (error) {
                console.warn('注册自定义工具失败:', tool.id, error);
            }
        });
    }
}

/**
 * 乌鸦：MCP工具执行器
 */
export class MCPExecutor {
    constructor() {
        // 乌鸦：移除并发控制逻辑，由mcp-session-manager.js统一管理
    }
    
    /**
     * 调用工具
     * @param {string} toolId - 工具ID
     * @param {Object} parameters - 参数
     * @param {Object} context - 上下文信息
     * @returns {Promise<Object>} 调用结果
     */
    async callTool(toolId, parameters = {}, context = {}) {
        // 乌鸦：同步自定义工具到注册表
        syncCustomToolsToRegistry();
        
        // 乌鸦：检查工具是否被用户选择
        const selectedToolIds = state.mcpSettings.selectedTools || [];
        if (!selectedToolIds.includes(toolId)) {
            throw new Error(`工具 ${toolId} 未被选择或不可用`);
        }

        // 乌鸦：拦截本地特殊工具
        if (toolId === 'db_visualizer') {
            return {
                success: true,
                tool: '数据库可视化 (Mermaid)',
                data: {
                    type: 'mermaid_visualization', // 标记类型供渲染器识别
                    code: parameters.mermaid_code
                },
                timestamp: Date.now()
            };
        }

        if (toolId === 'chart_renderer') {
            let chartOption = parameters.option;
            
            // 乌鸦：防御性编程：确保 option 是对象而不是字符串
            if (typeof chartOption === 'string') {
                try {
                    // 去除可能的 markdown 标记
                    const cleanStr = chartOption.replace(/```json\s*|```/g, '').trim();
                    chartOption = JSON.parse(cleanStr);
                } catch (e) {
                    console.warn('乌鸦：解析 ECharts option 失败，将按原样传递:', e);
                }
            }

            return {
                success: true,
                tool: '数据图表渲染 (ECharts)',
                data: {
                    type: 'echarts_visualization', // 标记类型供渲染器识别
                    option: chartOption,
                    chartType: parameters.chart_type,
                    title: parameters.title
                },
                timestamp: Date.now()
            };
        }
        
        // 乌鸦：从所有工具中查找（包括自定义工具）
        const allTools = {
            ...DEFAULT_TOOLS,
            ...(state.mcpCustomTools || {})
        };
        
        const tool = allTools[toolId] || toolsRegistry.getTool(toolId);
        if (!tool) {
            throw new Error(`工具 ${toolId} 不存在`);
        }
        
        if (!tool.enabled) {
            throw new Error(`工具 ${tool.name} 已禁用`);
        }
        
        // 乌鸦：检查并发限制
        if (this.activeCallsCount >= state.mcpSettings.maxConcurrent) {
            throw new Error(`已达到最大并发调用数限制 (${state.mcpSettings.maxConcurrent})`);
        }
        
        this.activeCallsCount++;
        
        try {
            // 1. 参数验证
            const validatedParams = this.validateParameters(tool, parameters);
            
            // 2. 风险评估和确认
            const autoConfirm = state.mcpSettings && state.mcpSettings.autoConfirm;
            
            if (!autoConfirm && tool.riskLevel !== RISK_LEVELS.READ) {
                // 乌鸦：非只读操作需要用户确认
                const confirmed = await this.showToolConfirmation(tool);
                if (!confirmed) {
                    throw new Error(`用户取消了工具 ${tool.name} 的调用`);
                }
            }
            
            // 3. 构建请求
            const request = this.buildRequest(tool, validatedParams);
            
            // 4. 执行调用
            const result = await this.executeRequest(request, tool);
            
            // 乌鸦：保存调用参数供重试和模板使用
            if (state.mcpCustomTools && state.mcpCustomTools[toolId]) {
                state.mcpCustomTools[toolId].lastCallParams = validatedParams;
            } else {
                // 乌鸦：为默认工具也保存参数，修复重试功能
                const defaultTool = DEFAULT_TOOLS[toolId];
                if (defaultTool) {
                    defaultTool.lastCallParams = validatedParams;
                }
            }
            
            // 5. 记录审计日志
            this.logToolCall(tool, validatedParams, result, context);
            
            // 乌鸦：大哥要求 - 严格判断成功条件，根据API响应的code和status判断
            let isSuccess = false;
            if (result && (result.code === 200 || result.code === '200' || result.status === 100)) {
                isSuccess = true;
            } else if (result && !result.hasOwnProperty('code') && !result.hasOwnProperty('status') && !result.error) {
                // 乌鸦：兼容没有明确状态码的响应（如部分免费API）
                isSuccess = true;
            }
            
            return {
                success: isSuccess,
                tool: tool.name,
                data: result,
                timestamp: Date.now()
            };
            
                } catch (error) {
                    // 乌鸦：记录失败日志
                    this.logToolCall(tool || { id: toolId, name: toolId }, parameters, { error: error.message }, context);
        
                    // 乌鸦：大哥要求 - 错误时也要返回JSON数据
                    let errorData = null;
                    if (error.responseData) {
                        errorData = error.responseData;
                    }
        
                    return {
                        success: false,
                        tool: tool ? tool.name : toolId, // 乌鸦：修复当工具不存在时，tool为undefined导致的异常
                        error: error.message,
                        data: errorData, // 乌鸦：传递错误响应数据
                        timestamp: Date.now()
                    };
                } finally {            this.activeCallsCount--;
        }
    }
    
    /**
     * 显示工具确认弹窗
     * @param {Object} tool - 工具配置
     * @returns {Promise<boolean>} 用户是否确认
     */
    async showToolConfirmation(tool) {
        return new Promise((resolve) => {
            // 乌鸦：创建确认弹窗
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.style.zIndex = '9999';
            
            const riskLevelText = {
                [RISK_LEVELS.READ]: '只读',
                [RISK_LEVELS.WRITE_LOW]: '低风险写入',
                [RISK_LEVELS.WRITE_HIGH]: '高风险写入',
                [RISK_LEVELS.ADMIN]: '管理员'
            };
            
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <div class="modal-header">
                        <h2>工具调用确认</h2>
                        <button class="modal-close-btn" title="关闭">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p><strong>工具名称：</strong>${escapeHtml(tool.name)}</p>
                        <p><strong>工具ID：</strong>${escapeHtml(tool.id)}</p>
                        <p><strong>风险等级：</strong>${riskLevelText[tool.riskLevel] || '未知'}</p>
                        <p><strong>描述：</strong>${escapeHtml(tool.description)}</p>
                        <p style="color: var(--warning-color); margin-top: 15px;">
                            <strong>⚠️ 警告：</strong>此操作可能会修改数据或执行敏感操作，是否继续？
                        </p>
                    </div>
                    <div class="modal-actions">
                        <button class="cancel-button" id="tool-confirm-cancel">取消</button>
                        <button id="tool-confirm-ok">确认执行</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 乌鸦：添加动画效果
            setTimeout(() => {
                modal.classList.add('visible');
            }, 10);
            
            // 乌鸦：绑定事件
            const closeBtn = modal.querySelector('.modal-close-btn');
            const cancelBtn = modal.querySelector('#tool-confirm-cancel');
            const okBtn = modal.querySelector('#tool-confirm-ok');
            
            const closeModal = (result) => {
                modal.classList.remove('visible');
                setTimeout(() => {
                    document.body.removeChild(modal);
                    resolve(result);
                }, 300);
            };
            
            closeBtn.addEventListener('click', () => closeModal(false));
            cancelBtn.addEventListener('click', () => closeModal(false));
            okBtn.addEventListener('click', () => closeModal(true));
            
            // 乌鸦：点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal(false);
                }
            });
        });
    }
    
    /**
     * 验证参数
     * @param {Object} tool - 工具配置
     * @param {Object} parameters - 输入参数
     * @returns {Object} 验证后的参数
     */
    validateParameters(tool, parameters) {
        const validated = {};
        const toolParams = tool.parameters || {};
        
        // 乌鸦：检查必需参数
        for (const [paramName, paramConfig] of Object.entries(toolParams)) {
            const value = parameters[paramName];
            
            if (paramConfig.required && (value === undefined || value === null || value === '')) {
                throw new Error(`缺少必需参数: ${paramName}`);
            }
            
            if (value !== undefined) {
                // 类型验证
                const validatedValue = this.validateParameterType(paramName, value, paramConfig);
                validated[paramName] = validatedValue;
            } else if (paramConfig.default !== undefined) {
                // 设置默认值
                validated[paramName] = paramConfig.default;
            }
        }
        
        return validated;
    }
    
    /**
     * 验证参数类型
     * @param {string} name - 参数名
     * @param {any} value - 参数值
     * @param {Object} config - 参数配置
     * @returns {any} 转换后的值
     */
    validateParameterType(name, value, config) {
        switch (config.type) {
            case 'string':
                if (typeof value !== 'string') {
                    throw new Error(`参数 ${name} 必须是字符串类型`);
                }
                if (config.enum && !config.enum.includes(value)) {
                    throw new Error(`参数 ${name} 的值必须是 ${config.enum.join(', ')} 之一`);
                }
                return value;
                
            case 'number':
                const numValue = Number(value);
                if (isNaN(numValue)) {
                    throw new Error(`参数 ${name} 必须是数字类型`);
                }
                if (config.min !== undefined && numValue < config.min) {
                    throw new Error(`参数 ${name} 不能小于 ${config.min}`);
                }
                if (config.max !== undefined && numValue > config.max) {
                    throw new Error(`参数 ${name} 不能大于 ${config.max}`);
                }
                return numValue;
                
            case 'boolean':
                return Boolean(value);
                
            default:
                return value;
        }
    }
    
    /**
     * 构建HTTP请求
     * @param {Object} tool - 工具配置
     * @param {Object} parameters - 验证后的参数
     * @returns {Object} 请求配置
     */
    buildRequest(tool, parameters) {
        let url = tool.endpoint.url;
        const headers = { ...tool.endpoint.headers };
        
        // 乌鸦：跟踪哪些参数已经在URL模板中被替换
        const replacedParams = new Set();
        
        // 乌鸦：处理URL模板 - 查找并替换所有参数占位符
        for (const [key, value] of Object.entries(parameters)) {
            const placeholder = `{${key}}`;
            // 检查URL中是否存在该参数的占位符
            if (url.includes(placeholder)) {
                // 循环替换所有匹配的占位符（可能有多个）
                while (url.includes(placeholder)) {
                    url = url.replace(placeholder, encodeURIComponent(value));
                }
                replacedParams.add(key);  // 标记该参数已被替换
            }
        }
        
        // 乌鸦：处理API密钥
        if (tool.endpoint.apiKey && tool.endpoint.apiKey !== 'demo_key') {
            if (url.includes('openweathermap')) {
                url += `${url.includes('?') ? '&' : '?'}appid=${tool.endpoint.apiKey}`;
            }
        }
        
        const request = {
            url,
            method: tool.endpoint.method || 'GET',
            headers,
            timeout: (state.mcpSettings && state.mcpSettings.timeout) || 30
        };
        
        // 乌鸦：处理GET请求的查询参数 - 只添加未在URL模板中替换的参数
        if (request.method === 'GET') {
            const urlParams = new URLSearchParams();
            for (const [key, value] of Object.entries(parameters)) {
                // 只添加未在URL模板中替换的参数
                if (!replacedParams.has(key)) {
                    urlParams.append(key, value);
                }
            }
            
            const queryString = urlParams.toString();
            if (queryString) {
                request.url += `${url.includes('?') ? '&' : '?'}${queryString}`;
            }
        } else {
            // 乌鸦：POST请求的请求体
            request.body = JSON.stringify(parameters);
        }
        
        return request;
    }
    
    /**
     * 执行HTTP请求
     * @param {Object} request - 请求配置
     * @param {Object} tool - 工具配置
     * @returns {Promise<Object>} 响应数据
     */
    async executeRequest(request, tool) {
        const localController = new AbortController();
        const timeoutId = setTimeout(() => localController.abort(), request.timeout * 1000);

        // 乌鸦：修复停止按钮在MCP调用中无效的问题
        // 监听当前会话的 abortController（按会话维度管理）
        const currentConvId = state.currentConversationId || state.streamingConversationId;
        const globalSignal = state.abortControllers[currentConvId]?.signal;
        const handleGlobalAbort = () => {
            console.log(`乌鸦：收到全局停止信号，正在中断工具 ${tool.name} 的调用。`);
            localController.abort();
        };

        if (globalSignal) {
            globalSignal.addEventListener('abort', handleGlobalAbort);
        }

        try {
            const response = await fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                signal: localController.signal // 使用本地的 signal
            });
            
            clearTimeout(timeoutId);
            
            // 乌鸦：大哥要求 - 即使响应不成功，也要返回JSON数据供显示
            const contentType = response.headers.get('content-type');
            let data = null;
            
            if (contentType && contentType.includes('application/json')) {
                try {
                    data = await response.json();
                } catch (parseError) {
                    // 乌鸦：JSON解析失败，尝试获取文本
                    const text = await response.text();
                    data = { raw: text };
                }
            } else {
                const text = await response.text();
                data = { raw: text };
            }
            
            if (!response.ok) {
                // 乌鸦：在错误中也返回数据
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.responseData = data; // 乌鸦：附加响应数据
                throw error;
            }
            
            return this.formatResponse(tool, data);
            
        } catch (error) {
            if (error.name === 'AbortError') {
                // 乌鸦：判断是超时还是用户手动停止
                if (globalSignal?.aborted) {
                    throw new Error(`用户取消了工具 ${tool.name} 的调用`);
                } else {
                    throw new Error(`请求超时 (${request.timeout}秒)`);
                }
            }
            
            // 乌鸦：保留错误中的响应数据
            if (error.responseData) {
                const enhancedError = new Error(error.message);
                enhancedError.responseData = error.responseData;
                throw enhancedError;
            }
            
            throw error;
        } finally {
            // 乌鸦：无论成功失败，都清理定时器和监听器
            clearTimeout(timeoutId);
            if (globalSignal) {
                globalSignal.removeEventListener('abort', handleGlobalAbort);
            }
        }
    }
    
    /**
     * 格式化响应数据
     * @param {Object} tool - 工具配置
     * @param {Object} data - 原始响应数据
     * @returns {Object} 格式化后的数据
     */
    formatResponse(tool, data) {
        // 乌鸦：根据不同工具类型格式化响应
        switch (tool.id) {
            case 'weather_query':
                return this.formatWeatherResponse(data);
            case 'exchange_rate':
                return this.formatExchangeRateResponse(data);
            case 'ip_location':
                return this.formatIPLocationResponse(data);
            default:
                return data;
        }
    }
    
    /**
     * 格式化天气响应
     */
    formatWeatherResponse(data) {
        // 乌鸦：wttr.in API 的响应格式
        if (data.current_condition && data.current_condition.length > 0) {
            const current = data.current_condition[0];
            const nearest = data.nearest_area && data.nearest_area[0];
            
            return {
                city: nearest?.areaName?.[0]?.value || '未知城市',
                country: nearest?.country?.[0]?.value || '',
                temperature: parseInt(current.temp_C) || 0,
                feelsLike: parseInt(current.FeelsLikeC) || 0,
                humidity: parseInt(current.humidity) || 0,
                pressure: parseInt(current.pressure) || 0,
                visibility: parseInt(current.visibility) || 0,
                windSpeed: parseFloat(current.windspeedKmph) || 0,
                windDirection: parseInt(current.winddirDegree) || 0,
                weather: {
                    main: current.weatherDesc?.[0]?.value || '',
                    description: current.weatherDesc?.[0]?.value || '',
                    icon: current.weatherCode || ''
                },
                sunrise: null, // wttr.in 不提供日出时间
                sunset: null   // wttr.in 不提供日落时间
            };
        }
        
        throw new Error('天气数据格式错误或查询失败');
    }
    
    /**
     * 格式化汇率响应
     */
    formatExchangeRateResponse(data) {
        // 乌鸦：fxratesapi.com API 的响应格式
        if (data.success === false) {
            throw new Error(data.error?.info || '汇率数据获取失败');
        }
        
        if (!data.rates) {
            throw new Error('汇率数据获取失败');
        }
        
        return {
            base: data.base,
            date: data.date,
            rates: data.rates
        };
    }
    
    /**
     * 格式化IP位置响应
     */
    formatIPLocationResponse(data) {
        // 乌鸦：ipapi.co API 的响应格式
        if (data.error) {
            throw new Error(data.reason || 'IP位置查询失败');
        }
        
        return {
            ip: data.ip,
            country: data.country_name,
            countryCode: data.country_code,
            region: data.region,
            regionName: data.region, // ipapi.co 不区分region和regionName
            city: data.city,
            zip: data.postal,
            lat: data.latitude,
            lon: data.longitude,
            timezone: data.timezone,
            isp: data.org,
            org: data.org
        };
    }
    
    /**
     * 记录工具调用日志
     * @param {Object} tool - 工具配置
     * @param {Object} parameters - 参数
     * @param {Object} result - 结果
     * @param {Object} context - 上下文
     */
    logToolCall(tool, parameters, result, context) {
        const logEntry = {
            id: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            toolId: tool.id,
            toolName: tool.name,
            parameters,
            result: result.error ? { error: result.error } : { success: true },
            context: {
                conversationId: context.conversationId,
                messageId: context.messageId,
                userId: 'local_user'
            }
        };
        
        // 乌鸦：这里应该保存到IndexedDB，暂时先输出到控制台
        if (state.appSettings.debugMode) {
            console.log('MCP工具调用记录:', logEntry);
        }
    }
}

// 乌鸦：全局MCP执行器实例
export const mcpExecutor = new MCPExecutor();


/**
 * 从AI回复中解析工具调用
 * @param {string} content - AI回复内容
 * @returns {Array} 工具调用列表
 */
export function parseToolCalls(content) {
    const toolCalls = [];
    const regex = /```tool_call\s*\n([\s\S]*?)\n```/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            
            // 乌鸦：支持数组格式的多工具调用（DeepSeek等模型的习惯）
            if (Array.isArray(parsed)) {
                parsed.forEach(item => {
                    if (item.tool && item.parameters) {
                        toolCalls.push({
                            tool: item.tool,
                            parameters: item.parameters,
                            process_result: item.process_result || false,
                            raw: match[0] // 多个工具共享同一个 raw 代码块
                        });
                    }
                });
            } else if (parsed.tool && parsed.parameters) {
                // 原有逻辑：单个对象
                toolCalls.push({
                    tool: parsed.tool,
                    parameters: parsed.parameters,
                    process_result: parsed.process_result || false,
                    raw: match[0]
                });
            }
        } catch (error) {
            console.warn('解析工具调用失败:', error, match[1]);
        }
    }
    
    return toolCalls;
}