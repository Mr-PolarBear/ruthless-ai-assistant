# 智能摸鱼云同步服务多平台交叉编译脚本
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 自动探测并补齐绿色免安装 Go SDK 路径
if (-not (Get-Command "go" -ErrorAction SilentlyContinue)) {
    $fallbackGo = "C:\Users\31673\go_sdk\go\bin"
    if (Test-Path $fallbackGo) {
        $env:PATH = "$fallbackGo;" + $env:PATH
    }
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " 开始多平台交叉编译: sync-server" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$distDir = Join-Path $PSScriptRoot "dist"
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

$env:GOPROXY = "https://goproxy.cn,direct"
$env:CGO_ENABLED = "0"
$env:GOTOOLCHAIN = "local"

# 1. Windows amd64
Write-Host "[1/3] 正在编译 Windows amd64..." -ForegroundColor Yellow
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -ldflags="-s -w" -o (Join-Path $distDir "sync-server-windows-amd64.exe") ./cmd/server

# 2. Linux amd64
Write-Host "[2/3] 正在编译 Linux amd64..." -ForegroundColor Yellow
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -ldflags="-s -w" -o (Join-Path $distDir "sync-server-linux-amd64") ./cmd/server

# 3. Linux arm64
Write-Host "[3/3] 正在编译 Linux arm64..." -ForegroundColor Yellow
$env:GOOS = "linux"
$env:GOARCH = "arm64"
go build -ldflags="-s -w" -o (Join-Path $distDir "sync-server-linux-arm64") ./cmd/server

# 4. 同步更新根目录双击即用的 Windows 执行文件
try {
    Copy-Item (Join-Path $distDir "sync-server-windows-amd64.exe") (Join-Path $PSScriptRoot "sync-server.exe") -Force -ErrorAction Stop
} catch {
    Write-Host "[提示] 本地 sync-server.exe 正在运行中，已跳过覆盖根目录文件（dist 目录中的二进制文件已正常生成）。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " 编译完成！产物位于: $distDir 与 sync-server.exe" -ForegroundColor Green
Get-ChildItem $distDir | Format-Table Name, Length, LastWriteTime
Write-Host "====================================================" -ForegroundColor Green
