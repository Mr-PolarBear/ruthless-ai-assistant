@echo off
chcp 65001 >nul
title 打包 Linux 云服务器独立部署包

echo ====================================================
echo  正在打包智能摸鱼云同步服务 Linux 生产发布包...
echo ====================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-deploy.ps1"

if %ERRORLEVEL% equ 0 (
    echo.
    echo 打包完成！请将生成的 sync-server-linux-deploy.zip 上传至云服务器。
) else (
    echo.
    echo 错误：打包过程中出现异常，请检查上方日志。
)

echo.
pause
