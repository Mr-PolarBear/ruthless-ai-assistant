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
} from './modals/base.js?v=temp';

// Settings
export { openSettingsModal, closeSettingsModal } from './modals/settings-modal.js?v=temp';

// API
export { 
    openApiEditModal, closeApiEditModal, 
    resetApiEditForm, resetApiForm, 
    toggleApiEditFormFields, toggleApiFormFields, 
    renderApiEditPresetButtons
} from './modals/api-modal.js?v=temp';

// Persona
export { 
    openPersonaEditModal, closePersonaEditModal, 
    resetPersonaEditForm, resetPersonaForm, 
    openPersonaModal
} from './modals/persona-modal.js?v=temp';

// Regex
export { 
    resetRegexForm, populateRegexForm, 
    updateRegexFloorSummary 
} from './modals/regex-modal.js?v=temp';

// UI Populators (Re-export from central populator)
export { 
    renderApiEndpointsList, populateApiSelector,
    renderPersonaModal, populatePersonaSelector,
    renderRegexRulesList 
} from './ui-populator.js?v=temp';

// World Book
export { 
    openWorldBookModal, resetWorldBookForm, 
    renderWorldBookList, updateCharCounter,
    renderWorldBookTagsPanel, filterWorldBookByTags, renderFilteredWorldBookList,
    updateFormSessionToggleState, setWorldBookMobileView, toggleWorldBookContentExpand
} from './modals/worldbook-modal.js?v=temp';

// Avatar
export { 
    setupUserAvatarUI, 
    closeCropModal, closeConvAvatarCropModal,
    openConversationAvatarModal, closeConversationAvatarModal, setupConversationAvatarUI,
    openAvatarPreview, closeAvatarPreview 
} from './modals/avatar-modal.js?v=temp';

// Quick Hide
export { openQuickHideModal, closeQuickHideModal } from './modals/quick-hide-modal.js?v=temp';

// Message Editor
export { openMessageEditModal, closeMessageEditModal } from './modals/message-editor-modal.js?v=temp';

// Conversation Title Modal
export { openConvTitleModal, closeConvTitleModal, setupConvTitleModalEvents } from './modals/conv-title-modal.js?v=temp';

// Export Conversation Modal
export { 
    openExportConvModal, 
    closeExportConvModal, 
    setupExportConvModalEvents, 
    updateExportModalFormState, 
    executeExportConversation 
} from './modals/export-modal.js?v=temp';

// Auto Summary Conflict Modal
export {
    openAutoSummaryConflictModal,
    closeAutoSummaryConflictModal
} from './modals/auto-summary-conflict-modal.js?v=temp';

// Summary History & Rollback Modal
export {
    openSummaryHistoryModal,
    closeSummaryHistoryModal,
    openSummaryRollbackConfirmModal,
    closeSummaryRollbackConfirmModal,
    initSummaryHistoryModal,
    updateHideSummaryHistoryCount
} from './modals/summary-history-modal.js?v=temp';

// Simulate Send & Prompt Preview Modal
export {
    openSimulateSendModal,
    closeSimulateSendModal,
    initSimulateSendModal,
    renderSimulateSendModal,
    buildSimulatedPayload
} from './modals/simulate-send-modal.js?v=temp';

// Branch Summary Rollback Confirm Modal
export {
    openBranchSummaryConfirmModal,
    closeBranchSummaryConfirmModal,
    setupBranchSummaryConfirmModal
} from './modals/branch-summary-confirm-modal.js?v=temp';



