// js/db.js

const DB_NAME = 'avatars_db';
const DB_VERSION = 4;
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
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
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
    DB_CONNECTIONS_STORE
};
