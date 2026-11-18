@echo off
chcp 65001 >nul
title 一键交叉编译 Windows 与 Linux 跨平台包
cd /d "%~dp0"

echo ====================================================
echo  开始交叉编译 Windows 和 Linux 平台包...
echo ====================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"

echo.
pause
