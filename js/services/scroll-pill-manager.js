/**
 * @file scroll-pill-manager.js
 * @description 悬浮回底按钮升级为「生成态动态感知胶囊」服务模块
 * 
 * — 为什么独立解耦 —
 * 1. 传统的回底按钮只是一个单纯的圆形下箭头图标，当用户翻阅上方历史记录时，完全感知不到 AI 当前是在生成中还是已结束。
 * 2. 将胶囊的状态机（默认圆形、生成中展开态、新回复提示态）与生命周期感知独立封装，避免污染 scroll-manager.js 与 ui-updater.js。
 * 3. 严格遵循双模式适配与轻量原则，只操作轻量 DOM 类名，0 外部依赖。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';

class ScrollPillManager {
    constructor() {
        this.btn = null;
        this.pulseDot = null;
        this.labelSpan = null;
        this.iconSvg = null;
        this.hasNewContent = false;
        this.newContentTimer = null;
        this._isInitialized = false;
    }

    /**
     * 初始化回底胶囊内部 DOM 结构
     */
    init() {
        if (this._isInitialized) return;
        this.btn = dom.scrollToBottomBtn || document.getElementById('scroll-to-bottom-btn');
        if (!this.btn) return;

        this.btn.classList.add('scroll-pill-btn');

        // 构建结构：[脉冲呼吸圆点] + [状态文字] + [下箭头图标]
        this.btn.innerHTML = `
            <span class="scroll-pill-pulse" aria-hidden="true"></span>
            <span class="scroll-pill-label"></span>
            <svg class="scroll-pill-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        `;

        this.pulseDot = this.btn.querySelector('.scroll-pill-pulse');
        this.labelSpan = this.btn.querySelector('.scroll-pill-label');
        this.iconSvg = this.btn.querySelector('.scroll-pill-icon');

        this._isInitialized = true;
    }

    /**
     * 判断当前会话是否正在流式生成内容
     * @returns {boolean}
     */
    isCurrentConvGenerating() {
        if (!state.currentConversationId || !state.generatingMessages) return false;
        const prefix = `${state.currentConversationId}_`;
        for (const key in state.generatingMessages) {
            if (state.generatingMessages[key] && key.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 收到流式输出开始信号
     */
    notifyGenerationStarted() {
        this.hasNewContent = false;
        if (this.newContentTimer) {
            clearTimeout(this.newContentTimer);
            this.newContentTimer = null;
        }
        this.syncState();
    }

    /**
     * 收到流式输出完成信号
     */
    notifyGenerationEnded() {
        // 如果用户当前没有在底部，标记有新回复待看
        const chatContainer = dom.chatMessages;
        if (chatContainer) {
            const isNearBottom = (chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop) < 100;
            if (!isNearBottom) {
                this.hasNewContent = true;
                // 10秒后若用户仍未回底，优雅降级回默认图标
                if (this.newContentTimer) clearTimeout(this.newContentTimer);
                this.newContentTimer = setTimeout(() => {
                    this.hasNewContent = false;
                    this.syncState();
                }, 10000);
            }
        }
        this.syncState();
    }

    /**
     * 当滚动到底部时重置新内容状态
     */
    notifyReachedBottom() {
        this.hasNewContent = false;
        if (this.newContentTimer) {
            clearTimeout(this.newContentTimer);
            this.newContentTimer = null;
        }
        this.syncState();
    }

    /**
     * 同步胶囊展示形态与文字
     * @param {boolean} [isNearBottom] 可选外部传入触底状态
     */
    syncState(isNearBottom) {
        if (!this._isInitialized) {
            this.init();
        }
        if (!this.btn) return;

        const chatContainer = dom.chatMessages;
        if (!chatContainer) return;

        if (typeof isNearBottom !== 'boolean') {
            isNearBottom = (chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop) < 100;
        }

        // 触底时：隐藏按钮，清除新内容待读标记
        if (isNearBottom) {
            this.btn.classList.add('hidden');
            this.btn.classList.remove('is-generating', 'has-new');
            this.hasNewContent = false;
            return;
        }

        // 离开底部：按钮可见
        this.btn.classList.remove('hidden');

        const isGenerating = this.isCurrentConvGenerating();

        if (isGenerating) {
            // 态一：正在生成中（动态感知胶囊态）
            this.btn.classList.add('is-generating');
            this.btn.classList.remove('has-new');
            this.labelSpan.textContent = '生成中';
            this.btn.title = 'AI 正在生成回复，点击回到底部';
        } else if (this.hasNewContent) {
            // 态二：刚生成完新内容待看
            this.btn.classList.add('has-new');
            this.btn.classList.remove('is-generating');
            this.labelSpan.textContent = '新回复';
            this.btn.title = '有最新生成回复，点击回到底部';
        } else {
            // 态三：普通离开底部（经典圆形按钮态）
            this.btn.classList.remove('is-generating', 'has-new');
            this.labelSpan.textContent = '';
            this.btn.title = '滚动到底部';
        }
    }
}

export const scrollPillManager = new ScrollPillManager();
