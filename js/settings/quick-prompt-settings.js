/**
 * @file quick-prompt-settings.js
 * @description Handles Quick Prompt settings events.
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { 
    saveQuickPrompts, renderQuickPromptsList, 
    populateQuickPromptForm, resetQuickPromptForm,
    executeQuickPrompt
} from '../quick-prompts.js?v=260820-1';
import { DraggableList } from '../draggable-list.js?v=260820-1';

let quickPromptDragInstance = null;

export function setupQuickPromptEvents() {
    if (dom.quickPromptSaveBtn) dom.quickPromptSaveBtn.addEventListener('click', handleSaveQuickPrompt);
    if (dom.quickPromptCancelBtn) dom.quickPromptCancelBtn.addEventListener('click', resetQuickPromptForm);
    if (dom.addNewPromptBtn) dom.addNewPromptBtn.addEventListener('click', () => {
        resetQuickPromptForm();
        if(dom.quickPromptFormContainer) {
            dom.quickPromptFormContainer.style.display = 'block';
            dom.quickPromptFormTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    // 监听光标位置下拉框变动，切换自定义偏移输入框显隐
    if (dom.quickPromptCursorPosSelect) {
        dom.quickPromptCursorPosSelect.addEventListener('change', (e) => {
            if (dom.quickPromptCustomOffsetContainer) {
                dom.quickPromptCustomOffsetContainer.style.display = (e.target.value === 'custom') ? 'block' : 'none';
            }
        });
    }

    if (dom.quickPromptList) {
        dom.quickPromptList.addEventListener('click', handleQuickPromptListClick);
        
        if (quickPromptDragInstance) {
            quickPromptDragInstance.destroy();
        }
        quickPromptDragInstance = new DraggableList(dom.quickPromptList, {
            itemSelector: '.quick-prompt-item',
            onDrop: (fromIndex, toIndex) => {
                // — 为什么这么写 —
                // 1. 直接按当前 DOM 节点中所有子项的 data-id 顺序重构 state.quickPrompts；
                // 2. 彻底杜绝多次拖拽、DOM 移动或搜索过滤导致的数组下标错位 BUG；
                // 3. 保证聊天区域的快捷提示菜单展示顺序与设置中看到的顺序 100% 绝对一致。
                const currentItems = [...dom.quickPromptList.querySelectorAll('.quick-prompt-item')];
                const currentIds = currentItems.map(el => el.dataset.id);
                const promptMap = new Map(state.quickPrompts.map(p => [p.id, p]));
                const newPrompts = currentIds.map(id => promptMap.get(id)).filter(Boolean);

                // 容错：如果处于搜索状态，未匹配的项不在当前 DOM 中，将其保持原有相对顺序追加
                state.quickPrompts.forEach(p => {
                    if (!currentIds.includes(p.id)) {
                        newPrompts.push(p);
                    }
                });

                state.quickPrompts = newPrompts;
                saveQuickPrompts();
            }
        });
    }

    // 聊天区域快捷菜单项点击
    if (dom.quickPromptMenu) {
        dom.quickPromptMenu.addEventListener('click', (e) => {
            const target = e.target.closest('.popup-menu-item');
            if (target && target.dataset.id) {
                const prompt = state.quickPrompts.find(p => p.id === target.dataset.id);
                if (prompt && dom.messageInput) {
                    // 使用独立执行引擎计算插入与光标定位
                    executeQuickPrompt(prompt, dom.messageInput);
                }
                dom.quickPromptMenu.style.display = 'none';
            }
        });
    }

    if (dom.quickPromptSearchInput) {
        dom.quickPromptSearchInput.addEventListener('input', (e) => {
            renderQuickPromptsList(e.target.value);
        });
    }
}

function handleQuickPromptListClick(e) {
    const target = e.target.closest('button');
    if (!target) return;
    const id = target.dataset.id;
    const prompt = state.quickPrompts.find(p => p.id === id);
    if (!prompt) return;

    const currentSearch = dom.quickPromptSearchInput ? dom.quickPromptSearchInput.value : '';

    if (target.classList.contains('move-top-prompt-btn')) {
        // — 为什么这么写 —
        // 1. 将指定 ID 的快捷提示从原位置抽出并放到 state.quickPrompts 头部（第0位）；
        // 2. 保存到 localStorage 并重新渲染列表，确保聊天区和设置列表同步处于最上方。
        const originalIndex = state.quickPrompts.findIndex(p => p.id === id);
        if (originalIndex > 0) {
            const [item] = state.quickPrompts.splice(originalIndex, 1);
            state.quickPrompts.unshift(item);
            saveQuickPrompts();
            renderQuickPromptsList(currentSearch);
        }
    } else if (target.classList.contains('edit-prompt-btn')) {
        populateQuickPromptForm(prompt);
        if(dom.quickPromptFormContainer) {
            dom.quickPromptFormContainer.style.display = 'block';
            dom.quickPromptFormTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else if (target.classList.contains('copy-prompt-btn')) {
        const newPrompt = {
            id: `prompt_${Date.now()}`,
            title: `${prompt.title} (复制)`,
            text: prompt.text,
            insertMode: prompt.insertMode || 'cursor',
            cursorPosition: prompt.cursorPosition || 'end',
            customCursorOffset: prompt.customCursorOffset || 0
        };
        const originalIndex = state.quickPrompts.findIndex(p => p.id === id);
        state.quickPrompts.splice(originalIndex + 1, 0, newPrompt);
        saveQuickPrompts();
        renderQuickPromptsList(currentSearch);
    } else if (target.classList.contains('delete-prompt-btn')) {
        if (confirm(`确定要删除快捷提示 "${prompt.title}"?`)) {
            state.quickPrompts = state.quickPrompts.filter(p => p.id !== id);
            saveQuickPrompts();
            renderQuickPromptsList(currentSearch);
        }
    }
}

function handleSaveQuickPrompt() {
    const id = dom.quickPromptIdInput.value;
    const title = dom.quickPromptTitleInput.value.trim();
    const text = dom.quickPromptTextInput.value; // 保留可能的换行或首尾空格
    
    if (!title) return alert('标题不能为空！');

    const insertMode = dom.quickPromptInsertModeSelect ? dom.quickPromptInsertModeSelect.value : 'cursor';
    const cursorPosition = dom.quickPromptCursorPosSelect ? dom.quickPromptCursorPosSelect.value : 'end';
    const customCursorOffset = dom.quickPromptCustomOffsetInput ? (parseInt(dom.quickPromptCustomOffsetInput.value, 10) || 0) : 0;

    if (id) {
        const prompt = state.quickPrompts.find(p => p.id === id);
        if (prompt) {
            prompt.title = title;
            prompt.text = text;
            prompt.insertMode = insertMode;
            prompt.cursorPosition = cursorPosition;
            prompt.customCursorOffset = customCursorOffset;
        }
    } else {
        // — 为什么这么写 —
        // 新增快捷提示时默认插入到数组头部（unshift），使其直接排在第一条
        state.quickPrompts.unshift({
            id: `prompt_${Date.now()}`,
            title,
            text,
            insertMode,
            cursorPosition,
            customCursorOffset
        });
    }
    saveQuickPrompts();
    const currentSearch = dom.quickPromptSearchInput ? dom.quickPromptSearchInput.value : '';
    renderQuickPromptsList(currentSearch);
    resetQuickPromptForm();
}
