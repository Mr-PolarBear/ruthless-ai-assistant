/**
 * @file persona-batch-delete.js
 * @description 角色批量删除控制器。实现角色管理弹窗内的批量选择、全选、反选与安全批量删除。
 */

import { dom } from './dom.js?v=260824';
import { state } from './state.js?v=260824';
import { saveToLocalStorage } from './utils.js?v=260824';
import { renderPersonaModal } from './ui-populator.js?v=260824';
import { populatePersonaSelector } from './renderer.js?v=260824';
import { notify } from './ui-updater.js?v=260824';

let isBatchMode = false;
const selectedPersonaIds = new Set();

/**
 * 获取当前是否处于角色批量管理模式
 * @returns {boolean}
 */
export function isPersonaBatchMode() {
    return isBatchMode;
}

/**
 * 获取当前选中的角色ID集合
 * @returns {Set<string>}
 */
export function getSelectedPersonaIds() {
    return selectedPersonaIds;
}

/**
 * 初始化角色批量删除事件绑定
 */
export function initPersonaBatchDelete() {
    const batchDeleteBtn = document.getElementById('persona-batch-delete-btn');
    const batchCancelBtn = document.getElementById('persona-batch-cancel-btn');
    const batchDeleteConfirm = document.getElementById('persona-batch-delete-confirm');
    const selectAllBtn = document.getElementById('persona-batch-select-all-btn');
    const deselectAllBtn = document.getElementById('persona-batch-deselect-all-btn');

    if (batchDeleteBtn && !batchDeleteBtn._bound) {
        batchDeleteBtn._bound = true;
        batchDeleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isBatchMode) {
                exitPersonaBatchMode();
            } else {
                enterPersonaBatchMode();
            }
        });
    }

    if (batchCancelBtn && !batchCancelBtn._bound) {
        batchCancelBtn._bound = true;
        batchCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            exitPersonaBatchMode();
        });
    }

    if (batchDeleteConfirm && !batchDeleteConfirm._bound) {
        batchDeleteConfirm._bound = true;
        batchDeleteConfirm.addEventListener('click', (e) => {
            e.preventDefault();
            handlePersonaBatchDelete();
        });
    }

    if (selectAllBtn && !selectAllBtn._bound) {
        selectAllBtn._bound = true;
        selectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            selectAllPersonas();
        });
    }

    if (deselectAllBtn && !deselectAllBtn._bound) {
        deselectAllBtn._bound = true;
        deselectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            deselectAllPersonas();
        });
    }
}

/**
 * 进入角色批量删除模式
 */
export function enterPersonaBatchMode() {
    isBatchMode = true;
    selectedPersonaIds.clear();

    const batchBar = document.getElementById('persona-batch-actions-bar');
    const batchBtn = document.getElementById('persona-batch-delete-btn');
    const addBtn = document.getElementById('add-new-persona-btn');

    if (batchBar) batchBar.style.display = 'flex';
    if (batchBtn) {
        batchBtn.classList.add('active');
        batchBtn.textContent = '退出批量';
    }
    if (addBtn) addBtn.style.display = 'none';

    updatePersonaBatchSelectedCount();
    renderPersonaModal();
}

/**
 * 退出角色批量删除模式
 */
export function exitPersonaBatchMode() {
    isBatchMode = false;
    selectedPersonaIds.clear();

    const batchBar = document.getElementById('persona-batch-actions-bar');
    const batchBtn = document.getElementById('persona-batch-delete-btn');
    const addBtn = document.getElementById('add-new-persona-btn');

    if (batchBar) batchBar.style.display = 'none';
    if (batchBtn) {
        batchBtn.classList.remove('active');
        batchBtn.textContent = '批量删除';
    }
    if (addBtn) addBtn.style.display = '';

    updatePersonaBatchSelectedCount();
    renderPersonaModal();
}

/**
 * 全选所有角色
 */
export function selectAllPersonas() {
    const personaIds = Object.keys(state.personas || {});
    personaIds.forEach(id => selectedPersonaIds.add(id));
    updatePersonaBatchSelectedCount();
    updateAllPersonaCheckboxes();
}

/**
 * 取消全选
 */
export function deselectAllPersonas() {
    selectedPersonaIds.clear();
    updatePersonaBatchSelectedCount();
    updateAllPersonaCheckboxes();
}

/**
 * 切换单个角色的选中状态
 * @param {string} personaId
 */
export function togglePersonaSelection(personaId) {
    if (!personaId) return;
    if (selectedPersonaIds.has(personaId)) {
        selectedPersonaIds.delete(personaId);
    } else {
        selectedPersonaIds.add(personaId);
    }
    updatePersonaBatchSelectedCount();
    updateSinglePersonaCheckbox(personaId);
}

/**
 * 更新已选数量显示和删除按钮禁用状态
 */
function updatePersonaBatchSelectedCount() {
    const countSpan = document.getElementById('persona-batch-selected-count');
    const confirmBtn = document.getElementById('persona-batch-delete-confirm');

    if (countSpan) {
        countSpan.textContent = `已选 ${selectedPersonaIds.size} 项`;
    }
    if (confirmBtn) {
        confirmBtn.disabled = selectedPersonaIds.size === 0;
    }
}

/**
 * 更新所有列表项的勾选框和高亮状态
 */
function updateAllPersonaCheckboxes() {
    if (!dom.personaList) return;
    dom.personaList.querySelectorAll('.persona-item').forEach(item => {
        const id = item.dataset.id;
        const isSelected = selectedPersonaIds.has(id);
        item.classList.toggle('selected', isSelected);
        const checkbox = item.querySelector('.persona-batch-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
}

/**
 * 更新单个列表项的勾选框和高亮状态
 * @param {string} personaId
 */
function updateSinglePersonaCheckbox(personaId) {
    if (!dom.personaList) return;
    const isSelected = selectedPersonaIds.has(personaId);
    dom.personaList.querySelectorAll(`.persona-item[data-id="${personaId}"]`).forEach(item => {
        item.classList.toggle('selected', isSelected);
        const checkbox = item.querySelector('.persona-batch-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
}

/**
 * 执行批量删除操作
 */
export async function handlePersonaBatchDelete() {
    const count = selectedPersonaIds.size;
    if (count === 0) return;

    if (!confirm(`确定要删除选中的 ${count} 个角色吗？此操作不可撤销。`)) {
        return;
    }

    // 执行删除
    const deletedIds = Array.from(selectedPersonaIds);
    deletedIds.forEach(id => {
        delete state.personas[id];
    });

    // 检查并清理各会话对已删除角色的绑定引用，避免脏引用
    if (state.conversations) {
        for (const conv of Object.values(state.conversations)) {
            if (conv && deletedIds.includes(conv.personaId)) {
                conv.personaId = null;
            }
        }
    }

    // 持久化与UI同步
    saveToLocalStorage();
    populatePersonaSelector();
    exitPersonaBatchMode();
    notify.success(`已成功批量删除 ${count} 个角色`);
}
