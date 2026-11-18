#!/usr/bin/env bash
# ==============================================================================
# 智能摸鱼云同步服务 (sync-server) - Linux 生产环境一键自动化安装与自愈脚本
# 特色：自动识别 CPU 架构 (amd64 / arm64)、自动配置 systemd 守护、自动健康检测与邀请码签发
# ==============================================================================

set -e

# 确保以 root 权限运行
if [ "$(id -u)" -ne 0 ]; then
    echo "❌ 错误: 本安装脚本需要 root 权限，请使用 sudo 或切换至 root 用户执行！"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 如果当前在 deploy/linux 子目录，则回退到服务根目录
if [ -f "$SCRIPT_DIR/../../dist/sync-server-linux-amd64" ]; then
    APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
elif [ -f "$SCRIPT_DIR/sync-server-linux-amd64" ]; then
    APP_DIR="$SCRIPT_DIR"
else
    APP_DIR="$SCRIPT_DIR"
fi

cd "$APP_DIR"
echo "=================================================================="
echo " 🚀 正在启动 智能摸鱼云同步服务 (sync-server) 自动化安装程序..."
echo " 📁 工作目录: $APP_DIR"
echo "=================================================================="

# 1. 自动检测主机 CPU 架构并匹配二进制文件
ARCH="$(uname -m)"
echo "🔍 检测系统架构: $ARCH"

TARGET_BIN=""
if [ "$ARCH" = "x86_64" ]; then
    if [ -f "$APP_DIR/sync-server-linux-amd64" ]; then
        TARGET_BIN="$APP_DIR/sync-server-linux-amd64"
    elif [ -f "$APP_DIR/dist/sync-server-linux-amd64" ]; then
        TARGET_BIN="$APP_DIR/dist/sync-server-linux-amd64"
    fi
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    if [ -f "$APP_DIR/sync-server-linux-arm64" ]; then
        TARGET_BIN="$APP_DIR/sync-server-linux-arm64"
    elif [ -f "$APP_DIR/dist/sync-server-linux-arm64" ]; then
        TARGET_BIN="$APP_DIR/dist/sync-server-linux-arm64"
    fi
fi

if [ -z "$TARGET_BIN" ] || [ ! -f "$TARGET_BIN" ]; then
    echo "❌ 错误: 未能在 $APP_DIR 中找到适配当前架构 ($ARCH) 的二进制文件！"
    echo "   请确认已上传包含对应平台文件的发布包。"
    exit 1
fi

echo "📦 匹配可执行程序: $TARGET_BIN"
chmod +x "$TARGET_BIN"
cp -f "$TARGET_BIN" "$APP_DIR/sync-server"
chmod +x "$APP_DIR/sync-server"

# 2. 检查并初始化生产配置文件
if [ ! -f "$APP_DIR/config.json" ]; then
    if [ -f "$APP_DIR/deploy/config.prod.json" ]; then
        echo "📝 未检测到 config.json，正在应用生产安全模板 (config.prod.json)..."
        cp -f "$APP_DIR/deploy/config.prod.json" "$APP_DIR/config.json"
    elif [ -f "$APP_DIR/config.prod.json" ]; then
        echo "📝 未检测到 config.json，正在应用生产安全模板..."
        cp -f "$APP_DIR/config.prod.json" "$APP_DIR/config.json"
    else
        echo "📝 未检测到 config.json，运行服务以生成默认配置..."
        "$APP_DIR/sync-server" serve &
        PID=$!
        sleep 2
        kill $PID 2>/dev/null || true
    fi
else
    echo "✅ 已存在 config.json，保留现有配置。"
fi

mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR/data"

# 3. 动态注册 Systemd 系统守护服务
SERVICE_FILE="/etc/systemd/system/sync-server.service"
echo "⚙️ 正在配置 Systemd 服务文件: $SERVICE_FILE"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Ruthless AI Assistant Sync Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/sync-server serve -config=$APP_DIR/config.json
Restart=always
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# 4. 重载并启动服务
echo "🔄 正在重载 systemd 并启动服务..."
systemctl daemon-reload
systemctl enable sync-server
systemctl restart sync-server

# 5. 服务健康连通性自检
echo "⏳ 正在检测服务健康状态..."
HEALTHY=0
for i in {1..10}; do
    if curl -fsSL http://127.0.0.1:8443/api/health >/dev/null 2>&1; then
        HEALTHY=1
        break
    fi
    sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
    echo "=================================================================="
    echo " 🎉 恭喜！智能摸鱼云同步服务已成功启动并保持后台自启守护！"
    echo " 🟢 本地健康状态: 正常在线 (http://127.0.0.1:8443)"
    echo " 📊 服务管理控制台命令: cd $APP_DIR && ./sync-server manage"
    echo "=================================================================="
    
    # 自动签发首个初始管理员邀请码
    echo ""
    echo "🔑 正在为您生成首个注册邀请码 (有效期 30 天)..."
    "$APP_DIR/sync-server" invite create -days=30 -note="首次安装默认邀请码" || true
    echo ""
    echo "👉 下一步：请配置 Nginx 反向代理将您的域名指向 127.0.0.1:8443 并配置 HTTPS。"
else
    echo "⚠️ 警告: 服务未能响应健康检查，请检查 systemctl status sync-server 获取详细报错！"
    systemctl status sync-server --no-pager
    exit 1
fi
