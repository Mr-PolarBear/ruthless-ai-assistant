# ======================================================================
# 智能摸鱼 (Ruthless AI Assistant) - 本地服务启动器
# ======================================================================
# — 为什么这么写 —
# 1. 自动探测系统环境（优先调用高效的 http-server 或 Python，无依赖时原生兜底）；
# 2. 全网卡绑定 (0.0.0.0)：使 127.0.0.1、localhost 与本机局域网 IP (如 192.168.x.x) 均可畅通访问，方便手机和局域网多设备协同；
# 3. 原生兜底采用 TcpListener 而非 HttpListener：避免普通权限下绑定局域网 IP 时报“拒绝访问”；
# 4. 脚本强制以 UTF-8 with BOM 编码保存，避免 Windows PowerShell 5.1 误读乱码。
# ======================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - 本地服务控制台"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
Set-Location $scriptDir

# 探测本机所有有效局域网 IPv4 地址
$localIPs = @()
try {
    $localIPs = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | 
        Where-Object { 
            $_.AddressFamily -eq 'InterNetwork' -and 
            $_.IPAddressToString -ne '127.0.0.1' -and 
            -not $_.IPAddressToString.StartsWith('169.254.')
        } | 
        ForEach-Object { $_.IPAddressToString }
} catch {}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         🤖 智能摸鱼 (Ruthless AI Assistant) 本地服务启动中..." -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检测是否有全局 http-server
$hasHttpServer = (Get-Command http-server -ErrorAction SilentlyContinue)
if ($hasHttpServer) {
    Write-Host "[INFO] 检测到全局 http-server，正在启动服务 (监听全网卡 0.0.0.0)..." -ForegroundColor Green
    Write-Host ""
    Write-Host "  ✅ 本地访问地址:   http://127.0.0.1:8081/" -ForegroundColor Green
    foreach ($ip in $localIPs) {
        Write-Host "  🌐 局域网访问地址: http://$($ip):8081/" -ForegroundColor Cyan
    }
    Write-Host ""
    & http-server -a 0.0.0.0 -p 8081 -o -c-1
    exit 0
}

# 2. 检测是否有 Python
$hasPython = (Get-Command python -ErrorAction SilentlyContinue)
if ($hasPython) {
    Write-Host "[INFO] 检测到 Python 环境，正在启动 HTTP 服务 (监听全网卡 0.0.0.0)..." -ForegroundColor Green
    Write-Host ""
    Write-Host "  ✅ 本地访问地址:   http://127.0.0.1:8081/" -ForegroundColor Green
    foreach ($ip in $localIPs) {
        Write-Host "  🌐 局域网访问地址: http://$($ip):8081/" -ForegroundColor Cyan
    }
    Write-Host ""
    Start-Process "http://127.0.0.1:8081/"
    & python -m http.server 8081 --bind 0.0.0.0
    exit 0
}

# 3. 兜底方案：使用 Windows 原生自带的 PowerShell TcpListener 服务（免装任何依赖，支持局域网 IP）
Write-Host "[INFO] 正在启动系统原生轻量 HTTP 服务 (监听全网卡 0.0.0.0)..." -ForegroundColor Green

$port = 8081
$tcpListener = $null
$started = $false

# 端口探测与占用规避 (8081 - 8090)
for ($i = 0; $i -lt 10; $i++) {
    $testPort = $port + $i
    try {
        $tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $testPort)
        $tcpListener.Start()
        $port = $testPort
        $started = $true
        break
    } catch {
        # 端口被占用，尝试下一个端口
    }
}

if (-not $started) {
    Write-Host "[ERROR] 无法绑定可用端口（8081-8090 已全部被占用），请关闭占用程序后重试！" -ForegroundColor Red
    Read-Host "按回车退出..."
    exit 1
}

$localUrl = "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "  ✅ 本地访问地址:   $localUrl" -ForegroundColor Green
foreach ($ip in $localIPs) {
    Write-Host "  🌐 局域网访问地址: http://$($ip):$port/" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  📌 正在自动打开默认浏览器..." -ForegroundColor Gray
Write-Host "  💡 请保持此控制台窗口开启。如需退出请按 Ctrl+C 或直接关闭本窗口。" -ForegroundColor Yellow
Write-Host ""

Start-Process $localUrl

# MIME 映射表
$mimeTable = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.txt'  = 'text/plain; charset=utf-8'
    '.wasm' = 'application/wasm'
    '.map'  = 'application/json; charset=utf-8'
}

try {
    while ($true) {
        $client = $tcpListener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
        $reqLine = $reader.ReadLine()

        if ($reqLine) {
            $parts = $reqLine -split ' '
            $method = if ($parts.Length -ge 1) { $parts[0].ToUpper() } else { "GET" }
            $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }

            # OPTIONS 预检请求直接返回 204
            if ($method -eq "OPTIONS") {
                $header = "HTTP/1.1 204 No Content`r`n" +
                          "Access-Control-Allow-Origin: *`r`n" +
                          "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
                          "Access-Control-Allow-Headers: *`r`n" +
                          "Connection: close`r`n`r`n"
                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                $stream.Write($headerBytes, 0, $headerBytes.Length)
            } else {
                # 剥除 Query 参数与解码 URL 路径
                $cleanPath = $rawPath.Split('?')[0].TrimStart('/')
                if ([string]::IsNullOrEmpty($cleanPath)) {
                    $cleanPath = "index.html"
                }
                $cleanPath = [System.Uri]::UnescapeDataString($cleanPath).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                $filePath = Join-Path $scriptDir $cleanPath

                if (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $mime = if ($mimeTable.ContainsKey($ext)) { $mimeTable[$ext] } else { 'application/octet-stream' }
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)

                    # — 为什么这么写 —
                    # 1. 针对入口 HTML (index.html, sidebar.html 等) 及版本描述文件 version.json，必须强制下发严格防缓存头，
                    #    防止手机浏览器将其固化在本地 Disk Cache 中导致发版后刷新无效；
                    # 2. 普通静态资源 (JS/CSS/图片) 由于带有 ?v=版本号 query 参数，使用普通 no-cache 即可兼顾极速加载与版本穿透。
                    $cacheHeader = if ($ext -in @('.html', '.htm') -or $cleanPath.ToLower().EndsWith('version.json')) {
                        "Cache-Control: no-cache, no-store, must-revalidate, max-age=0`r`nPragma: no-cache`r`nExpires: 0`r`n"
                    } else {
                        "Cache-Control: no-cache`r`n"
                    }

                    $header = "HTTP/1.1 200 OK`r`n" +
                              "Content-Type: $mime`r`n" +
                              "Content-Length: $($bytes.Length)`r`n" +
                              "Access-Control-Allow-Origin: *`r`n" +
                              $cacheHeader +
                              "Connection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    if ($method -ne "HEAD") {
                        $stream.Write($bytes, 0, $bytes.Length)
                    }
                } else {
                    $notFoundBody = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $cleanPath")
                    $header = "HTTP/1.1 404 Not Found`r`n" +
                              "Content-Type: text/plain; charset=utf-8`r`n" +
                              "Content-Length: $($notFoundBody.Length)`r`n" +
                              "Connection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    if ($method -ne "HEAD") {
                        $stream.Write($notFoundBody, 0, $notFoundBody.Length)
                    }
                }
            }
        }
        $stream.Flush()
        $client.Close()
    }
} finally {
    if ($tcpListener) {
        $tcpListener.Stop()
    }
}