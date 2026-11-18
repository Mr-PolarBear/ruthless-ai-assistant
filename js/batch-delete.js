import { dom } from './dom.js?v=temp';
import { state } from './state.js?v=temp';
import { deleteConversation } from './db.js?v=temp';
import { saveToLocalStorage } from './utils.js?v=temp';
import { renderHistory } from './sidebar.js?v=temp';
import { notify } from './ui-updater.js?v=temp';
import { draftManager } from './services/draft-manager.js?v=temp';

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
    const convIds = Object.keys(state.conversations || {}).filter(id => !state.conversations[id]?.isDeleted);
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
    
    if (!confirm(`确定要将选中的 ${count} 个会话移入回收站吗？\n（回收站将安全保留 10 天，随时可恢复）`)) return;
    
    const { trashManager } = await import('./services/trash-manager.js?v=temp');
    await trashManager.batchMoveToTrash(state.selectedConvIds);
    exitBatchMode();
    notify.success(`已将 ${count} 个会话移入回收站`);
}
