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
} from './modals/base.js';

// Settings
export { openSettingsModal, closeSettingsModal } from './modals/settings-modal.js';

// API
export { 
    openApiEditModal, closeApiEditModal, 
    resetApiEditForm, resetApiForm, 
    toggleApiEditFormFields, toggleApiFormFields, 
    renderApiEditPresetButtons
} from './modals/api-modal.js';

// Persona
export { 
    openPersonaEditModal, closePersonaEditModal, 
    resetPersonaEditForm, resetPersonaForm, 
    openPersonaModal
} from './modals/persona-modal.js';

// Regex
export { 
    resetRegexForm, populateRegexForm, 
    updateRegexFloorSummary 
} from './modals/regex-modal.js';

// UI Populators (Re-export from central populator)
export { 
    renderApiEndpointsList, populateApiSelector,
    renderPersonaModal, populatePersonaSelector,
    renderRegexRulesList 
} from './ui-populator.js';

// World Book
export { 
    openWorldBookModal, resetWorldBookForm, 
    renderWorldBookList, updateCharCounter,
    renderWorldBookTagsPanel, filterWorldBookByTags, renderFilteredWorldBookList 
} from './modals/worldbook-modal.js';

// Avatar
export { 
    setupUserAvatarUI, 
    closeCropModal, closeConvAvatarCropModal,
    openConversationAvatarModal, closeConversationAvatarModal, setupConversationAvatarUI,
    openAvatarPreview, closeAvatarPreview 
} from './modals/avatar-modal.js';

// Quick Hide
export { openQuickHideModal, closeQuickHideModal } from './modals/quick-hide-modal.js';

// Message Editor
export { openMessageEditModal, closeMessageEditModal } from './modals/message-editor-modal.js';

// Conversation Title Modal
export { openConvTitleModal, closeConvTitleModal, setupConvTitleModalEvents } from './modals/conv-title-modal.js';

// Export Conversation Modal
export { 
    openExportConvModal, 
    closeExportConvModal, 
    setupExportConvModalEvents, 
    updateExportModalFormState, 
    executeExportConversation 
} from './modals/export-modal.js';


