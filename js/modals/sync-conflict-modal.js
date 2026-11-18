/**
 * @file sync-conflict-modal.js
 * @description 会话云同步与导入覆盖冲突对比决策弹窗
 *
 * — 为什么独立抽取此模块 —
 * 1. 遵循 AGENTS.md 模块化架构铁律：防止 utils.js 与 sync-modal.js 恶性膨胀；
 * 2. 覆盖冲突透视保护：展示两端会话消息总数、修改时间，以及最关键的【最后2条消息】真实正文与时序对比；
 * 3. 闭环软删除保护：用户选择【覆盖本地】时，系统自动将被覆盖的本地会话移入【回收站】并保留 10 天，绝不发生误删丢失惨剧。
 */

import { escapeHtml } from '../utils.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';

/**
 * 警告差异提示 SVG 图标
 */
const ALERT_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 3px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

/**
 * 提取会话的摘要信息供对比展示（包含消息总数、格式化修改时间、最后2条消息透视）
 * @param {object} conv - 会话对象
 * @returns {object} 会话摘要
 */
export function getConversationSummary(conv) {
    if (!conv) {
        return {
            title: '（无）',
            messageCount: 0,
            lastModified: '未知',
            lastModifiedRaw: 0,
            lastTwoMessages: []
        };
    }

    const title = conv.title || '未命名对话';
    const branches = Array.isArray(conv.branches) ? conv.branches : [];
    const activeBranchIdx = conv.activeBranchIndex || 0;
    const activeBranch = Array.isArray(branches[activeBranchIdx]) ? branches[activeBranchIdx] : (branches[0] || []);
    const messageCount = activeBranch.length;

    // 格式化最后更新时间
    let lastModifiedStr = '未知';
    let lastModifiedRaw = 0;
    const rawTime = conv.lastModified || conv.createdAt || conv.importedAt;
    if (rawTime) {
        try {
            const d = new Date(rawTime);
            lastModifiedRaw = isNaN(d.getTime()) ? 0 : d.getTime();
            lastModifiedStr = d.toLocaleString();
        } catch (_) {
            lastModifiedStr = String(rawTime);
        }
    }

    // 兜底：若会话顶层无时间，尝试从活动分支最后一条消息的 timestamp 提取真实修改时间
    if (!lastModifiedRaw && activeBranch.length > 0) {
        const lastMsg = activeBranch[activeBranch.length - 1];
        if (lastMsg && lastMsg.timestamp) {
            try {
                const d = new Date(lastMsg.timestamp);
                if (!isNaN(d.getTime())) {
                    lastModifiedRaw = d.getTime();
                    lastModifiedStr = d.toLocaleString();
                }
            } catch (_) {}
        }
    }

    // 提取最后 2 条消息
    const lastTwo = activeBranch.slice(-2);
    const lastTwoMessages = lastTwo.map((msg, idx) => {
        const floor = activeBranch.length - lastTwo.length + idx + 1;
        let roleName = '消息';
        if (msg.role === 'user') roleName = '用户';
        else if (msg.role === 'assistant') roleName = 'AI';
        else if (msg.role === 'system') roleName = '系统';

        // 清洗提取纯文本摘要
        let content = String(msg.content || '');
        if (regexPatterns && regexPatterns.stripHtmlTags) {
            content = content.replace(regexPatterns.stripHtmlTags, '');
        }
        if (!content.trim() && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            content = `[附件: ${msg.attachments.length}个文件]`;
        }
        if (content.length > 260) {
            content = content.substring(0, 260) + '...';
        }

        let timeStr = '';
        if (msg.timestamp) {
            try {
                timeStr = new Date(msg.timestamp).toLocaleTimeString();
            } catch (_) {}
        }

        return {
            floor,
            role: msg.role || 'user',
            roleName,
            timeStr,
            content: content || '（空内容）'
        };
    });

    return {
        title,
        messageCount,
        lastModified: lastModifiedStr,
        lastModifiedRaw,
        lastTwoMessages
    };
}

/**
 * 弹出多会话覆盖冲突对比决策弹窗
 * @param {Array<{ convId: string, title: string, localConv: object, incomingConv: object }>} conflictList - 发生冲突的会话列表
 * @returns {Promise<Object<string, 'overwrite'|'keep_both'|'skip'>|null>} 返回每个会话的决策映射表，取消则返回 null
 */
export function showConversationConflictDialog(conflictList) {
    if (!Array.isArray(conflictList) || conflictList.length === 0) {
        return Promise.resolve({});
    }

    return new Promise((resolve) => {
        let modal = document.getElementById('sync-conflict-modal');
        if (!modal) {
            console.warn('[sync-conflict-modal] 未找到模态框DOM，尝试使用降级确认');
            const overwrite = confirm(`检测到 ${conflictList.length} 个会话与本地已有记录发生冲突。\n点击【确定】覆盖本地会话（原会话移入回收站），点击【取消】创建新副本保留两者。`);
            const fallback = {};
            conflictList.forEach(c => {
                fallback[c.convId] = overwrite ? 'overwrite' : 'keep_both';
            });
            return resolve(fallback);
        }

        const container = document.getElementById('sync-conflict-items-container');
        const countBadge = document.getElementById('sync-conflict-count-badge');
        const batchOverwriteBtn = document.getElementById('sync-conflict-batch-overwrite');
        const batchKeepBtn = document.getElementById('sync-conflict-batch-keep');
        const batchSkipBtn = document.getElementById('sync-conflict-batch-skip');
        const confirmBtn = document.getElementById('sync-conflict-confirm-btn');
        const cancelBtn = document.getElementById('sync-conflict-cancel-btn');
        const closeBtn = document.getElementById('sync-conflict-close-btn');

        if (countBadge) {
            countBadge.textContent = `共 ${conflictList.length} 项冲突`;
        }

        // 渲染各冲突项
        if (container) {
            container.innerHTML = '';
            conflictList.forEach((conflict, index) => {
                const localSummary = getConversationSummary(conflict.localConv);
                const incomingSummary = getConversationSummary(conflict.incomingConv);

                const countDiff = localSummary.messageCount !== incomingSummary.messageCount;
                const localIsNewer = localSummary.lastModifiedRaw > incomingSummary.lastModifiedRaw;
                const incomingIsNewer = incomingSummary.lastModifiedRaw > localSummary.lastModifiedRaw;

                let diffBadgeHtml = '';
                if (countDiff) {
                    diffBadgeHtml = `<span class="diff-summary-tag">${ALERT_ICON_SVG}消息数量不同 (本地 ${localSummary.messageCount} vs 待导入 ${incomingSummary.messageCount})</span>`;
                } else {
                    diffBadgeHtml = `<span class="diff-summary-tag" style="background:rgba(59,130,246,0.1);color:var(--primary-color, #3b82f6);">消息数量一致 (${localSummary.messageCount} 楼)</span>`;
                }

                // 渲染消息卡片列表
                const renderMsgBox = (msgs) => {
                    if (!msgs || msgs.length === 0) {
                        return '<div style="color:var(--text-muted);font-size:11px;padding:12px;text-align:center;">（暂无消息记录）</div>';
                    }
                    return msgs.map(m => `
                        <div class="sync-conflict-msg-item">
                            <div class="sync-conflict-msg-header">
                                <span class="sync-conflict-role-tag ${m.role}">#${m.floor} 楼 · ${m.roleName}</span>
                                ${m.timeStr ? `<span>${escapeHtml(m.timeStr)}</span>` : ''}
                            </div>
                            <div class="sync-conflict-msg-content">${escapeHtml(m.content)}</div>
                        </div>
                    `).join('');
                };

                const card = document.createElement('div');
                card.className = 'sync-conflict-card';
                card.innerHTML = `
                    <div class="sync-conflict-card-header">
                        <div class="sync-conflict-title-wrap">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-orange, #f59e0b);flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <span class="sync-conflict-title" title="${escapeHtml(conflict.title)}">${escapeHtml(conflict.title)}</span>
                            ${diffBadgeHtml}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            ID: <code>${escapeHtml(conflict.convId)}</code>
                        </div>
                    </div>
                    <div class="sync-conflict-columns">
                        <!-- 本地现有版本 -->
                        <div class="sync-conflict-col ${localIsNewer ? 'highlight-newer' : ''}">
                            <div class="sync-conflict-col-header">
                                <span style="display:inline-flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>本地现有版本</span>
                                ${localIsNewer ? '<span class="sync-conflict-stat-badge" style="background:rgba(16,185,129,0.12);color:var(--success-color, #10b981);">较新</span>' : ''}
                            </div>
                            <div class="sync-conflict-meta-row">
                                <span>消息楼层：</span>
                                <span class="sync-conflict-stat-badge ${countDiff ? 'diff-highlight' : ''}">${localSummary.messageCount} 楼</span>
                            </div>
                            <div class="sync-conflict-meta-row">
                                <span>更新时间：</span>
                                <span>${escapeHtml(localSummary.lastModified)}</span>
                            </div>
                            <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-top:2px;">最后 2 条消息透视：</div>
                            <div class="sync-conflict-messages-box">
                                ${renderMsgBox(localSummary.lastTwoMessages)}
                            </div>
                        </div>

                        <!-- 待导入/云端版本 -->
                        <div class="sync-conflict-col ${incomingIsNewer ? 'highlight-newer' : ''}">
                            <div class="sync-conflict-col-header">
                                <span style="display:inline-flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>待导入 / 云端版本</span>
                                ${incomingIsNewer ? '<span class="sync-conflict-stat-badge" style="background:rgba(16,185,129,0.12);color:var(--success-color, #10b981);">较新</span>' : ''}
                            </div>
                            <div class="sync-conflict-meta-row">
                                <span>消息楼层：</span>
                                <span class="sync-conflict-stat-badge ${countDiff ? 'diff-highlight' : ''}">${incomingSummary.messageCount} 楼</span>
                            </div>
                            <div class="sync-conflict-meta-row">
                                <span>更新时间：</span>
                                <span>${escapeHtml(incomingSummary.lastModified)}</span>
                            </div>
                            <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-top:2px;">最后 2 条消息透视：</div>
                            <div class="sync-conflict-messages-box">
                                ${renderMsgBox(incomingSummary.lastTwoMessages)}
                            </div>
                        </div>
                    </div>

                    <!-- 单项冲突决策选项 -->
                    <div class="sync-conflict-decision-row">
                        <span style="font-size: 11px; color: var(--text-muted); margin-right: auto;">对此会话采取的处理策略：</span>
                        <label class="sync-conflict-option" title="将待导入版本作为最新版本覆盖本地，原本地版本将自动安全移入【回收站】保留10天">
                            <input type="radio" name="conv_conflict_${index}" value="overwrite" data-id="${escapeHtml(conflict.convId)}">
                            <span style="font-weight:500;">覆盖本地会话</span>
                            <span style="font-size:10px;color:var(--accent-orange, #d97706);">(旧版入回收站)</span>
                        </label>
                        <label class="sync-conflict-option" title="本地现有会话原汁原味保持不变，待导入版本另存为 (同步副本)">
                            <input type="radio" name="conv_conflict_${index}" value="keep_both" data-id="${escapeHtml(conflict.convId)}" checked>
                            <span style="font-weight:500;">保留两者</span>
                            <span style="font-size:10px;color:var(--primary-color, #3b82f6);">(创建同步副本)</span>
                        </label>
                        <label class="sync-conflict-option" title="放弃导入此会话，本地维持原状">
                            <input type="radio" name="conv_conflict_${index}" value="skip" data-id="${escapeHtml(conflict.convId)}">
                            <span>跳过此会话</span>
                        </label>
                    </div>
                `;
                container.appendChild(card);
            });
        }

        // 快捷批量选择
        const setAll = (val) => {
            if (!container) return;
            conflictList.forEach((_, index) => {
                const radio = container.querySelector(`input[name="conv_conflict_${index}"][value="${val}"]`);
                if (radio) radio.checked = true;
            });
        };

        if (batchOverwriteBtn) batchOverwriteBtn.onclick = () => setAll('overwrite');
        if (batchKeepBtn) batchKeepBtn.onclick = () => setAll('keep_both');
        if (batchSkipBtn) batchSkipBtn.onclick = () => setAll('skip');

        const onBackdropClick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(null);
            }
        };
        modal.addEventListener('click', onBackdropClick);

        const cleanup = () => {
            modal.classList.remove('visible');
            modal.style.display = 'none';
            if (batchOverwriteBtn) batchOverwriteBtn.onclick = null;
            if (batchKeepBtn) batchKeepBtn.onclick = null;
            if (batchSkipBtn) batchSkipBtn.onclick = null;
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            modal.removeEventListener('click', onBackdropClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        };
        document.addEventListener('keydown', onKeyDown);

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };
        }
        if (closeBtn) {
            closeBtn.onclick = () => {
                cleanup();
                resolve(null);
            };
        }

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                const decisions = {};
                conflictList.forEach((conflict, index) => {
                    const checkedRadio = container?.querySelector(`input[name="conv_conflict_${index}"]:checked`);
                    decisions[conflict.convId] = checkedRadio ? checkedRadio.value : 'keep_both';
                });
                cleanup();
                resolve(decisions);
            };
        }

        modal.style.display = 'flex';
        modal.classList.add('visible');
    });
}
