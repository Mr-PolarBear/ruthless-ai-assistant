/**
 * @file share-card-manager.js
 * @description 专职负责将单条消息一键生成为高颜值长图/海报分享卡片，支持4种艺术主题实时切换、Retina 2x 高清 Canvas 离屏合成、一键复制到剪贴板与保存图片。
 * 
 * — 为什么独立解耦 —
 * 1. 痛点：传统截屏容易把杂乱的浏览器工具栏、滚动条、侧边栏一并截入，且代码块排版常被截断；
 * 2. 纯前端离线生成：完全基于 SVG foreignObject + HTML5 Canvas 本地合成，零第三方外网服务，100% 内网离线可用；
 * 3. 极速分享工作流：生成后支持一键 ClipboardItem 复制 PNG 字节流，微信/企业微信/飞书/钉钉直接 Ctrl+V 粘贴即可发送；
 * 4. 4 款现代卡片配色：极光暗夜、极简纯白、落霞暖彩、黑金极客，兼具办公严肃感与社交美观度。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

class ShareCardManager {
    constructor() {
        this.modalEl = null;
        this.previewTarget = null;
        this.currentMessage = null;
        this.currentTheme = 'aurora'; // 'aurora' | 'minimal' | 'sunset' | 'cyber'
        this._isInitialized = false;
        this.isExporting = false;
    }

    /**
     * 初始化模态弹窗 DOM
     */
    init() {
        if (this._isInitialized) return;
        this.createModalElement();
        this._isInitialized = true;
    }

    /**
     * 创建海报弹窗与预览容器
     */
    createModalElement() {
        if (document.getElementById('share-card-modal')) {
            this.modalEl = document.getElementById('share-card-modal');
            this.previewTarget = document.getElementById('share-card-preview-target');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'share-card-modal';
        modal.className = 'modal-overlay share-card-modal-overlay';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="modal-content share-card-modal-content">
                <div class="modal-header share-card-modal-header">
                    <div class="share-card-header-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span>生成精美分享长图</span>
                    </div>
                    <div class="share-card-theme-selector">
                        <span class="theme-label">风格：</span>
                        <button type="button" class="theme-chip active" data-theme="aurora">极光暗夜</button>
                        <button type="button" class="theme-chip" data-theme="minimal">极简纯白</button>
                        <button type="button" class="theme-chip" data-theme="sunset">落霞暖彩</button>
                        <button type="button" class="theme-chip" data-theme="cyber">黑金极客</button>
                    </div>
                    <button type="button" class="modal-close-btn share-card-close-btn" title="关闭">&times;</button>
                </div>

                <!-- 弹窗顶部定制配置栏 (Plan A) -->
                <div class="share-card-config-bar">
                    <div class="config-item title-config">
                        <span class="config-label">标题：</span>
                        <input type="text" id="share-card-title-input" class="share-card-title-input" placeholder="输入卡片展示标题..." maxlength="80">
                    </div>
                    <div class="config-item options-config">
                        <label class="config-checkbox-label" title="在卡片右上角显示生成时间">
                            <input type="checkbox" id="share-card-toggle-date" checked>
                            <span>显示时间</span>
                        </label>
                        <label class="config-checkbox-label" title="在卡片右上角显示消息楼层">
                            <input type="checkbox" id="share-card-toggle-floor" checked>
                            <span>显示楼层</span>
                        </label>
                    </div>
                </div>

                <div class="modal-body share-card-modal-body">
                    <div class="share-card-scroll-wrapper">
                        <!-- 真实被截图的卡片容器 -->
                        <div id="share-card-preview-target" class="share-card-canvas-target theme-aurora">
                            <div class="share-card-inner">
                                <div class="share-card-topbar">
                                    <div class="brand-left">
                                        <span class="brand-icon">⚡</span>
                                        <div class="brand-text">
                                            <div class="brand-title">Ruthless AI · 智能摸鱼</div>
                                            <div class="brand-sub" id="share-card-model-name">AI Assistant</div>
                                        </div>
                                    </div>
                                    <div class="brand-right">
                                        <div class="share-card-badges-row">
                                            <span class="share-card-floor-badge" id="share-card-floor-badge">第 1 楼</span>
                                            <span class="share-card-badge" id="share-card-role-badge">🤖 AI 助手</span>
                                        </div>
                                        <span class="share-card-date" id="share-card-date-text">2026-10-18</span>
                                    </div>
                                </div>

                                <div class="share-card-conv-title" id="share-card-conv-title">会话主题</div>

                                <div class="share-card-content" id="share-card-content-body">
                                    <!-- 消息格式化内容 -->
                                </div>

                                <div class="share-card-footer">
                                    <div class="footer-left">
                                        <span class="footer-watermark">由 智能摸鱼 (Ruthless AI) 导出</span>
                                    </div>
                                    <div class="footer-right">
                                        <span id="share-card-stat-text">字数统计</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="modal-actions share-card-modal-actions">
                    <button type="button" id="share-card-copy-btn" class="share-card-btn primary-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>复制图片到剪贴板</span>
                    </button>
                    <button type="button" id="share-card-download-btn" class="share-card-btn secondary-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        <span>保存高清图片</span>
                    </button>
                </div>

                <!-- 居中高斯模糊防重复点击 Loading 遮罩 -->
                <div id="share-card-loading" class="share-card-loading-overlay" style="display: none;">
                    <div class="share-card-loading-box">
                        <span class="share-card-spinner"></span>
                        <span id="share-card-loading-text">正在生成高清海报长图...</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modalEl = modal;
        this.previewTarget = modal.querySelector('#share-card-preview-target');

        this.bindModalEvents();
    }

    /**
     * 绑定弹窗事件
     */
    bindModalEvents() {
        if (!this.modalEl) return;

        const closeBtn = this.modalEl.querySelector('.share-card-close-btn');
        if (closeBtn) closeBtn.onclick = () => this.close();

        this.modalEl.onclick = (e) => {
            if (e.target === this.modalEl) this.close();
        };

        // 风格切换
        const chips = this.modalEl.querySelectorAll('.theme-chip');
        chips.forEach(chip => {
            chip.onclick = () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const theme = chip.dataset.theme;
                this.setTheme(theme);
            };
        });

        // 标题输入即时联动
        const titleInput = this.modalEl.querySelector('#share-card-title-input');
        const cardTitle = this.modalEl.querySelector('#share-card-conv-title');
        if (titleInput && cardTitle) {
            titleInput.oninput = () => {
                const val = titleInput.value.trim();
                if (val) {
                    cardTitle.textContent = val;
                    cardTitle.style.display = 'block';
                } else {
                    cardTitle.textContent = '';
                    cardTitle.style.display = 'none';
                }
            };
        }

        // 显示时间开关联动
        const toggleDate = this.modalEl.querySelector('#share-card-toggle-date');
        const dateText = this.modalEl.querySelector('#share-card-date-text');
        if (toggleDate && dateText) {
            toggleDate.onchange = () => {
                dateText.style.display = toggleDate.checked ? 'block' : 'none';
            };
        }

        // 显示楼层开关联动
        const toggleFloor = this.modalEl.querySelector('#share-card-toggle-floor');
        const floorBadge = this.modalEl.querySelector('#share-card-floor-badge');
        if (toggleFloor && floorBadge) {
            toggleFloor.onchange = () => {
                floorBadge.style.display = toggleFloor.checked ? 'inline-block' : 'none';
            };
        }

        // 复制到剪贴板
        const copyBtn = this.modalEl.querySelector('#share-card-copy-btn');
        if (copyBtn) {
            copyBtn.onclick = () => this.copyCardToClipboard();
        }

        // 保存图片
        const downloadBtn = this.modalEl.querySelector('#share-card-download-btn');
        if (downloadBtn) {
            downloadBtn.onclick = () => this.downloadCardImage();
        }
    }

    /**
     * 切换卡片艺术风格
     * @param {string} theme 'aurora' | 'minimal' | 'sunset' | 'cyber'
     */
    setTheme(theme) {
        if (!this.previewTarget) return;
        this.currentTheme = theme;
        this.previewTarget.className = `share-card-canvas-target theme-${theme}`;
    }

    /**
     * 打开海报生成弹窗并填充数据
     * @param {object} message 
     * @param {number} index 
     */
    async open(message, index) {
        if (!this._isInitialized) this.init();
        if (!message) return;

        this.currentMessage = message;
        const conv = state.conversations[state.currentConversationId];

        // 1. 填充标题与输入框（默认当前会话标题，支持用户自由即时修改）
        const convTitle = conv?.title || (index !== undefined ? `会话记录 · 第 ${index + 1} 楼` : '智能摸鱼分享卡片');
        const titleInput = this.modalEl.querySelector('#share-card-title-input');
        if (titleInput) {
            titleInput.value = convTitle;
        }

        const titleEl = this.modalEl.querySelector('#share-card-conv-title');
        if (titleEl) {
            titleEl.textContent = convTitle;
            titleEl.style.display = 'block';
        }

        // 2. 楼层徽章与开关初始化
        const floorBadge = this.modalEl.querySelector('#share-card-floor-badge');
        const toggleFloor = this.modalEl.querySelector('#share-card-toggle-floor');
        if (toggleFloor) toggleFloor.checked = true;
        if (floorBadge) {
            const floorText = index !== undefined ? `第 ${index + 1} 楼` : '';
            floorBadge.textContent = floorText;
            floorBadge.style.display = floorText ? 'inline-block' : 'none';
        }

        // 3. 生成时间文本与开关初始化
        const dateEl = this.modalEl.querySelector('#share-card-date-text');
        const toggleDate = this.modalEl.querySelector('#share-card-toggle-date');
        if (toggleDate) toggleDate.checked = true;
        if (dateEl) {
            const now = new Date();
            dateEl.textContent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            dateEl.style.display = 'block';
        }

        // 4. 模型名称与角色标签填充
        const modelEl = this.modalEl.querySelector('#share-card-model-name');
        if (modelEl) {
            const apiId = message.apiEndpointId || conv?.apiEndpointId || state.appSettings.activeApiEndpointId;
            const api = state.apiEndpoints[apiId];
            const modelName = message.model || conv?.model || api?.model || 'Ruthless Assistant';
            modelEl.textContent = modelName;
        }

        const roleBadge = this.modalEl.querySelector('#share-card-role-badge');
        if (roleBadge) {
            roleBadge.textContent = message.role === 'user' ? '👤 我的提问' : '🤖 AI 回答';
        }

        // 5. 提取并排版内容
        let rawContent = typeof message.content === 'string' ? message.content : (message.originalContent || '');
        if (Array.isArray(message.content)) {
            rawContent = message.content.map(p => p.text || (p.type === 'image_url' ? '[图片]' : '')).filter(Boolean).join('\n');
        }
        rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '')
                               .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                               .trim();

        const statEl = this.modalEl.querySelector('#share-card-stat-text');
        if (statEl) {
            statEl.textContent = `共 ${rawContent.length} 字 · 第 ${index + 1} 楼`;
        }

        const contentEl = this.modalEl.querySelector('#share-card-content-body');
        if (contentEl) {
            contentEl.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">正在排版卡片内容...</div>';
            try {
                // 使用 marked 将 markdown 转为 HTML
                let parsedHtml = '';
                if (window.marked) {
                    parsedHtml = window.marked.parse(rawContent);
                } else {
                    parsedHtml = `<pre style="white-space:pre-wrap;">${rawContent}</pre>`;
                }
                contentEl.innerHTML = parsedHtml;

                // 代码高亮
                if (window.hljs) {
                    contentEl.querySelectorAll('pre code').forEach((block) => {
                        window.hljs.highlightElement(block);
                    });
                }
            } catch (e) {
                console.error('排版卡片内容失败:', e);
                contentEl.innerHTML = `<p>${rawContent}</p>`;
            }
        }

        // 默认恢复 aurora 风格
        const defaultChip = this.modalEl.querySelector('.theme-chip[data-theme="aurora"]');
        if (defaultChip) {
            this.modalEl.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('active'));
            defaultChip.classList.add('active');
            this.setTheme('aurora');
        }

        this.modalEl.style.display = 'flex';
    }

    /**
     * 关闭弹窗
     */
    close() {
        if (this.modalEl) {
            this.modalEl.style.display = 'none';
        }
    }

    /**
     * 确保离线 html2canvas 库就绪
     * @returns {Promise<Function>}
     */
    async ensureHtml2Canvas() {
        if (typeof window.html2canvas === 'function') {
            return window.html2canvas;
        }

        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[src*="html2canvas"]');
            if (existingScript) {
                if (typeof window.html2canvas === 'function') {
                    resolve(window.html2canvas);
                    return;
                }
                existingScript.addEventListener('load', () => resolve(window.html2canvas));
                existingScript.addEventListener('error', () => reject(new Error('html2canvas 脚本载入失败')));
                return;
            }

            const script = document.createElement('script');
            script.src = './libs/html2canvas.min.js?v=temp';
            script.onload = () => resolve(window.html2canvas);
            script.onerror = () => reject(new Error('未找到 libs/html2canvas.min.js 离线库'));
            document.head.appendChild(script);
        });
    }

    /**
     * 核心合成引擎：调用纯前端离线 html2canvas 将卡片 DOM 节点以 2x 物理像素高清绘制并导出 Blob
     * — 为什么这么写 —
     * 1. 彻底根除 Chromium 内核下使用 SVG foreignObject 绘制到 Canvas 必定导致 Origin Clean 污染并抛出 Tainted Canvas 的历史通病；
     * 2. html2canvas 通过原生 JS 遍历 DOM 树与 CSS 盒模型直接用 Canvas 2D API 绘制，生成的 Canvas 100% clean，支持直接导出与剪贴板写入；
     * 3. 开启 scale: 2 支持 Retina 高清视网膜长图，关闭 logging，backgroundColor 设为 null 保留圆角与自定义渐变底色；
     * 4. 显式指定 scrollX: 0, scrollY: 0，避免外层弹窗滚动导致长图顶部出现空白位移截断。
     * @returns {Promise<Blob>}
     */
    async generateCardBlob() {
        if (!this.previewTarget) throw new Error('找不到卡片目标元素');

        const html2canvas = await this.ensureHtml2Canvas();
        const target = this.previewTarget;

        const canvas = await html2canvas(target, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            logging: false,
            scrollX: 0,
            scrollY: 0,
            windowWidth: document.documentElement.clientWidth,
            windowHeight: document.documentElement.clientHeight
        });

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Canvas toBlob 图片转换失败'));
                }
            }, 'image/png');
        });
    }

    /**
     * 显示导出 Loading 遮罩
     * @param {string} text - 提示文字
     */
    showLoading(text) {
        if (!this.modalEl) return;
        const loadingEl = this.modalEl.querySelector('#share-card-loading');
        const textEl = this.modalEl.querySelector('#share-card-loading-text');
        if (textEl && text) textEl.textContent = text;
        if (loadingEl) loadingEl.style.display = 'flex';

        const copyBtn = this.modalEl.querySelector('#share-card-copy-btn');
        const downloadBtn = this.modalEl.querySelector('#share-card-download-btn');
        if (copyBtn) copyBtn.disabled = true;
        if (downloadBtn) downloadBtn.disabled = true;
    }

    /**
     * 隐藏导出 Loading 遮罩
     */
    hideLoading() {
        if (!this.modalEl) return;
        const loadingEl = this.modalEl.querySelector('#share-card-loading');
        if (loadingEl) loadingEl.style.display = 'none';

        const copyBtn = this.modalEl.querySelector('#share-card-copy-btn');
        const downloadBtn = this.modalEl.querySelector('#share-card-download-btn');
        if (copyBtn) copyBtn.disabled = false;
        if (downloadBtn) downloadBtn.disabled = false;
    }

    /**
     * 复制高清卡片到剪贴板
     */
    async copyCardToClipboard() {
        if (this.isExporting) return;
        this.isExporting = true;
        this.showLoading('正在生成高清海报长图并写入剪贴板…');

        try {
            const blob = await this.generateCardBlob();
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                notify.success('🎉 海报长图已复制到剪贴板！可直接在微信/聊天软件中按 Ctrl+V 粘贴发送');
            } else {
                notify.warning('当前浏览器不支持直接写入图片剪贴板，请点击「保存高清图片」');
            }
        } catch (err) {
            console.error('复制卡片图片失败:', err);
            notify.error('复制卡片失败: ' + err.message);
        } finally {
            this.hideLoading();
            this.isExporting = false;
        }
    }

    /**
     * 下载高清卡片图片（使用安全 Blob 对象 URL 并在 40 秒后安全延迟回收）
     */
    async downloadCardImage() {
        if (this.isExporting) return;
        this.isExporting = true;
        this.showLoading('正在渲染全貌并保存高清图片…');

        try {
            const blob = await this.generateCardBlob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Ruthless_AI_分享卡片_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();

            // 延迟 40 秒回收，防止大体积高清长图在建立下载连接前 URL 被提前注销
            setTimeout(() => {
                if (a.parentNode) a.parentNode.removeChild(a);
                URL.revokeObjectURL(url);
            }, 40000);

            notify.success('🎉 海报长图已成功保存！');
        } catch (err) {
            console.error('导出卡片图片失败:', err);
            notify.error('导出卡片失败: ' + err.message);
        } finally {
            this.hideLoading();
            this.isExporting = false;
        }
    }
}

export const shareCardManager = new ShareCardManager();
