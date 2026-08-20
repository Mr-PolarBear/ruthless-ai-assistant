// 主题切换下拉框联动
// 支持 dark, light, green, gold, pink, blue, purple, orange, gray
const themeSelector = document.getElementById('theme-selector');

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    if (themeSelector) themeSelector.value = theme;
    // 记忆主题
    localStorage.setItem('app-theme', theme);
    // 高亮主题适配
    const hljsTheme = document.getElementById('hljs-theme');
    if (hljsTheme) {
        if (["light", "gold", "pink", "orange", "gray"].includes(theme)) {
            hljsTheme.setAttribute('href', './libs/atom-one-light.min.css');
        } else if (["blue", "purple", "green"].includes(theme)) {
            hljsTheme.setAttribute('href', './libs/atom-one-dark.min.css');
        } else {
            hljsTheme.setAttribute('href', './libs/atom-one-dark.min.css');
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
