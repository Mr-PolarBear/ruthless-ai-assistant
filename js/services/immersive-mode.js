/**
 * @file immersive-mode.js
 * @description 沉浸阅读模式管理器
 * 
 * — 为什么这么写 —
 * 1. 专注与脱水：在阅读长文对话或推演剧情时，消息气泡上的大量操作按钮（复制/编辑/删除/思维导图等）、
 *    头像、昵称、模型名标签、时间戳和Token统计会严重割裂阅读心流；
 * 2. 纯 CSS 级联架构：通过向 document.body 注入/移除 .immersive-mode 类名，实现瞬时零开销净化，
 *    无论历史会话有上千条还是后续流式实时追加，均无需遍历或修改任何 DOM 节点；
 * 3. 严格保留正文与底部控制行：只隐藏装饰性图文与已结束的思考折叠块，显式保留 .message-content
 *    以及底部的「收起」与「回本条顶部」控制行；
 * 4. 状态自动持久化：用户切换后自动记录到 localStorage，刷新页面无感延续阅读习惯。
 */

import { dom } from '../dom.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

class ImmersiveModeManager {
    constructor() {
        /** @type {boolean} 是否处于沉浸阅读模式 */
        this.isEnabled = false;
        /** @type {HTMLElement|null} 沉浸模式切换按钮 */
        this.btn = null;
        /** @type {boolean} 是否已初始化 */
        this._initialized = false;
        /** @type {string} 本地持久化存储 Key */
        this.STORAGE_KEY = 'ruthless_immersive_mode_enabled';
    }

    /**
     * 初始化沉浸阅读模式
     */
    init() {
        if (this._initialized) return;
        this.btn = dom.immersiveModeBtn || document.getElementById('immersive-mode-btn');

        // 1. 从 localStorage 读取用户历史偏好
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            this.isEnabled = saved === 'true';
        } catch (e) {
            console.warn('[ImmersiveMode] 读取 localStorage 失败:', e);
            this.isEnabled = false;
        }

        // 2. 静默应用初始状态（首屏不弹出 Toast 干扰用户）
        this.applyState(false);

        // 3. 绑定悬浮按钮点击事件
        if (this.btn) {
            this.btn.onclick = (e) => {
                if (e) e.preventDefault();
                this.toggle();
            };
        }

        this._initialized = true;
    }

    /**
     * 切换沉浸模式开闭状态
     */
    toggle() {
        this.isEnabled = !this.isEnabled;
        try {
            localStorage.setItem(this.STORAGE_KEY, String(this.isEnabled));
        } catch (e) {
            console.warn('[ImmersiveMode] 写入 localStorage 失败:', e);
        }
        this.applyState(true);
    }

    /**
     * 应用沉浸状态到 DOM 与控制按钮
     * @param {boolean} showToast 是否显示 Toast 提示
     */
    applyState(showToast = false) {
        document.body.classList.toggle('immersive-mode', this.isEnabled);

        if (this.btn) {
            this.btn.classList.toggle('active', this.isEnabled);
            this.btn.title = this.isEnabled ? '退出沉浸阅读模式' : '开启沉浸阅读模式';
        }

        if (showToast) {
            if (this.isEnabled) {
                notify.info('已开启沉浸阅读模式 (只保留正文)');
            } else {
                notify.info('已退出沉浸阅读模式');
            }
        }
    }
}

export const immersiveModeManager = new ImmersiveModeManager();
