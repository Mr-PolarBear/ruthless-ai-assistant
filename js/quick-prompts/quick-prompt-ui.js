/**
 * @file quick-prompt-ui.js
 * @description 专职负责快捷提示列表、表单联动与聊天区菜单的渲染与交互
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

/**
 * 渲染设置弹窗中的快捷提示列表
 * @param {string} searchTerm - 搜索关键词
 */
export function renderQuickPromptsList(searchTerm = '') {
    if (!dom.quickPromptList) return;
    dom.quickPromptList.innerHTML = '';

    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    const filteredPrompts = (state.quickPrompts || []).filter(prompt =>
        (prompt.title || '').toLowerCase().includes(lowerCaseSearchTerm) ||
        (prompt.text || '').toLowerCase().includes(lowerCaseSearchTerm)
    );

    if (filteredPrompts.length === 0) {
        dom.quickPromptList.innerHTML = '<p class="settings-hint">没有找到匹配的快捷提示。</p>';
        return;
    }

    filteredPrompts.forEach(prompt => {
        const item = document.createElement('li');
        item.className = 'quick-prompt-item';
        item.dataset.id = prompt.id;
        item.draggable = true;
        item.innerHTML = `
            <span class="drag-handle">&#x2630;</span>
            <div class="quick-prompt-item-content">
                <div class="quick-prompt-item-title">${escapeHtml(prompt.title)}</div>
                <div class="quick-prompt-item-text-preview">${escapeHtml(prompt.text || '(无文本/仅操作光标)')}</div>
            </div>
            <div class="quick-prompt-item-actions action-btn-group">
                <button class="action-btn move-top move-top-prompt-btn" data-id="${prompt.id}" title="移动到第一条">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline><line x1="6" y1="5" x2="18" y2="5"></line></svg>
                </button>
                <button class="action-btn edit edit-prompt-btn" data-id="${prompt.id}" title="编辑">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn copy copy-prompt-btn" data-id="${prompt.id}" title="复制">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="action-btn delete delete-prompt-btn" data-id="${prompt.id}" title="删除">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
        `;
        dom.quickPromptList.appendChild(item);
    });
}

/**
 * 填充编辑/添加表单
 * @param {object} prompt - 提示对象
 */
export function populateQuickPromptForm(prompt) {
    if (!dom.quickPromptFormContainer) return;
    
    dom.quickPromptIdInput.value = prompt.id || '';
    dom.quickPromptTitleInput.value = prompt.title || '';
    dom.quickPromptTextInput.value = prompt.text ?? '';
    
    if (dom.quickPromptInsertModeSelect) {
        dom.quickPromptInsertModeSelect.value = prompt.insertMode || 'cursor';
    }
    if (dom.quickPromptCursorPosSelect) {
        dom.quickPromptCursorPosSelect.value = prompt.cursorPosition || 'end';
    }
    if (dom.quickPromptCustomOffsetInput) {
        dom.quickPromptCustomOffsetInput.value = prompt.customCursorOffset || 0;
    }
    if (dom.quickPromptCustomOffsetContainer) {
        dom.quickPromptCustomOffsetContainer.style.display = (prompt.cursorPosition === 'custom') ? 'block' : 'none';
    }

    dom.quickPromptFormTitle.textContent = '编辑提示';
    dom.quickPromptFormContainer.style.display = 'block';
}

/**
 * 重置表单
 */
export function resetQuickPromptForm() {
    if (!dom.quickPromptFormContainer) return;

    dom.quickPromptIdInput.value = '';
    dom.quickPromptTitleInput.value = '';
    dom.quickPromptTextInput.value = '';

    if (dom.quickPromptInsertModeSelect) {
        dom.quickPromptInsertModeSelect.value = 'cursor';
    }
    if (dom.quickPromptCursorPosSelect) {
        dom.quickPromptCursorPosSelect.value = 'end';
    }
    if (dom.quickPromptCustomOffsetInput) {
        dom.quickPromptCustomOffsetInput.value = '0';
    }
    if (dom.quickPromptCustomOffsetContainer) {
        dom.quickPromptCustomOffsetContainer.style.display = 'none';
    }

    dom.quickPromptFormTitle.textContent = '添加提示';
    dom.quickPromptFormContainer.style.display = 'none';
}

/**
 * 渲染聊天区域的快捷提示浮动菜单
 */
export function renderQuickPromptMenu() {
    if (!dom.quickPromptMenu) return;
    dom.quickPromptMenu.innerHTML = '';
    if (!state.quickPrompts || state.quickPrompts.length === 0) {
        dom.quickPromptMenu.innerHTML = '<div class="popup-menu-item">没有可用的快捷提示</div>';
        return;
    }
    
    // 头部：标题与管理跳转按钮
    const header = document.createElement('div');
    header.className = 'quick-prompt-menu-header';
    header.innerHTML = `
        <div class="quick-prompt-menu-title-row">
            <div class="quick-prompt-menu-title"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>快捷提示</div>
            <button class="quick-prompt-manage-btn" onclick="openQuickPromptManagement()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>管理快速回复</button>
        </div>
    `;
    dom.quickPromptMenu.appendChild(header);

    // 列表容器
    const listContainer = document.createElement('div');
    listContainer.className = 'quick-prompt-list';

    state.quickPrompts.forEach(prompt => {
        const item = document.createElement('div');
        item.className = 'popup-menu-item';
        item.dataset.id = prompt.id;
        item.innerHTML = `
            <span class="popup-menu-item-title">${escapeHtml(prompt.title)}</span>
            <span class="popup-menu-item-preview">${escapeHtml(prompt.text || '(仅操作光标)')}</span>
        `;
        listContainer.appendChild(item);
    });

    dom.quickPromptMenu.appendChild(listContainer);
}

/**
 * 打开快速回复管理界面
 */
export function openQuickPromptManagement() {
    if (dom.quickPromptMenu) {
        dom.quickPromptMenu.style.display = 'none';
    }
    
    import('../modals.js').then(module => {
        module.openSettingsModal();
        setTimeout(() => {
            const quickPromptTab = document.querySelector('[data-tab="quick-prompts-settings"]');
            if (quickPromptTab) {
                quickPromptTab.click();
            }
        }, 100);
    });
}

// 暴露到全局供 onclick 调用
window.openQuickPromptManagement = openQuickPromptManagement;
