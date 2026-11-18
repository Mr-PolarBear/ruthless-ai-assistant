/**
 * 自动记忆总结中转决策弹窗 (Auto Summary Relay Modal)
 * 
 * — 为什么这么写 —
 * 1. 控大防膨与单一职责：将中转开启时的自动总结决策弹窗抽离为完全独立的模块，不污染主 modals.html 与 summary-manager.js；
 * 2. 状态感知与安全置灰：当未连接云端或未开启任务中转时，云端中转按钮强制置灰并展示小锁与气泡提示，只允许本地总结或稍后；
 * 3. 记忆决策与闭环管理：支持勾选“记住本次选择”，直接映射到会话的总结策略配置中，可在设置弹窗中随时更改；
 * 4. 视觉铁律遵循：浅色与深色双向完整适配，统一使用标准 Lucide/Feather 风格 SVG 矢量图标，严禁 Emoji 充当按钮。
 */

import { state } from '../state.js?v=temp';
import { dom } from '../dom.js?v=temp';
import { escapeHtml } from '../utils.js?v=temp';

let modalElement = null;
let currentResolve = null;
let currentPromise = null;
let activeConvId = null;

/**
 * 内部创建或获取弹窗 DOM 结构
 */
function ensureModalDOM() {
    if (modalElement && (document.body.contains ? document.body.contains(modalElement) : true)) {
        return modalElement;
    }

    const existing = document.getElementById('auto-summary-relay-modal');
    if (existing) {
        modalElement = existing;
        return modalElement;
    }

    const modal = document.createElement('div');
    modal.id = 'auto-summary-relay-modal';
    modal.className = 'modal-overlay auto-summary-relay-modal-overlay';
    modal.style.display = 'none';

    modal.innerHTML = `
        <div class="modal-content auto-summary-relay-modal-card">
            <div class="modal-header auto-summary-relay-header">
                <div class="auto-summary-relay-title-group">
                    <svg class="auto-summary-relay-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <h2>自动记忆总结决策</h2>
                </div>
                <button type="button" class="modal-close-btn auto-summary-relay-close-btn" title="暂不总结 (关闭)">&times;</button>
            </div>

            <div class="modal-body auto-summary-relay-body">
                <div class="auto-summary-relay-badge-row">
                    <span id="auto-summary-relay-trigger-info" class="auto-summary-relay-trigger-badge">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <span id="auto-summary-relay-trigger-text">已达到自动总结门槛</span>
                    </span>
                </div>

                <p class="auto-summary-relay-desc">
                    检测到当前会话已满足自动总结条件。为了保障长文本提炼的稳定性，请选择本次总结的执行方式：
                </p>

                <!-- 方案选项卡列表 -->
                <div class="auto-summary-relay-options-list">
                    <!-- 选项 1：云端中转总结 (推荐) -->
                    <button type="button" class="auto-summary-relay-card-btn auto-summary-relay-cloud-btn" id="auto-summary-relay-action-cloud">
                        <div class="auto-summary-relay-btn-icon-box">
                            <svg class="auto-summary-btn-svg" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
                            </svg>
                        </div>
                        <div class="auto-summary-relay-btn-text-box">
                            <div class="auto-summary-relay-btn-title-row">
                                <span class="auto-summary-relay-btn-title">云端中转后台总结</span>
                                <span class="auto-summary-relay-tag-recommend">推荐</span>
                                <span class="auto-summary-relay-lock-indicator" id="auto-summary-relay-cloud-lock" style="display: none;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                    未就绪
                                </span>
                            </div>
                            <div class="auto-summary-relay-btn-subtitle" id="auto-summary-relay-cloud-desc">
                                由云端后台接力长跑，切后台、熄屏或断网不丢失，完成后自动归档压缩历史楼层。
                            </div>
                        </div>
                    </button>

                    <!-- 选项 2：本地浏览器直连总结 -->
                    <button type="button" class="auto-summary-relay-card-btn" id="auto-summary-relay-action-local">
                        <div class="auto-summary-relay-btn-icon-box">
                            <svg class="auto-summary-btn-svg" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </div>
                        <div class="auto-summary-relay-btn-text-box">
                            <div class="auto-summary-relay-btn-title-row">
                                <span class="auto-summary-relay-btn-title">本地直连流式总结</span>
                            </div>
                            <div class="auto-summary-relay-btn-subtitle">
                                浏览器端直接发起请求，实时流式输出，适合当前网络稳定且亮屏盯盘。
                            </div>
                        </div>
                    </button>

                    <!-- 选项 3：稍后提醒 -->
                    <button type="button" class="auto-summary-relay-card-btn auto-summary-relay-skip-btn" id="auto-summary-relay-action-skip">
                        <div class="auto-summary-relay-btn-icon-box">
                            <svg class="auto-summary-btn-svg" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </div>
                        <div class="auto-summary-relay-btn-text-box">
                            <div class="auto-summary-relay-btn-title-row">
                                <span class="auto-summary-relay-btn-title">稍后提醒 (跳过本次)</span>
                            </div>
                            <div class="auto-summary-relay-btn-subtitle">
                                暂不执行总结，不打断当前聊天节奏，待下一轮对话完成后再次提醒。
                            </div>
                        </div>
                    </button>
                </div>

                <!-- 记忆勾选框 -->
                <div class="auto-summary-relay-remember-row">
                    <label class="auto-summary-relay-remember-label">
                        <input type="checkbox" id="auto-summary-relay-remember-checkbox">
                        <span>记住本次选择，后续自动以此模式执行 (可在【隐藏与总结】设置中随时修改)</span>
                    </label>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modalElement = modal;

    // 绑定事件
    const closeBtn = modal.querySelector('.auto-summary-relay-close-btn');
    const cloudBtn = modal.querySelector('#auto-summary-relay-action-cloud');
    const localBtn = modal.querySelector('#auto-summary-relay-action-local');
    const skipBtn = modal.querySelector('#auto-summary-relay-action-skip');
    const rememberCheckbox = modal.querySelector('#auto-summary-relay-remember-checkbox');

    const handleAction = (action) => {
        const remember = !!rememberCheckbox?.checked;
        closeModal();
        const resolver = currentResolve;
        currentResolve = null;
        currentPromise = null;
        activeConvId = null;
        if (resolver) {
            resolver({ action, remember });
        }
    };

    closeBtn?.addEventListener('click', () => handleAction('skip'));
    skipBtn?.addEventListener('click', () => handleAction('skip'));
    localBtn?.addEventListener('click', () => handleAction('local'));
    cloudBtn?.addEventListener('click', () => {
        if (cloudBtn.classList.contains('disabled') || cloudBtn.disabled) return;
        handleAction('relay');
    });

    // 点击遮罩外部与 ESC 键
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            handleAction('skip');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            handleAction('skip');
        }
    });

    return modal;
}

/**
 * 关闭弹窗
 */
function closeModal() {
    if (modalElement) {
        modalElement.style.display = 'none';
    }
}

/**
 * 唤起自动记忆总结中转决策弹窗
 * @param {object} params
 * @param {string} params.convId - 会话ID
 * @param {string} params.triggerDesc - 触发原因说明（如 "已累积 10 楼" 或 "已累积 4,200 Token"）
 * @param {boolean} params.isRelayReady - 云端中转是否已就绪（已连接云服务且开启中转）
 * @returns {Promise<{ action: 'relay' | 'local' | 'skip', remember: boolean }>}
 */
export function openAutoSummaryRelayModal(params) {
    const { convId = '', triggerDesc = '已达自动总结门槛', isRelayReady = false } = params || {};

    const modal = ensureModalDOM();
    const triggerTextEl = modal.querySelector('#auto-summary-relay-trigger-text');
    const cloudBtn = modal.querySelector('#auto-summary-relay-action-cloud');
    const cloudLock = modal.querySelector('#auto-summary-relay-cloud-lock');
    const cloudDesc = modal.querySelector('#auto-summary-relay-cloud-desc');
    const rememberCheckbox = modal.querySelector('#auto-summary-relay-remember-checkbox');

    if (triggerTextEl) {
        triggerTextEl.textContent = triggerDesc;
    }

    if (rememberCheckbox) {
        rememberCheckbox.checked = false; // 每次唤起默认不勾选，防误记住
    }

    // 状态联动：云端就绪 vs 未就绪置灰保护
    if (cloudBtn && cloudLock && cloudDesc) {
        if (isRelayReady) {
            cloudBtn.classList.remove('disabled');
            cloudBtn.removeAttribute('disabled');
            cloudLock.style.display = 'none';
            cloudDesc.textContent = '由云端后台接力长跑，切后台、熄屏或断网不丢失，完成后自动归档压缩历史楼层。';
        } else {
            cloudBtn.classList.add('disabled');
            cloudBtn.setAttribute('disabled', 'disabled');
            cloudLock.style.display = 'inline-flex';
            cloudDesc.textContent = '未连接云同步服务或未开启中转保护，请先在云同步设置面板中连接并启用。';
        }
    }

    modal.style.display = 'flex';

    // — 为什么这么写 —
    // 单例并发保护：若当前弹窗已在屏幕上等待用户选择且属于同一会话，更新视图后直接复用当前 Promise，杜绝 Promise 挂起与泄露
    if (currentPromise && activeConvId === convId) {
        return currentPromise;
    }

    // 若会话已变更，立即先解决上一会话的挂起单并清理
    if (currentResolve) {
        const prevResolve = currentResolve;
        currentResolve = null;
        currentPromise = null;
        prevResolve({ action: 'skip', remember: false });
    }

    activeConvId = convId;
    currentPromise = new Promise((resolve) => {
        currentResolve = resolve;
    });

    return currentPromise;
}
