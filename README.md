# 智能摸鱼 (Ruthless AI Assistant)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **你的 AI，你做主。** 一款纯前端、纯本地、高度可定制的 AI 聊天工作台。

---

## 📖 项目简介

**智能摸鱼 (Ruthless AI Assistant)** 是一个运行在浏览器中的开源 AI 对话工作台(参考自SillyTavern)。它不依赖任何专有后端，所有数据（会话记录、API 密钥、角色配置、世界书知识库）均存储在浏览器本地（IndexedDB + LocalStorage）。

你可以将它连接到任何兼容 OpenAI 接口标准的 API（如 OpenAI、DeepSeek、Moonshot、智谱清言、Ollama、LocalAI、SiliconFlow 等），打造专属于你的私密、高效 AI 工作流。

 1.可以用做自己的知识库挂载助手。2.闲暇时刻可以与他进行角色扮演对话体验，放松一下996的人生。
---

## ✨ 核心亮点

- 🔒 **本地优先，隐私安全**：所有数据均在浏览器本地 IndexedDB 存储，绝不向第三方服务器上传聊天记录与配置，支持完全纯离线/内网部署。
- 🎨 **高度可定制 UI**：内置 9 套精美主题色系、深浅色模式自动适配，支持消息气泡样式、字体大小、代码主题自由微调。
- ⚡ **高性能渲染引擎**：Web Worker 独立线程异步解析 Markdown，配合智能滚动跟随与流式 SSE 逐字平滑输出。
- 🛠️ **全功能 MCP 工具箱**：可视化配置 HTTP API 工具调用（天气、新闻、网络抓取、藏头诗等），支持 ECharts 图表与 Mermaid 流程图结构化渲染。
- 🎭 **角色与世界书系统**：支持多 Prompt 角色随心切换，支持局部会话绑定备忘录（World Book）与无限长记忆动态注入。支持正则表达式进行输出替换。
- 🔄 **会话分支与历史管理**：支持从任意消息节点生成对话分支，支持楼层跳转、全文检索与消息智能摘要折叠。
- 📱 **多端支持**：原生支持 Windows 便捷服务脚本，同时支持 Capacitor 打包为 Android 移动端独立 App。

---

## 🚀 快速开始

### 方式一：双击启动（Windows 用户）

双击项目根目录下的 `启动智能摸鱼.bat` 或 `start.bat`，脚本将自动探测环境（Node.js / Python / PowerShell 原生服务）并在浏览器中打开。

### 方式二：使用任意静态 HTTP 服务器

```bash
# 1. 全局安装轻量级 HTTP 服务器（以 http-server 为例）
npm install -g http-server

# 2. 进入项目目录并启动服务
cd ruthless-ai-assistant
http-server -p 8081 -o
```

---

## ⚙️ 配置 API

1. 打开应用后，点击顶栏右上角的 **设置** 按钮（或齿轮图标）。
2. 在 **API 设置** 中添加你的 API 端点地址（Base URL）和 API Key。
3. 点击 **拉取模型** 获取模型列表，选择所需模型后即可开始畅聊。

---

## 📂 项目结构概览

```
ruthless-ai-assistant/
├── index.html              # 主界面入口框架
├── modals.html             # 弹窗模态框 HTML 模板集合
├── sidebar.html            # 侧边栏模板（历史记录、会话列表等）
├── draw.html               # 独立的绘图与流程图工作台（Mermaid + Vue 3）
├── css/                    # 模块化样式表（base, layout, theme, chat, mcp...）
├── js/                     # 核心业务逻辑模块
│   ├── main.js             # 应用启动入口
│   ├── state.js            # 全局状态管理
│   ├── renderer.js         # 渲染引擎调度器
│   ├── services/           # 外部通信层（llm-service, mcp-handler, file-parser...）
│   ├── renderers/          # Markdown、流式、代码块渲染子模块
│   ├── modals/             # 各弹窗业务逻辑
│   └── settings/           # 设置面板子模块
├── libs/                   # 本地化第三方依赖库（无需 CDN 即可离线运行）
├── mcp导入模板/             # 预置 MCP 工具配置模板
├── 预设角色导入包.json        # 预设 20+ 款常用角色配置
├── start.bat               # Windows 启动脚本
└── server.ps1              # 原生轻量 HTTP 服务脚本
```

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源，版权所有 (c) 2026 Mr-PolarBear。详情请参阅 [LICENSE](LICENSE) 文件。


github地址：https://github.com/Mr-PolarBear/ruthless-ai-assistant.git
gitee地址： https://gitee.com/Mr-PolarBear/ruthless-ai-assistant2026.git