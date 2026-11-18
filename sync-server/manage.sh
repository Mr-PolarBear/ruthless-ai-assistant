#!/usr/bin/env bash
# 智能摸鱼云同步服务 - Linux 综合管理控制台入口
cd "$(dirname "$0")"

if [ -f "./sync-server" ]; then
    chmod +x ./sync-server
    ./sync-server manage
elif [ -f "./sync-server-linux-amd64" ]; then
    chmod +x ./sync-server-linux-amd64
    ./sync-server-linux-amd64 manage
elif [ -f "./sync-server-linux-arm64" ]; then
    chmod +x ./sync-server-linux-arm64
    ./sync-server-linux-arm64 manage
else
    echo "未找到 sync-server 二进制文件，请确认当前目录下存在可执行程序。"
    exit 1
fi
