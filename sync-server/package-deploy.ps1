# 智能摸鱼云同步服务 Linux 部署包打包工具
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$distDir = Join-Path $PSScriptRoot "dist"
$tempDeployDir = Join-Path $PSScriptRoot "_deploy_package_temp"
$outputZip = Join-Path $PSScriptRoot "sync-server-linux-deploy.zip"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " 正在生成 Linux 云服务器轻量独立部署包..." -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 0. 自动调用编译脚本，确保 dist 目录下始终是最新的二进制产物
Write-Host "[0/6] 正在执行多平台源码编译 (确保产物最新)..." -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "build.ps1")
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
    throw "Go 编译失败，停止打包"
}

# 1. 清理旧临时文件与压缩包
if (Test-Path $tempDeployDir) {
    Remove-Item -Recurse -Force $tempDeployDir
}
if (Test-Path $outputZip) {
    Remove-Item -Force $outputZip
}

New-Item -ItemType Directory -Force -Path $tempDeployDir | Out-Null

# 2. 拷贝 Linux 二进制程序
Copy-Item (Join-Path $distDir "sync-server-linux-amd64") (Join-Path $tempDeployDir "sync-server-linux-amd64") -Force
Copy-Item (Join-Path $distDir "sync-server-linux-arm64") (Join-Path $tempDeployDir "sync-server-linux-arm64") -Force

# 3. 拷贝脚本并强制转换换行符为 LF
$installShText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "deploy\linux\install.sh")).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText((Join-Path $tempDeployDir "install.sh"), $installShText, [System.Text.UTF8Encoding]::new($false))

$manageShText = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "manage.sh")).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText((Join-Path $tempDeployDir "manage.sh"), $manageShText, [System.Text.UTF8Encoding]::new($false))

# 4. 拷贝配置模板与反向代理示例
Copy-Item (Join-Path $PSScriptRoot "deploy\config.prod.json") (Join-Path $tempDeployDir "config.prod.json") -Force
Copy-Item (Join-Path $PSScriptRoot "deploy\linux\nginx.conf.example") (Join-Path $tempDeployDir "nginx.conf.example") -Force
Copy-Item (Join-Path $PSScriptRoot "deploy\linux\Caddyfile.example") (Join-Path $tempDeployDir "Caddyfile.example") -Force

# 5. 拷贝 AI 部署指南
Copy-Item (Join-Path $PSScriptRoot "服务器AI部署指南.md") (Join-Path $tempDeployDir "服务器AI部署指南.md") -Force

# 6. 打包为 zip
Compress-Archive -Path "$tempDeployDir\*" -DestinationPath $outputZip -Force
Remove-Item -Recurse -Force $tempDeployDir

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " 打包成功！" -ForegroundColor Green
Write-Host " 产物路径: $outputZip" -ForegroundColor Green
$fileInfo = Get-Item $outputZip
Write-Host (" 文件体积: {0:N2} MB" -f ($fileInfo.Length / 1MB)) -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
