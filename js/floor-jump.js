/**
 * @file floor-jump.js
 * @description 聊天楼层快速跳转模块 (v2.0 架构级健壮版)
 * 
 * 功能：在聊天界面右下角提供快速跳转按钮，
 * 点击后弹出楼层直达输入框与用户发言列表面板，点击或输入即可精准跳转至指定楼层。
 * 
 * 设计原则：
 * - 全面兼容单分支与多分支结构，精准识别当前激活分支
 * - 纯文本/多模态/复杂附件类型安全防御，杜绝抛错
 * - 与懒加载机制深度联动，跳转至未展开历史楼层时自动全量加载并定位
 * - 统一通过 regex.js 引入正则规则
 * - 导出 closeFloorJumpPanel() 支持切换会话/分支时自动清理
 */

import { state } from './state.js?v=260824';
import { dom } from './dom.js?v=260824';
import { scrollManager } from './scroll-manager.js?v=260824';
import { regexPatterns } from './regex.js?v=260824';
import { renderChatMessages } from './renderer.js?v=260824';

/**
 * 楼层快速跳转管理器
 */
class FloorJumpManager {
    constructor() {
        /** @type {HTMLElement|null} 触发按钮 */
        this.btn = null;
        /** @type {HTMLElement|null} 跳转面板 */
        this.panel = null;
        /** @type {boolean} 面板是否打开 */
        this.isOpen = false;
        /** @type {Function|null} 点击外部关闭的监听器引用 */
        this._outsideClickHandler = null;
        /** @type {boolean} 是否已初始化 */
        this._initialized = false;
    }

    /**
     * 初始化：绑定按钮事件、外部点击关闭与ESC按键
     */
    init() {
        this.btn = document.getElementById('jump-to-floor-btn');
        this.panel = document.getElementById('floor-jump-panel');

        if (!this.btn || !this.panel) {
            console.warn('[FloorJump] 找不到按钮或面板元素，跳过初始化');
            return;
        }

        // 防止多次重复绑定
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        // 使用 onclick 确保单处理程序，防止多次 listener 导致开闭状态互相颠倒
        this.btn.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        };

        // 点击面板外部关闭（排除按钮自身与面板内部区域）
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
        }
        this._outsideClickHandler = (e) => {
            if (!this.isOpen) return;
            if (this.btn && (this.btn === e.target || this.btn.contains(e.target))) return;
            if (this.panel && (this.panel === e.target || this.panel.contains(e.target))) return;
            this.close();
        };
        document.addEventListener('click', this._outsideClickHandler);

        // ESC 快捷键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        // 挂载全局引用方便调试与外部调度
        window.floorJumpManager = this;
    }

    /**
     * 打开面板：构建列表并显示
     */
    open() {
        if (!this.panel) {
            this.panel = document.getElementById('floor-jump-panel');
        }
        if (!this.panel) return;

        try {
            // 构建列表内容
            this._buildList();

            // 双重确保面板可见
            this.panel.style.display = 'flex';
            this.panel.classList.add('active');
            this.isOpen = true;

            // 滚动到当前可见区域附近的楼层
            this._scrollToCurrentFloor();

            // 自动聚焦直达输入框
            const quickInput = this.panel.querySelector('.floor-jump-input');
            if (quickInput) {
                setTimeout(() => quickInput.focus(), 120);
            }
        } catch (error) {
            console.error('[FloorJump] 打开楼层跳转面板失败:', error);
        }
    }

    /**
     * 关闭面板
     */
    close() {
        if (!this.panel) {
            this.panel = document.getElementById('floor-jump-panel');
        }
        if (!this.panel) return;
        this.panel.classList.remove('active');
        this.panel.style.display = 'none';
        this.isOpen = false;
    }

    /**
     * 安全提取消息预览纯文本
     * 兼容字符串、多模态数组、图片、附件对象等复杂格式
     * @param {Object} msg - 消息对象
     * @returns {string} 提取后的单行文本预览
     * @private
     */
    _extractSafePreview(msg) {
        if (!msg) return '[空消息]';

        let text = '';
        const content = msg.content;

        if (typeof content === 'string') {
            text = content;
        } else if (Array.isArray(content)) {
            text = content.map(part => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                if (part.type === 'text') return part.text || '';
                if (part.type === 'image_url') return '[图片]';
                if (part.type === 'input_audio') return '[语音]';
                if (part.type === 'file') return '[文件]';
                return '';
            }).filter(Boolean).join(' ');
        } else if (content && typeof content === 'object') {
            text = content.text || '';
        }

        if (!text) {
            if (msg.attachment || (msg.attachments && msg.attachments.length > 0)) {
                text = '[附件消息]';
            } else {
                text = '[无文字内容]';
            }
        }

        // 针对 AI 消息：剥离 <think>...</think> 思考标签，优先获取回答正文
        if (msg.role !== 'user' && typeof text === 'string') {
            let textWithoutThink = text.replace(regexPatterns.thinkTag, '').trim();
            if (textWithoutThink.includes('<think>') || textWithoutThink.includes('<thinking>')) {
                const parts = textWithoutThink.split(/<\/(?:think|thinking)>/i);
                if (parts.length > 1) {
                    textWithoutThink = parts.slice(1).join(' ').trim();
                } else {
                    textWithoutThink = '';
                }
            }

            if (textWithoutThink) {
                text = textWithoutThink;
            } else {
                const cleanThink = text.replace(/<\/?(?:think|thinking)\b[^>]*>/gi, '').trim();
                text = cleanThink ? `[思考] ${cleanThink}` : '[无正文]';
            }
        }

        // 使用集中管理的正则压缩换行与多余空白
        return text
            .replace(regexPatterns.newlineGlobal, ' ')
            .replace(regexPatterns.multiWhitespaceGlobal, ' ')
            .trim();
    }

    /**
     * 构建用户发言列表与直达输入栏
     * 兼容单分支与多分支数据结构
     * @private
     */
    _buildList() {
        const listContainer = this.panel.querySelector('.floor-jump-list');
        const headerContainer = this.panel.querySelector('.floor-jump-header');
        if (!listContainer) return;

        // 清空旧列表内容
        listContainer.innerHTML = '';

        // 获取当前会话消息
        const convId = state.currentConversationId;
        const conv = convId ? state.conversations[convId] : null;

        if (!conv || !Array.isArray(conv.branches) || conv.branches.length === 0) {
            if (headerContainer) {
                headerContainer.innerHTML = `
                    <span class="floor-jump-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                        快速跳转
                    </span>
                `;
            }
            listContainer.innerHTML = '<div class="floor-jump-empty">暂无活动会话</div>';
            return;
        }

        // 安全计算当前分支索引（单分支时默认 0，多分支时取 activeBranchIndex）
        const activeBranchIndex = (typeof conv.activeBranchIndex === 'number' && conv.activeBranchIndex >= 0 && conv.activeBranchIndex < conv.branches.length)
            ? conv.activeBranchIndex
            : 0;

        const messages = Array.isArray(conv.branches[activeBranchIndex]) ? conv.branches[activeBranchIndex] : [];
        const totalFloors = messages.length;
        const isMultiBranch = conv.branches.length > 1;

        // 更新头部信息：展示版本分支标签
        if (headerContainer) {
            headerContainer.innerHTML = `
                <div class="floor-jump-header-row">
                    <span class="floor-jump-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                        快速跳转
                    </span>
                    ${isMultiBranch ? `<span class="floor-jump-branch-badge">版本 ${activeBranchIndex + 1}/${conv.branches.length}</span>` : ''}
                </div>
            `;
        }

        if (totalFloors === 0) {
            listContainer.innerHTML = '<div class="floor-jump-empty">当前会话暂无消息</div>';
            return;
        }

        // 插入顶部楼层号极速直达工具栏
        const quickNavWrapper = document.createElement('div');
        quickNavWrapper.className = 'floor-jump-quick-bar';
        quickNavWrapper.innerHTML = `
            <input type="number" class="floor-jump-input" placeholder="输入楼层 (1-${totalFloors})" min="1" max="${totalFloors}">
            <button type="button" class="floor-jump-go-btn">跳转</button>
        `;

        const quickInput = quickNavWrapper.querySelector('.floor-jump-input');
        const quickBtn = quickNavWrapper.querySelector('.floor-jump-go-btn');

        const handleDirectJump = () => {
            const val = quickInput.value.trim();
            const match = val.match(regexPatterns.floorInputNumber);
            if (!match) return;
            const targetFloor = parseInt(match[1], 10);
            if (targetFloor >= 1 && targetFloor <= totalFloors) {
                this._jumpToMessage(targetFloor - 1);
                this.close();
            } else {
                quickInput.classList.add('floor-jump-input-error');
                setTimeout(() => quickInput.classList.remove('floor-jump-input-error'), 800);
            }
        };

        quickBtn.addEventListener('click', handleDirectJump);
        quickInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleDirectJump();
            }
        });

        listContainer.appendChild(quickNavWrapper);

        // 筛选当前分支中的所有用户消息
        const userMessages = [];
        messages.forEach((msg, index) => {
            if (msg && msg.role === 'user') {
                userMessages.push({ msg, index });
            }
        });

        if (userMessages.length === 0) {
            const emptyTip = document.createElement('div');
            emptyTip.className = 'floor-jump-empty';
            emptyTip.textContent = '暂无用户发言（可用上方输入框直达任意楼层）';
            listContainer.appendChild(emptyTip);
            return;
        }

        // 获取当前可视区域的第一条消息索引，用于高亮当前位置
        const currentVisibleIndex = this._getCurrentVisibleIndex();

        // 构建用户发言列表项
        userMessages.forEach(({ msg, index }) => {
            const floor = index + 1;
            const rawPreview = this._extractSafePreview(msg);
            const preview = rawPreview.substring(0, 32);
            const hasMore = rawPreview.length > 32;

            const item = document.createElement('div');
            item.className = 'floor-jump-item';

            // 如果该楼层在当前可视范围内，添加高亮标记
            if (index === currentVisibleIndex) {
                item.classList.add('current');
            }

            item.innerHTML = `
                <span class="floor-jump-floor">#${floor}</span>
                <span class="floor-jump-text">${this._escapeHtml(preview)}${hasMore ? '...' : ''}</span>
            `;

            // 点击跳转
            item.addEventListener('click', () => {
                this._jumpToMessage(index);
                this.close();
            });

            listContainer.appendChild(item);
        });
    }

    /**
     * 获取当前可视区域中第一条用户消息的索引（采用几何相交区间算法，支持超长消息）
     * @returns {number} 消息索引，未找到返回 -1
     * @private
     */
    _getCurrentVisibleIndex() {
        if (!dom.chatMessages) return -1;

        const wrappers = dom.chatMessages.querySelectorAll('.message-wrapper.user');
        const containerRect = dom.chatMessages.getBoundingClientRect();

        for (const wrapper of wrappers) {
            const rect = wrapper.getBoundingClientRect();
            // 相交区间算法：只要消息在视口内有至少 15px 的可视重叠，即视为可见
            const isVisible = (rect.bottom > containerRect.top + 15) && (rect.top < containerRect.bottom - 15);
            if (isVisible) {
                const bubble = wrapper.querySelector('.message-bubble');
                if (bubble && bubble.dataset.index !== undefined) {
                    return parseInt(bubble.dataset.index, 10);
                }
            }
        }
        return -1;
    }

    /**
     * 跳转到指定索引的消息（支持懒加载占位卡片自动解开与全量按需渲染）
     * @param {number} msgIndex - 消息在分支中的索引 (0-based)
     * @private
     */
    async _jumpToMessage(msgIndex) {
        if (!dom.chatMessages) return;

        // 查找对应的消息气泡
        let targetBubble = dom.chatMessages.querySelector(
            `.message-bubble[data-index="${msgIndex}"]`
        );

        // 如果在当前 DOM 中未找到，说明被懒加载（如只渲染了最近N条）截断，触发全量渲染
        if (!targetBubble) {
            try {
                await renderChatMessages({ forceLoadAll: true });
                targetBubble = dom.chatMessages.querySelector(
                    `.message-bubble[data-index="${msgIndex}"]`
                );
            } catch (err) {
                console.error('[FloorJump] 尝试全量加载历史消息失败:', err);
            }
        }

        if (!targetBubble) {
            console.warn(`[FloorJump] 无法定位索引 ${msgIndex} 的消息`);
            return;
        }

        // 如果定位到的是折叠卡片占位符，自动触发其加载按钮展开完整消息
        if (targetBubble.classList.contains('collapsed-placeholder-card')) {
            const loadBtn = targetBubble.querySelector('.load-single-msg-btn');
            if (loadBtn) {
                loadBtn.click();
            }
        }

        const wrapper = targetBubble.closest('.message-wrapper') || targetBubble;

        // 乌鸦：跳转前禁止自动滚动，防止流式输出期间被拽回底部
        scrollManager.suppressAutoScroll = true;

        // 平滑滚动到目标位置居中
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 闪烁高亮动画
        wrapper.classList.add('floor-jump-highlight');
        setTimeout(() => {
            wrapper.classList.remove('floor-jump-highlight');
        }, 1600);
    }

    /**
     * 面板打开后，将列表滚动到当前可见楼层附近
     * @private
     */
    _scrollToCurrentFloor() {
        const currentItem = this.panel.querySelector('.floor-jump-item.current');
        if (currentItem) {
            setTimeout(() => {
                currentItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 100);
        }
    }

    /**
     * HTML转义，防止XSS
     * @param {string} str - 原始字符串
     * @returns {string} 转义后的字符串
     * @private
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// 单例
const floorJumpManager = new FloorJumpManager();

/**
 * 初始化楼层快速跳转功能
 * 由 main.js 在应用初始化时调用
 */
export function initFloorJump() {
    floorJumpManager.init();
}

/**
 * 关闭楼层快速跳转面板
 * 用于切换会话、切换分支或外部全局重置时调用
 */
export function closeFloorJumpPanel() {
    floorJumpManager.close();
}
