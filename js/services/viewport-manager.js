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

/**
 * 判定当前环境是否处于移动端/手机交互模式
 * — 为什么这么写 —
 * 1. 移动端软键盘无法触发物理 Shift 键，输入法自带的换行按键本质上触发的是 Enter 事件，
 *    桌面默认的 Enter 发送行为极易导致输入过程中误触发提交流水线；
 * 2. 结合移动端 UA 与视口/触控特性，确保手机各浏览器（iOS Safari、Android Chrome/Edge/微信内置）、
 *    Capacitor 移动打包壳以及 DevTools 移动端模拟 100% 准确识别；
 * 3. 避免大屏触控笔记本（>768px 且带有精确指针鼠标）被误判为手机模式。
 * @returns {boolean} 是否为移动端模式
 */
export function isMobileDevice() {
    // 1. 移动设备 UserAgent 特征匹配
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileUA) return true;

    // 2. 纯触控、粗指针交互特征（无精确定点鼠标指针）
    const isTouchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (isTouchOnly) return true;

    // 3. 移动端常规窄屏视口（<= 768px）且具备触屏能力
    const isSmallTouchScreen = window.innerWidth <= 768 && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    if (isSmallTouchScreen) return true;

    // 4. 窄屏视口（<= 768px）安全兜底：即便在 PC 上将窗口拉至极窄，输入区域过小，也应遵循移动端防止手滑误发的保护策略
    if (window.innerWidth <= 768) return true;

    return false;
}

export const viewportManager = new ViewportManager();
