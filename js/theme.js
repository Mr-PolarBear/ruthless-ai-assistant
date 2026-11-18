// 主题切换下拉框联动
// 支持 dark, light, green, gold, pink, blue, purple, orange, gray
const themeSelector = document.getElementById('theme-selector');

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    if (themeSelector) themeSelector.value = theme;
    // 记忆主题
    localStorage.setItem('app-theme', theme);
    // 高亮主题适配（自适应本地路径与公网 CDN 路径）
    const hljsTheme = document.getElementById('hljs-theme');
    if (hljsTheme) {
        const isLight = ["light", "gold", "pink", "orange", "gray"].includes(theme);
        const currentHref = hljsTheme.getAttribute('href') || '';
        const isCdn = currentHref.startsWith('http://') || currentHref.startsWith('https://') || currentHref.startsWith('//');

        if (isCdn) {
            // — 为什么这么写 —
            // 使用国内极速镜像 cdnjs.loli.net 替代海外的 cdnjs.cloudflare.com
            // 解决国内网络直连 Cloudflare 容易超时 (ERR_CONNECTION_TIMED_OUT) 导致样式或库加载失败的问题
            const cdnLight = 'https://cdnjs.loli.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css';
            const cdnDark = 'https://cdnjs.loli.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
            hljsTheme.setAttribute('href', isLight ? cdnLight : cdnDark);
        } else {
            hljsTheme.setAttribute('href', isLight ? './libs/atom-one-light.min.css' : './libs/atom-one-dark.min.css');
        }
    }
    // 乌鸦：发出主题变更通知，让其他模块有机会响应。
    // 这是修复Shadow DOM内部hljs主题不会自动更新的关键。
    document.body.dispatchEvent(new CustomEvent('theme-changed'));
}

if (themeSelector) {
    themeSelector.addEventListener('change', function() {
        setTheme(this.value);
    });
}
// 页面加载时自动同步下拉框，优先读取 localStorage
window.addEventListener('DOMContentLoaded', function() {
    const theme = localStorage.getItem('app-theme') || document.body.getAttribute('data-theme') || 'light';
    setTheme(theme);
});
