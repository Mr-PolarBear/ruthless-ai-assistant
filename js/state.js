/**
 * @file state.js
 * @description Manages the application's global state and constants.
 */

// The main state object for the application.
export let state = {
    conversations: {},
    currentConversationId: null,
    apiEndpoints: {},
    personas: {},
    worldBook: {}, // 新增备忘录状态，结构：{ id: { id, name, content, depth, role, enabled, sessionIds: [] } }
    regexRules: {},
    dbConnections: {}, // 新增数据库连接状态
    mcpTools: {}, // MCP工具列表
    mcpSessions: {}, // MCP活跃会话
    mcpSettings: { // MCP全局设置
        enabled: true,
        autoConfirm: false,
        maxConcurrentPerSession: 5, // 单个会话最大并发数
        maxGlobalConcurrent: 8,     // 全局最大并发数
        timeout: 30000,
        maxToolCallRounds: 10, // 乌鸦：MCP 多轮调用最大轮次，默认10轮
        selectedTools: [] // 用户选择的工具列表，最多5个
    },
    appSettings: {
        autoRenderTable: true,
        autoExpandCode: true, // 乌鸦：自动展开代码侧边栏，默认开启
        theme: 'dark',
        mergeWorldBook: false, // <-- 新增此行，默认为不合并
        userAvatar: null, // 新增用户头像字段，base64或URL
        debugMode: false, // 乌鸦：调试模式，启用后在网络面板显示完整响应数据
        modelParams: {
            temperature: 0.5,
            top_p: 0.95,
            enableTopK: false,
            top_k: 40,
            enableMinP: false,
            min_p: 0.05,
            max_tokens: -1,
        },
        streamMode: true, // 乌鸦：流式输出模式，默认开启
        fontSize: 16, // 字体大小，默认16
        autoCollapseLongMessage: true, // 自动收起长消息，默认true
        sendKey: 'enter', // 发送快捷键，默认enter
        userMessageDefaultRenderMode: 'md', // 用户消息默认渲染模式
        aiMessageDefaultRenderMode: 'md', // AI消息默认渲染模式
        disableXssProtection: false, // 乌鸦：新增XSS防护开关，默认开启防护
        recentMessageCount: 5  // 乌鸦：懒加载默认消息数，默认5条
    },
    // 乌鸦：按会话维度管理 AbortController，key 为 convId，支持多会话并行停止
    abortControllers: {},
    attachedFile: null,
    // 隐藏与总结功能，每个会话单独维护
    hideSummary: {
        // [conversationId]: { start, end, enabled, prompt, summary, messageLimit }
    },
    generatingMessages: {
        // [convId_branchIndex_msgIndex]: true
    },
    // 滚动相关状态
    isGeneratingResponse: false, // 是否正在生成回复
    streamingConversationId: null, // 乌鸦：新增，用于跟踪当前正在进行流式响应的会话ID
    avatarUrlCache: new Map(), // 乌鸦：新增，用于缓存头像的Object URL，避免重复创建和内存泄漏
    // World Book 标签筛选状态
    worldBookFilter: {
        mode: 'single', // 'single' 或 'multi'，单选/多选模式
        activeTab: 'all' // 'all' 或 'selected'，当前标签页
    },
    // 批量删除选择模式状态
    batchSelectMode: false,
    selectedConvIds: new Set(),
    isParsingFile: false // 乌鸦：文件解析中锁定标记，解析期间阻止发送和切换会话
};

// 如果 localStorage 中不存在，则要加载的默认正则表达式规则
export const DEFAULT_REGEX_RULES = {
    'regex_default_1': {
        id: 'regex_default_1',
        name: '禁用thinking和think发给接口',
        find: '/<(think|thinking)\\b[^>]*>([\\s\\S]*?)<\\/\\1>\\s*/g',
        replace: '',
        scopes: ['request-user', 'request-assistant'],
        enabled: true,
        // 乌鸦：补全缺失的字段，确保所有规则对象结构完整
        stage: 'post-markdown',
        sort: 0,
        minFloor: 0,
        maxFloor: 0
    }

};

// 附件允许的文件类型。
export const ALLOWED_FILE_TYPES = [
    'text/plain', 'text/javascript', 'application/javascript', 'text/x-python', 'text/markdown',
    'text/html', 'text/css', 'application/json', 'text/csv', 'text/xml',
    // 乌鸦：新增图片支持
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    // 乌鸦：新增文档格式支持（Word/PDF/Excel）
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // .xlsx
    'application/vnd.ms-excel',                                                  // .xls
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'    // .pptx
];

// 预配置的 API 端点设置。
export const API_PRESETS = {
    'openai': { name: 'OpenAI (官方)', type: 'openai-compatible', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
    'deepseek': { name: 'DeepSeek', type: 'openai-compatible', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
    'gemini': { name: 'Gemini (通过兼容接口)', type: 'openai-compatible', url: 'https://generativelanguage.googleapis.com/v1beta', model: 'models/gemini-1.5-flash-latest' },
    'ollama': { name: 'Ollama (本地)', type: 'openai-compatible', url: 'http://localhost:11434/v1', model: 'llama3' },
    'llamacpp': { name: 'Llama.cpp (本地)', type: 'openai-compatible', url: 'http://localhost:8080/v1', model: '' },
    'sse': { name: 'Spring SSE (自定义)', type: 'sse', url: '/api/v1/chat-stream', model: '' },
    'openai-compatible': { name: '其他兼容OpenAI接口', type: 'openai-compatible', url: '', model: '' },
};

function loadAppSettings() {
    let loaded = {};
    try {
        loaded = JSON.parse(localStorage.getItem('ai-chat-appsettings-v2') || '{}');
    } catch { } // 捕获解析错误，如果localStorage为空或格式错误，则返回空对象
    if ('autoCollapseLongMessage' in loaded) {
        // 确保autoCollapseLongMessage是布尔值，即使存储的是字符串'true'或'false'
        loaded.autoCollapseLongMessage = !!loaded.autoCollapseLongMessage && loaded.autoCollapseLongMessage !== 'false';
    }
    // ... 其它设置项的加载和处理 ...
    return loaded;
}


// 乌鸦：在state.js中初始化appSettings，确保在任何模块导入它之前，它已经有了从localStorage加载的值
state.appSettings = { ...state.appSettings, ...loadAppSettings() };
