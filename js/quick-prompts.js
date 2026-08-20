/**
 * @file quick-prompts.js
 * @description 快捷提示系统门面出口（整合 Storage、Executor 与 UI 子模块）
 */

import { state } from './state.js';
import { 
    DEFAULT_PROMPTS, 
    QUICK_PROMPTS_STORAGE_KEY, 
    loadQuickPromptsFromStorage, 
    saveQuickPromptsToStorage 
} from './quick-prompts/quick-prompt-storage.js';
import { 
    renderQuickPromptsList, 
    populateQuickPromptForm, 
    resetQuickPromptForm, 
    renderQuickPromptMenu, 
    openQuickPromptManagement 
} from './quick-prompts/quick-prompt-ui.js';
import { executeQuickPrompt, calculateCursorOffset } from './quick-prompts/quick-prompt-executor.js';

// 导出子模块内容保持向后兼容
export { 
    DEFAULT_PROMPTS, 
    QUICK_PROMPTS_STORAGE_KEY,
    loadQuickPromptsFromStorage,
    saveQuickPromptsToStorage,
    renderQuickPromptsList,
    populateQuickPromptForm,
    resetQuickPromptForm,
    renderQuickPromptMenu,
    openQuickPromptManagement,
    executeQuickPrompt,
    calculateCursorOffset
};

/**
 * 初始化快捷提示模块
 */
export function initializeQuickPrompts() {
    const storedPrompts = loadQuickPromptsFromStorage();
    
    if (storedPrompts && storedPrompts.length > 0) {
        state.quickPrompts = storedPrompts;
    } else {
        state.quickPrompts = DEFAULT_PROMPTS;
        saveQuickPrompts();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => renderQuickPromptsList());
    } else {
        renderQuickPromptsList();
    }
}

/**
 * 保存快捷提示到本地存储
 */
export function saveQuickPrompts() {
    saveQuickPromptsToStorage(state.quickPrompts);
}
