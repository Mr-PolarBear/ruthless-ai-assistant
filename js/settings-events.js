/**
 * @file settings-events.js
 * @description Facade for all settings-related event handlers. 
 * Refactored to delegate responsibilities to specialized modules in ./settings/
 */

import { setupAPIEvents } from './settings/api-settings.js';
import { setupPersonaEvents } from './settings/persona-settings.js';
import { setupRegexEvents } from './settings/regex-settings.js';
import { setupWorldBookEvents } from './settings/worldbook-settings.js';
import { setupQuickPromptEvents } from './settings/quick-prompt-settings.js';
import { setupMCPEvents } from './settings/mcp-settings.js';
import { setupBubbleSettingsEvents } from './settings/bubble-settings.js';

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