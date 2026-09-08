/**
 * @file settings-events.js
 * @description Facade for all settings-related event handlers. 
 * Refactored to delegate responsibilities to specialized modules in ./settings/
 */

import { setupAPIEvents } from './settings/api-settings.js?v=temp';
import { setupPersonaEvents } from './settings/persona-settings.js?v=temp';
import { setupRegexEvents } from './settings/regex-settings.js?v=temp';
import { setupWorldBookEvents } from './settings/worldbook-settings.js?v=temp';
import { setupQuickPromptEvents } from './settings/quick-prompt-settings.js?v=temp';
import { setupMCPEvents } from './settings/mcp-settings.js?v=temp';
import { setupBubbleSettingsEvents } from './settings/bubble-settings.js?v=temp';

/**
 * Sets up all settings-related event listeners by calling sub-modules.
 */
export function setupSettingsEvents() {
    setupAPIEvents();
    setupPersonaEvents();
    setupRegexEvents();
    setupWorldBookEvents();
    setupQuickPromptEvents();
    setupMCPEvents();
    setupBubbleSettingsEvents();
    
    console.log('Settings events initialized via modular architecture.');
}