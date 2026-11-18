@echo off
chcp 936 >nul
echo ====================================================
echo  正在停止并卸载智能摸鱼云同步 Windows 系统服务...
echo ====================================================

cd /d "%~dp0"

if not exist "%~dp0winsw.exe" (
    echo [错误] 未找到 winsw.exe！
    pause
    exit /b 1
)

"%~dp0winsw.exe" stop "%~dp0sync-server.xml"
"%~dp0winsw.exe" uninstall "%~dp0sync-server.xml"

echo.
echo [完成] 服务已成功卸载。
pause
