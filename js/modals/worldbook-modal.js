/**
 * @file worldbook-modal.js
 * @description Handles World Book (memory) modal and management.
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { escapeHtml, countTokens } from '../utils.js?v=temp';

// 更新已选中标签页的数量显示
function updateSelectedCount(count) {
    if (dom.selectedCount) {
        dom.selectedCount.textContent = `(${count})`;
    }
}

/**
 * 更新表单中局部生效开关的状态与可用性
 * @param {boolean} isGlobalEnabled - 全局生效是否开启
 * @param {boolean} isSessionChecked - 局部生效是否勾选（仅在非全局时生效）
 */
/**
 * 智能获取当前激活的会话 ID（具备 DOM 与单会话自动识别兜底）
 * @returns {string|null}
 */
export function getSafeActiveConversationId() {
    if (state.currentConversationId && state.conversations && state.conversations[state.currentConversationId]) {
        return state.currentConversationId;
    }
    if (typeof document !== 'undefined') {
        const activeDom = document.querySelector('.history-item.active, [data-conversation-id].active, [data-id].active');
        const domId = activeDom?.dataset?.id || activeDom?.dataset?.conversationId;
        if (domId && state.conversations && state.conversations[domId]) {
            state.currentConversationId = domId;
            return domId;
        }
    }
    const convKeys = Object.keys(state.conversations || {});
    if (convKeys.length === 1) {
        state.currentConversationId = convKeys[0];
        return convKeys[0];
    }
    return state.currentConversationId || null;
}

export function updateFormSessionToggleState(isGlobalEnabled, isSessionChecked = false) {
    if (!dom.worldBookSessionToggleInput) return;
    const currentConvId = getSafeActiveConversationId();
    
    // — 为什么这么写 —
    // 1. 若当前未打开任何会话（空白态/刚进系统未发消息）：
    //    - 若开启全局：局部开关打勾禁用（全局自然覆盖所有未来会话）
    //    - 若关闭全局：允许点击局部开关，点击时意图驱动自动创建新会话并绑定生效！
    // 2. 若当前已有活动会话：
    //    - 开启全局：局部开关打勾禁用
    //    - 关闭全局：局部开关恢复勾选交互，精确挂载到当前会话
    if (!currentConvId) {
        if (isGlobalEnabled) {
            dom.worldBookSessionToggleInput.checked = true;
            dom.worldBookSessionToggleInput.disabled = true;
            if (dom.worldBookSessionToggleContainer) {
                dom.worldBookSessionToggleContainer.title = '已全局生效（包含所有会话）';
                dom.worldBookSessionToggleContainer.style.cursor = 'not-allowed';
            }
        } else {
            dom.worldBookSessionToggleInput.checked = Boolean(isSessionChecked);
            dom.worldBookSessionToggleInput.disabled = false;
            if (dom.worldBookSessionToggleContainer) {
                dom.worldBookSessionToggleContainer.title = '仅在当前新会话生效（点击或保存时将自动创建新会话）';
                dom.worldBookSessionToggleContainer.style.cursor = 'pointer';
            }
        }
        return;
    }
    
    if (isGlobalEnabled) {
        dom.worldBookSessionToggleInput.checked = true;
        dom.worldBookSessionToggleInput.disabled = true;
        if (dom.worldBookSessionToggleContainer) {
            dom.worldBookSessionToggleContainer.title = '已全局生效（包含当前会话）';
            dom.worldBookSessionToggleContainer.style.cursor = 'not-allowed';
        }
    } else {
        dom.worldBookSessionToggleInput.disabled = false;
        dom.worldBookSessionToggleInput.checked = Boolean(isSessionChecked);
        if (dom.worldBookSessionToggleContainer) {
            dom.worldBookSessionToggleContainer.title = '仅在当前会话中生效';
            dom.worldBookSessionToggleContainer.style.cursor = 'pointer';
        }
    }
}

/**
 * 切换备忘录在移动端的视图（'list' 或 'form'）
 * @param {'list'|'form'} view 
 */
export function setWorldBookMobileView(view = 'list') {
    if (!dom.worldBookModal) return;
    dom.worldBookModal.dataset.mobileView = view;
    if (dom.worldBookMobileNav) {
        dom.worldBookMobileNav.querySelectorAll('.wb-mobile-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.wbView === view);
        });
    }
}

/**
 * 切换备忘录文本输入框的最大化展开/还原模式
 * @param {boolean} [forceState] - 可选的显式强制状态
 */
export function toggleWorldBookContentExpand(forceState) {
    if (!dom.worldBookModal) return;
    const isCurrentlyExpanded = dom.worldBookModal.classList.contains('content-expanded');
    const shouldBeExpanded = typeof forceState === 'boolean' ? forceState : !isCurrentlyExpanded;
    
    dom.worldBookModal.classList.toggle('content-expanded', shouldBeExpanded);
    if (dom.worldBookContentGroup) {
        dom.worldBookContentGroup.classList.toggle('content-expanded', shouldBeExpanded);
    }
    
    if (dom.worldBookContentExpandBtn) {
        const iconExpand = dom.worldBookContentExpandBtn.querySelector('.icon-expand');
        const iconCompress = dom.worldBookContentExpandBtn.querySelector('.icon-compress');
        if (iconExpand && iconCompress) {
            iconExpand.style.display = shouldBeExpanded ? 'none' : 'block';
            iconCompress.style.display = shouldBeExpanded ? 'block' : 'none';
        }
        dom.worldBookContentExpandBtn.title = shouldBeExpanded ? '还原 (ESC退出)' : '放大编辑 (ESC退出)';
    }
    
    if (shouldBeExpanded && dom.worldBookContentInput) {
        dom.worldBookContentInput.focus();
    }
}

export function openWorldBookModal() {
    dom.worldBookMergeToggle.checked = state.appSettings.mergeWorldBook;
    
    // — 为什么这么写 —
    // 每次打开弹窗时，必须强制重置为“全部”标签页与“全部”标签勾选，绝不继承上次关闭弹窗前的临时筛选状态
    state.worldBookFilter.activeTab = 'all';
    state.worldBookFilter.mode = 'single';
    
    if (dom.worldBookTagsPanel) {
        const singleRadio = dom.worldBookTagsPanel.querySelector('input[name="tag-logic"][value="single"]');
        if (singleRadio) singleRadio.checked = true;
    }
    
    if (dom.worldBookListTabs) {
        dom.worldBookListTabs.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === 'all');
        });
    }
    if (dom.worldBookTagSearchInput) {
        dom.worldBookTagSearchInput.value = '';
    }
    
    // 强制重置标签筛选为“全部”勾选
    renderWorldBookTagsPanel(true);
    renderWorldBookList();
    resetWorldBookForm();
    setWorldBookMobileView('list');
    toggleWorldBookContentExpand(false);
    
    // 初始化已选中数量
    const currentConvId = getSafeActiveConversationId();
    const selectedEntries = Object.values(state.worldBook).filter(entry => {
        if (entry.enabled) return true;
        if (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId)) return true;
        return false;
    });
    updateSelectedCount(selectedEntries.length);
    
    dom.worldBookModal.style.display = 'flex';
    dom.worldBookModal.classList.add('visible');
}

/**
 * 备忘录排序比对函数：基于 order 字段升序排序，无 order 时平滑回退至 depth
 */
export function sortWorldBookEntries(entries) {
    return (entries || []).slice().sort((a, b) => {
        const orderA = typeof a.order === 'number' ? a.order : (typeof a.depth === 'number' ? a.depth : 0);
        const orderB = typeof b.order === 'number' ? b.order : (typeof b.depth === 'number' ? b.depth : 0);
        if (orderA !== orderB) return orderA - orderB;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });
}

export function resetWorldBookForm() {
    if (dom.worldBookPositionSelector) dom.worldBookPositionSelector.value = 'top';
    if (dom.worldBookDepthLabelText) dom.worldBookDepthLabelText.textContent = '挂载深度';
    if (dom.worldBookDepthInput) dom.worldBookDepthInput.disabled = false;
    if (dom.worldBookRoleSelector) dom.worldBookRoleSelector.disabled = false;
    if (dom.worldBookDepthGroup) dom.worldBookDepthGroup.style.display = '';
    if (dom.worldBookAppendAllGroup) dom.worldBookAppendAllGroup.style.display = 'none';
    if (dom.worldBookAppendAllToggle) dom.worldBookAppendAllToggle.checked = false;
    dom.worldBookIdInput.value = '';
    dom.worldBookNameInput.value = '';
    dom.worldBookContentInput.value = '';
    dom.worldBookDepthInput.value = 10;
    dom.worldBookRoleSelector.value = 'system';
    dom.worldBookEnabledToggle.checked = true;
    
    // 联动重置局部生效状态（默认全局开启，局部置灰打勾）
    updateFormSessionToggleState(true, false);
    
    if (dom.worldBookTagsInput) dom.worldBookTagsInput.value = '';
    if (dom.worldBookTagsDisplay) dom.worldBookTagsDisplay.innerHTML = '';
    dom.worldBookFormTitle.textContent = '添加新条目';
    if (dom.wbMobileFormTabText) dom.wbMobileFormTabText.textContent = '添加条目';
    dom.worldBookCancelBtn.style.display = 'none';
    updateCharCounter();
}

export function updateCharCounter() {
    const count = dom.worldBookContentInput.value.length;
    dom.worldBookCharCounter.textContent = `${count} 字`;
}

/**
 * 生成备忘录单条卡片的 HTML 字符串（在左下角展示预估 Token 和字数）
 * @param {object} entry - 备忘录条目
 * @param {string} currentConvId - 当前会话ID
 * @param {boolean} allowDrag - 是否允许拖拽
 * @returns {string} 卡片 HTML
 */
function renderWorldBookCardHTML(entry, currentConvId, allowDrag = true) {
    if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
    const globalChecked = entry.enabled ? 'checked' : '';
    const sessionChecked = (entry.enabled || (currentConvId && entry.sessionIds.includes(currentConvId))) ? 'checked' : '';
    const sessionDisabled = entry.enabled ? 'disabled' : '';

    const tagsHTML = Array.isArray(entry.tags) && entry.tags.length > 0 ? `
        <div class="worldbook-item-tags">
            ${entry.tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}
        </div>
    ` : '';

    const draggableAttr = allowDrag ? 'draggable="true"' : '';
    const textContent = entry.content || '';
    const charCount = textContent.length;
    const tokenCount = countTokens(textContent);

    let posText = '顶部系统';
    let depthBadge = `<span class="scope-badge">挂载深度: ${entry.depth ?? 10}</span>`;
    let roleBadge = `<span class="scope-badge">角色: ${entry.role || 'system'}</span>`;

    if (entry.position === 'chat_start') {
        posText = '历史前';
        depthBadge = `<span class="scope-badge">挂载深度: ${entry.depth ?? 10}</span>`;
    } else if (entry.position === 'chat_end') {
        posText = '历史流 (倒数)';
        depthBadge = `<span class="scope-badge">倒数深度: ${entry.depth ?? 0}</span>`;
    } else if (entry.position === 'append_to_user') {
        posText = entry.appendAllUser ? '跟随发言 (每条)' : '跟随发言 (仅末条)';
        depthBadge = '';
        roleBadge = '';
    }

    return `
        <div class="regex-rule-item worldbook-item" data-id="${entry.id}" ${draggableAttr}>
            <div class="worldbook-item-content">
                <div class="regex-rule-item-name">${escapeHtml(entry.name || '未命名')} ${entry.enabled ? '' : '(未全局挂载)'}</div>
                ${tagsHTML}
                <div class="persona-item-prompt">${escapeHtml(textContent)}</div>
                <div class="scope-badges">
                    <span class="scope-badge">${posText}</span>
                    ${depthBadge}
                    ${roleBadge}
                    <label class="toggle-label" title="在所有会话中都生效">
                        <span>全局</span>
                        <label class="theme-switch small">
                            <input type="checkbox" data-id="${entry.id}" ${globalChecked} class="worldbook-item-toggle">
                            <span class="slider round"></span>
                        </label>
                    </label>
                    <label class="toggle-label" title="仅在当前会话中生效">
                        <span>会话</span>
                        <label class="theme-switch small">
                            <input type="checkbox" data-id="${entry.id}" ${sessionChecked} class="worldbook-session-toggle" id="worldbook-session-toggle-${entry.id}" ${sessionDisabled}>
                            <span class="slider round"></span>
                        </label>
                    </label>
                </div>
                <div class="worldbook-item-footer">
                    <div class="worldbook-item-stats" title="文本统计：${charCount} 字符，预估消耗约 ${tokenCount} Tokens">
                        <span class="wb-stat-chars">${charCount} 字</span>
                        <span class="wb-stat-separator">·</span>
                        <span class="wb-stat-tokens">~${tokenCount} Tokens</span>
                    </div>
                    <div class="worldbook-action-buttons action-btn-group">
                        <button class="action-btn edit worldbook-edit-btn" data-id="${entry.id}" title="编辑">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="action-btn copy worldbook-copy-btn" data-id="${entry.id}" title="复制内容">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="action-btn delete worldbook-delete-btn" data-id="${entry.id}" title="删除">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderWorldBookList() {
    dom.worldBookList.innerHTML = '';
    const entries = sortWorldBookEntries(Object.values(state.worldBook));

    if (entries.length === 0) {
        dom.worldBookList.innerHTML = `<p style="color: var(--text-secondary); text-align: center;">还没有备忘录条目，请添加一个。</p>`;
        return;
    }

    const currentConvId = state.currentConversationId;
    dom.worldBookList.innerHTML = entries.map(entry => renderWorldBookCardHTML(entry, currentConvId, true)).join('');
}

export function renderWorldBookTagsPanel(forceResetToAll = false) {
    if (!dom.worldBookTagList) return;
    
    // 仅在非强制重置时才尝试读取旧 DOM 中勾选的标签
    let previousSelectedTags = new Set();
    if (!forceResetToAll) {
        previousSelectedTags = new Set(Array.from(
            dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked')
        ).map(checkbox => checkbox.closest('.tag-item')?.dataset.tag).filter(Boolean));
    }
    
    dom.worldBookTagList.innerHTML = '';
    
    const tagStats = new Map();
    Object.values(state.worldBook).forEach(entry => {
        if (Array.isArray(entry.tags)) {
            entry.tags.forEach(tag => {
                tagStats.set(tag, (tagStats.get(tag) || 0) + 1);
            });
        }
    });
    
    // 确定是否勾选“全部”
    const hasSpecificChecked = !forceResetToAll && Array.from(previousSelectedTags).some(tag => tag !== '全部');
    const allIsChecked = forceResetToAll || !hasSpecificChecked || previousSelectedTags.has('全部');
    
    const allCheckedAttr = allIsChecked ? 'checked' : '';
    const allActiveClass = allIsChecked ? 'active' : '';
    const allItemHTML = `
        <div class="tag-item ${allActiveClass}" data-tag="全部">
            <input type="checkbox" ${allCheckedAttr} class="tag-checkbox">
            <span class="tag-name">全部</span>
            <span class="tag-count">(${Object.keys(state.worldBook).length})</span>
        </div>
    `;
    dom.worldBookTagList.innerHTML = allItemHTML;
    
    Array.from(tagStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([tag, count]) => {
            const isChecked = !allIsChecked && previousSelectedTags.has(tag);
            const activeClass = isChecked ? 'active' : '';
            const checkedAttr = isChecked ? 'checked' : '';
            const itemHTML = `
                <div class="tag-item ${activeClass}" data-tag="${escapeHtml(tag)}">
                    <input type="checkbox" ${checkedAttr} class="tag-checkbox">
                    <span class="tag-name">${escapeHtml(tag)}</span>
                    <span class="tag-count">(${count})</span>
                </div>
            `;
            dom.worldBookTagList.insertAdjacentHTML('beforeend', itemHTML);
        });
        
    // 显式以 JavaScript property 方式再次赋值 checked 状态，确保浏览器渲染树立即更新
    const allCheckboxEl = dom.worldBookTagList.querySelector('.tag-item[data-tag="全部"] .tag-checkbox');
    if (allCheckboxEl) {
        allCheckboxEl.checked = allIsChecked;
    }
    
    if (allIsChecked) {
        dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"]) .tag-checkbox').forEach(cb => {
            cb.checked = false;
        });
    }

    // 确保 disabled 类与当前的 activeTab 保持严格一致
    dom.worldBookTagList.classList.toggle('disabled', state.worldBookFilter.activeTab === 'selected');
}

export function filterWorldBookByTags() {
    const activeTab = state.worldBookFilter.activeTab;
    if (dom.worldBookTagList) {
        dom.worldBookTagList.classList.toggle('disabled', activeTab === 'selected');
    }
    
    // 如果当前是"已选中"标签页，显示所有启用的条目（包括全局生效和会话生效）
    if (activeTab === 'selected') {
        const currentConvId = state.currentConversationId;
        let entries = Object.values(state.worldBook)
            .filter(entry => {
                // 全局生效 或 当前会话生效
                if (entry.enabled) return true;
                if (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId)) return true;
                return false;
            });
        entries = sortWorldBookEntries(entries);
        
        // 更新已选中数量
        updateSelectedCount(entries.length);
        
        renderFilteredWorldBookList(entries, false); // false = 禁用拖拽
        return;
    }
    
    // "全部"标签页的逻辑
    // 计算并更新已选中数量（在全部标签页也需要显示）
    const currentConvId = state.currentConversationId;
    const selectedEntries = Object.values(state.worldBook).filter(entry => {
        if (entry.enabled) return true;
        if (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId)) return true;
        return false;
    });
    updateSelectedCount(selectedEntries.length);
    
    const selectedCheckboxes = dom.worldBookTagList ? Array.from(
        dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked')
    ) : [];
    const selectedTags = selectedCheckboxes.map(checkbox => checkbox.closest('.tag-item')?.dataset.tag).filter(Boolean);
    
    // 更新标签栏与列表头部的已选标签数量徽章
    const specificSelectedTags = selectedTags.filter(tag => tag !== '全部');
    const badgeText = specificSelectedTags.length.toString();
    const hasSpecific = specificSelectedTags.length > 0;

    if (dom.worldBookSelectedTagsBadge) {
        dom.worldBookSelectedTagsBadge.textContent = badgeText;
        dom.worldBookSelectedTagsBadge.style.display = hasSpecific ? 'inline-flex' : 'none';
    }
    if (dom.worldBookOpenTagsBadge) {
        dom.worldBookOpenTagsBadge.textContent = badgeText;
        dom.worldBookOpenTagsBadge.style.display = hasSpecific ? 'inline-flex' : 'none';
    }
    
    // — 为什么这么写 —
    // 若没有选中任何具体标签，或者勾选了“全部”，强制保证“全部”处于选中与高亮状态，展示全部条目
    if (selectedTags.length === 0 || selectedTags.includes('全部')) {
        if (dom.worldBookTagList) {
            const allItem = dom.worldBookTagList.querySelector('.tag-item[data-tag="全部"]');
            if (allItem) {
                allItem.classList.add('active');
                const allCb = allItem.querySelector('.tag-checkbox');
                if (allCb) allCb.checked = true;
            }
            // 取消其他具体标签的高亮与勾选
            dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"])').forEach(item => {
                item.classList.remove('active');
                const cb = item.querySelector('.tag-checkbox');
                if (cb) cb.checked = false;
            });
        }
        renderWorldBookList();
        return;
    }
    
    const filterMode = state.worldBookFilter.mode;
    const entries = sortWorldBookEntries(Object.values(state.worldBook));
    
    const filtered = entries.filter(entry => {
        if (!Array.isArray(entry.tags) || entry.tags.length === 0) return false;
        
        // 单选或多选模式都使用 OR 逻辑（匹配任一标签）
        return selectedTags.some(tag => entry.tags.includes(tag));
    });
    
    renderFilteredWorldBookList(filtered, true);
}

export function renderFilteredWorldBookList(entries, allowDrag = true) {
    dom.worldBookList.innerHTML = '';
    
    if (entries.length === 0) {
        dom.worldBookList.innerHTML = `<p style="color: var(--text-secondary); text-align: center;">没有匹配的备忘录条目</p>`;
        return;
    }
    
    const currentConvId = state.currentConversationId;
    dom.worldBookList.innerHTML = entries.map(entry => renderWorldBookCardHTML(entry, currentConvId, allowDrag)).join('');
}
