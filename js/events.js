/**
 * @file events.js
 * @description Main event listener setup - coordinates all event handling modules.
 */

import { dom } from './dom.js?v=260907';
import { createNewConversation } from './main.js?v=260907';
import { setupUIEvents } from './ui-events.js?v=260907';
import { setupModalEvents } from './modal-events.js?v=260907';
import { setupChatEvents } from './chat-events.js?v=260907';
import { setupFileEvents } from './file-events.js?v=260907';
import { setupSettingsEvents } from './settings-events.js?v=260907';

/**
 * Sets up all event listeners for the application by coordinating different event modules.
 */
export function setupEventListeners() {
    // 挂载隐藏按钮高亮与总 Token 徽章刷新函数到全局
    import('./ui-updater.js?v=260907').then(mod => {
        window.updateHideSummaryBtnColor = mod.updateHideSummaryBtnColor;
        window.updateSessionTokenBadge = mod.updateSessionTokenBadge;
    });
    
    // Setup new chat button
    if (dom.newChatBtn) {
        dom.newChatBtn.addEventListener('click', async () => {
            await createNewConversation();
            if (window.innerWidth <= 768) {
                const { closeSidebarMobile } = await import('./ui-events.js?v=260907');
                closeSidebarMobile();
            }
        });
    }
    
    // Setup all event modules
    setupUIEvents();        // UI interactions (sidebar, scroll, theme, etc.)
    setupModalEvents();     // Modal windows and dialogs
    setupChatEvents();      // Chat messages and history
    setupFileEvents();      // File uploads, attachments, avatars
    setupSettingsEvents();  // API, personas, regex, world book, quick prompts
}