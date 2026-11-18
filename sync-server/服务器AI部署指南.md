# 智能摸鱼云同步服务 (sync-server) - 服务器端 AI 自动化部署与运维升级指南

> **适用对象**：正在此 Linux 服务器上执行终端指令的 AI 编程助手（如 Cursor、Claude Code、Aider、OpenHands 或 SSH Agent）以及运维开发人员。  
> **核心任务**：将当前目录下的云同步后端服务安装为 Systemd 系统守护进程，配置抗弱网高吞吐的 Nginx 反向代理与 SSL，执行平滑无损热升级，以及完成端到端冒烟验证。  
> **服务特性**：纯 Go 单文件无外部依赖（无 CGO、内置纯 Go SQLite 驱动，**无需在服务器安装 Go 环境**）。

---

## 🤖 AI 执行指令第一原则 (Rules for AI)

1. **零破坏性（数据与配置绝对安全）**：
   - 本服务默认将数据存储在 `./data/`（包括 `sync.db` 数据库与用户密文快照）；
   - 无论全新安装还是版本升级，**绝不能删除、覆盖或重置已有的 `data/` 目录与 `config.json` 配置文件**；
   - 内部固定绑定 `127.0.0.1:8443`，绝不干扰服务器上运行的其他网站或服务。
2. **架构自适应**：
   - 安装包已内置 `sync-server-linux-amd64` (Intel/AMD x86_64) 与 `sync-server-linux-arm64` (ARM 架构)；
   - `install.sh` 脚本会自动根据 `uname -m` 匹配并拷贝为 `sync-server`，无需手动重命名。
3. **安全底线（防伪造与限流穿透）**：
   - **绝对禁止公网直接暴露端口**：服务端必须且仅能监听 `127.0.0.1:8443`。
     > *原因：服务端为追求高并发与极致轻量，依赖反代传递的 `X-Real-IP` 进行 IP 限流与防爆破锁定；若直接将服务端口暴露在公网，攻击者可自行构造假 IP 请求头穿透限流！*
   - **反代强制覆写**：Nginx 配置中**必须**设置 `proxy_set_header X-Real-IP $remote_addr;`（强制使用真实底层连接 IP 覆写请求头，彻底消除伪造假 IP 风险）以及 `client_max_body_size 100M;`（防止快照上传被 Nginx 报 413 错误）。
4. **大文件缓冲优化（抗跨国高延迟与移动慢网核心铁律）**：
   - Nginx 反向代理中**必须**开启内存与磁盘缓冲，**严禁使用 `proxy_buffering off`**。
   - 开启缓冲能让 Go 后端在毫秒级将密文交付给 Nginx 内存，由 Nginx 的全速套接字向跨国移动端推送，彻底消灭每秒仅几 KB 的网络锁喉。
5. **Linux 内核网络加速（强烈推荐开启 BBR）**：
   - 针对海外 VPS 到国内移动蜂窝/Wi-Fi 的丢包问题，强烈建议开启 Google BBR 拥塞控制算法，可将高丢包下的吞吐提升 5~10 倍。

---

## 📋 步骤 1：确认前置参数

在开始执行配置前，AI 需确认以下两个参数（如果用户已提供则直接使用，否则简明询问用户）：
1. **服务拟使用的域名**（例如：`sync.mydomain.com`）；
2. **前端网页访问地址（CORS 白名单）**：
   - 若要绑定生产域名：**必须同时包含带 `www` 和不带 `www` 的形式**（例如：`["https://www.axureshow.com", "https://axureshow.com"]`）；
   - 若用户需要临时支持任意前端调试，可保留 `["*"]`。

---

## 🚀 步骤 2：全新安装底层服务（首次部署）

如果当前服务器是**首次部署**，在解压后的发布包目录中执行以下命令（需 root 权限）：

```bash
chmod +x install.sh
sudo ./install.sh
```

### 预期输出与校验：
- 脚本自动检测主机架构（如 `x86_64` 或 `aarch64`）；
- 自动生成 `config.json`（默认安全绑定 `127.0.0.1:8443`，配额 200MB）；
- 自动注册 `/etc/systemd/system/sync-server.service` 并通过 `systemctl enable --now` 启动；
- 自动进行本地健康检查；
- 自动签发并输出一个 **30 天有效期的初始管理员邀请码**。

若提示 `🟢 本地健康状态: 正常在线 (http://127.0.0.1:8443)`，说明后端服务已常驻运行！

---

## 🔄 步骤 2-ALT：已有服务平滑热升级（已有旧版本更新）

如果服务器上**已经运行了旧版本**，收到新的 `sync-server-linux-deploy.zip` 时，**请不要盲目重新运行完整 install.sh**，请按以下安全 3 步执行热更新（数据零丢失）：

```bash
# 假设当前在服务工作目录（如 /home/ubuntu/sync-server 或 /opt/sync-server）
APP_DIR="$(pwd)"

# 1. 停止当前服务守护
sudo systemctl stop sync-server

# 2. 解压新包并覆盖替换二进制文件（保留现有 config.json 与 data/ 目录完全不动）
unzip -o sync-server-linux-deploy.zip -d /tmp/sync_update_temp
ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ]; then
    sudo cp -f /tmp/sync_update_temp/sync-server-linux-amd64 "$APP_DIR/sync-server"
else
    sudo cp -f /tmp/sync_update_temp/sync-server-linux-arm64 "$APP_DIR/sync-server"
fi
sudo chmod +x "$APP_DIR/sync-server"
rm -rf /tmp/sync_update_temp

# 3. 重新启动服务并检查运行状态
sudo systemctl start sync-server
sudo systemctl status sync-server
```

---

## 🌐 步骤 3：配置 Nginx 反向代理与 HTTPS（抗弱网版）

将以下经过实战性能加固的标准 Nginx 配置部署至服务器：

### 3.1 配置文件标准模板 (`/etc/nginx/sites-available/sync-server.conf`)

```nginx
# 1. HTTP 80 端口强制重定向至 HTTPS 443
server {
    listen 80;
    listen [::]:80;
    server_name sync.yourdomain.com; # 替换为真实域名

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# 2. HTTPS 443 核心代理站点
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sync.yourdomain.com; # 替换为真实域名

    # SSL 证书配置 (Certbot 会自动填充或指定自有证书)
    ssl_certificate /etc/nginx/ssl/sync.yourdomain.com.crt;
    ssl_certificate_key /etc/nginx/ssl/sync.yourdomain.com.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # 1. 放开大快照上传限制 (防止 413 错误)
    client_max_body_size 100M;
    client_body_buffer_size 128k;

    # 2. 放宽长请求超时时间
    proxy_connect_timeout 60s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:8443;

        # 3. 穿透真实客户端 IP (防范 XFF 伪造绕过限流)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 4. 【核心抗弱网优化】开启大文件内存与磁盘溢出缓冲，解除慢速移动网络对 Go 服务的锁喉
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 16 1m;
        proxy_busy_buffers_size 2m;
        proxy_max_temp_file_size 100m; # 允许 100MB 磁盘溢出缓存，完全覆盖 50MB 快照上限

        # 5. 透传 HTTP Range 断点续传请求头 (RFC 7233)
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;

        proxy_http_version 1.1;
    }
}
```

### 3.2 替换域名并用 Certbot 申请证书
```bash
DOMAIN="你的实际域名" # 例如 sync.example.com
sed -i "s/sync.yourdomain.com/$DOMAIN/g" /etc/nginx/sites-available/sync-server.conf
sudo ln -sf /etc/nginx/sites-available/sync-server.conf /etc/nginx/sites-enabled/

# 自动配置免费 SSL 证书
sudo certbot --nginx -d $DOMAIN

# 语法测试与重载生效
sudo nginx -t
sudo systemctl reload nginx
```

---

## ⚡ 步骤 4：开启 Linux 内核 TCP BBR 加速（拯救境外 Wi-Fi 丢包）

境外海外 VPS 到国内存在较高的晚高峰丢包率。开启 Google BBR 算法可显著改善手机 Wi-Fi 与蜂窝网络的吞吐：

```bash
# 1. 运行时立即启用 BBR
sudo sysctl -w net.core.default_qdisc=fq
sudo sysctl -w net.ipv4.tcp_congestion_control=bbr

# 2. 写入 sysctl.conf 持久化（重启后依然生效）
echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf

# 3. 验证是否生效（若输出包含 bbr 即成功）
sysctl net.ipv4.tcp_congestion_control
```

---

## 📝 步骤 5：跨域白名单 (allowedOrigins) 正确配置示例

在 `config.json` 中配置允许访问该同步服务的前端网页地址。**服务端支持免重启 60 秒自动热重载生效**：

```json
{
  "listen": "127.0.0.1:8443",
  "allowedOrigins": [
    "https://www.axureshow.com",
    "https://axureshow.com",
    "https://www.axxiu.cn",
    "https://axxiu.cn"
  ],
  "maxSnapshotBytes": 52428800,
  "maxTotalStorageBytes": 1073741824,
  "defaultQuotaBytes": 209715200,
  "maxSnapshotsPerUser": 200,
  "kdfMinIter": 600000,
  "rateLimit": {
    "requestsPerMinute": 60,
    "cooldownSeconds": 60
  }
}
```

> [!TIP]
> **避坑铁律**：配置生产域名时，**必须把带 `www` 和不带 `www` 的根域名同时写上**！因为浏览器在不同输入习惯下的 `Origin` 是不同的字符串，服务端做的是严格精确比对。本地联调或临时测试可使用 `["*"]`。

---

## 🔍 步骤 6：端到端连通性冒烟测试

在服务器终端中直接运行以下测试，验证公网穿透与跨域头是否正确：

```bash
# 1. 验证健康检查接口
curl -fsSL https://$DOMAIN/api/health

# 2. 验证 OPTIONS 跨域与 Range 响应头透传
curl -I -X OPTIONS -H "Origin: https://www.axureshow.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range,Authorization" \
  https://$DOMAIN/api/snapshots/test
```

### 预期正确返回：
- 健康检查返回：`{"ok":true,"data":{"ok":true,"time":...}}`
- OPTIONS 返回 `HTTP/1.1 204 No Content`，且携带：
  - `Access-Control-Allow-Headers: ..., Range`
  - `Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length`

---

## 🛠️ 异常排错与自愈决策树 (Troubleshooting)

| 症状 / 报错 | 根本原因 | AI 自愈处理指令 |
|---|---|---|
| `502 Bad Gateway` | 后端服务未启动或 8443 端口冲突 | 执行 `sudo systemctl status sync-server`；执行 `journalctl -u sync-server -n 50 --no-pager` 查看具体报错。 |
| 手机端下载只有几 KB 或几分钟 | Nginx 开启了 `proxy_buffering off` 导致链路被跨国高延迟锁死 | 检查并确保配置了 `proxy_buffering on; proxy_buffers 16 1m; proxy_max_temp_file_size 100m;` 并执行 `sudo nginx -s reload`。 |
| 手机 Wi-Fi 严重慢于电脑端 | 境外线路晚高峰丢包导致 TCP 窗口坍塌 | 执行步骤 4 开启 Linux 内核 BBR 算法；检查手机浏览器是否强缓存了旧版前端（要求弹窗能显示实时网速和秒数倒计时）。 |
| `413 Request Entity Too Large` | Nginx 上传限制拦截了快照 | 在 Nginx server 块中加入 `client_max_body_size 100M;` 并重载 Nginx。 |
| `Failed to fetch` / 跨域拦截 | CORS 白名单未匹配当前网页域名 | 检查 `config.json` 的 `allowedOrigins`，补齐带与不带 `www` 的域名，等待 60 秒热重载生效。 |

---

## 📊 步骤 7：最终向用户汇报输出模板

部署或升级全部完成后，AI 请使用以下模板向大爷汇报：

```text
大爷，智能摸鱼云同步服务已成功完成部署/升级！

1. 服务后端状态：运行中（Systemd 守护，开机自启）
2. 架构版本：最新抗弱网 Range 分片与无损长流优化版 (MD5 校验一致)
3. 公网访问地址：https://<DOMAIN>
4. 初始管理员邀请码：<邀请码明文> (若为升级则沿用已有账号)
5. 运维管理方式：
   - 登录服务器执行：./sync-server manage （交互式中文数字看板）
   - 查看运行日志：journalctl -u sync-server -f

大爷现在可以在前端网页点击右上角【云同步】图标进行体验了！
```
