import { dom } from './dom.js';
import { state } from './state.js';
import { deleteConversation } from './db.js';
import { saveToLocalStorage } from './utils.js';
import { renderHistory } from './sidebar.js';
import { notify } from './ui-updater.js';

export function initBatchDelete() {
    if (dom.batchDeleteBtn) {
        dom.batchDeleteBtn.addEventListener('click', handleBatchDeleteClick);
    }
    if (dom.batchCancelBtn) {
        dom.batchCancelBtn.addEventListener('click', exitBatchMode);
    }
    if (dom.batchDeleteConfirm) {
        dom.batchDeleteConfirm.addEventListener('click', handleBatchDelete);
    }

    bindSelectButtons();
}

function bindSelectButtons() {
    const selectAllBtn = document.getElementById('batch-select-all-btn');
    if (selectAllBtn && !selectAllBtn._batchBound) {
        selectAllBtn._batchBound = true;
        selectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectAllConversations();
        });
    }

    const deselectAllBtn = document.getElementById('batch-deselect-all-btn');
    if (deselectAllBtn && !deselectAllBtn._batchBound) {
        deselectAllBtn._batchBound = true;
        deselectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deselectAllConversations();
        });
    }
}

function handleBatchDeleteClick(e) {
    e.preventDefault();
    
    if (Object.keys(state.generatingMessages).length > 0) {
        notify.error('请等待所有会话生成结束后再进行批量操作', 4000);
        return;
    }
    
    enterBatchMode();
}

function enterBatchMode() {
    state.batchSelectMode = true;
    state.selectedConvIds.clear();
    
    if (dom.batchActionsBar) dom.batchActionsBar.style.display = 'flex';
    if (dom.batchDeleteBtn) dom.batchDeleteBtn.classList.add('active');
    
    bindSelectButtons();
    updateBatchSelectedCount();
    renderHistory();
}

export function exitBatchMode() {
    state.batchSelectMode = false;
    state.selectedConvIds.clear();
    
    if (dom.batchActionsBar) dom.batchActionsBar.style.display = 'none';
    if (dom.batchDeleteBtn) dom.batchDeleteBtn.classList.remove('active');
    
    updateBatchSelectedCount();
    renderHistory();
}

export function selectAllConversations() {
    const convIds = Object.keys(state.conversations || {});
    convIds.forEach(id => state.selectedConvIds.add(id));
    updateBatchSelectedCount();
    updateAllCheckboxes();
}

export function deselectAllConversations() {
    state.selectedConvIds.clear();
    updateBatchSelectedCount();
    updateAllCheckboxes();
}

export function toggleConvSelection(convId) {
    if (state.selectedConvIds.has(convId)) {
        state.selectedConvIds.delete(convId);
    } else {
        state.selectedConvIds.add(convId);
    }
    
    updateBatchSelectedCount();
    updateItemSelectionState(convId);
}

function updateBatchSelectedCount() {
    if (dom.batchSelectedCount) {
        dom.batchSelectedCount.textContent = `已选 ${state.selectedConvIds.size} 项`;
    }
    if (dom.batchDeleteConfirm) {
        dom.batchDeleteConfirm.disabled = state.selectedConvIds.size === 0;
    }
}

function updateItemSelectionState(convId) {
    const isSelected = state.selectedConvIds.has(convId);
    document.querySelectorAll(`.history-item[data-id="${convId}"]`).forEach(item => {
        item.classList.toggle('selected', isSelected);
        const checkbox = item.querySelector('.batch-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
}

function updateAllCheckboxes() {
    document.querySelectorAll('.history-item').forEach(item => {
        const convId = item.dataset.id;
        const isSelected = state.selectedConvIds.has(convId);
        item.classList.toggle('selected', isSelected);
        const checkbox = item.querySelector('.batch-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
}

async function handleBatchDelete() {
    const count = state.selectedConvIds.size;
    if (count === 0) return;
    
    if (!confirm(`确定要删除选中的 ${count} 个会话吗？此操作不可撤销。`)) return;
    
    const deletePromises = [];
    state.selectedConvIds.forEach(convId => {
        delete state.conversations[convId];
        deletePromises.push(deleteConversation(convId).catch(err => {
            console.error(`删除会话 ${convId} 失败:`, err);
        }));
    });
    
    await Promise.all(deletePromises);
    
    saveToLocalStorage();
    
    if (state.selectedConvIds.has(state.currentConversationId)) {
        state.currentConversationId = null;
        const remainingIds = Object.keys(state.conversations);
        if (remainingIds.length > 0) {
            const { switchToConversation } = await import('./main.js');
            switchToConversation(remainingIds[0]);
        }
    }
    
    exitBatchMode();
}
