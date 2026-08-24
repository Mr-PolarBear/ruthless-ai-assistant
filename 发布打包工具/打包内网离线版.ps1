# ======================================================================
# 智能摸鱼 (Ruthless AI) - 便捷内网离线发布压缩包打包工具 (无密码 / 零交互一键生成)
# ======================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - 便捷内网离线打包工具"

$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $toolDir) { $toolDir = (Get-Location).Path }
$projectRoot = (Resolve-Path "$toolDir\..").Path

# 直接以离线内网模式运行打包引擎（无需手动输入 1 或 2，无需密码）
& "$toolDir\打包内外网压缩包.ps1" -Mode offline

Write-Host ""
Write-Host "按回车键退出..." -ForegroundColor Gray
$null = Read-Host
