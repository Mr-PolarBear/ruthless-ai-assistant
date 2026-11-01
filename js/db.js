// js/db.js

const DB_NAME = 'avatars_db';
const DB_VERSION = 5;
const WORLDBOOK_STORE = 'worldbook_store';
const AVATARS_STORE = 'avatars_store';
const CONVERSATIONS_STORE = 'conversations_store';
const DB_CONNECTIONS_STORE = 'db_connections_store';

let dbPromise;

/**
 * Opens the IndexedDB database using a singleton promise pattern to prevent race conditions.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(AVATARS_STORE)) {
                    db.createObjectStore(AVATARS_STORE);
                }
                if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
                    db.createObjectStore(CONVERSATIONS_STORE);
                }
                if (!db.objectStoreNames.contains(DB_CONNECTIONS_STORE)) {
                    db.createObjectStore(DB_CONNECTIONS_STORE);
                }
                if (!db.objectStoreNames.contains(WORLDBOOK_STORE)) {
                    db.createObjectStore(WORLDBOOK_STORE, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                };
                resolve(db);
            };

            request.onblocked = () => {
                console.warn('[IndexedDB] 数据库升级被其他打开的页面连接阻塞，正在等待旧连接释放...');
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }
    return dbPromise;
}

/**
 * 乌鸦：改造版，同时保存大图和缩略图
 * Saves an avatar (Blob) to IndexedDB.
 * @param {string} baseId - The base ID of the avatar.
 * @param {Blob} fullBlob - The full-sized avatar image as a Blob.
 * @param {Blob} thumbBlob - The thumbnail avatar image as a Blob.
 * @returns {Promise<void>} A promise that resolves when the avatar is saved.
 */
async function saveAvatar(baseId, fullBlob, thumbBlob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AVATARS_STORE], 'readwrite');
        const store = transaction.objectStore(AVATARS_STORE);
        
        store.put(fullBlob, `${baseId}_full`);
        store.put(thumbBlob, `${baseId}_thumb`);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 乌鸦：改造版，可以获取指定尺寸的头像
 * Retrieves an avatar (Blob) from IndexedDB.
 * @param {string} baseId - The base ID of the avatar.
 * @param {string} [size='thumb'] - The desired size ('full' or 'thumb'). Defaults to 'thumb'.
 * @returns {Promise<Blob|undefined>} A promise that resolves with the avatar Blob, or undefined if not found.
 */
async function getAvatar(baseId, size = 'thumb') { // Default to getting the thumbnail
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AVATARS_STORE], 'readonly');
        const store = transaction.objectStore(AVATARS_STORE);
        
        const idToGet = size === 'full' ? `${baseId}_full` : `${baseId}_thumb`;
        const request = store.get(idToGet);

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 乌鸦：改造版，同时删除大图和缩略图
 * Deletes an avatar from IndexedDB.
 * @param {string} baseId - The base ID of the avatar to delete.
 * @returns {Promise<void>} A promise that resolves when the avatar is deleted.
 */
async function deleteAvatar(baseId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AVATARS_STORE], 'readwrite');
        const store = transaction.objectStore(AVATARS_STORE);
        
        store.delete(`${baseId}_full`);
        store.delete(`${baseId}_thumb`);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 乌鸦：新增，清空所有头像
 * Clears all avatars from the IndexedDB store.
 * @returns {Promise<void>} A promise that resolves when the store is cleared.
 */
async function clearAllAvatars() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([AVATARS_STORE], 'readwrite');
        transaction.objectStore(AVATARS_STORE).clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}



/**
 * 保存单个会话到 IndexedDB
 * @param {string} id - 会话ID
 * @param {Object} conversation - 会话对象
 * @returns {Promise<void>}
 */
async function saveConversation(id, conversation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONVERSATIONS_STORE], 'readwrite');
        const store = transaction.objectStore(CONVERSATIONS_STORE);

        // 乌鸦：在写入前，通过序列化和反序列化来“净化”对象，移除任何可能导致IndexedDB静默失败的非标准属性（如Proxy）
        const cleanConversation = JSON.parse(JSON.stringify(conversation));
        store.put(cleanConversation, id);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 获取单个会话
 * @param {string} id - 会话ID
 * @returns {Promise<Object|undefined>}
 */
async function getConversation(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONVERSATIONS_STORE], 'readonly');
        const store = transaction.objectStore(CONVERSATIONS_STORE);
        const request = store.get(id);

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 删除单个会话
 * @param {string} id - 会话ID
 * @returns {Promise<void>}
 */
async function deleteConversation(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONVERSATIONS_STORE], 'readwrite');
        const store = transaction.objectStore(CONVERSATIONS_STORE);
        store.delete(id);

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 获取所有会话的ID列表
 * @returns {Promise<Array<string>>} - 会话ID数组
 */
async function getAllConversationIds() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONVERSATIONS_STORE], 'readonly');
        const store = transaction.objectStore(CONVERSATIONS_STORE);
        const request = store.getAllKeys();

        request.onsuccess = (event) => {
            const keys = event.target.result || [];
            const conversationIds = keys.filter(key => key !== 'all_conversations');
            resolve(conversationIds);
        };
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * Calculates the total size of the IndexedDB database.
 * @returns {Promise<string>} A promise that resolves with the total size in a human-readable format.
 */
async function getIndexedDBUsage() {
    const db = await openDB();

    let totalSize = 0;

    const objectStoreNames = Array.from(db.objectStoreNames);
    if (objectStoreNames.length === 0) {
        return "0 KB";
    }

    for (const storeName of objectStoreNames) {
        try {
            const storeSize = await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.openCursor();
                let currentStoreSize = 0;

                request.onsuccess = event => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const value = cursor.value;
                        if (value instanceof Blob) {
                            currentStoreSize += value.size;
                        } else if (typeof value === 'string') {
                            currentStoreSize += new Blob([value]).size;
                        } else {
                            currentStoreSize += new Blob([JSON.stringify(value)]).size;
                        }
                        cursor.continue();
                    } else {
                        resolve(currentStoreSize);
                    }
                };

                request.onerror = event => {
                    reject(event.target.errorCode);
                };
            });
            totalSize += storeSize;
        } catch (error) {
            console.error(`Could not calculate size for store ${storeName}:`, error);
        }
    }

    if (totalSize === 0) {
        return "0 KB";
    }

    const sizeInKB = totalSize / 1024;
    if (sizeInKB < 1024) {
        return `${sizeInKB.toFixed(2)} KB`;
    } else {
        const sizeInMB = sizeInKB / 1024;
        return `${sizeInMB.toFixed(2)} MB`;
    }
}



// ==========================================
// 备忘录 (WorldBook) IndexedDB 存储与跨页面同步
// ==========================================

let worldBookChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        worldBookChannel = new BroadcastChannel('worldbook_sync_channel');
    }
} catch (e) {
    console.warn('BroadcastChannel 跨页面广播通道不可用:', e);
}

/**
 * 广播备忘录跨窗口变更
 * @param {string} action - 'save' | 'delete' | 'reorder'
 * @param {string|Array} [payload] - 变更条目ID或数据
 */
function broadcastWorldBookChange(action, payload) {
    if (worldBookChannel) {
        try {
            worldBookChannel.postMessage({ action, payload, time: Date.now() });
        } catch (e) {
            console.error('广播世界书变更失败:', e);
        }
    }
}

/**
 * 保存单个备忘录条目到 IndexedDB (天然原子更新，绝不相互覆盖)
 * @param {Object} entry - 备忘录条目对象
 * @returns {Promise<void>}
 */
async function saveWorldBookEntryToDB(entry) {
    if (!entry || !entry.id) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([WORLDBOOK_STORE], 'readwrite');
        const store = transaction.objectStore(WORLDBOOK_STORE);
        const cleanEntry = JSON.parse(JSON.stringify(entry));
        store.put(cleanEntry);

        transaction.oncomplete = () => {
            broadcastWorldBookChange('save', entry.id);
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 从 IndexedDB 中删除单个备忘录条目
 * @param {string} id - 备忘录条目ID
 * @returns {Promise<void>}
 */
async function deleteWorldBookEntryFromDB(id) {
    if (!id) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([WORLDBOOK_STORE], 'readwrite');
        const store = transaction.objectStore(WORLDBOOK_STORE);
        store.delete(id);

        transaction.oncomplete = () => {
            broadcastWorldBookChange('delete', id);
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 获取 IndexedDB 中所有备忘录条目
 * @returns {Promise<Array<Object>>}
 */
async function getAllWorldBookEntriesFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([WORLDBOOK_STORE], 'readonly');
        const store = transaction.objectStore(WORLDBOOK_STORE);
        const request = store.getAll();

        request.onsuccess = (event) => resolve(event.target.result || []);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 批量保存备忘录条目到 IndexedDB (用于拖拽重新分配 order 或批量导入)
 * @param {Array<Object>} entriesArray - 备忘录条目数组
 * @returns {Promise<void>}
 */
async function saveAllWorldBookEntriesToDB(entriesArray) {
    if (!Array.isArray(entriesArray) || entriesArray.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([WORLDBOOK_STORE], 'readwrite');
        const store = transaction.objectStore(WORLDBOOK_STORE);
        for (const entry of entriesArray) {
            if (entry && entry.id) {
                store.put(JSON.parse(JSON.stringify(entry)));
            }
        }

        transaction.oncomplete = () => {
            broadcastWorldBookChange('reorder', entriesArray.map(e => e.id));
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

/**
 * 备忘录数据库初始化与平滑无损迁移函数
 * 1. 优先读取 IndexedDB 中的备忘录数据
 * 2. 若 IndexedDB 为空，自动检查 localStorage('ai-chat-worldbook-v1') 并批量迁移写入数据库
 * 3. 保证老用户升级后已有备忘录 100% 完好无损！
 * @param {Object} state - 全局状态
 * @returns {Promise<Object>} state.worldBook
 */
async function initAndMigrateWorldBook(state) {
    try {
        let dbEntries = await getAllWorldBookEntriesFromDB();
        if (dbEntries && dbEntries.length > 0) {
            state.worldBook = {};
            for (const item of dbEntries) {
                if (item && item.id) {
                    state.worldBook[item.id] = item;
                }
            }
            return state.worldBook;
        }

        // IndexedDB 为空，检查 localStorage 老数据一次性无损迁移
        const rawOld = localStorage.getItem('ai-chat-worldbook-v1');
        if (rawOld) {
            const oldMap = JSON.parse(rawOld || '{}');
            const oldList = Object.values(oldMap).filter(item => item && item.id);
            if (oldList.length > 0) {
                await saveAllWorldBookEntriesToDB(oldList);
                state.worldBook = oldMap;
                console.log(`[IndexedDB] 🛡️ 成功将 ${oldList.length} 条备忘录从 LocalStorage 自动迁移至 IndexedDB！`);
                return state.worldBook;
            }
        }
        state.worldBook = state.worldBook || {};
        return state.worldBook;
    } catch (err) {
        console.error('[IndexedDB] 初始化/迁移备忘录失败，回退至 LocalStorage 容灾:', err);
        const rawOld = localStorage.getItem('ai-chat-worldbook-v1');
        state.worldBook = rawOld ? JSON.parse(rawOld) : {};
        return state.worldBook;
    }
}

export { 
    openDB, 
    saveAvatar, 
    getAvatar, 
    deleteAvatar,
    clearAllAvatars,
    saveConversation,
    getConversation,
    deleteConversation,
    getAllConversationIds,
    getIndexedDBUsage,
    DB_CONNECTIONS_STORE,
    WORLDBOOK_STORE,
    saveWorldBookEntryToDB,
    deleteWorldBookEntryFromDB,
    getAllWorldBookEntriesFromDB,
    saveAllWorldBookEntriesToDB,
    initAndMigrateWorldBook,
    broadcastWorldBookChange
};
