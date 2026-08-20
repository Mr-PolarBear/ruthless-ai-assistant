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
    if (dom.batchSelectAllCheckbox) {
        dom.batchSelectAllCheckbox.addEventListener('change', handleSelectAll);
    }
    if (dom.batchDeleteConfirm) {
        dom.batchDeleteConfirm.addEventListener('click', handleBatchDelete);
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
    
    dom.batchActionsBar.style.display = 'flex';
    dom.batchDeleteBtn.classList.add('active');
    dom.batchSelectAllCheckbox.checked = false;
    updateBatchSelectedCount();
    
    renderHistory();
}

export function exitBatchMode() {
    state.batchSelectMode = false;
    state.selectedConvIds.clear();
    
    dom.batchActionsBar.style.display = 'none';
    dom.batchDeleteBtn.classList.remove('active');
    dom.batchSelectAllCheckbox.checked = false;
    updateBatchSelectedCount();
    
    renderHistory();
}

function handleSelectAll(e) {
    const checked = e.target.checked;
    const convIds = Object.keys(state.conversations);
    
    if (checked) {
        convIds.forEach(id => state.selectedConvIds.add(id));
    } else {
        state.selectedConvIds.clear();
    }
    
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
    updateSelectAllCheckbox();
}

function updateBatchSelectedCount() {
    if (dom.batchSelectedCount) {
        dom.batchSelectedCount.textContent = `已选 ${state.selectedConvIds.size} 项`;
    }
    if (dom.batchDeleteConfirm) {
        dom.batchDeleteConfirm.disabled = state.selectedConvIds.size === 0;
    }
}

function updateSelectAllCheckbox() {
    if (!dom.batchSelectAllCheckbox) return;
    const totalConvs = Object.keys(state.conversations).length;
    dom.batchSelectAllCheckbox.checked = totalConvs > 0 && state.selectedConvIds.size === totalConvs;
    dom.batchSelectAllCheckbox.indeterminate = state.selectedConvIds.size > 0 && state.selectedConvIds.size < totalConvs;
}

function updateAllCheckboxes() {
    document.querySelectorAll('.batch-checkbox').forEach(checkbox => {
        const convId = checkbox.dataset.convId;
        checkbox.checked = state.selectedConvIds.has(convId);
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
