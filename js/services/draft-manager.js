/**
 * @file draft-manager.js
 * @description 专职负责多会话输入草稿管理、实时防丢暂存、会话间草稿隔离与侧边栏草稿标记。
 * 
 * — 为什么这么写 —
 * 1. 痛点：用户在写长指令时，切换会话去查阅资料或复制内容，未发送的输入内容极易被冲掉、丢失或带入另一会话（串台）。
 * 2. 机制：
 *    - 基于 LocalStorage + 内存 Map 双层存储，不仅会话切换时秒级复原，页面刷新/异常关闭浏览器后依然完好无损；
 *    - 监听输入框实时输入（防抖 250ms 保存），实时同步草稿并精准联动侧边栏 `[草稿]` 标记；
 *    - 切换会话时，在旧会话切出前同步保存、在新会话切入后即时恢复并自适应高度；
 *    - 消息真正发送成功后，原子化清除该会话草稿与标记；
 *    - 单独抽取为独立 service 模块，最大程度降低耦合度。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { adjustTextareaHeight, updateSendButtonState } from '../ui-updater.js?v=temp';

const DRAFT_STORAGE_KEY = 'ai-chat-conversation-drafts';

class DraftManager {
    constructor() {
        /** @type {Map<string, string>} 内存草稿映射表，key 为 convId，value 为草稿字符串 */
        this.draftMap = new Map();
        /** @type {number|null} 防抖计时器 */
        this.debounceTimer = null;
        this.init();
    }

    /**
     * 初始化：从 LocalStorage 加载所有历史草稿到内存
     */
    init() {
        try {
            const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (const [id, text] of Object.entries(parsed)) {
                        if (typeof text === 'string' && text.trim().length > 0) {
                            this.draftMap.set(id, text);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('初始化草稿管理器失败:', e);
        }
    }

    /**
     * 持久化到 LocalStorage
     */
    persist() {
        try {
            const obj = {};
            for (const [id, text] of this.draftMap.entries()) {
                if (text && text.trim().length > 0) {
                    obj[id] = text;
                }
            }
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(obj));
        } catch (e) {
            console.error('持久化草稿失败:', e);
        }
    }

    /**
     * 获取指定会话的草稿
     * @param {string} convId 
     * @returns {string}
     */
    getDraft(convId) {
        if (!convId) return '';
        return this.draftMap.get(convId) || '';
    }

    /**
     * 判断指定会话是否有有效草稿
     * @param {string} convId 
     * @returns {boolean}
     */
    hasDraft(convId) {
        if (!convId) return false;
        const text = this.draftMap.get(convId);
        return typeof text === 'string' && text.trim().length > 0;
    }

    /**
     * 保存指定会话的草稿
     * @param {string} convId 
     * @param {string} text 
     * @param {boolean} [shouldPersist=true] 
     */
    saveDraft(convId, text, shouldPersist = true) {
        if (!convId) return;
        const trimmed = (text || '').trim();
        const prevHasDraft = this.hasDraft(convId);

        if (trimmed.length > 0) {
            this.draftMap.set(convId, text);
        } else {
            this.draftMap.delete(convId);
        }

        if (shouldPersist) {
            this.persist();
        }

        const nowHasDraft = this.hasDraft(convId);
        if (prevHasDraft !== nowHasDraft) {
            this.updateSidebarDraftBadge(convId, nowHasDraft);
        }
    }

    /**
     * 清理指定会话的草稿
     * @param {string} convId 
     */
    clearDraft(convId) {
        if (!convId) return;
        if (this.draftMap.has(convId)) {
            this.draftMap.delete(convId);
            this.persist();
            this.updateSidebarDraftBadge(convId, false);
        }
    }

    /**
     * 输入框输入事件处理（防抖 250ms 保存）
     * @param {string} convId 
     * @param {string} text 
     */
    handleInput(convId, text) {
        if (!convId) return;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.saveDraft(convId, text, true);
        }, 250);
    }

    /**
     * 保存当前活动会话的输入框内容到草稿（同步无延迟）
     */
    saveCurrentInput() {
        const convId = state.currentConversationId;
        if (!convId || !dom.messageInput) return;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.saveDraft(convId, dom.messageInput.value, true);
    }

    /**
     * 恢复指定会话的草稿到当前输入框中
     * @param {string} convId 
     */
    restoreDraftToInput(convId) {
        if (!dom.messageInput) return;
        const draft = this.getDraft(convId);
        dom.messageInput.value = draft;

        adjustTextareaHeight();

        // 联动清空按钮与发送按钮状态
        const hasContent = draft.trim().length > 0;
        const hasAttachment = state.attachedFiles && state.attachedFiles.length > 0;
        if (dom.clearInputBtn) {
            dom.clearInputBtn.classList.toggle('hidden', !hasContent && !hasAttachment);
        }
        if (typeof updateSendButtonState === 'function') {
            updateSendButtonState();
        }
    }

    /**
     * 在会话条目中局部增删 [草稿] 徽章，零 DOM 重排，避免整个侧边栏闪烁
     * @param {string} convId 
     * @param {boolean} hasDraft 
     */
    updateSidebarDraftBadge(convId, hasDraft) {
        if (!convId) return;
        // 支持普通列表和时间分组列表
        const items = document.querySelectorAll(`.history-item[data-id="${convId}"]`);
        items.forEach(item => {
            const titleEl = item.querySelector('.history-item-title');
            if (!titleEl) return;

            let badge = titleEl.querySelector('.history-item-draft-tag');
            if (hasDraft) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'history-item-draft-tag';
                    badge.textContent = '[草稿]';
                    badge.title = '当前会话有未发送的草稿';
                    titleEl.insertBefore(badge, titleEl.firstChild);
                }
            } else {
                if (badge) {
                    badge.remove();
                }
            }
        });
    }

    /**
     * 会话被永久删除时的清理接口
     * @param {string} convId 
     */
    onConversationDeleted(convId) {
        this.clearDraft(convId);
    }
}

export const draftManager = new DraftManager();
