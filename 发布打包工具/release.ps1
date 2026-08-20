# ============================================================
# Release Script - Cache Busting Tool (PowerShell Core)
# Update version query params on CSS/JS in index.html
# to force browser cache invalidation on new releases.
# ============================================================

param(
    [string]$NewVersion = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "无情AI助手 - 版本号递增与缓存更新工具"

$ErrorActionPreference = "Stop"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $toolDir) { $toolDir = (Get-Location).Path }
$projectRoot = (Resolve-Path "$toolDir\..").Path

$indexFile = "$projectRoot\index.html"
$sidebarFile = "$projectRoot\sidebar.html"

# --- Step 1: Check files exist ---
if (-not (Test-Path $indexFile)) {
    Write-Host "[ERROR] $indexFile not found!" -ForegroundColor Red
    exit 1
}

# --- Step 2: Read current version from <title> tag ---
$indexContent = [System.IO.File]::ReadAllText($indexFile, [System.Text.Encoding]::UTF8)
$currentVersion = "unknown"
if ($indexContent -match '\(v([^)]+)\)') {
    $currentVersion = $matches[1]
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "           Release Script - Cache Busting Tool"              -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "   当前版本: v$currentVersion" -ForegroundColor Yellow
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 3: Get new version from user ---
if ($NewVersion -eq "") {
    Write-Host -NoNewline ">>> 请输入新版本号 (例如 260814): " -ForegroundColor White
    $NewVersion = Read-Host
}

if ([string]::IsNullOrWhiteSpace($NewVersion)) {
    Write-Host "[ERROR] 版本号不能为空!" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

Write-Host ""
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "   版本预览:" -ForegroundColor White
Write-Host "   v$currentVersion  -->  v$NewVersion" -ForegroundColor Green
Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host -NoNewline ">>> 确认更新请输入 y (y/n): " -ForegroundColor White
$confirm = Read-Host
if ($confirm -notin @("y", "yes")) {
    Write-Host "[CANCELLED] 已取消更新。" -ForegroundColor Yellow
    Read-Host "按回车退出"
    exit 0
}

Write-Host ""
Write-Host "[WORKING] 正在更新静态资源版本号..." -ForegroundColor Cyan

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# --- Step 4: Process index.html ---
$indexContent = $indexContent -replace '(<title>智能摸鱼\s+\(v)[^)]+(\)</title>)', "`${1}$NewVersion`${2}"
$indexContent = $indexContent -replace '(href="[^"]+\.css)(\?v=[^"]*)?"', "`${1}?v=$NewVersion`""
$indexContent = $indexContent -replace '(src="[^"]+\.js)(\?v=[^"]*)?"', "`${1}?v=$NewVersion`""

[System.IO.File]::WriteAllText($indexFile, $indexContent, $utf8NoBom)
Write-Host "[OK] index.html - title、CSS、JS 版本参数已全部更新。" -ForegroundColor Green

# --- Step 5: Process sidebar.html ---
if (Test-Path $sidebarFile) {
    $sideContent = [System.IO.File]::ReadAllText($sidebarFile, [System.Text.Encoding]::UTF8)
    $sideContent = $sideContent -replace '(<h1>智能摸鱼\s+v)[0-9a-zA-Z._-]+(</h1>)', "`${1}$NewVersion`${2}"
    [System.IO.File]::WriteAllText($sidebarFile, $sideContent, $utf8NoBom)
    Write-Host "[OK] sidebar.html - 头部版本号已更新。" -ForegroundColor Green
} else {
    Write-Host "[SKIP] 未找到 sidebar.html。" -ForegroundColor Yellow
}

# --- Step 6: Summary ---
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   版本递增完成！" -ForegroundColor Green
Write-Host "   版本号: v$currentVersion --> v$NewVersion" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "按回车退出..."
$null = Read-Host
