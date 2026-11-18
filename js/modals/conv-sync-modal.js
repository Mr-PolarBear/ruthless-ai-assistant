/**
 * conv-sync-modal.js
 * 单会话专属云同步弹窗业务调度器 (Plan A 架构)
 *
 * — 为什么独立抽取此模块 —
 * 1. 遵循 AGENTS.md 模块化架构铁律：防止已近 1600 行的 sync-modal.js 与 chat-events.js 无节制膨胀。
 * 2. 专属时间线聚合：内存中仅拉取并精准过滤包含当前 convId 的云端快照，无论来自单会话快照还是全量备份包均可回溯。
 * 3. 状态机自闭环：涵盖「未配置/未登录」、「已登录但密钥未解锁」、「就绪状态」三重防护体系，内联输入端到端密码极速解锁。
 * 4. 自驱动就地局部刷新：点击上传同步后，无需关闭弹窗或全量重绘，就地即刻拉取并高亮最新版本条目。
 */

import { state } from '../state.js?v=temp';
import { getConversation } from '../db.js?v=temp';
import { buildConversationBundle, generateManifest } from '../services/sync-bundle.js?v=temp';
import { getSyncSettings, listSnapshots, uploadSnapshot, deleteSnapshot, prelogin, login } from '../services/sync-client.js?v=temp';
import { encryptSnapshot, encryptManifest, decryptManifest, deriveKeysWithWorker, bytesToHex } from '../services/sync-crypto.js?v=temp';
import { getSyncItem, setSyncItem } from '../services/sync-store.js?v=temp';
import { escapeHtml } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { openSyncModal, applySnapshot } from './sync-modal.js?v=temp';

let modalOverlay = null;
let currentActiveConvId = null;

/**
 * 弹出提示辅助函数
 * @param {string} message - 提示文本
 * @param {boolean} [isError=false] - 是否为错误提示
 */
function showToast(message, isError = false) {
    if (notify) {
        if (isError) notify.error(message);
        else notify.success(message);
    } else if (window.notify) {
        if (isError) window.notify.error(message);
        else window.notify.success(message);
    } else {
        alert(message);
    }
}

/**
 * 设置弹窗内的加载遮罩
 * @param {boolean} active - 是否激活遮罩
 * @param {string} [message='正在处理中...'] - 提示文本
 */
function setConvLoading(active, message = '正在处理中...') {
    const overlay = document.getElementById('conv-sync-loading-overlay');
    const msgEl = document.getElementById('conv-sync-loading-message');
    if (!overlay) return;

    if (active) {
        if (msgEl) msgEl.textContent = message;
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

/**
 * 获取或创建单例弹窗 DOM 结构
 * @returns {HTMLElement}
 */
function getOrCreateModalOverlay() {
    if (modalOverlay) return modalOverlay;

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'conv-sync-modal-overlay';
    modalOverlay.className = 'conv-sync-modal-overlay';

    modalOverlay.innerHTML = `
        <div class="conv-sync-modal-container" role="dialog" aria-modal="true">
            <!-- 头部 -->
            <div class="conv-sync-header">
                <div class="conv-sync-header-title">
                    <svg class="conv-sync-header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                    </svg>
                    <span>会话云端同步 (E2EE)</span>
                </div>
                <button type="button" class="conv-sync-close-btn" id="conv-sync-close-btn" title="关闭">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <!-- 主内容动态插槽 -->
            <div class="conv-sync-body" id="conv-sync-body">
                <!-- 动态由 renderModalContent 渲染 -->
            </div>

            <!-- 弹窗内部 Loading 遮罩 -->
            <div id="conv-sync-loading-overlay" class="conv-sync-loading-overlay">
                <div class="conv-sync-spinner"></div>
                <div id="conv-sync-loading-message" class="conv-sync-loading-text">正在处理...</div>
            </div>
        </div>
    `;

    // 绑定关闭按钮事件
    const closeBtn = modalOverlay.querySelector('#conv-sync-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeConvSyncModal);
    }

    // 绑定遮罩外点击关闭
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeConvSyncModal();
        }
    });

    // 绑定 ESC 关闭
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
            closeConvSyncModal();
        }
    });

    document.body.appendChild(modalOverlay);
    return modalOverlay;
}

/**
 * 提取当前会话的元信息
 * @param {string} convId - 会话ID
 * @returns {Promise<{ id: string, title: string, floorCount: number, lastModifiedStr: string, hasRealtime: boolean }|null>}
 */
async function getConvMetadata(convId) {
    if (!convId) return null;

    let conv = state.conversations ? state.conversations[convId] : null;
    if (!conv) {
        try {
            conv = await getConversation(convId);
        } catch (err) {
            console.error('[conv-sync-modal] 读取会话异常:', err);
            return null;
        }
    }

    if (!conv || conv.isDeleted) return null;

    let floorCount = 0;
    if (Array.isArray(conv.branches) && conv.branches.length > 0) {
        const activeIdx = (typeof conv.activeBranchIndex === 'number') ? conv.activeBranchIndex : 0;
        const branch = conv.branches[activeIdx] || conv.branches[0];
        if (Array.isArray(branch)) {
            floorCount = branch.length;
        } else if (branch && Array.isArray(branch.messages)) {
            floorCount = branch.messages.length;
        }
    } else if (Array.isArray(conv.messages)) {
        floorCount = conv.messages.length;
    }

    let lastModifiedStr = '未知';
    const rawTime = conv.lastModified || conv.createdAt || conv.importedAt;
    if (rawTime) {
        try {
            lastModifiedStr = new Date(rawTime).toLocaleString();
        } catch (_) {
            lastModifiedStr = String(rawTime);
        }
    }

    return {
        id: conv.id || convId,
        title: conv.title || '未命名对话',
        floorCount,
        lastModifiedStr,
        hasRealtime: !!(conv.realtimeMode && conv.realtimeMode.enabled)
    };
}

/**
 * 渲染弹窗主内容（三态状态机）
 * @param {string} convId - 会话ID
 * @param {object} convMeta - 会话元数据
 */
async function renderModalContent(convId, convMeta) {
    const bodyEl = document.getElementById('conv-sync-body');
    if (!bodyEl) return;

    const settings = getSyncSettings();
    const token = await getSyncItem('token');

    // 状态 A：未配置服务器或未登录
    if (!settings.serverUrl || !token || !settings.username) {
        bodyEl.innerHTML = `
            <div class="conv-sync-meta-card">
                <div class="conv-sync-meta-title-row">
                    <span class="conv-sync-meta-title-text" title="${escapeHtml(convMeta.title)}">${escapeHtml(convMeta.title)}</span>
                    <span class="conv-sync-badge conv-sync-badge-floor">${convMeta.floorCount} 楼</span>
                    ${convMeta.hasRealtime ? '<span class="conv-sync-badge conv-sync-badge-realtime">实时</span>' : ''}
                </div>
                <div class="conv-sync-meta-sub-row">
                    <span>最后更新：${escapeHtml(convMeta.lastModifiedStr)}</span>
                </div>
            </div>

            <div class="conv-sync-state-card">
                <svg class="conv-sync-state-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                </svg>
                <div class="conv-sync-state-title">未配置云同步服务或未登录</div>
                <div class="conv-sync-state-desc">
                    云端同步使用零知识端到端加密（E2EE），需要先连接您的同步节点并登录账号。
                </div>
                <button type="button" class="conv-sync-btn-sm conv-sync-btn-primary" id="conv-sync-goto-settings-btn" style="padding: 7px 16px; margin-top: 4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    前往配置 / 登录
                </button>
            </div>
        `;

        const gotoBtn = bodyEl.querySelector('#conv-sync-goto-settings-btn');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', () => {
                closeConvSyncModal();
                openSyncModal();
            });
        }
        return;
    }

    // 状态 B：已登录，但端到端主密钥未解锁
    let encKeyHex = await getSyncItem('encKeyHex');
    if (!encKeyHex) {
        bodyEl.innerHTML = `
            <div class="conv-sync-meta-card">
                <div class="conv-sync-meta-title-row">
                    <span class="conv-sync-meta-title-text" title="${escapeHtml(convMeta.title)}">${escapeHtml(convMeta.title)}</span>
                    <span class="conv-sync-badge conv-sync-badge-floor">${convMeta.floorCount} 楼</span>
                    ${convMeta.hasRealtime ? '<span class="conv-sync-badge conv-sync-badge-realtime">实时</span>' : ''}
                </div>
                <div class="conv-sync-meta-sub-row">
                    <span>当前账号：<strong>${escapeHtml(settings.username || '未知')}</strong></span>
                    <span>·</span>
                    <span>最后更新：${escapeHtml(convMeta.lastModifiedStr)}</span>
                </div>
            </div>

            <div class="conv-sync-state-card">
                <svg class="conv-sync-state-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <div class="conv-sync-state-title">端到端加密密钥未解锁</div>
                <div class="conv-sync-state-desc">
                    请输入您的云同步主密码，在本地浏览器派生解密密钥，即可安全访问该会话的历史快照。
                </div>
                <form class="conv-sync-inline-form" id="conv-sync-unlock-form" onsubmit="return false;">
                    <input type="password" id="conv-sync-unlock-password" class="conv-sync-inline-input" placeholder="请输入云同步主密码" autocomplete="current-password" required />
                    <button type="submit" class="conv-sync-btn-sm conv-sync-btn-primary" id="conv-sync-unlock-btn">
                        解锁
                    </button>
                </form>
                <div id="conv-sync-unlock-error" style="font-size: 11px; color: var(--danger-color, #ef4444); display: none;"></div>
            </div>
        `;

        const unlockForm = bodyEl.querySelector('#conv-sync-unlock-form');
        const unlockInput = bodyEl.querySelector('#conv-sync-unlock-password');
        const unlockBtn = bodyEl.querySelector('#conv-sync-unlock-btn');
        const unlockErr = bodyEl.querySelector('#conv-sync-unlock-error');

        if (unlockForm && unlockInput && unlockBtn) {
            unlockForm.addEventListener('submit', async () => {
                const password = unlockInput.value;
                if (!password) {
                    showToast('请输入主密码', true);
                    return;
                }

                try {
                    unlockBtn.disabled = true;
                    if (unlockErr) unlockErr.style.display = 'none';
                    setConvLoading(true, '正在安全派生加密密钥...');

                    const pre = await prelogin(settings.username);
                    const derived = await deriveKeysWithWorker(password, pre.kdfSalt, pre.kdfIter, (pct) => {
                        setConvLoading(true, `正在派生安全密钥: ${pct}%`);
                    });

                    setConvLoading(true, '正在向云端校验密码身份...');
                    await login({
                        username: settings.username,
                        authHash: derived.authHashHex,
                        deviceName: settings.deviceName || 'Web端'
                    });

                    // 校验成功，将 encKeyHex 存入独立 IndexedDB
                    await setSyncItem('encKeyHex', derived.encKeyHex);
                    setConvLoading(false);
                    showToast('密钥解锁成功！');

                    // 立即重新自驱动渲染就绪界面
                    await renderModalContent(convId, convMeta);
                } catch (err) {
                    setConvLoading(false);
                    unlockBtn.disabled = false;
                    const errText = err.message || '主密码校验失败';
                    if (unlockErr) {
                        unlockErr.textContent = errText;
                        unlockErr.style.display = 'block';
                    }
                    showToast(errText, true);
                }
            });
        }
        return;
    }

    // 状态 C：就绪态 (Ready)
    bodyEl.innerHTML = `
        <!-- 会话卡片 -->
        <div class="conv-sync-meta-card">
            <div class="conv-sync-meta-title-row">
                <span class="conv-sync-meta-title-text" id="conv-sync-card-title" title="${escapeHtml(convMeta.title)}">${escapeHtml(convMeta.title)}</span>
                <span class="conv-sync-badge conv-sync-badge-floor" id="conv-sync-card-floor">${convMeta.floorCount} 楼</span>
                ${convMeta.hasRealtime ? '<span class="conv-sync-badge conv-sync-badge-realtime">实时</span>' : ''}
            </div>
            <div class="conv-sync-meta-sub-row">
                <span>设备：<strong>${escapeHtml(settings.deviceName || '本机')}</strong></span>
                <span>·</span>
                <span id="conv-sync-card-time">最后更新：${escapeHtml(convMeta.lastModifiedStr)}</span>
            </div>
        </div>

        <!-- 主操作按钮 (立即上传) -->
        <div class="conv-sync-action-card">
            <button type="button" class="conv-sync-main-upload-btn" id="conv-sync-upload-now-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
                    <path d="M12 12v9"/>
                    <path d="m16 16-4-4-4 4"/>
                </svg>
                <span>立即上传同步到云端 (E2EE)</span>
            </button>
            <div class="conv-sync-e2ee-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>端到端加密保护 (AES-256-GCM)，云端仅存储密文包</span>
            </div>
        </div>

        <!-- 专属历史快照时间线 -->
        <div class="conv-sync-timeline-section">
            <div class="conv-sync-timeline-header">
                <span>云端版本记录</span>
                <button type="button" class="conv-sync-refresh-btn" id="conv-sync-refresh-list-btn" title="刷新云端版本列表">
                    <svg class="conv-sync-refresh-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                        <path d="M21 3v5h-5"/>
                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                        <path d="M8 16H3v5"/>
                    </svg>
                    <span>刷新</span>
                </button>
            </div>
            <div class="conv-sync-timeline-list" id="conv-sync-timeline-container">
                <!-- 动态由 loadConvTimeline 填充 -->
            </div>
        </div>
    `;

    // 绑定主上传事件
    const uploadBtn = bodyEl.querySelector('#conv-sync-upload-now-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            await handleUploadConversation(convId, convMeta, encKeyHex, settings);
        });
    }

    // 绑定刷新时间线事件
    const refreshBtn = bodyEl.querySelector('#conv-sync-refresh-list-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await loadConvTimeline(convId, encKeyHex, settings, convMeta);
        });
    }

    // 初始加载专属快照版本时间线
    await loadConvTimeline(convId, encKeyHex, settings, convMeta);
}

/**
 * 执行单会话加密上传逻辑
 * @param {string} convId - 会话ID
 * @param {object} convMeta - 会话元数据
 * @param {string} encKeyHex - 加密密钥Hex
 * @param {object} settings - 用户配置
 */
async function handleUploadConversation(convId, convMeta, encKeyHex, settings) {
    const uploadBtn = document.getElementById('conv-sync-upload-now-btn');
    if (uploadBtn) uploadBtn.disabled = true;

    try {
        setConvLoading(true, `正在打包会话【${convMeta.title}】...`);
        const bundle = await buildConversationBundle([convId]);

        setConvLoading(true, '正在提取轻量 Manifest 清单...');
        const manifest = generateManifest(bundle, settings.deviceName || 'Web端', 'v1.0.0');

        const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        setConvLoading(true, '正在使用 AES-256-GCM 加密会话包...');
        const encryptedPacket = await encryptSnapshot(bundle, encKeyHex, settings.userId, snapshotId);

        setConvLoading(true, '正在加密 Manifest 清单...');
        const encManifestBase64 = await encryptManifest(manifest, encKeyHex, settings.userId, snapshotId);

        let sha256Hex = '';
        if (window.crypto && window.crypto.subtle) {
            const hashBuf = await window.crypto.subtle.digest('SHA-256', encryptedPacket);
            sha256Hex = bytesToHex(new Uint8Array(hashBuf));
        }

        setConvLoading(true, '正在极速上传至云端...');
        const meta = {
            snapshotId,
            formatVersion: 1,
            size: encryptedPacket.byteLength,
            sha256: sha256Hex,
            encManifest: encManifestBase64,
            conversationCount: 1
        };

        await uploadSnapshot(meta, encryptedPacket);

        setConvLoading(false);
        showToast(`会话【${convMeta.title}】已成功同步至云端！`);

        // 自驱动立即就地局部刷新下方时间线列表
        await loadConvTimeline(convId, encKeyHex, settings, convMeta);

        // 上传完成后同步刷新顶层元数据卡片
        const freshMeta = await getConvMetadata(convId);
        if (freshMeta) {
            const titleEl = document.getElementById('conv-sync-card-title');
            const floorEl = document.getElementById('conv-sync-card-floor');
            const timeEl = document.getElementById('conv-sync-card-time');
            if (titleEl) titleEl.textContent = freshMeta.title;
            if (floorEl) floorEl.textContent = `${freshMeta.floorCount} 楼`;
            if (timeEl) timeEl.textContent = `最后更新：${freshMeta.lastModifiedStr}`;
        }
    } catch (err) {
        setConvLoading(false);
        showToast(`云同步失败: ${err.message}`, true);
    } finally {
        if (uploadBtn) uploadBtn.disabled = false;
    }
}

/**
 * 加载并渲染专属于当前会话的云端历史快照列表
 * @param {string} convId - 会话ID
 * @param {string} encKeyHex - 加密密钥
 * @param {object} settings - 用户配置
 * @param {object} [convMeta=null] - 会话元数据
 */
async function loadConvTimeline(convId, encKeyHex, settings, convMeta = null) {
    const container = document.getElementById('conv-sync-timeline-container');
    if (!container) return;

    const refreshBtn = document.getElementById('conv-sync-refresh-list-btn');
    const refreshIcon = refreshBtn?.querySelector('.conv-sync-refresh-icon');
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.classList.add('conv-sync-spin');

    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">正在加载专属快照版本...</div>';

    try {
        // 与主面板分页对齐，单次获取前 100 条云端快照
        const res = await listSnapshots(0, 100);
        // 异步竞态守卫：若在请求期间弹窗已切换会话或关闭，静默中止，防止脏数据覆盖
        if (currentActiveConvId !== convId) return;

        const items = res.items || [];

        if (items.length === 0) {
            container.innerHTML = `
                <div class="conv-sync-empty-card">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                    </svg>
                    <div>云端暂无快照备份记录</div>
                </div>
            `;
            return;
        }

        // 1. 批量解密 manifest 并精准筛选包含当前 convId 的条目
        const matchedSnapshots = [];
        for (const item of items) {
            let manifest = null;
            if (encKeyHex && item.encManifest) {
                try {
                    manifest = await decryptManifest(item.encManifest, encKeyHex, settings.userId, item.id);
                } catch (e) {
                    console.warn('[conv-sync-modal] 解密 manifest 异常:', e);
                }
            }

            const convList = (manifest && Array.isArray(manifest.conversations)) ? manifest.conversations : [];
            // 筛选当前会话（同时匹配 id 与 sourceConvId 双向契约）
            const matchedConv = convList.find(c => c && (String(c.id) === String(convId) || String(c.sourceConvId) === String(convId)));

            if (matchedConv) {
                matchedSnapshots.push({
                    item,
                    manifest,
                    conv: matchedConv,
                    createdAt: item.createdAt
                });
            } else if (convList.length === 1 && convList[0] && !convList[0].id && !convList[0].sourceConvId && convMeta && convList[0].title === convMeta.title) {
                // — 为什么这么写 —
                // 安全兜底：老版本单会话快照若缺省 ID 但标题与当前会话完全一致，予以安全纳入专属时间线，
                // 彻底解决悬空死代码并实现无缝向后兼容。
                matchedSnapshots.push({
                    item,
                    manifest,
                    conv: convList[0],
                    createdAt: item.createdAt
                });
            }
        }

        // 2. 按时间降序排序（最新在前）
        matchedSnapshots.sort((a, b) => b.createdAt - a.createdAt);

        if (matchedSnapshots.length === 0) {
            container.innerHTML = `
                <div class="conv-sync-empty-card">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <div>云端暂无此会话的专属备份记录</div>
                    <div style="font-size: 11px; opacity: 0.8;">点击上方按钮即可创建第一个云端 E2EE 版本</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        // 3. 渲染版本条目
        matchedSnapshots.forEach((entry, idx) => {
            const item = entry.item;
            const conv = entry.conv;
            const isLatest = idx === 0;
            const isMulti = item.conversationCount > 1 || (entry.manifest && Array.isArray(entry.manifest.conversations) && entry.manifest.conversations.length > 1);
            const convCount = item.conversationCount || (entry.manifest && entry.manifest.conversations?.length) || 1;
            const versionNumber = matchedSnapshots.length - idx;
            const dateStr = new Date(item.createdAt * 1000).toLocaleString();
            const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
            const floorCount = conv ? (conv.floorCount || 0) : '?';

            const itemEl = document.createElement('div');
            itemEl.className = 'conv-sync-version-item';
            itemEl.innerHTML = `
                <div class="conv-sync-version-top">
                    <div class="conv-sync-version-badges">
                        <span style="font-size:11px; font-weight:600; color:var(--text-muted);">#${versionNumber}</span>
                        ${isLatest ? '<span class="conv-sync-badge conv-sync-badge-latest">最新版</span>' : ''}
                        ${isMulti ? `<span class="conv-sync-badge conv-sync-badge-multi" title="包含 ${convCount} 个会话的整包备份">整包备份 (${convCount})</span>` : ''}
                        <span class="conv-sync-version-date">${escapeHtml(dateStr)}</span>
                        ${conv && conv.hasRealtime ? '<span class="conv-sync-badge conv-sync-badge-realtime">实时</span>' : ''}
                    </div>
                    <span class="conv-sync-badge conv-sync-badge-floor">${floorCount} 楼</span>
                </div>
                <div class="conv-sync-version-bottom">
                    <div class="conv-sync-version-meta">
                        <span>[${escapeHtml(item.deviceName || '未知设备')}]</span>
                        <span>·</span>
                        <span>${sizeMB} MB</span>
                    </div>
                    <div class="conv-sync-version-actions">
                        <button type="button" class="conv-sync-btn-sm conv-sync-btn-primary conv-sync-load-btn" data-snapshot-id="${item.id}" title="将此版本同步加载到本地（支持覆盖备份与副本选择）">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            <span>加载此版</span>
                        </button>
                        <button type="button" class="conv-sync-btn-sm conv-sync-btn-danger conv-sync-del-btn" data-snapshot-id="${item.id}" title="从云端彻底删除此快照并释放配额">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"/>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                            </svg>
                            <span>删除</span>
                        </button>
                    </div>
                </div>
            `;

            // 绑定加载版本事件
            const loadBtn = itemEl.querySelector('.conv-sync-load-btn');
            if (loadBtn) {
                loadBtn.addEventListener('click', async () => {
                    const snapId = loadBtn.getAttribute('data-snapshot-id');
                    if (!snapId) return;
                    loadBtn.disabled = true;
                    try {
                        const result = await applySnapshot(snapId, convId);
                        if (result && result.success) {
                            // 刷新元数据卡片
                            const updatedMeta = await getConvMetadata(convId);
                            if (updatedMeta) {
                                const titleEl = document.getElementById('conv-sync-card-title');
                                const floorEl = document.getElementById('conv-sync-card-floor');
                                const timeEl = document.getElementById('conv-sync-card-time');
                                if (titleEl) titleEl.textContent = updatedMeta.title;
                                if (floorEl) floorEl.textContent = `${updatedMeta.floorCount} 楼`;
                                if (timeEl) timeEl.textContent = `最后更新：${updatedMeta.lastModifiedStr}`;
                            }
                        }
                    } catch (err) {
                        showToast('同步加载版本失败: ' + err.message, true);
                    } finally {
                        loadBtn.disabled = false;
                    }
                });
            }

            // 绑定删除快照事件
            const delBtn = itemEl.querySelector('.conv-sync-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', async () => {
                    const snapId = delBtn.getAttribute('data-snapshot-id');
                    if (!snapId) return;

                    let confirmMsg = '确定要从云端彻底删除该快照吗？\n\n• 该操作不可撤销；\n• 对应占用的云端存储配额将立即全额释放。';
                    if (isMulti) {
                        confirmMsg = `⚠️ 警告：该快照属于包含 ${convCount} 个会话的整包备份！\n\n• 从云端删除它将导致该包内的所有 ${convCount} 个会话备份一同被彻底删除；\n• 该操作不可撤销，且会释放云端配额。\n\n确定仍要彻底删除整个备份包吗？`;
                    }

                    if (!confirm(confirmMsg)) {
                        return;
                    }

                    try {
                        setConvLoading(true, '正在从云端删除快照...');
                        await deleteSnapshot(snapId);
                        setConvLoading(false);
                        showToast('云端快照已成功删除，配额已释放');
                        await loadConvTimeline(convId, encKeyHex, settings, convMeta);
                    } catch (err) {
                        setConvLoading(false);
                        showToast('删除快照失败: ' + err.message, true);
                    }
                });
            }

            container.appendChild(itemEl);
        });
    } catch (err) {
        container.innerHTML = `
            <div style="color:var(--danger-color, #ef4444);padding:14px;font-size:12px;text-align:center;">
                获取专属快照失败: ${escapeHtml(err.message || '未知错误')}
            </div>
        `;
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.classList.remove('conv-sync-spin');
    }
}

/**
 * 打开单会话专属云同步弹窗
 * @param {string} convId - 会话ID
 */
export async function openConvSyncModal(convId) {
    if (!convId) {
        showToast('会话ID无效', true);
        return;
    }

    const convMeta = await getConvMetadata(convId);
    if (!convMeta) {
        showToast('本地未找到该会话或已被移入回收站', true);
        return;
    }

    currentActiveConvId = convId;
    const overlay = getOrCreateModalOverlay();
    overlay.classList.add('open');

    // 渲染弹窗三态与初始数据
    await renderModalContent(convId, convMeta);
}

/**
 * 关闭单会话专属云同步弹窗
 */
export function closeConvSyncModal() {
    if (modalOverlay) {
        modalOverlay.classList.remove('open');
    }
    currentActiveConvId = null;
}
