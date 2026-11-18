/**
 * @file scroll-manager.js
 * @description 增强的滚动位置管理模块 - 极简高优版
 * @author 乌鸦
 */

import { dom } from './dom.js?v=temp';
import { state } from './state.js?v=temp';
import { scrollToBottom } from './ui-updater.js?v=temp';

class ScrollManager {
    constructor() {
        this.scrollStates = new Map();
        
        // 移动端触控跟踪坐标
        this.touchStartY = 0;
        this.touchStartX = 0;

        // 核心：唯一定义"用户是否在操作"的标志
        // 只要用户鼠标按下在拖动滚动条，或者正在触摸滑动，坚决不抢夺滚动控制权
        this.isUserScrolling = false;

        // 滚轮锁定标志：滚轮滚动时锁定，滚动停止后 150ms 检查是否在底部再决定是否解锁
        this.wheelLocked = false;
        this.autoUnlockTimeout = null; // 滚动停止后自动解锁的定时器
        this.immediateWheelLock = false; // 同步急停标志，在同一事件循环中生效

        // 楼层跳转护压标记
        this.suppressAutoScroll = false;

        this.mcpExecutionStates = new Map();
        this.preserveScrollOnMCP = true;

        this._isInitialized = false;

        this.init();
    }

    init() {
        if (!dom.chatMessages) {
            // — 为什么这么写 —
            // 模块顶层静态导入实例化时，dom.js 尚未完成 initDom()（需等待 DOMContentLoaded）。
            // 必须在 DOM 加载完成后自动延迟二次重试，并在 main.js 中显式调用，彻底杜绝监听器未挂载导致滚动死锁！
            if (typeof document !== 'undefined' && document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            }
            return;
        }
        if (this._isInitialized) return;
        this._isInitialized = true;
        this.setupScrollListeners();
        this.setupResizeObserver();
        console.log('小鸡：极简版滚动管理器初始化完成');
    }

    ensureInit() {
        if (!this._isInitialized && dom.chatMessages) {
            this.init();
        }
    }

    setupScrollListeners() {
        // 监听鼠标按下/抬起（拖拽滚动条）
        dom.chatMessages.addEventListener('mousedown', () => { this.isUserScrolling = true; });
        document.addEventListener('mouseup', () => { this.isUserScrolling = false; });
        
        // 监听触摸滑动（移动端方向感知与防拉回硬锁）
        dom.chatMessages.addEventListener('touchstart', (e) => {
            this.isUserScrolling = true;
            if (e.touches && e.touches.length > 0) {
                this.touchStartY = e.touches[0].clientY;
                this.touchStartX = e.touches[0].clientX;
            }
        }, { passive: true });

        dom.chatMessages.addEventListener('touchmove', (e) => {
            if (!e.touches || e.touches.length === 0) return;
            const currentY = e.touches[0].clientY;
            const currentX = e.touches[0].clientX;
            const deltaY = currentY - this.touchStartY;
            const deltaX = currentX - this.touchStartX;

            // 仅在纵向滑动分量大于横向分量时进行滚动方向判定
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                // — 为什么这么写 —
                // 手指向下拉（deltaY > 8）对应页面向上滚动（scrollTop 减小），查看历史消息。
                // 必须立即立起硬锁，阻断流式渲染中的 smartScrollToBottom 抢占控制权！
                if (deltaY > 8) {
                    this.wheelLocked = true;
                    this.immediateWheelLock = true;
                } else if (deltaY < -8) {
                    // 手指向上推（deltaY < -8）对应页面向下滚动，若已接近底部（<=15px）则释放锁定恢复跟随
                    if (this.isNearBottom(15)) {
                        this.wheelLocked = false;
                        this.immediateWheelLock = false;
                        this.suppressAutoScroll = false;
                    }
                }
            }
        }, { passive: true });

        const handleTouchEndOrCancel = () => {
            // — 为什么这么写 —
            // 移动端手指抬起后，惯性滚动（Momentum Scrolling）仍会持续约 200~300ms。
            // 1. 如果手指松开时已接近底部（<=15px，兼顾高分屏浮点计算与流式输出增高），立即释放锁定，恢复自动跟随；
            // 2. 如果手指松开时不在底部（查看历史），启动 300ms 惯性保护定时器，惯性滑停后若仍未到底部，坚决保持物理锁；
            // 3. 释放 isUserScrolling，使页面能正常响应后续状态判断。
            if (this.isNearBottom(15)) {
                this.isUserScrolling = false;
                this.wheelLocked = false;
                this.immediateWheelLock = false;
            } else {
                clearTimeout(this.autoUnlockTimeout);
                this.autoUnlockTimeout = setTimeout(() => {
                    this.isUserScrolling = false;
                    if (this.isNearBottom(15)) {
                        this.wheelLocked = false;
                    }
                    if (this.isNearBottom(50)) {
                        this.suppressAutoScroll = false;
                    }
                    this.immediateWheelLock = false;
                }, 300);
            }
        };

        dom.chatMessages.addEventListener('touchend', handleTouchEndOrCancel, { passive: true });
        dom.chatMessages.addEventListener('touchcancel', () => {
            this.isUserScrolling = false;
            if (this.isNearBottom(15)) {
                this.wheelLocked = false;
            }
            this.immediateWheelLock = false;
        }, { passive: true });

        // 全局兜底防止触控在容器外松开导致 isUserScrolling 永久滞留
        document.addEventListener('touchend', () => {
            if (this.isUserScrolling) {
                handleTouchEndOrCancel();
            }
        }, { passive: true });

        // wheel 滚轮事件：方向感知 + 向上绝对硬阻断
        // immediateWheelLock 在同一事件循环中生效，用于阻断已经在队列中的 smartScrollToBottom
        dom.chatMessages.addEventListener('wheel', (e) => {
            const isRollingUp = e.deltaY < 0;

            if (isRollingUp) {
                // — 为什么这么写 —
                // 只要检测到用户向上滚轮（deltaY < 0），说明用户明确意图是离开底部查看历史消息。
                // 必须同步立起硬锁，绝对禁止在同一事件循环或后续流式渲染中被拉回底部！
                this.wheelLocked = true;
                this.immediateWheelLock = true;
            } else {
                // 向下滚动（deltaY > 0）：如果已经滚到底部附近，立即释放锁定，恢复自动跟随
                if (this.isNearBottom(10)) {
                    this.wheelLocked = false;
                    this.immediateWheelLock = false;
                    this.suppressAutoScroll = false;
                }
            }

            clearTimeout(this.autoUnlockTimeout);
            this.autoUnlockTimeout = setTimeout(() => {
                // — 为什么这么写 —
                // 1. wheelLocked 是物理锁，要求严格 5px，避免向上微偏时被误判为在底部产生微回拉
                // 2. suppressAutoScroll 是楼层跳转的逻辑锁，语义是"用户主动离开底部"，
                //    用户接近底部就该恢复跟随；流式输出 scrollHeight 不停增长，
                //    严格 5px 几乎打不中，所以放宽到 50px
                if (this.isNearBottom(5)) {
                    this.wheelLocked = false;
                }
                if (this.isNearBottom(50)) {
                    this.suppressAutoScroll = false;
                }
                // 不在底部则保持锁定
                this.immediateWheelLock = false;
            }, 300); // 覆盖系统的鼠标滚轮平滑滚动动画时长
        }, { passive: true });
    }

    /**
     * 乌鸦：使用 ResizeObserver 替代 MutationObserver
     * ResizeObserver 更底层，只有在元素实际高度变化时才会触发，更准确
     */
    setupResizeObserver() {
        // 记录变化前是否在底部
        let wasAtBottom = false;

        this.resizeObserver = new ResizeObserver(() => {
            // — 为什么这么写 —
            // 1. 读写分离与防抖：在侧边栏折叠/展开等过渡期内，短时间内连续触发尺寸变化回调；
            // 2. 使用 requestAnimationFrame 消除在同一个渲染帧内同步读取 scrollHeight 引发的强制同步排版 (Layout Thrashing)；
            // 3. 待尺寸变化在帧末稳定后，统一执行贴底滚动判定。
            if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = requestAnimationFrame(() => {
                this.resizeRafId = null;
                // 如果变化前在底部，变化后自动贴合底部
                // 忽略 MCP 执行期的自动跟随（由 MCP 逻辑独立控制）
                // 忽略所有锁定状态
                if (wasAtBottom && this.mcpExecutionStates.size === 0 && !this.shouldBlockAutoScroll()) {
                    scrollToBottom();
                }
                // 更新状态：将150px的宽容判定改为10px，严格控制底部判定，防止用户上滚1格（100px）依然被判定为"在底部"从而导致误触回拉。
                wasAtBottom = this.isNearBottom(10);
            });
        });

        // 乌鸦：直接观察聊天消息主容器本身，避免因观察首个子元素而在会话切换 innerHTML='' 时发生脱落
        this.resizeObserver.observe(dom.chatMessages);
        
        let lastScrollTop = dom.chatMessages.scrollTop;
        dom.chatMessages.addEventListener('scroll', () => {
            const currentScrollTop = dom.chatMessages.scrollTop;
            const isScrollingUp = currentScrollTop < lastScrollTop;
            lastScrollTop = currentScrollTop;

            // 乌鸦：同理，采用严格底部判定
            wasAtBottom = this.isNearBottom(10);
            
            // — 为什么这么写 —
            // 1. 物理锁（wheelLocked / immediateWheelLock / isUserScrolling）：阈值放宽到 15px。
            //    兼顾移动端高分屏浮点计算、惯性减速停止点以及流式吐字高度持续扩展时的自动回踩。
            // 2. 逻辑锁（suppressAutoScroll，由楼层跳转设置）：宽松 50px。
            //    流式输出期间 scrollHeight 持续增长，用户视觉上滚到底部但代码判定可能差几十像素，
            //    严格 5px 会导致永远清不掉，跟随永远恢复不了。
            // 3. 共同前提：必须 !isScrollingUp，避免向上滚动时被误清。
            if (!isScrollingUp) {
                if (this.isNearBottom(15)) {
                    clearTimeout(this.autoUnlockTimeout);
                    this.wheelLocked = false;
                    this.immediateWheelLock = false;
                    this.isUserScrolling = false;
                }
                if (this.isNearBottom(50)) {
                    this.suppressAutoScroll = false;
                }
            }
        }, { passive: true });
    }

    isNearBottom(threshold = 10) {
        this.ensureInit();
        const container = dom.chatMessages;
        if (!container) return false;
        // 增量 1px 的安全容差，用于解决高分屏和各种浏览器的浮点数高度像素偏差
        return (container.scrollHeight - container.clientHeight - container.scrollTop) <= threshold + 1;
    }

    saveCurrentScrollState(context) {
        const container = dom.chatMessages;
        this.scrollStates.set(context, {
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
            isNearBottom: this.isNearBottom(),
            relativePosition: container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight)
        });
    }

    restoreScrollState(context, options = {}) {
        const savedState = this.scrollStates.get(context);
        if (!savedState) return false;

        const container = dom.chatMessages;
        const { forceRestore = false, animationDuration = 0 } = options;

        if (!forceRestore && this.isUserScrolling) return false;

        let targetScrollTop = savedState.isNearBottom ? 
            (container.scrollHeight - container.clientHeight) : 
            (savedState.relativePosition * (container.scrollHeight - container.clientHeight));

        targetScrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight));

        if (animationDuration > 0) {
            container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        } else {
            container.scrollTop = targetScrollTop;
        }
        return true;
    }

    onMCPStart(mcpId, context = {}) {
        this.saveCurrentScrollState(`mcp_${mcpId}_start`);
        this.mcpExecutionStates.set(mcpId, {
            startTime: Date.now(),
            context
        });
    }

    onMCPEnd(mcpId, result = {}) {
        const mcpState = this.mcpExecutionStates.get(mcpId);
        if (!mcpState) return;

        setTimeout(() => {
            // 恢复 MCP 开始前的位置
            this.restoreScrollState(`mcp_${mcpId}_start`, { forceRestore: true });
            
            this.mcpExecutionStates.delete(mcpId);
            this.scrollStates.delete(`mcp_${mcpId}_start`);
        }, 300);
    }

    forceScrollToBottom() {
        this.suppressAutoScroll = false;
        this.wheelLocked = false;
        this.immediateWheelLock = false;
        this.isUserScrolling = false;
        clearTimeout(this.autoUnlockTimeout);
        scrollToBottom();
        requestAnimationFrame(() => scrollToBottom());
    }

    /**
     * 乌鸦：由外部（如 LLM 流式渲染器）主动调用的滚动判定
     * @param {boolean} forceIfWasAtBottom - 如果外部判定渲染前在底部，强制允许滚动
     */
    smartScrollToBottom(forceIfWasAtBottom = false) {
        this.ensureInit();
        if (this.suppressAutoScroll) return false;

        // — 为什么这么写 —
        // 1. immediateWheelLock 是同步急停，同一事件循环内必须生效，forceIfWasAtBottom 绝对不可覆盖
        // 2. isUserScrolling 是物理拖拽/触摸操作，forceIfWasAtBottom 绝对不可覆盖
        // 3. wheelLocked 是滚轮锁：只要用户向上滚了轮，坚决不抢夺控制权，forceIfWasAtBottom 绝对不可覆盖！
        //    此前允许 forceIfWasAtBottom 覆盖 wheelLocked 导致了 AI 流式输出期间向上回滚在 16ms 内被强制拉回底部、造成死锁。
        //    现在向下滚动由 wheel 事件的 deltaY > 0 + isNearBottom(10) 和 scroll 事件自然解锁，不再需要特权覆盖！
        if (this.immediateWheelLock) return false;
        if (this.isUserScrolling) return false;
        if (this.wheelLocked) return false;

        if (forceIfWasAtBottom || this.isNearBottom(10)) {
            scrollToBottom();
            // — 为什么这么写 —
            // 流式 throttle 渲染会重写 .message-content，DOM 重建瞬间高度先塌后升，
            // 单次 scrollTo 容易夹在抖动里，导致上方用户消息视觉"落下又升回"产生闪烁。
            // 用 rAF 在下一帧（高度恢复后）再补滚一次，与 forceScrollToBottom 套路一致。
            requestAnimationFrame(() => scrollToBottom());
            return true;
        }
        return false;
    }

    /**
     * 检查是否应该禁止自动滚动（由 AI 渲染回调使用）
     * 返回 true 表示禁止自动滚动，false 表示允许
     */
    shouldBlockAutoScroll() {
        return this.suppressAutoScroll || this.immediateWheelLock || this.isUserScrolling || this.wheelLocked;
    }

    addContentUpdateCallback(callback) {}
    removeContentUpdateCallback(callback) {}

    getScrollInfo() {
        return {
            isUserScrolling: this.isUserScrolling,
            wheelLocked: this.wheelLocked,
            immediateWheelLock: this.immediateWheelLock,
            isNearBottom: this.isNearBottom(),
            mcpExecutions: Array.from(this.mcpExecutionStates.keys())
        };
    }

    destroy() {
        if (this.resizeRafId) {
            cancelAnimationFrame(this.resizeRafId);
            this.resizeRafId = null;
        }
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.scrollStates.clear();
        this.mcpExecutionStates.clear();
    }
}

export const scrollManager = new ScrollManager();

export const {
    init,
    ensureInit,
    saveCurrentScrollState,
    restoreScrollState,
    onMCPStart,
    onMCPEnd,
    forceScrollToBottom,
    smartScrollToBottom,
    shouldBlockAutoScroll,
    addContentUpdateCallback,
    removeContentUpdateCallback,
    getScrollInfo
} = scrollManager;