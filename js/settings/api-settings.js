/**
 * @file api-settings.js
 * @description Handles API endpoint settings events.
 */

import { dom } from '../dom.js?v=260823';
import { state, API_PRESETS } from '../state.js?v=260823';
import { saveToLocalStorage } from '../utils.js?v=260823';
import { 
    toggleApiFormFields,
    // Re-checking imports from original file:
    resetApiForm, renderApiEndpointsList, populateApiSelector,
    resetApiEditForm, openApiEditModal, toggleApiEditFormFields,
    closeApiEditModal,
} from '../modals.js?v=260823';
import { closeModalWithAnimation } from '../modal-events.js?v=260823';
import { handleFetchModels } from '../main.js?v=260823';
import { DraggableList } from '../draggable-list.js?v=260823';

let lastApiCopyTime = 0;
let apiEndpointDragInstance = null;

export function setupAPIEvents() {
    if (dom.apiTypeSelector) dom.apiTypeSelector.addEventListener('change', () => toggleApiFormFields(dom.apiTypeSelector.value));
    if (dom.apiSaveBtn) dom.apiSaveBtn.addEventListener('click', saveApiEndpoint);
    if (dom.apiCancelBtn) dom.apiCancelBtn.addEventListener('click', resetApiForm);
    if (dom.apiEndpointList) {
        dom.apiEndpointList.addEventListener('click', handleApiListActions);
        
        if (apiEndpointDragInstance) {
            apiEndpointDragInstance.destroy();
        }
        apiEndpointDragInstance = new DraggableList(dom.apiEndpointList, {
            itemSelector: '.api-endpoint-item',
            onDrop: (fromIndex, toIndex) => {
                const apis = Object.values(state.apiEndpoints)
                    .map(api => {
                        if (typeof api.sort !== 'number') {
                            api.sort = 0;
                        }
                        return api;
                    })
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                
                if (fromIndex >= apis.length || toIndex >= apis.length) return; 
                
                const [movedApi] = apis.splice(fromIndex, 1);
                apis.splice(toIndex, 0, movedApi);
                
                apis.forEach((api, index) => {
                    api.sort = (index + 1) * 10;
                    state.apiEndpoints[api.id] = api;
                });
                
                saveToLocalStorage();
                renderApiEndpointsList();
                populateApiSelector();
            }
        });
    }
    if (dom.apiPresetButtonsContainer) dom.apiPresetButtonsContainer.addEventListener('click', handleApiPresetClick);
    if (dom.fetchModelsBtn) dom.fetchModelsBtn.addEventListener('click', handleFetchModels);
    if (dom.addNewApiBtn) dom.addNewApiBtn.addEventListener('click', () => {
        resetApiEditForm();
        openApiEditModal();
    });

    // API Edit Modal events
    if (dom.apiEditTypeSelector) dom.apiEditTypeSelector.addEventListener('change', () => toggleApiEditFormFields(dom.apiEditTypeSelector.value));
    if (dom.apiEditSaveBtn) dom.apiEditSaveBtn.addEventListener('click', saveApiEditEndpoint);
    if (dom.apiEditCancelBtn) dom.apiEditCancelBtn.addEventListener('click', () => closeModalWithAnimation(dom.apiEditModal, closeApiEditModal));
    if (dom.apiEditPresetButtonsContainer) dom.apiEditPresetButtonsContainer.addEventListener('click', handleApiEditPresetClick);
    if (dom.apiEditFetchModelsBtn) dom.apiEditFetchModelsBtn.addEventListener('click', handleApiEditFetchModels);
    
    // 乌鸦：Omni 全模态模型切换监听
    // 勾选 Omni 模式后，隐藏自定义参数区域（Omni 模型不支持那些参数）
    if (dom.apiEditOmniModelToggle) {
        dom.apiEditOmniModelToggle.addEventListener('change', (e) => {
            const customParamsWrapper = dom.apiEditCustomParamsToggle?.closest('.form-group');
            if (e.target.checked) {
                // Omni 模式：隐藏自定义参数区域，那些参数对 Omni 无效
                if (customParamsWrapper) customParamsWrapper.style.display = 'none';
                dom.apiEditCustomParamsSection.style.display = 'none';
            } else {
                // 标准模式：恢复显示
                if (customParamsWrapper) customParamsWrapper.style.display = '';
                dom.apiEditCustomParamsSection.style.display = '';
            }
        });
    }

    // 乌鸦：API 独立参数切换监听
    if (dom.apiEditCustomParamsToggle) {
        dom.apiEditCustomParamsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                dom.apiEditCustomParamsSection.classList.add('active');
            } else {
                dom.apiEditCustomParamsSection.classList.remove('active');
            }
        });
    }
    
    // 乌鸦：同步滑动条和数值显示
    const apiParamInputs = [dom.apiEditParamTemp, dom.apiEditParamTopP, dom.apiEditParamTopK, dom.apiEditParamMinP];
    apiParamInputs.forEach(input => {
        if (input) {
            input.addEventListener('input', (e) => {
                const id = e.target.id.replace('api-edit-param-', '').replace('-input', ''); // 例如 top-k
                const valueEl = document.getElementById(`api-edit-${id}-value`);
                if (valueEl) valueEl.textContent = e.target.value;
            });
        }
    });
    
    if (dom.apiEditModal) dom.apiEditModal.addEventListener('click', (e) => {
        if (e.target === dom.apiEditModal) return;
    });
}

function handleApiListActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    const id = button.dataset.id;
    
    if (button.classList.contains('api-copy-btn')) {
        if (Date.now() - lastApiCopyTime < 1000) {
            alert('请勿频繁点击复制！');
            return;
        }
        lastApiCopyTime = Date.now();
        const apiToCopy = state.apiEndpoints[id];
        if (confirm(`确定要复制API "${apiToCopy.name}" 吗？`)) {
            const newApi = JSON.parse(JSON.stringify(apiToCopy));
            newApi.id = `api_${Date.now()}`;
            newApi.name = `${apiToCopy.name}_copy1`;
            
            const existingApis = Object.values(state.apiEndpoints);
            const maxSort = existingApis.length > 0 
                ? Math.max(...existingApis.map(api => api.sort || 0))
                : 0;
            newApi.sort = maxSort + 10;
            
            state.apiEndpoints[newApi.id] = newApi;
            saveToLocalStorage();
            renderApiEndpointsList();
            populateApiSelector();
        }
    } else if (button.classList.contains('api-edit-btn')) {
        const api = state.apiEndpoints[id];
        if (!api) return alert('未找到API数据');
        dom.apiEditIdInput.value = api.id;
        dom.apiEditNameInput.value = api.name;
        dom.apiEditTypeSelector.value = api.type;
        dom.apiEditUrlInput.value = api.url;
        dom.apiEditModelInput.value = api.model;
        dom.apiEditKeyInput.value = api.key || '';
        dom.apiEditFormTitle.textContent = '编辑 API 端点';
        dom.apiEditCancelBtn.style.display = 'inline-block';
        
        // 乌鸦：回填 Omni 模型标记，并同步隐藏/显示自定义参数区域
        if (dom.apiEditOmniModelToggle) {
            dom.apiEditOmniModelToggle.checked = !!api.isOmniModel;
            // Omni 模式下隐藏自定义参数（那些参数对 Omni 模型无效）
            const customParamsWrapper = dom.apiEditCustomParamsToggle?.closest('.form-group');
            if (api.isOmniModel) {
                if (customParamsWrapper) customParamsWrapper.style.display = 'none';
                dom.apiEditCustomParamsSection.style.display = 'none';
            } else {
                if (customParamsWrapper) customParamsWrapper.style.display = '';
                dom.apiEditCustomParamsSection.style.display = '';
            }
        }
        
        // 乌鸦：回填自定义参数
        if (api.modelParams) {
            dom.apiEditCustomParamsToggle.checked = true;
            dom.apiEditCustomParamsSection.classList.add('active');
            
            dom.apiEditParamTemp.value = api.modelParams.temperature;
            dom.apiEditParamTempValue.textContent = api.modelParams.temperature;
            dom.apiEditParamTopP.value = api.modelParams.top_p;
            dom.apiEditParamTopPValue.textContent = api.modelParams.top_p;
            
            dom.apiEditParamEnableTopK.checked = !!api.modelParams.enableTopK;
            dom.apiEditParamTopK.value = api.modelParams.top_k || 40;
            dom.apiEditParamTopKValue.textContent = dom.apiEditParamTopK.value;
            
            dom.apiEditParamEnableMinP.checked = !!api.modelParams.enableMinP;
            dom.apiEditParamMinP.value = api.modelParams.min_p || 0.05;
            dom.apiEditParamMinPValue.textContent = dom.apiEditParamMinP.value;
            
            dom.apiEditParamMaxTokens.value = api.modelParams.max_tokens !== undefined ? api.modelParams.max_tokens : -1;
            dom.apiEditParamStream.checked = api.modelParams.streamMode !== false;
        } else {
            dom.apiEditCustomParamsToggle.checked = false;
            dom.apiEditCustomParamsSection.classList.remove('active');
            
            // 恢复默认的全局参数显示，避免留下上次编辑的残影
            const gp = state.appSettings.modelParams;
            dom.apiEditParamTemp.value = gp.temperature;
            dom.apiEditParamTempValue.textContent = gp.temperature;
            dom.apiEditParamTopP.value = gp.top_p;
            dom.apiEditParamTopPValue.textContent = gp.top_p;
            dom.apiEditParamEnableTopK.checked = !!gp.enableTopK;
            dom.apiEditParamTopK.value = gp.top_k;
            dom.apiEditParamTopKValue.textContent = gp.top_k;
            dom.apiEditParamEnableMinP.checked = !!gp.enableMinP;
            dom.apiEditParamMinP.value = gp.min_p;
            dom.apiEditParamMinPValue.textContent = gp.min_p;
            dom.apiEditParamMaxTokens.value = gp.max_tokens;
            dom.apiEditParamStream.checked = state.appSettings.streamMode !== false;
        }
        
        toggleApiEditFormFields(api.type);
        openApiEditModal();
    } else if (button.classList.contains('api-delete-btn')) {
        if (confirm(`确定要删除API "${state.apiEndpoints[id].name}" 吗？`)) {
            delete state.apiEndpoints[id];
            saveToLocalStorage();
            renderApiEndpointsList();
            populateApiSelector();
        }
    }
}

function handleApiPresetClick(e) {
    if (e.target.tagName === 'BUTTON') {
        const presetKey = e.target.dataset.preset;
        const preset = API_PRESETS[presetKey];
        if (preset) {
            resetApiForm();
            dom.apiNameInput.value = preset.name;
            dom.apiTypeSelector.value = preset.type;
            dom.apiUrlInput.value = preset.url;
            dom.apiModelInput.value = preset.model;
            toggleApiFormFields(preset.type);
        }
    }
}

function handleApiEditPresetClick(e) {
    if (e.target.tagName === 'BUTTON') {
        const presetKey = e.target.dataset.preset;
        const preset = API_PRESETS[presetKey];
        if (preset) {
            resetApiEditForm();
            dom.apiEditNameInput.value = preset.name;
            dom.apiEditTypeSelector.value = preset.type;
            dom.apiEditUrlInput.value = preset.url;
            dom.apiEditModelInput.value = preset.model;
            toggleApiEditFormFields(preset.type);
        }
    }
}

function handleApiEditFetchModels() {
    const url = dom.apiEditUrlInput.value.trim();
    const key = dom.apiEditKeyInput.value.trim();
    if (!url) return alert('请先填写API URL');
    handleFetchModels(url, key, dom.apiEditModelInput);
}

function isValidApiUrl(url) {
    let urlToCheck = url;
    const protocolIndex = url.indexOf('://');
    if (protocolIndex > -1) {
        urlToCheck = url.substring(protocolIndex + 3);
    }
    if (urlToCheck.includes('//')) {
        alert('API URL 格式不正确，路径中不能包含连续的斜杠 (//)。');
        return false;
    }
    return true;
}

function saveApiEndpoint() {
    const id = dom.apiIdInput.value;
    const name = dom.apiNameInput.value.trim();
    const type = dom.apiTypeSelector.value;
    const url = dom.apiUrlInput.value.trim();
    const model = dom.apiModelInput.value.trim();
    const key = dom.apiKeyInput.value.trim();

    if (!name || !url) return alert('名称和URL不能为空！');
    if (!isValidApiUrl(url)) return;
    if (type === 'openai-compatible' && !model) return alert('OpenAI兼容类型需要填写模型名称。');

    const endpointId = id || `api_${Date.now()}`;
    
    let sort = 0;
    if (!id) { // 新API端点
        const existingApis = Object.values(state.apiEndpoints);
        const maxSort = existingApis.length > 0 
            ? Math.max(...existingApis.map(api => api.sort || 0))
            : 0;
        sort = maxSort + 10;
    } else { // 编辑现有API端点，保持原有sort值
        sort = state.apiEndpoints[endpointId]?.sort || 0;
    }
    
    state.apiEndpoints[endpointId] = {id: endpointId, name, type, url, model, key, sort};
    saveToLocalStorage();
    renderApiEndpointsList();
    populateApiSelector();
    resetApiForm();
}

function saveApiEditEndpoint() {
    const id = dom.apiEditIdInput.value;
    const name = dom.apiEditNameInput.value.trim();
    const type = dom.apiEditTypeSelector.value;
    const url = dom.apiEditUrlInput.value.trim();
    const model = dom.apiEditModelInput.value.trim();
    const key = dom.apiEditKeyInput.value.trim();

    if (!name || !url) return alert('名称和URL不能为空！');
    if (!isValidApiUrl(url)) return;
    if (type === 'openai-compatible' && !model) return alert('OpenAI兼容类型需要填写模型名称。');

    const endpointId = id || `api_${Date.now()}`;
    
    let sort = 0;
    if (!id) { // 新API端点
        const existingApis = Object.values(state.apiEndpoints);
        const maxSort = existingApis.length > 0 
            ? Math.max(...existingApis.map(api => api.sort || 0))
            : 0;
        sort = maxSort + 10;
    } else { // 编辑现有API端点，保持原有sort值
        sort = state.apiEndpoints[endpointId]?.sort || 0;
    }
    
    // 乌鸦：构建基础对象
    const endpointConfig = {id: endpointId, name, type, url, model, key, sort};
    
    // 乌鸦：保存 Omni 全模态模型标记
    endpointConfig.isOmniModel = !!(dom.apiEditOmniModelToggle && dom.apiEditOmniModelToggle.checked);
    
    // 乌鸦：处理自定义参数
    if (dom.apiEditCustomParamsToggle && dom.apiEditCustomParamsToggle.checked) {
        endpointConfig.modelParams = {
            temperature: parseFloat(dom.apiEditParamTemp.value),
            top_p: parseFloat(dom.apiEditParamTopP.value),
            enableTopK: dom.apiEditParamEnableTopK.checked,
            top_k: parseInt(dom.apiEditParamTopK.value, 10),
            enableMinP: dom.apiEditParamEnableMinP.checked,
            min_p: parseFloat(dom.apiEditParamMinP.value),
            max_tokens: parseInt(dom.apiEditParamMaxTokens.value, 10),
            streamMode: dom.apiEditParamStream.checked
        };
    } else {
        endpointConfig.modelParams = null;
    }
    
    state.apiEndpoints[endpointId] = endpointConfig;
    saveToLocalStorage();
    renderApiEndpointsList();
    populateApiSelector();
    closeModalWithAnimation(dom.apiEditModal, closeApiEditModal);
}
