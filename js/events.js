/**
 * @file events.js
 * @description Main event listener setup - coordinates all event handling modules.
 */

import { dom } from './dom.js?v=temp';
import { createNewConversation } from './main.js?v=temp';
import { setupUIEvents } from './ui-events.js?v=temp';
import { setupModalEvents } from './modal-events.js?v=temp';
import { setupChatEvents } from './chat-events.js?v=temp';
import { setupFileEvents } from './file-events.js?v=temp';
import { setupSettingsEvents } from './settings-events.js?v=temp';

/**
 * Sets up all event listeners for the application by coordinating different event modules.
 */
export function setupEventListeners() {
    // 挂载隐藏按钮高亮与总 Token 徽章刷新函数到全局
    import('./ui-updater.js?v=temp').then(mod => {
        window.updateHideSummaryBtnColor = mod.updateHideSummaryBtnColor;
        window.updateSessionTokenBadge = mod.updateSessionTokenBadge;
    });
    
    // Setup new chat button
    if (dom.newChatBtn) {
        dom.newChatBtn.addEventListener('click', async () => {
            await createNewConversation();
            if (window.innerWidth <= 768) {
                const { closeSidebarMobile } = await import('./ui-events.js?v=temp');
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