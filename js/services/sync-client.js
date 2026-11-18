/**
 * sync-client.js
 * 负责与 sync-server 进行网络交互的 HTTP 客户端。
 *
 * — 为什么这么设计 —
 * 1. 集中管理 Base URL 与令牌自动注入，避免在业务弹窗中散落 fetch 调用。
 * 2. 统一超时熔断机制 (AbortController)，杜绝网络不通时死等导致界面冻结。
 * 3. 错误码语义化：将后端统一错误码（如 QUOTA_EXCEEDED、ACCOUNT_LOCKED）转换为用户可读提示。
 */

import { getSyncItem, setSyncItem, clearSyncCredentials } from './sync-store.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';

const SETTINGS_KEY = 'ai-chat-sync-settings-v1';

/**
 * 获取本地存储的配置
 * @returns {{ serverUrl: string, username: string, deviceName: string, deviceId: string, userId: string }}
 */
export function getSyncSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? JSON.parse(raw) : { serverUrl: '', username: '', deviceName: '', deviceId: '', userId: '', enableAiRelay: false };
    } catch (_) {
        return { serverUrl: '', username: '', deviceName: '', deviceId: '', userId: '', enableAiRelay: false };
    }
}

/**
 * 保存本地同步设置
 */
export function saveSyncSettings(settings) {
    const current = getSyncSettings();
    const updated = { ...current, ...settings };
    // 自动清理末尾斜杠
    if (updated.serverUrl) {
        updated.serverUrl = updated.serverUrl.trim().replace(regexPatterns.trailingSlash, '');
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
}

/**
 * 发起统一带鉴权与超时的 fetch 请求
 */
async function request(path, options = {}, timeoutMs = 15000) {
    const settings = getSyncSettings();
    const serverUrl = (options.customUrl || settings.serverUrl || '').trim().replace(regexPatterns.trailingSlash, '');

    if (!serverUrl) {
        throw new Error('未配置同步服务器地址，请先填写并测试连接');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = { ...(options.headers || {}) };
    if (!headers['Authorization']) {
        const token = await getSyncItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }

    const url = `${serverUrl}${path}`;

    try {
        const resp = await fetch(url, {
            ...options,
            headers,
            signal: controller.signal
        });

        clearTimeout(timer);

        // 如果是二进制下载
        if (options.responseType === 'blob') {
            if (!resp.ok) {
                const errJson = await resp.json().catch(() => ({}));
                throw new Error(errJson.message || `下载失败 (${resp.status})`);
            }
            return await resp.blob();
        }

        const data = await resp.json().catch(() => null);

        if (!resp.ok || !data || data.ok === false) {
            let msg = data && data.message ? data.message : '';
            if (!msg) {
                if (resp.status === 507) {
                    msg = '服务端总存储空间已达上限 (507 Insufficient Storage)，暂无法上传新快照，请联系管理员扩容';
                } else if (resp.status === 413) {
                    msg = '快照体积超出服务端单包限制 (413 Payload Too Large)';
                } else if (resp.status === 409) {
                    msg = '快照已存在或并发写入冲突 (409 Conflict)';
                } else {
                    msg = `请求失败 (${resp.status})`;
                }
            }
            const err = new Error(msg);
            err.code = data && data.code ? data.code : (resp.status === 507 ? 'SERVER_STORAGE_FULL' : 'HTTP_ERROR');
            err.status = resp.status;
            throw err;
        }

        return data.data;
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            throw new Error('网络请求超时，请检查服务器地址是否可达');
        }
        if (err.message && err.message.includes('Failed to fetch')) {
            throw new Error('无法连接到服务器，可能存在网络不通、CORS 拦截或内网自签证书未信任问题');
        }
        throw err;
    }
}

/**
 * 测试服务器连通性 (GET /api/health)
 *
 * @param {string} customUrl - 待测试的服务器地址
 * @returns {Promise<{ ok: boolean, version: string }>}
 */
export async function testServerConnection(customUrl) {
    const cleanUrl = (customUrl || '').trim().replace(regexPatterns.trailingSlash, '');
    return await request('/api/health', { method: 'GET', customUrl: cleanUrl }, 6000);
}

/**
 * 预登录获取用户 Salt 与迭代次数 (POST /api/auth/prelogin)
 */
export async function prelogin(username) {
    return await request('/api/auth/prelogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
    });
}

/**
 * 用户注册 (POST /api/auth/register)
 */
export async function register({ inviteCode, username, kdfSalt, kdfIter, authHash, deviceName }) {
    const data = await request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode, username, kdfSalt, kdfIter, authHash, deviceName })
    });

    if (data && data.token) {
        await setSyncItem('token', data.token);
        saveSyncSettings({ username, userId: data.userId, deviceId: data.deviceId, deviceName });
    }

    return data;
}

/**
 * 用户登录 (POST /api/auth/login)
 */
export async function login({ username, authHash, deviceName }) {
    const data = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, authHash, deviceName })
    });

    if (data && data.token) {
        await setSyncItem('token', data.token);
        saveSyncSettings({ username, userId: data.userId, deviceId: data.deviceId, deviceName });
    }

    return data;
}

/**
 * 退出当前设备 (POST /api/auth/logout)
 */
export async function logout() {
    try {
        await request('/api/auth/logout', { method: 'POST' }, 5000);
    } catch (_) {
        // 即使服务端报错，本地也强制清理
    }
    await clearSyncCredentials();
    saveSyncSettings({ username: '', userId: '', deviceId: '' });
}

/**
 * 获取设备列表 (GET /api/devices)
 */
export async function getDevices() {
    return await request('/api/devices', { method: 'GET' });
}

/**
 * 吊销指定设备 (DELETE /api/devices/{id})
 */
export async function revokeDevice(deviceId) {
    return await request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
}

/**
 * 获取账户与配额信息 (GET /api/account)
 */
export async function getAccount() {
    return await request('/api/account', { method: 'GET' });
}

/**
 * 上传快照密文 (POST /api/snapshots)
 *
 * @param {Object} meta - { snapshotId, formatVersion, size, sha256, encManifest }
 * @param {Blob|Uint8Array} blob - 密文二进制
 * @returns {Promise<{ snapshotId: string, createdAt: number }>}
 */
export async function uploadSnapshot(meta, blob) {
    const formData = new FormData();
    formData.append('meta', JSON.stringify(meta));
    const fileBlob = blob instanceof Blob ? blob : new Blob([blob], { type: 'application/octet-stream' });
    formData.append('blob', fileBlob, `${meta.snapshotId}.bin`);

    return await request('/api/snapshots', {
        method: 'POST',
        body: formData
    }, 120000); // 上传允许 120 秒超时
}

/**
 * 获取快照列表 (GET /api/snapshots)
 */
export async function listSnapshots(cursor = 0, limit = 20) {
    let query = `?limit=${limit}`;
    if (cursor > 0) query += `&cursor=${cursor}`;
    return await request(`/api/snapshots${query}`, { method: 'GET' });
}

/**
 * 下载快照二进制 (GET /api/snapshots/{id})
 *
 * — Plan A 双路并发流式加速架构说明 —
 * 1. 2 路并发 Range 管道化 (2-Way Parallel Pipeline)：消除跨国高延迟（RTT 60-90ms）串行等待停顿，跑满带宽。
 * 2. 细粒度流式推进 (ReadableStream reader)：字节级心跳刷新（每收到 16~64KB 数据包即刻刷新），消灭 1MB/2MB 假死卡顿。
 * 3. 动态滑动窗口测速器 (SpeedTracker)：2 秒时间窗口平滑滤波，实时计算精确网速 (MB/s / KB/s) 与倒计时 (ETA 秒)。
 * 4. 容错自愈与回滚保护：单片独立 30 秒超时熔断与最多 3 次退避重试，偶发网络抖动只重传当片且精确回滚字节计数。
 * 5. 零破坏平滑降级：老版本服务端或无切片代理返回 200 OK 时无缝全量流式接收，100% 向下兼容。
 *
 * @param {string} snapshotId - 快照唯一标识
 * @param {Function} [onProgress] - 下载进度回调 (loadedBytes, totalBytes, speedBps, etaSeconds) => void
 * @returns {Promise<Uint8Array>} 组合完成的完整快照密文数据
 */
export async function downloadSnapshot(snapshotId, onProgress) {
    const settings = getSyncSettings();
    const serverUrl = (settings.serverUrl || '').trim().replace(regexPatterns.trailingSlash, '');
    if (!serverUrl) {
        throw new Error('未配置同步服务器地址，请先填写并测试连接');
    }

    const token = await getSyncItem('token');
    const baseHeaders = {};
    if (token) {
        baseHeaders['Authorization'] = `Bearer ${token}`;
    }

    const url = `${serverUrl}/api/snapshots/${encodeURIComponent(snapshotId)}`;
    const CHUNK_SIZE = 1572864;      // 1.5MB 弹性分片步长 (兼顾移动端抗弱网与高吞吐)
    const CHUNK_TIMEOUT_MS = 30000;  // 单分片超时 30 秒
    const MAX_RETRIES = 3;           // 单分片最大重试次数
    const CONCURRENCY = 2;           // 双路并发管道

    // 测速器：2 秒滑动窗口平滑计算瞬时网速
    class SpeedTracker {
        constructor(windowMs = 2000) {
            this.windowMs = windowMs;
            this.samples = [];
        }
        addSample(bytes) {
            const now = performance.now();
            this.samples.push({ time: now, bytes });
            const cutoff = now - this.windowMs;
            while (this.samples.length > 2 && this.samples[0].time < cutoff) {
                this.samples.shift();
            }
        }
        getSpeed() {
            if (this.samples.length < 2) return 0;
            const first = this.samples[0];
            const last = this.samples[this.samples.length - 1];
            const timeDiffSec = (last.time - first.time) / 1000;
            if (timeDiffSec <= 0.05) return 0;
            const bytesDiff = last.bytes - first.bytes;
            return Math.max(0, bytesDiff / timeDiffSec);
        }
    }

    const speedTracker = new SpeedTracker(2000);
    let globalLoadedBytes = 0;
    let totalBytes = 0;
    let lastNotifyTime = 0;

    /**
     * 限频触发进度回调 (最高约 15 FPS，杜绝高频刷新卡顿移动端主线程)
     */
    function notifyProgress(force = false) {
        const now = performance.now();
        if (!force && now - lastNotifyTime < 70) {
            return;
        }
        lastNotifyTime = now;
        if (typeof onProgress === 'function') {
            const speed = speedTracker.getSpeed();
            const eta = (speed > 0 && totalBytes > 0) ? Math.max(0, Math.ceil((totalBytes - globalLoadedBytes) / speed)) : 0;
            onProgress(globalLoadedBytes, totalBytes, speed, eta);
        }
    }

    /**
     * 单个分片安全请求辅助函数 (带 AbortController 超时熔断)
     */
    async function fetchRangeChunk(start, end) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
        try {
            const headers = { ...baseHeaders };
            if (typeof start === 'number' && typeof end === 'number') {
                headers['Range'] = `bytes=${start}-${end}`;
            }
            const resp = await fetch(url, {
                method: 'GET',
                headers,
                signal: controller.signal
            });
            clearTimeout(timer);
            return resp;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    /**
     * 片内细粒度流式读取 (ReadableStream)，每收到 16~64KB 即触发一次字节心跳
     */
    async function readResponseBody(resp, onBytesReceived) {
        if (resp.body && typeof resp.body.getReader === 'function') {
            const reader = resp.body.getReader();
            const parts = [];
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length > 0) {
                    parts.push(value);
                    received += value.length;
                    onBytesReceived(value.length);
                }
            }
            const buf = new Uint8Array(received);
            let offset = 0;
            for (const part of parts) {
                buf.set(part, offset);
                offset += part.length;
            }
            return buf;
        } else {
            const ab = await resp.arrayBuffer();
            const buf = new Uint8Array(ab);
            onBytesReceived(buf.length);
            return buf;
        }
    }

    // ==========================================
    // 步骤 1：探测首片 (Range: bytes=0-CHUNK_SIZE-1)，探知 Range 支持度与总文件大小
    // ==========================================
    let firstResp = null;
    let firstErr = null;
    let chunk0Buf = null;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
        let chunk0BytesReceived = 0;
        try {
            firstResp = await fetchRangeChunk(0, CHUNK_SIZE - 1);
            if (firstResp.status !== 206 && firstResp.status !== 200) {
                const errJson = await firstResp.json().catch(() => ({}));
                throw new Error(errJson.message || `下载失败 (${firstResp.status})`);
            }

            // 流式读取首片
            chunk0Buf = await readResponseBody(firstResp, (delta) => {
                chunk0BytesReceived += delta;
                globalLoadedBytes += delta;
                speedTracker.addSample(globalLoadedBytes);
                notifyProgress();
            });
            break;
        } catch (err) {
            firstErr = err;
            // 失败时回滚已记录的字节
            globalLoadedBytes -= chunk0BytesReceived;
            console.warn(`[云同步] 首分片下载遇到抖动 (第 ${retry + 1} 次尝试):`, err);
            if (retry < MAX_RETRIES - 1) {
                await new Promise(r => setTimeout(r, 800 * (retry + 1)));
            }
        }
    }

    if (!firstResp || !chunk0Buf) {
        throw new Error(firstErr && firstErr.name === 'AbortError'
            ? '连接同步服务器超时，请检查网络是否畅通'
            : `连接同步服务器失败: ${firstErr ? firstErr.message : '网络异常'}`);
    }

    // ==========================================
    // 分支 B：老服务端未启用 Range (返回 200 OK，已直接全量读完)
    // ==========================================
    if (firstResp.status === 200) {
        totalBytes = chunk0Buf.length;
        notifyProgress(true);
        return chunk0Buf;
    }

    // ==========================================
    // 分支 A：服务端支持 HTTP Range (返回 206 Partial Content)
    // ==========================================
    const contentRange = firstResp.headers.get('Content-Range') || '';
    const match = contentRange.match(regexPatterns.contentRange);
    if (match && match[3]) {
        totalBytes = parseInt(match[3], 10);
    } else {
        totalBytes = chunk0Buf.length;
    }

    const fullBuffer = new Uint8Array(totalBytes);
    fullBuffer.set(chunk0Buf, 0);
    notifyProgress(true);

    // 若总长度 <= 首片（文件小于等于 1.5MB），首片即全量，直接完成
    if (chunk0Buf.length >= totalBytes) {
        return fullBuffer;
    }

    // ==========================================
    // 步骤 2：规划剩余分片并启动【双路并发管道池】
    // ==========================================
    const remainingTasks = [];
    for (let offset = chunk0Buf.length; offset < totalBytes; offset += CHUNK_SIZE) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE - 1, totalBytes - 1);
        remainingTasks.push({ start: offset, end: chunkEnd });
    }

    let taskIndex = 0;

    async function runWorker() {
        while (taskIndex < remainingTasks.length) {
            const currentTask = remainingTasks[taskIndex++];
            const { start, end } = currentTask;

            let taskBuf = null;
            let lastErr = null;

            for (let retry = 0; retry < MAX_RETRIES; retry++) {
                let thisChunkReceived = 0;
                try {
                    const chunkResp = await fetchRangeChunk(start, end);
                    if (chunkResp.status !== 206 && chunkResp.status !== 200) {
                        const errJson = await chunkResp.json().catch(() => ({}));
                        throw new Error(errJson.message || `分片下载异常 (${chunkResp.status})`);
                    }

                    taskBuf = await readResponseBody(chunkResp, (delta) => {
                        thisChunkReceived += delta;
                        globalLoadedBytes += delta;
                        speedTracker.addSample(globalLoadedBytes);
                        notifyProgress();
                    });
                    break;
                } catch (err) {
                    lastErr = err;
                    globalLoadedBytes -= thisChunkReceived; // 容错回滚
                    console.warn(`[云同步] 并发分片 ${start}-${end} 下载抖动 (第 ${retry + 1} 次重试):`, err);
                    if (retry < MAX_RETRIES - 1) {
                        await new Promise(r => setTimeout(r, 800 * (retry + 1)));
                    }
                }
            }

            if (!taskBuf) {
                throw new Error(`下载快照分片中断 (字节范围 ${start}-${end}): ${lastErr ? lastErr.message : '弱网连接超时'}`);
            }

            fullBuffer.set(taskBuf, start);
        }
    }

    const workerCount = Math.min(CONCURRENCY, remainingTasks.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(runWorker());
    }

    await Promise.all(workers);

    // 最终 100% 确认通知
    globalLoadedBytes = totalBytes;
    notifyProgress(true);
    return fullBuffer;
}

/**
 * 删除快照 (DELETE /api/snapshots/{id})
 */
export async function deleteSnapshot(snapshotId) {
    return await request(`/api/snapshots/${encodeURIComponent(snapshotId)}`, {
        method: 'DELETE'
    });
}

/**
 * 批量删除快照密文并原子释放配额 (POST /api/snapshots/batch-delete)
 * @param {Array<string>} snapshotIds - 待删除的快照 ID 列表
 * @param {string} authHash - 客户端 PBKDF2 派生的 64 位 Hex 认证哈希 (用于高危操作二次鉴权)
 * @returns {Promise<{ deletedCount: number, freedBytes: number }>}
 */
export async function batchDeleteSnapshots(snapshotIds, authHash) {
    if (!Array.isArray(snapshotIds) || snapshotIds.length === 0) {
        throw new Error('请至少选择一个要清理的快照');
    }
    if (!authHash) {
        throw new Error('缺少安全验证凭据，无法执行批量清理');
    }
    return await request('/api/snapshots/batch-delete', {
        method: 'POST',
        body: JSON.stringify({
            snapshotIds,
            authHash
        })
    });
}

