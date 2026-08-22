/**
 * @file bubble-settings.js
 * @description 专职负责用户气泡颜色自定义与气泡最大宽度设置
 */

import { dom } from '../dom.js?v=260823';
import { state } from '../state.js?v=260823';
import { saveAppSettings } from '../utils.js?v=260823';

/**
 * 将十六进制颜色转换为稍微加深的暗色（用于生成平滑立体渐变）
 * @param {string} hex - #RRGGBB
 * @param {number} factor - 变暗比例 (0~1)
 * @returns {string} #RRGGBB
 */
function adjustColorBrightness(hex, factor = 0.82) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return hex;
    const r = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor)));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 将十六进制颜色转换为 RGBA
 * @param {string} hex - #RRGGBB
 * @param {number} alpha - 透明度
 * @returns {string}
 */
function hexToRgba(hex, alpha = 0.3) {
    if (!hex || !hex.startsWith('#') || hex.length < 7) return 'rgba(0, 0, 0, 0.2)';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 应用气泡自定义样式（动态注入 CSS 变量）
 * 注意：必须同时设置在 document.body 与 document.documentElement 上，
 * 以确保优先级高于 CSS 中的 body[data-theme="..."] 选择器！
 */
export function applyBubbleCustomStyles() {
    const settings = state.appSettings || {};
    const targets = [document.body, document.documentElement].filter(Boolean);

    // 1. 用户气泡颜色处理
    if (settings.customUserBubbleColor) {
        const startColor = settings.customUserBubbleColor;
        const endColor = adjustColorBrightness(startColor, 0.82);
        const shadowColor = hexToRgba(startColor, 0.3);

        targets.forEach(el => {
            el.style.setProperty('--user-bubble-gradient-start', startColor, 'important');
            el.style.setProperty('--user-bubble-gradient-end', endColor, 'important');
            el.style.setProperty('--user-bubble-shadow-color', shadowColor, 'important');
        });
    } else {
        // 未自定义时移除内联样式，退回主题默认样式
        targets.forEach(el => {
            el.style.removeProperty('--user-bubble-gradient-start');
            el.style.removeProperty('--user-bubble-gradient-end');
            el.style.removeProperty('--user-bubble-shadow-color');
        });
    }

    // 2. 气泡最大宽度处理（百分比，默认 100%）
    const maxWidth = (settings.userBubbleMaxWidth !== undefined && settings.userBubbleMaxWidth !== null) 
        ? Number(settings.userBubbleMaxWidth) 
        : 100;

    targets.forEach(el => {
        el.style.setProperty('--user-bubble-max-width', `${maxWidth}%`, 'important');
        el.style.setProperty('--bubble-max-width', `${maxWidth}%`, 'important');
    });
}

/**
 * 同步气泡设置 UI 控件的展示状态
 */
export function updateBubbleSettingsUI() {
    const settings = state.appSettings || {};

    // 颜色控件同步
    if (dom.userBubbleColorPicker) {
        if (settings.customUserBubbleColor) {
            dom.userBubbleColorPicker.value = settings.customUserBubbleColor;
            if (dom.userBubbleColorPreviewText) {
                dom.userBubbleColorPreviewText.textContent = settings.customUserBubbleColor.toUpperCase();
            }
        } else {
            if (dom.userBubbleColorPreviewText) {
                dom.userBubbleColorPreviewText.textContent = '默认颜色';
            }
            // 尝试读取当前主题计算颜色
            try {
                const currentComputed = getComputedStyle(document.body).getPropertyValue('--user-bubble-gradient-start').trim();
                if (currentComputed && currentComputed.startsWith('#') && currentComputed.length === 7) {
                    dom.userBubbleColorPicker.value = currentComputed;
                }
            } catch (e) {}
        }
    }

    // 宽度滑块同步（默认 100%）
    const maxWidth = (settings.userBubbleMaxWidth !== undefined && settings.userBubbleMaxWidth !== null) 
        ? Number(settings.userBubbleMaxWidth) 
        : 100;

    if (dom.userBubbleMaxWidthSlider) {
        dom.userBubbleMaxWidthSlider.value = maxWidth;
    }
    if (dom.userBubbleMaxWidthValue) {
        dom.userBubbleMaxWidthValue.textContent = `${maxWidth}%`;
    }
}

/**
 * 初始化气泡外观设置事件绑定
 */
export function setupBubbleSettingsEvents() {
    // 初始应用样式并同步 UI
    applyBubbleCustomStyles();
    updateBubbleSettingsUI();

    // 用户气泡颜色选择事件
    if (dom.userBubbleColorPicker) {
        dom.userBubbleColorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            if (!state.appSettings) state.appSettings = {};
            state.appSettings.customUserBubbleColor = color;
            if (dom.userBubbleColorPreviewText) {
                dom.userBubbleColorPreviewText.textContent = color.toUpperCase();
            }
            applyBubbleCustomStyles();
            saveAppSettings();
        });
    }

    // 恢复默认颜色
    if (dom.userBubbleColorResetBtn) {
        dom.userBubbleColorResetBtn.addEventListener('click', () => {
            if (state.appSettings) {
                delete state.appSettings.customUserBubbleColor;
            }
            applyBubbleCustomStyles();
            updateBubbleSettingsUI();
            saveAppSettings();
        });
    }

    // 气泡最大宽度滑动条变动事件
    if (dom.userBubbleMaxWidthSlider) {
        dom.userBubbleMaxWidthSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!state.appSettings) state.appSettings = {};
            state.appSettings.userBubbleMaxWidth = val;
            if (dom.userBubbleMaxWidthValue) {
                dom.userBubbleMaxWidthValue.textContent = `${val}%`;
            }
            applyBubbleCustomStyles();
            saveAppSettings();
        });
    }

    // 恢复默认宽度（100%）
    if (dom.userBubbleWidthResetBtn) {
        dom.userBubbleWidthResetBtn.addEventListener('click', () => {
            if (!state.appSettings) state.appSettings = {};
            state.appSettings.userBubbleMaxWidth = 100;
            if (dom.userBubbleMaxWidthSlider) {
                dom.userBubbleMaxWidthSlider.value = 100;
            }
            if (dom.userBubbleMaxWidthValue) {
                dom.userBubbleMaxWidthValue.textContent = '100%';
            }
            applyBubbleCustomStyles();
            saveAppSettings();
        });
    }
}
