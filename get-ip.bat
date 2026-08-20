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
echo 1. Double-click start.bat - Auto-detect and use local IP
echo 2. start.bat [IP] - Use specified IP
echo    Example: start.bat 192.168.1.100
echo 3. start.bat localhost - Force localhost usage
echo.
echo [TIP] New start.bat supports auto IP detection
echo ========================================
pause