/**
 * sync-bundle.js
 * 负责跨设备云同步与本地导入导出时，会话数据的清洗、打包组装与 Manifest 清单提取。
 *
 * — 为什么独立抽取此模块 —
 * 1. 遵循 AGENTS.md 架构铁律：防止已近 1700 行的 utils.js 继续恶性膨胀。
 * 2. 统一会话打包核心契约（Smart Bundle v1.0 规范），供普通导出与云同步无缝共享。
 * 3. 剥离 UI 交互（alert / a 标签触发下载），使其成为纯粹的数据处理服务。
 */

import { state, DEFAULT_REGEX_RULES } from '../state.js?v=temp';
import { getConversation, getAllConversationIds } from '../db.js?v=temp';
import { normalizeRealtimeConfig } from './realtime-mode.js?v=temp';

/**
 * 获取单个会话的完整打包数据（含其关联的局部/全局备忘录、隐藏与总结配置、专属正则）
 *
 * @param {string} conversationId - 会话ID
 * @returns {Promise<Object|null>} 包含关联数据的深拷贝会话对象，若不存在返回 null
 */
export async function buildSingleConversationData(conversationId) {
    if (!conversationId) return null;

    let conversation = state.conversations[conversationId];
    if (!conversation) {
        try {
            conversation = await getConversation(conversationId);
        } catch (err) {
            console.error('[sync-bundle] 从 IndexedDB 读取会话失败:', err);
            return null;
        }
    }

    if (!conversation || conversation.isDeleted) return null;

    // 深拷贝以切断对象内存引用，防止污染运行态
    const convToExport = JSON.parse(JSON.stringify(conversation));
    convToExport.exportedAt = new Date().toISOString();

    // 0. 标准化并打包该会话的实时模式与历法时间配置 (conv.realtimeMode)
    // — 为什么这么写 —
    // 确保导出的单个会话完整携带实时模式全部变量（虚拟年月日、星期、时间粒度、推进策略、提示词），
    // 规避因部分属性缺失导致导入端或跨端恢复后时序因果穿帮或降级失效。
    if (conversation.realtimeMode && (typeof conversation.realtimeMode === 'object' || typeof conversation.realtimeMode === 'string')) {
        convToExport.realtimeMode = normalizeRealtimeConfig(conversation.realtimeMode);
    }

    // 1. 打包关联备忘录 (Smart Bundle 机制：全局启用或被当前会话绑定的局部条目)
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

    // 2. 打包该会话的隐藏与总结配置及历史版本 (hideSummary 机制)
    if (state.hideSummary && state.hideSummary[conversationId]) {
        convToExport.hideSummary = JSON.parse(JSON.stringify(state.hideSummary[conversationId]));
    }

    // 3. 打包该会话关联的正则规则 (包含专属正则与当前开启生效的自定义全局正则，严格排除系统默认规则)
    const relatedRegex = [];
    const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
    if (state.regexRules && typeof state.regexRules === 'object') {
        Object.values(state.regexRules).forEach(rule => {
            if (!rule) return;
            // 乌鸦：严格排除系统内置默认规则，避免在跨端或生产环境导入时触发虚假冲突
            if (rule.isDefault || (rule.id && defaultRuleKeys.includes(rule.id))) return;

            const isSession = rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.map(String).includes(String(conversationId));
            const isGlobalEnabled = (rule.scope === 'global' || !rule.scope) && (rule.enabled !== false && !rule.disabled);
            if (isSession || isGlobalEnabled) {
                relatedRegex.push(JSON.parse(JSON.stringify(rule)));
            }
        });
    }
    convToExport.sessionRegexRules = relatedRegex;
    convToExport.relatedRegexRules = relatedRegex;

    return convToExport;
}

/**
 * 组装多会话或全量会话的数据包（Smart Bundle v1.0 格式）
 *
 * @param {string[]|null} targetConversationIds - 指定要打包的会话ID数组，传 null 或空表示打包全部
 * @returns {Promise<Object>} 符合 Smart Bundle v1.0 规范的纯对象
 */
export async function buildConversationBundle(targetConversationIds = null) {
    const isTargeted = Array.isArray(targetConversationIds) && targetConversationIds.length > 0;
    const targetIdSet = isTargeted ? new Set(targetConversationIds.map(String)) : null;

    const conversationsMap = {};
    let dbIds = [];
    try {
        dbIds = await getAllConversationIds();
    } catch (err) {
        console.warn('[sync-bundle] 获取数据库会话ID列表异常:', err);
    }
    const stateIds = (state.conversations && typeof state.conversations === 'object') ? Object.keys(state.conversations) : [];
    const allIds = Array.from(new Set([...(Array.isArray(dbIds) ? dbIds : []), ...stateIds]));

    for (const id of allIds) {
        if (targetIdSet && !targetIdSet.has(String(id))) {
            continue; // 跳过未勾选的会话
        }
        let conv = state.conversations[id];
        if (!conv) {
            try {
                conv = await getConversation(id);
            } catch (err) {
                console.error(`[sync-bundle] 获取会话 ${id} 失败:`, err);
            }
        }
        if (conv && !conv.isDeleted) {
            const convCopy = JSON.parse(JSON.stringify(conv));
            // 确保多会话批量打包与云同步时，每个会话的 realtimeMode 均经由规范化校验，包含完整历法时间变量与提示词
            if (convCopy.realtimeMode && (typeof convCopy.realtimeMode === 'object' || typeof convCopy.realtimeMode === 'string')) {
                convCopy.realtimeMode = normalizeRealtimeConfig(convCopy.realtimeMode);
            }
            conversationsMap[id] = convCopy;
        }
    }

    // 提取关联备忘录
    const filteredWorldBook = {};
    if (state.worldBook && typeof state.worldBook === 'object') {
        Object.entries(state.worldBook).forEach(([wbId, entry]) => {
            if (!entry) return;
            if (!isTargeted) {
                filteredWorldBook[wbId] = JSON.parse(JSON.stringify(entry));
            } else {
                // 如果是指定会话，只打包全局生效或与选中会话有交集的条目
                const isGlobal = entry.enabled === true;
                const hasIntersection = Array.isArray(entry.sessionIds) && entry.sessionIds.some(sId => targetIdSet.has(String(sId)));
                if (isGlobal || hasIntersection) {
                    filteredWorldBook[wbId] = JSON.parse(JSON.stringify(entry));
                }
            }
        });
    }

    // 提取隐藏与总结配置
    const filteredHideSummary = {};
    if (state.hideSummary && typeof state.hideSummary === 'object') {
        Object.entries(state.hideSummary).forEach(([cId, config]) => {
            if (!config) return;
            if (!isTargeted || targetIdSet.has(String(cId))) {
                filteredHideSummary[cId] = JSON.parse(JSON.stringify(config));
            }
        });
    }

    // 提取关联的正则规则（包含专属正则 + 当前生效的自定义全局正则，严格排除系统默认规则）
    const filteredRegexRules = {};
    const filteredSessionRegex = {};
    const defaultRuleKeys = Object.keys(DEFAULT_REGEX_RULES || {});
    if (state.regexRules && typeof state.regexRules === 'object') {
        Object.entries(state.regexRules).forEach(([rId, rule]) => {
            if (!rule) return;
            // 乌鸦：严格排除系统内置默认规则，避免会话包冗余携带与跨环境导入误报
            if (rule.isDefault || defaultRuleKeys.includes(rId) || (rule.id && defaultRuleKeys.includes(rule.id))) return;

            const isSession = rule.scope === 'session';
            const isGlobal = (rule.scope === 'global' || !rule.scope);
            const isEnabled = rule.enabled !== false && !rule.disabled;

            if (isSession) {
                if (!isTargeted) {
                    filteredSessionRegex[rId] = JSON.parse(JSON.stringify(rule));
                    filteredRegexRules[rId] = JSON.parse(JSON.stringify(rule));
                } else {
                    const hasIntersection = Array.isArray(rule.sessionIds) && rule.sessionIds.some(sId => targetIdSet.has(String(sId)));
                    if (hasIntersection) {
                        filteredSessionRegex[rId] = JSON.parse(JSON.stringify(rule));
                        filteredRegexRules[rId] = JSON.parse(JSON.stringify(rule));
                    }
                }
            } else if (isGlobal && isEnabled) {
                // 当前开启生效的自定义全局正则一并纳入会话包
                filteredRegexRules[rId] = JSON.parse(JSON.stringify(rule));
            }
        });
    }

    return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        conversations: conversationsMap,
        worldBook: filteredWorldBook,
        hideSummary: filteredHideSummary,
        regexRules: filteredRegexRules,
        sessionRegexRules: filteredSessionRegex // 向下兼容旧版本
    };
}

/**
 * 从会话包中快速提取轻量 Manifest 元数据（用于云端快速查看列表，无需解密几十兆大包）
 *
 * @param {Object} bundle - buildConversationBundle 生成的数据包
 * @param {string} [deviceName=''] - 客户端设备标识
 * @param {string} [appVersion=''] - 客户端应用版本
 * @returns {Object} 轻量清单元数据
 */
export function generateManifest(bundle, deviceName = '', appVersion = '') {
    const list = [];
    if (bundle && bundle.conversations) {
        Object.values(bundle.conversations).forEach(conv => {
            if (!conv) return;
            // 计算楼层数（优先读取当前活动分支的消息数组）
            let floorCount = 0;
            if (Array.isArray(conv.branches) && conv.branches.length > 0) {
                const activeIdx = (typeof conv.activeBranchIndex === 'number') ? conv.activeBranchIndex : 0;
                const branch = conv.branches[activeIdx] || conv.branches[0];
                if (Array.isArray(branch)) {
                    floorCount = branch.length;
                } else if (branch && Array.isArray(branch.messages)) {
                    floorCount = branch.messages.length;
                }
            } else if (Array.isArray(conv.messages)) {
                floorCount = conv.messages.length;
            }

            list.push({
                id: conv.id,
                sourceConvId: conv.id,
                title: conv.title || '未命名对话',
                floorCount: floorCount,
                lastModified: conv.lastModified || conv.createdAt || '',
                hasRealtime: !!(conv.realtimeMode && conv.realtimeMode.enabled)
            });
        });
    }

    return {
        createdAt: bundle.exportedAt || new Date().toISOString(),
        deviceName: deviceName || '未知设备',
        appVersion: appVersion || 'v1.0.0',
        conversationCount: list.length,
        conversations: list
    };
}
