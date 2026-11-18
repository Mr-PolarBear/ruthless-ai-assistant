#!/usr/bin/env bash
set -e

echo "===================================================="
echo " 开始多平台交叉编译: sync-server"
echo "===================================================="

DIST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

export CGO_ENABLED=0
export GOPROXY="https://goproxy.cn,direct"
export GOTOOLCHAIN="local"

echo "[1/3] 编译 Windows amd64..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$DIST_DIR/sync-server-windows-amd64.exe" ./cmd/server

echo "[2/3] 编译 Linux amd64..."
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "$DIST_DIR/sync-server-linux-amd64" ./cmd/server

echo "[3/3] 编译 Linux arm64..."
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o "$DIST_DIR/sync-server-linux-arm64" ./cmd/server

echo "===================================================="
echo " 交叉编译完成！输出文件如下:"
ls -lh "$DIST_DIR"
echo "===================================================="
