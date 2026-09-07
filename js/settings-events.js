/**
 * @file settings-events.js
 * @description Facade for all settings-related event handlers. 
 * Refactored to delegate responsibilities to specialized modules in ./settings/
 */

import { setupAPIEvents } from './settings/api-settings.js?v=260907';
import { setupPersonaEvents } from './settings/persona-settings.js?v=260907';
import { setupRegexEvents } from './settings/regex-settings.js?v=260907';
import { setupWorldBookEvents } from './settings/worldbook-settings.js?v=260907';
import { setupQuickPromptEvents } from './settings/quick-prompt-settings.js?v=260907';
import { setupMCPEvents } from './settings/mcp-settings.js?v=260907';
import { setupBubbleSettingsEvents } from './settings/bubble-settings.js?v=260907';

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