/**
 * @file event-bus.js
 * @description 全局事件总线，用于模块间解耦通信。
 * 遵循发布-订阅模式 (Pub/Sub)。
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
        this.debug = false; // 开发调试用
    }

    /**
     * 订阅事件
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     * @returns {Function} - 取消订阅的函数
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        if (this.debug) console.log(`[EventBus] Subscribed to: ${event}`);

        // 返回取消订阅函数，方便 useEffect 等场景使用
        return () => this.off(event, callback);
    }

    /**
     * 取消订阅
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (!this.listeners.has(event)) return;
        this.listeners.get(event).delete(callback);
        if (this.listeners.get(event).size === 0) {
            this.listeners.delete(event);
        }
        if (this.debug) console.log(`[EventBus] Unsubscribed from: ${event}`);
    }

    /**
     * 一次性订阅
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }

    /**
     * 发布事件
     * @param {string} event - 事件名称
     * @param {*} data - 传递的数据
     */
    emit(event, data) {
        if (this.debug) console.log(`[EventBus] Emitting: ${event}`, data);

        if (!this.listeners.has(event)) return;

        // 使用 Array.from 复制一份，防止在回调中取消订阅导致 Set 遍历异常
        const callbacks = Array.from(this.listeners.get(event));
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(`[EventBus] Error in listener for event '${event}':`, err);
            }
        });
    }

    /**
     * 清空所有订阅 (用于重置)
     */
    clear() {
        this.listeners.clear();
    }
}

// 导出单例
export const eventBus = new EventBus();

// 定义事件字典，防止魔法字符串
export const EVENTS = {
    // 会话相关
    CONVERSATION_SWITCH_START: 'conversation:switch-start', // 切换会话开始
    CONVERSATION_SWITCH_DONE: 'conversation:switch-done',   // 切换会话完成
    
    // 消息流相关
    STREAM_START: 'stream:start',
    STREAM_END: 'stream:end',
    
    // 侧边栏相关
    SIDEBAR_OPEN: 'sidebar:open',
    SIDEBAR_CLOSE: 'sidebar:close',
    
    // 设置相关
    SETTINGS_UPDATED: 'settings:updated',
};
