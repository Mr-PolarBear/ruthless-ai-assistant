/**
 * @file modals.js
 * @description Facade for modal management. Re-exports all modal functions.
 */

// Base
export { 
    DEFAULT_AVATAR,
    currentConversationIdForAvatar,
    avatarCropper,
    convAvatarCropper,
    _editingMsgObj,
    _editingMsgIndex,
    setAvatarCropper,
    setConvAvatarCropper
} from './modals/base.js?v=260820-1';

// Settings
export { openSettingsModal, closeSettingsModal } from './modals/settings-modal.js?v=260820-1';

// API
export { 
    openApiEditModal, closeApiEditModal, 
    resetApiEditForm, resetApiForm, 
    toggleApiEditFormFields, toggleApiFormFields, 
    renderApiEditPresetButtons
} from './modals/api-modal.js?v=260820-1';

// Persona
export { 
    openPersonaEditModal, closePersonaEditModal, 
    resetPersonaEditForm, resetPersonaForm, 
    openPersonaModal
} from './modals/persona-modal.js?v=260820-1';

// Regex
export { 
    resetRegexForm, populateRegexForm, 
    updateRegexFloorSummary 
} from './modals/regex-modal.js?v=260820-1';

// UI Populators (Re-export from central populator)
export { 
    renderApiEndpointsList, populateApiSelector,
    renderPersonaModal, populatePersonaSelector,
    renderRegexRulesList 
} from './ui-populator.js?v=260820-1';

// World Book
export { 
    openWorldBookModal, resetWorldBookForm, 
    renderWorldBookList, updateCharCounter,
    renderWorldBookTagsPanel, filterWorldBookByTags, renderFilteredWorldBookList,
    updateFormSessionToggleState, setWorldBookMobileView, toggleWorldBookContentExpand
} from './modals/worldbook-modal.js?v=260820-1';

// Avatar
export { 
    setupUserAvatarUI, 
    closeCropModal, closeConvAvatarCropModal,
    openConversationAvatarModal, closeConversationAvatarModal, setupConversationAvatarUI,
    openAvatarPreview, closeAvatarPreview 
} from './modals/avatar-modal.js?v=260820-1';

// Quick Hide
export { openQuickHideModal, closeQuickHideModal } from './modals/quick-hide-modal.js?v=260820-1';

// Message Editor
export { openMessageEditModal, closeMessageEditModal } from './modals/message-editor-modal.js?v=260820-1';

// Conversation Title Modal
export { openConvTitleModal, closeConvTitleModal, setupConvTitleModalEvents } from './modals/conv-title-modal.js?v=260820-1';

// Export Conversation Modal
export { 
    openExportConvModal, 
    closeExportConvModal, 
    setupExportConvModalEvents, 
    updateExportModalFormState, 
    executeExportConversation 
} from './modals/export-modal.js?v=260820-1';

// Auto Summary Conflict Modal
export {
    openAutoSummaryConflictModal,
    closeAutoSummaryConflictModal
} from './modals/auto-summary-conflict-modal.js?v=260820-1';

// Summary History & Rollback Modal
export {
    openSummaryHistoryModal,
    closeSummaryHistoryModal,
    openSummaryRollbackConfirmModal,
    closeSummaryRollbackConfirmModal,
    initSummaryHistoryModal,
    updateHideSummaryHistoryCount
} from './modals/summary-history-modal.js?v=260820-1';

// Simulate Send & Prompt Preview Modal
export {
    openSimulateSendModal,
    closeSimulateSendModal,
    initSimulateSendModal,
    renderSimulateSendModal,
    buildSimulatedPayload
} from './modals/simulate-send-modal.js?v=260820-1';


