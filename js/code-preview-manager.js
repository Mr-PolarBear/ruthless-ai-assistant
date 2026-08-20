/**
 * @file code-preview-manager.js
 * @description 管理代码预览侧边栏的显示、隐藏和内容渲染。
 */

import { dom } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1'; // 乌鸦：引入 state 以访问设置和状态
import { jsonToMarkdownTable } from './utils.js?v=260820-1';
// 乌鸦：引入增强器以复用点击处理逻辑
import CodeBlockEnhancer from './code-block-enhancer.js?v=260820-1';
// 乌鸦：引入事件总线
import { eventBus, EVENTS } from './services/event-bus.js?v=260820-1';

class CodePreviewManager {
    constructor() {
        this.sidebar = null;
        this.contentArea = null;
        this.closeBtn = null;
        this.statusElement = null; // 乌鸦：状态显示元素
        this.isActive = false;
        this.currentBlockId = null;
        // 乌鸦：新增观察器，用于监听原始代码块的变化
        this.observer = null;

        // 乌鸦：自动展开相关状态
        this.userInteracted = false; // 用户是否交互过（防打扰锁）
        this.lastStreamId = null;    // 上一次流式传输的ID

        // 乌鸦：抑制锁，用于在切换会话等操作时暂时禁用自动展开，防止“诈尸”
        this.isSuppressed = false;
        this.suppressTimer = null;

        // 乌鸦：用户手动关闭标记，用于防止自动重新弹出
        this.userManuallyClosed = false;

        // 乌鸦：输入区按钮折叠状态
        this._inputControlsCollapsed = false;

        // 注册全局事件监听
        this._bindGlobalEvents();
    }

    _bindGlobalEvents() {
        // 监听会话切换开始事件
        eventBus.on(EVENTS.CONVERSATION_SWITCH_START, () => {
            console.log('[CodePreviewManager] Detected conversation switch, closing sidebar and suppressing auto-expand.');
            this.close();
            this.suppress(800);
        });
    }

    /**
     * 暂时抑制自动展开功能
     * @param {number} duration - 抑制持续时间（毫秒），默认 500ms
     */
    suppress(duration = 500) {
        this.isSuppressed = true;
        if (this.suppressTimer) clearTimeout(this.suppressTimer);
        this.suppressTimer = setTimeout(() => {
            this.isSuppressed = false;
            this.suppressTimer = null;
        }, duration);
    }

    /**
     * 更新侧边栏状态提示
     * @param {string} text - 提示文本
     * @param {string} type - 类型 'active' | 'paused' | 'hidden'
     */
    updateStatus(text, type = 'active') {
        if (!this.statusElement) {
            this.statusElement = document.getElementById('preview-status');
        }
        if (!this.statusElement) return;

        // 乌鸦：使用 innerHTML 以支持按钮
        this.statusElement.innerHTML = '';
        const textNode = document.createTextNode(text);
        this.statusElement.appendChild(textNode);

        this.statusElement.style.opacity = '1';

        if (type === 'active') {
            this.statusElement.style.color = 'var(--accent-color, #4caf50)';
        } else if (type === 'paused') {
            this.statusElement.style.color = 'var(--warning-color, #ff9800)';

            // 乌鸦：添加恢复跟随按钮
            const resumeBtn = document.createElement('span');
            resumeBtn.innerHTML = ' <svg style="width:12px;height:12px;vertical-align:middle;margin-bottom:2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> 恢复跟随';
            resumeBtn.style.cursor = 'pointer';
            resumeBtn.style.marginLeft = '8px';
            resumeBtn.style.textDecoration = 'underline';
            resumeBtn.style.fontWeight = 'bold';
            resumeBtn.title = '点击重新启用自动滚动';
            resumeBtn.style.opacity = '0.9';

            resumeBtn.onmouseenter = () => resumeBtn.style.opacity = '1';
            resumeBtn.onmouseleave = () => resumeBtn.style.opacity = '0.9';

            resumeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation(); // 防止冒泡触发 sidebar 的交互监听
                this.resumeFollow();
            };

            this.statusElement.appendChild(resumeBtn);
        } else {
            this.statusElement.style.opacity = '0';
        }
    }

    /**
     * 恢复自动跟随模式
     */
    resumeFollow() {
        this.userInteracted = false;
        this.updateStatus('实时跟随模式', 'active');

        // 立即滚动到底部
        const target = this.getScrollTarget();
        if (target) {
            target.scrollTop = target.scrollHeight;
        }
    }

    /**
     * 获取当前的滚动目标元素
     * 乌鸦：CSS 修复后（.code-block-container 从 height:100% 改为 min-height:100%），
     * contentArea 是唯一的滚动容器（overflow-y: auto）。
     * 代码块容器会随内容自然增长，撑开 contentArea 的 scrollHeight。
     */
    getScrollTarget() {
        if (!this.contentArea) return null;
        return this.contentArea;
    }

    /**
     * 乌鸦：判断一个代码块容器是否为 MCP 工具调用类型
     * 用模糊匹配而非精确匹配，覆盖 tool / TOOL / tool_call 等各种变体
     * @param {HTMLElement} container - 代码块容器（.code-block-container 或包含 code 元素的父级）
     * @returns {boolean}
     */
    isToolCallBlock(container) {
        if (!container) return false;

        // 检查1：容器本身是 .tool-call-request-bar（已被转换为申请条）
        if (container.classList?.contains('tool-call-request-bar')) return true;

        // 检查2：code 元素的类名以 language-tool 开头
        const codeEl = container.querySelector('code');
        if (codeEl) {
            const classList = Array.from(codeEl.classList);
            if (classList.some(cls => cls.startsWith('language-tool'))) return true;
        }

        // 检查3：语言标签文本以 'tool' 开头（不区分大小写）
        const langTag = container.querySelector('.code-lang-tag');
        if (langTag) {
            const tagText = langTag.textContent.trim().toLowerCase();
            if (tagText.startsWith('tool')) return true;
        }

        // 检查4：代码内容本身包含 MCP 工具调用的 JSON 特征（"tool": 和 "parameters":)
        if (codeEl) {
            const text = codeEl.textContent || '';
            if (text.includes('"tool"') && text.includes('"parameters"')) return true;
        }

        return false;
    }

    init() {
        // 避免重复初始化
        if (this.sidebar) return;

        this.sidebar = document.getElementById('code-preview-sidebar');
        if (!this.sidebar) {
            console.warn('CodePreviewManager: 找不到 #code-preview-sidebar 元素');
            return;
        }

        this.contentArea = this.sidebar.querySelector('.code-preview-content');
        this.statusElement = document.getElementById('preview-status'); // 乌鸦：初始化状态元素

        // 乌鸦：设置 tabindex 允许元素获取焦点
        if (this.contentArea) {
            this.contentArea.tabIndex = -1;
        }

        // 乌鸦：监听用户交互以激活防打扰锁
        // 改为监听整个 sidebar，确保 Header 上的操作也能触发
        // 使用捕获阶段 (capture: true) 确保不被冒泡阻止
        const interactionEvents = ['mousedown', 'wheel', 'touchstart', 'keydown', 'click'];
        const handleInteraction = (evt) => {
            if (this.isActive) {
                // 乌鸦：排除"恢复跟随"按钮及其子元素的点击，防止点击恢复后又立刻被锁住
                // resumeFollow 的 onclick 虽然有 stopPropagation，但 capture 阶段监听器会先执行
                if (evt.target.closest('[title="点击重新启用自动滚动"]')) {
                    return; // 跳过，不触发防打扰锁
                }

                // 如果之前没交互过（状态改变时），或者只是重复确认
                if (!this.userInteracted) {
                    this.userInteracted = true;

                    const actionMap = {
                        'mousedown': '点击',
                        'click': '点击',
                        'wheel': '滚动',
                        'touchstart': '触摸',
                        'keydown': '按键'
                    };
                    const action = actionMap[evt.type] || '操作';

                    // 乌鸦：移除 isGeneratingResponse 限制，只要交互且锁定了，就立即反馈
                    // 这样可以避免状态文字与实际行为（已锁定）不一致
                    this.updateStatus(`你进行了${action}，已解除实时跟随`, 'paused');
                }
            }
        };

        interactionEvents.forEach(evt => {
            this.sidebar.addEventListener(evt, handleInteraction, { passive: true, capture: true });
        });

        // 乌鸦：绑定关闭按钮
        this.closeBtn = document.getElementById('close-preview-btn');
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                // 标记用户手动关闭
                this.userManuallyClosed = true;
                this.close();
            });
        }

        // 乌鸦：绑定滚动导航按钮 - 使用 getScrollTarget 获取真正的滚动容器
        const scrollTopBtn = document.getElementById('preview-scroll-top');
        const scrollBottomBtn = document.getElementById('preview-scroll-bottom');

        if (scrollTopBtn) {
            scrollTopBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = this.getScrollTarget();
                if (target) target.scrollTop = 0;
            });
        }

        if (scrollBottomBtn) {
            scrollBottomBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = this.getScrollTarget();
                if (target) target.scrollTop = target.scrollHeight;
            });
        }

        // 乌鸦：【修复】鼠标进入侧边栏时自动聚焦，解决滚动不跟手问题
        this.sidebar.addEventListener('mouseenter', () => {
            this.isHovering = true;
            if (this.contentArea && document.activeElement !== this.contentArea) {
                this.contentArea.focus({ preventScroll: true });
            }
        });

        this.sidebar.addEventListener('mouseleave', () => {
            this.isHovering = false;
        });

        // 乌鸦：绑定内容区的点击事件，代理给 CodeBlockEnhancer
        if (this.contentArea) {
            this.contentArea.addEventListener('click', (e) => {
                if (e.target.closest('.header-actions')) return; // 忽略 Header 点击

                const handler = CodeBlockEnhancer.createClickHandler();
                handler(e);
            });
        }

        // 乌鸦：初始化拖拽手柄，用于调整侧边栏宽度
        this._initResizeHandle();
    }

    /**
     * 乌鸦：初始化拖拽手柄，允许用户拖动侧边栏左边缘来调整宽度
     * 宽度范围：25%（四分之一）~ 65%（最大不超过三分之二）
     * 移动端不启用拖拽
     * @private
     */
    _initResizeHandle() {
        const handle = document.getElementById('preview-resize-handle');
        if (!handle) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        /**
         * 获取 #app 容器的总宽度，作为百分比计算基准
         * @returns {number} app 容器宽度（像素）
         */
        const getAppWidth = () => {
            const app = document.getElementById('app');
            return app ? app.offsetWidth : window.innerWidth;
        };

        /**
         * mousedown：开始拖拽
         */
        const onMouseDown = (e) => {
            // 移动端不启用拖拽
            if (window.innerWidth <= 768) return;
            // 只响应左键
            if (e.button !== 0) return;

            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            startX = e.clientX;
            startWidth = this.sidebar.offsetWidth;

            // 添加拖拽中的样式标记
            this.sidebar.classList.add('resizing');
            handle.classList.add('active');
            document.body.classList.add('resizing-preview');

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        /**
         * mousemove：拖拽中实时更新宽度
         * 向左拖 = 侧边栏变宽（因为手柄在左边缘，鼠标左移意味着占更多空间）
         * 向右拖 = 侧边栏变窄
         */
        const onMouseMove = (e) => {
            if (!isResizing) return;

            // 计算鼠标移动差值（向左为正 = 变宽）
            const dx = startX - e.clientX;
            const newWidth = startWidth + dx;
            const appWidth = getAppWidth();

            // 计算百分比并限制范围（25% ~ 65%）
            const minPercent = 25;
            const maxPercent = 65;
            let widthPercent = (newWidth / appWidth) * 100;
            widthPercent = Math.max(minPercent, Math.min(maxPercent, widthPercent));

            // 通过 CSS 变量动态设置宽度
            this.sidebar.style.setProperty('--preview-width', `${widthPercent}%`);
        };

        /**
         * mouseup：结束拖拽，清理状态
         */
        const onMouseUp = () => {
            if (!isResizing) return;
            isResizing = false;

            // 移除拖拽中的样式标记
            this.sidebar.classList.remove('resizing');
            handle.classList.remove('active');
            document.body.classList.remove('resizing-preview');

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        // 绑定 mousedown 到拖拽手柄
        handle.addEventListener('mousedown', onMouseDown);
    }

    /**
     * 尝试自动展开侧边栏（流式输出时调用）
     * @param {string} blockId - 代码块ID
     * @param {HTMLElement} container - 代码块容器
     * @param {boolean} isStreaming - 是否处于流式传输中
     */
    tryAutoExpand(blockId, container, isStreaming = false) {
        // 0. 终极防御：如果容器元素已经不在文档流中（例如切换会话被移除了），或者处于抑制状态，直接退出
        if (this.isSuppressed || !container || !container.isConnected) return;

        // 1. 检查开关
        if (!state.appSettings.autoExpandCode) return;

        // 乌鸦：检测是否是新的流式输出，如果是则重置用户手动关闭标记
        // 使用当前会话ID作为 streamId 的标识
        const currentConvId = state.currentConversationId;
        if (currentConvId && currentConvId !== this.lastStreamId) {
            this.lastStreamId = currentConvId;
            this.userManuallyClosed = false;
            console.log('[CodePreviewManager] New conversation stream detected, reset userManuallyClosed flag');
        }

        // 乌鸦：如果用户在此轮生成中手动关闭过预览窗，则不再自动弹出
        if (this.userManuallyClosed) {
            console.log('[CodePreviewManager] User manually closed preview, skipping auto-expand');
            return;
        }


        // 2. 检查是否为流式传输
        // 只有在流式传输过程中才允许自动展开，防止历史记录渲染时误触
        if (!isStreaming) return;

        // 3. 核心修复：检查当前会话是否正在生成内容
        if (!currentConvId) return;

        // 既然是 isStreaming，理论上肯定在生成，但为了双重保险，还是检查一下 state
        let isCurrentConvGenerating = false;
        if (state.generatingMessages) {
            const prefix = `${currentConvId}_`;
            for (const key in state.generatingMessages) {
                if (key.startsWith(prefix)) {
                    isCurrentConvGenerating = true;
                    break;
                }
            }
        }
        if (!isCurrentConvGenerating) return;

        // 4. 检查防打扰锁
        if (this.userInteracted) return;

        // 乌鸦：核心拦截 - 检测 MCP 工具调用类型（不展示在侧边栏）
        // 使用模糊匹配，覆盖 tool / TOOL / tool_call 等各种变体
        if (this.isToolCallBlock(container)) {
            // 如果当前侧边栏正显示这个块，但它变成了 tool_call，说明之前误判了，必须关闭
            if (this.isActive && this.currentBlockId === blockId) {
                console.log('[CodePreviewManager] Current block is a tool call, closing sidebar.');
                this.close();
            }
            return; // 拒绝展开
        }

        // 5. 检查是否需要重新渲染（例如：从非JSON变成了JSON）
        let forceRefresh = false;
        if (this.isActive && this.currentBlockId === blockId) {
            const originalCode = container.querySelector('code');
            const isNowJson = originalCode && (
                originalCode.classList.contains('language-json') ||
                container.querySelector('.code-lang-tag')?.textContent.toLowerCase() === 'json'
            );

            // 检查当前侧边栏里有没有 JSON 相关的 UI (例如表格切换按钮)
            const hasJsonUi = this.contentArea.querySelector('.json-table-view') ||
                this.contentArea.querySelector('.preview-html-btn');

            // 如果变成了 JSON 但界面上没有 JSON UI，强制刷新
            if (isNowJson && !hasJsonUi) {
                forceRefresh = true;
            }
        }

        // 5. 如果已经是当前块且侧边栏已打开，不需要重复打开（除非强制刷新）
        if (!forceRefresh && this.isActive && this.currentBlockId === blockId) return;

        // 6. 执行展开
        this.open(blockId, container);
    }

    /**
     * 打开侧边栏并显示指定代码块的内容
     * @param {string} blockId - 代码块的唯一ID
     * @param {HTMLElement} originalContainer - 原始的代码块容器元素
     */
    open(blockId, originalContainer) {
        if (!this.sidebar) this.init();
        if (!this.sidebar) return;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.currentBlockId = blockId;
        this.isActive = true;

        // 乌鸦：用户手动打开时重置手动关闭标记
        this.userManuallyClosed = false;

        const clone = originalContainer.cloneNode(true);

        // 乌鸦：tool-call-request-bar 中代码块在隐藏的 div 中，需要提取出来
        if (clone.classList.contains('tool-call-request-bar')) {
            const hiddenDiv = clone.querySelector('div[style*="display:none"]');
            if (hiddenDiv) {
                const preEl = hiddenDiv.querySelector('pre');
                if (preEl) {
                    // 用隐藏 div 中的代码块替换整个 clone 内容
                    clone.innerHTML = '';
                    // 包裹成标准的 code-block-container 结构
                    const wrapper = document.createElement('div');
                    wrapper.className = 'code-block-container';
                    const header = document.createElement('div');
                    header.className = 'code-block-header';
                    header.innerHTML = '<span class="code-lang-tag">TOOL_CALL (JSON)</span>';
                    wrapper.appendChild(header);
                    wrapper.appendChild(preEl);
                    clone.appendChild(wrapper);
                }
            }
        }

        const jsonTableContainer = clone.querySelector('.json-table-container');
        if (jsonTableContainer) {
            const innerCode = jsonTableContainer.querySelector('.code-view pre') ||
                jsonTableContainer.querySelector('pre') ||
                jsonTableContainer.querySelector('code');
            if (innerCode) {
                jsonTableContainer.replaceWith(innerCode);
            }
        }

        const codeElement = clone.querySelector('code');
        const isJson = codeElement && (
            codeElement.classList.contains('language-json') ||
            clone.querySelector('.code-lang-tag')?.textContent.toLowerCase() === 'json'
        );

        let updateTableCallback = null;

        if (isJson) {
            const actionsContainer = clone.querySelector('.code-block-actions');
            if (actionsContainer) {
                const toggleBtn = document.createElement('button');
                toggleBtn.textContent = '渲染表格';
                toggleBtn.className = 'preview-html-btn';
                toggleBtn.style.marginLeft = '8px';

                // 乌鸦：添加 markdown-body 类以复用全局表格样式
                const tableContainer = document.createElement('div');
                tableContainer.className = 'json-table-view markdown-body';
                tableContainer.style.display = 'none';
                tableContainer.style.marginTop = '10px';
                tableContainer.style.overflowX = 'auto';

                const preElement = clone.querySelector('pre');
                if (preElement) {
                    preElement.parentNode.insertBefore(tableContainer, preElement.nextSibling);
                }

                // 核心渲染逻辑
                const renderTable = () => {
                    try {
                        const jsonText = codeElement.textContent;
                        let textToParse = jsonText;
                        if (!textToParse.trim().endsWith(']') && textToParse.trim().startsWith('[')) {
                            // 简单的流式闭合尝试
                        }

                        const parsed = JSON.parse(textToParse);
                        if (Array.isArray(parsed)) {
                            const tableHtml = jsonToMarkdownTable(textToParse);
                            tableContainer.innerHTML = tableHtml || '<p style="color:var(--text-secondary)">等待数据完善...</p>';
                            return true;
                        }
                    } catch (e) {
                        if (!tableContainer.innerHTML) {
                            tableContainer.innerHTML = '<p style="color:var(--text-secondary)">接收数据中...</p>';
                        }
                    }
                    return false;
                };

                const switchToTable = () => {
                    renderTable();
                    tableContainer.style.display = 'block';
                    preElement.style.display = 'none';
                    toggleBtn.textContent = '显示代码';
                    toggleBtn.classList.add('active');
                };

                const switchToCode = () => {
                    tableContainer.style.display = 'none';
                    preElement.style.display = 'block';
                    toggleBtn.textContent = '渲染表格';
                    toggleBtn.classList.remove('active');
                };

                toggleBtn.addEventListener('click', () => {
                    if (tableContainer.style.display === 'none') {
                        switchToTable();
                    } else {
                        switchToCode();
                    }
                });

                actionsContainer.appendChild(toggleBtn);

                // 根据设置自动渲染
                if (state.appSettings.autoRenderTable) {
                    setTimeout(() => switchToTable(), 50);
                }

                // 注册回调
                updateTableCallback = () => {
                    if (tableContainer.style.display !== 'none') {
                        renderTable();
                    }
                };
            }
        }

        this.contentArea.innerHTML = '';
        this.contentArea.appendChild(clone);
        this.sidebar.classList.add('active');

        this._toggleInputControlsCollapsed(true);

        setTimeout(() => {
            if (this.contentArea) this.contentArea.focus({ preventScroll: true });
        }, 50);

        this.setupLiveSync(originalContainer, clone, updateTableCallback);
    }

    /**
     * 设置实时同步
     * @param {HTMLElement} original - 原始容器（Shadow DOM内）
     * @param {HTMLElement} clone - 克隆容器（侧边栏内）
     * @param {Function} [onContentUpdate] - 内容更新后的回调
     */
    setupLiveSync(original, clone, onContentUpdate) {
        const originalCode = original.querySelector('code');
        const cloneCode = clone.querySelector('code');

        if (!originalCode || !cloneCode) return;

        // 创建新的观察器
        this.observer = new MutationObserver(() => {
            // 乌鸦：首先检测是否突变成了 tool_call，如果是，立即关闭侧边栏并终止同步
            // 这种情况常见于流式输出初期未能识别语言，后来确定为 tool_call
            // 使用通用的 isToolCallBlock 方法，覆盖 tool / TOOL / tool_call 等变体
            if (this.isToolCallBlock(original)) {
                console.log('[CodePreviewManager] Detected mutation to tool call, closing sidebar.');
                this.close();
                return;
            }

            // 1. 同步内容
            let contentChanged = false;
            if (originalCode.innerHTML !== cloneCode.innerHTML) {
                cloneCode.innerHTML = originalCode.innerHTML;
                contentChanged = true;
            }

            // 乌鸦：独立同步类名（修复高亮延迟问题）
            if (originalCode.className !== cloneCode.className) {
                cloneCode.className = originalCode.className;
            }

            // 乌鸦：独立同步语言标签文字
            const originalLangTag = original.querySelector('.code-lang-tag');
            const cloneLangTag = clone.querySelector('.code-lang-tag');
            if (originalLangTag && cloneLangTag && originalLangTag.textContent !== cloneLangTag.textContent) {
                cloneLangTag.textContent = originalLangTag.textContent;
            }

            // 乌鸦：调用回调刷新衍生内容（如表格）
            if (contentChanged && onContentUpdate) onContentUpdate();

            // 2. 维护焦点
            if (this.isHovering) {
                this.contentArea.focus({ preventScroll: true });
            }

            // 3. 乌鸦：修复自动滚动脱轨 bug
            // 旧逻辑用 isNearBottom（300px 阈值）判断是否追底，但在高速内容更新时
            // 会出现"脱轨"：rAF 滚动还没执行，新 mutation 又来了，scrollHeight 增加，
            // 导致距离超过 300px，从此再也追不上。
            // 新逻辑：跟随模式（userInteracted === false）时无条件追底，
            // 用户交互后（userInteracted === true）完全不自动滚动
            if (!this.userInteracted) {
                requestAnimationFrame(() => {
                    const realTarget = this.getScrollTarget();
                    if (realTarget) {
                        realTarget.scrollTop = realTarget.scrollHeight;
                    }
                });
            }
        });

        // 监听原始 code 元素的变化
        this.observer.observe(originalCode, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true
        });
    }

    /**
     * 关闭侧边栏
     */
    close() {
        if (!this.sidebar) return;

        // 停止监听
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.sidebar.classList.remove('active');
        this.isActive = false;
        this.currentBlockId = null;

        // 乌鸦：关闭时恢复输入区按钮
        this._toggleInputControlsCollapsed(false);

        // 乌鸦：关闭时重置交互状态
        // 注意：不要重置 lastStreamId，否则无法区分是否是同一会话的关闭
        this.userInteracted = false;



        this.updateStatus('', 'hidden');

        setTimeout(() => {
            if (!this.isActive) {
                this.contentArea.innerHTML = '';
            }
        }, 300);
    }

    _toggleInputControlsCollapsed(collapsed) {
        if (this._inputControlsCollapsed === collapsed) return;

        const primary = document.getElementById('input-controls-primary');
        const secondary = document.getElementById('input-controls-secondary');

        if (!primary || !secondary) return;

        const elementsToMove = [
            'api-selector',
            'choose-db-btn',
            'choose-table-btn',
            'attachment-btn',
            'quick-prompt-wrapper',
            'mcp-tools-wrapper'
        ];

        const messageInput = document.getElementById('message-input');

        if (collapsed) {
            elementsToMove.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    secondary.appendChild(el);
                }
            });
            secondary.classList.add('visible');
        } else {
            elementsToMove.forEach(id => {
                const el = document.getElementById(id);
                if (el && messageInput) {
                    primary.insertBefore(el, messageInput);
                }
            });
            secondary.classList.remove('visible');
        }

        this._inputControlsCollapsed = collapsed;
    }

    toggle() {
        if (this.isActive) {
            this.close();
        } else {
            console.warn('CodePreviewManager: toggle called without context');
        }
    }
}

// 导出单例
export const codePreviewManager = new CodePreviewManager();