/**
 * @file dom.js
 * @description Centralized DOM element selections.
 */

export const dom = {};

export function initDom() {
    // Main UI
    dom.app = document.getElementById('app');
    dom.mainChat = document.querySelector('.main-chat');
    dom.globalLoadingOverlay = document.getElementById('global-loading-overlay');
    dom.sidebar = document.querySelector('.sidebar');
    dom.sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    dom.apiSelector = document.getElementById('api-selector');
    dom.historyList = document.getElementById('history-list');
    dom.historyGroupedList = document.getElementById('history-grouped-list'); // 乌鸦：时间分组列表
    dom.chatMessages = document.getElementById('chat-messages');
    dom.messageInput = document.getElementById('message-input');
    dom.sendButton = document.getElementById('send-button');
    dom.newChatBtn = document.getElementById('new-chat-btn');
    dom.clearInputBtn = document.getElementById('clear-input-btn');
    dom.historySearchInput = document.getElementById('history-search-input');

    // Batch Delete
    dom.batchDeleteBtn = document.getElementById('batch-delete-btn');
    dom.batchActionsBar = document.getElementById('batch-actions-bar');
    dom.batchSelectAllCheckbox = document.getElementById('batch-select-all-checkbox');
    dom.batchSelectedCount = document.getElementById('batch-selected-count');
    dom.batchDeleteConfirm = document.getElementById('batch-delete-confirm');
    dom.batchCancelBtn = document.getElementById('batch-cancel-btn');

    // Scroll Buttons
    dom.scrollToTopBtn = document.getElementById('scroll-to-top-btn');
    dom.scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
    // 乌鸦：楼层快速跳转
    dom.jumpToFloorBtn = document.getElementById('jump-to-floor-btn');
    dom.floorJumpPanel = document.getElementById('floor-jump-panel');

    // Branching
    dom.branchNavigator = document.getElementById('branch-navigator');
    dom.prevBranchBtn = document.getElementById('prev-branch-btn');
    dom.nextBranchBtn = document.getElementById('next-branch-btn');
    dom.branchIndicator = document.getElementById('branch-indicator');

    // Settings Modal
    dom.settingsBtn = document.getElementById('settings-btn');
    dom.topSettingsBtn = document.getElementById('top-settings-btn');
    dom.settingsModal = document.getElementById('settings-modal');
    dom.settingsTabs = document.querySelectorAll('.tab-btn');
    dom.settingsTabContents = document.querySelectorAll('.tab-content');
    dom.autoRenderCheckbox = document.getElementById('setting-auto-render-table');
    dom.autoExpandCodeCheckbox = document.getElementById('setting-auto-expand-code'); // 乌鸦：自动展开侧边栏
    dom.highlightQuoteTextCheckbox = document.getElementById('setting-highlight-quote-text');
    dom.highlightItalicTextCheckbox = document.getElementById('setting-highlight-italic-text');
    dom.sendKeyEnter = document.getElementById('send-key-enter');
    dom.sendKeyCtrlEnter = document.getElementById('send-key-ctrl-enter');
    dom.recentMessageCountInput = document.getElementById('recent-message-count-input');  // 乌鸦：新增
    dom.loadAllMessagesBtn = document.getElementById('load-all-messages-btn');  // 乌鸦：加载全部消息按钮

    // Database Settings
    dom.databaseConnectionList = document.getElementById('database-connection-list');
    dom.dbFormTitle = document.getElementById('db-form-title');
    dom.dbIdInput = document.getElementById('db-id-input');
    dom.dbNameInput = document.getElementById('db-name-input');
    dom.dbTypeSelector = document.getElementById('db-type-selector');
    dom.dbHostInput = document.getElementById('db-host-input');
    dom.dbPortInput = document.getElementById('db-port-input');
    dom.dbDatabaseInput = document.getElementById('db-database-input');
    dom.dbUsernameInput = document.getElementById('db-username-input');
    dom.dbPasswordInput = document.getElementById('db-password-input');
    dom.dbTogglePasswordBtn = document.getElementById('db-toggle-password-btn');

    // 乌鸦：全局数据库设置DOM
    dom.globalDbTableUrlInput = document.getElementById('global-db-table-url');
    dom.resetGlobalDbUrlBtn = document.getElementById('reset-global-db-url-btn');
    dom.saveGlobalDbSettingsBtn = document.getElementById('save-global-db-settings-btn');

    // dom.dbEnabledToggle = document.getElementById('db-enabled-toggle'); // 已移除启用开关
    dom.dbSaveBtn = document.getElementById('db-save-btn');
    dom.dbCancelBtn = document.getElementById('db-cancel-btn');
    dom.dbTestBtn = document.getElementById('db-test-btn');
    dom.addNewDbBtn = document.getElementById('add-new-db-btn');

    // API Management
    dom.apiEndpointList = document.getElementById('api-endpoint-list');
    dom.apiFormTitle = document.getElementById('api-form-title');
    dom.apiIdInput = document.getElementById('api-id-input');
    dom.apiNameInput = document.getElementById('api-name-input');
    dom.apiTypeSelector = document.getElementById('api-type-selector');
    dom.apiUrlInput = document.getElementById('api-url-input');
    dom.apiModelInput = document.getElementById('api-model-input');
    dom.apiKeyInput = document.getElementById('api-key-input');
    dom.apiOpenAIFields = document.querySelectorAll('.api-openai-field');
    dom.apiSaveBtn = document.getElementById('api-save-btn');
    dom.apiCancelBtn = document.getElementById('api-cancel-btn');
    dom.apiPresetButtonsContainer = document.getElementById('api-preset-buttons');
    dom.fetchModelsBtn = document.getElementById('fetch-models-btn');
    dom.addNewApiBtn = document.getElementById('add-new-api-btn');

    // API Edit Modal
    dom.apiEditModal = document.getElementById('api-edit-modal');
    dom.apiEditFormTitle = document.getElementById('api-edit-form-title');
    dom.apiEditIdInput = document.getElementById('api-edit-id-input');
    dom.apiEditNameInput = document.getElementById('api-edit-name-input');
    dom.apiEditTypeSelector = document.getElementById('api-edit-type-selector');
    dom.apiEditUrlInput = document.getElementById('api-edit-url-input');
    dom.apiEditModelInput = document.getElementById('api-edit-model-input');
    dom.apiEditKeyInput = document.getElementById('api-edit-key-input');
    dom.apiEditOpenAIFields = document.querySelectorAll('.api-edit-openai-field');
    dom.apiEditSaveBtn = document.getElementById('api-edit-save-btn');
    dom.apiEditCancelBtn = document.getElementById('api-edit-cancel-btn');
    dom.apiEditPresetButtonsContainer = document.getElementById('api-edit-preset-buttons');
    dom.apiEditFetchModelsBtn = document.getElementById('api-edit-fetch-models-btn');

    // API Edit - Custom Parameters
    dom.apiEditOmniModelToggle = document.getElementById('api-edit-omni-model-toggle'); // 乌鸦：Omni 全模态模型标记
    dom.apiEditCustomParamsToggle = document.getElementById('api-edit-custom-params-toggle');
    dom.apiEditCustomParamsSection = document.getElementById('api-edit-custom-params-section');
    dom.apiEditParamTemp = document.getElementById('api-edit-param-temperature');
    dom.apiEditParamTempValue = document.getElementById('api-edit-temperature-value');
    dom.apiEditParamTopP = document.getElementById('api-edit-param-top-p');
    dom.apiEditParamTopPValue = document.getElementById('api-edit-top-p-value');
    dom.apiEditParamEnableTopK = document.getElementById('api-edit-param-enable-top-k');
    dom.apiEditParamTopK = document.getElementById('api-edit-param-top-k');
    dom.apiEditParamTopKValue = document.getElementById('api-edit-top-k-value');
    dom.apiEditParamEnableMinP = document.getElementById('api-edit-param-enable-min-p');
    dom.apiEditParamMinP = document.getElementById('api-edit-param-min-p');
    dom.apiEditParamMinPValue = document.getElementById('api-edit-min-p-value');
    dom.apiEditParamMaxTokens = document.getElementById('api-edit-param-max-tokens');
    dom.apiEditParamStream = document.getElementById('api-edit-stream-mode-toggle');

    // Model List Modal
    dom.modelListModal = document.getElementById('model-list-modal');
    dom.modelListContainer = document.getElementById('model-list-container');

    // Persona Elements
    dom.personaBar = document.getElementById('persona-bar');
    dom.personaSelector = document.getElementById('persona-selector');
    dom.managePersonasBtn = document.getElementById('manage-personas-btn');
    dom.personaModal = document.getElementById('persona-modal');
    dom.personaList = document.getElementById('persona-list');
    dom.personaFormTitle = document.getElementById('persona-form-title');
    dom.personaIdInput = document.getElementById('persona-id-input');
    dom.personaNameInput = document.getElementById('persona-name-input');
    dom.personaPromptInput = document.getElementById('persona-prompt-input');
    dom.personaSaveBtn = document.getElementById('persona-save-btn');
    dom.personaCancelBtn = document.getElementById('persona-cancel-btn');
    dom.addNewPersonaBtn = document.getElementById('add-new-persona-btn');

    // Persona Edit Modal
    dom.personaEditModal = document.getElementById('persona-edit-modal');
    dom.personaEditFormTitle = document.getElementById('persona-edit-form-title');
    dom.personaEditIdInput = document.getElementById('persona-edit-id-input');
    dom.personaEditNameInput = document.getElementById('persona-edit-name-input');
    dom.personaEditPromptInput = document.getElementById('persona-edit-prompt-input');
    dom.personaEditSaveBtn = document.getElementById('persona-edit-save-btn');
    dom.personaEditCancelBtn = document.getElementById('persona-edit-cancel-btn');

    // Attachment elements
    dom.chooseDbBtn = document.getElementById('choose-db-btn');
    dom.chooseTableBtn = document.getElementById('choose-table-btn');
    dom.attachmentBtn = document.getElementById('attachment-btn');
    dom.fileInput = document.getElementById('file-input');
    dom.attachmentPreview = document.getElementById('attachment-preview');
    dom.chatDropZone = document.getElementById('chat-drop-zone'); // 乌鸦：文件拖拽全视口遮罩

    // File Viewer Modal
    dom.fileViewerModal = document.getElementById('file-viewer-modal');
    dom.fileViewerTitle = document.getElementById('file-viewer-title');
    dom.fileViewerContent = document.getElementById('file-viewer-content');

    // HTML Preview Modal
    dom.htmlPreviewModal = document.getElementById('html-preview-modal');
    dom.htmlPreviewFrame = document.getElementById('html-preview-frame');
    dom.htmlPreviewRefreshBtn = document.getElementById('html-preview-refresh-btn');
    dom.htmlPreviewOpenBtn = document.getElementById('html-preview-open-btn');

    // Model Parameter elements
    dom.paramTempInput = document.getElementById('param-temperature');
    dom.paramTempValue = document.getElementById('temperature-value');
    dom.paramTopPInput = document.getElementById('param-top-p');
    dom.paramTopPValue = document.getElementById('top-p-value');
    dom.paramEnableTopK = document.getElementById('param-enable-top-k');
    dom.paramTopKInput = document.getElementById('param-top-k');
    dom.paramTopKValue = document.getElementById('top-k-value');
    dom.paramEnableMinP = document.getElementById('param-enable-min-p');
    dom.paramMinPInput = document.getElementById('param-min-p');
    dom.paramMinPValue = document.getElementById('min-p-value');
    dom.paramMaxTokensInput = document.getElementById('param-max-tokens');
    dom.streamModeToggle = document.getElementById('stream-mode-toggle'); // 乌鸦：流式模式开关

    // Regex elements
    dom.regexRuleList = document.getElementById('regex-rule-list');
    dom.regexFormTitle = document.getElementById('regex-form-title');
    dom.regexIdInput = document.getElementById('regex-id-input');
    dom.regexNameInput = document.getElementById('regex-name-input');
    dom.regexFindInput = document.getElementById('regex-find-input');
    dom.regexReplaceInput = document.getElementById('regex-replace-input');
    dom.regexScopeReqUser = document.getElementById('regex-scope-req-user');
    dom.regexScopeReqAssistant = document.getElementById('regex-scope-req-assistant');
    dom.regexScopeDisplayUser = document.getElementById('regex-scope-display-user');
    dom.regexScopeDisplayAssistant = document.getElementById('regex-scope-display-assistant');
    dom.regexEnabledToggle = document.getElementById('regex-enabled-toggle');
    dom.regexSaveBtn = document.getElementById('regex-save-btn');
    dom.regexCancelBtn = document.getElementById('regex-cancel-btn');
    dom.regexStageSelect = document.getElementById('regex-stage-select');
    dom.regexSortInput = document.getElementById('regex-sort-input');
    dom.regexMinFloorInput = document.getElementById('regex-min-floor-input');
    dom.regexMaxFloorInput = document.getElementById('regex-max-floor-input');
    dom.regexFloorSummary = document.getElementById('regex-floor-summary');
    dom.regexModalBody = document.querySelector('#regex-settings').closest('.modal-body');
    // 乌鸦：新增正则校验相关元素
    dom.regexTestInput = document.getElementById('regex-test-input');
    dom.regexTestResult = document.getElementById('regex-test-result');

    // Import/Export elements
    dom.exportConfigBtn = document.getElementById('export-config-btn');
    dom.importConfigTextarea = document.getElementById('import-config-textarea');
    dom.importConfigBtn = document.getElementById('import-config-btn');
    dom.uploadConfigBtn = document.getElementById('upload-config-btn');
    dom.importConfigFileInput = document.getElementById('import-config-file-input');
    dom.exportAllConversationsBtn = document.getElementById('export-all-conversations-btn');

    // 会话导入导出相关元素
    dom.importConversationTextarea = document.getElementById('import-conversation-textarea');
    dom.importConversationBtn = document.getElementById('import-conversation-btn');
    dom.uploadConversationBtn = document.getElementById('upload-conversation-btn');
    dom.importConversationFileInput = document.getElementById('import-conversation-file-input');

    // World Book Elements 备忘录
    dom.manageWorldBookBtn = document.getElementById('manage-worldbook-btn');
    dom.worldBookModal = document.getElementById('worldbook-modal');
    dom.worldBookList = document.getElementById('worldbook-list');
    dom.worldBookFormTitle = document.getElementById('worldbook-form-title');
    dom.worldBookIdInput = document.getElementById('worldbook-id-input');
    dom.worldBookNameInput = document.getElementById('worldbook-name-input');
    dom.worldBookContentInput = document.getElementById('worldbook-content-input');
    dom.worldBookCharCounter = document.getElementById('worldbook-char-counter');
    dom.worldBookDepthInput = document.getElementById('worldbook-depth-input');
    dom.worldBookRoleSelector = document.getElementById('worldbook-role-selector');
    dom.worldBookEnabledToggle = document.getElementById('worldbook-enabled-toggle');
    dom.worldBookSaveBtn = document.getElementById('worldbook-save-btn');
    dom.worldBookCancelBtn = document.getElementById('worldbook-cancel-btn');
    dom.worldBookMergeToggle = document.getElementById('worldbook-merge-toggle');
    // 乌鸦：标签相关的DOM元素
    dom.worldBookTagsInput = document.getElementById('worldbook-tags-input');
    dom.worldBookTagsDisplay = document.getElementById('worldbook-tags-display');
    dom.worldBookTagSearchInput = document.getElementById('worldbook-tag-search-input');
    dom.worldBookTagList = document.getElementById('worldbook-tag-list');
    dom.worldBookClearFilterBtn = document.getElementById('worldbook-clear-filter-btn');
    dom.worldBookListTabs = document.querySelector('.worldbook-list-tabs');
    dom.selectedCount = document.getElementById('selected-count');

    // Hide & Summary Elements
    dom.hideSummaryBtn = document.getElementById('hide-summary-btn');
    dom.hideSummaryModal = document.getElementById('hide-summary-modal');
    dom.hideSummaryStart = document.getElementById('hide-summary-start');
    dom.hideSummaryEnd = document.getElementById('hide-summary-end');
    dom.hideSummaryEnable = document.getElementById('hide-summary-enable');
    dom.hideSummaryPrompt = document.getElementById('hide-summary-prompt');
    dom.hideSummaryStartBtn = document.getElementById('hide-summary-start-btn');
    dom.hideSummaryResult = document.getElementById('hide-summary-result');
    dom.hideSummarySaveBtn = document.getElementById('hide-summary-save-btn');
    dom.hideSummaryPromptCharCounter = document.getElementById('hide-summary-prompt-char-counter');
    dom.hideSummaryResultCharCounter = document.getElementById('hide-summary-result-char-counter');
    dom.hideSummaryWithWorldBook = document.getElementById('hide-summary-with-worldbook');
    dom.hideSummaryWithRole = document.getElementById('hide-summary-with-role');

    // 用户头像相关
    dom.userAvatarInput = document.getElementById('user-avatar-input');
    dom.userAvatarPreview = document.getElementById('user-avatar-preview');
    dom.userAvatarRemoveBtn = document.getElementById('user-avatar-remove-btn');
    dom.avatarCropModal = document.getElementById('avatar-crop-modal');
    dom.avatarCropImage = document.getElementById('avatar-crop-image');
    dom.avatarCropConfirmBtn = document.getElementById('avatar-crop-confirm-btn');
    dom.avatarCropCancelBtn = document.getElementById('avatar-crop-cancel-btn');
    dom.avatarCropCancelBtn2 = document.getElementById('avatar-crop-cancel-btn2');

    // 会话头像管理相关
    dom.conversationAvatarModal = document.getElementById('conversation-avatar-modal');
    dom.convAvatarPreview = document.getElementById('conv-avatar-preview');
    dom.convAvatarStatus = document.getElementById('conv-avatar-status');
    dom.convAvatarRemoveBtn = document.getElementById('conv-avatar-remove-btn');
    dom.convAvatarInput = document.getElementById('conv-avatar-input');
    dom.convAvatarCropModal = document.getElementById('conv-avatar-crop-modal');
    dom.convAvatarCropImage = document.getElementById('conv-avatar-crop-image');
    dom.convAvatarCropConfirmBtn = document.getElementById('conv-avatar-crop-confirm-btn');
    dom.convAvatarCropCancelBtn = document.getElementById('conv-avatar-crop-cancel-btn');
    dom.convAvatarCropCancelBtn2 = document.getElementById('conv-avatar-crop-cancel-btn2');

    // 消息编辑弹窗
    dom.messageEditModal = document.getElementById('message-edit-modal');
    dom.messageEditTextarea = document.getElementById('message-edit-textarea');
    dom.messageEditSaveBtn = document.getElementById('message-edit-save-btn');
    dom.messageEditCancelBtn = document.getElementById('message-edit-cancel-btn');
    dom.messageEditCancelBtn2 = document.getElementById('message-edit-cancel-btn2');
    dom.messageEditAttachmentPreview = document.getElementById('message-edit-attachment-preview');

    // 乌鸦：新增编辑选择弹窗的引用
    dom.editChoicePopover = document.getElementById('edit-choice-popover');
    dom.editChoicePrimaryBtn = document.getElementById('edit-choice-primary');
    dom.editChoiceSecondaryBtn = document.getElementById('edit-choice-secondary');

    // 乌鸦：新增编辑选择弹窗的引用
    dom.editChoicePopover = document.getElementById('edit-choice-popover');
    dom.editChoicePrimaryBtn = document.getElementById('edit-choice-primary');
    dom.editChoiceSecondaryBtn = document.getElementById('edit-choice-secondary');

    // ===== Quick Hide Modal =====
    dom.quickHideModal = document.getElementById('quick-hide-modal');

    // 头像大图预览弹窗
    dom.avatarPreviewModal = document.getElementById('avatar-preview-modal');
    dom.avatarPreviewImg = document.getElementById('avatar-preview-img');
    dom.avatarPreviewCloseBtn = document.getElementById('avatar-preview-close-btn');

    // 乌鸦：清空所有头像按钮
    dom.clearAllAvatarsBtn = document.getElementById('clear-all-avatars-btn');

    // Font Size Selector
    dom.fontSizeSelector = document.getElementById('font-size-selector');

    // Auto-collapse Checkbox
    dom.autoCollapseCheckbox = document.getElementById('auto-collapse-checkbox');
    dom.debugModeCheckbox = document.getElementById('debug-mode-checkbox'); // 乌鸦：调试模式复选框
    dom.disableXssProtectionCheckbox = document.getElementById('setting-disable-xss-protection'); // 乌鸦：XSS防护开关
    dom.themeSelector = document.getElementById('theme-selector');

    // Render Mode Selectors
    dom.userRenderModeSelector = document.getElementById('user-render-mode-selector');
    dom.aiRenderModeSelector = document.getElementById('ai-render-mode-selector');

    // 气泡外观设置
    dom.userBubbleColorPicker = document.getElementById('user-bubble-color-picker');
    dom.userBubbleColorPreviewText = document.getElementById('user-bubble-color-preview-text');
    dom.userBubbleColorResetBtn = document.getElementById('user-bubble-color-reset-btn');
    dom.userBubbleMaxWidthSlider = document.getElementById('user-bubble-max-width-slider');
    dom.userBubbleMaxWidthValue = document.getElementById('user-bubble-max-width-value');
    dom.userBubbleWidthResetBtn = document.getElementById('user-bubble-width-reset-btn');

    // 系统提示词相关
    dom.systemPromptBtn = document.getElementById('system-prompt-btn');
    dom.fullscreenBtn = document.getElementById('fullscreen-btn');
    dom.exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');
    dom.systemPromptModal = document.getElementById('system-prompt-modal');
    dom.systemPromptPersona = document.getElementById('system-prompt-persona');
    dom.systemPromptWorldbook = document.getElementById('system-prompt-worldbook');
    dom.systemPromptSummary = document.getElementById('system-prompt-summary');
    dom.totalEstimatedTokens = document.getElementById('total-estimated-tokens');
    dom.totalCharacters = document.getElementById('total-characters');
    dom.mainTokens = document.getElementById('main-tokens');
    dom.thinkingTokens = document.getElementById('thinking-tokens');
    dom.mainCharacters = document.getElementById('main-characters');
    dom.thinkingCharacters = document.getElementById('thinking-characters');
    dom.hiddenTokens = document.getElementById('hidden-tokens');
    dom.hiddenCharacters = document.getElementById('hidden-characters');

    // Quick Prompts elements
    dom.quickPromptList = document.getElementById('quick-prompt-list');
    dom.addNewPromptBtn = document.getElementById('add-new-prompt-btn');
    dom.quickPromptFormContainer = document.getElementById('quick-prompt-form-container');
    dom.quickPromptFormTitle = document.getElementById('quick-prompt-form-title');
    dom.quickPromptIdInput = document.getElementById('quick-prompt-id-input');
    dom.quickPromptTitleInput = document.getElementById('quick-prompt-title-input');
    dom.quickPromptTextInput = document.getElementById('quick-prompt-text-input');
    dom.quickPromptInsertModeSelect = document.getElementById('quick-prompt-insert-mode');
    dom.quickPromptCursorPosSelect = document.getElementById('quick-prompt-cursor-position');
    dom.quickPromptCustomOffsetContainer = document.getElementById('quick-prompt-custom-offset-container');
    dom.quickPromptCustomOffsetInput = document.getElementById('quick-prompt-custom-offset-input');
    dom.quickPromptSaveBtn = document.getElementById('quick-prompt-save-btn');
    dom.quickPromptCancelBtn = document.getElementById('quick-prompt-cancel-btn');
    dom.quickPromptBtn = document.getElementById('quick-prompt-btn');
    dom.quickPromptMenu = document.getElementById('quick-prompt-menu');
    dom.quickPromptSearchInput = document.getElementById('quick-prompt-search-input');

    // Quick Hide Modal
    dom.quickHideModal = document.getElementById('quick-hide-modal');
    dom.quickHidePromptText = document.getElementById('quick-hide-prompt-text');
    dom.quickHideSingleBtn = document.getElementById('quick-hide-single-btn');
    dom.quickHideConfirmBtn = document.getElementById('quick-hide-confirm-btn');
    dom.quickHideResetBtn = document.getElementById('quick-hide-reset-btn');

    // MCP Tools Selector
    dom.mcpToolsBtn = document.getElementById('mcp-tools-btn');
    dom.mcpToolsMenu = document.getElementById('mcp-tools-menu');
    dom.mcpSelectedCount = document.getElementById('mcp-selected-count');

    // 乌鸦：更新日志弹窗
    dom.changelogBtn = document.getElementById('changelog-btn');
    dom.changelogModal = document.getElementById('changelog-modal');

    // 修改会话标题弹窗
    dom.editConvTitleModal = document.getElementById('edit-conv-title-modal');
    dom.editConvTitleInput = document.getElementById('edit-conv-title-input');
    dom.editConvTitleSaveBtn = document.getElementById('edit-conv-title-save-btn');
    dom.editConvTitleCancelBtn = document.getElementById('edit-conv-title-cancel-btn');

    // 导出会话弹窗
    dom.exportConvModal = document.getElementById('export-conv-modal');
    dom.exportConvTitleDisplay = document.getElementById('export-conv-title-display');
    dom.exportConvBranchSelect = document.getElementById('export-conv-branch-select');
    dom.exportBranchGroup = document.getElementById('export-branch-group');
    dom.exportBranchTip = document.getElementById('export-branch-tip');
    dom.exportFileExtGroup = document.getElementById('export-file-ext-group');
    dom.exportFloorRangeGroup = document.getElementById('export-floor-range-group');
    dom.exportFloorTotalTip = document.getElementById('export-floor-total-tip');
    dom.exportRangeStart = document.getElementById('export-range-start');
    dom.exportRangeEnd = document.getElementById('export-range-end');
    dom.exportCustomRangeInputs = document.getElementById('export-custom-range-inputs');
    dom.exportIncludeThinkCheckbox = document.getElementById('export-include-think-checkbox');
    dom.exportOptionsGroup = document.getElementById('export-options-group');
    dom.exportConvConfirmBtn = document.getElementById('export-conv-confirm-btn');
    dom.exportConvCancelBtn = document.getElementById('export-conv-cancel-btn');
}



export function toggleMessageActions(messageId, disabled) {
    const messageElement = document.querySelector(`[data-id="${messageId}"]`);
    if (messageElement) {
        const actions = messageElement.querySelector('.message-actions');
        if (actions) {
            const buttons = actions.querySelectorAll('button, a, select');
            buttons.forEach(button => {
                button.disabled = disabled;
                button.classList.toggle('disabled', disabled);
            });
        }
    }
}
