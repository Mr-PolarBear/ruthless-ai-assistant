@echo off
chcp 936 >nul
echo ====================================================
echo  正在将智能摸鱼云同步程序注册为 Windows 系统服务...
echo ====================================================

cd /d "%~dp0"

if not exist "%~dp0winsw.exe" (
    echo [提示] 未找到 WinSW 包装器程序 (winsw.exe)。
    echo 请先从 GitHub 下载 WinSW.exe 并放置在此目录下更名为 winsw.exe。
    echo 下载地址: https://github.com/winsw/winsw/releases
    pause
    exit /b 1
)

"%~dp0winsw.exe" install "%~dp0sync-server.xml"
if %errorlevel% neq 0 (
    echo [错误] 安装服务失败，请确保以管理员身份运行此批处理！
    pause
    exit /b 1
)

"%~dp0winsw.exe" start "%~dp0sync-server.xml"
echo.
echo ====================================================
echo  服务安装并启动成功！
echo  默认监听端口: 8443
echo ====================================================
pause
