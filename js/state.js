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
    isParsingFile: false, // 乌鸦：文件解析中锁定标记，解析期间阻止发送和切换会话
    isAutoSummarizing: false, // 是否正在进行自动总结
    autoSummarizingConvId: null // 正在进行自动总结的会话ID
};

// 如果 localStorage 中不存在，则要加载的默认正则表达式规则
export const DEFAULT_REGEX_RULES = {
    'regex_default_choice_item': {
        id: 'regex_default_choice_item',
        name: '剧情选项_单项按钮化',
        find: '/<c>([\\s\\S]*?)<\\/c>/g',
        replace: '<div class="story-choice-item" data-default-text="$1" onclick="window.userDefaultClick(this.getAttribute(\'data-default-text\'))"><span class="choice-icon">👉</span><span class="choice-text">$1</span></div>',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 38,
        minFloor: 0,
        maxFloor: 0
    },
    'regex_default_options_box': {
        id: 'regex_default_options_box',
        name: '剧情选项_外层卡片化',
        find: '/<options>([\\s\\S]*?)<\\/options>/g',
        replace: '<div class="story-options-container"><details class="story-options-details"><summary class="story-options-summary">📖 剧情分支行动（点击展开选择）</summary><div class="story-options-body"><div class="story-choices-list">$1</div></div></details></div>',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 40,
        minFloor: 0,
        maxFloor: 0
    },
    'regex_default_options_clear_old': {
        id: 'regex_default_options_clear_old',
        name: '选项_清空2楼之前的',
        find: '/<options>([\\s\\S]*?)<\\/options>/g',
        replace: '',
        scopes: ['request-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 50,
        minFloor: 0,
        maxFloor: 2
    },
    'regex_default_summary_box': {
        id: 'regex_default_summary_box',
        name: '本章小结-折叠展示最近10层',
        find: '/<simple>([\\s\\S]*?)<\\/simple>/g',
        replace: '\n<simple><details><summary style="background-color: #3b82f6; color: #ffffff; padding: 5px; font-weight: bold;">小结</summary><div style="background-color: #4677c7; color: #ffffff; padding: 15px; border-radius: 0 0 5px 5px;"><p style="margin: 5px 0;">本章小结内容：</p><ul style="list-style-type: none; padding-left: 0;"><li>$1 <br> </li></ul></div></details></simple>\n',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 60,
        minFloor: 10,
        maxFloor: 0
    },
    'regex_default_summary_remove_recent': {
        id: 'regex_default_summary_remove_recent',
        name: '本章小结_移除最近14楼不发给AI',
        find: '/<simple>([\\s\\S]*?)<\\/simple>/g',
        replace: '',
        scopes: ['request-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 70,
        minFloor: 14,
        maxFloor: 0
    },
    'regex_default_body_remove_old': {
        id: 'regex_default_body_remove_old',
        name: '移除14楼之前的正文',
        find: '/<text_play>([\\s\\S]*?)<\\/text_play>/g',
        replace: '',
        scopes: ['request-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 70,
        minFloor: 0,
        maxFloor: 14
    },
    'regex_default_disable_strikethrough': {
        id: 'regex_default_disable_strikethrough',
        name: '禁用删除线~',
        find: '~',
        replace: '\\~',
        scopes: ['display-user', 'display-assistant'],
        enabled: false,
        stage: 'post-markdown',
        sort: 75,
        minFloor: 0,
        maxFloor: 0
    },
    'regex_default_sql': {
        id: 'regex_default_sql',
        name: '高亮sql',
        find: '<sql>([\\s\\S]*?)<\\/sql>',
        replace: '<span style="color: #d55031; font-weight: bold;">$&</span>',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'pre-markdown',
        sort: 80,
        minFloor: 0,
        maxFloor: 0
    },
    'regex_default_highlight_numbers': {
        id: 'regex_default_highlight_numbers',
        name: '高亮数字',
        find: '\\b[0-9]+\\b',
        replace: '<span style="color: #e3955b;">$&</span>',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'post-markdown',
        sort: 90,
        minFloor: 0,
        maxFloor: 0
    },
    'regex_default_highlight_letters': {
        id: 'regex_default_highlight_letters',
        name: '高亮字母',
        find: '\\b[A-Z]+\\b',
        replace: '<span style="color: #4cd188;">$&</span>',
        scopes: ['display-user', 'display-assistant'],
        enabled: true,
        stage: 'post-markdown',
        sort: 95,
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
