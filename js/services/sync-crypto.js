/**
 * sync-crypto.js
 * 负责客户端端到端加密（E2EE）、密钥派生、gzip 压缩解压与封包格式处理。
 *
 * — 为什么这么设计 —
 * 1. 服务器零知识：服务器仅留存 RSYN 密文封包与哈希，绝不接触明文与 encKey。
 * 2. 双轨降级：现代浏览器走 WebCrypto 原生接口，内网非安全上下文自动降级至 noble 纯 JS。
 * 3. AAD 强绑定：AES-GCM 的附加认证数据（AAD）绑定 userId、snapshotId 和 formatVersion，彻底杜绝密文回放与跨用户替换攻击。
 */

import { regexPatterns } from '../regex.js?v=temp';

const MAGIC_BYTES = new Uint8Array([0x52, 0x53, 0x59, 0x4E]); // "RSYN"
const FORMAT_VERSION = 0x01;

/**
 * 将 Hex 字符串转为 Uint8Array
 */
export function hexToBytes(hex) {
    if (!hex) return new Uint8Array(0);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * 将 Uint8Array 转为 Hex 字符串
 */
export function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * 通过 Web Worker 异步派生主密钥与认证哈希
 *
 * @param {string} password - 用户主密码
 * @param {string} saltHex - 服务端分配的 16 字节随机盐 (Hex)
 * @param {number} iterations - PBKDF2 迭代轮次 (如 600000)
 * @param {Function} [onProgress] - 进度回调 (percent => {})
 * @returns {Promise<{ masterKeyHex: string, authHashHex: string, encKeyHex: string }>}
 */
export function deriveKeysWithWorker(password, saltHex, iterations = 600000, onProgress = null) {
    return new Promise((resolve, reject) => {
        const worker = new Worker('js/workers/sync-kdf.worker.js?v=temp');
        const reqId = Date.now() + Math.random().toString(36).slice(2, 7);

        worker.onmessage = (e) => {
            const { id, type, percent, masterKeyHex, authHashHex, encKeyHex, error } = e.data;
            if (id !== reqId) return;

            if (type === 'progress') {
                if (typeof onProgress === 'function') onProgress(percent);
            } else if (type === 'done') {
                worker.terminate();
                resolve({ masterKeyHex, authHashHex, encKeyHex });
            } else if (type === 'error') {
                worker.terminate();
                reject(new Error(error || 'Worker 密钥派生失败'));
            }
        };

        worker.onerror = (err) => {
            worker.terminate();
            reject(err);
        };

        worker.postMessage({
            id: reqId,
            type: 'derive',
            password,
            saltHex,
            iterations
        });
    });
}

/**
 * gzip 压缩字节流（优先 CompressionStream，降级用 JSZip）
 */
async function compressGzip(dataBytes) {
    if (typeof CompressionStream !== 'undefined') {
        const stream = new Blob([dataBytes]).stream().pipeThrough(new CompressionStream('gzip'));
        const response = new Response(stream);
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    }

    if (window.JSZip) {
        const zip = new window.JSZip();
        zip.file('data', dataBytes);
        const compressed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        return compressed;
    }

    // 若均不可用，返回原字节
    return dataBytes;
}

/**
 * gzip 解压字节流（优先 DecompressionStream，降级用 JSZip）
 */
async function decompressGzip(compressedBytes) {
    if (typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(stream);
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    }

    if (window.JSZip) {
        const zip = new window.JSZip();
        const loaded = await zip.loadAsync(compressedBytes);
        const file = Object.values(loaded.files)[0];
        if (file) {
            return await file.async('uint8array');
        }
    }

    return compressedBytes;
}

/**
 * 安全解析纯 JS AES-GCM 实现
 */
function getNobleAesGcm() {
    if (!window.nobleCiphers) return null;
    if (typeof window.nobleCiphers.gcm === 'function') return window.nobleCiphers.gcm;
    if (window.nobleCiphers.gcm && typeof window.nobleCiphers.gcm.gcm === 'function') return window.nobleCiphers.gcm.gcm;
    if (window.nobleCiphers.aes && typeof window.nobleCiphers.aes.gcm === 'function') return window.nobleCiphers.aes.gcm;
    return null;
}

/**
 * 加密会话包，生成 RSYN 密文封包
 *
 * @param {Object} bundle - 会话包纯对象
 * @param {string} encKeyHex - 32 字节 AES 密钥 (Hex)
 * @param {string} userId - 用户 ID（绑定 AAD）
 * @param {string} snapshotId - 快照 ID（绑定 AAD）
 * @returns {Promise<Uint8Array>} RSYN 封包
 */
export async function encryptSnapshot(bundle, encKeyHex, userId, snapshotId) {
    const jsonStr = JSON.stringify(bundle);
    const plainBytes = new TextEncoder().encode(jsonStr);
    const compressedBytes = await compressGzip(plainBytes);

    const aadStr = `${userId}|${snapshotId}|1`;
    const aadBytes = new TextEncoder().encode(aadStr);

    const iv = new Uint8Array(12);
    if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(iv);
    } else {
        for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
    }

    const keyBytes = hexToBytes(encKeyHex);
    let ciphertextWithTag;
    const nobleGcm = getNobleAesGcm();

    // 优先原生 WebCrypto，局域网非安全上下文降级为纯 JS noble
    if (window.crypto && window.crypto.subtle) {
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );
        const encBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: aadBytes },
            cryptoKey,
            compressedBytes
        );
        ciphertextWithTag = new Uint8Array(encBuffer);
    } else if (nobleGcm) {
        // noble 降级
        const aes = nobleGcm(keyBytes, iv, aadBytes);
        ciphertextWithTag = aes.encrypt(compressedBytes);
    } else {
        throw new Error('当前环境无可用加密套件');
    }

    // 组装封包: "RSYN" (4B) | version (1B) | iv (12B) | ciphertextWithTag
    const totalLen = 4 + 1 + 12 + ciphertextWithTag.length;
    const packet = new Uint8Array(totalLen);
    packet.set(MAGIC_BYTES, 0);
    packet[4] = FORMAT_VERSION;
    packet.set(iv, 5);
    packet.set(ciphertextWithTag, 17);

    return packet;
}

/**
 * 解密 RSYN 密文封包还原会话包
 *
 * @param {Uint8Array} packetBytes - 二进制密文封包
 * @param {string} encKeyHex - 32 字节 AES 密钥 (Hex)
 * @param {string} userId - 用户 ID（校验 AAD）
 * @param {string} snapshotId - 快照 ID（校验 AAD）
 * @returns {Promise<Object>} 会话包对象
 */
export async function decryptSnapshot(packetBytes, encKeyHex, userId, snapshotId) {
    if (!packetBytes || packetBytes.length < 17) {
        throw new Error('快照密文数据长度不足');
    }

    // 校验魔数
    for (let i = 0; i < 4; i++) {
        if (packetBytes[i] !== MAGIC_BYTES[i]) {
            throw new Error('非法的快照封包格式 (Magic Mismatch)');
        }
    }

    const version = packetBytes[4];
    if (version !== FORMAT_VERSION) {
        throw new Error(`不受支持的快照版本: ${version}`);
    }

    const iv = packetBytes.slice(5, 17);
    const ciphertextWithTag = packetBytes.slice(17);

    const aadStr = `${userId}|${snapshotId}|1`;
    const aadBytes = new TextEncoder().encode(aadStr);
    const keyBytes = hexToBytes(encKeyHex);

    let decryptedBytes;
    const nobleGcm = getNobleAesGcm();

    if (window.crypto && window.crypto.subtle) {
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );
        const decBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: aadBytes },
            cryptoKey,
            ciphertextWithTag
        );
        decryptedBytes = new Uint8Array(decBuffer);
    } else if (nobleGcm) {
        const aes = nobleGcm(keyBytes, iv, aadBytes);
        decryptedBytes = aes.decrypt(ciphertextWithTag);
    } else {
        throw new Error('当前环境无可用解密套件');
    }

    const decompressedBytes = await decompressGzip(decryptedBytes);
    const jsonStr = new TextDecoder().decode(decompressedBytes);
    return JSON.parse(jsonStr);
}

/**
 * 加密 Manifest 清单（返回 Base64 字符串供列表快速存储）
 */
export async function encryptManifest(manifest, encKeyHex, userId, snapshotId) {
    const rawPacket = await encryptSnapshot(manifest, encKeyHex, userId, snapshotId);
    let binary = '';
    const len = rawPacket.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(rawPacket[i]);
    }
    return btoa(binary);
}

/**
 * 解密 Manifest 清单（高韧性兼容 Base64 与 Hex 双模式编码）
 */
export async function decryptManifest(encManifestBase64OrHex, encKeyHex, userId, snapshotId) {
    if (!encManifestBase64OrHex) return null;
    const str = String(encManifestBase64OrHex).trim();
    if (!str) return null;

    const parseAsBase64 = (s) => {
        try {
            const binaryStr = atob(s);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return bytes;
        } catch (_) {
            return null;
        }
    };

    const parseAsHex = (s) => {
        try {
            if (regexPatterns.hexString.test(s) && s.length % 2 === 0) {
                return hexToBytes(s);
            }
        } catch (_) {}
        return null;
    };

    let packetBytes = null;

    // 确定性魔数特征优先匹配：
    // RSYN (0x52, 0x53, 0x59, 0x4E) 的 Base64 开头为 "UlNZ"，Hex 开头为 "5253594e"
    if (str.startsWith('UlNZ')) {
        packetBytes = parseAsBase64(str);
    } else if (str.toLowerCase().startsWith('5253594e')) {
        packetBytes = parseAsHex(str);
    }

    // 兜底双向尝试（先尝试 Base64，若解不出魔数则尝试 Hex）
    if (!packetBytes || packetBytes.length < 17 || packetBytes[0] !== 0x52 || packetBytes[1] !== 0x53 || packetBytes[2] !== 0x59 || packetBytes[3] !== 0x4E) {
        const b64Bytes = parseAsBase64(str);
        if (b64Bytes && b64Bytes.length >= 17 && b64Bytes[0] === 0x52 && b64Bytes[1] === 0x53 && b64Bytes[2] === 0x59 && b64Bytes[3] === 0x4E) {
            packetBytes = b64Bytes;
        } else {
            const hexBytes = parseAsHex(str);
            if (hexBytes && hexBytes.length >= 17 && hexBytes[0] === 0x52 && hexBytes[1] === 0x53 && hexBytes[2] === 0x59 && hexBytes[3] === 0x4E) {
                packetBytes = hexBytes;
            } else {
                packetBytes = b64Bytes || hexBytes;
            }
        }
    }

    if (!packetBytes) {
        throw new Error('无法识别 Manifest 密文编码');
    }

    return await decryptSnapshot(packetBytes, encKeyHex, userId, snapshotId);
}
