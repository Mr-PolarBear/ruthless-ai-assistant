/**
 * @file realtime-modal.js
 * @description 实时模式与虚拟历法弹窗交互控制器
 * 严格遵循组件化和模块化思想，将弹窗模板与全部事件逻辑独立封装，
 * 绝不在已有大文件中堆砌冗余代码。数据完全隔离绑定于当前会话 conv.realtimeMode。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { saveConversation } from '../db.js?v=temp';
import { notify, updateAllDynamicUI } from '../ui-updater.js?v=temp';
import {
    calculateVirtualDate,
    formatVirtualTimestamp,
    getWeekdayName,
    getFormattedDateStr,
    getDefaultRealtimeConfig,
    normalizeRealtimeConfig,
    DEFAULT_REALTIME_PROMPT
} from '../services/realtime-mode.js?v=temp';

let isModalInitialized = false;
let currentModalBaseRealDate = '';
let initialAnchor = null;

/**
 * 构造弹窗 HTML 模板并挂载到 DOM
 */
function ensureModalMounted() {
    if (document.getElementById('realtime-modal')) return;

    const modalContainer = document.getElementById('modal-container') || document.body;
    const modalEl = document.createElement('div');
    modalEl.id = 'realtime-modal';
    modalEl.className = 'modal-overlay';
    modalEl.style.display = 'none';

    modalEl.innerHTML = `
        <div class="modal-content realtime-modal-content" role="dialog" aria-modal="true" aria-labelledby="rt-modal-title">
            <!-- 弹窗头部 -->
            <div class="realtime-modal-header">
                <div class="realtime-header-title" id="rt-modal-title">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <span>实时模式与历法时间配置</span>
                </div>
                <button type="button" class="realtime-modal-close-btn" id="realtime-modal-close-btn" title="关闭">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <!-- 弹窗主体（可滚动） -->
            <div class="realtime-modal-body">
                <!-- 1. 总开关与实时效果预览 -->
                <div class="rt-card">
                    <div class="rt-switch-row">
                        <div class="rt-switch-info">
                            <span class="rt-switch-label">启用当前会话实时模式</span>
                            <span class="rt-switch-desc">发送消息时将按配置追加时间戳，并注入异地即时通讯时序规范</span>
                        </div>
                        <label class="rt-toggle-switch">
                            <input type="checkbox" id="rt-toggle-enabled">
                            <span class="rt-toggle-slider"></span>
                        </label>
                    </div>

                    <div class="rt-preview-container">
                        <span class="rt-preview-label">实际发送效果预览：</span>
                        <span class="rt-preview-badge" id="rt-preview-text">--2026-11-09 星期一 17:00</span>
                    </div>
                </div>

                <!-- 2. 日期基准与虚拟历法 -->
                <div class="rt-card">
                    <div class="rt-card-header">
                        <span class="rt-card-title">日期基准与历法模式</span>
                    </div>

                    <div class="rt-segmented-control">
                        <button type="button" class="rt-seg-btn active" data-mode="system" id="rt-mode-system-btn">跟随现实系统时间</button>
                        <button type="button" class="rt-seg-btn" data-mode="custom" id="rt-mode-custom-btn">自定义虚拟历法日期</button>
                    </div>

                    <!-- 自定义日期录入网格 -->
                    <div id="rt-custom-date-container" style="display: none; flex-direction: column; gap: 10px;">
                        <div class="rt-date-grid">
                            <div class="rt-date-item">
                                <label class="rt-date-label" for="rt-input-year">年份 (年)</label>
                                <input type="number" id="rt-input-year" class="rt-input-field" min="1000" max="9999" placeholder="2020">
                            </div>
                            <div class="rt-date-item">
                                <label class="rt-date-label" for="rt-input-month">月份 (月)</label>
                                <input type="number" id="rt-input-month" class="rt-input-field" min="1" max="12" placeholder="2">
                            </div>
                            <div class="rt-date-item">
                                <label class="rt-date-label" for="rt-input-day">日期 (日)</label>
                                <input type="number" id="rt-input-day" class="rt-input-field" min="1" max="31" placeholder="1">
                            </div>
                            <div class="rt-date-item">
                                <span class="rt-date-label">自动计算星期</span>
                                <div class="rt-weekday-pill" id="rt-calculated-weekday">星期六</div>
                            </div>
                        </div>

                        <!-- 是否关联日期变化 -->
                        <label class="rt-check-row">
                            <input type="checkbox" id="rt-check-link-date" checked>
                            <span class="rt-check-label">
                                <span class="rt-check-title">关联现实日期推进 (推进流逝天数)</span>
                                <span class="rt-check-hint">现实每过一天，虚拟历法自动向前推进一天；严谨支持平闰年（如2020年2月29天）、跨月及跨年，时分秒从消息真实发送时间保真继承。</span>
                            </span>
                        </label>
                    </div>
                </div>

                <!-- 3. 星期与时间粒度 -->
                <div class="rt-card">
                    <div class="rt-card-header">
                        <span class="rt-card-title">时间粒度与格式</span>
                    </div>

                    <label class="rt-check-row">
                        <input type="checkbox" id="rt-check-include-weekday" checked>
                        <span class="rt-check-label">
                            <span class="rt-check-title">时间戳包含星期</span>
                            <span class="rt-check-hint">根据最终推算出的虚拟年月日自动历法计算，不可人为篡改，确保真实严密。</span>
                        </span>
                    </label>

                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span class="rt-date-label">时间展示粒度：</span>
                        <div class="rt-granularity-row">
                            <label class="rt-granularity-item">
                                <input type="checkbox" id="rt-tg-hour" checked>
                                <span>时 (HH)</span>
                            </label>
                            <label class="rt-granularity-item">
                                <input type="checkbox" id="rt-tg-minute" checked>
                                <span>分 (mm)</span>
                            </label>
                            <label class="rt-granularity-item">
                                <input type="checkbox" id="rt-tg-second">
                                <span>秒 (ss)</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 4. 消息追加策略 -->
                <div class="rt-card">
                    <div class="rt-card-header">
                        <span class="rt-card-title">消息注入策略</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label class="rt-check-row">
                            <input type="radio" name="rt-append-strategy" value="all" id="rt-strategy-all" checked>
                            <span class="rt-check-label">
                                <span class="rt-check-title">每条用户消息均追加 (推荐)</span>
                                <span class="rt-check-hint">每条用户消息按自身发送时间独立推算并追加时间戳，AI在阅读多轮上下文时可准确感知真实时间流逝差。</span>
                            </span>
                        </label>
                        <label class="rt-check-row">
                            <input type="radio" name="rt-append-strategy" value="latest" id="rt-strategy-latest">
                            <span class="rt-check-label">
                                <span class="rt-check-title">仅最新一条用户消息追加</span>
                                <span class="rt-check-hint">保持轻量脚标模式，仅在待发送的最新一条发言末尾追加时间戳。</span>
                            </span>
                        </label>
                    </div>
                </div>

                <!-- 5. 精简版系统提示词配置 -->
                <div class="rt-card">
                    <div class="rt-card-header">
                        <span class="rt-card-title">系统提示词规范</span>
                    </div>

                    <label class="rt-check-row">
                        <input type="checkbox" id="rt-check-prompt-enabled" checked>
                        <span class="rt-check-label">
                            <span class="rt-check-title">注入异地实时聊天规范提示词</span>
                            <span class="rt-check-hint">强约束角色口语化短句交流、生活规律与时序因果律，防止时间跃迁穿帮。</span>
                        </span>
                    </label>

                    <div class="rt-prompt-container" id="rt-prompt-container">
                        <textarea id="rt-prompt-textarea" class="rt-prompt-textarea" rows="5" spellcheck="false"></textarea>
                        <div class="rt-prompt-actions">
                            <span class="rt-prompt-tip">已精简优化（约180字），省 Token 并严格隔离至当前会话。</span>
                            <button type="button" class="rt-btn-subtle" id="rt-btn-reset-prompt">重置为精炼模板</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 弹窗底部操作条 -->
            <div class="realtime-modal-footer">
                <button type="button" class="rt-btn rt-btn-secondary" id="realtime-modal-cancel-btn">取消</button>
                <button type="button" class="rt-btn rt-btn-primary" id="realtime-modal-save-btn">保存并生效</button>
            </div>
        </div>
    `;

    modalContainer.appendChild(modalEl);
}

/**
 * 从当前表单中提取临时配置对象
 * @returns {Object}
 */
function getCurrentFormConfig() {
    const isCustom = document.getElementById('rt-mode-custom-btn')?.classList.contains('active');
    const y = parseInt(document.getElementById('rt-input-year')?.value, 10) || 2026;
    const m = parseInt(document.getElementById('rt-input-month')?.value, 10) || 1;
    const d = parseInt(document.getElementById('rt-input-day')?.value, 10) || 1;
    const dateMode = isCustom ? 'custom' : 'system';

    // — 为什么这么写 —
    // 动态判断用户是否更改了基准日期配置：
    // 若保持原锚点不变，则继续沿用历史 baseRealDate 计算累计流逝天数；
    // 一旦修改了自定义年月日或切换了模式，则将基准锚点重置为今日
    let baseRealDate = currentModalBaseRealDate || getFormattedDateStr(new Date());
    if (initialAnchor) {
        const anchorChanged = (
            initialAnchor.dateMode !== dateMode ||
            initialAnchor.customYear !== y ||
            initialAnchor.customMonth !== m ||
            initialAnchor.customDay !== d
        );
        if (anchorChanged) {
            baseRealDate = getFormattedDateStr(new Date());
        }
    }

    return {
        enabled: !!document.getElementById('rt-toggle-enabled')?.checked,
        dateMode: dateMode,
        customYear: y,
        customMonth: m,
        customDay: d,
        linkDateChange: !!document.getElementById('rt-check-link-date')?.checked,
        baseRealDate: baseRealDate,
        includeWeekday: !!document.getElementById('rt-check-include-weekday')?.checked,
        timeGranularity: {
            hour: !!document.getElementById('rt-tg-hour')?.checked,
            minute: !!document.getElementById('rt-tg-minute')?.checked,
            second: !!document.getElementById('rt-tg-second')?.checked
        },
        appendAllUser: document.getElementById('rt-strategy-all')?.checked !== false,
        promptEnabled: !!document.getElementById('rt-check-prompt-enabled')?.checked,
        prompt: document.getElementById('rt-prompt-textarea')?.value || DEFAULT_REALTIME_PROMPT
    };
}

/**
 * 实时刷新预览与星期计算
 */
function updateModalLivePreview() {
    const cfg = getCurrentFormConfig();

    // 动态更新日期输入框最大可选天数限制（支持平闰年2月28/29天与大小月）
    const dayInput = document.getElementById('rt-input-day');
    if (dayInput && cfg.dateMode === 'custom') {
        const maxDays = new Date(cfg.customYear, cfg.customMonth, 0).getDate();
        dayInput.max = maxDays;
        if (parseInt(dayInput.value, 10) > maxDays) {
            dayInput.value = maxDays;
            cfg.customDay = maxDays;
        }
    }

    // 计算自动推算出的虚拟日期
    const now = new Date();
    const vDate = calculateVirtualDate(cfg, now);

    // 1. 更新只读星期显示
    const weekdayEl = document.getElementById('rt-calculated-weekday');
    if (weekdayEl) {
        weekdayEl.textContent = getWeekdayName(vDate) || '星期日';
    }

    // 2. 更新效果预览徽章
    const previewEl = document.getElementById('rt-preview-text');
    if (previewEl) {
        const ts = formatVirtualTimestamp(vDate, cfg);
        previewEl.textContent = ts || '--(无时间戳)';
    }

    // 3. 提示词容器可见性
    const promptContainer = document.getElementById('rt-prompt-container');
    if (promptContainer) {
        promptContainer.style.opacity = cfg.promptEnabled ? '1' : '0.5';
        promptContainer.style.pointerEvents = cfg.promptEnabled ? 'auto' : 'none';
    }
}

/**
 * 切换日期模式 (system | custom)
 * @param {'system'|'custom'} mode 
 */
function setDateMode(mode) {
    const sysBtn = document.getElementById('rt-mode-system-btn');
    const customBtn = document.getElementById('rt-mode-custom-btn');
    const customContainer = document.getElementById('rt-custom-date-container');

    if (mode === 'custom') {
        sysBtn?.classList.remove('active');
        customBtn?.classList.add('active');
        if (customContainer) customContainer.style.display = 'flex';
    } else {
        customBtn?.classList.remove('active');
        sysBtn?.classList.add('active');
        if (customContainer) customContainer.style.display = 'none';
    }

    updateModalLivePreview();
}

/**
 * 打开实时模式配置弹窗
 */
export function openRealtimeModal() {
    const convId = state.currentConversationId;
    if (!convId || !state.conversations || !state.conversations[convId]) {
        notify.warning('请先选择或新建一个会话');
        return;
    }

    ensureModalMounted();
    initModalEvents();

    const conv = state.conversations[convId];
    const cfg = normalizeRealtimeConfig(conv.realtimeMode);

    // 记录基准锚点状态，供实时预览与天数递进无偏差求值
    currentModalBaseRealDate = cfg.baseRealDate || getFormattedDateStr(new Date());
    initialAnchor = {
        dateMode: cfg.dateMode,
        customYear: cfg.customYear,
        customMonth: cfg.customMonth,
        customDay: cfg.customDay
    };

    // 回填表单各项
    const toggleEnabled = document.getElementById('rt-toggle-enabled');
    if (toggleEnabled) toggleEnabled.checked = !!cfg.enabled;

    // 日期模式切换
    setDateMode(cfg.dateMode);

    // 自定义年月日回填
    const yearInput = document.getElementById('rt-input-year');
    const monthInput = document.getElementById('rt-input-month');
    const dayInput = document.getElementById('rt-input-day');
    if (yearInput) yearInput.value = cfg.customYear;
    if (monthInput) monthInput.value = cfg.customMonth;
    if (dayInput) {
        const maxDays = new Date(cfg.customYear, cfg.customMonth, 0).getDate();
        dayInput.max = maxDays;
        dayInput.value = cfg.customDay;
    }

    // 勾选项
    const linkDateCheck = document.getElementById('rt-check-link-date');
    if (linkDateCheck) linkDateCheck.checked = !!cfg.linkDateChange;

    const includeWeekdayCheck = document.getElementById('rt-check-include-weekday');
    if (includeWeekdayCheck) includeWeekdayCheck.checked = !!cfg.includeWeekday;

    // 时间粒度
    const tgHour = document.getElementById('rt-tg-hour');
    const tgMinute = document.getElementById('rt-tg-minute');
    const tgSecond = document.getElementById('rt-tg-second');
    if (tgHour) tgHour.checked = !!cfg.timeGranularity?.hour;
    if (tgMinute) tgMinute.checked = !!cfg.timeGranularity?.minute;
    if (tgSecond) tgSecond.checked = !!cfg.timeGranularity?.second;

    // 追加策略
    const stratAll = document.getElementById('rt-strategy-all');
    const stratLatest = document.getElementById('rt-strategy-latest');
    if (cfg.appendAllUser) {
        if (stratAll) stratAll.checked = true;
    } else {
        if (stratLatest) stratLatest.checked = true;
    }

    // 提示词
    const promptEnabledCheck = document.getElementById('rt-check-prompt-enabled');
    if (promptEnabledCheck) promptEnabledCheck.checked = !!cfg.promptEnabled;

    const promptTextarea = document.getElementById('rt-prompt-textarea');
    if (promptTextarea) promptTextarea.value = cfg.prompt || DEFAULT_REALTIME_PROMPT;

    // 刷新计算
    updateModalLivePreview();

    // 显示弹窗
    const modal = document.getElementById('realtime-modal');
    if (modal) {
        modal.style.display = 'flex';
        // 触发过渡
        requestAnimationFrame(() => {
            modal.classList.add('visible');
        });
    }
}

/**
 * 关闭实时模式配置弹窗
 */
export function closeRealtimeModal() {
    const modal = document.getElementById('realtime-modal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

/**
 * 保存实时模式配置到当前会话
 */
async function handleSaveRealtimeConfig() {
    const convId = state.currentConversationId;
    if (!convId || !state.conversations || !state.conversations[convId]) {
        notify.warning('未找到当前活跃会话');
        closeRealtimeModal();
        return;
    }

    const conv = state.conversations[convId];
    const formCfg = getCurrentFormConfig();

    const finalConfig = {
        enabled: formCfg.enabled,
        dateMode: formCfg.dateMode,
        customYear: formCfg.customYear,
        customMonth: formCfg.customMonth,
        customDay: formCfg.customDay,
        linkDateChange: formCfg.linkDateChange,
        baseRealDate: formCfg.baseRealDate,
        includeWeekday: formCfg.includeWeekday,
        timeGranularity: formCfg.timeGranularity,
        appendAllUser: formCfg.appendAllUser,
        promptEnabled: formCfg.promptEnabled,
        prompt: formCfg.prompt
    };

    // 隔离绑定于当前会话
    conv.realtimeMode = finalConfig;

    try {
        await saveConversation(conv.id, conv);
        updateAllDynamicUI();
        closeRealtimeModal();
        notify.success(finalConfig.enabled ? '实时模式已开启并保存' : '实时模式配置已保存 (已停用)');
    } catch (e) {
        console.error('保存实时模式配置失败:', e);
        notify.error('保存实时模式配置失败，请重试');
    }
}

/**
 * 初始化弹窗内交互事件（单例绑定）
 */
function initModalEvents() {
    if (isModalInitialized) return;
    isModalInitialized = true;

    const modal = document.getElementById('realtime-modal');
    const closeBtn = document.getElementById('realtime-modal-close-btn');
    const cancelBtn = document.getElementById('realtime-modal-cancel-btn');
    const saveBtn = document.getElementById('realtime-modal-save-btn');
    const resetPromptBtn = document.getElementById('rt-btn-reset-prompt');

    // 关闭相关
    closeBtn?.addEventListener('click', closeRealtimeModal);
    cancelBtn?.addEventListener('click', closeRealtimeModal);

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeRealtimeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.classList.contains('visible')) {
            closeRealtimeModal();
        }
    });

    // 保存按钮
    saveBtn?.addEventListener('click', handleSaveRealtimeConfig);

    // 重置提示词
    resetPromptBtn?.addEventListener('click', () => {
        const textarea = document.getElementById('rt-prompt-textarea');
        if (textarea) {
            textarea.value = DEFAULT_REALTIME_PROMPT;
            updateModalLivePreview();
            notify.info('已重置为精简版规范模板');
        }
    });

    // 模式切换
    document.getElementById('rt-mode-system-btn')?.addEventListener('click', () => setDateMode('system'));
    document.getElementById('rt-mode-custom-btn')?.addEventListener('click', () => setDateMode('custom'));

    // 表单各项输入即时联动预览
    const liveUpdateInputs = [
        'rt-toggle-enabled',
        'rt-input-year',
        'rt-input-month',
        'rt-input-day',
        'rt-check-link-date',
        'rt-check-include-weekday',
        'rt-tg-hour',
        'rt-tg-minute',
        'rt-tg-second',
        'rt-check-prompt-enabled'
    ];

    liveUpdateInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateModalLivePreview);
            el.addEventListener('change', updateModalLivePreview);
        }
    });
}

/**
 * 初始化实时模式总入口（挂载按钮监听与 DOM 结构）
 */
export function initRealtimeModal() {
    ensureModalMounted();
    initModalEvents();

    const topBtn = dom.realtimeModeBtn || document.getElementById('realtime-mode-btn');
    if (topBtn) {
        topBtn.addEventListener('click', openRealtimeModal);
    }
}
