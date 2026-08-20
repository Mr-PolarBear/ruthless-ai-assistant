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

    // 乌鸦：提取相对路径（去掉域名部分和部署前缀）
    let relativePath = themePath;
    try {
        const url = new URL(themePath);
        relativePath = url.pathname.replace(/^\//, ''); // 去掉开头的斜杠
        // 乌鸦：去掉部署前缀，只保留 libs/xxx.css 这样的相对路径
        relativePath = relativePath.replace(/^[^/]+\/[^/]+\/[^/]+\//, '');
    } catch {
        // 如果不是有效 URL，直接使用原路径
    }

    // 乌鸦：如果主题没变，不需要更新
    if (relativePath === currentHljsThemePath && hljsStyleSheet) return;

    console.log(`乌鸦：更新 hljs 主题样式表: ${relativePath}`);

    const cssText = await loadCssText(relativePath);
    if (cssText) {
        if (!hljsStyleSheet) {
            hljsStyleSheet = new CSSStyleSheet();
        }
        await hljsStyleSheet.replace(cssText);
        currentHljsThemePath = relativePath;
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
