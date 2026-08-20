/**
 * @file simulate-send-modal.js
 * @description 模拟发送与提示词透视模块（完全不发真实请求，完整模拟发送流水线并透视实际给模型的 Messages/JSON/Tokens）
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { countTokens, escapeHtml, fallbackCopyText } from '../utils.js?v=260820-1';
import { notify } from '../ui-updater.js?v=260820-1';
import { buildApiRequest, processAndFilterMessages } from '../api-common.js?v=260820-1';

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
            if (textContent.includes('长期记忆总结')) {
                sourceTag = '长期记忆总结';
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
                sourceTag = '当前输入草稿 (待发)';
            } else {
                sourceTag = `用户消息 (第 ${index + 1} 项)`;
            }
        } else if (msg.role === 'assistant') {
            assistantCount++;
            roleClass = 'role-assistant';
            sourceTag = `AI 历史回复 (第 ${index + 1} 项)`;
        }

        return {
            index,
            role: msg.role,
            roleClass,
            sourceTag,
            content: textContent,
            tokens: msgTokens,
            chars: textContent.length,
            rawObject: msg
        };
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
                card.className = `sim-card ${item.roleClass}`;

                card.innerHTML = `
                    <div class="sim-card-header">
                        <div class="sim-card-header-left">
                            <span class="sim-card-role-badge">${item.role}</span>
                            <span class="sim-card-source-tag">${escapeHtml(item.sourceTag)}</span>
                        </div>
                        <div class="sim-card-header-right">
                            <span class="sim-card-tokens">${item.tokens.toLocaleString()} Tokens / ${item.chars.toLocaleString()} 字</span>
                            <button type="button" class="sim-card-copy-btn" title="复制本条消息内容">复制</button>
                            <span class="sim-card-toggle-icon">▼</span>
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
    // 打开模拟发送
    if (dom.simulateSendBtn) {
        dom.simulateSendBtn.addEventListener('click', openSimulateSendModal);
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
