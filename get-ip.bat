@echo off
title Ruthless AI Assistant - IP Detector
color 0A
cls
echo ========================================
echo    Ruthless AI Assistant IP Detector
echo ========================================
echo.
echo [INFO] Current network interface IPs:
echo ------------------------
ipconfig | findstr IPv4
echo ------------------------
echo.
echo [USAGE]:
echo 1. Double-click 启动智能摸鱼.bat - Auto-detect and listen on all network interfaces (0.0.0.0)
echo 2. Access from this machine: http://127.0.0.1:8081/
echo 3. Access from LAN / Mobile: http://[Your-IP]:8081/
echo.
echo [TIP] 启动智能摸鱼.bat supports LAN and localhost access
echo ========================================
pause