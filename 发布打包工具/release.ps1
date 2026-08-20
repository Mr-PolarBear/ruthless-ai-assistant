# ======================================================================
# 智能摸鱼 (Ruthless AI Assistant) - 版本号递增与深度防缓存工具
# 作用：全量更新 HTML 模板、CSS、JS 以及所有 ES 模块依赖树中的版本号 query 参数
# 目的：确保发版后浏览器 100% 自动加载最新代码，彻底免除手动清除缓存
# ======================================================================

param(
    [string]$NewVersion = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - 版本号递增与防缓存更新工具"

$ErrorActionPreference = "Stop"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $toolDir) { $toolDir = (Get-Location).Path }
$projectRoot = (Resolve-Path "$toolDir\..").Path

$indexFile = Join-Path $projectRoot "index.html"
$sidebarFile = Join-Path $projectRoot "sidebar.html"
$drawFile = Join-Path $projectRoot "draw.html"
$jsDir = Join-Path $projectRoot "js"

# --- Step 1: 检查核心入口文件是否存在 ---
if (-not (Test-Path $indexFile)) {
    Write-Host "[ERROR] 未找到主入口文件: $indexFile" -ForegroundColor Red
    exit 1
}

# --- Step 2: 从 index.html 中读取当前版本号 ---
$indexContent = [System.IO.File]::ReadAllText($indexFile, [System.Text.Encoding]::UTF8)
$currentVersion = "unknown"
if ($indexContent -match '\(v([^)]+)\)') {
    $currentVersion = $matches[1]
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         🚀 智能摸鱼 (Ruthless AI) - 版本号递增与深度防缓存工具" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "   当前版本: v$currentVersion" -ForegroundColor Yellow
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 3: 获取新版本号并确认 ---
if ($NewVersion -eq "") {
    Write-Host -NoNewline ">>> 请输入新版本号 (例如 260821): " -ForegroundColor White
    $NewVersion = Read-Host
}

if ([string]::IsNullOrWhiteSpace($NewVersion)) {
    Write-Host "[ERROR] 版本号不能为空!" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

$NewVersion = $NewVersion.Trim()

Write-Host ""
Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "   版本变更预览:" -ForegroundColor White
Write-Host "   v$currentVersion  -->  v$NewVersion" -ForegroundColor Green
Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host -NoNewline ">>> 确认更新请输入 y (y/n): " -ForegroundColor White
$confirm = Read-Host
if ($confirm -notin @("y", "yes", "Y", "YES")) {
    Write-Host "[CANCELLED] 已取消更新。" -ForegroundColor Yellow
    Read-Host "按回车退出"
    exit 0
}

Write-Host ""
Write-Host "[WORKING] 正在全量更新静态资源与模块依赖版本号..." -ForegroundColor Cyan

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$updatedCount = 0

# --- Step 4: 处理 index.html ---
# 1. 标题
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, '<title>智能摸鱼\s+\(v[^)]+\)</title>', "<title>智能摸鱼 (v$NewVersion)</title>")
# 2. 图标
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, 'href="favorite\.ico(\?v=[^"]*)?"', "href=`"favorite.ico?v=$NewVersion`"")
# 3. 所有 CSS <link>
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, 'href="([^"]+?\.css)(\?v=[^"]*)?"', "href=`"`$1?v=$NewVersion`"")
# 4. 所有普通外部 JS <script>
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, 'src="([^"]+?\.js)(\?v=[^"]*)?"', "src=`"`$1?v=$NewVersion`"")
# 5. <script type="module"> 入口 import
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, "(import\s+[^;]+?\s+from\s+['""]\./js/main\.js)(?:\?v=[^'""]*)?(['""])", "`${1}?v=$NewVersion`${2}")
# 6. 动态拉取的 HTML 模板 fetch('sidebar.html') 和 fetch('modals.html')
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, "(fetch\(['""]sidebar\.html)(?:\?v=[^'""]*)?(['""]\))", "`${1}?v=$NewVersion`${2}")
$indexContent = [System.Text.RegularExpressions.Regex]::Replace($indexContent, "(fetch\(['""]modals\.html)(?:\?v=[^'""]*)?(['""]\))", "`${1}?v=$NewVersion`${2}")

[System.IO.File]::WriteAllText($indexFile, $indexContent, $utf8NoBom)
$updatedCount++
Write-Host "  ✅ [1/4] index.html - 标题、favicon、CSS、JS、ESM 入口及 HTML fetch 模板已全部更新。" -ForegroundColor Green

# --- Step 5: 处理 sidebar.html ---
if (Test-Path $sidebarFile) {
    $sideContent = [System.IO.File]::ReadAllText($sidebarFile, [System.Text.Encoding]::UTF8)
    $sideContent = [System.Text.RegularExpressions.Regex]::Replace($sideContent, '<h1>智能摸鱼\s+v[0-9a-zA-Z._-]+</h1>', "<h1>智能摸鱼 v$NewVersion</h1>")
    [System.IO.File]::WriteAllText($sidebarFile, $sideContent, $utf8NoBom)
    $updatedCount++
    Write-Host "  ✅ [2/4] sidebar.html - 头部版本号标题已更新。" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ [2/4] 未找到 sidebar.html (已跳过)。" -ForegroundColor Yellow
}

# --- Step 6: 处理 draw.html (独立的思维导图/流程图工具页面) ---
if (Test-Path $drawFile) {
    $drawContent = [System.IO.File]::ReadAllText($drawFile, [System.Text.Encoding]::UTF8)
    # 1. 脚本依赖
    $drawContent = [System.Text.RegularExpressions.Regex]::Replace($drawContent, 'src="([^"]+?\.js)(\?v=[^"]*)?"', "src=`"`$1?v=$NewVersion`"")
    # 2. 样式依赖
    $drawContent = [System.Text.RegularExpressions.Regex]::Replace($drawContent, 'href="([^"]+?\.css)(\?v=[^"]*)?"', "href=`"`$1?v=$NewVersion`"")
    # 3. @import url('...') 依赖
    $drawContent = [System.Text.RegularExpressions.Regex]::Replace($drawContent, "(@import\s+url\(['""]?[^'"")\s]+\.css)(?:\?v=[^'"")\s]*)?(['""]?\))", "`${1}?v=$NewVersion`${2}")
    [System.IO.File]::WriteAllText($drawFile, $drawContent, $utf8NoBom)
    $updatedCount++
    Write-Host "  ✅ [3/4] draw.html - 绘图工具页面依赖及 @import 版本号已全部更新。" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ [3/4] 未找到 draw.html (已跳过)。" -ForegroundColor Yellow
}

# --- Step 7: 深度递归扫描并更新 js/ 目录下所有原生 ES 模块依赖树 ---
Write-Host "  ⏳ [4/4] 正在扫描并更新 js/ 目录下所有 ES 模块依赖..." -ForegroundColor Cyan

$jsFilesUpdated = 0
$totalJsScanned = 0

if (Test-Path $jsDir) {
    $jsFiles = Get-ChildItem -Path $jsDir -Filter "*.js" -Recurse -File
    $totalJsScanned = $jsFiles.Count

    foreach ($file in $jsFiles) {
        $filePath = $file.FullName
        $content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)
        $originalContent = $content

        # 1. 静态 import / export from:
        # 匹配: from './xxx.js' / from '../xxx.js' / from './xxx.js?v=...'
        $content = [System.Text.RegularExpressions.Regex]::Replace(
            $content,
            "(from\s+['""])(\.{1,2}/[^'""]+?\.js)(?:\?v=[^'""]*)?(['""])",
            "`${1}`${2}?v=$NewVersion`${3}"
        )

        # 2. 单独副作用 import:
        # 匹配: import './xxx.js' / import '../xxx.js'
        $content = [System.Text.RegularExpressions.Regex]::Replace(
            $content,
            "(import\s+['""])(\.{1,2}/[^'""]+?\.js)(?:\?v=[^'""]*)?(['""])",
            "`${1}`${2}?v=$NewVersion`${3}"
        )

        # 3. 动态 import(...):
        # 匹配: import('./xxx.js') / import('../xxx.js')
        $content = [System.Text.RegularExpressions.Regex]::Replace(
            $content,
            "(import\s*\(\s*['""])(\.{1,2}/[^'""]+?\.js)(?:\?v=[^'""]*)?(['""]\s*\))",
            "`${1}`${2}?v=$NewVersion`${3}"
        )

        if ($content -ne $originalContent) {
            [System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)
            $jsFilesUpdated++
        }
    }

    $updatedCount += $jsFilesUpdated
    Write-Host "  ✅ [4/4] js/ 模块依赖处理完毕：共扫描 $totalJsScanned 个 JS 模块，精准更新 $jsFilesUpdated 个含有模块依赖的文件。" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ [4/4] 未找到 js 目录 (已跳过)。" -ForegroundColor Yellow
}

# --- Step 8: 总结 ---
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   🎉 版本递增与防缓存更新全部完成！" -ForegroundColor Green
Write-Host "   📌 版本号变更为 : v$currentVersion --> v$NewVersion" -ForegroundColor Yellow
Write-Host "   📁 累计更新文件 : 共更新 $updatedCount 个文件 (含 $jsFilesUpdated 个 JS 模块)" -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "按回车退出..."
$null = Read-Host


