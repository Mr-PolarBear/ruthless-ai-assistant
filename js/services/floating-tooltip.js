/**
 * @file floating-tooltip.js
 * @description 通用视口级自适应浮动提示框管理器 (Global Floating Tooltip Manager)
 * 彻底解决在模态框、滚动面板 (overflow: hidden/auto) 中纯 CSS 伪元素气泡被物理裁剪截断、
 * 视口边缘遮挡挤压以及原生 title 黄框重叠污染的顽疾。
 */

let tooltipEl = null;
let arrowEl = null;
let contentEl = null;
let currentTarget = null;
let hideTimeout = null;

/**
 * 确保全局浮层 DOM 已初始化并挂载在 document.body
 */
function ensureTooltipDom() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'global-floating-tooltip';
    tooltipEl.className = 'global-floating-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');

    contentEl = document.createElement('div');
    contentEl.className = 'floating-tooltip-content';

    arrowEl = document.createElement('div');
    arrowEl.className = 'floating-tooltip-arrow';

    tooltipEl.appendChild(contentEl);
    tooltipEl.appendChild(arrowEl);
    document.body.appendChild(tooltipEl);

    return tooltipEl;
}

/**
 * 显示浮动提示
 * @param {HTMLElement} targetEl - 触发元素
 * @param {string} [customText] - 自定义提示文本（可选，默认读取 data-tooltip 或 title）
 */
export function showFloatingTooltip(targetEl, customText = '') {
    if (!targetEl || !(targetEl instanceof HTMLElement)) return;

    // 读取文本
    const text = customText || targetEl.dataset.tooltip || targetEl.getAttribute('title') || targetEl.dataset.originalTitle;
    if (!text || !text.trim()) return;

    // 如果元素上有原生 title，临时清空以防系统原生黄框在 1 秒后重叠弹出
    if (targetEl.hasAttribute('title') && targetEl.getAttribute('title')) {
        targetEl.dataset.originalTitle = targetEl.getAttribute('title');
        targetEl.removeAttribute('title');
    }

    ensureTooltipDom();
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    currentTarget = targetEl;
    contentEl.textContent = text;

    // 先显式设置为 block 但 opacity 为 0 以便测量真实渲染尺寸
    tooltipEl.style.display = 'block';
    tooltipEl.classList.remove('visible', 'placement-top', 'placement-bottom');
    tooltipEl.removeAttribute('aria-hidden');

    const targetRect = targetEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const padding = 10;
    const arrowMargin = 8;

    // 1. 水平计算：优先对齐目标元素水平中心
    let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
    // 左右视口边缘碰撞保护
    if (left < padding) {
        left = padding;
    } else if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
    }

    // 2. 垂直计算与智能翻转 (Flip)
    // 默认优先放在目标上方
    let top = targetRect.top - tooltipRect.height - arrowMargin;
    let placement = 'top';

    // 若上方空间不足（距视口顶部不足 padding），且下方空间充裕，则翻转到下方
    if (top < padding) {
        top = targetRect.bottom + arrowMargin;
        placement = 'bottom';
        // 若下方也超出视口底部，强行 clamp 到可见区
        if (top + tooltipRect.height > window.innerHeight - padding) {
            top = Math.max(padding, window.innerHeight - tooltipRect.height - padding);
        }
    }

    // 3. 小箭头动态对齐：箭头必须精准指向目标元素中心
    const targetCenter = targetRect.left + (targetRect.width / 2);
    let arrowLeft = targetCenter - left;
    // 箭头横向偏移不能超出浮层的圆角边界 (最小 12px，最大 tooltipWidth - 12px)
    arrowLeft = Math.max(12, Math.min(tooltipRect.width - 12, arrowLeft));

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
    arrowEl.style.left = `${Math.round(arrowLeft)}px`;
    tooltipEl.classList.add(`placement-${placement}`);

    // 顺滑呈现
    requestAnimationFrame(() => {
        if (tooltipEl && currentTarget === targetEl) {
            tooltipEl.classList.add('visible');
        }
    });
}

/**
 * 隐藏浮动提示
 */
export function hideFloatingTooltip() {
    if (currentTarget) {
        // 恢复原生 title
        if (currentTarget.dataset.originalTitle) {
            currentTarget.setAttribute('title', currentTarget.dataset.originalTitle);
        }
        currentTarget = null;
    }

    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
    tooltipEl.setAttribute('aria-hidden', 'true');

    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        if (tooltipEl && !tooltipEl.classList.contains('visible')) {
            tooltipEl.style.display = 'none';
        }
    }, 150);
}

/**
 * 全局初始化事件委托监听
 */
let isInitialized = false;
export function initGlobalFloatingTooltip() {
    if (isInitialized || typeof window === 'undefined') return;
    isInitialized = true;

    // 选择器清单：支持冲突弹窗、世界书、通用浮动提示
    const MATCH_SELECTOR = '.conflict-help-tooltip, .wb-help-tooltip, [data-floating-tooltip], .help-tooltip';

    // 鼠标移入委托 (捕获阶段)
    document.addEventListener('mouseover', (e) => {
        const target = e.target && e.target.closest ? e.target.closest(MATCH_SELECTOR) : null;
        if (target) {
            showFloatingTooltip(target);
        }
    }, true);

    // 鼠标移出委托 (捕获阶段)
    document.addEventListener('mouseout', (e) => {
        const target = e.target && e.target.closest ? e.target.closest(MATCH_SELECTOR) : null;
        if (target) {
            hideFloatingTooltip();
        }
    }, true);

    // 键盘焦点获得
    document.addEventListener('focusin', (e) => {
        const target = e.target && e.target.closest ? e.target.closest(MATCH_SELECTOR) : null;
        if (target) {
            showFloatingTooltip(target);
        }
    }, true);

    // 键盘焦点失去
    document.addEventListener('focusout', () => {
        hideFloatingTooltip();
    }, true);

    // 任何视口/局部容器滚动，立即隐去，防止飘在半空
    window.addEventListener('scroll', () => {
        if (tooltipEl && tooltipEl.classList.contains('visible')) {
            hideFloatingTooltip();
        }
    }, true);

    // 点击任意处立即隐藏
    document.addEventListener('click', () => {
        hideFloatingTooltip();
    }, true);

    // ESC 键立即隐藏
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideFloatingTooltip();
        }
    });
}
