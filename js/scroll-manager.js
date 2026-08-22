/**
 * @file scroll-manager.js
 * @description 增强的滚动位置管理模块 - 极简高优版
 * @author 乌鸦
 */

import { dom } from './dom.js?v=260823';
import { state } from './state.js?v=260823';
import { scrollToBottom } from './ui-updater.js?v=260823';

class ScrollManager {
    constructor() {
        this.scrollStates = new Map();
        
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

        this.init();
    }

    init() {
        if (!dom.chatMessages) return;
        this.setupScrollListeners();
        this.setupResizeObserver();
        console.log('乌鸦：极简版滚动管理器初始化完成');
    }

    setupScrollListeners() {
        // 监听鼠标按下/抬起（拖拽滚动条）
        dom.chatMessages.addEventListener('mousedown', () => { this.isUserScrolling = true; });
        document.addEventListener('mouseup', () => { this.isUserScrolling = false; });
        
        // 监听触摸滑动
        dom.chatMessages.addEventListener('touchstart', () => { this.isUserScrolling = true; }, { passive: true });
        dom.chatMessages.addEventListener('touchend', () => { this.isUserScrolling = false; }, { passive: true });

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
            // 如果变化前在底部，变化后自动贴合底部
            // 忽略 MCP 执行期的自动跟随（由 MCP 逻辑独立控制）
            // 忽略所有锁定状态
            if (wasAtBottom && this.mcpExecutionStates.size === 0 && !this.shouldBlockAutoScroll()) {
                scrollToBottom();
            }
            // 更新状态：将150px的宽容判定改为10px，严格控制底部判定，防止用户上滚1格（100px）依然被判定为"在底部"从而导致误触回拉。
            wasAtBottom = this.isNearBottom(10);
        });

        // 观察聊天容器的直接子元素（包含所有消息的主内容区）
        // 这样可以监听到消息增加、代码块展开、图片加载等所有引起高度变化的事件
        const contentWrapper = dom.chatMessages.firstElementChild || dom.chatMessages;
        this.resizeObserver.observe(contentWrapper);
        
        let lastScrollTop = dom.chatMessages.scrollTop;
        dom.chatMessages.addEventListener('scroll', () => {
            const currentScrollTop = dom.chatMessages.scrollTop;
            const isScrollingUp = currentScrollTop < lastScrollTop;
            lastScrollTop = currentScrollTop;

            // 乌鸦：同理，采用严格底部判定
            wasAtBottom = this.isNearBottom(10);
            
            // — 为什么这么写 —
            // 1. 物理锁（wheelLocked / immediateWheelLock / isUserScrolling）：严格 5px。
            //    否则用户向上微偏一格平滑滚动时，滚轮首帧位移 <5px 会被误判为"依旧在底部"
            //    而强行解锁，产生"微微回拉一下"的幽灵 bug。
            // 2. 逻辑锁（suppressAutoScroll，由楼层跳转设置）：宽松 50px。
            //    流式输出期间 scrollHeight 持续增长，用户视觉上滚到底部但代码判定可能差几十像素，
            //    严格 5px 会导致永远清不掉，跟随永远恢复不了。
            // 3. 共同前提：必须 !isScrollingUp，避免向上滚动时被误清。
            if (!isScrollingUp) {
                if (this.isNearBottom(5)) {
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
        const container = dom.chatMessages;
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
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.scrollStates.clear();
        this.mcpExecutionStates.clear();
    }
}

export const scrollManager = new ScrollManager();

export const {
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