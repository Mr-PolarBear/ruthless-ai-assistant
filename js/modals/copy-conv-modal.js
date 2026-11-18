/**
 * @file copy-conv-modal.js
 * @description 智能会话复制与减负对比弹窗 (Plan B)
 *
 * — 为什么这么写 —
 * 1. 随着会话长期使用，多轮分支重试（重新生成、分支编辑）会在 conv.branches 中积累大量冗余的废弃分支；
 * 2. 传统全量复制会导致无谓的存储膨胀与云同步带宽浪费；
 * 3. 本模块提供智能分支检测：
 *    - 当会话仅有单分支时：静默直连复制为副本，不弹窗打扰用户，极致轻快；
 *    - 当会话包含多个分支时：呈现直观对比弹窗，清晰提示“当前分支楼层 vs 废弃分支楼层”，
 *      让用户自主选择“完整复制(全量备份)”或“仅复制最新分支(会话减负)”，彻底给会话体积瘦身。
 */

import { state } from '../state.js?v=temp';
import { getConversation, saveConversation } from '../db.js?v=temp';
import { saveToLocalStorage, escapeHtml } from '../utils.js?v=temp';
import { renderHistory } from '../sidebar.js?v=temp';
import { switchToConversation } from '../main.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { normalizeRealtimeConfig } from '../services/realtime-mode.js?v=temp';

let modalOverlay = null;

/**
 * 获取或创建单例弹窗 DOM 结构
 * @returns {HTMLElement}
 */
function getOrCreateModalOverlay() {
    if (modalOverlay) return modalOverlay;

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'copy-conv-modal-overlay';
    modalOverlay.className = 'copy-conv-modal-overlay';

    // 绑定点击遮罩关闭事件
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeCopyModal();
        }
    });

    // 绑定 ESC 按键关闭
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
            closeCopyModal();
        }
    });

    document.body.appendChild(modalOverlay);
    return modalOverlay;
}

/**
 * 关闭复制弹窗
 */
export function closeCopyModal() {
    if (modalOverlay) {
        modalOverlay.classList.remove('open');
    }
}

/**
 * 打开会话复制智能调度入口
 * @param {string} convId - 目标会话ID
 */
export async function openCopyConversationModal(convId) {
    if (!convId) return;

    // 1. 获取原会话数据（优先内存，其次 IndexedDB）
    let origConv = state.conversations[convId];
    if (!origConv) {
        try {
            origConv = await getConversation(convId);
        } catch (e) {
            console.error('[copy-conv-modal] 获取待复制会话失败:', e);
        }
    }

    if (!origConv) {
        notify.error('原会话不存在或已损坏');
        return;
    }

    const branches = Array.isArray(origConv.branches) ? origConv.branches : [[]];
    const branchCount = branches.length;

    // 2. 智能分支判定：若仅有 1 个分支（或无分支），无需弹窗，直接复制并提示
    if (branchCount <= 1) {
        await executeCloneConversation(origConv, 'full');
        notify.success(`该会话仅有单分支，已直接复制为副本`);
        return;
    }

    // 3. 多分支场景：展现智能减负对比弹窗供用户决策
    renderCopyModalContent(origConv);
}

/**
 * 渲染并展示多分支对比弹窗
 * @param {Object} conv - 原会话对象
 */
function renderCopyModalContent(conv) {
    const overlay = getOrCreateModalOverlay();
    const branches = Array.isArray(conv.branches) ? conv.branches : [[]];
    const branchCount = branches.length;

    // 计算当前活动分支索引
    const activeIdx = (typeof conv.activeBranchIndex === 'number' && branches[conv.activeBranchIndex])
        ? conv.activeBranchIndex
        : (branches.length - 1);

    const activeFloorCount = (branches[activeIdx] || []).length;
    let totalFloorCount = 0;
    branches.forEach(b => {
        totalFloorCount += (Array.isArray(b) ? b.length : 0);
    });

    const discardedBranchesCount = branchCount - 1;
    const discardedFloorCount = Math.max(0, totalFloorCount - activeFloorCount);

    overlay.innerHTML = `
        <div class="copy-conv-modal" role="dialog" aria-modal="true" aria-labelledby="copy-conv-modal-title">
            <div class="copy-conv-modal-header">
                <div class="copy-conv-modal-title" id="copy-conv-modal-title">
                    <svg class="copy-conv-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    复制会话
                </div>
                <button class="copy-conv-modal-close" id="copy-conv-close-btn" title="关闭">&times;</button>
            </div>

            <div class="copy-conv-modal-body">
                <div class="copy-conv-desc">
                    检测到会话 <strong>「${escapeHtml(conv.title || '未命名会话')}」</strong> 包含 <strong>${branchCount}</strong> 个历史分支，请选择复制模式：
                </div>

                <div class="copy-conv-options">
                    <!-- 选项 1：完整复制 -->
                    <div class="copy-conv-card" data-mode="full" role="button" tabindex="0">
                        <div class="copy-conv-card-header">
                            <div class="copy-conv-card-icon copy-conv-icon-full">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                            </div>
                            <div class="copy-conv-card-info">
                                <div class="copy-conv-card-title">完整复制 (全部分支)</div>
                                <div class="copy-conv-card-meta">保留全部 ${branchCount} 个分支 · 共 ${totalFloorCount} 楼</div>
                            </div>
                        </div>
                        <div class="copy-conv-card-desc">
                            完整保留所有历史分支与重试探索记录，适合全量备份存档。
                        </div>
                        <button class="copy-conv-action-btn copy-btn-secondary" data-mode="full">
                            选择完整复制
                        </button>
                    </div>

                    <!-- 选项 2：仅复制最新分支 (减负推荐) -->
                    <div class="copy-conv-card copy-conv-card-recommended" data-mode="active_branch" role="button" tabindex="0">
                        <div class="copy-conv-badge">减负推荐</div>
                        <div class="copy-conv-card-header">
                            <div class="copy-conv-card-icon copy-conv-icon-slim">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                            </div>
                            <div class="copy-conv-card-info">
                                <div class="copy-conv-card-title">仅复制最新分支 (会话减负)</div>
                                <div class="copy-conv-card-meta">仅保留当前活动分支 · 共 ${activeFloorCount} 楼</div>
                            </div>
                        </div>
                        <div class="copy-conv-card-desc">
                            彻底剔除 <strong>${discardedBranchesCount}</strong> 个废弃分支（约 <strong>${discardedFloorCount}</strong> 楼历史冗余），会话体积大幅瘦身，响应更轻快，云同步上传更省空间。
                        </div>
                        <button class="copy-conv-action-btn copy-btn-primary" data-mode="active_branch">
                            选择精简复制
                        </button>
                    </div>
                </div>
            </div>

            <div class="copy-conv-modal-footer">
                <button class="copy-conv-cancel-btn" id="copy-conv-cancel-btn">取消</button>
            </div>
        </div>
    `;

    // 绑定关闭按钮
    const closeBtn = overlay.querySelector('#copy-conv-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeCopyModal);
    const cancelBtn = overlay.querySelector('#copy-conv-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeCopyModal);

    // 绑定选项卡片点击
    overlay.querySelectorAll('.copy-conv-card').forEach(card => {
        card.addEventListener('click', async (e) => {
            const mode = card.getAttribute('data-mode') || 'full';
            closeCopyModal();
            await executeCloneConversation(conv, mode);
        });
    });

    // 阻止卡片内部按钮点击冒泡重复触发
    overlay.querySelectorAll('.copy-conv-action-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const mode = btn.getAttribute('data-mode') || 'full';
            closeCopyModal();
            await executeCloneConversation(conv, mode);
        });
    });

    overlay.classList.add('open');
}

/**
 * 执行会话深拷贝克隆并挂载生态数据
 * @param {Object} origConv - 原会话对象
 * @param {'full'|'active_branch'} mode - 复制模式
 */
export async function executeCloneConversation(origConv, mode = 'full') {
    if (!origConv || !origConv.id) return;

    try {
        const origId = origConv.id;
        const newId = `conv_${Date.now()}`;
        const newConv = JSON.parse(JSON.stringify(origConv));

        newConv.id = newId;
        newConv.pinned = false; // 副本默认不置顶
        newConv.createdAt = Date.now();
        newConv.lastModified = new Date().toISOString();

        if (newConv.realtimeMode && (typeof newConv.realtimeMode === 'object' || typeof newConv.realtimeMode === 'string')) {
            newConv.realtimeMode = normalizeRealtimeConfig(newConv.realtimeMode);
        }

        if (mode === 'active_branch') {
            // — 为什么这么写 —
            // 核心减负逻辑：提取当前正在查看/对话的活动分支，将 branches 数组剪枝为仅包含此单一分支，
            // 并将 activeBranchIndex 重置为 0，彻底抛弃所有的废弃历史分支与死胡同重试
            const branches = Array.isArray(origConv.branches) ? origConv.branches : [[]];
            const activeIdx = (typeof origConv.activeBranchIndex === 'number' && branches[origConv.activeBranchIndex])
                ? origConv.activeBranchIndex
                : (branches.length - 1);

            const activeBranchMsgs = branches[activeIdx] || [];
            newConv.branches = [JSON.parse(JSON.stringify(activeBranchMsgs))];
            newConv.activeBranchIndex = 0;
            newConv.title = `${origConv.title || '对话'} (精简副本)`;
        } else {
            // 完整模式：保留全部原始分支数组与活动分支索引
            newConv.title = `${origConv.title || '对话'} (副本)`;
        }

        // 3. 复制该会话关联的隐藏与总结配置及历史版本（state.hideSummary）
        if (state.hideSummary && state.hideSummary[origId]) {
            state.hideSummary[newId] = JSON.parse(JSON.stringify(state.hideSummary[origId]));
        }

        // 4. 复制该会话在备忘录中的局部挂载生效关系（state.worldBook）
        let hasWorldBookSync = false;
        if (state.worldBook && typeof state.worldBook === 'object') {
            Object.values(state.worldBook).forEach(entry => {
                if (entry && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(origId)) {
                    if (!entry.sessionIds.includes(newId)) {
                        entry.sessionIds.push(newId);
                        hasWorldBookSync = true;
                    }
                }
            });
        }

        // 5. 复制该会话绑定的专属正则（深拷贝创建独立副本给新会话）
        if (state.regexRules && typeof state.regexRules === 'object') {
            Object.values(state.regexRules).forEach(rule => {
                if (rule && rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.includes(origId)) {
                    const newRuleId = `regex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    state.regexRules[newRuleId] = {
                        ...JSON.parse(JSON.stringify(rule)),
                        id: newRuleId,
                        sessionIds: [newId]
                    };
                }
            });
        }

        // 6. 持久化存储至 IndexedDB 与 LocalStorage
        state.conversations[newId] = newConv;
        await saveConversation(newId, newConv);
        await saveToLocalStorage();

        // 7. 刷新侧边栏与动态 UI
        try {
            renderHistory();
        } catch (e) {
            console.warn('[copy-conv-modal] 侧边栏刷新非致命警告:', e);
        }
        if (hasWorldBookSync && window.updateWorldBookButton) {
            try {
                window.updateWorldBookButton();
            } catch (e) {
                console.warn('[copy-conv-modal] 备忘录按钮刷新非致命警告:', e);
            }
        }

        // 8. 切换至新副本会话
        try {
            switchToConversation(newId);
        } catch (e) {
            console.warn('[copy-conv-modal] 切换会话非致命警告:', e);
        }

        const modeDesc = mode === 'active_branch' ? '精简减负' : '完整';
        notify.success(`已完成${modeDesc}复制: "${newConv.title}"`);
    } catch (err) {
        console.error('[copy-conv-modal] 复制会话失败:', err);
        notify.error('复制会话失败: ' + (err.message || '未知错误'));
    }
}
