/**
 * @file viewport-manager.js
 * @description 移动端软键盘弹起高度自适应与 Visual Viewport 协同管理模块
 * 
 * — 为什么独立解耦 —
 * 1. 移动端软键盘弹起时，iOS Safari 和 Android Chrome 的 100dvh 不一定会实时响应，
 *    浏览器默认的聚焦滚屏行为常导致页面 header 被顶飞、或输入框第二行工具栏被截断。
 * 2. 通过标准 window.visualViewport API 监听视口真实动态高度，以 CSS 变量注入 --visual-viewport-height，
 *    使 #app 物理高度精确锁定在软键盘上沿，0 遮挡、0 布局跳动。
 * 3. 桌面端 0 额外开销，与核心业务解耦。
 */

import { dom } from '../dom.js?v=temp';
import { scrollManager } from '../scroll-manager.js?v=temp';

class ViewportManager {
    constructor() {
        this.isSupported = typeof window !== 'undefined' && 'visualViewport' in window;
        this.isKeyboardOpen = false;
        this.keyboardHeight = 0;
        this._resizeHandler = null;
        this._scrollHandler = null;
    }

    /**
     * 初始化移动端 Visual Viewport 监听
     */
    init() {
        if (!this.isSupported) return;

        // 防抖/节流合并
        let rAF = null;
        const handleUpdate = () => {
            if (rAF) cancelAnimationFrame(rAF);
            rAF = requestAnimationFrame(() => {
                this.updateViewport();
            });
        };

        this._resizeHandler = handleUpdate;
        this._scrollHandler = handleUpdate;

        window.visualViewport.addEventListener('resize', this._resizeHandler, { passive: true });
        window.visualViewport.addEventListener('scroll', this._scrollHandler, { passive: true });

        // 监听输入框 blur 事件，在软键盘收起后做终态复位校准
        if (dom.messageInput) {
            dom.messageInput.addEventListener('blur', () => {
                setTimeout(() => {
                    this.updateViewport();
                    // 彻底恢复 window 滚动位置为 0，防止 iOS 底部留白幽灵高度
                    if (window.scrollY !== 0) {
                        window.scrollTo(0, 0);
                    }
                }, 100);
            });

            dom.messageInput.addEventListener('focus', () => {
                // 聚焦时若已经在底部，稍作延时确保键盘弹起后消息依然紧贴
                setTimeout(() => {
                    if (scrollManager && scrollManager.isNearBottom && scrollManager.isNearBottom(50)) {
                        scrollManager.forceScrollToBottom();
                    }
                }, 300);
            });
        }

        // 初始化时执行一次检测
        this.updateViewport();
    }

    /**
     * 核心计算与视口高度注入
     */
    updateViewport() {
        if (!this.isSupported) return;

        // 仅在移动端或触屏视口下生效（避免桌面端缩小浏览器窗口误判）
        if (window.innerWidth > 768) {
            if (this.isKeyboardOpen) {
                this.resetState();
            }
            return;
        }

        const vv = window.visualViewport;
        const currentHeight = Math.round(vv.height);
        const windowHeight = window.innerHeight;
        const rawDiff = windowHeight - currentHeight;

        // 软键盘弹起阈值：大多数移动软键盘高度都在 150px 以上
        const isKeyboard = rawDiff > 120;

        if (isKeyboard) {
            this.isKeyboardOpen = true;
            this.keyboardHeight = rawDiff;

            document.documentElement.style.setProperty('--visual-viewport-height', `${currentHeight}px`);
            document.documentElement.style.setProperty('--keyboard-height', `${rawDiff}px`);
            document.body.classList.add('keyboard-active');

            // 锁定浏览器顶层滚动，防止 iOS Safari 把整个页面向上顶出白底
            if (window.scrollY !== 0) {
                window.scrollTo(0, 0);
            }
        } else {
            this.resetState();
        }
    }

    /**
     * 重置视口与 CSS 变量状态
     */
    resetState() {
        this.isKeyboardOpen = false;
        this.keyboardHeight = 0;
        document.documentElement.style.removeProperty('--visual-viewport-height');
        document.documentElement.style.removeProperty('--keyboard-height');
        document.body.classList.remove('keyboard-active');
    }
}

export const viewportManager = new ViewportManager();
