/**
 * @file utils.js
 * @description Contains utility and helper functions for various tasks.
 */

import { state, DEFAULT_REGEX_RULES } from './state.js?v=temp';
import { regexPatterns } from './regex.js?v=temp';
import { dom } from './dom.js?v=temp';
// 导入所需的 UI 函数
import { openSettingsModal, renderApiEndpointsList, renderPersonaModal, renderRegexRulesList, renderWorldBookList } from './modals.js?v=temp';
import { populateApiSelector, populatePersonaSelector } from './renderer.js?v=temp';
import { updateWorldBookButton } from './ui-updater.js?v=temp';
import { saveConversation, getConversation, getAllConversationIds, deleteConversation, initAndMigrateWorldBook, saveAllWorldBookEntriesToDB } from './db.js?v=temp';
import { formatMemoryForApi, normalizeHideSummaryConfig } from './summary-manager.js?v=temp';
import { showBatchConflictResolutionDialog } from './modals/import-conflict-modal.js?v=temp';
import { initDefaultPersonasIfEmpty } from './preset-personas.js?v=temp';
import { DEFAULT_REALTIME_PROMPT, calculateVirtualDate, formatVirtualTimestamp, normalizeRealtimeConfig } from './services/realtime-mode.js?v=temp';
import { resolveDynamicVariables } from './services/dynamic-variable-engine.js?v=temp';
import { DEFAULT_TOOLS } from './mcp-tools-registry.js?v=temp';
import { buildSingleConversationData, buildConversationBundle } from './services/sync-bundle.js?v=temp';
import { applyRequestRegex } from './regex-engine.js?v=temp';

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
        // 保证 worldBook 每条 entry 都有 sessionIds、tags、position 与 order 字段
        let wbIndex = 0;
        Object.values(state.worldBook).forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
            if (!Array.isArray(entry.tags)) entry.tags = [];
            if (!entry.position) entry.position = 'top';
                entry.appendAllUser = Boolean(entry.appendAllUser);
            entry.appendAllUser = Boolean(entry.appendAllUser);
            if (typeof entry.order !== 'number') {
                entry.order = typeof entry.depth === 'number' ? entry.depth : (wbIndex + 1) * 10;
            }
            wbIndex++;
        });

        // 备忘录批量写入 IndexedDB 保证全局持久化
        if (state.worldBook && typeof state.worldBook === 'object') {
            try {
                await saveAllWorldBookEntriesToDB(Object.values(state.worldBook));
            } catch (err) {
                console.warn('saveToLocalStorage 写入 IndexedDB 失败，继续写入 LocalStorage:', err);
            }
        }

        // 其他设置仍保存到 localStorage
        localStorage.setItem('ai-chat-personas-v1', JSON.stringify(state.personas));
        localStorage.setItem('ai-chat-worldbook-v1', JSON.stringify(state.worldBook)); // 备忘录
        localStorage.setItem('ai-chat-api-endpoints-v1', JSON.stringify(state.apiEndpoints));
        localStorage.setItem('ai-chat-regex-rules-v1', JSON.stringify(state.regexRules));
        localStorage.setItem('ai-chat-hide-summary-v1', JSON.stringify(state.hideSummary || {}));
        // MCP全局设置（剔除会话隔离的 selectedTools，杜绝全局持久化污染）
        const mcpSettingsToSave = { ...(state.mcpSettings || {}) };
        delete mcpSettingsToSave.selectedTools;
        localStorage.setItem('ai-chat-mcp-settings-v1', JSON.stringify(mcpSettingsToSave)); // MCP设置
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
    // 首次使用时自动装载 22 款预设角色包
    initDefaultPersonasIfEmpty(state, saveToLocalStorage);

    try { // 备忘录 (已全面迁移至 IndexedDB)
        // — 为什么这么写 —
        // 备忘录数据已彻底迁移至 IndexedDB (worldbook_store)
        // 此处调用 initAndMigrateWorldBook：若数据库已有数据则异步直读；
        // 若数据库为空则自动从 localStorage 进行平滑无损迁移，老用户零感知、数据 100% 留存！
        await initAndMigrateWorldBook(state);
    } catch (e) {
        state.worldBook = {};
        console.error("Failed to load world book from IndexedDB:", e);
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
            const parsed = JSON.parse(savedMcpSettings);
            delete parsed.selectedTools; // 杜绝全局脏缓存恢复
            state.mcpSettings = { ...state.mcpSettings, ...parsed, selectedTools: [] };
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
    const convToExport = await buildSingleConversationData(conversationId);
    if (!convToExport) {
        alert('会话不存在或已被删除');
        return;
    }

    const configString = JSON.stringify(convToExport, null, 2);
    const blob = new Blob([configString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const sanitizedTitle = (convToExport.title || '对话').replace(/[\/:*?"<>|]/g, '_').substring(0, 50);
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
    let conversationsToExport;
    try {
        conversationsToExport = await buildConversationBundle();
    } catch (err) {
        console.error('打包所有会话失败:', err);
        alert('获取会话数据失败！');
        return;
    }

    if (!conversationsToExport || Object.keys(conversationsToExport.conversations).length === 0) {
        alert('没有会话可导出');
        return;
    }

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

        // 规整导入项字段（确保正则 rules 及 worldBook 字段格式标准与向后兼容）
        const normalizeImportedItem = (entry, newId, newName) => {
            const base = { ...entry.item, id: newId, name: newName };
            if (entry.category === 'regex') {
                base.scope = base.scope || 'global';
                base.sessionIds = Array.isArray(base.sessionIds) ? base.sessionIds : [];
            } else if (entry.category === 'worldBook') {
                base.position = base.position || 'top';
                base.appendAllUser = Boolean(base.appendAllUser);
                base.sessionIds = Array.isArray(base.sessionIds) ? base.sessionIds : [];
                base.tags = Array.isArray(base.tags) ? base.tags : [];
                if (typeof base.depth !== 'number') base.depth = 10;
                if (typeof base.order !== 'number') {
                    base.order = typeof base.depth === 'number' ? base.depth : Date.now();
                }
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
            import('./settings/bubble-settings.js?v=temp').then(module => {
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
/**
 * 智能比对两个备忘录/世界书条目的实质内容是否完全一致
 *
 * — 为什么这么设计 —
 * 1. 严格遵循大爷指示：如果 ID 一样且各项内容完全一样就不打扰用户，静默通过；有一点不一样才弹窗让用户负责抉择。
 * 2. 核心排除 sessionIds：sessionIds 是运行时关联的会话列表，各端或多次导入必然不同，绝不能作为内容冲突的依据。
 * 3. 规范化比对：文本去前后空格，数组排序去重后比对，避免格式微小差异导致虚假冲突。
 *
 * @param {object} localWb - 本地现有备忘录条目
 * @param {object} incomingWb - 待导入的备忘录条目
 * @returns {boolean} 是否 100% 内容一致
 */
export function isWorldBookContentIdentical(localWb, incomingWb) {
    if (!localWb || !incomingWb) return false;

    // 1. 核心属性与文本比对
    if (String(localWb.name || '').trim() !== String(incomingWb.name || '').trim()) return false;
    if (String(localWb.content || '').trim() !== String(incomingWb.content || '').trim()) return false;
    if (String(localWb.position || '') !== String(incomingWb.position || '')) return false;
    if (String(localWb.role || '') !== String(incomingWb.role || '')) return false;
    if (Boolean(localWb.enabled) !== Boolean(incomingWb.enabled)) return false;
    if (Number(localWb.depth || 0) !== Number(incomingWb.depth || 0)) return false;

    // 2. 触发关键词 (keys) 数组比对 (排序后比对，忽略顺序差异)
    const keys1 = Array.isArray(localWb.keys)
        ? localWb.keys.map(k => String(k).trim()).filter(Boolean).sort()
        : (localWb.keys ? [String(localWb.keys).trim()] : []);
    const keys2 = Array.isArray(incomingWb.keys)
        ? incomingWb.keys.map(k => String(k).trim()).filter(Boolean).sort()
        : (incomingWb.keys ? [String(incomingWb.keys).trim()] : []);
    if (keys1.length !== keys2.length) return false;
    for (let i = 0; i < keys1.length; i++) {
        if (keys1[i] !== keys2[i]) return false;
    }

    // 3. 标签 (tags) 数组比对
    const tags1 = Array.isArray(localWb.tags)
        ? localWb.tags.map(t => String(t).trim()).filter(Boolean).sort()
        : (localWb.tags ? [String(localWb.tags).trim()] : []);
    const tags2 = Array.isArray(incomingWb.tags)
        ? incomingWb.tags.map(t => String(t).trim()).filter(Boolean).sort()
        : (incomingWb.tags ? [String(incomingWb.tags).trim()] : []);
    if (tags1.length !== tags2.length) return false;
    for (let i = 0; i < tags1.length; i++) {
        if (tags1[i] !== tags2[i]) return false;
    }

    return true;
}

/**
 * 智能比对两个正则规则实质内容是否 100% 一致（排除运行时生成的临时 ID 与关联会话）
 * @param {object} local - 本地规则
 * @param {object} incoming - 待导入规则
 * @returns {boolean}
 */
export function isRegexContentIdentical(local, incoming) {
    if (!local || !incoming) return false;
    // 1. 查找式与替换式
    if (String(local.find ?? '') !== String(incoming.find ?? '')) return false;
    if (String(local.replace ?? '') !== String(incoming.replace ?? '')) return false;
    // 2. 规则名称
    if (String(local.name ?? '').trim() !== String(incoming.name ?? '').trim()) return false;
    // 3. 开关状态
    const e1 = local.enabled !== false && !local.disabled;
    const e2 = incoming.enabled !== false && !incoming.disabled;
    if (e1 !== e2) return false;
    // 4. 作用域 (排序比对，忽略顺序差异)
    const s1 = Array.isArray(local.scopes) ? [...local.scopes].sort().join(',') : '';
    const s2 = Array.isArray(incoming.scopes) ? [...incoming.scopes].sort().join(',') : '';
    if (s1 !== s2) return false;
    // 5. 执行阶段
    const stage1 = local.stage || 'post-markdown';
    const stage2 = incoming.stage || 'post-markdown';
    if (stage1 !== stage2) return false;
    // 6. 排序与生效楼层
    if (Number(local.sort || 0) !== Number(incoming.sort || 0)) return false;
    if (Number(local.minFloor || 0) !== Number(incoming.minFloor || 0)) return false;
    if (Number(local.maxFloor || 0) !== Number(incoming.maxFloor || 0)) return false;
    return true;
}

/**
 * 严格比对两个会话的实质聊天记录与核心配置是否 100% 一致（用于导入与云同步冲突探测）
 * @param {object} local - 本地会话对象
 * @param {object} incoming - 待导入/云端会话对象
 * @returns {boolean} true: 完全相同 (无冲突)；false: 存在实质差异 (需调起决策面板)
 */
export function isConversationContentIdentical(local, incoming) {
    if (!local || !incoming) return false;

    // 1. 比对标题
    if ((local.title || '').trim() !== (incoming.title || '').trim()) return false;

    // 2. 比对置顶与系统提示词
    if (!!local.pinned !== !!incoming.pinned) return false;
    if ((local.systemPrompt || '') !== (incoming.systemPrompt || '')) return false;

    // 3. 比对活动分支索引与分支总数
    const localBranches = Array.isArray(local.branches) ? local.branches : [];
    const incomingBranches = Array.isArray(incoming.branches) ? incoming.branches : [];
    if (localBranches.length !== incomingBranches.length) return false;

    const localActiveIdx = (typeof local.activeBranchIndex === 'number') ? local.activeBranchIndex : 0;
    const incomingActiveIdx = (typeof incoming.activeBranchIndex === 'number') ? incoming.activeBranchIndex : 0;
    if (localActiveIdx !== incomingActiveIdx) return false;

    // 4. 比对活动分支消息
    const localActive = Array.isArray(localBranches[localActiveIdx]) ? localBranches[localActiveIdx] : (localBranches[0] || []);
    const incomingActive = Array.isArray(incomingBranches[incomingActiveIdx]) ? incomingBranches[incomingActiveIdx] : (incomingBranches[0] || []);
    if (localActive.length !== incomingActive.length) return false;

    // 逐条比对消息角色与文本正文
    for (let i = 0; i < localActive.length; i++) {
        const a = localActive[i];
        const b = incomingActive[i];
        if (!a || !b) {
            if (a !== b) return false;
            continue;
        }
        if (a.role !== b.role) return false;
        if (String(a.content || '') !== String(b.content || '')) return false;
    }

    return true;
}

export async function importConversations(conversationsToImport, bundleMetadata = {}, options = {}) {
    const {
        titleSuffix = ' (已导入)',
        silent = false,
        syncOrigin = null,
        checkWbConflicts = true,
        checkConvConflicts = true
    } = options;

    if (!Array.isArray(conversationsToImport) || conversationsToImport.length === 0) {
        if (!silent) alert('没有选择要导入的会话。');
        return null;
    }

    if (!state.worldBook || typeof state.worldBook !== 'object') {
        state.worldBook = {};
    }
    if (!state.hideSummary || typeof state.hideSummary !== 'object') {
        state.hideSummary = {};
    }

    // =========================================================================
    // 阶段 1：前置收集所有待导入备忘录，并执行智能差分检查 (手机/桌面双模弹窗)
    // =========================================================================
    const incomingWbMap = new Map();
    if (bundleMetadata.worldBook && typeof bundleMetadata.worldBook === 'object') {
        Object.entries(bundleMetadata.worldBook).forEach(([id, item]) => {
            if (item && id) incomingWbMap.set(id, { ...item, id });
        });
    }
    conversationsToImport.forEach(conv => {
        if (conv && Array.isArray(conv.relatedWorldBook)) {
            conv.relatedWorldBook.forEach(item => {
                if (item && item.id) incomingWbMap.set(item.id, item);
            });
        }
    });

    // 收集待导入的正则规则（包含全局与专属）
    const incomingRegexMap = new Map();
    if (bundleMetadata.regexRules && typeof bundleMetadata.regexRules === 'object') {
        Object.entries(bundleMetadata.regexRules).forEach(([id, item]) => {
            if (item && id) incomingRegexMap.set(id, { ...item, id });
        });
    }
    if (bundleMetadata.sessionRegexRules && typeof bundleMetadata.sessionRegexRules === 'object') {
        Object.entries(bundleMetadata.sessionRegexRules).forEach(([id, item]) => {
            if (item && id && !incomingRegexMap.has(id)) incomingRegexMap.set(id, { ...item, id });
        });
    }
    conversationsToImport.forEach(conv => {
        if (conv && Array.isArray(conv.relatedRegexRules)) {
            conv.relatedRegexRules.forEach(item => {
                if (item && item.id && !incomingRegexMap.has(item.id)) incomingRegexMap.set(item.id, item);
            });
        }
        if (conv && Array.isArray(conv.sessionRegexRules)) {
            conv.sessionRegexRules.forEach(item => {
                if (item && item.id && !incomingRegexMap.has(item.id)) incomingRegexMap.set(item.id, item);
            });
        }
    });

    const conflicts = [];
    const wbIdRedirectMap = new Map(); // 用于 keep_both 时重定向旧 ID -> 新副本 ID
    const regexIdRedirectMap = new Map(); // 用于 keep_both 时重定向旧正则 ID -> 新副本 ID
    let conflictDecisions = {};

    // 1. 比对备忘录冲突
    if (checkWbConflicts && incomingWbMap.size > 0) {
        incomingWbMap.forEach((incomingWb, wbId) => {
            const localWb = state.worldBook[wbId];
            if (!localWb) return;

            // 本地存在：比对实质内容（严格排除 sessionIds）
            if (!isWorldBookContentIdentical(localWb, incomingWb)) {
                conflicts.push({
                    key: wbId,
                    category: 'worldBook',
                    name: incomingWb.name || localWb.name || wbId,
                    id: wbId,
                    item: incomingWb,
                    target: state.worldBook,
                    prefix: ''
                });
            }
        });
    }

    // 2. 比对正则规则冲突
    if (checkWbConflicts && incomingRegexMap.size > 0 && state.regexRules) {
        const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
        incomingRegexMap.forEach((incomingRule, rId) => {
            // 乌鸦：如果待导入的是系统内置默认规则，直接跳过，绝不与本地冲突
            if (defaultRuleKeys.includes(rId) || incomingRule.isDefault) return;

            // 乌鸦：寻找本地对应自定义规则
            // — 为什么这么写 —
            // 1. 绝对隔离系统默认规则：本地任何默认规则神圣不可侵犯，绝不可作为冲突目标被覆盖。
            // 2. 匹配本地已有规则的依据必须精准：
            //    - 优先：本地存在相同且非默认规则的 key (state.regexRules[rId])；
            //    - 次选：本地存在名称完全相同 (name 相同) 且同属自定义规则的条目。
            //    - 严禁使用 r.find === incomingRule.find 作为判定同一规则的依据！
            //      因为不同阶段/不同作用域下使用相同正则匹配处理文本是标准模式（例如展示时渲染成卡片，发送时剔除标签）。
            let localTarget = null;
            let matchedLocalKey = null;

            if (state.regexRules[rId] && !defaultRuleKeys.includes(rId) && !state.regexRules[rId].isDefault) {
                localTarget = state.regexRules[rId];
                matchedLocalKey = rId;
            } else {
                // 次选：仅按规则名称精准匹配非默认的自定义规则
                const found = Object.entries(state.regexRules).find(([k, r]) => {
                    if (!r || defaultRuleKeys.includes(k) || r.isDefault) return false;
                    return r.name && incomingRule.name && r.name.trim() === incomingRule.name.trim();
                });
                if (found) {
                    matchedLocalKey = found[0];
                    localTarget = found[1];
                }
            }

            if (!localTarget) return; // 本地无此自定义规则，后续安全新增，不报冲突

            // 实质内容比对：若内容不同则提示冲突
            if (!isRegexContentIdentical(localTarget, incomingRule)) {
                conflicts.push({
                    key: matchedLocalKey,
                    category: 'regex',
                    name: incomingRule.name || localTarget.name || matchedLocalKey,
                    id: matchedLocalKey,
                    item: incomingRule,
                    target: state.regexRules,
                    prefix: ''
                });
            }
        });
    }

    if (conflicts.length > 0) {
        try {
            const { showBatchConflictResolutionDialog } = await import('./modals/import-conflict-modal.js?v=temp');
            conflictDecisions = await showBatchConflictResolutionDialog(conflicts);
            if (!conflictDecisions) {
                // 用户在弹窗中点击了【取消】
                return silent ? { success: false, count: 0, cancelled: true } : null;
            }
        } catch (err) {
            console.error('[importConversations] 调起冲突决策弹窗异常:', err);
        }
    }

    // -------------------------------------------------------------------------
    // 会话覆盖冲突检查 (当本地存在同 ID 且非删除态的不同版本会话时触发)
    // -------------------------------------------------------------------------
    const convConflicts = [];
    if (checkConvConflicts) {
        conversationsToImport.forEach(conv => {
            if (!conv || !conv.id) return;
            const localConv = state.conversations[conv.id];
            // 只有当本地存在且未被移入回收站，且实质内容存在差异时才触发覆盖冲突
            if (localConv && !localConv.isDeleted && !isConversationContentIdentical(localConv, conv)) {
                convConflicts.push({
                    convId: conv.id,
                    title: conv.title || localConv.title || '未命名对话',
                    localConv,
                    incomingConv: conv
                });
            }
        });
    }

    let convConflictDecisions = options.convConflictDecisions || null;
    if (!convConflictDecisions && convConflicts.length > 0) {
        try {
            const { showConversationConflictDialog } = await import('./modals/sync-conflict-modal.js?v=temp');
            convConflictDecisions = await showConversationConflictDialog(convConflicts);
            if (!convConflictDecisions) {
                // 用户在冲突决策面板点击了【取消】
                return silent ? { success: false, count: 0, cancelled: true } : null;
            }
        } catch (err) {
            console.error('[importConversations] 调起会话冲突决策弹窗异常:', err);
        }
    }

    if (!convConflictDecisions) convConflictDecisions = {};
    let importedCount = 0;
    let identicalCount = 0; // 记录本地已有且内容 100% 完全一致的跳过会话数
    let lastImportedId = null;
    let hasWorldBookUpdated = false;
    let hasRegexUpdated = false;
    const timestamp = new Date().toISOString();
    const batchSize = 10;

    // 统一将决定的备忘录预处理入库
    incomingWbMap.forEach((incomingWb, wbId) => {
        const localWb = state.worldBook[wbId];
        if (!localWb) {
            // 本地完全无此条目，直接安全新增
            state.worldBook[wbId] = JSON.parse(JSON.stringify(incomingWb));
            if (!Array.isArray(state.worldBook[wbId].sessionIds)) {
                state.worldBook[wbId].sessionIds = [];
            }
            hasWorldBookUpdated = true;
            return;
        }

        const decision = conflictDecisions[wbId] || 'keep_both';
        if (decision === 'overwrite') {
            // 覆盖：更新内容，合并两端的关联 sessionIds
            const existingSessions = Array.isArray(localWb.sessionIds) ? [...localWb.sessionIds] : [];
            state.worldBook[wbId] = {
                ...JSON.parse(JSON.stringify(incomingWb)),
                sessionIds: existingSessions
            };
            hasWorldBookUpdated = true;
        } else if (decision === 'keep_both' && conflicts.some(c => c.id === wbId)) {
            // 保留两者：生成全新的副本 ID 与副本条目
            const copyId = `wb_sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const copyItem = JSON.parse(JSON.stringify(incomingWb));
            copyItem.id = copyId;
            copyItem.name = `${incomingWb.name || '备忘录'} (同步副本)`;
            copyItem.sessionIds = [];
            state.worldBook[copyId] = copyItem;
            wbIdRedirectMap.set(wbId, copyId);
            hasWorldBookUpdated = true;
        }
        // 若为 skip，本地保持原样，无需写入
    });

    // 统一将决定的正则规则预处理入库
    incomingRegexMap.forEach((incomingRule, origRuleId) => {
        // 乌鸦：如果待导入项是系统内置默认规则，直接跳过，保持本地默认规则原汁原味
        const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
        if (defaultRuleKeys.includes(origRuleId) || incomingRule.isDefault) return;

        let localKey = origRuleId;
        let localRule = null;
        if (state.regexRules[localKey] && !defaultRuleKeys.includes(localKey) && !state.regexRules[localKey].isDefault) {
            localRule = state.regexRules[localKey];
        } else {
            // 次选：仅按规则名称精准匹配非默认的自定义规则
            const found = Object.entries(state.regexRules).find(([k, r]) => {
                if (!r || defaultRuleKeys.includes(k) || r.isDefault) return false;
                return r.name && incomingRule.name && r.name.trim() === incomingRule.name.trim();
            });
            if (found) {
                localKey = found[0];
                localRule = found[1];
            }
        }

        if (!localRule) {
            // 本地无此自定义规则：直接安全新增入库
            // — 为什么这么写 —
            // 若导入的规则 ID 碰巧与本地内置默认规则撞名（例如旧版本或测试环境导出的命名冲突），
            // 必须动态分配全新 safeRuleId，绝不覆写或污染本地系统默认规则！
            const isCollidingWithDefault = defaultRuleKeys.includes(origRuleId) || (state.regexRules[origRuleId] && state.regexRules[origRuleId].isDefault);
            const safeRuleId = isCollidingWithDefault
                ? ('regex_custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))
                : origRuleId;
            const newRule = JSON.parse(JSON.stringify(incomingRule));
            newRule.id = safeRuleId;
            state.regexRules[safeRuleId] = newRule;
            if (safeRuleId !== origRuleId) {
                regexIdRedirectMap.set(origRuleId, safeRuleId);
            }
            hasRegexUpdated = true;
            return;
        }

        const decision = conflictDecisions[localKey] || 'keep_both';
        if (decision === 'overwrite') {
            const existingSessions = Array.isArray(localRule.sessionIds) ? [...localRule.sessionIds] : [];
            state.regexRules[localKey] = {
                ...JSON.parse(JSON.stringify(incomingRule)),
                id: localKey,
                sessionIds: incomingRule.scope === 'session' ? existingSessions : (incomingRule.sessionIds || [])
            };
            hasRegexUpdated = true;
        } else if (decision === 'keep_both' && conflicts.some(c => c.key === localKey || c.id === localKey)) {
            // 都保留：新建 (同步副本) 规则
            const copyId = 'regex_sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const copyRule = JSON.parse(JSON.stringify(incomingRule));
            copyRule.id = copyId;
            copyRule.name = (incomingRule.name || '正则规则') + ' (同步副本)';
            if (copyRule.scope === 'session') {
                copyRule.sessionIds = [];
            }
            state.regexRules[copyId] = copyRule;
            regexIdRedirectMap.set(origRuleId, copyId);
            regexIdRedirectMap.set(localKey, copyId);
            hasRegexUpdated = true;
        }
        // 若为 skip，保持本地修改，无需写入
    });

    for (let i = 0; i < conversationsToImport.length; i++) {
        const conv = conversationsToImport[i];

        if (!conv.id || !conv.branches || !Array.isArray(conv.branches)) {
            console.warn('跳过一个无效的会话数据:', conv);
            continue;
        }

        const oldConvId = conv.id;
        const isConflict = convConflicts.some(c => c.convId === oldConvId);
        const decision = isConflict ? (convConflictDecisions[oldConvId] || 'keep_both') : null;

        if (decision === 'skip') {
            continue;
        }

        let newId = oldConvId;
        let formattedTitle = conv.title || '对话';

        if (decision === 'overwrite') {
            // 覆盖策略：原本地版本作为备份软删除移入回收站（保留10天）
            const localConv = state.conversations[oldConvId];
            if (localConv) {
                try {
                    const { trashManager } = await import('./services/trash-manager.js?v=temp');
                    await trashManager.moveToTrash(localConv, { isBackup: true, silent: true });
                } catch (trashErr) {
                    console.warn('[importConversations] 备份旧会话至回收站失败:', trashErr);
                }
            }
            newId = oldConvId;
            formattedTitle = conv.title || '对话';
        } else if (decision === 'keep_both') {
            // 保留两者策略：生成全新独立 ID 并附加 (同步副本) 后缀
            newId = `conv_import_${Date.now()}_${importedCount}`;
            const baseTitle = conv.title || '对话';
            formattedTitle = `${baseTitle} (同步副本)`;
        } else {
            // 无冲突分支：若本地已存在（且未删除）
            if (state.conversations[oldConvId] && !state.conversations[oldConvId].isDeleted) {
                // — 为什么这么写 —
                // 1. 若来源于云同步快照恢复 (syncOrigin 存在)，且实质聊天内容与本地完全一致 (isConversationContentIdentical 为 true)：
                //    说明本地已经是最新状态，直接跳过此会话，绝不制造带 (同步 YYYY/MM/DD) 后缀的垃圾重复副本！
                // 2. 若来源于常规外部文件导入（如导入备份 JSON），则保留另存为新副本的逻辑以防覆盖。
                if (syncOrigin && isConversationContentIdentical(state.conversations[oldConvId], conv)) {
                    identicalCount++;
                    continue;
                }

                newId = `conv_import_${Date.now()}_${importedCount}`;
                const suffix = typeof titleSuffix === 'string' ? titleSuffix : '';
                formattedTitle = suffix ? `${conv.title || '对话'}${suffix}` : (conv.title || '对话');
            } else {
                newId = oldConvId;
                formattedTitle = conv.title || '对话';
            }
        }

        const newConversation = {
            ...conv,
            id: newId,
            title: formattedTitle,
            selectedMcpTools: Array.isArray(conv.selectedMcpTools) ? [...conv.selectedMcpTools] : [],
            lastModified: timestamp,
            importedAt: timestamp
        };

        // 恢复并完整规范化实时模式与虚拟历法时间配置 (conv.realtimeMode)
        // — 为什么这么写 —
        // 保证导入/云端同步落地的会话对象中完整包含 enabled、历法年月日、星期开关、时间粒度、提示词及模板，
        // 无论源端导出是全量还是旧版缺损字段，经 normalizeRealtimeConfig 规范化后均处于安全完备状态。
        if (conv.realtimeMode && (typeof conv.realtimeMode === 'object' || typeof conv.realtimeMode === 'string')) {
            newConversation.realtimeMode = normalizeRealtimeConfig(conv.realtimeMode);
        }

        if (syncOrigin) {
            newConversation.syncOrigin = syncOrigin;
        }

        // 清理会话中挂载的临时附属属性，保持数据纯净
        delete newConversation.relatedWorldBook;
        delete newConversation.hideSummary;
        delete newConversation.sessionRegexRules;

        // 2. 恢复并映射局部关联的备忘录 (Smart Bundle 联动，考虑副本重定向)
        if (Array.isArray(conv.relatedWorldBook) && conv.relatedWorldBook.length > 0) {
            conv.relatedWorldBook.forEach(wbEntry => {
                if (!wbEntry || !wbEntry.id) return;
                const targetWbId = wbIdRedirectMap.get(wbEntry.id) || wbEntry.id;
                const targetWb = state.worldBook[targetWbId];
                if (targetWb) {
                    if (!Array.isArray(targetWb.sessionIds)) {
                        targetWb.sessionIds = [];
                    }
                    if (!targetWb.sessionIds.includes(newId)) {
                        targetWb.sessionIds.push(newId);
                        hasWorldBookUpdated = true;
                    }
                }
            });
        }

        // B. 从全量 bundleMetadata.worldBook 中映射旧 ID 到新 ID (严格支持 keep_both 副本重定向)
        if (bundleMetadata.worldBook && typeof bundleMetadata.worldBook === 'object') {
            Object.entries(bundleMetadata.worldBook).forEach(([origWbId, origEntry]) => {
                if (origEntry && Array.isArray(origEntry.sessionIds) && origEntry.sessionIds.includes(oldConvId)) {
                    // 若存在冲突且选择「都保留」，新会话应绑定到副本条目，而非污染原条目
                    const effectiveWbId = wbIdRedirectMap.get(origWbId) || origWbId;
                    const targetEntry = state.worldBook[effectiveWbId];
                    if (targetEntry) {
                        if (!Array.isArray(targetEntry.sessionIds)) {
                            targetEntry.sessionIds = [];
                        }
                        if (!targetEntry.sessionIds.includes(newId)) {
                            targetEntry.sessionIds.push(newId);
                            hasWorldBookUpdated = true;
                        }
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

        // 4. 恢复并映射该会话绑定的专属正则 (严格支持 keep_both 副本映射与去重)
        const candidateRules = [];
        if (Array.isArray(conv.sessionRegexRules)) candidateRules.push(...conv.sessionRegexRules);
        if (Array.isArray(conv.relatedRegexRules)) candidateRules.push(...conv.relatedRegexRules);
        if (bundleMetadata.sessionRegexRules && typeof bundleMetadata.sessionRegexRules === 'object') {
            Object.values(bundleMetadata.sessionRegexRules).forEach(r => {
                if (r && Array.isArray(r.sessionIds) && r.sessionIds.includes(oldConvId)) {
                    candidateRules.push(r);
                }
            });
        }

        candidateRules.forEach(rule => {
            if (!rule || !rule.id) return;
            if (rule.scope !== 'session') return; // 全局规则自然生效，无需记录 sessionId

            const effectiveRuleId = regexIdRedirectMap.get(rule.id) || rule.id;
            const targetRule = state.regexRules[effectiveRuleId];
            if (targetRule) {
                if (!Array.isArray(targetRule.sessionIds)) targetRule.sessionIds = [];
                if (!targetRule.sessionIds.includes(newId)) {
                    targetRule.sessionIds.push(newId);
                    hasRegexUpdated = true;
                }
            }
        });

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

    // 统一自动无感刷新侧边栏历史会话列表（全入口公用：系统设置/云同步等）
    try {
        const { renderHistory } = await import('./sidebar.js?v=temp');
        if (typeof renderHistory === 'function') {
            renderHistory();
        }
    } catch (e) {
        console.warn('[importConversations] 刷新侧边栏异常:', e);
    }

    // 统一触发全动态 UI 更新（包含顶部实时模式按钮高亮、会话Token徽章等）
    try {
        const { updateAllDynamicUI } = await import('./ui-updater.js?v=temp');
        if (typeof updateAllDynamicUI === 'function') {
            updateAllDynamicUI();
        }
    } catch (e) {
        console.warn('[importConversations] 刷新动态UI异常:', e);
    }

    // 如果当前活动会话在本次导入中被覆盖或更新，即时重新渲染主聊天消息
    if (state.currentConversationId && state.conversations[state.currentConversationId]) {
        try {
            const { renderChatMessages } = await import('./renderer.js?v=temp');
            if (typeof renderChatMessages === 'function') {
                renderChatMessages();
            }
        } catch (_) {}
    }

    if (importedCount > 0) {
        if (!silent) {
            alert(`成功导入 ${importedCount} 个会话！${hasWorldBookUpdated ? '（关联备忘录已同步恢复）' : ''}`);
        }
        return silent ? { success: true, count: importedCount, lastImportedId, identicalCount } : lastImportedId;
    } else {
        if (!silent) {
            if (identicalCount > 0) {
                alert('本地已有完全一致的会话记录，无需重复导入。');
            } else {
                alert('未导入任何有效的会话。');
            }
        }
        return (silent && identicalCount > 0) ? { success: true, count: 0, identicalCount, allIdentical: true } : null;
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
            actualSentCharacters: 0, actualSentEstimatedTokens: 0,
            actualSentMainTokens: 0, actualSentMainCharacters: 0,
            actualSentSystemTokens: 0, actualSentSystemCharacters: 0,
            personaTokens: 0, personaCharacters: 0,
            worldBookTokens: 0, worldBookCharacters: 0,
            summaryTokens: 0, summaryCharacters: 0,
            dbContextTokens: 0, dbContextCharacters: 0,
            mcpToolsTokens: 0, mcpToolsCharacters: 0,
            mcpAnalysisCharacters: 0, mcpAnalysisTokens: 0, mcpToolDataCharacters: 0, mcpToolDataTokens: 0, totalToolCalls: 0,
            attachmentsCharacters: 0, attachmentsTokens: 0,
            regexExcludedTokens: 0, regexExcludedCharacters: 0
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

        // 组装用于实际发送与正则过滤的纯正文 (剥离思考标签，含文本附件)
        const pureMainText = (message.role === 'assistant'
            ? rawContent.replace(/<(?:thinking|think)>[\s\S]*?<\/(?:thinking|think)>/gi, '')
            : rawContent) + (attachmentTextFull || '');

        branchMessageStats.push({
            role: message.role || 'user',
            mainText: pureMainText,
            charCount: msgCharCount,
            tokenCount: msgTokenCount,
            mainChars: msgMainChars,
            mainTokens: msgMainTokens,
            isHidden
        });
    });

    // — 为什么这么写 —
    // 实际发送 Token 统计 (Plan A 核心纠偏)：
    // 1. 过滤掉所有已标记隐藏的楼层；
    // 2. 若设置了“发送消息数量限制”（messageLimit），仅截取最近 N 条未隐藏消息；
    // 3. 【核心纠偏 1】：历史消息发给 API 时，AI 回复只传递纯正文，思考过程（Thinking/Reasoning）绝不发给大模型，因此只累加 mainTokens 与 mainChars；
    // 4. 【核心纠偏 2】：将真实注入模型上下文的系统级提示词（角色人设、备忘录、长期记忆总结、数据库上下文、MCP工具描述）全额纳入。
    const visibleStats = branchMessageStats.filter(item => !item.isHidden);
    const messageLimit = hideSummaryConfig && typeof hideSummaryConfig.messageLimit === 'number' && hideSummaryConfig.messageLimit > 0
        ? hideSummaryConfig.messageLimit
        : 0;

    const actualSentList = messageLimit > 0
        ? visibleStats.slice(-messageLimit)
        : visibleStats;

    // — 为什么这么写 —
    // 实际发送 Token 统计接入正则表达式排除过滤 (Plan A 核心演进)：
    // 真实 API 发送前会调用 applyRequestRegex 剔除匹配到的正文内容（如剔除 options 标签、移除历史正文）。
    // 若不排除正则过滤，Token 统计将脱离实际发送严重虚高。
    // 此处严格对齐 API 真实链路：对待发送的可见正文列表应用 request 正则过滤，
    // 精确重算实际发送正文 Tokens 与字符数，并统计正则排除削减的差额 (regexExcludedTokens / regexExcludedCharacters)。
    const convId = conversation.id || state.currentConversationId;
    const messagesToFilter = actualSentList.map(item => ({
        role: item.role,
        content: item.mainText
    }));

    const filteredMessages = applyRequestRegex(messagesToFilter, convId);

    let actualSentMainCharacters = 0;
    let actualSentMainTokens = 0;
    let regexExcludedTokens = 0;
    let regexExcludedCharacters = 0;

    actualSentList.forEach((item, idx) => {
        const filteredItem = filteredMessages[idx];
        if (filteredItem && filteredItem.regexModified && filteredItem.content !== item.mainText) {
            const filteredChars = filteredItem.content.length;
            const filteredTokens = countTokens(filteredItem.content);
            actualSentMainCharacters += filteredChars;
            actualSentMainTokens += filteredTokens;
            regexExcludedCharacters += Math.max(0, item.mainChars - filteredChars);
            regexExcludedTokens += Math.max(0, item.mainTokens - filteredTokens);
        } else {
            actualSentMainCharacters += item.mainChars;
            actualSentMainTokens += item.mainTokens;
        }
    });

    // 1. 统计角色提示词 (Persona)
    let personaCharacters = 0;
    let personaTokens = 0;
    if (conversation.personaId && state.personas && state.personas[conversation.personaId]) {
        const personaPrompt = state.personas[conversation.personaId].prompt || '';
        if (personaPrompt.trim()) {
            personaCharacters = personaPrompt.length;
            personaTokens = countTokens(personaPrompt);
        }
    }

    // 2. 统计启用的备忘录 (WorldBook，支持宏解析求值)
    let worldBookCharacters = 0;
    let worldBookTokens = 0;
    const enabledWorldBookEntries = Object.values(state.worldBook || {}).filter(entry => {
        if (!entry) return false;
        if (entry.enabled) return true;
        if (Array.isArray(entry.sessionIds) && entry.sessionIds.includes(convId)) return true;
        return false;
    });

    const dynamicContext = {
        currentConv: conversation,
        apiEndpoint: (state.apiEndpoints && conversation.apiEndpointId) ? state.apiEndpoints[conversation.apiEndpointId] : null
    };

    enabledWorldBookEntries.forEach(entry => {
        const rawText = entry.content || '';
        let resolvedText = rawText;
        try {
            resolvedText = resolveDynamicVariables(rawText, dynamicContext);
        } catch (e) {
            resolvedText = rawText;
        }
        if (resolvedText) {
            worldBookCharacters += resolvedText.length;
            worldBookTokens += countTokens(resolvedText);
        }
    });

    // 3. 统计长期记忆总结 (HideSummary)
    let summaryCharacters = 0;
    let summaryTokens = 0;
    if (hideSummaryConfig && hideSummaryConfig.enabled) {
        const memoryPrompt = formatMemoryForApi(hideSummaryConfig);
        if (memoryPrompt && memoryPrompt.trim()) {
            summaryCharacters = memoryPrompt.length;
            summaryTokens = countTokens(memoryPrompt);
        }
    }

    // 4. 统计数据库上下文 (DB Context)
    let dbContextCharacters = 0;
    let dbContextTokens = 0;
    if (conversation.dbId && conversation.dbSelections && conversation.dbSelections[conversation.dbId]) {
        const selectedTables = conversation.dbSelections[conversation.dbId];
        if (Array.isArray(selectedTables) && selectedTables.length > 0) {
            let contextContent = `【当前数据库上下文】\n已选数据表：${selectedTables.join(', ')}\n\n`;
            if (conversation.dbTableInfos) {
                const structures = selectedTables
                    .filter(name => conversation.dbTableInfos[name])
                    .map(name => `表名: ${name}\n表结构信息:\n${conversation.dbTableInfos[name]}`)
                    .join('\n\n');
                if (structures) {
                    contextContent += `【数据表详细结构】\n${structures}\n\n`;
                }
            }
            contextContent += `指令：请根据上述提供的表结构回答问题或生成 SQL。如果对任何字段的含义不明确，或者发现有任何可能影响 SQL 执行结果准确性的问题（如关联关系不明、数据类型歧义等），你必须先提出疑问，禁止直接生成可能错误的 SQL，请等待用户补充信息。`;
            dbContextCharacters = contextContent.length;
            dbContextTokens = countTokens(contextContent);
        }
    }

    // 5. 统计 MCP 工具描述 (MCP Tools)（优先从当前目标会话专属勾选中统计）
    let mcpToolsCharacters = 0;
    let mcpToolsTokens = 0;
    const conversationTools = (conversation && Array.isArray(conversation.selectedMcpTools))
        ? conversation.selectedMcpTools
        : (state.mcpSettings?.selectedTools || []);
    if (state.mcpSettings && state.mcpSettings.enabled && conversationTools.length > 0) {
        const selectedToolIds = conversationTools;
        const allTools = { ...DEFAULT_TOOLS, ...(state.mcpCustomTools || {}) };
        const tools = Object.values(allTools).filter(tool => tool.enabled && selectedToolIds.includes(tool.id));
        if (tools.length > 0) {
            let description = '\n[可用工具]\n';
            tools.forEach(tool => {
                description += `\n**${tool.name}** (${tool.id}):\n${tool.description}\n参数:\n`;
                Object.entries(tool.parameters || {}).forEach(([paramName, paramConfig]) => {
                    const required = paramConfig.required ? '(必需)' : '(可选)';
                    description += `- ${paramName} ${required}: ${paramConfig.description}\n`;
                });
            });
            description += '\n使用工具时(如多个工具结果不影响，请一次性使用多个工具，减少用户等待时间，请使用数组格式或者每个工具使用单独的代码块包裹)，请用以下格式：\n';
            description += '```tool_call\n{"tool": "工具ID", "parameters": {"参数名": "参数值"}}\n```\n';
            description += '\n**重要:** 如果你希望在工具执行后，能够看到并分析工具返回的结果(或者用户要求进行结果分析)，请在JSON中增加一个\x60"process_result": true\x60字段。系统会在工具执行完毕后，将结果返回给你进行下一步处理。例如：\n';
            description += '```tool_call\n{"tool": "工具ID", "parameters": {"参数名": "参数值"}, "process_result": true}\n```\n';
            mcpToolsCharacters = description.length;
            mcpToolsTokens = countTokens(description);
        }
    }

    // 6. 统计实时模式提示词 (Realtime Mode Prompt) 与跟随追加的虚拟时间戳
    let realtimeModeCharacters = 0;
    let realtimeModeTokens = 0;
    if (conversation.realtimeMode && conversation.realtimeMode.enabled) {
        if (conversation.realtimeMode.promptEnabled !== false) {
            const rtPrompt = (conversation.realtimeMode.prompt || DEFAULT_REALTIME_PROMPT).trim();
            if (rtPrompt) {
                realtimeModeCharacters += rtPrompt.length;
                realtimeModeTokens += countTokens(rtPrompt);
            }
        }

        // 统计追加到用户消息末尾的时间戳
        const rtCfg = conversation.realtimeMode;
        const appendAll = rtCfg.appendAllUser !== false;
        const userMessages = activeBranch.filter((m, idx) => m.role === 'user' && !isFloorHiddenInConfig(idx + 1, hideSummaryConfig));
        if (userMessages.length > 0) {
            const targets = appendAll ? userMessages : [userMessages[userMessages.length - 1]];
            for (const msg of targets) {
                let msgDate = new Date();
                if (msg.timestamp) {
                    const parsedD = new Date(msg.timestamp);
                    if (!isNaN(parsedD.getTime())) {
                        msgDate = parsedD;
                    }
                }
                const vDate = calculateVirtualDate(rtCfg, msgDate);
                const tsStr = formatVirtualTimestamp(vDate, rtCfg);
                if (tsStr) {
                    realtimeModeCharacters += tsStr.length + 1; // 包含换行符 \n
                    realtimeModeTokens += countTokens(tsStr);
                }
            }
        }
    }

    // 汇总系统级上下文
    const actualSentSystemCharacters = personaCharacters + worldBookCharacters + summaryCharacters + dbContextCharacters + mcpToolsCharacters + realtimeModeCharacters;
    const actualSentSystemTokens = personaTokens + worldBookTokens + summaryTokens + dbContextTokens + mcpToolsTokens + realtimeModeTokens;

    // 实际发送总计
    const actualSentCharacters = actualSentMainCharacters + actualSentSystemCharacters;
    const actualSentEstimatedTokens = actualSentMainTokens + actualSentSystemTokens;

    return {
        totalCharacters, totalEstimatedTokens,
        mainCharacters, mainTokens,
        thinkingCharacters, thinkingTokens,
        hiddenCharacters, hiddenEstimatedTokens,
        actualSentCharacters, actualSentEstimatedTokens,
        actualSentMainTokens, actualSentMainCharacters,
        actualSentSystemTokens, actualSentSystemCharacters,
        regexExcludedTokens, regexExcludedCharacters,
        personaTokens, personaCharacters,
        worldBookTokens, worldBookCharacters,
        summaryTokens, summaryCharacters,
        dbContextTokens, dbContextCharacters,
        mcpToolsTokens, mcpToolsCharacters,
        mcpAnalysisCharacters, mcpAnalysisTokens, mcpToolDataCharacters, mcpToolDataTokens, totalToolCalls,
        attachmentsCharacters, attachmentsTokens,
        realtimeModeCharacters, realtimeModeTokens
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
