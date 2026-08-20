/**
 * @file events.js
 * @description Main event listener setup - coordinates all event handling modules.
 */

import { dom } from './dom.js';
import { createNewConversation } from './main.js';
import { setupUIEvents } from './ui-events.js';
import { setupModalEvents } from './modal-events.js';
import { setupChatEvents } from './chat-events.js';
import { setupFileEvents } from './file-events.js';
import { setupSettingsEvents } from './settings-events.js';

/**
 * Sets up all event listeners for the application by coordinating different event modules.
 */
export function setupEventListeners() {
    // 挂载隐藏按钮高亮函数到全局
    import('./ui-updater.js').then(mod => { window.updateHideSummaryBtnColor = mod.updateHideSummaryBtnColor; });
    
    // Setup new chat button
    if (dom.newChatBtn) {
        dom.newChatBtn.addEventListener('click', async () => {
            await createNewConversation();
            if (window.innerWidth <= 768) {
                const { closeSidebarMobile } = await import('./ui-events.js');
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