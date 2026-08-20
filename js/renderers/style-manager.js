/**
 * @file style-manager.js
 * @description Manages shared stylesheets and HLJS themes for Shadow DOM.
 */

// 乌鸦：Shadow DOM 共享样式表管理
// 目的：避免每个消息的 Shadow DOM 重复加载相同的 CSS 文件，减少内存占用和解析开销
// 原理：使用 adoptedStyleSheets API 共享 CSSStyleSheet 对象

/**
 * 共享样式表缓存
 * @type {Map<string, CSSStyleSheet>}
 */
const sharedStyleSheets = new Map();

/**
 * hljs 主题样式表（需要动态切换）
 * @type {CSSStyleSheet|null}
 */
let hljsStyleSheet = null;

/**
 * 当前 hljs 主题路径
 * @type {string}
 */
let currentHljsThemePath = '';

/**
 * 静态 CSS 文件列表（不需要动态切换）
 */
const STATIC_CSS_FILES = [
    'css/base.css',
    'css/theme.css',
    'css/chat.css',
    'css/components.css',
    'css/shadow-content.css',
    'css/appearance.css',
    'css/code-preview.css'
];

/**
 * Shadow DOM 内联样式（代码块容器等）
 */
const SHADOW_INLINE_STYLES = `
    :host { display: block; }
`;

/**
 * 内联样式表
 * @type {CSSStyleSheet|null}
 */
let inlineStyleSheet = null;

/**
 * 所有已创建的 Shadow DOM 引用（用于主题切换时更新）
 * @type {Set<ShadowRoot>}
 */
export const allShadowRoots = new Set();

/**
 * 加载 CSS 文件内容
 * @param {string} path - CSS 文件路径
 * @returns {Promise<string>} CSS 文本内容
 */
async function loadCssText(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return await response.text();
    } catch (e) {
        console.error(`乌鸦：加载 CSS 文件失败: ${path}`, e);
        return '';
    }
}

/**
 * 更新 hljs 主题样式表
 * @returns {Promise<void>}
 */
export async function updateHljsStyleSheet() {
    const hljsThemeLink = document.getElementById('hljs-theme');
    const themePath = hljsThemeLink?.href || './libs/atom-one-dark.min.css';

    // 乌鸦：如果主题没变，不需要重复更新
    if (themePath === currentHljsThemePath && hljsStyleSheet) return;

    console.log(`乌鸦：更新 hljs 主题样式表: ${themePath}`);

    const cssText = await loadCssText(themePath);
    if (cssText) {
        if (!hljsStyleSheet) {
            hljsStyleSheet = new CSSStyleSheet();
        }
        await hljsStyleSheet.replace(cssText);
        currentHljsThemePath = themePath;

        // 乌鸦：通知所有 Shadow DOM 更新样式表
        for (const shadowRoot of allShadowRoots) {
            try {
                // 重新组合样式表：静态样式 + 当前主题
                const staticSheets = STATIC_CSS_FILES.map(f => sharedStyleSheets.get(f)).filter(Boolean);
                const allSheets = [...staticSheets];
                if (inlineStyleSheet) allSheets.push(inlineStyleSheet);
                allSheets.push(hljsStyleSheet);
                shadowRoot.adoptedStyleSheets = allSheets;
            } catch (e) {
                console.warn('乌鸦：更新 Shadow DOM 样式表失败', e);
            }
        }
    }
}

/**
 * 初始化共享样式表
 * @returns {Promise<void>}
 */
export async function initSharedStyleSheets() {
    // 乌鸦：如果已经初始化过，直接返回
    if (sharedStyleSheets.size > 0) return;

    console.log('乌鸦：初始化 Shadow DOM 共享样式表...');

    // 乌鸦：并行加载所有静态 CSS 文件
    const loadPromises = STATIC_CSS_FILES.map(async (path) => {
        const cssText = await loadCssText(path);
        if (cssText) {
            const sheet = new CSSStyleSheet();
            await sheet.replace(cssText);
            sharedStyleSheets.set(path, sheet);
        }
    });

    await Promise.all(loadPromises);

    // 乌鸦：创建内联样式表
    inlineStyleSheet = new CSSStyleSheet();
    await inlineStyleSheet.replace(SHADOW_INLINE_STYLES);

    // 乌鸦：加载当前 hljs 主题
    await updateHljsStyleSheet();

    console.log(`乌鸦：共享样式表初始化完成，共 ${sharedStyleSheets.size + 2} 个样式表`);
}

/**
 * 获取所有共享样式表（用于 adoptedStyleSheets）
 * @returns {CSSStyleSheet[]} 样式表数组
 */
export function getSharedStyleSheets() {
    const sheets = Array.from(sharedStyleSheets.values());
    if (hljsStyleSheet) sheets.push(hljsStyleSheet);
    if (inlineStyleSheet) sheets.push(inlineStyleSheet);
    return sheets;
}

// 监听主题变化，更新所有 Shadow DOM 的 hljs 样式
document.body.addEventListener('theme-changed', async () => {
    console.log('乌鸦：检测到主题变化，更新 Shadow DOM hljs 样式...');
    await updateHljsStyleSheet();
    console.log(`乌鸦：hljs 主题已更新，影响 ${allShadowRoots.size} 个 Shadow DOM`);
});
