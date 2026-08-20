/**
 * @file worldbook-modal.js
 * @description Handles World Book (memory) modal and management.
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { escapeHtml } from '../utils.js?v=260820-1';

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
export function updateFormSessionToggleState(isGlobalEnabled, isSessionChecked = false) {
    if (!dom.worldBookSessionToggleInput) return;
    const currentConvId = state.currentConversationId;
    
    // — 为什么这么写 —
    // 1. 若当前未打开任何会话，无法针对会话局部挂载，必须置灰禁用并给出明确提示
    // 2. 若开启全局生效，条目自动在所有会话（包括当前会话）生效，局部开关自动打勾并置灰禁用
    // 3. 若关闭全局生效，局部开关恢复可编辑，允许用户自由决定是否在当前会话生效
    if (!currentConvId) {
        dom.worldBookSessionToggleInput.checked = false;
        dom.worldBookSessionToggleInput.disabled = true;
        if (dom.worldBookSessionToggleContainer) {
            dom.worldBookSessionToggleContainer.title = '未进入任何会话，无法开启局部生效';
        }
        return;
    }
    
    if (isGlobalEnabled) {
        dom.worldBookSessionToggleInput.checked = true;
        dom.worldBookSessionToggleInput.disabled = true;
        if (dom.worldBookSessionToggleContainer) {
            dom.worldBookSessionToggleContainer.title = '已全局生效（包含当前会话）';
        }
    } else {
        dom.worldBookSessionToggleInput.disabled = false;
        dom.worldBookSessionToggleInput.checked = Boolean(isSessionChecked);
        if (dom.worldBookSessionToggleContainer) {
            dom.worldBookSessionToggleContainer.title = '仅在当前会话中生效';
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
    const currentConvId = state.currentConversationId;
    const selectedEntries = Object.values(state.worldBook).filter(entry => {
        if (entry.enabled) return true;
        if (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId)) return true;
        return false;
    });
    updateSelectedCount(selectedEntries.length);
    
    dom.worldBookModal.style.display = 'flex';
    dom.worldBookModal.classList.add('visible');
}

export function resetWorldBookForm() {
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

export function renderWorldBookList() {
    dom.worldBookList.innerHTML = '';
    const entries = Object.values(state.worldBook).sort((a, b) => a.depth - b.depth);

    if (entries.length === 0) {
        dom.worldBookList.innerHTML = `<p style="color: var(--text-secondary); text-align: center;">还没有备忘录条目，请添加一个。</p>`;
        return;
    }

    const currentConvId = state.currentConversationId;
    entries.forEach(entry => {
        if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
        const globalChecked = entry.enabled ? 'checked' : '';
        const sessionChecked = (entry.enabled || (currentConvId && entry.sessionIds.includes(currentConvId))) ? 'checked' : '';
        const sessionDisabled = entry.enabled ? 'disabled' : '';
        const itemHTML = `
            <div class="regex-rule-item worldbook-item" draggable="true">
                <div class="worldbook-item-content">
                    <div class="regex-rule-item-name">${entry.name} ${entry.enabled ? '' : '(未全局挂载)'}</div>
                    ${Array.isArray(entry.tags) && entry.tags.length > 0 ? `<div class="worldbook-item-tags">${entry.tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                    <div class="persona-item-prompt">${entry.content}</div>
                    <div class="scope-badges">
                        <span class="scope-badge">深度: ${entry.depth}</span>
                        <span class="scope-badge">角色: ${entry.role}</span>
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
        dom.worldBookList.innerHTML += itemHTML;
    });
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
        const entries = Object.values(state.worldBook)
            .filter(entry => {
                // 全局生效 或 当前会话生效
                if (entry.enabled) return true;
                if (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId)) return true;
                return false;
            })
            .sort((a, b) => a.depth - b.depth);
        
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
    const entries = Object.values(state.worldBook).sort((a, b) => a.depth - b.depth);
    
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
    entries.forEach(entry => {
        if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
        const globalChecked = entry.enabled ? 'checked' : '';
        const sessionChecked = (entry.enabled || (currentConvId && entry.sessionIds.includes(currentConvId))) ? 'checked' : '';
        const sessionDisabled = entry.enabled ? 'disabled' : '';
        
        const tagsHTML = Array.isArray(entry.tags) && entry.tags.length > 0 ? `
            <div class="worldbook-item-tags">
                ${entry.tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}
            </div>
        ` : '';
        
        // 根据 allowDrag 决定是否添加 draggable 属性
        const draggableAttr = allowDrag ? 'draggable="true"' : '';
        
        const itemHTML = `
            <div class="regex-rule-item worldbook-item" ${draggableAttr}>
                <div class="worldbook-item-content">
                    <div class="regex-rule-item-name">${entry.name} ${entry.enabled ? '' : '(未全局挂载)'}</div>
                    ${tagsHTML}
                    <div class="persona-item-prompt">${entry.content}</div>
                    <div class="scope-badges">
                        <span class="scope-badge">深度: ${entry.depth}</span>
                        <span class="scope-badge">角色: ${entry.role}</span>
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
        dom.worldBookList.innerHTML += itemHTML;
    });
}
