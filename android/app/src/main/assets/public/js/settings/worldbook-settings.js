/**
 * @file worldbook-settings.js
 * @description Handles World Book (Memo) settings events.
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { saveToLocalStorage, saveAppSettings, escapeHtml } from '../utils.js';
import { 
    renderWorldBookList, resetWorldBookForm, updateCharCounter,
    openWorldBookModal, renderWorldBookTagsPanel, filterWorldBookByTags
} from '../modals.js';
import { updateAllDynamicUI, updateWorldBookButton } from '../ui-updater.js';
import { DraggableList } from '../draggable-list.js';

let lastWorldBookCopyTime = 0;
let worldBookDragInstance = null;

// 初始化或重新初始化拖拽实例
function initWorldBookDragInstance(enabled = true) {
    if (worldBookDragInstance) {
        worldBookDragInstance.destroy();
        worldBookDragInstance = null;
    }
    
    if (!enabled || !dom.worldBookList) return;
    
    worldBookDragInstance = new DraggableList(dom.worldBookList, {
        itemSelector: '.worldbook-item',
        onDrop: (fromIndex, toIndex) => {
            const entries = Object.values(state.worldBook).sort((a, b) => a.depth - b.depth);
            
            if (fromIndex < entries.length && toIndex < entries.length) {
                const [movedEntry] = entries.splice(fromIndex, 1);
                entries.splice(toIndex, 0, movedEntry);
                
                entries.forEach((entry, index) => {
                    entry.depth = (index + 1) * 10;
                });
                
                saveToLocalStorage();
                renderWorldBookList(); 
                renderWorldBookTagsPanel(); 
                updateWorldBookButton(); 
            }
        }
    });
}

export function setupWorldBookEvents() {
    if (dom.manageWorldBookBtn) dom.manageWorldBookBtn.addEventListener('click', openWorldBookModal);
    if (dom.worldBookMergeToggle) dom.worldBookMergeToggle.addEventListener('change', () => {
        state.appSettings.mergeWorldBook = dom.worldBookMergeToggle.checked;
        saveAppSettings();
    });
    if (dom.worldBookSaveBtn) dom.worldBookSaveBtn.addEventListener('click', saveWorldBookEntry);
    if (dom.worldBookCancelBtn) dom.worldBookCancelBtn.addEventListener('click', resetWorldBookForm);
    
    if (dom.worldBookTagsInput) {
        dom.worldBookTagsInput.addEventListener('input', updateWorldBookTags);
    }
    
    if (dom.worldBookList) {
        dom.worldBookList.addEventListener('click', handleWorldBookListActions);
        
        // 初始化拖拽实例（默认启用）
        initWorldBookDragInstance();
    }
    if (dom.worldBookContentInput) dom.worldBookContentInput.addEventListener('input', updateCharCounter);
    
    if (dom.worldBookTagSearchInput) {
        dom.worldBookTagSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const tagItems = dom.worldBookTagList.querySelectorAll('.tag-item');
            tagItems.forEach(item => {
                const tagName = item.dataset.tag.toLowerCase();
                item.style.display = tagName.includes(searchTerm) ? 'flex' : 'none';
            });
        });
    }
    
    if (dom.worldBookTagList) {
        const oldCheckboxListener = dom.worldBookTagList._checkboxListener;
        if (oldCheckboxListener) {
            dom.worldBookTagList.removeEventListener('change', oldCheckboxListener);
        }
        
        const oldClickListener = dom.worldBookTagList._clickListener;
        if (oldClickListener) {
            dom.worldBookTagList.removeEventListener('click', oldClickListener);
        }
        
        const newClickListener = (e) => {
            // 已选中页面禁用标签点击
            if (state.worldBookFilter.activeTab === 'selected') {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
            const tagItem = e.target.closest('.tag-item');
            if (tagItem && !e.target.classList.contains('tag-checkbox')) {
                const checkbox = tagItem.querySelector('.tag-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        };
        dom.worldBookTagList.addEventListener('click', newClickListener);
        dom.worldBookTagList._clickListener = newClickListener;
        
        const newCheckboxListener = (e) => {
            if (e.target.classList.contains('tag-checkbox')) {
                // 已选中页面禁用标签选择
                if (state.worldBookFilter.activeTab === 'selected') {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                
                const isSingleMode = state.worldBookFilter.mode === 'single';
                const tagItem = e.target.closest('.tag-item');
                const clickedTag = tagItem?.dataset.tag;
                
                // 单选模式：取消其他选中项
                if (isSingleMode && e.target.checked) {
                    const allCheckboxes = dom.worldBookTagList.querySelectorAll('.tag-checkbox');
                    allCheckboxes.forEach(checkbox => {
                        if (checkbox !== e.target) {
                            checkbox.checked = false;
                        }
                    });
                }
                
                filterWorldBookByTags();
            }
        };
        dom.worldBookTagList.addEventListener('change', newCheckboxListener);
        dom.worldBookTagList._checkboxListener = newCheckboxListener;
    }
    
    const tagLogicContainer = dom.worldBookTagsPanel || document;
    const oldLogicListener = tagLogicContainer._logicListener;
    if (oldLogicListener) {
        tagLogicContainer.removeEventListener('change', oldLogicListener);
    }
    
    const newLogicListener = (e) => {
        if (e.target.name === 'tag-logic') {
            const newMode = e.target.value;
            const oldMode = state.worldBookFilter.mode;
            state.worldBookFilter.mode = newMode;
            
            // 从多选切换到单选时，只保留第一个选中的标签
            if (oldMode === 'multi' && newMode === 'single') {
                const checkedBoxes = dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked');
                if (checkedBoxes.length > 1) {
                    checkedBoxes.forEach((checkbox, index) => {
                        if (index > 0) {
                            checkbox.checked = false;
                        }
                    });
                }
            }
            
            filterWorldBookByTags();
        }
    };
    tagLogicContainer.addEventListener('change', newLogicListener);
    tagLogicContainer._logicListener = newLogicListener;
    
    // 标签页切换事件
    if (dom.worldBookListTabs) {
        const oldTabListener = dom.worldBookListTabs._tabListener;
        if (oldTabListener) {
            dom.worldBookListTabs.removeEventListener('click', oldTabListener);
        }
        
        const newTabListener = (e) => {
            const tabBtn = e.target.closest('.tab-btn');
            if (!tabBtn) return;
            
            const tab = tabBtn.dataset.tab;
            if (tab && tab !== state.worldBookFilter.activeTab) {
                state.worldBookFilter.activeTab = tab;
                
                // 更新按钮样式
                dom.worldBookListTabs.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tab);
                });
                
                // 根据标签页启用/禁用拖拽
                initWorldBookDragInstance(tab === 'all');
                
                // 根据标签页启用/禁用标签列表
                if (dom.worldBookTagList) {
                    dom.worldBookTagList.classList.toggle('disabled', tab === 'selected');
                }
                
                // 重新渲染列表
                filterWorldBookByTags();
            }
        };
        dom.worldBookListTabs.addEventListener('click', newTabListener);
        dom.worldBookListTabs._tabListener = newTabListener;
    }

    if (dom.worldBookClearFilterBtn) {
        dom.worldBookClearFilterBtn.addEventListener('click', clearWorldBookFilter);
    }
}

function clearWorldBookFilter() {
    if (!dom.worldBookTagList) return;
    
    const allCheckboxes = dom.worldBookTagList.querySelectorAll('.tag-checkbox');
    allCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    filterWorldBookByTags();
}

function updateWorldBookTags() {
    if (!dom.worldBookTagsInput) return;
    
    const tagsInput = dom.worldBookTagsInput.value;
    const tags = tagsInput
        .split(/[,，\n]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    
    if (!dom.worldBookTagsDisplay) return;
    
    dom.worldBookTagsDisplay.innerHTML = tags.map(tag => 
        `<span class="tag-item-delete">${escapeHtml(tag)}<span class="tag-delete-icon">×</span></span>`
    ).join('');
    
    dom.worldBookTagsDisplay.querySelectorAll('.tag-item-delete').forEach(el => {
        el.addEventListener('click', (e) => {
            const tagToRemove = el.textContent.replace('×', '').trim();
            const newTags = tags.filter(t => t !== tagToRemove);
            dom.worldBookTagsInput.value = newTags.join(', ');
            updateWorldBookTags();
        });
    });
}

function saveWorldBookEntry() {
    const id = dom.worldBookIdInput.value;
    const name = dom.worldBookNameInput.value.trim();
    const content = dom.worldBookContentInput.value.trim();
    const depth = parseInt(dom.worldBookDepthInput.value, 10);
    const role = dom.worldBookRoleSelector.value;
    const enabled = dom.worldBookEnabledToggle.checked;

    if (!name || !content) return alert('名称和内容不能为空！');
    if (isNaN(depth) || depth < 1 || depth > 100) return alert('挂载深度必须是1到100之间的数字！');

    const tagsInput = dom.worldBookTagsInput?.value || '';
    const tags = tagsInput
        .split(/[,，\n]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    const entryId = id || `wb_${Date.now()}`;
    let sessionIds = [];
    let createdAt = Date.now();
    
    if (state.worldBook[entryId] && Array.isArray(state.worldBook[entryId].sessionIds)) {
        sessionIds = state.worldBook[entryId].sessionIds;
        if (state.worldBook[entryId].createdAt) {
            createdAt = state.worldBook[entryId].createdAt;
        }
    }
    
    state.worldBook[entryId] = { 
        id: entryId, 
        name, 
        content, 
        depth, 
        role, 
        enabled, 
        sessionIds,
        tags,
        createdAt
    };
    
    saveToLocalStorage();
    renderWorldBookTagsPanel();
    filterWorldBookByTags();
    resetWorldBookForm();
    updateWorldBookButton();
}

function handleWorldBookListActions(e) {
    const target = e.target;
    const button = target.closest('button');
    const globalSwitch = target.closest('.worldbook-item-toggle');
    const sessionSwitch = target.closest('.worldbook-session-toggle');

    if (globalSwitch) {
        e.stopPropagation();
        const id = globalSwitch.dataset.id;
        const entry = state.worldBook[id];
        if (entry) {
            entry.enabled = globalSwitch.checked;
            saveToLocalStorage();
            renderWorldBookTagsPanel();
            filterWorldBookByTags();
            updateAllDynamicUI();
        }
        return;
    }
    
    if (sessionSwitch) {
        e.stopPropagation();
        const id = sessionSwitch.dataset.id;
        const entry = state.worldBook[id];
        if (!entry) return;
        if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
        const convId = state.currentConversationId;
        if (!convId) return;
        if (sessionSwitch.checked) {
            if (!entry.sessionIds.includes(convId)) entry.sessionIds.push(convId);
        } else {
            entry.sessionIds = entry.sessionIds.filter(cid => cid !== convId);
        }
        if (!entry.enabled && entry.sessionIds.length === 0) {
            sessionSwitch.checked = false;
        }
        saveToLocalStorage();
        renderWorldBookTagsPanel();
        filterWorldBookByTags();
        updateWorldBookButton();
        return;
    }

    if (button) {
        const id = button.dataset.id;
        if (button.classList.contains('worldbook-edit-btn')) {
            const entry = state.worldBook[id];
            dom.worldBookIdInput.value = entry.id;
            dom.worldBookNameInput.value = entry.name;
            dom.worldBookContentInput.value = entry.content;
            dom.worldBookDepthInput.value = entry.depth;
            dom.worldBookRoleSelector.value = entry.role;
            dom.worldBookEnabledToggle.checked = entry.enabled;
            dom.worldBookTagsInput.value = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
            updateWorldBookTags();
            dom.worldBookFormTitle.textContent = '编辑条目';
            
            if (dom.worldBookCancelBtn) {
                dom.worldBookCancelBtn.style.display = 'inline-block';
            }
            updateCharCounter();
        } else if (button.classList.contains('worldbook-delete-btn')) {
            if (confirm(`确定要删除备忘录条目 "${state.worldBook[id].name}" 吗？`)) {
                delete state.worldBook[id];
                saveToLocalStorage();
                renderWorldBookTagsPanel();
                filterWorldBookByTags();
                updateWorldBookButton();
            }
        } else if (button.classList.contains('worldbook-copy-btn')) {
            if (Date.now() - lastWorldBookCopyTime < 1000) return alert('请勿频繁点击复制！');
            lastWorldBookCopyTime = Date.now();
            const entryToCopy = state.worldBook[id];
            if (confirm(`确定要复制备忘录条目 "${entryToCopy.name}" 吗？`)) {
                const newEntry = JSON.parse(JSON.stringify(entryToCopy));
                newEntry.id = `wb_${Date.now()}`;
                newEntry.name = `${entryToCopy.name}_copy`;
                state.worldBook[newEntry.id] = newEntry;
                saveToLocalStorage();
                renderWorldBookTagsPanel();
                filterWorldBookByTags();
                updateWorldBookButton();
            }
        }
    }
}
