@echo off
chcp 65001 >nul
title 智能摸鱼云同步服务 (运行中)
cd /d "%~dp0"

if exist "%~dp0sync-server-old.exe" del /f /q "%~dp0sync-server-old.exe" 2>nul

echo ====================================================
echo  智能摸鱼云同步服务正在启动...
echo  默认监听端口: 8443
echo  本地测试地址: http://127.0.0.1:8443
echo.
echo  [使用说明]
echo  1. 保持此黑色窗口开启，云同步服务即处于运行状态。
echo  2. 关掉此黑色窗口，云同步服务即刻停止，零资源占用。
echo ====================================================
echo.

"%~dp0sync-server.exe" serve
pause
