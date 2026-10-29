/**
 * @file model-selector-manager.js
 * @description 管理聊天输入区模型选择器的渲染、联动、直接切换与模型拉取缓存 (Plan A)。
 */

import { dom } from './dom.js?v=temp';
import { state } from './state.js?v=temp';
import { fetchModels } from './services/model-fetcher.js?v=temp';
import { saveToLocalStorage } from './utils.js?v=temp';
import { saveConversation } from './db.js?v=temp';
import { notify } from './ui-updater.js?v=temp';

// 记录上次选中的有效模型，便于用户取消自定义输入时平滑回滚
let lastValidModel = '';

/**
 * 填充并更新聊天区的模型选择器
 * @param {string} [specificApiId] - 指定的 API 端点 ID，默认使用当前 API 下拉框选中的值
 * @param {string} [specificModel] - 指定选中的模型名
 */
export function populateModelSelector(specificApiId = null, specificModel = null) {
    if (!dom.modelSelector) return;

    const apiId = specificApiId || dom.apiSelector?.value;
    const api = state.apiEndpoints[apiId];
    dom.modelSelector.innerHTML = '';

    // 如果未配置 API 或所选 API 不存在
    if (!api) {
        dom.modelSelector.innerHTML = '<option value="">无可用模型</option>';
        dom.modelSelector.disabled = true;
        return;
    }

    // — 为什么这么写 —
    // SSE 类型是专有的自建后端问答端点，由后端自决模型，不需要也不支持用户切换 OpenAI 风格的模型名
    if (api.type === 'sse') {
        dom.modelSelector.innerHTML = '<option value="">SSE固定端点(无需选模型)</option>';
        dom.modelSelector.disabled = true;
        return;
    }

    dom.modelSelector.disabled = false;

    // — 为什么这么写 —
    // 1. 优先提取当前 API 缓存的 models 数组；
    // 2. 若 models 数组尚未拉取，则将历史保存的单个 api.model 字段作为兼容保底选项；
    // 3. 对模型列表进行去重，避免重复选项干扰视觉。
    let modelList = [];
    if (Array.isArray(api.models) && api.models.length > 0) {
        modelList = [...api.models];
    } else if (api.model) {
        modelList = [api.model];
    }

    modelList = [...new Set(modelList.filter(Boolean))];

    if (modelList.length === 0) {
        dom.modelSelector.innerHTML = '<option value="">暂无模型(点击下方拉取)</option>';
    } else {
        modelList.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            dom.modelSelector.appendChild(opt);
        });
    }

    // 分隔线及快捷功能操作项
    const optDivider = document.createElement('option');
    optDivider.disabled = true;
    optDivider.textContent = '──────────';
    dom.modelSelector.appendChild(optDivider);

    const optFetch = document.createElement('option');
    optFetch.value = '__FETCH_MODELS__';
    optFetch.textContent = '刷新并拉取模型列表...';
    dom.modelSelector.appendChild(optFetch);

    const optCustom = document.createElement('option');
    optCustom.value = '__CUSTOM_MODEL__';
    optCustom.textContent = '手动输入自定义模型...';
    dom.modelSelector.appendChild(optCustom);

    // 确定当前应该选中的模型：
    // — 为什么这么写 —
    // 1. 彻底解决大爷反馈的跨 API 端点模型污染 BUG：
    //    以前当用户在 DeepSeek 下选了 4.1flash，切换到小米后，小米列表中没有 4.1flash，
    //    原代码错误地将 4.1flash 强行插入到小米列表中并选中，导致直接请求报错 400 不支持的模型名！
    // 2. 引入会话级端点绑定机制（conv.apiModels[apiId]）：每个会话按 API 端点独立记忆选中的模型；
    // 3. 优先级：显式指定 specificModel > 当前会话针对该 apiId 的历史记忆 > 该 API 自身的默认模型 api.model > modelList 第一项；
    // 4. 严格校验合法性：挑出的候选模型如果不在当前 API 的 modelList 中，绝对不再强行塞给新 API，而是安全降级为当前 API 的合法默认模型。
    let selectedModel = specificModel;
    const currentConv = state.currentConversationId ? state.conversations[state.currentConversationId] : null;

    if (!selectedModel && currentConv) {
        if (currentConv.apiModels && currentConv.apiModels[apiId]) {
            selectedModel = currentConv.apiModels[apiId];
        } else if (currentConv.apiEndpointId === apiId && currentConv.model) {
            selectedModel = currentConv.model;
        }
    }

    if (!selectedModel) {
        selectedModel = api.model || modelList[0] || '';
    }

    // 严格检查候选模型是否属于当前 API 候选列表
    if (selectedModel && modelList.includes(selectedModel)) {
        dom.modelSelector.value = selectedModel;
    } else {
        // 如果挑出的模型不属于该 API（例如从其他 API 带来的旧值），绝对不能动态插入污染新 API！
        // 优先使用当前 API 自身配置的默认模型，若仍不匹配则选用当前 API 列表第一项
        const fallbackModel = (api.model && modelList.includes(api.model)) ? api.model : (modelList[0] || '');
        if (fallbackModel) {
            dom.modelSelector.value = fallbackModel;
        } else if (selectedModel && !selectedModel.startsWith('__')) {
            // 只有当当前 API 列表完全为空时，才允许保留自定义输入项
            const dynamicOpt = document.createElement('option');
            dynamicOpt.value = selectedModel;
            dynamicOpt.textContent = selectedModel;
            dom.modelSelector.insertBefore(dynamicOpt, optDivider);
            dom.modelSelector.value = selectedModel;
        }
    }

    lastValidModel = dom.modelSelector.value;

    // 同步到当前活动会话并绑定到当前 API
    if (currentConv) {
        currentConv.apiModels = currentConv.apiModels || {};
        if (dom.modelSelector.value && !dom.modelSelector.value.startsWith('__')) {
            currentConv.model = dom.modelSelector.value;
            currentConv.apiModels[apiId] = dom.modelSelector.value;
        }
    }
}

/**
 * 异步拉取并持久化指定 API 端点的可用模型列表
 * @param {string} apiId - API 端点 ID
 */
export async function fetchAndCacheModelsForApi(apiId) {
    const api = state.apiEndpoints[apiId];
    if (!api || !api.url) {
        notify.warning('该 API 未配置有效 URL');
        populateModelSelector(apiId);
        return;
    }

    try {
        notify.info(`正在拉取「${api.name}」的模型列表...`);
        const models = await fetchModels(api.url, api.key);

        if (Array.isArray(models) && models.length > 0) {
            api.models = models;
            // 如果原本没有默认模型或不在列表中，选第一个
            if (!api.model || !models.includes(api.model)) {
                api.model = models[0];
            }
            saveToLocalStorage();

            // 若当前处于活动会话中，也同步更新该会话的模型
            if (state.currentConversationId && state.conversations[state.currentConversationId]) {
                const conv = state.conversations[state.currentConversationId];
                conv.model = api.model;
                await saveConversation(conv.id, conv);
            }

            populateModelSelector(apiId, api.model);
            notify.success(`已拉取并缓存 ${models.length} 个模型！`);
        } else {
            notify.warning('未获取到可用模型');
            populateModelSelector(apiId, api.model);
        }
    } catch (error) {
        console.error('拉取模型失败:', error);
        notify.error(`拉取模型失败: ${error.message || '网络或鉴权错误'}`);
        populateModelSelector(apiId, api.model);
    }
}

/**
 * 处理模型选择器变更事件 (选中即直接切换)
 */
export async function handleModelSelectorChange() {
    if (!dom.modelSelector) return;
    const selectedVal = dom.modelSelector.value;
    const apiId = dom.apiSelector?.value;
    const api = state.apiEndpoints[apiId];

    // 1. 触发刷新/拉取模型列表
    if (selectedVal === '__FETCH_MODELS__') {
        if (!apiId || !api) {
            notify.warning('请先选择有效的 API 端点');
            populateModelSelector(apiId);
            return;
        }
        await fetchAndCacheModelsForApi(apiId);
        return;
    }

    // 2. 手动输入新模型
    if (selectedVal === '__CUSTOM_MODEL__') {
        const inputModel = prompt('请输入模型名称（例如 deepseek-chat 或 gpt-4o）：', lastValidModel || '');
        if (inputModel && inputModel.trim()) {
            const trimmed = inputModel.trim();
            if (api) {
                if (!Array.isArray(api.models)) {
                    api.models = api.model ? [api.model] : [];
                }
                if (!api.models.includes(trimmed)) {
                    api.models.unshift(trimmed); // 插入最前以便快速选择
                }
                api.model = trimmed;
                saveToLocalStorage();
            }

            if (state.currentConversationId && state.conversations[state.currentConversationId]) {
                const conv = state.conversations[state.currentConversationId];
                conv.model = trimmed;
                await saveConversation(conv.id, conv);
                saveToLocalStorage();
            }

            populateModelSelector(apiId, trimmed);
            notify.success(`已切换为模型：${trimmed}`);
        } else {
            // 用户取消输入，回退至上一次选中的有效模型
            populateModelSelector(apiId, lastValidModel);
        }
        return;
    }

    // 3. 常规模型切换，立即更新并持久化生效
    if (selectedVal) {
        lastValidModel = selectedVal;

        // 同步为该 API 的默认模型
        if (api) {
            api.model = selectedVal;
            saveToLocalStorage();
        }

        // 同步到当前活动会话并绑定到当前 API 端点
        if (state.currentConversationId && state.conversations[state.currentConversationId]) {
            const conv = state.conversations[state.currentConversationId];
            conv.model = selectedVal;
            conv.apiModels = conv.apiModels || {};
            conv.apiModels[apiId] = selectedVal;
            await saveConversation(conv.id, conv);
            saveToLocalStorage();
        }

        notify.success(`已切换模型：${selectedVal}`, 2000);
    }
}

/**
 * 初始化绑定模型选择器事件
 */
export function initModelSelectorEvents() {
    if (dom.modelSelector) {
        dom.modelSelector.addEventListener('change', handleModelSelectorChange);
    }
}
