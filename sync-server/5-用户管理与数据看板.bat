@echo off
chcp 65001 >nul
title 智能摸鱼云同步服务 - 用户综合管理看板
cd /d "%~dp0"
"%~dp0sync-server.exe" manage
