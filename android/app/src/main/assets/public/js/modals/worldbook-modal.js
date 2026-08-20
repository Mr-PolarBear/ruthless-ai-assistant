/**
 * @file worldbook-modal.js
 * @description Handles World Book (memory) modal and management.
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

// 更新已选中标签页的数量显示
function updateSelectedCount(count) {
    if (dom.selectedCount) {
        dom.selectedCount.textContent = `(${count})`;
    }
}

export function openWorldBookModal() {
    dom.worldBookMergeToggle.checked = state.appSettings.mergeWorldBook;
    renderWorldBookList();
    renderWorldBookTagsPanel();
    resetWorldBookForm();
    
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
    if (dom.worldBookTagsInput) dom.worldBookTagsInput.value = '';
    if (dom.worldBookTagsDisplay) dom.worldBookTagsDisplay.innerHTML = '';
    dom.worldBookFormTitle.textContent = '添加新条目';
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

export function renderWorldBookTagsPanel() {
    if (!dom.worldBookTagList) return;
    
    const previousSelectedTags = new Set(Array.from(
        dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked')
    ).map(checkbox => checkbox.closest('.tag-item')?.dataset.tag).filter(Boolean));
    
    dom.worldBookTagList.innerHTML = '';
    
    const tagStats = new Map();
    Object.values(state.worldBook).forEach(entry => {
        if (Array.isArray(entry.tags)) {
            entry.tags.forEach(tag => {
                tagStats.set(tag, (tagStats.get(tag) || 0) + 1);
            });
        }
    });
    
    const allIsChecked = previousSelectedTags.has('全部');
    
    // 初始化时不默认勾选任何标签（包括"全部"）
    const allChecked = allIsChecked ? 'checked' : '';
    const allItemHTML = `
        <div class="tag-item active" data-tag="全部">
            <input type="checkbox" ${allChecked} class="tag-checkbox">
            <span class="tag-name">全部</span>
            <span class="tag-count">(${Object.keys(state.worldBook).length})</span>
        </div>
    `;
    dom.worldBookTagList.innerHTML = allItemHTML;
    
    Array.from(tagStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([tag, count]) => {
            const isChecked = previousSelectedTags.has(tag) ? 'checked' : '';
            const itemHTML = `
                <div class="tag-item" data-tag="${tag}">
                    <input type="checkbox" ${isChecked} class="tag-checkbox">
                    <span class="tag-name">${escapeHtml(tag)}</span>
                    <span class="tag-count">(${count})</span>
                </div>
            `;
            dom.worldBookTagList.insertAdjacentHTML('beforeend', itemHTML);
        });
}

export function filterWorldBookByTags() {
    const selectedTags = Array.from(
        dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked')
    ).map(checkbox => checkbox.closest('.tag-item').dataset.tag);
    
    const activeTab = state.worldBookFilter.activeTab;
    
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
    
    // 乌鸦：没有选中任何标签时，默认显示全部条目（而非空列表）
    // 修复：开关触发 renderWorldBookTagsPanel 重建 DOM 后勾选状态丢失导致列表清空的 bug
    if (selectedTags.length === 0) {
        renderWorldBookList();
        return;
    }
    
    // 选中"全部"时，显示所有条目
    if (selectedTags.includes('全部')) {
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
