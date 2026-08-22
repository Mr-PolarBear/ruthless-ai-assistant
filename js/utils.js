/**
 * @file utils.js
 * @description Contains utility and helper functions for various tasks.
 */

import { state, DEFAULT_REGEX_RULES } from './state.js?v=260820-1';
import { regexPatterns } from './regex.js?v=260820-1';
import { dom } from './dom.js?v=260820-1';
// 导入所需的 UI 函数
import { openSettingsModal, renderApiEndpointsList, renderPersonaModal, renderRegexRulesList, renderWorldBookList } from './modals.js?v=260820-1';
import { populateApiSelector, populatePersonaSelector } from './renderer.js?v=260820-1';
import { updateWorldBookButton } from './ui-updater.js?v=260820-1';
import { saveConversation, getConversation, getAllConversationIds, deleteConversation } from './db.js?v=260820-1';
import { formatMemoryForApi, normalizeHideSummaryConfig } from './summary-manager.js?v=260820-1';
import { showBatchConflictResolutionDialog } from './modals/import-conflict-modal.js?v=260820-1';

// --- Utility Functions ---

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - The text to escape
 * @returns {string} - The escaped text
 */
export function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- Local Storage ---

/**
 * Saves all major parts of the application state to localStorage and IndexedDB.
 */
export async function saveToLocalStorage() {
    try {
        // 保证 worldBook 每条 entry 都有 sessionIds 字段
        Object.values(state.worldBook).forEach(entry => {
            if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
        });

        // 其他设置仍保存到 localStorage
        localStorage.setItem('ai-chat-personas-v1', JSON.stringify(state.personas));
        localStorage.setItem('ai-chat-worldbook-v1', JSON.stringify(state.worldBook)); // 备忘录
        localStorage.setItem('ai-chat-api-endpoints-v1', JSON.stringify(state.apiEndpoints));
        localStorage.setItem('ai-chat-regex-rules-v1', JSON.stringify(state.regexRules));
        localStorage.setItem('ai-chat-hide-summary-v1', JSON.stringify(state.hideSummary || {}));
        localStorage.setItem('ai-chat-mcp-settings-v1', JSON.stringify(state.mcpSettings || {})); // MCP设置
        localStorage.setItem('ai-chat-mcp-custom-tools-v1', JSON.stringify(state.mcpCustomTools || {})); // 乌鸦：MCP自定义工具
        localStorage.setItem('ai-chat-mcp-tool-states-v1', JSON.stringify(state.mcpToolStates || {})); // 乌鸦：MCP工具状态
        localStorage.setItem('quick_prompts', JSON.stringify(state.quickPrompts || [])); // 快捷提示持久化

        return true;
    } catch (e) {
        console.error("保存数据失败:", e);
        alert("保存数据失败，请检查浏览器存储空间是否充足。错误信息: " + e.message);
        return false;
    }
}

/**
 * Loads all major parts of the application state from localStorage and IndexedDB.
 */
export async function loadFromLocalStorage() {
    try {
        // 乌鸦：改造加载逻辑，从“总账”模式改为“分账”模式
        const conversationIds = await getAllConversationIds();

        if (conversationIds.length > 0) {
            // 如果有分账数据，则逐一加载
            const conversations = {};
            for (const id of conversationIds) {
                // 乌鸦：增加try-catch，防止单个会话加载失败导致整个应用崩溃
                try {
                    const conv = await getConversation(id);
                    if (conv) {
                        conversations[id] = conv;
                    }
                } catch (convError) {
                    console.error(`加载会话 ${id} 失败:`, convError);
                }
            }
            state.conversations = conversations;
            console.log(`乌鸦：成功加载 ${conversationIds.length} 个分账会话。`);

            // 乌鸦：检查是否还存在旧的总账数据，如果存在，则删除，完成迁移
            try {
                const oldConversationsCheck = await getConversation('all_conversations');
                if (oldConversationsCheck) {
                    await deleteConversation('all_conversations');
                    console.log("乌鸦：已检测并删除旧的总账数据，迁移完成。");
                }
            } catch (checkError) {
                // 忽略检查错误
            }

        } else {
            // 如果没有分账数据，尝试从旧的总账或localStorage加载（兼容旧数据）
            const oldConversations = await getConversation('all_conversations');
            if (oldConversations && Object.keys(oldConversations).length > 0) {
                console.log("乌鸦：检测到旧的总账数据，开始迁移...");
                // 将旧数据迁移到新模式
                for (const [id, conv] of Object.entries(oldConversations)) {
                    await saveConversation(id, conv);
                }
                state.conversations = oldConversations;
                // 删除旧的总账数据
                await deleteConversation('all_conversations');
                console.log("乌鸦：旧的总账数据已成功迁移到分账模式。");
            } else {
                // 最后尝试从 localStorage 加载
                const savedConvs = localStorage.getItem('ai-chat-conversations-v6');
                if (savedConvs) {
                    console.log("乌鸦：检测到 localStorage 中的旧数据，开始迁移...");
                    const parsed = JSON.parse(savedConvs);
                    // 兼容老数据，确保avatar字段恢复
                    for (const [id, conv] of Object.entries(parsed)) {
                        if (conv.avatar) {
                            parsed[id].avatar = conv.avatar;
                        }
                        // 迁移到新的分账模式
                        await saveConversation(id, conv);
                    }
                    state.conversations = parsed;
                    // 迁移后可以考虑删除旧的localStorage项
                    // localStorage.removeItem('ai-chat-conversations-v6');
                    console.log("乌鸦：localStorage 数据已成功迁移到分账模式。");
                } else {
                    state.conversations = {};
                }
            }
        }
    } catch (e) {
        state.conversations = {};
        console.error("加载聊天记录失败:", e);
    }

    try {
        state.personas = JSON.parse(localStorage.getItem('ai-chat-personas-v1')) || {};
    } catch (e) {
        state.personas = {};
        console.error("Failed to load personas:", e);
    }

    try { // 备忘录
        const rawWorldBook = localStorage.getItem('ai-chat-worldbook-v1');
        if (rawWorldBook) {
            const parsedWorldBook = JSON.parse(rawWorldBook);
            // 兼容老数据，确保每条 entry 都有 sessionIds 字段且为数组
            for (const entry of Object.values(parsedWorldBook)) {
                if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
            }
            state.worldBook = parsedWorldBook;
        } else {
            state.worldBook = {};
        }
    } catch (e) {
        state.worldBook = {};
        console.error("Failed to load world book:", e);
    }

    try {
        const savedRulesRaw = localStorage.getItem('ai-chat-regex-rules-v1');
        const savedRules = savedRulesRaw ? JSON.parse(savedRulesRaw) : {};

        // 自动清理淘汰已废弃的旧版本单一默认规则 regex_default_1
        if (savedRules && savedRules['regex_default_1'] && !DEFAULT_REGEX_RULES['regex_default_1']) {
            delete savedRules['regex_default_1'];
        }

        // 1. 深度拷贝一份最新的内置默认规则作为基准（内容强制同步最新版，仅保留用户的启停开关状态）
        const finalRules = {};
        for (const [defId, defRule] of Object.entries(DEFAULT_REGEX_RULES)) {
            finalRules[defId] = { ...defRule };
            if (savedRules && savedRules[defId] && savedRules[defId].enabled !== undefined) {
                finalRules[defId].enabled = savedRules[defId].enabled;
            }
        }

        // 2. 加载用户的自定义全局规则（非默认规则）
        for (const id in savedRules) {
            if (Object.prototype.hasOwnProperty.call(savedRules, id)) {
                if (DEFAULT_REGEX_RULES && DEFAULT_REGEX_RULES[id]) continue; // 默认规则已在上方同步

                const savedRule = savedRules[id];
                if (!savedRule) continue;

                finalRules[id] = {
                    id: savedRule.id || id,
                    name: savedRule.name || '',
                    find: savedRule.find || '',
                    replace: savedRule.replace !== undefined ? savedRule.replace : '',
                    scopes: savedRule.scopes || ['display-user', 'display-assistant'],
                    enabled: savedRule.enabled !== undefined ? savedRule.enabled : true,
                    stage: savedRule.stage || 'post-markdown',
                    sort: savedRule.sort || 0,
                    minFloor: savedRule.minFloor || 0,
                    maxFloor: savedRule.maxFloor || 0,
                    scope: savedRule.scope || 'global',
                    sessionIds: Array.isArray(savedRule.sessionIds) ? savedRule.sessionIds : []
                };
            }
        }

        state.regexRules = finalRules;

    } catch (e) {
        state.regexRules = { ...DEFAULT_REGEX_RULES };
        console.error("Failed to load regex rules, loading defaults:", e);
    }

    try {
        state.apiEndpoints = JSON.parse(localStorage.getItem('ai-chat-api-endpoints-v1')) || {};
    } catch (e) {
        state.apiEndpoints = {};
        console.error("Failed to load API endpoints:", e);
    }

    try {
        state.hideSummary = JSON.parse(localStorage.getItem('ai-chat-hide-summary-v1')) || {};
    } catch (e) {
        state.hideSummary = {};
        console.error("Failed to load hideSummary:", e);
    }

    try {
        const savedMcpSettings = localStorage.getItem('ai-chat-mcp-settings-v1');
        if (savedMcpSettings) {
            state.mcpSettings = { ...state.mcpSettings, ...JSON.parse(savedMcpSettings) };
        }
    } catch (e) {
        console.error("Failed to load MCP settings:", e);
    }

    // 乌鸦：加载MCP自定义工具
    try {
        const savedMcpCustomTools = localStorage.getItem('ai-chat-mcp-custom-tools-v1');
        if (savedMcpCustomTools) {
            state.mcpCustomTools = JSON.parse(savedMcpCustomTools);
        } else {
            state.mcpCustomTools = {};
        }
    } catch (e) {
        state.mcpCustomTools = {};
        console.error("Failed to load MCP custom tools:", e);
    }

    // 乌鸦：加载MCP工具状态
    try {
        const savedMcpToolStates = localStorage.getItem('ai-chat-mcp-tool-states-v1');
        if (savedMcpToolStates) {
            state.mcpToolStates = JSON.parse(savedMcpToolStates);
        } else {
            state.mcpToolStates = {};
        }
    } catch (e) {
        state.mcpToolStates = {};
        console.error("Failed to load MCP tool states:", e);
    }

    // 自动应用字体大小
    if (state.appSettings && state.appSettings.fontSize) {
        document.documentElement.style.setProperty('--font-size-base', state.appSettings.fontSize + 'px');
    }
    // autoCollapseLongMessage已在state.appSettings中，UI渲染时会自动读取，无需额外操作
    // 强制设置字体大小，确保刷新后生效
    if (state.appSettings && state.appSettings.fontSize) {
        document.documentElement.style.setProperty('--font-size-base', state.appSettings.fontSize + 'px');
    }

    // Load message limit slider value from localStorage
    // Load message limit slider value from localStorage
    state.messageLimit = parseInt(localStorage.getItem('ai-chat-message-limit'), 10) || 0;
}

export function getFromLocalStorage(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
        console.error(`Failed to load '${key}' from localStorage:`, e);
        return defaultValue;
    }
}


/**
 * Saves application-specific settings to localStorage.
 */
export function saveAppSettings() {
    localStorage.setItem('ai-chat-appsettings-v2', JSON.stringify(state.appSettings));
    // 不再自动 applyTheme，主题切换应由专门的主题切换逻辑触发
}

/**
 * Loads application-specific settings from localStorage.
 */
export function loadSettings() {
    try {
        const savedApp = localStorage.getItem('ai-chat-appsettings-v2');
        if (savedApp) {
            const parsedSettings = JSON.parse(savedApp);
            state.appSettings = {
                ...state.appSettings,
                ...parsedSettings,
                modelParams: {
                    ...state.appSettings.modelParams,
                    ...(parsedSettings.modelParams || {})
                }
            };
        }
    } catch (e) {
        console.error("Failed to load settings, using defaults:", e);
    }
}


// --- Text & JSON Manipulation ---

/**
 * Extracts a JSON array string from a larger text block.
 * @param {string} text - The text to search within.
 * @returns {string|null} The extracted JSON string or null if not found.
 */
export function extractJsonArrayString(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(/```json\s*(\[[\s\S]*?\])\s*```|(\[\s*\{[\s\S]*?\}\s*\])/);
    if (!match) return null;
    const jsonString = match[1] || match[2];
    try {
        const data = JSON.parse(jsonString);
        if (Array.isArray(data) && data.length > 0 && data.every(item => typeof item === 'object' && item !== null)) {
            return jsonString;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Converts a JSON array string to a Markdown table.
 * @param {string} jsonString - The JSON string to convert.
 * @returns {string|null} The Markdown table or null on failure.
 */
export function jsonToMarkdownTable(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        if (!Array.isArray(data) || data.length === 0) return null;

        // 乌鸦：直接生成带class的HTML表格，而不是Markdown，以确保样式正确应用
        const headers = Object.keys(data[0]);
        let tableHtml = '<table class="table table-bordered table-striped">'; // 使用Bootstrap等常见表格样式

        // Table Head
        tableHtml += '<thead><tr>';
        headers.forEach(h => tableHtml += `<th>${String(h ?? '')}</th>`);
        tableHtml += '</tr></thead>';

        // Table Body
        tableHtml += '<tbody>';
        data.forEach(row => {
            tableHtml += '<tr>';
            headers.forEach(h => tableHtml += `<td>${String(row[h] ?? '')}</td>`);
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';

        return tableHtml;
    } catch (e) {
        return null;
    }
}


// --- Clipboard & File operations ---

/**
 * Copies text to the clipboard. Returns a promise that resolves on success and rejects on failure.
 * @param {string} text - The text to copy.
 * @returns {Promise<void>}
 */
export function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(resolve).catch(err => {
                console.error('Clipboard API copy failed, falling back.', err);
                // Try fallback on error
                if (fallbackCopyText(text)) {
                    resolve();
                } else {
                    reject(new Error('Fallback copy command failed.'));
                }
            });
        } else {
            // Use fallback if clipboard API is not available
            if (fallbackCopyText(text)) {
                resolve();
            } else {
                reject(new Error('Fallback copy command failed.'));
            }
        }
    });
}

/**
 * Fallback method for copying text using `document.execCommand`.
 * @param {string} text - The text to copy.
 * @returns {boolean} - True if the command was successful.
 */
export function fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    let successful = false;
    try {
        successful = document.execCommand('copy');
    } catch (err) {
        console.error('Fallback copy exception:', err);
        successful = false;
    }
    document.body.removeChild(textArea);
    return successful;
}

/**
 * Saves a message's content as a Markdown file.
 * @param {object} message - The message object to save.
 */
export function saveMessageAsFile(message) {
    const content = message.originalContent || message.content;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI-response-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// --- Import/Export ---

/**
 * Exports the current app configuration to a JSON file.
 */
export function exportConfig() {
    const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
    const customGlobalRules = {};
    if (state.regexRules && typeof state.regexRules === 'object') {
        for (const [id, rule] of Object.entries(state.regexRules)) {
            if (!defaultRuleKeys.includes(id) && (rule.scope === 'global' || !rule.scope)) {
                customGlobalRules[id] = JSON.parse(JSON.stringify(rule));
            }
        }
    }

    const configToExport = {
        apiEndpoints: state.apiEndpoints,
        personas: state.personas,
        worldBook: state.worldBook, // 添加备忘录
        regexRules: customGlobalRules,
        appSettings: state.appSettings,
        quickPrompts: state.quickPrompts || [], // 补充快捷提示
        mcpSettings: state.mcpSettings || {},   // 补充MCP全局设置
        mcpCustomTools: state.mcpCustomTools || {} // 补充MCP自定义工具
    };

    // 记录最新配置导出时间戳
    try {
        localStorage.setItem('last_config_backup_time', String(Date.now()));
    } catch (_) {}

    const configString = JSON.stringify(configToExport, null, 2);
    const blob = new Blob([configString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 导出单个会话到JSON文件
 * @param {string} conversationId - 要导出的会话ID
 */
export async function exportConversation(conversationId) {
    let conversation;

    // 首先尝试从内存中获取会话数据
    if (state.conversations[conversationId]) {
        conversation = state.conversations[conversationId];
    } else {
        // 如果内存中没有，尝试从 IndexedDB 中获取
        try {
            conversation = await getConversation(conversationId);
        } catch (err) {
            console.error('从 IndexedDB 获取会话失败:', err);
        }
    }

    if (!conversation) {
        alert('会话不存在或已被删除');
        return;
    }

    // 创建一个深拷贝以避免引用问题
    const convToExport = JSON.parse(JSON.stringify(conversation));

    // 添加导出时间戳，方便标识
    convToExport.exportedAt = new Date().toISOString();

    // 打包关联备忘录 (Smart Bundle 机制：包含全局生效和针对当前会话局部生效的条目)
    const relatedWb = [];
    if (state.worldBook && typeof state.worldBook === 'object') {
        Object.values(state.worldBook).forEach(entry => {
            if (!entry) return;
            const isGloballyEnabled = entry.enabled === true;
            const isLocallyLinked = Array.isArray(entry.sessionIds) && entry.sessionIds.includes(conversationId);
            if (isGloballyEnabled || isLocallyLinked) {
                relatedWb.push(JSON.parse(JSON.stringify(entry)));
            }
        });
    }
    convToExport.relatedWorldBook = relatedWb;

    // 打包隐藏与总结配置及历史版本 (hideSummary 机制)
    if (state.hideSummary && state.hideSummary[conversationId]) {
        convToExport.hideSummary = JSON.parse(JSON.stringify(state.hideSummary[conversationId]));
    }

    // 打包该会话绑定的专属正则 (sessionRegexRules 机制)
    const sessionRegex = [];
    if (state.regexRules && typeof state.regexRules === 'object') {
        Object.values(state.regexRules).forEach(rule => {
            if (!rule) return;
            if (rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.map(String).includes(String(conversationId))) {
                sessionRegex.push(JSON.parse(JSON.stringify(rule)));
            }
        });
    }
    convToExport.sessionRegexRules = sessionRegex;

    const configString = JSON.stringify(convToExport, null, 2);
    const blob = new Blob([configString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sanitizedTitle = conversation.title.replace(/[\/:*?"<>|]/g, '_').substring(0, 50);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(regexPatterns.timestampFormat, '-');
    a.download = `${sanitizedTitle}-${date}_${time}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 导出所有会话到单个JSON文件（完整打包所有会话、备忘录与隐藏总结及会话专属正则）
 */
export async function exportAllConversations() {
    let conversations = {};
    try {
        // 乌鸦：改造 - 使用新的分账模式读取所有会话
        const ids = await getAllConversationIds();
        for (const id of ids) {
            const conv = await getConversation(id);
            if (conv) {
                conversations[id] = conv;
            }
        }
    } catch (err) {
        console.error('从 IndexedDB 获取所有会话失败:', err);
        alert('获取会话数据失败！');
        return;
    }

    if (Object.keys(conversations).length === 0) {
        alert('没有会话可导出');
        return;
    }

    // 提取所有会话级专属正则并打包
    const sessionRegex = {};
    if (state.regexRules && typeof state.regexRules === 'object') {
        Object.entries(state.regexRules).forEach(([id, rule]) => {
            if (rule && rule.scope === 'session') {
                sessionRegex[id] = JSON.parse(JSON.stringify(rule));
            }
        });
    }

    const conversationsToExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        conversations: conversations,
        worldBook: state.worldBook ? JSON.parse(JSON.stringify(state.worldBook)) : {},
        hideSummary: state.hideSummary ? JSON.parse(JSON.stringify(state.hideSummary)) : {},
        sessionRegexRules: sessionRegex
    };

    // 记录最新全量备份时间戳
    try {
        localStorage.setItem('last_full_backup_time', String(Date.now()));
    } catch (_) {}

    const configString = JSON.stringify(conversationsToExport, null, 2);
    const blob = new Blob([configString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-all-conversations-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Imports an app configuration from a JSON string.
 * @param {string} jsonString - The JSON string of the configuration.
 */
export async function importConfig(jsonString) {
    if (!jsonString) {
        alert('请粘贴配置内容到文本框中。');
        return false;
    }

    try {
        const sanitizedJsonString = jsonString.replace(/"prompt":\s*"((?:\\.|[^"\\])*)"/g, (match, promptContent) => {
            const escapedContent = promptContent.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t');
            return `"prompt": "${escapedContent}"`;
        });

        const importedConfig = JSON.parse(sanitizedJsonString);

        const hasApis = importedConfig.apiEndpoints && typeof importedConfig.apiEndpoints === 'object';
        const hasPersonas = importedConfig.personas && typeof importedConfig.personas === 'object';
        const hasRegex = importedConfig.regexRules && typeof importedConfig.regexRules === 'object';
        const hasWorldBook = importedConfig.worldBook && typeof importedConfig.worldBook === 'object';
        const hasQuickPrompts = importedConfig.quickPrompts && Array.isArray(importedConfig.quickPrompts);
        const hasMcpSettings = importedConfig.mcpSettings && typeof importedConfig.mcpSettings === 'object';

        if (!hasApis && !hasPersonas && !hasRegex && !hasWorldBook && !importedConfig.appSettings && !hasQuickPrompts && !hasMcpSettings) {
            throw new Error("无效的配置格式，未找到可导入的配置项。");
        }

        const now = new Date();
        const timestamp = `-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

        // 冲突预检收集
        const conflictItems = [];
        const nonConflictItems = [];
        const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});

        // 1. 扫描 API 端点冲突
        if (hasApis) {
            for (const [id, item] of Object.entries(importedConfig.apiEndpoints)) {
                if (!item) continue;
                const ruleId = item.id || id;
                const entry = { key: `api_${ruleId}`, category: 'api', id: ruleId, name: item.name || '未命名API', item, target: state.apiEndpoints, prefix: 'api' };
                if (state.apiEndpoints && state.apiEndpoints[ruleId]) {
                    conflictItems.push(entry);
                } else {
                    nonConflictItems.push(entry);
                }
            }
        }

        // 2. 扫描自定义全局正则冲突（自动剔除系统默认规则）
        if (hasRegex) {
            for (const [id, item] of Object.entries(importedConfig.regexRules)) {
                if (!item) continue;
                const ruleId = item.id || id;
                // 系统默认规则直接跳过
                if (defaultRuleKeys.includes(ruleId)) {
                    console.log(`[Import Config] 正则规则 ID (${ruleId}) 属于系统默认规则，已自动跳过。`);
                    continue;
                }
                const entry = { key: `regex_${ruleId}`, category: 'regex', id: ruleId, name: item.name || '未命名规则', item, target: state.regexRules, prefix: 'regex' };
                if (state.regexRules && state.regexRules[ruleId]) {
                    conflictItems.push(entry);
                } else {
                    nonConflictItems.push(entry);
                }
            }
        }

        // 3. 扫描角色预设冲突
        if (hasPersonas) {
            for (const [id, item] of Object.entries(importedConfig.personas)) {
                if (!item) continue;
                const ruleId = item.id || id;
                const entry = { key: `persona_${ruleId}`, category: 'persona', id: ruleId, name: item.name || '未命名角色', item, target: state.personas, prefix: 'persona' };
                if (state.personas && state.personas[ruleId]) {
                    conflictItems.push(entry);
                } else {
                    nonConflictItems.push(entry);
                }
            }
        }

        // 4. 扫描世界书 / 备忘录冲突
        if (hasWorldBook) {
            for (const [id, item] of Object.entries(importedConfig.worldBook)) {
                if (!item) continue;
                const ruleId = item.id || id;
                const entry = { key: `wb_${ruleId}`, category: 'worldBook', id: ruleId, name: item.name || '未命名备忘录', item, target: state.worldBook, prefix: 'wb' };
                if (state.worldBook && state.worldBook[ruleId]) {
                    conflictItems.push(entry);
                } else {
                    nonConflictItems.push(entry);
                }
            }
        }

        // 如果存在冲突项，弹出集中式批量决策面板
        let decisions = {};
        if (conflictItems.length > 0) {
            decisions = await showBatchConflictResolutionDialog(conflictItems);
            if (decisions === null) {
                // 用户取消导入
                return false;
            }
        }

        let importCount = 0;
        let skippedCount = 0;

        // 规整导入项字段（确保正则 rules 的 scope 与 sessionIds 格式标准）
        const normalizeImportedItem = (entry, newId, newName) => {
            const base = { ...entry.item, id: newId, name: newName };
            if (entry.category === 'regex') {
                base.scope = base.scope || 'global';
                base.sessionIds = Array.isArray(base.sessionIds) ? base.sessionIds : [];
            }
            return base;
        };

        // 执行冲突项的写入决策
        conflictItems.forEach(entry => {
            const decision = decisions[entry.key] || 'keep_both';
            if (decision === 'overwrite') {
                // 覆盖写入现有 ID
                entry.target[entry.id] = normalizeImportedItem(entry, entry.id, entry.name);
                importCount++;
            } else if (decision === 'keep_both') {
                // 都保留：分配新唯一 ID，重名则追加时间戳
                let newName = entry.name;
                if (Object.values(entry.target).some(existing => existing.name === newName)) {
                    newName += timestamp;
                }
                const newId = `${entry.prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                entry.target[newId] = normalizeImportedItem(entry, newId, newName);
                importCount++;
            } else {
                // skip 跳过
                skippedCount++;
            }
        });

        // 执行无冲突项的直接导入（保持原 ID 稳定性）
        nonConflictItems.forEach(entry => {
            let newName = entry.name;
            if (Object.values(entry.target).some(existing => existing.name === newName && existing.id !== entry.id)) {
                newName += timestamp;
            }
            entry.target[entry.id] = normalizeImportedItem(entry, entry.id, newName);
            importCount++;
        });

        // 处理快捷提示词
        if (hasQuickPrompts) {
            state.quickPrompts = importedConfig.quickPrompts;
            importCount += importedConfig.quickPrompts.length;
        }

        // 处理 MCP 配置
        if (hasMcpSettings) {
            state.mcpSettings = { ...state.mcpSettings, ...importedConfig.mcpSettings };
            importCount++;
        }
        if (importedConfig.mcpCustomTools && typeof importedConfig.mcpCustomTools === 'object') {
            state.mcpCustomTools = { ...state.mcpCustomTools, ...importedConfig.mcpCustomTools };
        }

        // 处理应用设置与外观
        if (importedConfig.appSettings) {
            state.appSettings = { ...state.appSettings, ...importedConfig.appSettings };
            saveAppSettings();
            // 实时刷新气泡颜色与宽度样式
            import('./settings/bubble-settings.js?v=260820-1').then(module => {
                if (module.applyBubbleCustomStyles) module.applyBubbleCustomStyles();
                if (module.updateBubbleSettingsUI) module.updateBubbleSettingsUI();
            }).catch(err => console.warn('刷新气泡样式失败:', err));
        }

        saveToLocalStorage();
        populateApiSelector();
        populatePersonaSelector();
        renderApiEndpointsList();
        renderPersonaModal();
        renderRegexRulesList();
        renderWorldBookList();
        updateWorldBookButton();

        // 如果导入了角色，确保角色选择器已启用
        if (hasPersonas) {
            dom.personaSelector.disabled = false;
        }

        const skipMsg = skippedCount > 0 ? ` (已跳过 ${skippedCount} 项)` : '';
        alert(`成功导入 ${importCount} 个项目！${skipMsg}`);
        return true;

    } catch (e) {
        alert(`导入失败：${e.message}`);
        return false;
    }
}

/**
 * 导入会话数据，支持单个会话对象或包含多个会话的导出文件（智能恢复关联备忘录与隐藏总结）
 * @param {Array<object>} conversationsToImport - 要导入的会话列表
 * @param {object} [bundleMetadata={}] - 包含顶级 worldBook 和 hideSummary 的元数据字典
 * @returns {Promise<string|null>} - 返回最后一个导入的会话ID或null
 */
export async function importConversations(conversationsToImport, bundleMetadata = {}) {
    if (!Array.isArray(conversationsToImport) || conversationsToImport.length === 0) {
        alert('没有选择要导入的会话。');
        return null;
    }

    let importedCount = 0;
    let lastImportedId = null;
    let hasWorldBookUpdated = false;
    let hasRegexUpdated = false;
    const timestamp = new Date().toISOString();
    const batchSize = 10;

    if (!state.worldBook || typeof state.worldBook !== 'object') {
        state.worldBook = {};
    }
    if (!state.hideSummary || typeof state.hideSummary !== 'object') {
        state.hideSummary = {};
    }

    // 1. 如果 bundleMetadata 包含顶级全量 worldBook，先增量合并入本地
    if (bundleMetadata.worldBook && typeof bundleMetadata.worldBook === 'object') {
        Object.entries(bundleMetadata.worldBook).forEach(([wbId, wbEntry]) => {
            if (!wbEntry) return;
            if (!state.worldBook[wbId]) {
                state.worldBook[wbId] = JSON.parse(JSON.stringify(wbEntry));
                hasWorldBookUpdated = true;
            }
        });
    }

    for (let i = 0; i < conversationsToImport.length; i++) {
        const conv = conversationsToImport[i];

        if (!conv.id || !conv.branches || !Array.isArray(conv.branches)) {
            console.warn('跳过一个无效的会话数据:', conv);
            continue;
        }

        const oldConvId = conv.id;
        const newId = `conv_import_${Date.now()}_${importedCount}`;
        const newConversation = {
            ...conv,
            id: newId,
            title: conv.title ? `${conv.title} (已导入)` : `对话 (已导入)`,
            lastModified: timestamp,
            importedAt: timestamp
        };

        // 清理会话中挂载的临时附属属性，保持数据纯净
        delete newConversation.relatedWorldBook;
        delete newConversation.hideSummary;
        delete newConversation.sessionRegexRules;

        // 2. 恢复并映射局部关联的备忘录 (Smart Bundle 联动)
        // A. 从单会话携带的 relatedWorldBook 恢复
        if (Array.isArray(conv.relatedWorldBook) && conv.relatedWorldBook.length > 0) {
            conv.relatedWorldBook.forEach(wbEntry => {
                if (!wbEntry || !wbEntry.id) return;
                if (!state.worldBook[wbEntry.id]) {
                    state.worldBook[wbEntry.id] = {
                        ...wbEntry,
                        sessionIds: [newId]
                    };
                } else {
                    if (!Array.isArray(state.worldBook[wbEntry.id].sessionIds)) {
                        state.worldBook[wbEntry.id].sessionIds = [];
                    }
                    if (!state.worldBook[wbEntry.id].sessionIds.includes(newId)) {
                        state.worldBook[wbEntry.id].sessionIds.push(newId);
                    }
                }
                hasWorldBookUpdated = true;
            });
        }

        // B. 从全量 bundleMetadata.worldBook 中映射旧 ID 到新 ID
        if (bundleMetadata.worldBook && typeof bundleMetadata.worldBook === 'object') {
            Object.values(state.worldBook).forEach(localEntry => {
                const origEntry = bundleMetadata.worldBook[localEntry.id];
                if (origEntry && Array.isArray(origEntry.sessionIds) && origEntry.sessionIds.includes(oldConvId)) {
                    if (!Array.isArray(localEntry.sessionIds)) {
                        localEntry.sessionIds = [];
                    }
                    if (!localEntry.sessionIds.includes(newId)) {
                        localEntry.sessionIds.push(newId);
                        hasWorldBookUpdated = true;
                    }
                }
            });
        }

        // 3. 恢复隐藏与总结配置及历史版本 (hideSummary 联动，自动标准化为 3 种模式数据结构)
        if (conv.hideSummary && typeof conv.hideSummary === 'object') {
            state.hideSummary[newId] = normalizeHideSummaryConfig(conv.hideSummary);
        } else if (bundleMetadata.hideSummary && bundleMetadata.hideSummary[oldConvId]) {
            state.hideSummary[newId] = normalizeHideSummaryConfig(bundleMetadata.hideSummary[oldConvId]);
        }

        // 4. 恢复并映射该会话绑定的专属正则 (sessionRegexRules 联动)
        const importedRuleSignatures = new Set();
        // A. 从单会话携带的 sessionRegexRules 恢复
        if (Array.isArray(conv.sessionRegexRules) && conv.sessionRegexRules.length > 0) {
            conv.sessionRegexRules.forEach(rule => {
                if (!rule || !rule.name) return;
                const sig = `${rule.name}__${rule.find}`;
                importedRuleSignatures.add(sig);
                const newRuleId = `regex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                state.regexRules[newRuleId] = {
                    ...JSON.parse(JSON.stringify(rule)),
                    id: newRuleId,
                    scope: 'session',
                    sessionIds: [newId]
                };
                hasRegexUpdated = true;
            });
        }
        // B. 从全量 bundleMetadata.sessionRegexRules 中映射旧 ID 到新 ID
        if (bundleMetadata.sessionRegexRules && typeof bundleMetadata.sessionRegexRules === 'object') {
            Object.values(bundleMetadata.sessionRegexRules).forEach(rule => {
                if (rule && Array.isArray(rule.sessionIds) && rule.sessionIds.includes(oldConvId)) {
                    const sig = `${rule.name}__${rule.find}`;
                    if (importedRuleSignatures.has(sig)) return; // 避免重复导入
                    importedRuleSignatures.add(sig);
                    const newRuleId = `regex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    state.regexRules[newRuleId] = {
                        ...JSON.parse(JSON.stringify(rule)),
                        id: newRuleId,
                        scope: 'session',
                        sessionIds: [newId]
                    };
                    hasRegexUpdated = true;
                }
            });
        }

        state.conversations[newId] = newConversation;
        await saveConversation(newId, newConversation);
        importedCount++;
        lastImportedId = newId;

        if ((i + 1) % batchSize === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (hasWorldBookUpdated) {
        if (window.updateWorldBookButton) {
            window.updateWorldBookButton();
        }
    }

    if (hasRegexUpdated) {
        renderRegexRulesList();
    }

    await saveToLocalStorage();

    if (importedCount > 0) {
        alert(`成功导入 ${importedCount} 个会话！${hasWorldBookUpdated ? '（关联备忘录已同步恢复）' : ''}`);
        return lastImportedId;
    } else {
        alert('未导入任何有效的会话。');
        return null;
    }
}

/**
 * Populates the import textarea with a template.
 */
export function showImportTemplate() {
    const template = {
        "apiEndpoints": {
            "api_example1": { "id": "...", "name": "示例API", "type": "openai-compatible", "url": "http://localhost:11434/v1", "model": "llama3", "key": "", "modelParams": { "temperature": 0.7, "top_p": 1, "enableTopK": false, "top_k": 50, "enableMinP": false, "min_p": 0.05, "max_tokens": 2048, "streamMode": true } }
        },
        "personas": {
            "persona_example1": { "id": "...", "name": "示例角色", "prompt": "你是一个AI助手。" }
        },
        "regexRules": {
            "regex_example1": { "id": "...", "name": "示例正则", "pattern": "your-regex-pattern", "scopes": ["user", "assistant"], "enabled": true }
        },
        "appSettings": {
            "modelParams": { "temperature": 0.7, "top_p": 1, "enableTopK": false, "top_k": 50, "enableMinP": false, "min_p": 0.05, "max_tokens": 2048 }
        }
    };
    dom.importConfigTextarea.value = JSON.stringify(template, null, 2);
}

/**
 * 更准确地计算文本的token数量
 * 这是一个改进的实现，比简单的字符数除以4更准确
 *
 * @param {string} text - 要计算token数的文本
 * @returns {number} - 估算的token数量
 */
export function countTokens(text) {
    if (!text) return 0;

    // 处理空字符串
    text = text.trim();
    if (text.length === 0) return 0;

    // 处理thinking标签内容，特殊标签本身也占用tokens
    text = text.replace(/<thinking>(.*?)<\/thinking>/gs, (match, content) => {
        // thinking标签本身也占用一些tokens
        return content;
    });

    // 处理代码块，代码通常有更多的标点和特殊字符
    let codeBlockCount = 0;
    text = text.replace(/```[\s\S]*?```/g, (match) => {
        codeBlockCount += match.length / 3.5; // 代码的token比例略高于普通文本
        return '';
    });

    // 分别处理英文和中文
    const engPattern = /[a-zA-Z0-9]+/g;
    const engMatches = text.match(engPattern) || [];
    const engTokens = engMatches.join(' ').length / 4.5; // 英文单词约为4-5个字符一个token

    // 移除英文后计算中文和其他字符
    const nonEngText = text.replace(engPattern, '');

    // 中文字符通常1个字约等于1个token，标点符号和特殊字符按比例计算
    const chineseChars = nonEngText.length;
    const chineseTokens = chineseChars * 0.85; // 中文字符约1:1转换为token，但有些优化

    // 合并计算结果
    const estimatedTokens = Math.ceil(engTokens + chineseTokens + codeBlockCount);

    return estimatedTokens;
}

/**
/**
 * 判断指定楼层在隐藏配置下是否被隐藏（支持离散楼层列表）
 * @param {number} floor - 楼层编号 (1-indexed)
 * @param {object} hideConfig - 隐藏配置对象
 * @returns {boolean} 是否被隐藏
 */
export function isFloorHiddenInConfig(floor, hideConfig) {
    if (!hideConfig) return false;
    // 检查离散多楼层列表 hiddenFloors
    if (Array.isArray(hideConfig.hiddenFloors)) {
        return hideConfig.hiddenFloors.includes(floor);
    }
    return false;
}

/**
 * 判断指定消息在当前配置下是否被隐藏
 * 优先读取消息自身的 hidden 字段；若未显式设置，则回退检查 hideConfig 中的 hiddenFloors 规则
 * @param {object} message - 消息对象
 * @param {number} floor - 楼层编号 (1-indexed)
 * @param {object} hideConfig - 隐藏配置对象
 * @returns {boolean} 是否被隐藏
 */
export function isMessageHidden(message, floor, hideConfig) {
    // — 为什么这么写 —
    // 1. 优先以消息对象自身的 hidden 属性为准（精确到每条消息，支持单楼层/区间隐藏）。
    //    当用户在某一节点重新生成或创建新分支时，新生成的消息对象 hidden 默认为 undefined，
    //    绝不会错误复用/继承旧分支被丢弃节点遗留的隐藏状态。
    // 2. 若 message.hidden 未显式定义为布尔值，则回退检查 hideConfig.hiddenFloors 集合。
    // 3. 记忆总结注入开关 (hideConfig.enabled) 仅用于控制长期记忆是否注入给大模型上下文，
    //    绝不作为“是否隐藏楼层”的判定依据，彻底防止开启记忆注入时导致可见楼层误被标记为已隐藏。
    if (message && typeof message.hidden === 'boolean') {
        return message.hidden;
    }
    return isFloorHiddenInConfig(floor, hideConfig);
}

/**
 * 计算当前会话的各种统计信息。
 * 乌鸦：v4.0 优化 - 加入 MCP 分析结果和工具调用数据的统计，与实际发送给 API 的内容一致
 * @param {object} conversation - The current conversation object.
 * @param {object} hideSummaryConfig - The hideSummary configuration for the current conversation.
 * @returns {object} An object containing total and hidden character/token counts.
 */
export function calculateConversationStats(conversation, hideSummaryConfig) {
    let totalCharacters = 0;
    let totalEstimatedTokens = 0;
    let mainCharacters = 0;
    let mainTokens = 0;
    let thinkingCharacters = 0;
    let thinkingTokens = 0;

    let hiddenCharacters = 0;
    let hiddenEstimatedTokens = 0;
    // 乌鸦：MCP 专项统计
    let mcpAnalysisCharacters = 0;
    let mcpAnalysisTokens = 0;
    let mcpToolDataCharacters = 0;
    let mcpToolDataTokens = 0;
    let totalToolCalls = 0;
    // 乌鸦：附件专项统计
    let attachmentsCharacters = 0;
    let attachmentsTokens = 0;

    if (!conversation || !conversation.branches || conversation.branches.length === 0) {
        return {
            totalCharacters: 0, totalEstimatedTokens: 0,
            mainCharacters: 0, mainTokens: 0,
            thinkingCharacters: 0, thinkingTokens: 0,
            hiddenCharacters: 0, hiddenEstimatedTokens: 0,
            mcpAnalysisCharacters: 0, mcpAnalysisTokens: 0, mcpToolDataCharacters: 0, mcpToolDataTokens: 0, totalToolCalls: 0,
            attachmentsCharacters: 0, attachmentsTokens: 0
        };
    }

    const activeBranch = conversation.branches[conversation.activeBranchIndex];
    const isHiddenEnabled = hideSummaryConfig && hideSummaryConfig.enabled;
    const branchMessageStats = [];

    activeBranch.forEach((message, index) => {
        const rawContent = message.content || '';
        let msgCharCount = 0;
        let msgTokenCount = 0;

        let msgMainChars = 0;
        let msgMainTokens = 0;
        let msgThinkChars = 0;
        let msgThinkTokens = 0;

        // — 为什么这么写 —
        // 拆分 AI 消息中的思考过程（<thinking>标签 或 reasoning_content）与正文内容，
        // 精准单独计算思考过程与正文部分的字符数与 Tokens
        if (message.role === 'assistant') {
            let thinkText = '';
            if (message.reasoning_content && typeof message.reasoning_content === 'string') {
                thinkText = message.reasoning_content;
            } else if (Array.isArray(message.reasoningParts) && message.reasoningParts.length > 0) {
                thinkText = message.reasoningParts.map(p => p.content || '').join('\n');
            } else {
                const thinkMatch = rawContent.match(/<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>/i);
                if (thinkMatch) {
                    thinkText = thinkMatch[1] || '';
                }
            }

            // 正文内容（剥离思考标签）
            const mainText = rawContent.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '');
            msgMainChars = mainText.length;
            msgThinkChars = thinkText ? thinkText.length : 0;
            msgCharCount = msgMainChars + msgThinkChars;

            // 分别计算正文与思考过程的估算 Tokens
            const calcMainTokens = countTokens(mainText);
            const calcThinkTokens = thinkText ? countTokens(thinkText) : 0;
            const calcTotalTokens = calcMainTokens + calcThinkTokens;

            // — 为什么这么写 —
            // 当具备官方权威 usage (message.stats.tokenCount) 时，按估算出的正文与思考 Token 比例做“按权等比例分配 (Proportional Allocation)”。
            // 确保 正文Token + 思考Token 绝对 100% 刚好等于官方总Token，不会出现倒扣为0或相加不相等的数学矛盾。
            if (message.stats && typeof message.stats.tokenCount === 'number' && message.stats.tokenCount > 0) {
                const officialTotal = message.stats.tokenCount;
                if (calcTotalTokens > 0) {
                    msgMainTokens = Math.round(officialTotal * (calcMainTokens / calcTotalTokens));
                    msgThinkTokens = officialTotal - msgMainTokens;
                } else {
                    msgMainTokens = officialTotal;
                    msgThinkTokens = 0;
                }
                msgTokenCount = officialTotal;
            } else {
                msgMainTokens = calcMainTokens;
                msgThinkTokens = calcThinkTokens;
                msgTokenCount = calcTotalTokens;
            }
        } else {
            // 用户消息（全算作正文）
            msgMainChars = rawContent.length;
            msgMainTokens = countTokens(rawContent);
            msgCharCount = msgMainChars;
            msgTokenCount = msgMainTokens;
        }

        // 乌鸦：统计附件中的文本与代码数据（与 api-common.js 构造请求逻辑一致，属于正文扩展）
        let attachmentTextFull = '';
        if (Array.isArray(message.attachments) && message.attachments.length > 0) {
            message.attachments.forEach(att => {
                if (att && !att.isImage && att.content) {
                    attachmentTextFull += `\n\n--- 附件: ${att.name || ''} ---\n\`\`\`\n${att.content}\n\`\`\``;
                }
            });
        } else if (message.attachment && !message.attachment.isImage && message.attachment.content) {
            attachmentTextFull += `\n\n--- 附件: ${message.attachment.name || ''} ---\n\`\`\`\n${message.attachment.content}\n\`\`\``;
        }

        if (attachmentTextFull) {
            const attChars = attachmentTextFull.length;
            const attTokens = countTokens(attachmentTextFull);
            msgMainChars += attChars;
            msgMainTokens += attTokens;
            msgCharCount += attChars;
            msgTokenCount += attTokens;
            attachmentsCharacters += attChars;
            attachmentsTokens += attTokens;
        }

        // 乌鸦：统计 MCP 分析结果（analysisResult）
        if (message.role === 'assistant' && message.analysisResult) {
            const analysisText = message.analysisResult;
            const analysisChars = analysisText.length;
            const analysisTokens = countTokens(analysisText);
            msgMainChars += analysisChars;
            msgMainTokens += analysisTokens;
            msgCharCount += analysisChars;
            msgTokenCount += analysisTokens;
            mcpAnalysisCharacters += analysisChars;
            mcpAnalysisTokens += analysisTokens;
        }

        // 乌鸦：统计 MCP 工具调用数据（toolCalls）
        if (message.role === 'assistant' && message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            totalToolCalls += message.toolCalls.length;
            for (const toolCall of message.toolCalls) {
                if (toolCall && toolCall.tool) {
                    let toolText = `工具名称: ${toolCall.tool}\n调用状态: ${toolCall.success ? '成功' : '失败'}\n`;
                    if (toolCall.success && toolCall.data) {
                        try {
                            let resultStr = JSON.stringify(toolCall.data);
                            if (resultStr.length > 100000) {
                                resultStr = resultStr.substring(0, 100000);
                            }
                            toolText += resultStr;
                        } catch (e) { /* ignore */ }
                    }
                    const toolChars = toolText.length;
                    const toolTokens = countTokens(toolText);
                    msgMainChars += toolChars;
                    msgMainTokens += toolTokens;
                    msgCharCount += toolChars;
                    msgTokenCount += toolTokens;
                    mcpToolDataCharacters += toolChars;
                    mcpToolDataTokens += toolTokens;
                }
            }
        }

        mainCharacters += msgMainChars;
        mainTokens += msgMainTokens;
        thinkingCharacters += msgThinkChars;
        thinkingTokens += msgThinkTokens;

        totalCharacters += msgCharCount;
        totalEstimatedTokens += msgTokenCount;

        // 判断消息楼层是否在隐藏范围内 (1-indexed)
        const isHidden = isMessageHidden(message, index + 1, hideSummaryConfig);
        if (isHidden) {
            hiddenCharacters += msgCharCount;
            hiddenEstimatedTokens += msgTokenCount;
        }

        branchMessageStats.push({
            charCount: msgCharCount,
            tokenCount: msgTokenCount,
            isHidden
        });
    });

    // — 为什么这么写 —
    // 实际发送 Token 统计：
    // 1. 过滤掉所有已标记隐藏的楼层；
    // 2. 若设置了“发送消息数量限制”（messageLimit），仅截取最近 N 条未隐藏消息；
    // 3. 若启用了记忆总结，加上注入的系统级长期记忆提示词 Tokens。
    const visibleStats = branchMessageStats.filter(item => !item.isHidden);
    const messageLimit = hideSummaryConfig && typeof hideSummaryConfig.messageLimit === 'number' && hideSummaryConfig.messageLimit > 0
        ? hideSummaryConfig.messageLimit
        : 0;

    const actualSentList = messageLimit > 0
        ? visibleStats.slice(-messageLimit)
        : visibleStats;

    let actualSentCharacters = 0;
    let actualSentEstimatedTokens = 0;

    actualSentList.forEach(item => {
        actualSentCharacters += item.charCount;
        actualSentEstimatedTokens += item.tokenCount;
    });

    if (hideSummaryConfig && hideSummaryConfig.enabled) {
        const memoryPrompt = formatMemoryForApi(hideSummaryConfig);
        if (memoryPrompt && memoryPrompt.trim()) {
            actualSentCharacters += memoryPrompt.length;
            actualSentEstimatedTokens += countTokens(memoryPrompt);
        }
    }

    return {
        totalCharacters, totalEstimatedTokens,
        mainCharacters, mainTokens,
        thinkingCharacters, thinkingTokens,
        hiddenCharacters, hiddenEstimatedTokens,
        actualSentCharacters, actualSentEstimatedTokens,
        mcpAnalysisCharacters, mcpAnalysisTokens, mcpToolDataCharacters, mcpToolDataTokens, totalToolCalls,
        attachmentsCharacters, attachmentsTokens
    };
}

/**
 * 创建一个节流函数，在指定的时间间隔内最多执行一次 func。
 * 乌鸦：这是解决流式输出闪烁问题的核心工具。
 * @param {Function} func 要节流的函数。
 * @param {number} delay 节流的时间间隔（毫秒）。
 * @returns {Function} 返回一个新的节流化的函数。
 */
export function throttle(func, delay) {
    let timeoutId = null; // 用于存储定时器ID
    let lastArgs = null; // 用于存储最后一次的参数
    let lastThis = null; // 用于存储最后一次的this上下文

    // 为什么要有 inThrottle 标志：防止在延迟期间内，新的调用重新设置定时器
    let inThrottle = false;

    return function (...args) {
        lastArgs = args;
        lastThis = this;

        if (!inThrottle) {
            inThrottle = true;

            // 立即执行第一次
            func.apply(lastThis, lastArgs);

            // 设置定时器，在delay后解锁
            setTimeout(() => {
                inThrottle = false;
                // 为什么在这里要检查 lastArgs：确保在节流期间的最后一次调用能够被执行
                // 这就是所谓的“尾调用”优化，保证数据流停止后，最终状态能被正确渲染
                if (lastArgs) {
                    func.apply(lastThis, lastArgs);
                    lastArgs = null; // 清理，防止重复执行
                    lastThis = null;
                }
            }, delay);
        }
    };
}

/**
 * 创建一个防抖函数，延迟执行 func。
 * 乌鸦：与节流不同，防抖在事件触发后等待 delay 毫秒，如果期间没有新事件，才执行。非常适合输入框的实时校验。
 * @param {Function} func 要防抖的函数。
 * @param {number} delay 延迟执行的毫秒数。
 * @returns {Function} 返回一个新的防抖化的函数。
 */
export function debounce(func, delay) {
    let timeoutId = null;

    return function (...args) {
        const context = this;

        // 每次事件触发时，都清除之前的定时器
        clearTimeout(timeoutId);

        // 然后重新设置一个新的定时器
        timeoutId = setTimeout(() => {
            func.apply(context, args);
        }, delay);
    };
}

// ============= 思考内容提取工具函数 =============

/**
 * 思考内容段落对象
 * @typedef {Object} ReasoningPart
 * @property {string} content - 思考内容文本
 * @property {'field'|'inline'} source - 来源：'field'=API字段，'inline'=正文标签
 * @property {number} order - 在原文中的出现顺序
 */

/**
 * 乌鸦：流式输出时的思考内容解析器（支持未闭合标签）
 * 核心逻辑：检测到 <think> 开始标签就立即分流，不等闭合
 * @param {string} content - 累积的内容
 * @returns {{thinkingContent: string, mainContent: string, isThinkingComplete: boolean}}
 */
export function parseStreamingThinkContent(content) {
    if (!content || typeof content !== 'string') {
        return { thinkingContent: '', mainContent: '', isThinkingComplete: true };
    }

    // 查找 <think> 或 <thinking> 开始标签
    const thinkStartMatch = content.match(/<(think|thinking)\b[^>]*>/i);

    if (!thinkStartMatch) {
        // 没有思考标签，全部是正文
        return { thinkingContent: '', mainContent: content, isThinkingComplete: true };
    }

    const tagName = thinkStartMatch[1]; // 'think' 或 'thinking'
    const startTagEnd = thinkStartMatch.index + thinkStartMatch[0].length;
    const beforeThink = content.slice(0, thinkStartMatch.index);

    // 查找对应的闭合标签
    const endTagRegex = new RegExp(`</${tagName}>`, 'i');
    const afterStartTag = content.slice(startTagEnd);
    const endMatch = afterStartTag.match(endTagRegex);

    if (endMatch) {
        // 找到闭合标签 - 思考内容已完成
        const thinkingContent = afterStartTag.slice(0, endMatch.index);
        const afterThink = afterStartTag.slice(endMatch.index + endMatch[0].length);
        return {
            thinkingContent: thinkingContent.trim(),
            mainContent: (beforeThink + afterThink).trim(),
            isThinkingComplete: true
        };
    } else {
        // 没有闭合标签 - 思考内容还在继续
        const thinkingContent = afterStartTag;
        return {
            thinkingContent: thinkingContent,  // 不 trim，保留原始格式
            mainContent: beforeThink.trim(),
            isThinkingComplete: false
        };
    }
}

/**
 * 乌鸦：从内容中提取思考部分（针对正文中的标签）
 * 用于最终处理和历史消息渲染
 * @param {string} content - 原始内容
 * @returns {{reasoningParts: ReasoningPart[], mainContent: string}}
 */
export function extractThinkingFromContent(content) {
    if (!content || typeof content !== 'string') {
        return { reasoningParts: [], mainContent: content || '' };
    }

    const reasoningParts = [];
    let mainContent = content;
    let order = 0;

    // 乌鸦：匹配 <think>...</think> 或 <thinking>...</thinking>
    const thinkRegex = /<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>/gi;

    let match;
    while ((match = thinkRegex.exec(content)) !== null) {
        const extractedContent = match[2].trim();
        if (extractedContent) {
            reasoningParts.push({
                content: extractedContent,
                source: 'inline',
                order: order++
            });
        }
    }

    // 从正文中移除所有思考标签
    mainContent = content.replace(thinkRegex, '').trim();

    // 清理可能残留的多余空行
    mainContent = mainContent.replace(/\n{3,}/g, '\n\n');

    return {
        reasoningParts,
        mainContent
    };
}

/**
 * 乌鸦：合并来自API字段和正文标签的思考内容
 * @param {string|null} fieldReasoning - 来自 reasoning_content 字段的内容
 * @param {ReasoningPart[]} inlineParts - 来自正文标签的思考段落
 * @returns {ReasoningPart[]} 合并后的思考段落数组
 */
export function mergeReasoningParts(fieldReasoning, inlineParts = []) {
    const result = [];

    // 字段内容优先，放在最前面
    if (fieldReasoning && fieldReasoning.trim()) {
        result.push({
            content: fieldReasoning.trim(),
            source: 'field',
            order: -1  // 负数确保排在最前
        });
    }

    // 追加正文中的思考段落（已按出现顺序排列）
    result.push(...inlineParts);

    return result;
}
