
/**
 * @file floating-button.js
 * @description Manages the smart floating collapse/expand button.
 * @author 乌鸦
 */

import { dom } from './dom.js';
import { scrollManager } from './scroll-manager.js';
import { updateToggleButtonState } from './message-manager.js';

// 模块内变量，保存按钮元素
let floatingBtn = null;

/**
 * 初始化悬浮按钮
 * 乌鸦：这是总开关，负责创建按钮、绑定所有事件。
 */
export function initFloatingCollapseButton() {
    // 乌鸦：先检查是否已经初始化过，避免重复创建
    if (floatingBtn) {
        console.log('乌鸦：悬浮按钮已存在，跳过初始化');
        return;
    }
    
    // 1. 创建按钮并添加到body
    floatingBtn = document.createElement('button');
    floatingBtn.id = 'floating-collapse-btn';
    // 乌鸦：用innerHTML直接设置带图标的按钮，方便又快捷
    floatingBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
    document.body.appendChild(floatingBtn);

    // 2. 绑定核心事件
    // 乌鸦：监听按钮自己的点击事件，使用事件捕获防止冒泡
    floatingBtn.addEventListener('click', handleFloatBtnClick, true);
    // 乌鸦：防止右键菜单干扰
    floatingBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // 乌鸦：容错机制 - 如果防抖机制卡死，提供一个备用的重置机制
    setInterval(() => {
        if (isHandlingClick && Date.now() - lastClickTime > 2000) {
            console.warn('乌鸦：检测到悬浮按钮防抖机制可能卡死，强制重置');
            isHandlingClick = false;
            if (clickTimeoutId) {
                clearTimeout(clickTimeoutId);
                clickTimeoutId = null;
            }
        }
    }, 1000); // 每秒检查一次
    
    console.log('乌鸦：悬浮按钮初始化完成');
}

// 乌鸦：节流控制变量
let lastUpdateTimestamp = 0;
let updateRafId = null;

/**
 * 更新悬浮按钮的状态（核心逻辑）
 * 乌鸦：这是最关键的函数，决定了按钮是否显示、显示什么、以及控制哪条消息。
 * 乌鸦：现在这个函数被导出了，可以被外部模块在内容更新时主动调用。
 * 乌鸦：已增加 RAF 节流，避免在高频流式输出时卡死主线程。
 */
export function updateFloatingButton() {
    // 乌鸦：哨兵代码。如果按钮还没初始化，直接返回
    if (!floatingBtn) return;

    // 乌鸦：取消之前的待执行任务，避免堆积
    if (updateRafId) {
        cancelAnimationFrame(updateRafId);
    }

    // 乌鸦：使用 requestAnimationFrame 进行节流，确保在每一帧最多只计算一次
    updateRafId = requestAnimationFrame(() => {
        const now = Date.now();
        // 乌鸦：进一步限制频率，例如每 100ms 最多计算一次布局
        // 布局计算(getBoundingClientRect)很昂贵，流式输出时没必要每帧都算
        if (now - lastUpdateTimestamp < 100) {
            return;
        }
        lastUpdateTimestamp = now;

        const viewportCenter = window.innerHeight / 2;
        let bestTarget = null;

        const bubbles = dom.chatMessages.querySelectorAll('.message-bubble');

        // 乌鸦：遍历所有消息气泡，找到那个最应该被操作的目标
        for (const bubble of bubbles) {
            // 首先，判断这条消息是不是长消息（即有没有底部的折叠按钮）
            if (bubble.querySelector('.toggle-collapse-btn')) {
                const rect = bubble.getBoundingClientRect();
                // 乌鸦：判断标准是：消息的上边缘在屏幕中线之上，下边缘在屏幕中线之下。
                // 这就意味着，这条消息正“盘踞”在屏幕中央。
                if (rect.top < viewportCenter && rect.bottom > viewportCenter) {
                    bestTarget = bubble;
                    break; // 找到了就不用再找了
                }
            }
        }

        if (bestTarget) {
            const contentEl = bestTarget.querySelector('.message-content');
            // 乌鸦：优化点！只在消息是展开状态（有 expanded 类）时才需要显示悬浮按钮
            const isExpanded = contentEl.classList.contains('expanded');

            if (isExpanded) {
                floatingBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`; // 收起图标 (-)
                floatingBtn.title = '收起消息';
                // 乌鸦：用 data-* 属性把目标消息的ID存起来，这样点击的时候就知道要操作谁了。
                floatingBtn.dataset.targetId = bestTarget.dataset.id;
                floatingBtn.classList.add('visible');
            } else {
                // 乌鸦：如果目标消息是收起状态，则隐藏悬浮按钮
                floatingBtn.classList.remove('visible');
                floatingBtn.dataset.targetId = '';
            }
        } else {
            // 乌鸦：如果没找到目标，就隐藏按钮
            floatingBtn.classList.remove('visible');
            floatingBtn.dataset.targetId = '';
        }
    });
}

/**
 * 处理悬浮按钮的点击事件
 * 乌鸦：优化防抖机制和状态更新时机，提高响应性
 */
let isHandlingClick = false; // 乌鸦：防抖标志
let clickTimeoutId = null; // 乌鸦：点击超时定时器
let lastClickTime = 0; // 乌鸦：最后一次点击时间，用于容错机制

function handleFloatBtnClick(event) {
    // 乌鸦：记录点击时间
    lastClickTime = Date.now();
    
    // 乌鸦：防止事件冒泡
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    // 乌鸦：防抖处理
    if (isHandlingClick) {
        console.log('乌鸦：悬浮按钮防抖 - 忽略重复点击');
        return;
    }
    
    if (clickTimeoutId) {
        clearTimeout(clickTimeoutId);
        clickTimeoutId = null;
    }
    
    isHandlingClick = true;
    
    const targetId = floatingBtn.dataset.targetId;
    if (!targetId) {
        console.error('乌鸦：悬浮按钮没有目标ID');
        isHandlingClick = false;
        return;
    }

    // 乌鸦：保存滚动状态，体验更好
    scrollManager.saveCurrentScrollState(`floating_collapse_${targetId}`);
    
    const targetBubble = dom.chatMessages.querySelector(`.message-bubble[data-id='${targetId}']`);
    if (!targetBubble) {
        console.error('乌鸦：找不到目标消息气泡:', targetId);
        isHandlingClick = false;
        return;
    }

    // 乌鸦：大哥英明！直接找到正版的按钮
    const bottomBtn = targetBubble.querySelector('.toggle-collapse-btn');

    if (bottomBtn) {
        // 乌鸦：直接触发它的点击事件，让唯一的逻辑源头去处理一切
        console.log(`乌鸦：悬浮按钮触发了ID为 ${targetId} 的消息的底部按钮点击事件`);
        bottomBtn.click();
    } else {
        console.error(`乌鸦：在目标消息 ${targetId} 中找不到 .toggle-collapse-btn 按钮`);
        isHandlingClick = false;
        return; // 找不到按钮，直接返回
    }

    // 乌鸦：因为状态已经改变，立即更新悬浮按钮自身的可见性
    updateFloatingButton();
    
    // 乌鸦：延迟重置防抖和恢复滚动
    clickTimeoutId = setTimeout(() => {
        isHandlingClick = false;
        clickTimeoutId = null;
        console.log('乌鸦：悬浮按钮防抖重置');
        
        scrollManager.restoreScrollState(`floating_collapse_${targetId}`, {
            respectUserIntention: true,
            animationDuration: 0
        });
    }, 50); // 乌鸦：减少防抖延迟，从150ms改为50ms，提高响应速度
}
