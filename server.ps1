# ======================================================================
# 智能摸鱼 (Ruthless AI Assistant) - 本地服务启动器
# ======================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - 本地服务控制台"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
Set-Location $scriptDir

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         🤖 智能摸鱼 (Ruthless AI Assistant) 本地服务启动中..." -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检测是否有全局 http-server
$hasHttpServer = (Get-Command http-server -ErrorAction SilentlyContinue)
if ($hasHttpServer) {
    Write-Host "[INFO] 检测到全局 http-server，正在启动服务..." -ForegroundColor Green
    & http-server -a 127.0.0.1 -p 8081 -o -c-1
    exit 0
}

# 2. 检测是否有 Python
$hasPython = (Get-Command python -ErrorAction SilentlyContinue)
if ($hasPython) {
    Write-Host "[INFO] 检测到 Python 环境，正在启动 HTTP 服务..." -ForegroundColor Green
    Start-Process "http://127.0.0.1:8081/"
    & python -m http.server 8081 --bind 127.0.0.1
    exit 0
}

# 3. 兜底方案：使用 Windows 原生自带的 PowerShell HttpListener 服务（免装任何依赖）
Write-Host "[INFO] 正在启动系统原生轻量 HTTP 服务..." -ForegroundColor Green

$port = 8081
$listener = New-Object System.Net.HttpListener
$started = $false

for ($i = 0; $i -lt 10; $i++) {
    $testPort = $port + $i
    $prefix = "http://127.0.0.1:$testPort/"
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add($prefix)
    try {
        $listener.Start()
        $port = $testPort
        $started = $true
        break
    } catch {
        # 端口被占用，尝试下一个
    }
}

if (-not $started) {
    Write-Host "[ERROR] 无法绑定可用端口（8081-8090 已全部被占用），请关闭占用程序后重试！" -ForegroundColor Red
    Read-Host "按回车退出..."
    exit 1
}

$url = "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "  ✅ 本地服务已就绪: $url" -ForegroundColor Green
Write-Host "  📌 正在自动打开默认浏览器..." -ForegroundColor Gray
Write-Host "  💡 请保持此控制台窗口开启。如需退出请按 Ctrl+C 或直接关闭本窗口。" -ForegroundColor Yellow
Write-Host ""

Start-Process $url

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.Headers.Add("Cache-Control", "no-cache")

        $rawPath = $req.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($rawPath)) {
            $rawPath = "index.html"
        }
        $rawPath = [System.Uri]::UnescapeDataString($rawPath)
        $filePath = Join-Path $scriptDir $rawPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = switch ($ext) {
                '.html' { 'text/html; charset=utf-8' }
                '.htm'  { 'text/html; charset=utf-8' }
                '.js'   { 'application/javascript; charset=utf-8' }
                '.mjs'  { 'application/javascript; charset=utf-8' }
                '.css'  { 'text/css; charset=utf-8' }
                '.json' { 'application/json; charset=utf-8' }
                '.png'  { 'image/png' }
                '.jpg'  { 'image/jpeg' }
                '.jpeg' { 'image/jpeg' }
                '.gif'  { 'image/gif' }
                '.svg'  { 'image/svg+xml' }
                '.ico'  { 'image/x-icon' }
                '.woff' { 'font/woff' }
                '.woff2'{ 'font/woff2' }
                '.ttf'  { 'font/ttf' }
                '.txt'  { 'text/plain; charset=utf-8' }
                default { 'application/octet-stream' }
            }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $mime
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $buf = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rawPath")
            $res.OutputStream.Write($buf, 0, $buf.Length)
        }
        $res.OutputStream.Close()
    }
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
