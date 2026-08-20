/**
 * @file floor-jump.js
 * @description 聊天楼层快速跳转模块
 * 
 * 功能：在聊天界面右下角提供快速跳转按钮，
 * 点击后弹出用户发言列表面板，点击列表项可跳转到对应消息。
 * 
 * 设计原则：
 * - 完全独立，不修改任何现有模块的接口
 * - 只依赖 state 获取消息数据和 dom 获取DOM引用
 * - 通过 initFloorJump() 导出初始化入口
 */

import { state } from './state.js';
import { dom } from './dom.js';
import { scrollManager } from './scroll-manager.js';

/**
 * 楼层快速跳转管理器
 * 负责按钮交互、面板构建、消息跳转
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
    }

    /**
     * 初始化：绑定按钮事件、外部点击关闭
     */
    init() {
        this.btn = document.getElementById('jump-to-floor-btn');
        this.panel = document.getElementById('floor-jump-panel');

        if (!this.btn || !this.panel) {
            console.warn('[FloorJump] 找不到按钮或面板元素，跳过初始化');
            return;
        }

        // 按钮点击：切换面板显示
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        });

        // 点击面板外部关闭
        this._outsideClickHandler = (e) => {
            if (!this.isOpen) return;
            // 如果点击的是按钮本身或面板内部，不关闭
            if (this.btn.contains(e.target) || this.panel.contains(e.target)) return;
            this.close();
        };
        document.addEventListener('click', this._outsideClickHandler);

        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    }

    /**
     * 打开面板：构建用户发言列表并显示
     */
    open() {
        if (!this.panel) return;

        // 构建列表内容
        this._buildList();

        // 显示面板
        this.panel.classList.add('active');
        this.isOpen = true;

        // 滚动到当前可见区域附近的楼层
        this._scrollToCurrentFloor();
    }

    /**
     * 关闭面板
     */
    close() {
        if (!this.panel) return;
        this.panel.classList.remove('active');
        this.isOpen = false;
    }

    /**
     * 构建用户发言列表
     * 从当前会话的活跃分支中提取所有用户消息
     * @private
     */
    _buildList() {
        const listContainer = this.panel.querySelector('.floor-jump-list');
        if (!listContainer) return;

        // 清空旧内容
        listContainer.innerHTML = '';

        // 获取当前会话消息
        const conv = state.conversations[state.currentConversationId];
        if (!conv || !conv.branches || !conv.branches[conv.activeBranchIndex]) {
            listContainer.innerHTML = '<div class="floor-jump-empty">暂无消息</div>';
            return;
        }

        const messages = conv.branches[conv.activeBranchIndex];

        // 筛选用户消息
        const userMessages = [];
        messages.forEach((msg, index) => {
            if (msg.role === 'user' && msg.content) {
                userMessages.push({ msg, index });
            }
        });

        if (userMessages.length === 0) {
            listContainer.innerHTML = '<div class="floor-jump-empty">暂无用户发言</div>';
            return;
        }

        // 获取当前可见区域的第一条消息索引，用于高亮当前位置
        const currentVisibleIndex = this._getCurrentVisibleIndex();

        // 构建列表项
        userMessages.forEach(({ msg, index }) => {
            const floor = index + 1;
            // 提取内容预览（前30字，去掉换行）
            const preview = msg.content
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 30);
            const hasMore = msg.content.length > 30;

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
     * 获取当前可视区域中第一条用户消息的索引
     * @returns {number} 消息索引，未找到返回 -1
     * @private
     */
    _getCurrentVisibleIndex() {
        if (!dom.chatMessages) return -1;

        const wrappers = dom.chatMessages.querySelectorAll('.message-wrapper.user');
        const containerRect = dom.chatMessages.getBoundingClientRect();

        for (const wrapper of wrappers) {
            const rect = wrapper.getBoundingClientRect();
            // 如果消息在容器可视区域内
            if (rect.top >= containerRect.top && rect.top <= containerRect.bottom) {
                const bubble = wrapper.querySelector('.message-bubble');
                if (bubble && bubble.dataset.index !== undefined) {
                    return parseInt(bubble.dataset.index, 10);
                }
            }
        }
        return -1;
    }

    /**
     * 跳转到指定索引的消息
     * @param {number} msgIndex - 消息在分支中的索引
     * @private
     */
    _jumpToMessage(msgIndex) {
        if (!dom.chatMessages) return;

        // 通过 dataset.index 查找对应的消息气泡
        const targetBubble = dom.chatMessages.querySelector(
            `.message-bubble[data-index="${msgIndex}"]`
        );

        if (!targetBubble) {
            console.warn(`[FloorJump] 找不到索引 ${msgIndex} 的消息，可能是懒加载被折叠了`);
            return;
        }

        const wrapper = targetBubble.closest('.message-wrapper');
        if (!wrapper) return;

        // 乌鸦：跳转前禁止自动滚动，防止流式输出期间被拽回底部
        // 只需设置 suppressAutoScroll，点击"滚到底部"按钮时会自动恢复
        scrollManager.suppressAutoScroll = true;

        // 平滑滚动到目标位置
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 闪烁高亮动画
        wrapper.classList.add('floor-jump-highlight');
        setTimeout(() => {
            wrapper.classList.remove('floor-jump-highlight');
        }, 1500);
    }

    /**
     * 面板打开后，将列表滚动到当前可见楼层附近
     * @private
     */
    _scrollToCurrentFloor() {
        const currentItem = this.panel.querySelector('.floor-jump-item.current');
        if (currentItem) {
            // 延迟一点，等面板动画展开后再滚动
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
