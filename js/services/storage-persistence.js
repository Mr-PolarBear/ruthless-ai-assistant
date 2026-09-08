/**
 * @file storage-persistence.js
 * @description W3C StorageManager 数据持久化存储保护模块
 * 
 * — 为什么这么写 —
 * 1. 痛点：很多手机浏览器（夸克、UC、小米等）在“清理缓存”时，默认会把网站数据（IndexedDB / LocalStorage）一并抹除；
 * 2. 机制：现代浏览器支持 StorageManager API (navigator.storage.persist)，调用后可将网站存储模式由
 *    “临时尽力存储 (Best-Effort)”提升为“永久持久化 (Persistent)”；
 * 3. 效果：一旦浏览器授权持久化，系统清理磁盘或用户常规清理缓存时，浏览器将受保护跳过本站点，
 *    绝不自动删除本站的 IndexedDB 会话记录与 LocalStorage 配置；
 * 4. 健壮性：提供启动自动静默上锁、状态感知、手动重试申请与配额估算 (estimate) 完整闭环。
 */

import { notify } from '../ui-updater.js?v=temp';

/**
 * 格式化字节大小为易读字符串
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 检查当前浏览器是否已获得持久化存储授权
 * @returns {Promise<{supported: boolean, persisted: boolean, usage: number, quota: number}>}
 */
export async function checkStoragePersistence() {
    const result = {
        supported: false,
        persisted: false,
        usage: 0,
        quota: 0
    };

    if (typeof navigator !== 'undefined' && navigator.storage) {
        result.supported = true;
        try {
            if (typeof navigator.storage.persisted === 'function') {
                result.persisted = await navigator.storage.persisted();
            }
            if (typeof navigator.storage.estimate === 'function') {
                const estimate = await navigator.storage.estimate();
                result.usage = estimate.usage || 0;
                result.quota = estimate.quota || 0;
            }
        } catch (e) {
            console.warn('[StoragePersistence] 检查存储状态异常:', e);
        }
    }

    return result;
}

/**
 * 启动时自动申请持久化存储授权（静默上锁）
 */
export async function initStoragePersistence() {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
        console.log('[StoragePersistence] 当前浏览器环境不支持 W3C StorageManager 持久化 API');
        return;
    }

    try {
        // 先检查是否已经是持久化存储
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
            console.log('%c[StoragePersistence] 🛡️ 本地存储已处于【永久持久化保护】状态，防清理机制正常运作中', 'color: #10b981; font-weight: bold;');
            return;
        }

        // 尚未持久化，立即向浏览器申请锁定
        const granted = await navigator.storage.persist();
        if (granted) {
            console.log('%c[StoragePersistence] 🛡️ 恭喜！浏览器已成功授予【永久持久化保护】授权，IndexedDB 与配置已受系统免清理保护', 'color: #10b981; font-weight: bold;');
        } else {
            console.log('%c[StoragePersistence] ⚠️ 浏览器暂未自动授予持久化权限（通常需要用户常访问、添加到主屏幕或授予通知权限）', 'color: #f59e0b;');
        }
    } catch (e) {
        console.warn('[StoragePersistence] 自动申请持久化存储失败:', e);
    }
}

/**
 * 用户手动在设置界面点击“申请永久保护”
 */
export async function requestStoragePersistenceManually() {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
        notify.warning('当前浏览器内核暂不支持 StorageManager 持久化权限 API');
        return false;
    }

    try {
        const isAlreadyPersisted = await navigator.storage.persisted();
        if (isAlreadyPersisted) {
            notify.success('当前已处于永久持久化保护状态，无需重复申请！');
            updateStoragePersistenceUI();
            return true;
        }

        // 执行申请
        const granted = await navigator.storage.persist();
        if (granted) {
            notify.success('🛡️ 永久持久化保护已成功激活！浏览器常规清理垃圾时将自动保护跳过本站点！');
        } else {
            notify.info('浏览器暂未直接放行持久化权限。建议：将本网页【添加到手机主屏幕/桌面】或【添加至收藏夹】后再试，或使用一键备份导出保存。');
        }

        updateStoragePersistenceUI();
        return granted;
    } catch (e) {
        console.error('[StoragePersistence] 手动申请失败:', e);
        notify.error('申请持久化权限失败: ' + e.message);
        return false;
    }
}

/**
 * 刷新设置面板中的存储保护状态 UI 呈现
 */
export async function updateStoragePersistenceUI() {
    const badgeEl = document.getElementById('storage-persist-badge');
    const descEl = document.getElementById('storage-persist-desc');
    const btnEl = document.getElementById('request-storage-persist-btn');
    const quotaEl = document.getElementById('storage-persist-quota');

    if (!badgeEl || !descEl) return;

    try {
        const status = await checkStoragePersistence();

        if (quotaEl && status.quota > 0) {
            quotaEl.textContent = `已用约 ${formatBytes(status.usage)} / 浏览器配额上限 ${formatBytes(status.quota)}`;
        }

        if (!status.supported) {
            badgeEl.textContent = '内核不支持';
            badgeEl.style.backgroundColor = '#94a3b8';
            badgeEl.style.color = '#ffffff';
            descEl.textContent = '当前手机浏览器不支持 StorageManager API，请注意不要在浏览器中清空“网站数据”。';
            if (btnEl) btnEl.style.display = 'none';
            return;
        }

        if (status.persisted) {
            badgeEl.textContent = '🛡️ 已激活永久保护';
            badgeEl.style.backgroundColor = '#10b981';
            badgeEl.style.color = '#ffffff';
            descEl.textContent = '已获得浏览器最高等级数据保护：在系统磁盘紧张或日常清理缓存时，浏览器会自动保护并跳过本站会话与配置！';
            if (btnEl) btnEl.style.display = 'none';
        } else {
            badgeEl.textContent = '⚠️ 临时存储模式';
            badgeEl.style.backgroundColor = '#f59e0b';
            badgeEl.style.color = '#ffffff';
            descEl.textContent = '当前数据处于普通临时存储层级。如果手机浏览器全选“清除网站数据”，可能会被误删，建议点击申请保护。';
            if (btnEl) {
                btnEl.style.display = 'inline-block';
                btnEl.textContent = '申请永久保护';
                btnEl.onclick = requestStoragePersistenceManually;
            }
        }
    } catch (err) {
        console.error('[StoragePersistence] 更新 UI 失败:', err);
    }
}
