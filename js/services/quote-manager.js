/**
 * @file quote-manager.js
 * @description 专职负责划词选中聊天内容浮出快捷「引用追问」气泡，并将纯文本按 Markdown 引用格式填入输入框。
 * 
 * — 为什么这么写 —
 * 1. 痛点：长会话中用户想针对 AI 的某一句或某段代码追问时，往往需要反复手动复制、打 > 符号、换行、粘贴，链路繁琐；
 * 2. 彻底解耦与安全防崩：
 *    - 抓取选中内容时采用【纯文本快照机制】，不绑定任何 messageId 或 DOM 节点指针；
 *    - 原消息哪怕在之后被删除、切换分支或回滚，输入框内的引用文本均为独立合法的 Markdown 文本，绝不会发生死链或空指针崩溃；
 * 3. 极简人机工程学：
 *    - 鼠标或触控选中文本松开时，自动在选区上方（若靠顶则智能回退到下方）居中浮现圆润轻巧的「引用」胶囊；
 *    - 点击后自动为选中文本每行追加 `> ` 前缀，光标自动停在引用段落下方空行，随手打字即可快速追问。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { adjustTextareaHeight, updateSendButtonState } from '../ui-updater.js?v=temp';
import { draftManager } from './draft-manager.js?v=temp';

class QuoteManager {
    constructor() {
        /** @type {HTMLElement|null} 单例浮动引用气泡容器 */
        this.popoverEl = null;
        /** @type {string} 当前缓存的选中文本 */
        this.cachedSelectedText = '';
        /** @type {boolean} 是否正在点击气泡内部，避免 mousedown 误关闭 */
        this.isInteractingWithPopover = false;
        /** @type {number|null} 触摸延时检查计时器 */
        this.touchCheckTimer = null;
    }

    /**
     * 初始化划词引用监听器
     */
    init() {
        this.createPopoverElement();
        this.bindEvents();
    }

    /**
     * 创建单例悬浮引用气泡 DOM
     */
    createPopoverElement() {
        if (this.popoverEl) return;

        this.popoverEl = document.createElement('div');
        this.popoverEl.className = 'quote-selection-popover';
        this.popoverEl.setAttribute('role', 'tooltip');
        this.popoverEl.innerHTML = `
            <button type="button" class="quote-selection-btn" title="引用所选文本并插入输入框">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path>
                    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path>
                </svg>
                <span>引用</span>
            </button>
        `;

        document.body.appendChild(this.popoverEl);

        // 绑定气泡点击引用事件
        this.popoverEl.addEventListener('mousedown', (e) => {
            this.isInteractingWithPopover = true;
            // 阻止选区被取消
            e.preventDefault();
        });

        this.popoverEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.applyQuote();
            this.isInteractingWithPopover = false;
        });
    }

    /**
     * 绑定全局与聊天区划词事件
     */
    bindEvents() {
        // 监听鼠标划词结束
        document.addEventListener('mouseup', (e) => {
            if (this.isInteractingWithPopover) return;
            // 短暂微任务延迟，确保浏览器 Selection API 选区范围完成构建
            setTimeout(() => this.checkAndShowQuoteButton(e), 20);
        });

        // 监听触控划词结束（手机/平板）
        document.addEventListener('touchend', (e) => {
            if (this.isInteractingWithPopover) return;
            if (this.touchCheckTimer) clearTimeout(this.touchCheckTimer);
            this.touchCheckTimer = setTimeout(() => this.checkAndShowQuoteButton(e), 150);
        });

        // 点击页面空白处或外部区域隐藏气泡
        document.addEventListener('mousedown', (e) => {
            if (this.popoverEl && !this.popoverEl.contains(e.target)) {
                this.hide();
            }
        });

        // 聊天容器滚动时自动隐藏，避免气泡孤立浮空
        if (dom.chatMessages) {
            dom.chatMessages.addEventListener('scroll', () => {
                this.hide();
            }, { passive: true });
        }
    }

    /**
     * 辅助函数：跨越 Shadow DOM 边界寻找祖先消息气泡
     * — 为什么这么写 —
     * 聊天消息正文（.message-content）采用了 Web Components attachShadow 封装。
     * 原生 closest() 遇到 ShadowRoot 会返回 null 无法继续向上遍历；
     * 通过判定 current.host 穿透 ShadowRoot 边界，即可无缝找到外层的 .message-bubble。
     * @param {Node|null} node 
     * @returns {HTMLElement|null}
     */
    findMessageBubble(node) {
        let current = node;
        while (current) {
            if (current.nodeType === 1) {
                if (current.classList && current.classList.contains('message-bubble')) {
                    return current;
                }
                const b = current.closest && current.closest('.message-bubble');
                if (b) return b;
            }
            if (current.host) {
                current = current.host;
            } else if (current.parentNode) {
                current = current.parentNode;
            } else {
                break;
            }
        }
        return null;
    }

    /**
     * 检查选区合法性并在合理坐标展示引用按钮
     * @param {MouseEvent|TouchEvent} [e] 触发的事件对象
     */
    checkAndShowQuoteButton(e) {
        // 1. 获取选区与选中文本（同时支持常规 DOM 与 Shadow DOM）
        let selection = window.getSelection();
        let selectedText = selection ? selection.toString().trim() : '';

        // 如果常规选区为空，尝试在事件路径上的 ShadowRoot 中提取选区
        const path = e && typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (!selectedText && path.length > 0) {
            for (const el of path) {
                if (el && el.shadowRoot && typeof el.shadowRoot.getSelection === 'function') {
                    const shadowSel = el.shadowRoot.getSelection();
                    if (shadowSel && !shadowSel.isCollapsed) {
                        const txt = shadowSel.toString().trim();
                        if (txt) {
                            selection = shadowSel;
                            selectedText = txt;
                            break;
                        }
                    }
                }
            }
        }

        // 忽略单个标点或过短无意义选区
        if (!selectedText || selectedText.length < 2) {
            this.hide();
            return;
        }

        // 2. 检查选区是否位于消息气泡（.message-bubble）内
        let bubble = null;
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            bubble = this.findMessageBubble(container);
        }

        // 若从 range 树找不到，再从事件路径 fallback 寻找
        if (!bubble && path.length > 0) {
            bubble = path.find(el => el && el.classList && el.classList.contains('message-bubble'));
        }

        if (!bubble) {
            this.hide();
            return;
        }

        // 排除编辑模式中的输入框
        if (bubble.classList.contains('editing') || (e?.target && e.target.closest && e.target.closest('textarea, input'))) {
            this.hide();
            return;
        }

        this.cachedSelectedText = selectedText;

        // 3. 计算选区坐标
        let rect = null;
        if (selection && selection.rangeCount > 0) {
            const r = selection.getRangeAt(0).getBoundingClientRect();
            if (r && (r.width > 0 || r.height > 0)) {
                rect = r;
            }
        }

        // 保底：若 range 未能返回有效宽高，使用鼠标松开位置构造保底坐标
        if (!rect && e && typeof e.clientX === 'number') {
            rect = {
                left: e.clientX,
                right: e.clientX,
                top: e.clientY - 10,
                bottom: e.clientY,
                width: 0,
                height: 0
            };
        }

        if (!rect) {
            this.hide();
            return;
        }

        this.showAtPosition(rect, e);
    }

    /**
     * 根据选区边界矩形与鼠标位置，在鼠标/选区正下方精确定位引用按钮
     * — 为什么默认在下方 —
     * 1. Chromium 内核浏览器（Edge、360 等）自带的“划词搜索/复制/迷你菜单”以及翻译插件默认均强制浮现在选区正上方；
     * 2. 改为默认浮现在鼠标松手位置正下方（或选区底边下方），彻底避开浏览器自带浮窗重叠冲突；
     * 3. 紧贴鼠标光标，移动路径最短，点击体验极佳。
     * @param {DOMRect} rect 选区边界矩形
     * @param {MouseEvent|TouchEvent} [e] 触发的事件对象
     */
    showAtPosition(rect, e) {
        if (!this.popoverEl) return;

        this.popoverEl.classList.add('visible');

        const popoverWidth = this.popoverEl.offsetWidth || 76;
        const popoverHeight = this.popoverEl.offsetHeight || 32;

        // 提取鼠标/触控指针落点坐标
        let mouseX = null;
        let mouseY = null;
        if (e) {
            if (e.touches && e.touches.length > 0) {
                mouseX = e.touches[0].clientX;
                mouseY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                mouseX = e.changedTouches[0].clientX;
                mouseY = e.changedTouches[0].clientY;
            } else if (typeof e.clientX === 'number') {
                mouseX = e.clientX;
                mouseY = e.clientY;
            }
        }

        // 水平定位：优先对齐鼠标指针位置（居中），若无则对齐选区中心
        const anchorX = (mouseX !== null) ? mouseX : (rect.left + rect.width / 2);
        let left = anchorX - (popoverWidth / 2);
        // 屏幕边缘 12px 防溢出保护
        left = Math.max(12, Math.min(left, window.innerWidth - popoverWidth - 12));

        // 垂直定位：默认浮现在鼠标下方（或选区底边下方），带 12px 间隙
        const anchorY = (mouseY !== null) ? Math.max(mouseY, rect.bottom) : rect.bottom;
        let top = anchorY + 12;

        // 视口下边缘保护：若贴近屏幕底部导致溢出，则智能回退到选区上方
        if (top + popoverHeight > window.innerHeight - 15) {
            const anchorTop = (mouseY !== null) ? Math.min(mouseY, rect.top) : rect.top;
            top = anchorTop - popoverHeight - 12;
        }

        this.popoverEl.style.left = `${Math.round(left)}px`;
        this.popoverEl.style.top = `${Math.round(top)}px`;
    }

    /**
     * 执行纯文本快照引用并填入输入框
     */
    applyQuote() {
        const text = this.cachedSelectedText;
        if (!text || !dom.messageInput) return;

        // — 为什么这么写 —
        // 1. 每行前缀添加 Markdown 引用标记 >
        // 2. 纯文本无状态解耦，绝不挂载 messageId 或 DOM 节点指针，原消息删改分支切换 100% 安全
        const lines = text.split('\n');
        const quotedMarkdown = lines.map(line => `> ${line}`).join('\n');

        const currentInput = dom.messageInput.value;
        let nextInput = '';

        if (!currentInput || !currentInput.trim()) {
            // 输入框为空：直接置入引用块，追加两个换行方便用户接着打字
            nextInput = `${quotedMarkdown}\n\n`;
        } else {
            // 输入框已有文字：检测光标位置智能插入
            const cursorPos = dom.messageInput.selectionStart;
            if (typeof cursorPos === 'number' && cursorPos >= 0 && cursorPos < currentInput.length) {
                const before = currentInput.slice(0, cursorPos);
                const after = currentInput.slice(cursorPos);
                const preBreak = before.endsWith('\n') ? '' : '\n\n';
                const postBreak = after.startsWith('\n') ? '' : '\n\n';
                nextInput = `${before}${preBreak}${quotedMarkdown}${postBreak}${after}`;
            } else {
                const preBreak = currentInput.endsWith('\n') ? '\n' : '\n\n';
                nextInput = `${currentInput}${preBreak}${quotedMarkdown}\n\n`;
            }
        }

        dom.messageInput.value = nextInput;
        adjustTextareaHeight();

        // 聚焦输入框并将光标精准定在引用文本的末尾
        dom.messageInput.focus();
        dom.messageInput.selectionStart = dom.messageInput.selectionEnd = dom.messageInput.value.length;

        // 联动清空按钮与发送按钮状态
        if (dom.clearInputBtn) {
            dom.clearInputBtn.classList.remove('hidden');
        }
        if (typeof updateSendButtonState === 'function') {
            updateSendButtonState();
        }

        // 自动同步草稿
        draftManager.handleInput(state.currentConversationId, nextInput);

        this.hide();

        // 引用完成后收起选区，防止残留视觉干扰
        try {
            window.getSelection()?.removeAllRanges();
        } catch (_) {}
    }

    /**
     * 隐藏悬浮引用气泡
     */
    hide() {
        if (this.popoverEl) {
            this.popoverEl.classList.remove('visible');
        }
        this.cachedSelectedText = '';
        this.isInteractingWithPopover = false;
    }
}

export const quoteManager = new QuoteManager();

/**
 * 便捷导出初始化函数
 */
export function initQuoteManager() {
    quoteManager.init();
}
