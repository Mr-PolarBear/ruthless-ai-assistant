# ======================================================================
# 智能摸鱼 (Ruthless AI) - 手机端 APK 一键编译打包流水线
# ======================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "智能摸鱼 - 手机端 APK 一键打包工具"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         📱 智能摸鱼 (Ruthless AI) - 手机端 APK 一键打包流水线" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $toolDir) { $toolDir = (Get-Location).Path }
$projectRoot = (Resolve-Path "$toolDir\..").Path
$javaHome = if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\javac.exe")) { $env:JAVA_HOME } elseif (Test-Path "D:\work\Java\jdk-21\bin\javac.exe") { "D:\work\Java\jdk-21" } else { "" }
$androidSdk = if ($env:ANDROID_HOME -and (Test-Path "$env:ANDROID_HOME")) { $env:ANDROID_HOME } elseif (Test-Path "D:\work\Android_Sdk") { "D:\work\Android_Sdk" } else { "" }

# 1. 验证编译环境
if (-not $javaHome -or -not (Test-Path "$javaHome\bin\javac.exe")) {
    Write-Host "[❌ 错误] 未找到 JDK 21+ 编译器，请配置 JAVA_HOME 环境变量或安装到 D:\work\Java\jdk-21" -ForegroundColor Red
    exit 1
}

if (-not $androidSdk -or -not (Test-Path "$androidSdk")) {
    Write-Host "[❌ 错误] 未找到 Android SDK，请配置 ANDROID_HOME 环境变量或安装到 D:\work\Android_Sdk" -ForegroundColor Red
    exit 1
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdk
$env:Path = "$javaHome\bin;" + $env:Path

# 2. 准备 Capacitor 配置文件与静态资源
Set-Location $projectRoot
if (Test-Path "$toolDir\capacitor.config.json") {
    Copy-Item -Path "$toolDir\capacitor.config.json" -Destination "$projectRoot\capacitor.config.json" -Force
}

Write-Host "[1/3] 正在提取前端静态资源到 www 目录..." -ForegroundColor Green
node "$toolDir\sync-assets.js"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[❌ 错误] 静态资源同步失败！" -ForegroundColor Red
    exit 1
}

# 3. 同步到 Android 原生工程
Write-Host "[2/3] 正在同步资源到 Android 原生工程 (npx cap sync)..." -ForegroundColor Green
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "[❌ 错误] Capacitor 同步失败！" -ForegroundColor Red
    exit 1
}

# 4. Gradle 编译生成 APK
Write-Host "[3/3] 正在通过 Gradle 编译 Debug APK，请稍候..." -ForegroundColor Green
Set-Location "$projectRoot\android"
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) {
    Write-Host "[❌ 错误] Gradle APK 编译失败！" -ForegroundColor Red
    exit 1
}

# 5. 复制 APK 到根目录并展示详情
$srcApk = "$projectRoot\android\app\build\outputs\apk\debug\app-debug.apk"
$destApk = "$projectRoot\智能摸鱼.apk"

if (Test-Path $srcApk) {
    Copy-Item -Path $srcApk -Destination $destApk -Force
    $apkItem = Get-Item $destApk
    $apkSizeMB = [math]::Round($apkItem.Length / 1MB, 2)
    $apkTime = $apkItem.LastWriteTime.ToString("yyyy/MM/dd HH:mm:ss")

    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  🎉 APK 构建成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "  📌 根目录快捷安装包 : $destApk ($apkSizeMB MB)" -ForegroundColor Yellow
    Write-Host "  🕒 最新生成时间     : $apkTime" -ForegroundColor Gray
    Write-Host "  📦 原生工程路径     : $srcApk" -ForegroundColor Gray
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "提示：已将最新的安装包直接输出到项目根目录 [智能摸鱼.apk]，发送到手机安装即可！" -ForegroundColor Cyan
}

Set-Location $projectRoot
