/**
 * @file trash-manager.js
 * @description 会话回收站管理服务 (Trash Manager)
 * 
 * — 为什么这么设计 —
 * 1. 软删除保护机制：为防止用户手滑误删或在云同步覆盖时丢失历史，旧会话打上 isDeleted: true 与 deletedAt 软删除标记；
 * 2. 导出与全备份绝对隔离：在打包与导出（如 buildConversationBundle、exportAllConversations）时无条件过滤软删除会话，杜绝废弃数据污染外发备份；
 * 3. 10 天自动衰期物理销毁：系统启动与操作时自动扫描并永久物理清理超过 10 天 (10 * 24 * 3600 * 1000 ms) 的废弃会话，自动释放存储空间；
 * 4. 完整闭环：提供移入回收站、批量移入、一键恢复、单条彻底删除、清空回收站全套 API 与 UI 联动。
 */

import { state } from '../state.js?v=temp';
import { saveConversation, deleteConversation, getConversation } from '../db.js?v=temp';
import { draftManager } from './draft-manager.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

export const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000; // 864,000,000 毫秒

class TrashManager {
    /**
     * 将会话软删除移入回收站
     * @param {string|object} convOrId - 会话ID或会话对象
     * @param {object} options - 选项，例如 { isBackup: boolean, silent: boolean }
     * @returns {Promise<object|null>} 软删除后的会话对象
     */
    async moveToTrash(convOrId, options = {}) {
        const { isBackup = false, silent = false } = options;
        let conv = null;

        if (typeof convOrId === 'string') {
            conv = state.conversations[convOrId];
            if (!conv) {
                try {
                    conv = await getConversation(convOrId);
                } catch (err) {
                    console.error('[trashManager] 读取会话失败:', err);
                }
            }
        } else if (convOrId && typeof convOrId === 'object') {
            conv = convOrId;
        }

        if (!conv || !conv.id) return null;

        const now = Date.now();

        if (isBackup) {
            // — 覆盖前备份模式 —
            // 用于云同步/导入选择“覆盖本地”时，为被覆盖的本地版本生成独立备份快照保存于回收站
            const backupId = `${conv.id}_backup_${now}`;
            const backupConv = JSON.parse(JSON.stringify(conv));
            backupConv.id = backupId;
            backupConv.originalId = conv.id;
            const baseTitle = (conv.title || '未命名对话').replace(/\s*\(覆盖前备份\)+$/g, '');
            backupConv.title = `${baseTitle} (覆盖前备份)`;
            backupConv.isDeleted = true;
            backupConv.deletedAt = now;

            state.conversations[backupId] = backupConv;
            await saveConversation(backupId, backupConv);
            return backupConv;
        }

        // — 常规软删除模式 —
        conv.isDeleted = true;
        conv.deletedAt = now;

        // 清理草稿
        draftManager.onConversationDeleted(conv.id);

        // 持久化到 IndexedDB
        await saveConversation(conv.id, conv);

        // 如果被删除的是当前活动会话，自动切换到下一个可用非删除会话
        if (conv.id === state.currentConversationId) {
            state.currentConversationId = null;
            const remainingNonDeleted = Object.values(state.conversations || {}).filter(c => c && !c.isDeleted);
            try {
                const { switchToConversation } = await import('../main.js?v=temp');
                if (remainingNonDeleted.length > 0) {
                    await switchToConversation(remainingNonDeleted[0].id);
                } else {
                    await switchToConversation(null);
                }
            } catch (switchErr) {
                console.warn('[trashManager] 切换会话失败:', switchErr);
            }
        }

        // 刷新界面与存储
        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            renderHistory();
        } catch (_) {}

        try {
            const { saveToLocalStorage } = await import('../utils.js?v=temp');
            saveToLocalStorage();
        } catch (_) {}

        return conv;
    }

    /**
     * 批量将会话软删除移入回收站
     * @param {string[]|Set<string>} convIds - 会话ID集合
     * @returns {Promise<number>} 成功移入回收站的会话数量
     */
    async batchMoveToTrash(convIds) {
        if (!convIds) return 0;
        const idList = Array.from(convIds);
        if (idList.length === 0) return 0;

        let movedCount = 0;
        const now = Date.now();
        let shouldSwitchConv = false;

        for (const id of idList) {
            let conv = state.conversations[id];
            if (!conv) {
                try {
                    conv = await getConversation(id);
                } catch (_) {}
            }
            if (!conv) continue;

            conv.isDeleted = true;
            conv.deletedAt = now;
            draftManager.onConversationDeleted(id);

            try {
                await saveConversation(id, conv);
                movedCount++;
            } catch (err) {
                console.error(`[trashManager] 批量移入回收站失败 ${id}:`, err);
            }

            if (id === state.currentConversationId) {
                shouldSwitchConv = true;
            }
        }

        if (shouldSwitchConv) {
            state.currentConversationId = null;
            const remainingNonDeleted = Object.values(state.conversations || {}).filter(c => c && !c.isDeleted);
            try {
                const { switchToConversation } = await import('../main.js?v=temp');
                if (remainingNonDeleted.length > 0) {
                    await switchToConversation(remainingNonDeleted[0].id);
                } else {
                    await switchToConversation(null);
                }
            } catch (_) {}
        }

        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            renderHistory();
        } catch (_) {}

        try {
            const { saveToLocalStorage } = await import('../utils.js?v=temp');
            saveToLocalStorage();
        } catch (_) {}

        return movedCount;
    }

    /**
     * 从回收站恢复会话
     * @param {string} convId - 会话ID
     * @returns {Promise<object|null>} 恢复后的会话对象
     */
    async restoreFromTrash(convId) {
        if (!convId) return null;

        let conv = state.conversations[convId];
        if (!conv) {
            try {
                conv = await getConversation(convId);
            } catch (_) {}
        }
        if (!conv) {
            notify.error('未找到该会话记录');
            return null;
        }

        conv.isDeleted = false;
        delete conv.deletedAt;

        await saveConversation(conv.id, conv);

        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            renderHistory();
        } catch (_) {}

        try {
            const { saveToLocalStorage } = await import('../utils.js?v=temp');
            saveToLocalStorage();
        } catch (_) {}

        notify.success(`已成功恢复会话「${conv.title || '未命名'}」`);
        return conv;
    }

    /**
     * 彻底永久物理删除会话
     * @param {string} convId - 会话ID
     * @returns {Promise<boolean>}
     */
    async permanentDelete(convId, options = {}) {
        const { silent = false } = options;
        if (!convId) return false;

        delete state.conversations[convId];
        draftManager.onConversationDeleted(convId);

        try {
            await deleteConversation(convId);
        } catch (err) {
            console.error('[trashManager] 物理删除失败:', err);
        }

        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            renderHistory();
        } catch (_) {}

        try {
            const { saveToLocalStorage } = await import('../utils.js?v=temp');
            saveToLocalStorage();
        } catch (_) {}

        if (!silent) notify.info('已彻底永久删除该会话');
        return true;
    }

    /**
     * 彻底清空回收站中全部会话
     * @returns {Promise<number>} 清空的会话数量
     */
    async emptyTrash(options = {}) {
        const { silent = false } = options;
        const trashConvs = this.getTrashList();
        if (trashConvs.length === 0) {
            if (!silent) notify.info('回收站已经为空，无需清理');
            return 0;
        }

        if (!silent && typeof confirm === 'function') {
            if (!confirm(`确定要彻底清空回收站吗？\n\n共 ${trashConvs.length} 个已删除会话将被永久抹除，该操作绝对不可撤销！`)) {
                return 0;
            }
        }

        let deletedCount = 0;
        for (const conv of trashConvs) {
            delete state.conversations[conv.id];
            draftManager.onConversationDeleted(conv.id);
            try {
                await deleteConversation(conv.id);
                deletedCount++;
            } catch (err) {
                console.error(`[trashManager] 清空会话失败 ${conv.id}:`, err);
            }
        }

        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            renderHistory();
        } catch (_) {}

        try {
            const { saveToLocalStorage } = await import('../utils.js?v=temp');
            saveToLocalStorage();
        } catch (_) {}

        if (!silent) notify.success(`已彻底清空回收站，共永久删除 ${deletedCount} 个会话`);
        return deletedCount;
    }

    /**
     * 自动物理清理超过保留期限（默认10天）的废弃会话
     * @param {number} [days=10] - 保留天数
     * @returns {Promise<number>} 被自动销毁的过期会话数量
     */
    async autoCleanExpiredTrash(days = 10) {
        const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
        const convs = state.conversations || {};
        const expiredConvs = [];

        Object.values(convs).forEach(conv => {
            if (conv && conv.isDeleted === true) {
                const delTime = conv.deletedAt ? Number(conv.deletedAt) : 0;
                // 若 deletedAt 异常缺失，补上当前时间
                if (!delTime) {
                    conv.deletedAt = Date.now();
                } else if (delTime < threshold) {
                    expiredConvs.push(conv);
                }
            }
        });

        if (expiredConvs.length === 0) return 0;

        let cleanedCount = 0;
        for (const conv of expiredConvs) {
            delete state.conversations[conv.id];
            draftManager.onConversationDeleted(conv.id);
            try {
                await deleteConversation(conv.id);
                cleanedCount++;
            } catch (err) {
                console.error(`[trashManager] 自动清理过期会话失败 ${conv.id}:`, err);
            }
        }

        if (cleanedCount > 0) {
            console.log(`[trashManager] 已自动彻底清理 ${cleanedCount} 个超过 ${days} 天的回收站过期会话。`);
            try {
                const { saveToLocalStorage } = await import('../utils.js?v=temp');
                saveToLocalStorage();
            } catch (_) {}
        }

        return cleanedCount;
    }

    /**
     * 获取回收站中的所有会话列表（按 deletedAt 倒序排列）
     * @returns {object[]}
     */
    getTrashList() {
        const convs = state.conversations || {};
        return Object.values(convs)
            .filter(c => c && c.isDeleted === true)
            .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    }

    /**
     * 获取回收站中的会话总数
     * @returns {number}
     */
    getTrashCount() {
        const convs = state.conversations || {};
        return Object.values(convs).filter(c => c && c.isDeleted === true).length;
    }
}

export const trashManager = new TrashManager();
