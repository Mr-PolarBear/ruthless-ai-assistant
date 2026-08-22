/**
 * @file api-modal.js
 * @description Handles API endpoint editing and management modals.
 */

import { dom } from '../dom.js?v=260823';
import { state, API_PRESETS } from '../state.js?v=260823';

export function openApiEditModal() {
    renderApiEditPresetButtons();
    dom.apiEditModal.style.display = 'flex';
    dom.apiEditModal.classList.add('visible');
}

export function closeApiEditModal() {
    dom.apiEditModal.classList.remove('visible');
}

export function resetApiEditForm() {
    dom.apiEditIdInput.value = '';
    dom.apiEditNameInput.value = '';
    dom.apiEditTypeSelector.value = 'openai-compatible';
    dom.apiEditUrlInput.value = '';
    dom.apiEditModelInput.value = '';
    dom.apiEditKeyInput.value = '';
    
    // 乌鸦：重置 Omni 模型标记
    if (dom.apiEditOmniModelToggle) dom.apiEditOmniModelToggle.checked = false;
    
    // 乌鸦：恢复默认的全局参数状态
    if (dom.apiEditCustomParamsToggle) {
        dom.apiEditCustomParamsToggle.checked = false;
        dom.apiEditCustomParamsSection.classList.remove('active');
        
        const gp = state.appSettings.modelParams;
        dom.apiEditParamTemp.value = gp.temperature;
        if (dom.apiEditParamTempValue) dom.apiEditParamTempValue.textContent = gp.temperature;
        dom.apiEditParamTopP.value = gp.top_p;
        if (dom.apiEditParamTopPValue) dom.apiEditParamTopPValue.textContent = gp.top_p;
        if (dom.apiEditParamEnableTopK) dom.apiEditParamEnableTopK.checked = !!gp.enableTopK;
        dom.apiEditParamTopK.value = gp.top_k;
        if (dom.apiEditParamTopKValue) dom.apiEditParamTopKValue.textContent = gp.top_k;
        if (dom.apiEditParamEnableMinP) dom.apiEditParamEnableMinP.checked = !!gp.enableMinP;
        dom.apiEditParamMinP.value = gp.min_p;
        if (dom.apiEditParamMinPValue) dom.apiEditParamMinPValue.textContent = gp.min_p;
        dom.apiEditParamMaxTokens.value = gp.max_tokens;
        if (dom.apiEditParamStream) dom.apiEditParamStream.checked = state.appSettings.streamMode !== false;
    }
    
    dom.apiEditFormTitle.textContent = '添加新 API 端点';
}

export function resetApiForm() {
    dom.apiIdInput.value = '';
    dom.apiNameInput.value = '';
    dom.apiTypeSelector.value = 'openai-compatible';
    dom.apiUrlInput.value = '';
    dom.apiModelInput.value = '';
    dom.apiKeyInput.value = '';
    dom.apiFormTitle.textContent = '添加新 API 端点';
    dom.apiCancelBtn.style.display = 'none';
    toggleApiFormFields('openai-compatible');
}

export function toggleApiEditFormFields(type) {
    dom.apiEditOpenAIFields.forEach(field => {
        field.style.display = type === 'openai-compatible' ? '' : 'none';
    });
}

export function toggleApiFormFields(type) {
    dom.apiOpenAIFields.forEach(field => {
        field.style.display = type === 'openai-compatible' ? '' : 'none';
    });
}

export function renderApiEditPresetButtons() {
    dom.apiEditPresetButtonsContainer.innerHTML = '';
    for (const key in API_PRESETS) {
        const preset = API_PRESETS[key];
        dom.apiEditPresetButtonsContainer.innerHTML += `
            <button class="preset-btn" data-preset="${key}">${preset.name}</button>
        `;
    }
}
