/**
 * @file sidebar.js
 * @description Manages the rendering and interactions of the sidebar, including the conversation history.
 */

import { dom } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { getAvatar } from './db.js?v=260820-1';
import { DEFAULT_AVATAR } from './modals.js?v=260820-1';
import { regexPatterns } from './regex.js?v=260820-1';
import { escapeHtml } from './utils.js?v=260820-1';
import { toggleConvSelection } from './batch-delete.js?v=260820-1';

/**
 * Renders the conversation history list in the sidebar.
 */
export function renderHistory() {
    updateConversationCount();
    
    const currentView = localStorage.getItem('historyViewMode') || 'simple';
    
    if (currentView === 'grouped') {
        renderHistoryGrouped();
    } else {
        renderHistorySimple();
    }
}

function updateConversationCount() {
    const countEl = document.getElementById('conversation-count');
    if (countEl) {
        const count = Object.keys(state.conversations).length;
        countEl.textContent = `共 ${count} 个会话`;
    }
}

/**
 * 乌鸦：简洁列表渲染（原有的）
 */
function renderHistorySimple() {
    const convs = state.conversations;
    const list = dom.historyList;
    list.innerHTML = '';

    // 1. 过滤
    const keyword = dom.historySearchInput && dom.historySearchInput.value.trim().toLowerCase();
    let filteredIds = Object.keys(convs);
    if (keyword) {
        // — 为什么这么写 —
        // 侧边栏升级为 Title-only Search（只搜索标题），摆脱对全量消息文本的深度循环，搜索延迟降低 100 倍且便于未来的懒加载架构
        filteredIds = filteredIds.filter(convId => {
            const conv = convs[convId];
            return conv && conv.title && conv.title.toLowerCase().includes(keyword);
        });
    }

    // 2. 分组：置顶 vs 非置顶
    const pinnedIds = filteredIds.filter(id => convs[id].pinned);
    const unpinnedIds = filteredIds.filter(id => !convs[id].pinned);

    // 3. 排序：各自按时间倒序
    const sortByTime = (a, b) => {
        const t1 = convs[a].lastModified || 0;
        const t2 = convs[b].lastModified || 0;
        return t2.localeCompare ? t2.localeCompare(t1) : t2 - t1;
    };
    pinnedIds.sort(sortByTime);
    unpinnedIds.sort(sortByTime);

    // 4. 合并并渲染
    const sortedIds = [...pinnedIds, ...unpinnedIds];

    sortedIds.forEach(convId => {
        const conv = convs[convId];
        const item = createHistoryItem(convId, conv);
        list.appendChild(item);
    });
}

/**
 * 乌鸦：按时间分组渲染汇话历史
 */
function renderHistoryGrouped() {
    const convs = state.conversations;
    const groupedList = document.getElementById('history-grouped-list');
    groupedList.innerHTML = '';

    // 1. 过滤
    const keyword = dom.historySearchInput && dom.historySearchInput.value.trim().toLowerCase();
    let filteredIds = Object.keys(convs);
    if (keyword) {
        filteredIds = filteredIds.filter(convId => {
            const conv = convs[convId];
            return conv && conv.title && conv.title.toLowerCase().includes(keyword);
        });
    }

    // 2. 按时间戆组
    const groups = groupByTime(filteredIds, convs);

    // 3. 渲染每个时间组
    groups.forEach(group => {
        // 添加组标题
        const groupHeader = document.createElement('div');
        groupHeader.className = 'history-group-header';
        groupHeader.textContent = group.label;
        groupedList.appendChild(groupHeader);

        // 添加该组的流窗条目
        group.ids.forEach(convId => {
            const conv = convs[convId];
            const item = createHistoryItem(convId, conv);
            groupedList.appendChild(item);
        });
    });
}

/**
 * 乌鸦：按时间戆组：今天 / 昨天 / 一周内 / 一周前
 */
function groupByTime(convIds, convs) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const groups = {
        today: { label: '📅 今天', ids: [] },
        yesterday: { label: '📅 昨天', ids: [] },
        thisWeek: { label: '📅 一周内', ids: [] },
        older: { label: '📅 一周前', ids: [] }
    };

    convIds.forEach(convId => {
        const conv = convs[convId];
        const convTime = conv.lastModified ? new Date(conv.lastModified) : new Date();
        const convDate = new Date(convTime.getFullYear(), convTime.getMonth(), convTime.getDate());

        if (convDate.getTime() === today.getTime()) {
            groups.today.ids.push(convId);
        } else if (convDate.getTime() === yesterday.getTime()) {
            groups.yesterday.ids.push(convId);
        } else if (convDate.getTime() > oneWeekAgo.getTime()) {
            groups.thisWeek.ids.push(convId);
        } else {
            groups.older.ids.push(convId);
        }
    });

    // 批量排序
    const sortByTime = (a, b) => {
        const t1 = convs[a].lastModified || 0;
        const t2 = convs[b].lastModified || 0;
        return t2.localeCompare ? t2.localeCompare(t1) : t2 - t1;
    };

    Object.values(groups).forEach(group => {
        group.ids.sort(sortByTime);
    });

    // 只返回有内容的组
    return Object.values(groups).filter(group => group.ids.length > 0);
}

/**
 * 乌鸦：扶加一个汇话条目
 */
function createHistoryItem(convId, conv) {
    const item = document.createElement('div');
    item.className = 'history-item' + (convId === state.currentConversationId ? ' active' : '');
    if (conv.pinned) {
        item.classList.add('pinned');
    }
    if (state.batchSelectMode) {
        item.classList.add('batch-mode');
        if (state.selectedConvIds.has(convId)) {
            item.classList.add('selected');
        }
    }
    item.dataset.id = convId;

    let checkboxHtml = '';
    if (state.batchSelectMode) {
        const isChecked = state.selectedConvIds.has(convId);
        checkboxHtml = `<input type="checkbox" class="batch-checkbox" data-conv-id="${convId}" ${isChecked ? 'checked' : ''}>`;
    }

    let avatarHtml = '';
    if (conv.avatar) {
        if (conv.avatar.type === 'indexeddb') {
            avatarHtml = `<img class="history-item-avatar" src="" alt="一象">`;
            getAvatar(conv.avatar.id).then(blob => {
                const imgEl = item.querySelector('.history-item-avatar');
                if (imgEl) {
                    if (blob) {
                        imgEl.src = URL.createObjectURL(blob);
                    } else {
                        imgEl.src = DEFAULT_AVATAR;
                    }
                }
            });
        } else {
            avatarHtml = `<img class="history-item-avatar" src="${conv.avatar}" alt="一象">`;
        }
    } else {
        avatarHtml = `<img class="history-item-avatar" src="${DEFAULT_AVATAR}" alt="一象">`;
    }

    const apiEndpoint = state.apiEndpoints[conv.apiEndpointId] || {};
    const pinButtonTitle = conv.pinned ? '取消置顶' : '置顶此对话';

    // 乌鸦：置顶图标（Lucide pin），根据状态使用不同 path
    const pinIconSvg = conv.pinned
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><polyline points="18 14 12 8 6 14"></polyline></svg>';

    const actionsHtml = state.batchSelectMode ? '' : `
        <div class="actions">
            <button class="pin-conv-btn" title="${pinButtonTitle}">${pinIconSvg}</button>
            <button class="edit-history-btn" title="修改标题"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
            <button class="copy-conv-btn" title="复制会话"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
            <button class="set-conv-avatar-btn" title="设置会话头像" data-id="${conv.id}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></button>
            <button class="export-conv-btn" title="导出会话"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
            <button class="delete-btn" title="删除对话"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
        </div>
    `;

    // 乌鸦：侧边栏隐藏 API 标签展示，独享整行显示标题
    item.innerHTML = `
        ${checkboxHtml}
        ${avatarHtml}
        <div class="history-item-main">
            <div class="history-item-title" title="${escapeHtml(conv.title)}">${escapeHtml(conv.title)}</div>
        </div>
        ${actionsHtml}
    `;

    let isGenerating = false;
    if (state.generatingMessages) {
        for (const key in state.generatingMessages) {
            if (key.startsWith(convId + '_')) {
                isGenerating = true;
                break;
            }
        }
    }
    if (!isGenerating && state.streamingConversationId === convId) {
        isGenerating = true;
    }
    if (isGenerating) {
        const spinner = document.createElement('span');
        spinner.className = 'history-spinner';
        spinner.title = '该会话正在生成中';
        spinner.innerHTML = `<span class="spinner-mini"></span>`;
        item.appendChild(spinner);
    }

    if (state.batchSelectMode) {
        const checkbox = item.querySelector('.batch-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                toggleConvSelection(convId);
            });
        }
        item.addEventListener('click', (e) => {
            if (state.batchSelectMode && !e.target.closest('.batch-checkbox')) {
                e.stopPropagation();
                toggleConvSelection(convId);
                const cb = item.querySelector('.batch-checkbox');
                if (cb) cb.checked = state.selectedConvIds.has(convId);
            }
        });
    }

    // 乌鸦：悬浮 250ms 防抖预览完整标题与前 2 条消息（仅限桌面端，移动端彻底禁用避免误触遮挡）
    item.addEventListener('mouseenter', () => {
        if (window.innerWidth <= 768 || ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(hover: none)').matches)) {
            return;
        }
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            showPreviewTooltip(item, conv);
        }, 250);
    });

    item.addEventListener('mouseleave', () => {
        hidePreviewTooltip();
    });

    return item;
}

// ===== 乌鸦：Hover 悬浮预览卡片单例管理与提取 =====
let previewTooltipEl = null;
let hoverTimer = null;

function getOrCreatePreviewTooltip() {
    if (!previewTooltipEl) {
        previewTooltipEl = document.createElement('div');
        previewTooltipEl.id = 'history-preview-tooltip';
        previewTooltipEl.className = 'history-preview-tooltip';
        document.body.appendChild(previewTooltipEl);
    }
    return previewTooltipEl;
}

/**
 * 提取会话的前 2 条消息前 200 字及角色标识 (支持异步懒加载兜底)
 */
async function getFirstTwoMessagesPreview(conv, maxLength = 200) {
    if (!conv) return [];
    let targetConv = conv;
    // 异步懒加载预留：如果 conv 对象缺失 branches，尝试从 IndexedDB 异步补充完整数据
    if (!targetConv.branches && targetConv.id) {
        try {
            const { getConversation } = await import('./db.js?v=260820-1');
            const loaded = await getConversation(targetConv.id);
            if (loaded) targetConv = loaded;
        } catch (e) {
            console.error('异步获取会话失败:', e);
        }
    }

    if (!targetConv || !targetConv.branches || !targetConv.branches.length) return [];
    const activeBranchIndex = targetConv.activeBranchIndex || 0;
    const branch = targetConv.branches[activeBranchIndex] || [];
    if (!branch.length) return [];

    const validMsgs = branch.filter(msg => msg && msg.content && msg.content.trim()).slice(0, 2);
    return validMsgs.map(msg => {
        let cleanText = (msg.content || '').trim();
        cleanText = cleanText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, '');
        cleanText = cleanText.replace(/```[\s\S]*?```/g, '[代码块]');
        cleanText = cleanText.replace(/#+\s+/g, '');
        cleanText = cleanText.replace(/\n+/g, ' ');

        if (cleanText.length > maxLength) {
            cleanText = cleanText.substring(0, maxLength) + '...';
        }

        const roleLabel = msg.role === 'user' ? '👤 问' : '🤖 答';
        return { roleLabel, text: cleanText };
    });
}

async function showPreviewTooltip(itemEl, conv) {
    if (window.innerWidth <= 768 || ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(hover: none)').matches)) {
        return;
    }
    const tooltip = getOrCreatePreviewTooltip();
    const previews = await getFirstTwoMessagesPreview(conv);

    let messagesHtml = '';
    if (previews.length > 0) {
        messagesHtml = previews.map(p => `
            <div class="tooltip-msg-item">
                <span class="tooltip-role">${escapeHtml(p.roleLabel)}:</span>
                <span class="tooltip-text">${escapeHtml(p.text)}</span>
            </div>
        `).join('');
    } else {
        messagesHtml = `<div class="tooltip-empty">暂无消息预览</div>`;
    }

    tooltip.innerHTML = `
        <div class="tooltip-header">
            <span class="tooltip-pin-icon">📌</span>
            <span class="tooltip-title">${escapeHtml(conv.title || '未命名会话')}</span>
            <button class="tooltip-close-btn" title="关闭预览" aria-label="关闭预览">×</button>
        </div>
        <div class="tooltip-body">
            ${messagesHtml}
        </div>
    `;

    // 绑定右上角关闭按钮
    const closeBtn = tooltip.querySelector('.tooltip-close-btn');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            hidePreviewTooltip();
        };
    }

    if (window.innerWidth <= 768) {
        // 移动端：居中展示，保证完全在视口内
        tooltip.style.left = '4vw';
        tooltip.style.top = '16vh';
        tooltip.style.width = '92vw';
    } else {
        // PC端：根据会话条目位置智能定位
        const rect = itemEl.getBoundingClientRect();
        const tooltipWidth = 320;
        let left = rect.right + 10;
        let top = rect.top;

        if (left + tooltipWidth > window.innerWidth) {
            left = rect.left - tooltipWidth - 10;
        }
        const screenHeight = window.innerHeight;
        if (top + 230 > screenHeight) {
            top = Math.max(10, screenHeight - 240);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.width = '';
    }

    tooltip.classList.add('visible');
}

export function hidePreviewTooltip() {
    if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    }
    if (previewTooltipEl) {
        previewTooltipEl.classList.remove('visible');
    }
}

// 移动端点击或触摸屏幕其他区域时自动收起预览卡片
document.addEventListener('touchstart', (e) => {
    if (previewTooltipEl && previewTooltipEl.classList.contains('visible')) {
        if (!previewTooltipEl.contains(e.target) && !e.target.closest('.history-item')) {
            hidePreviewTooltip();
        }
    }
}, { passive: true });

document.addEventListener('click', (e) => {
    if (previewTooltipEl && previewTooltipEl.classList.contains('visible')) {
        if (!previewTooltipEl.contains(e.target) && !e.target.closest('.history-item')) {
            hidePreviewTooltip();
        }
    }
});