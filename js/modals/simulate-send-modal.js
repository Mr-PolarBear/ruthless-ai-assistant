/**
 * @file simulate-send-modal.js
 * @description 模拟发送与提示词透视模块（完全不发真实请求，完整模拟发送流水线并透视实际给模型的 Messages/JSON/Tokens）
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { countTokens, escapeHtml, fallbackCopyText } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { buildApiRequest, processAndFilterMessages } from '../api-common.js?v=temp';

let currentSimulatedData = null;
let currentActiveTab = 'cards';

/**
 * 构建模拟发送的全量数据载荷
 * @returns {Object} 模拟计算结果
 */
export function buildSimulatedPayload() {
    const convId = state.currentConversationId;
    const conv = state.conversations[convId];
    if (!conv) return null;

    const activeBranch = conv.branches ? [...conv.branches[conv.activeBranchIndex]] : [];

    // — 为什么这么写 —
    // 检查输入框当前是否有未发送的文字草稿。
    // 若有草稿，将其作为待发送的最新一条 User 消息推入分支副本中参与完整流水线组装；
    // 若无草稿，则透视当前会话已有上下文就绪状态。
    const draftText = dom.messageInput ? dom.messageInput.value.trim() : '';
    const messagesToSimulate = activeBranch.map(m => ({ ...m }));

    let hasDraft = false;
    if (draftText) {
        hasDraft = true;
        messagesToSimulate.push({
            role: 'user',
            content: draftText,
            isDraft: true
        });
    }

    const hideConfig = state.hideSummary && state.hideSummary[convId];
    const messageLimit = hideConfig?.messageLimit ?? 0;

    // — 为什么这么写 —
    // 1. 严格按照实际发送 API 的真实流水线：
    //    先调用 processAndFilterMessages 过滤掉所有已标记隐藏 (msg.hidden === true) 的楼层，
    //    注入长期记忆总结，追加 MCP 工具执行结果，应用 messageLimit 数量限制截断，
    //    并将消息内容规范化为纯 { role, content }，彻底剥离 rawContentWithTools、thinking、isDraft 等内部冗余属性。
    const chatHistoryMessages = processAndFilterMessages(messagesToSimulate, {
        convId,
        activeBranch: messagesToSimulate,
        applyMcpRules: true,
        applyHideSummary: true,
        hideSummaryConfig: hideConfig
    });

    // 2. 将严格净化后的 chatHistoryMessages 传递给 buildApiRequest 组装系统提示词、人设、备忘录与正则清洗
    const apiPayload = buildApiRequest({
        convId,
        messages: chatHistoryMessages,
        includeWorldBook: true,
        includePersona: true,
        includeMcp: state.mcpSettings ? !!state.mcpSettings.enabled : true,
        applyRegex: true
    });

    // 3. 提取最终传递给大模型的 messages 列表
    let rawMessages = [];
    if (apiPayload) {
        if (Array.isArray(apiPayload.messages)) {
            rawMessages = apiPayload.messages;
        } else if (apiPayload.body) {
            if (Array.isArray(apiPayload.body.messages)) {
                rawMessages = apiPayload.body.messages;
            } else if (typeof apiPayload.body === 'string') {
                try {
                    const parsed = JSON.parse(apiPayload.body);
                    if (Array.isArray(parsed.messages)) {
                        rawMessages = parsed.messages;
                    }
                } catch (e) {}
            } else if (apiPayload.body.prompt) {
                rawMessages = [{ role: 'user', content: apiPayload.body.prompt }];
            }
        }
    }

    // 容错兜底：若未配置端点或返回为空，直接使用 chatHistoryMessages
    if (rawMessages.length === 0 && chatHistoryMessages.length > 0) {
        rawMessages = chatHistoryMessages;
    }

    // — 为什么这么写 —
    // 严格过滤掉任何内部临时属性（如 rawContentWithTools, thinking, isDraft, _idx, timestamp, avatar 等），
    // 确保与真实发送给大模型网关的载荷 100% 保持一致，绝不掺杂多余调试字段。
    rawMessages = rawMessages.map(msg => {
        const cleanMsg = { role: msg.role, content: msg.content };
        if (msg.name) cleanMsg.name = msg.name;
        if (msg.tool_calls) cleanMsg.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) cleanMsg.tool_call_id = msg.tool_call_id;
        if (msg.regexModified) {
            cleanMsg.regexModified = true;
            cleanMsg.beforeRegexContent = msg.beforeRegexContent;
        }
        return cleanMsg;
    });

    // 统计和打标各条消息
    let systemCount = 0;
    let userCount = 0;
    let assistantCount = 0;
    let totalEstimatedTokens = 0;

    const analyzedMessages = rawMessages.map((msg, index) => {
        let textContent = '';
        if (typeof msg.content === 'string') {
            textContent = msg.content;
        } else if (Array.isArray(msg.content)) {
            textContent = msg.content.map(part => {
                if (part.type === 'text') return part.text;
                if (part.type === 'image_url') return '[图片附件 Vision 载荷]';
                return JSON.stringify(part);
            }).join('\n');
        } else {
            textContent = JSON.stringify(msg.content);
        }

        const msgTokens = countTokens(textContent);
        totalEstimatedTokens += msgTokens;

        // 判断来源标签
        let sourceTag = '上下文消息';
        let roleClass = 'role-user';

        if (msg.role === 'system') {
            systemCount++;
            roleClass = 'role-system';
            const rtPrompt = (conv && conv.realtimeMode && conv.realtimeMode.prompt) || '';
            if (textContent.includes('长期记忆总结') || textContent.includes('长期记忆摘要集') || textContent.includes('长期记忆结构化表格')) {
                sourceTag = '长期记忆注入';
            } else if (textContent.includes('【异地实时聊天规范】') || (rtPrompt && textContent.includes(rtPrompt.trim()))) {
                sourceTag = '实时模式规范';
            } else if (state.appSettings && state.appSettings.mergeWorldBook && textContent.includes('---')) {
                sourceTag = '合并系统上下文 (人设/备忘录/总结)';
            } else if (state.currentPersona && textContent.includes(state.currentPersona.prompt || '___')) {
                sourceTag = '角色提示词';
            } else {
                sourceTag = '系统提示词 / 备忘录';
            }
        } else if (msg.role === 'user') {
            userCount++;
            roleClass = 'role-user';
            if (hasDraft && index === rawMessages.length - 1) {
                sourceTag = '用户草稿 (待发)';
            } else {
                sourceTag = `用户消息 (第 ${index + 1} 项)`;
            }
        } else if (msg.role === 'assistant') {
            assistantCount++;
            roleClass = 'role-assistant';
            sourceTag = `AI 回复 (第 ${index + 1} 项)`;
        }

        let regexDiffTokens = 0;
        let regexDiffChars = 0;
        if (msg.regexModified && msg.beforeRegexContent) {
            const rawTokens = countTokens(msg.beforeRegexContent);
            regexDiffTokens = Math.max(0, rawTokens - msgTokens);
            regexDiffChars = Math.max(0, msg.beforeRegexContent.length - textContent.length);
        }

        return {
            index,
            role: msg.role,
            roleClass,
            sourceTag,
            content: textContent,
            tokens: msgTokens,
            chars: textContent.length,
            regexModified: !!msg.regexModified,
            regexDiffTokens,
            regexDiffChars,
            rawObject: msg
        };
    });

    let totalRegexExcludedTokens = 0;
    let totalRegexExcludedChars = 0;
    analyzedMessages.forEach(m => {
        if (m.regexModified) {
            totalRegexExcludedTokens += m.regexDiffTokens;
            totalRegexExcludedChars += m.regexDiffChars;
        }
    });

    const activeApi = (conv && conv.apiEndpointId ? (state.apiEndpoints?.[conv.apiEndpointId] || window.API_PRESETS?.[conv.apiEndpointId]) : null)
        || (state.apiEndpoints && state.activeApiIndex !== undefined ? state.apiEndpoints[state.activeApiIndex] : null);

    const targetModel = (apiPayload && apiPayload.body && apiPayload.body.model)
        || (apiPayload && apiPayload.model)
        || (activeApi && activeApi.model)
        || '默认配置模型';

    // 确保 apiPayload.body.messages 也保持净化后的 messages
    if (apiPayload && apiPayload.body && Array.isArray(apiPayload.body.messages)) {
        apiPayload.body.messages = rawMessages;
    }

    return {
        totalTokens: totalEstimatedTokens,
        totalMessages: rawMessages.length,
        totalRegexExcludedTokens,
        totalRegexExcludedChars,
        systemCount,
        userCount,
        assistantCount,
        targetModel,
        messageLimit,
        analyzedMessages,
        apiPayload
    };
}

/**
 * 渲染模拟发送弹窗内容
 */
export function renderSimulateSendModal() {
    const data = buildSimulatedPayload();
    if (!data) return;
    currentSimulatedData = data;

    // 1. 概览仪表盘
    if (dom.simTotalTokens) dom.simTotalTokens.textContent = data.totalTokens.toLocaleString();
    if (dom.simTotalMessages) dom.simTotalMessages.textContent = data.totalMessages.toString();
    if (dom.simMessagesBreakdown) {
        dom.simMessagesBreakdown.textContent = `(System: ${data.systemCount} | User: ${data.userCount} | AI: ${data.assistantCount})`;
    }
    if (dom.simTargetModel) dom.simTargetModel.textContent = data.targetModel;

    // 仪表盘正则过滤削减指标
    const simRegexStatItem = document.getElementById('sim-regex-stat-item');
    const simRegexTokens = document.getElementById('sim-regex-tokens');
    const simRegexChars = document.getElementById('sim-regex-chars');

    if (simRegexStatItem && simRegexTokens && simRegexChars) {
        if (data.totalRegexExcludedTokens > 0) {
            simRegexTokens.textContent = `-${data.totalRegexExcludedTokens.toLocaleString()}`;
            simRegexChars.textContent = `(-${data.totalRegexExcludedChars.toLocaleString()} 字)`;
            simRegexStatItem.style.display = 'inline-flex';
        } else {
            simRegexStatItem.style.display = 'none';
        }
    }

    // 消息数量限制红字提示
    if (dom.simLimitNotice) {
        if (data.messageLimit > 0) {
            dom.simLimitNotice.style.display = 'inline-flex';
            if (dom.simLimitCount) dom.simLimitCount.textContent = data.messageLimit.toString();
        } else {
            dom.simLimitNotice.style.display = 'none';
        }
    }

    // 2. 结构流卡片视图
    const container = dom.simCardsContainer;
    if (container) {
        container.innerHTML = '';
        if (data.analyzedMessages.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">暂无可发送的有效上下文内容</div>';
        } else {
            data.analyzedMessages.forEach((item) => {
                const card = document.createElement('div');
                // — 为什么这么写 —
                // 默认折叠所有卡片，保持结构流预览界面清爽紧凑，用户可按需单条展开或点击右上角全部展开
                card.className = `sim-card ${item.roleClass} collapsed`;

                const regexBadgeHtml = item.regexModified
                    ? `<span class="sim-card-regex-badge" title="该条消息正文已应用请求时正则过滤，剔除了部分内容 (削减 ${item.regexDiffTokens} Tokens / ${item.regexDiffChars} 字符)"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 2px;"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>正则过滤 (-${item.regexDiffTokens} Tokens)</span>`
                    : '';

                // — 为什么这么写 —
                // 响应大爷要求：将前两列合并为单一一体化标签（用户消息 / AI 回复 / 系统设定），省去重复徽章占位
                card.innerHTML = `
                    <div class="sim-card-header">
                        <div class="sim-card-header-left">
                            <span class="sim-card-unified-badge role-${item.role}">${escapeHtml(item.sourceTag)}</span>
                            ${regexBadgeHtml}
                        </div>
                        <div class="sim-card-header-right">
                            <span class="sim-card-tokens">${item.tokens.toLocaleString()} Tokens / ${item.chars.toLocaleString()} 字</span>
                            <button type="button" class="sim-card-copy-btn" title="复制本条消息内容" aria-label="复制">
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                            </button>
                            <span class="sim-card-toggle-icon"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                        </div>
                    </div>
                    <div class="sim-card-body">${escapeHtml(item.content)}</div>
                `;

                // 绑定展开/折叠
                const header = card.querySelector('.sim-card-header');
                header.addEventListener('click', (e) => {
                    if (e.target.closest('.sim-card-copy-btn')) return;
                    card.classList.toggle('collapsed');
                });

                // 绑定单条复制
                const copyBtn = card.querySelector('.sim-card-copy-btn');
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fallbackCopyText(item.content);
                    notify.success('已复制该条消息内容');
                });

                container.appendChild(card);
            });
        }
    }

    // 3. 平铺纯文本视图
    const flatTextEl = dom.simFlatTextContent;
    if (flatTextEl) {
        const flatLines = data.analyzedMessages.map(item => {
            return `==================================================\n[ROLE: ${item.role.toUpperCase()} | 来源: ${item.sourceTag} | ${item.tokens} Tokens]\n==================================================\n${item.content}\n`;
        });
        flatTextEl.textContent = flatLines.join('\n');
    }

    // 4. 请求 JSON 视图
    const jsonEl = dom.simJsonContent;
    if (jsonEl) {
        const payloadToDisplay = data.apiPayload && data.apiPayload.body
            ? data.apiPayload.body
            : (data.apiPayload || { model: data.targetModel, messages: data.analyzedMessages.map(m => m.rawObject) });
        jsonEl.textContent = JSON.stringify(payloadToDisplay, null, 2);
    }
}

/**
 * 切换模拟发送选项卡
 * @param {string} tabName - 选项卡名称 ('cards' | 'text' | 'json')
 */
export function switchSimulateTab(tabName) {
    currentActiveTab = tabName;

    // 更新 Tab 按钮状态
    const tabs = document.querySelectorAll('.simulate-tab-btn');
    tabs.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 切换卡片全部展开/折叠按钮显示（仅在 cards 视图显示）
    if (dom.simCardsActions) {
        dom.simCardsActions.style.display = (tabName === 'cards') ? 'flex' : 'none';
    }

    // 切换内容区域
    const cardsView = document.getElementById('sim-tab-cards');
    const textView = document.getElementById('sim-tab-text');
    const jsonView = document.getElementById('sim-tab-json');

    if (cardsView) cardsView.style.display = (tabName === 'cards') ? 'block' : 'none';
    if (textView) textView.style.display = (tabName === 'text') ? 'block' : 'none';
    if (jsonView) jsonView.style.display = (tabName === 'json') ? 'block' : 'none';
}

/**
 * 打开模拟发送弹窗
 */
export function openSimulateSendModal() {
    if (!dom.simulateSendModal) return;
    renderSimulateSendModal();
    switchSimulateTab(currentActiveTab || 'cards');
    dom.simulateSendModal.style.display = 'flex';
    dom.simulateSendModal.classList.add('visible');
}

/**
 * 关闭模拟发送弹窗
 */
export function closeSimulateSendModal() {
    if (!dom.simulateSendModal) return;
    dom.simulateSendModal.classList.remove('visible');
    dom.simulateSendModal.style.display = 'none';
}

/**
 * 初始化模拟发送弹窗事件
 */
export function initSimulateSendModal() {
    // — 为什么这么写 —
    // 1. 点击 Token 徽章弹出全景【模拟发送与提示词预览】，承接全量上下文、正则削减透视与 JSON 请求载荷
    if (dom.sessionTokenBadge) {
        dom.sessionTokenBadge.addEventListener('click', openSimulateSendModal);
    }

    // 2. 正则表达式快捷按钮：一键直达【设置 -> 正则表达式】页签
    const regexBtn = dom.quickRegexBtn || document.getElementById('quick-regex-btn') || dom.simulateSendBtn;
    if (regexBtn) {
        regexBtn.addEventListener('click', () => {
            import('./settings-modal.js?v=temp').then(m => m.openSettingsModal('regex-settings'));
        });
    }

    // 关闭模拟发送
    if (dom.simulateSendCloseBtn) {
        dom.simulateSendCloseBtn.addEventListener('click', closeSimulateSendModal);
    }
    if (dom.simulateSendCloseBtn2) {
        dom.simulateSendCloseBtn2.addEventListener('click', closeSimulateSendModal);
    }
    if (dom.simulateSendModal) {
        dom.simulateSendModal.addEventListener('click', (e) => {
            if (e.target === dom.simulateSendModal) {
                closeSimulateSendModal();
            }
        });
    }

    // 选项卡切换
    const tabBtns = document.querySelectorAll('.simulate-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchSimulateTab(btn.dataset.tab);
        });
    });

    // 全部展开按钮
    if (dom.simExpandAllBtn) {
        dom.simExpandAllBtn.addEventListener('click', () => {
            const cards = dom.simCardsContainer?.querySelectorAll('.sim-card');
            cards?.forEach(card => card.classList.remove('collapsed'));
        });
    }

    // 全部折叠按钮
    if (dom.simCollapseAllBtn) {
        dom.simCollapseAllBtn.addEventListener('click', () => {
            const cards = dom.simCardsContainer?.querySelectorAll('.sim-card');
            cards?.forEach(card => card.classList.add('collapsed'));
        });
    }

    // 概览仪表盘收起/展开控制
    const statsBar = document.getElementById('simulate-send-stats-bar');
    const collapseBtn = document.getElementById('sim-stats-collapse-btn');
    const collapseText = document.getElementById('sim-stats-collapse-text');
    if (statsBar && collapseBtn) {
        const isCollapsed = localStorage.getItem('ruthless_simulate_stats_collapsed') === 'true';
        if (isCollapsed) {
            statsBar.classList.add('collapsed');
            if (collapseText) collapseText.textContent = '展开';
        }
        collapseBtn.addEventListener('click', () => {
            const nowCollapsed = statsBar.classList.toggle('collapsed');
            localStorage.setItem('ruthless_simulate_stats_collapsed', nowCollapsed ? 'true' : 'false');
            if (collapseText) {
                collapseText.textContent = nowCollapsed ? '展开' : '收起';
            }
        });
    }

    // 复制当前视图
    if (dom.simCopyCurrentBtn) {
        dom.simCopyCurrentBtn.addEventListener('click', () => {
            if (!currentSimulatedData) return;
            if (currentActiveTab === 'json') {
                const payload = currentSimulatedData.apiPayload?.body || currentSimulatedData.apiPayload;
                fallbackCopyText(JSON.stringify(payload, null, 2));
                notify.success('已复制完整请求 JSON 载荷！');
            } else if (currentActiveTab === 'text') {
                if (dom.simFlatTextContent) {
                    fallbackCopyText(dom.simFlatTextContent.textContent);
                    notify.success('已复制平铺纯文本提示词！');
                }
            } else {
                // 卡片视图下复制全量结构流文本
                if (dom.simFlatTextContent) {
                    fallbackCopyText(dom.simFlatTextContent.textContent);
                    notify.success('已复制全部结构消息文本！');
                }
            }
        });
    }

    // 复制请求 JSON 快捷按钮
    if (dom.simCopyJsonBtn) {
        dom.simCopyJsonBtn.addEventListener('click', () => {
            if (!currentSimulatedData) return;
            const payload = currentSimulatedData.apiPayload?.body || currentSimulatedData.apiPayload;
            fallbackCopyText(JSON.stringify(payload, null, 2));
            notify.success('已复制完整 API 请求 JSON 载荷！');
        });
    }
}
