# 智能摸鱼云同步服务 (Sync Server) — 各平台实战操作手册

> **定位**：轻量、自托管、端到端加密（E2EE）的跨设备会话快照同步后台。  
> **技术栈**：Go 1.22+、SQLite (无 CGO 纯 Go 驱动)、Argon2id、AES-256-GCM。  
> **原则**：**服务器零知识**。所有数据在客户端完成 AES-256 加密后再传输落盘，服务端无法解密或窥探任何聊天内容；采用**快照追加**机制，绝不覆盖或破坏已有会话。

---

## 📑 目录索引

1. [Windows 平台操作指南（适合个人电脑 / 局域网）](#一-windows-平台操作指南适合个人电脑--局域网)
2. [Linux 云服务器部署指南（适合公网 / 多设备随时互通）](#二-linux-云服务器部署指南适合公网--多设备随时互通)
3. [宝塔面板 / 1Panel 可视化部署指南](#三-宝塔面板--1panel-可视化部署指南)
4. [客户端使用教程（Web 端与手机 App）](#四-客户端使用教程web-端与手机-app)
5. [服务端高级管理 CLI 命令速查](#五-服务端高级管理-cli-命令速查)
6. [AI 接口后台任务中转与防断网服务 (AI Task Relay)](#六-ai-接口后台任务中转与防断网服务-ai-task-relay)
7. [配置文件详解 (`config.json`)](#七-配置文件详解-configjson)
8. [常见问题排查 (Q&A)](#八-常见问题排查-qa)

---

## 一、 Windows 平台操作指南（适合个人电脑 / 局域网）

在 Windows 电脑上，`sync-server/` 目录下已预置了 5 个双击即用的极简批处理脚本，**完全无需手动敲命令行**。

### 1. 快速启动与关闭
1. 打开 `sync-server/` 文件夹；
2. 双击运行 **`1-启动云同步服务.bat`**；
3. 会弹出一个黑色命令提示符窗口，显示：
   ```text
   智能摸鱼云同步服务正在启动...
   默认监听端口: 8443
   本地测试地址: http://127.0.0.1:8443
   ```
4. **保持黑窗口开启**，服务即正常运行；**关掉黑窗口**，服务即刻停止，零内存占用。

### 2. 生成注册邀请码
为了防止他人未经许可连接你的服务器，注册必须凭邀请码：
1. 双击运行 **`2-生成注册邀请码.bat`**；
2. 提示可输入备注（如“发给张三”，直接回车跳过）；
3. 控制台会吐出一个 32 位的一次性邀请码（默认有效期 7 天），例如：
   ```text
   成功生成邀请码 (有效期 7 天):
   >> d60f876cd80fe5e370d23e350080357d <<
   ```
4. 选中并按 `Ctrl + C` 复制，拿去前端网页端注册即可。

### 3. 查看邀请码使用情况
双击运行 **`3-查看邀请码列表.bat`**，即可直观查看所有邀请码的明文、备注说明、生成时间、有效期至、以及**是哪个具体账号注册使用了该邀请码**。

### 4. 用户综合管理控制台（超省心看板）
双击运行 **`5-用户管理与数据看板.bat`**，将弹出交互式菜单控制台：
- **查看用户数据看板**：一览所有用户的快照数、存留会话数、已用/总存储配额占比、授权设备数、注册时间；
- **管理员直接创建用户**：免邀请码，直接指定用户名与初始密码（自动派生端到端凭证）；
- **修改用户备注**：为指定用户添加部门、姓名或用途备注；
- **调整存储配额**：随时为特定用户扩容或限额；
- **一键解锁防爆破**：解除输错 5 次密码后的 15 分钟临时锁定；
- **重置密码与冻结**：重置密码并强制踢下线旧会话，或禁用违规用户；
- **清空数据与注销**：一键清空该用户的云端快照释放空间，或彻底销户。

### 5. 重新编译各平台包
如果修改了服务端代码，双击 **`4-一键编译多平台包.bat`**，即可一键在 `dist/` 目录下重新生成 Windows 和 Linux（x86/ARM）的独立单文件程序。

### 6. (可选) 安装为 Windows 后台开机自启服务
如果你想让它像系统服务一样在后台静默运行，无需保持黑窗口：
1. 访问 [WinSW 发布页面](https://github.com/winsw/winsw/releases) 下载 `WinSW-x64.exe`；
2. 将其重命名为 `winsw.exe` 并放置在 `sync-server/deploy/windows/` 目录下；
3. 将 `sync-server.exe` 复制到该目录下；
4. 右键管理员身份运行 **`安装为服务.bat`** 即可；卸载时右键运行 **`卸载服务.bat`**。

---

## 二、 Linux 云服务器部署指南（适合公网 / 多设备随时互通）

适合将服务挂在阿里云、腾讯云、搬瓦工等 VPS，配合自己的域名实现多端随时同步。

### 1. 上传可执行文件与准备目录
在 `sync-server/dist/` 中找到编译好的单文件：
- 普通 x86 服务器（Intel/AMD）：使用 `sync-server-linux-amd64`
- ARM 服务器（树莓派/甲骨文 ARM）：使用 `sync-server-linux-arm64`

上传到服务器的 `/opt/sync-server/` 目录：
```bash
# 创建服务目录并赋权
mkdir -p /opt/sync-server
cd /opt/sync-server

# 将上传的二进制重命名为 sync-server 并赋予执行权限
chmod +x sync-server

# 首次试运行（会自动在当前目录生成默认 config.json 和 data/ 数据库）
./sync-server serve
# 按 Ctrl + C 停止
```

### 2. 使用 Systemd 实现开机自启与后台守护
复制项目提供的 service 模板文件：
```bash
# 复制 systemd 描述文件
cp deploy/linux/sync-server.service /etc/systemd/system/

# 重载系统服务并设置开机自启
systemctl daemon-reload
systemctl enable --now sync-server

# 查看运行状态
systemctl status sync-server
```

### 3. 配置 HTTPS 反向代理（强烈推荐）

因为浏览器在公网 HTTPS 环境下会阻断未加密的 HTTP 请求，建议使用域名 + HTTPS 反代。

#### 方案 A：使用 Caddy（最简单，全自动申请 HTTPS 证书）
编辑 `/etc/caddy/Caddyfile`，写入：
```caddy
sync.yourdomain.com {
    reverse_proxy 127.0.0.1:8443 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
    # 允许上传大容量长会话快照 (如 100MB)
    request_body {
        max_size 100MB
    }
}
```
执行 `systemctl reload caddy` 即可完成部署！

#### 方案 B：使用 Nginx
在你的网站 server 配置块中添加：
```nginx
server {
    server_name sync.yourdomain.com;
    listen 443 ssl http2;
    
    # SSL 证书配置省略...
    
    client_max_body_size 100M; # 允许大快照上传

    location / {
        proxy_pass http://127.0.0.1:8443;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 核心抗弱网与抗断流优化 (允许内存缓冲与 100MB 磁盘溢出缓冲，透传 Range 断点续传)
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 16 1m;
        proxy_busy_buffers_size 2m;
        proxy_max_temp_file_size 100m;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
    }
}
```

### 4. Linux 下的用户管理与综合控制台 (极简数字菜单)

在 Linux 服务器上，不仅支持敲长命令，**还内置了一模一样的 123 极简纯数字交互式控制台**：
```bash
cd /opt/sync-server

# 方式一：直接敲命令（或者带 manage 参数）进入交互式控制台
./sync-server
# 或
./sync-server manage

# 方式二：也可以执行快捷脚本
./manage.sh
```
执行后屏幕会立刻弹出清晰的数字菜单，直接输入对应编号按回车即可：
- 输入 `1` 回车：查看所有用户数据统计看板（快照数、存留会话数、存储占用与百分比、状态）；
- 输入 `2` 回车：管理员免邀请码直接创建用户（指定账号密码与配额）；
- 输入 `3` 回车：修改用户备注；
- 输入 `4` 回车：调整存储配额；
- 输入 `5` 回车：解除防撞库锁定；
- 输入 `8` 回车：清空用户云端快照数据（重置云盘存储）；
- 输入 `9` 回车：彻底注销并删除用户；
- 输入 `10` 回车：生成新注册邀请码；
- 输入 `11` 回车：查看邀请码明细列表。

当然，如果你想编写自动化脚本，仍然可以使用原本的无交互命令行：
```bash
./sync-server invite create -days=30 -note="发给老李"
./sync-server user list
./sync-server user add testuser 123456 -quota=1024
```

---

## 三、 宝塔面板 / 1Panel 可视化部署指南

如果你习惯使用国内宝塔面板等可视化面板：

1. **新建网站/项目**：
   - 宝塔左侧点击【网站】->【Go 项目】（或【其他通用项目】）；
   - 项目路径选择 `/www/wwwroot/sync-server`；
   - 执行文件选择上传的 `sync-server-linux-amd64`（重命名为 `sync-server`）；
   - 执行参数填入：`serve -config=/www/wwwroot/sync-server/config.json`；
   - 端口填入 `8443`；
2. **配置域名与 SSL**：
   - 在宝塔该网站设置中绑定域名 `sync.yourdomain.com`；
   - 点击【SSL】一键申请 Let's Encrypt 证书；
   - 在【反向代理】中确认代理到 `http://127.0.0.1:8443`；
   - 在反代设置的高级参数中加上 `client_max_body_size 100m;` 避免大附件上传被拦截。
3. **在宝塔终端中生成邀请码**：
   - 点击宝塔右侧的【终端】，进入目录输入 `./sync-server invite create` 即可看到邀请码。

---

## 四、 客户端使用教程（Web 端与手机 App）

### 1. 连通性测试（Plan A 一体化状态机）
1. 打开智能摸鱼前端网页（双击 `启动智能摸鱼.bat`）；
2. 点击顶栏右上角新增的 **【云同步】** 图标（云朵形状）；
3. 在弹窗顶部的输入框中填入你的服务器地址：
   - **本机局域网测试**：填 `http://127.0.0.1:8443`
   - **云服务器域名**：填 `https://sync.yourdomain.com`
4. 点击右侧 **【⚡ 测试连接】**：
   - 绿灯亮起并提示 `服务正常在线 (v1.0.0)`，说明连接成功！
   - 若使用内网自签证书报证书错误，点击下方的“在新窗口打开此地址并信任证书”即可。

### 2. 账号注册与安全原则
1. 点击弹窗中的 **【凭邀请码注册】**；
2. 输入由服务端生成的 32 位邀请码；
3. 输入用户名（3~32 位字母/数字/下划线）和主密码（至少 6 位）；
4. 点击 **【注 册】**；
> ⚠️ **高危安全告示**：端到端加密服务对数据内容完全零知识，主密码同时用于派生 AES-256 加密密钥。**若主密码丢失，云端快照将永远无法解密恢复！** 请妥善保管主密码。

### 3. 上传与多设备下载追加
- **上传快照**：
  在【会话快照上传】面板中勾选需要备份的会话，点击【打包并加密上传】。数据在客户端加密为 RSYN 格式后落盘，过程带进度百分比提示。
- **跨设备追加会话**：
  在另一台电脑/手机上登录同一账号，切换到【云端快照时间线】，能看到包含会话标题和楼层数的快照记录，点击 **【追加此快照】**，选中的历史对话将以新标题（带同步时间戳）追加进本地，原本地会话完好无损！

### 4. 远程设备管理
切换到【设备与配额】面板：
- 实时查看个人存储配额占用比例进度条；
- 查看已授权设备列表（如：办公室笔记本、家用台式机）；
- 若设备丢失，可点击红色的 **【吊销】** 按钮远程踢下线。

---

## 五、 服务端高级管理 CLI 命令速查

在 `sync-server` 二进制所在目录直接执行：

| 功能模块 | 命令格式 | 说明 |
|---|---|---|
| **后台服务** | `./sync-server serve [-config=path]` | 默认读取 `config.json` |
| **生成邀请码** | `./sync-server invite create [-days=7] [-note="备注"]` | 支持指定天数与用途备注 |
| **邀请码列表** | `./sync-server invite list` | 查看邀请码明文、备注与使用账号 |
| **作废邀请码** | `./sync-server invite revoke <code>` | 作废指定的未使用的邀请码 |
| **用户数据看板** | `./sync-server user list` | 统计所有用户的快照数、会话数、存储占用、状态 |
| **直接建号** | `./sync-server user add <用户名> <密码> [-quota=500] [-note="备注"]` | 管理员免邀请码直接创建账号 |
| **修改备注** | `./sync-server user note <用户名> <备注内容>` | 为账号添加说明 |
| **调整配额** | `./sync-server user quota <用户名> <MB>` | 例如 `./sync-server user quota tom 1024` 设为 1GB |
| **一键解锁** | `./sync-server user unlock <用户名>` | 解除输错 5 次密码导致的防爆破锁定 |
| **重置密码** | `./sync-server user reset-pwd <用户名> <新密码>` | 重置密码并强制踢下线旧会话 |
| **清空快照** | `./sync-server user clear <用户名>` | 物理删除该用户所有云端备份文件，重置存储 |
| **删除用户** | `./sync-server user delete <用户名>` | 彻底销户并清除所有数据与授权 |
| **启/禁用户** | `./sync-server user disable/enable <用户名>` | 冻结或解冻指定用户 |

---

## 六、 AI 接口后台任务中转与防断网服务 (AI Task Relay)

长回复、深度长思考请求动辄耗时数分钟，移动端切后台、网络断流切换极易导致连接中断从而全盘作废。`sync-server` 原生提供了 **CatieCli 规范兼容的后台任务 API (`/v1/openai/tasks`)**。

### 1. 核心工作机制
- **秒级提交 (`POST /v1/openai/tasks`)**：客户端将标准的 `/v1/chat/completions` 请求体发送至该端点，服务端立即返回任务 ID (`task_id`)；
- **后台接力执行**：服务端在后台调用指定上游模型，默认以非流式模式安全获取大模型结果，不受客户端断网影响；
- **轮询查询 (`GET /v1/openai/tasks/{id}`)**：客户端按需轮询。断网重连后随时提取成果，支持 `?after=N` 分片增量续传；
- **自动物理清理**：默认保存 24 小时，最多保留 500 个请求（超限自动淘汰最老历史任务），空间零浪费。

### 2. 第三方生态无缝对接 (如 SillyTavern 酒馆)
- 安装 `st-catiecli-tasks` 扩展；
- API 选择 `Custom (OpenAI-compatible)`，端点填入你的 `http://IP:8443`；
- 填入对应上游密钥即可直接享受抗断网后台任务体验！

---

## 七、 配置文件详解 (`config.json`)

服务首次启动时会自动在工作目录生成 `config.json`，各项参数说明如下：

```json
{
  "listen": "0.0.0.0:8443",
  "tls": {
    "enabled": false,
    "certFile": "cert.pem",
    "keyFile": "key.pem"
  },
  "dataDir": "./data",
  "allowedOrigins": [
    "*"
  ],
  "rateLimit": {
    "requestsPerMinute": 60,
    "cooldownSeconds": 60
  },
  "maxSnapshotBytes": 52428800,
  "maxTotalStorageBytes": 1073741824,
  "defaultQuotaBytes": 209715200,
  "maxSnapshotsPerUser": 200,
  "kdfMinIter": 600000,
  "serverSecretFile": "./data/server.secret",
  "aiRelay": {
    "enabled": false,
    "defaultUpstream": "https://api.openai.com/v1",
    "maxTasks": 500,
    "ttlHours": 24,
    "forceNonStream": true,
    "timeoutMinutes": 30
  }
}
```

### 1. 字段详细说明

| 参数项 | 默认值 | 作用说明 | 是否支持热重载 |
|---|---|---|---|
| `listen` | `"0.0.0.0:8443"` | 监听地址与端口。前置有 Nginx/Caddy 反代时可绑定 `127.0.0.1:8443` | 需重启生效 |
| `tls.enabled` | `false` | 是否开启原生 TLS (HTTPS)。建议在内网使用或由外部反代处理 SSL | 需重启生效 |
| `dataDir` | `"./data"` | SQLite 数据库和快照二进制密文的本地持久化落盘目录 | 需重启生效 |
| `allowedOrigins` | `["*"]` | **跨域域名白名单**。配置 `"*"` 代表通配全放行（见下方详细说明） | **支持热重载** |
| `rateLimit.requestsPerMinute` | `60` | 单 IP 每分钟最高允许的请求次数，超频自动触发熔断限流 | **支持热重载** |
| `rateLimit.cooldownSeconds` | `60` | 触发熔断限流后的静默冷却秒数，超限时返回 `429` 与 `Retry-After` 标头 | **支持热重载** |
| `maxSnapshotBytes` | `52428800` | 单个快照数据包的体积上限（字节，默认 50MB） | **支持热重载** |
| `maxTotalStorageBytes` | `1073741824` | **全服最大总快照存储空间上限**（字节，默认 1GB，`<=0` 为不限制）。当全服所有会话快照总占用达到该限制时拒绝上传新快照 | **支持热重载** |
| `defaultQuotaBytes` | `209715200` | 新注册用户的默认个人存储配额上限（字节，默认 200MB） | 即时生效 |
| `maxSnapshotsPerUser` | `200` | 单个用户最多允许保存的历史快照版本总数（默认 200 个） | **支持热重载** |
| `kdfMinIter` | `600000` | 客户端 PBKDF2 密文派生迭代轮数的安全底线（默认 60 万次） | 即时生效 |
| `serverSecretFile` | `"./data/server.secret"` | 服务端伪 Salt 签发秘钥路径，防账号探测枚举 | 启动加载 |
| `aiRelay.enabled` | `false` | 是否开启 **AI 接口后台任务中转服务**（防断网防切后台） | **支持热重载** |
| `aiRelay.defaultUpstream` | `"https://api.openai.com/v1"` | 默认上游大模型基准地址（可通过请求头 `X-Target-Url` 动态覆盖） | **支持热重载** |
| `aiRelay.maxTasks` | `500` | **最多保存的任务记录数**（默认 500 个请求），超限自动 FIFO 淘汰 | **支持热重载** |
| `aiRelay.ttlHours` | `24` | **任务数据自动落盘保存时长**（小时，默认 24 小时），到期物理销毁 | **支持热重载** |
| `aiRelay.forceNonStream` | `true` | **是否默认/强制非流式转向上游**（简化存储与网络传输） | **支持热重载** |
| `aiRelay.timeoutMinutes` | `30` | 单个后台任务上游调用的最长等待超时（分钟，默认 30 分钟） | **支持热重载** |

---

### 2. 跨域 (`allowedOrigins`) 配置指南与通配规则

跨域（CORS）是浏览器为了保障网站安全而执行的同源策略。当你的前端网页与后端服务域名或端口不一致时生效：

#### ① 极简通配全放行模式（默认，小白最推荐）
```json
"allowedOrigins": [
  "*"
]
```
- **配置 `"*"` 的行为原理**：当配置为 `"*"` 时，服务端在收到任意请求时会自动**反射（Echo）请求方的真实 Origin**（返回 `Access-Control-Allow-Origin: <请求方的域名>`）；
- **适用场景**：无论是本地开发端口（如 `http://127.0.0.1:5500`、`http://localhost:3000`）、办公室局域网 IP（如 `http://192.168.1.100:8080`），还是外网手机移动端调试，均可直接通信，彻底免除繁琐的手动修改与端口纠结。

#### ② 生产环境严格域名白名单（适合面向公网暴露的云服务器）
如果你将同步服务暴露在公网上，并希望仅允许你自己的前端网页使用该后端接口，可配置精准域名数组：
```json
"allowedOrigins": [
  "https://chat.yourdomain.com",
  "https://ai-app.internal.corp:8443",
  "http://192.168.1.100:5500"
]
```
- **匹配规则**：必须严格包含协议（`http://` 或 `https://`）以及非标准端口；
- **防护效果**：任何不在白名单中的第三方恶意网站通过浏览器跨域访问时，均无法获取到正确的 CORS 响应头，浏览器会直接在前端阻断请求。

---

### 3. 配置文件 1 分钟监听动态热重载机制 (Config Hot-Reload)

为了让运维管理无需频繁重启服务、避免中断正在进行的多设备备份传输，`sync-server` 内置了纯标准库轻量轮询热重载机制：

1. **自动感知与生效周期**：
   - 服务在后台以 **每 1 分钟（60秒）** 一次的极低开销轮询检查 `config.json` 文件的修改时间（`mtime`）；
   - 当你在记事本或编辑器中修改 `config.json`（例如新增了一个允许跨域的域名，或者调整了限流阈值）并保存后，**后台将在 60 秒内自动检测并热加载生效**；
   - 服务控制台会实时输出热重载日志：
     ```text
     [ConfigWatcher] 检测到配置文件变动，已动态热重载新配置！(AllowedOrigins=[https://chat.example.com], RateLimit=120次/分, 熔断冷却=30秒)
     ```
2. **零重启、零连接中断**：
   - 跨域白名单、单 IP 限流阈值、快照体积上限与数量上限全部支持在运行中**毫秒级平滑热切换**；
   - 无需停止 Windows 批处理窗口或执行 `systemctl restart`，避免杀掉现有用户正在上传中的大文件长连接。
3. **内置半写与格式断损容错安全保护**：
   - 当用户在手动保存或通过 FTP 上传更新配置文件时，极易出现文本“只写了一半”或“不小心多打了一个逗号导致 JSON 语法报错”的情况；
   - `ConfigWatcher` 采用**沙盒反序列化校验机制**：每次解析失败时，后台会自动打印报警日志，并**安全维持上一版本的有效配置继续运行**，绝不会因配置文件语法错误搞崩甚至退出服务进程！

---

### 4. 服务端多重自愈熔断与安全防爆破体系

针对公网与局域网环境下的扫描探测、恶意暴力破解与资源耗尽攻击，`sync-server` 部署了 4 重防御机制：

1. **单 IP 滑动窗口限流与自愈熔断**：
   - 默认每个 IP 客户端每分钟最多允许 60 次 API 请求；
   - 一旦超出阈值，立即熔断阻断该 IP 请求并返回 `HTTP 429 Too Many Requests`；
   - 响应头自动携带 `Retry-After: <剩余冷却秒数>`，并在冷却时间到达后自动解除熔断自愈，无需管理员手动介入。
2. **Argon2id 算力防 OOM 内存炸弹**：
   - 针对登录认证中消耗内存的大算力 Argon2id 哈希计算，服务端内置了并发信号量限制（最大允许并发 2）；
   - 当攻击者试图通过高并发登录请求打爆服务器 CPU 和内存时，多余的哈希请求将以零 CPU 开销被快速拒绝，绝对保障服务稳定不被 OOM Kill。
3. **密码输错三阶渐进锁定（防在线撞库）**：
   - 连续输错 3 次密码：账号锁定 5 分钟；
   - 连续输错 5 次密码：账号锁定 15 分钟；
   - 连续输错 10 次密码：账号锁定 60 分钟；
   - 管理员亦可使用 `./sync-server user unlock <用户名>` 随时进行人工一键解锁。
4. **长事务与网络 I/O 彻底解耦**：
   - 上传大快照时，网络传输与数据落盘全程在无锁环境中进行；
   - 仅在密文 SHA-256 校验通过后，才开启持续时间小于 3 毫秒的极短 SQLite 事务，彻底杜绝数据库死锁与并发堵塞。

---

### 5. AI 接口后台任务中转系统 (AI Task Relay)

为了彻底解决移动端手机息屏切后台、Wi-Fi/移动数据切换导致长思考（o1/o3/DeepSeek R1）大模型长连接中断、回复内容直接报废的痛点，`sync-server` 原生集成了 **AI 任务化异步中转能力**：

1. **核心特性**：
   - **秒级提交 + 异步轮询**：`POST /v1/openai/tasks` 毫秒级返回 `id` 与 `task_id`，上游生成在服务端后台稳定长跑；
   - **断网自愈与增量续传**：`GET /v1/openai/tasks/{id}?after=N` 支持随时轮询，手机切后台 10 分钟切回依然能无损拿回完整回复；
   - **原生端到端中转兼容**：同时提供标准 `POST /v1/chat/completions`，支持各类原生客户端无缝接入；
   - **自动合成 SSE 分片**：开启 `forceNonStream` 模式时，服务端自动从完整响应中解析合成 SSE 分片与 `[DONE]`，流式客户端（如 SillyTavern + `st-catiecli-tasks`）绝不会因空分片而内容蒸发；
   - **自动生命周期管理**：默认 24 小时 TTL 自动物理销毁、默认最多 500 条先进先出淘汰（仅淘汰终态记录，保护运行中活跃任务）、服务重启死锁任务自动恢复；
   - **纯标准库 0 外部依赖**，支持 `config.json` 动态热重载。
2. **完整设计与接入文档**：请查阅 [`功能说明/功能说明-AI接口后台任务中转.md`](file:///e:/AI_WORK/ruthless-ai-assistant/%E5%8A%9F%E8%83%BD%E8%AF%B4%E6%98%8E/%E5%8A%9F%E8%83%BD%E8%AF%B4%E6%98%8E-AI%E6%8E%A5%E5%8F%A3%E5%90%8E%E5%8F%B0%E4%BB%BB%E5%8A%A1%E4%B8%AD%E8%BD%AC.md)。

---

## 八、 常见问题排查 (Q&A)

### Q1：前端点【测试连接】提示 `Failed to fetch` 或网络错误？
1. **检查服务是否启动**：Windows 确认黑窗口未关闭；Linux 执行 `systemctl status sync-server` 确认状态是 `active (running)`。
2. **检查防火墙与安全组**：云服务器控制台（如腾讯云/阿里云）安全组必须放行对应端口（如 `8443`，或者 443 端口）。
3. **混合内容拦截**：若前端网页是公网 HTTPS，后端地址不能直接写未加证书的 `http://`，会被浏览器安全机制阻断，必须配置域名 HTTPS 反代。
4. **自签名证书未信任**：内网环境自签的 CA 证书，请在前端弹窗提示里点击【在新窗口打开此地址】，在浏览器中点“高级”->“继续前往 (不安全)”，信任证书后再测即可成功。

### Q2：连续输错密码被锁定了怎么办？
为防止黑客在线撞库爆破，连续输错 5 次密码账号将锁定 15 分钟。等待 15 分钟后会自动解锁；或管理员可在数据库中手动清零该用户的 `failed_count` 和 `locked_until`。

### Q3：主密码忘了能否在服务器上重置？
**不能。** 这是端到端加密（E2EE）的基本物理属性。服务端只存 Argon2id 哈希和密文，没有明文密钥。如果密码忘了，任何人都无法解开云端的快照（但本地浏览器已有的历史会话不会受到任何影响）。
