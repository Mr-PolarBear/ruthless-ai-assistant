
/**
 * @file appearance.js
 * @description 处理外观设置，如动态颜色主题，并进行持久化存储。
 */

const APPEARANCE_STORAGE_KEY = 'app_appearance_settings';

// 乌鸦：V2版新增，定义默认设置，作为恢复时的标准
const DEFAULT_APPEARANCE_SETTINGS = {
    '--quote-text-color': '#E18A24',
    '--quote-text-font-weight': 'normal',
    '--underline-color': '#BCE7CF',
    '--underline-text-font-weight': 'normal',
    '--italic-text-color': '#919191',
    '--italic-text-font-weight': 'normal',
};

/**
 * 保存当前的外观设置到 localStorage
 */
function saveAppearanceSettings() {
    const settings = {};
    // 保存颜色
    document.querySelectorAll('input[type="color"][data-variable]').forEach(picker => {
        settings[picker.dataset.variable] = picker.value;
    });
    // 保存粗体设置
    document.querySelectorAll('input[type="checkbox"][data-variable]').forEach(checkbox => {
        settings[checkbox.dataset.variable] = checkbox.checked ? 'bold' : 'normal';
    });
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 从 localStorage加载并应用保存的外观设置
 */
function loadAndApplyAppearanceSettings() {
    const savedSettings = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    const settings = savedSettings ? JSON.parse(savedSettings) : DEFAULT_APPEARANCE_SETTINGS;

    Object.keys(settings).forEach(variableName => {
        const value = settings[variableName];
        // 1. 应用CSS变量到文档根元素
        document.documentElement.style.setProperty(variableName, value);

        // 2. 更新设置弹窗中对应的UI
        const uiElement = document.querySelector(`[data-variable="${variableName}"]`);
        if (uiElement) {
            if (uiElement.type === 'color') {
                uiElement.value = value;
                const swatch = uiElement.nextElementSibling;
                if (swatch && swatch.classList.contains('color-swatch')) {
                    swatch.style.backgroundColor = value;
                }
            } else if (uiElement.type === 'checkbox') {
                uiElement.checked = value === 'bold';
            }
        }
    });
}

/**
 * 恢复默认设置
 */
function resetToDefault() {
    if (!confirm('确定要恢复所有外观设置为默认值吗？')) return;

    // 使用默认设置覆盖本地存储
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(DEFAULT_APPEARANCE_SETTINGS));
    // 重新加载并应用
    loadAndApplyAppearanceSettings();
}

/**
 * 初始化外观设置功能
 */
export function initializeAppearanceSettings() {
    // 1. 启动时，加载并应用已保存的颜色配置
    loadAndApplyAppearanceSettings();

    // 2. 为所有颜色选择器设置实时预览和事件监听
    document.querySelectorAll('input[type="color"][data-variable]').forEach(picker => {
        picker.addEventListener('input', (event) => {
            const variableName = event.target.dataset.variable;
            const value = event.target.value;
            
            document.documentElement.style.setProperty(variableName, value);
            const swatch = event.target.nextElementSibling;
            if (swatch && swatch.classList.contains('color-swatch')) {
                swatch.style.backgroundColor = value;
            }
            saveAppearanceSettings();
        });
    });

    // 3. 为所有粗体选择框设置事件监听
    document.querySelectorAll('input[type="checkbox"][data-variable]').forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            const variableName = event.target.dataset.variable;
            const value = event.target.checked ? 'bold' : 'normal';
            document.documentElement.style.setProperty(variableName, value);
            saveAppearanceSettings();
        });
    });

    // 4. 为恢复默认按钮设置事件监听
    const resetButton = document.getElementById('reset-appearance-btn');
    if (resetButton) {
        resetButton.addEventListener('click', resetToDefault);
    }
}
