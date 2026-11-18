/**
 * sync-store.js
 * 负责云同步专属数据的本地安全持久化（独立 IndexedDB：ruthless_sync_db）。
 *
 * — 为什么使用独立 IndexedDB —
 * 1. 杜绝修改主业务数据库（db.js）的 DB_VERSION，避免多标签页或离线模式下的升级阻塞。
 * 2. 隔离凭据：存放设备令牌与 non-extractable CryptoKey，退出或切换服务器时可一键销毁。
 */

const SYNC_DB_NAME = 'ruthless_sync_db';
const SYNC_DB_VERSION = 1;
const STORE_NAME = 'sync_credentials';

let dbInstance = null;

/**
 * 获取或初始化同步专用数据库连接
 * @returns {Promise<IDBDatabase>}
 */
function getSyncDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        req.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };

        req.onerror = (e) => {
            reject(e.target.error);
        };
    });
}

/**
 * 保存一项同步凭据
 * @param {string} key - 键名 (如 'token', 'encKey')
 * @param {any} value - 值
 * @returns {Promise<void>}
 */
export async function setSyncItem(key, value) {
    const db = await getSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * 读取一项同步凭据
 * @param {string} key - 键名
 * @returns {Promise<any>}
 */
export async function getSyncItem(key) {
    const db = await getSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * 删除一项同步凭据
 * @param {string} key - 键名
 * @returns {Promise<void>}
 */
export async function removeSyncItem(key) {
    const db = await getSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * 清空所有同步本地凭据（退出登录或切换服务器时调用）
 * @returns {Promise<void>}
 */
export async function clearSyncCredentials() {
    const db = await getSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
