/**
 * sync-modal.js
 * 云同步弹窗业务调度器 (严格遵循 Plan A 一体化状态机架构)
 *
 * — 为什么这么设计 —
 * 1. 状态机自闭环：未配置服务器、未登录、已登录并就绪三种状态平滑流转。
 * 2. 交互前置探测：输入服务器地址后必须先进行连通性探测 (/api/health)，避免用户在盲盒中操作。
 * 3. 密钥零接触：主密码派生完成后仅将 non-extractable 密匙存入 sync-store，主线程即刻销毁明文密码。
 */

import { state } from '../state.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';
import { getSyncSettings, saveSyncSettings, testServerConnection, prelogin, register, login, logout, getDevices, revokeDevice, getAccount, uploadSnapshot, listSnapshots, downloadSnapshot, deleteSnapshot, batchDeleteSnapshots } from '../services/sync-client.js?v=temp';
import { deriveKeysWithWorker, encryptSnapshot, decryptSnapshot, encryptManifest, decryptManifest, hexToBytes, bytesToHex } from '../services/sync-crypto.js?v=temp';
import { setSyncItem, getSyncItem, clearSyncCredentials } from '../services/sync-store.js?v=temp';
import { buildConversationBundle, generateManifest } from '../services/sync-bundle.js?v=temp';
import { importConversations, isConversationContentIdentical, escapeHtml, saveToLocalStorage } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

let isInitialized = false;
let currentTab = 'upload';
let cachedEncKeyHex = '';
let isBatchModeActive = false; // 是否开启快照时间线批量管理模式
const selectedBatchSnapshotMap = new Map(); // 存储已勾选的快照: snapshotId -> sizeBytes

/**
 * 显示/隐藏全屏 Loading
 */
function setLoading(active, message = '正在处理中...') {
    const convModal = document.getElementById('conv-sync-modal-overlay');
    const isConvActive = convModal && convModal.classList.contains('open');
    const overlay = isConvActive
        ? document.getElementById('conv-sync-loading-overlay')
        : document.getElementById('sync-loading-overlay');
    const msgEl = isConvActive
        ? document.getElementById('conv-sync-loading-message')
        : document.getElementById('sync-loading-message');
    if (!overlay) return;

    if (active) {
        if (msgEl) msgEl.textContent = message;
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

/**
 * 弹出提示
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
 * 初始化云同步弹窗交互事件
 */
export function initSyncModal() {
    if (isInitialized) return;
    isInitialized = true;

    const modal = document.getElementById('sync-modal');
    const closeBtn = document.getElementById('sync-modal-close-btn');

    // 关闭按钮
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSyncModal);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeSyncModal();
        });
    }

    // 1. 顶部服务器设置与账号状态事件
    const testServerBtn = document.getElementById('sync-test-server-btn');
    const serverUrlInput = document.getElementById('sync-server-url-input');
    const changeServerBtn = document.getElementById('sync-change-server-btn');
    const headerLogoutBtn = document.getElementById('sync-header-logout-btn');

    if (testServerBtn && serverUrlInput) {
        testServerBtn.addEventListener('click', async () => {
            const url = serverUrlInput.value.trim().replace(regexPatterns.trailingSlash, '');
            if (!url) {
                showToast('请输入有效的服务器地址', true);
                return;
            }
            if (!regexPatterns.syncServerUrl.test(url)) {
                showToast('服务器地址格式不正确 (需以 http:// 或 https:// 开头)', true);
                return;
            }

            setLoading(true, '正在探测服务器连通性...');
            try {
                const res = await testServerConnection(url);
                setLoading(false);
                saveSyncSettings({ serverUrl: url });
                updateServerStatusUI(true, `服务正常在线 (${res.version || 'v1.0.0'})`);
                showToast('连接测试成功！');
                refreshAuthAndMainPanes();
            } catch (err) {
                setLoading(false);
                updateServerStatusUI(false, '连接失败: ' + err.message);
                showToast(err.message, true);
            }
        });
    }

    if (changeServerBtn) {
        changeServerBtn.addEventListener('click', handleChangeServer);
    }

    if (headerLogoutBtn) {
        headerLogoutBtn.addEventListener('click', () => handleLogout(true));
    }

    // AI 后台任务中转开关事件监听
    const relayCheckbox = document.getElementById('sync-enable-ai-relay-checkbox');
    if (relayCheckbox) {
        relayCheckbox.addEventListener('change', () => {
            const enabled = relayCheckbox.checked;
            saveSyncSettings({ enableAiRelay: enabled });
            if (enabled) {
                // — 为什么这么写 —
                // 环境状态突变自愈：
                // 若用户此前在未配置云端时曾勾选过“记住本地总结”，开启中转后若不重置，用户将永久无法使用云端中转总结。
                // 开启中转时智能检测并将“总是本地”重置为“ask (每次询问)”，唤醒决策弹窗与云端中转选项。
                let hasReset = false;
                if (state.hideSummary) {
                    Object.keys(state.hideSummary).forEach(convId => {
                        const cfg = state.hideSummary[convId];
                        if (cfg && cfg.relayAutoSummaryPolicy === 'always_local') {
                            cfg.relayAutoSummaryPolicy = 'ask';
                            hasReset = true;
                        }
                    });
                }
                if (hasReset) {
                    saveToLocalStorage();
                    showToast('已开启 AI 后台任务中转保护 (自动总结已恢复为询问模式)');
                } else {
                    showToast('已开启 AI 后台任务中转保护');
                }
            } else {
                showToast('已关闭 AI 后台任务中转');
            }
            refreshAuthAndMainPanes();
        });
    }

    // 2. 账号 Tabs 切换（登录 / 注册）
    const switchLoginBtn = document.getElementById('sync-switch-login-btn');
    const switchRegBtn = document.getElementById('sync-switch-register-btn');
    const loginForm = document.getElementById('sync-login-form');
    const regForm = document.getElementById('sync-register-form');

    if (switchLoginBtn && switchRegBtn) {
        switchLoginBtn.addEventListener('click', () => {
            switchLoginBtn.className = 'sync-btn sync-btn-primary';
            switchRegBtn.className = 'sync-btn sync-btn-secondary';
            loginForm.style.display = 'flex';
            regForm.style.display = 'none';
        });

        switchRegBtn.addEventListener('click', () => {
            switchRegBtn.className = 'sync-btn sync-btn-primary';
            switchLoginBtn.className = 'sync-btn sync-btn-secondary';
            loginForm.style.display = 'none';
            regForm.style.display = 'flex';
        });
    }

    // 3. 登录与注册提交
    bindAuthActions();

    // 4. 主 Tabs 切换
    const tabsContainer = document.getElementById('sync-main-tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            const tabItem = e.target.closest('.sync-tab-item');
            if (!tabItem) return;
            const targetTab = tabItem.getAttribute('data-tab');
            switchMainTab(targetTab);
        });
    }

    // 5. 上传与下载业务事件
    bindUploadActions();
    bindDownloadActions();
    bindDeviceActions();
}

/**
 * 切换主功能 Tab
 */
function switchMainTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('#sync-main-tabs .sync-tab-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-tab') === tabName);
    });

    const panes = {
        upload: document.getElementById('sync-upload-pane'),
        download: document.getElementById('sync-download-pane'),
        devices: document.getElementById('sync-devices-pane')
    };

    Object.entries(panes).forEach(([k, pane]) => {
        if (pane) {
            pane.classList.toggle('active', k === tabName);
        }
    });

    if (tabName === 'upload') renderUploadConversationList();
    if (tabName === 'download') loadSnapshotTimeline();
    if (tabName === 'devices') loadDeviceAndQuotaInfo();
}

/**
 * 更新顶部服务器状态指示器
 */
function updateServerStatusUI(online, text) {
    const dot = document.getElementById('sync-server-status-dot');
    const textEl = document.getElementById('sync-server-status-text');
    const certLink = document.getElementById('sync-cert-test-link');
    const input = document.getElementById('sync-server-url-input');

    if (dot) {
        dot.className = online ? 'sync-status-indicator online' : 'sync-status-indicator offline';
    }
    if (textEl) textEl.textContent = text;
    if (certLink && input) {
        certLink.href = input.value.trim() || '#';
    }
}

/**
 * 绑定登录与注册动作
 */
function bindAuthActions() {
    const submitLoginBtn = document.getElementById('sync-submit-login-btn');
    const submitRegBtn = document.getElementById('sync-submit-register-btn');

    if (submitLoginBtn) {
        submitLoginBtn.addEventListener('click', async () => {
            const username = document.getElementById('sync-login-username').value.trim();
            const password = document.getElementById('sync-login-password').value;
            const deviceName = document.getElementById('sync-login-device-name').value.trim() || '桌面客户端';

            if (!username) {
                showToast('请输入用户名', true);
                return;
            }
            if (!password) {
                showToast('请输入主密码', true);
                return;
            }

            try {
                setLoading(true, '正在安全获取加密参数...');
                const pre = await prelogin(username);

                setLoading(true, '正在派生端到端主密钥 (Worker 执行中)...');
                const derived = await deriveKeysWithWorker(password, pre.kdfSalt, pre.kdfIter, (pct) => {
                    setLoading(true, `正在派生安全密钥: ${pct}%`);
                });

                setLoading(true, '正在向服务器验证身份...');
                await login({
                    username,
                    authHash: derived.authHashHex,
                    deviceName
                });

                // 将 encKeyHex 存入独立 IndexedDB
                cachedEncKeyHex = derived.encKeyHex;
                await setSyncItem('encKeyHex', derived.encKeyHex);

                setLoading(false);
                showToast(`欢迎回来，${username}！云同步就绪`);
                refreshAuthAndMainPanes();
            } catch (err) {
                setLoading(false);
                showToast(err.message, true);
            }
        });
    }

    if (submitRegBtn) {
        submitRegBtn.addEventListener('click', async () => {
            const inviteCode = document.getElementById('sync-reg-invite').value.trim();
            const username = document.getElementById('sync-reg-username').value.trim();
            const password = document.getElementById('sync-reg-password').value;
            const confirmPassword = document.getElementById('sync-reg-confirm-password').value;
            const deviceName = document.getElementById('sync-reg-device-name').value.trim() || '首选设备';

            if (!inviteCode) {
                showToast('请先填写注册邀请码', true);
                return;
            }
            if (!username) {
                showToast('请填写用户名', true);
                return;
            }
            if (!regexPatterns.syncUsername.test(username)) {
                showToast('用户名格式不正确：仅支持 3~32 位英文字母、数字或下划线', true);
                return;
            }
            if (!password) {
                showToast('请设置主密码', true);
                return;
            }
            if (password.length < 6) {
                showToast('主密码长度不能少于 6 位', true);
                return;
            }
            if (!confirmPassword) {
                showToast('请再次输入确认主密码', true);
                return;
            }
            if (password !== confirmPassword) {
                showToast('两次输入的主密码不一致，请重新检查', true);
                return;
            }

            const confirmBackupCb = document.getElementById('sync-confirm-backup-checkbox');
            if (confirmBackupCb && !confirmBackupCb.checked) {
                showToast('请先确认已备份好账号密码并勾选确认框', true);
                return;
            }

            try {
                setLoading(true, '正在生成安全客户端 Salt...');
                const saltBytes = new Uint8Array(16);
                window.crypto.getRandomValues(saltBytes);
                const saltHex = bytesToHex(saltBytes);

                setLoading(true, '正在派生端到端主密钥...');
                const derived = await deriveKeysWithWorker(password, saltHex, 600000, (pct) => {
                    setLoading(true, `正在派生安全密钥: ${pct}%`);
                });

                setLoading(true, '正在提交注册凭证...');
                await register({
                    inviteCode,
                    username,
                    kdfSalt: saltHex,
                    kdfIter: 600000,
                    authHash: derived.authHashHex,
                    deviceName
                });

                cachedEncKeyHex = derived.encKeyHex;
                await setSyncItem('encKeyHex', derived.encKeyHex);

                setLoading(false);
                showToast('注册成功！端到端加密服务已激活');
                refreshAuthAndMainPanes();
            } catch (err) {
                setLoading(false);
                showToast(err.message, true);
            }
        });
    }

    // 绑定一键复制账号与密码备忘
    const copyCredBtn = document.getElementById('sync-copy-credentials-btn');
    if (copyCredBtn) {
        copyCredBtn.addEventListener('click', async () => {
            const u = document.getElementById('sync-reg-username')?.value.trim() || '';
            const p = document.getElementById('sync-reg-password')?.value || '';
            if (!u && !p) {
                showToast('请先填写用户名和主密码后再复制', true);
                return;
            }
            const nowStr = new Date().toLocaleString();
            const textToCopy = `【会话云同步凭据备忘】\n用户名: ${u}\n主密码: ${p}\n记录时间: ${nowStr}\n重要提示：服务端零知识加密，无找回密码功能，遗忘主密码将永久无法解密！`;
            try {
                await navigator.clipboard.writeText(textToCopy);
                showToast('账号密码已复制到剪贴板，请妥善保存！');
            } catch (clipErr) {
                const ta = document.createElement('textarea');
                ta.value = textToCopy;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('账号密码已复制到剪贴板，请妥善保存！');
            }
        });
    }

    // 绑定防呆安全确认复选框
    const confirmBackupCb = document.getElementById('sync-confirm-backup-checkbox');
    if (confirmBackupCb && submitRegBtn) {
        confirmBackupCb.addEventListener('change', () => {
            submitRegBtn.disabled = !confirmBackupCb.checked;
        });
    }
}

/**
 * 刷新登录表单与主业务 Tab 显示状态
 */
async function refreshAuthAndMainPanes() {
    const settings = getSyncSettings();
    const token = await getSyncItem('token');
    const authPane = document.getElementById('sync-auth-pane');
    const mainTabs = document.getElementById('sync-main-tabs');
    const changeServerBtn = document.getElementById('sync-change-server-btn');
    const headerLogoutBtn = document.getElementById('sync-header-logout-btn');
    const configSec = document.getElementById('sync-server-config-section');

    if (settings.serverUrl) {
        if (configSec) configSec.style.display = 'none';
        if (changeServerBtn) changeServerBtn.style.display = 'inline-block';
        updateServerStatusUI(true, `已连接节点: ${settings.serverUrl}`);
    } else {
        if (configSec) configSec.style.display = 'flex';
        if (changeServerBtn) changeServerBtn.style.display = 'none';
        updateServerStatusUI(false, '未配置同步服务');
    }

    const isLoggedIn = Boolean(token && settings.username);
    if (headerLogoutBtn) {
        headerLogoutBtn.style.display = isLoggedIn ? 'inline-block' : 'none';
    }

    if (isLoggedIn) {
        // 已登录态
        if (authPane) authPane.classList.remove('active');
        if (mainTabs) mainTabs.style.display = 'flex';
        switchMainTab(currentTab || 'upload');
    } else {
        // 未登录态
        if (authPane) authPane.classList.add('active');
        if (mainTabs) mainTabs.style.display = 'none';
        document.querySelectorAll('.sync-tab-pane').forEach(p => {
            if (p !== authPane) p.classList.remove('active');
        });
    }

    // 联动刷新 AI 后台任务中转配置开关与提示文字
    const relayCheckbox = document.getElementById('sync-enable-ai-relay-checkbox');
    const relayDesc = document.getElementById('sync-relay-desc-text');
    if (relayCheckbox) {
        relayCheckbox.disabled = !isLoggedIn;
        relayCheckbox.checked = isLoggedIn && Boolean(settings.enableAiRelay);
    }
    if (relayDesc) {
        if (!settings.serverUrl || !isLoggedIn) {
            relayDesc.textContent = '请先连接云同步服务';
        } else if (settings.enableAiRelay) {
            relayDesc.innerHTML = '<span style="color: #10b981; font-weight: 500;">✓ 已开启保护</span>：对话与总结将由云端接力执行，网络中断/切后台后自动自愈。';
        } else {
            relayDesc.textContent = '未开启。开启后可防御手机切后台中断、长文本生成掉线与移动网络波动。';
        }
    }
}

let uploadSearchKeyword = '';
let uploadPage = 1;
let uploadPageSize = 100;
const selectedConvIdSet = new Set();
let isSelectionInitialized = false;

/**
 * 安全格式化日期时间（兼容数值时间戳、ISO 字符串与异常对象）
 */
function formatSafeDate(val) {
    if (!val) return '未知';
    try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            const pad = (n) => String(n).padStart(2, '0');
            const Y = d.getFullYear();
            const M = pad(d.getMonth() + 1);
            const D = pad(d.getDate());
            const h = pad(d.getHours());
            const m = pad(d.getMinutes());
            return `${Y}-${M}-${D} ${h}:${m}`;
        }
    } catch (e) {}
    return String(val).slice(0, 16).replace('T', ' ');
}

/**
 * 健壮获取会话楼层数 (兼容 branches 二维数组与 messages 单维数组)
 */
function getFloorCount(conv) {
    if (!conv) return 0;
    if (Array.isArray(conv.branches) && conv.branches.length > 0) {
        const activeIdx = (typeof conv.activeBranchIndex === 'number') ? conv.activeBranchIndex : 0;
        const branch = conv.branches[activeIdx] || conv.branches[0];
        if (Array.isArray(branch)) return branch.length;
        if (branch && Array.isArray(branch.messages)) return branch.messages.length;
    }
    if (Array.isArray(conv.messages)) return conv.messages.length;
    return 0;
}

/**
 * 提取会话前几条消息摘要 (自动剔除思考过程)
 */
function getFewMessagesPreview(conv, count = 3) {
    if (!conv) return [];
    let msgs = [];
    if (Array.isArray(conv.branches) && conv.branches.length > 0) {
        const activeIdx = (typeof conv.activeBranchIndex === 'number') ? conv.activeBranchIndex : 0;
        const branch = conv.branches[activeIdx] || conv.branches[0];
        if (Array.isArray(branch)) msgs = branch;
        else if (branch && Array.isArray(branch.messages)) msgs = branch.messages;
    } else if (Array.isArray(conv.messages)) {
        msgs = conv.messages;
    }

    if (!Array.isArray(msgs)) return [];

    const valid = msgs.filter(m => m && m.content && String(m.content).trim()).slice(0, count);
    return valid.map(m => {
        let text = String(m.content || '').trim();
        text = text.replace(regexPatterns.thinkingTagThinking, '');
        text = text.replace(regexPatterns.thinkingTagThink, '');
        text = text.replace(regexPatterns.markdownCodeBlock, '[代码块]');
        text = text.replace(regexPatterns.markdownHeading, '');
        text = text.replace(regexPatterns.multiNewlines, ' ');
        if (text.length > 100) text = text.slice(0, 100) + '...';
        const role = m.role === 'user' 
            ? `<svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> 提问` 
            : (m.role === 'assistant' 
                ? `<svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="9" r="1.5"/><path d="M9 15h6"/></svg> 回答` 
                : `<svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 系统`);
        return { role, text };
    });
}

/**
 * 渲染上传会话复选列表 (支持置顶优先、时间倒序、分页与前文预览)
 */
function renderUploadConversationList() {
    const container = document.getElementById('sync-upload-conv-list');
    const summaryText = document.getElementById('sync-upload-summary-text');
    const pageInfo = document.getElementById('sync-page-info');
    const prevBtn = document.getElementById('sync-prev-page-btn');
    const nextBtn = document.getElementById('sync-next-page-btn');
    if (!container) return;

    container.innerHTML = '';
    const allConvs = Object.values(state.conversations || {}).filter(c => c && !c.isDeleted);

    // 剔除已在外部删除的失效会话 ID，默认全部不勾选
    const validConvIdSet = new Set(allConvs.map(c => c && c.id).filter(Boolean));
    for (const id of selectedConvIdSet) {
        if (!validConvIdSet.has(id)) {
            selectedConvIdSet.delete(id);
        }
    }
    isSelectionInitialized = true;

    if (allConvs.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;">本地暂无可上传的会话</div>';
        if (summaryText) summaryText.textContent = '已勾选 0 个会话';
        if (pageInfo) pageInfo.textContent = '第 1 / 1 页 (共 0 条)';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    // 1. 标题关键字过滤
    let filteredConvs = allConvs;
    const kw = (uploadSearchKeyword || '').trim().toLowerCase();
    if (kw) {
        filteredConvs = filteredConvs.filter(c => {
            return c && c.title && String(c.title).toLowerCase().includes(kw);
        });
    }

    // 2. 排序：置顶(pinned)绝对优先，同优先级按最后修改时间倒序
    filteredConvs.sort((a, b) => {
        const pinA = a.pinned ? 1 : 0;
        const pinB = b.pinned ? 1 : 0;
        if (pinA !== pinB) return pinB - pinA;

        const tA = a.lastModified ? new Date(a.lastModified).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const tB = b.lastModified ? new Date(b.lastModified).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });

    const totalCount = filteredConvs.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / uploadPageSize));
    if (uploadPage > totalPages) uploadPage = totalPages;
    if (uploadPage < 1) uploadPage = 1;

    // 3. 分页切片
    const startIdx = (uploadPage - 1) * uploadPageSize;
    const endIdx = startIdx + uploadPageSize;
    const pageConvs = filteredConvs.slice(startIdx, endIdx);

    // 4. 更新分页 UI
    if (pageInfo) {
        pageInfo.textContent = `第 ${uploadPage} / ${totalPages} 页 (筛选共 ${totalCount} 条，已选 ${selectedConvIdSet.size} 条)`;
    }
    if (prevBtn) prevBtn.disabled = (uploadPage <= 1);
    if (nextBtn) nextBtn.disabled = (uploadPage >= totalPages);

    if (pageConvs.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;">没有匹配的会话记录</div>';
        updateUploadSummary();
        return;
    }

    // 5. 逐条渲染卡片
    pageConvs.forEach(conv => {
        if (!conv || !conv.id) return;
        try {
            const card = document.createElement('div');
            card.className = 'sync-snapshot-card';
            card.style.cursor = 'pointer';

            const floorCount = getFloorCount(conv);
            const titleText = conv.title || '未命名对话';
            const safeTitle = escapeHtml(titleText);
            const safeTime = formatSafeDate(conv.lastModified || conv.createdAt);
            const isChecked = selectedConvIdSet.has(conv.id);

            const pinnedBadge = conv.pinned ? '<span class="sync-pinned-badge"><svg class="sync-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>置顶</span>' : '';

            // 双重防御：若内存中由于分账懒加载导致 floorCount 为 0，异步从 IndexedDB 补充真实分支
            if (floorCount === 0 && conv.id) {
                import('../db.js?v=temp').then(({ getConversation }) => {
                    return getConversation(conv.id);
                }).then(fullConv => {
                    if (fullConv) {
                        const realCount = getFloorCount(fullConv);
                        if (realCount > 0) {
                            const metaEl = card.querySelector('.sync-snapshot-meta');
                            if (metaEl) {
                                metaEl.textContent = `${realCount} 楼 · 修改于 ${safeTime}`;
                            }
                            conv.branches = fullConv.branches;
                            conv.activeBranchIndex = fullConv.activeBranchIndex;
                        }
                    }
                }).catch(() => {});
            }

            card.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                        <input type="checkbox" class="sync-conv-checkbox" value="${conv.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;flex-shrink:0;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4;">
                                ${pinnedBadge}${safeTitle}
                            </div>
                            <div class="sync-snapshot-meta" style="margin-top:2px;">
                                ${floorCount} 楼 · 修改于 ${safeTime}
                            </div>
                        </div>
                    </div>
                    <button type="button" class="sync-preview-toggle-btn" data-conv-id="${conv.id}" style="display: inline-flex; align-items: center; gap: 3px;"><svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>预览</button>
                </div>
                <div class="sync-preview-box" id="sync-preview-${conv.id}" style="display: none;"></div>
            `;

            // 点击整卡切换复选框（点击按钮与预览区除外）
            card.addEventListener('click', (e) => {
                if (e.target.closest('.sync-preview-toggle-btn') || e.target.closest('.sync-preview-box')) {
                    return;
                }
                const cb = card.querySelector('.sync-conv-checkbox');
                if (e.target !== cb) {
                    cb.checked = !cb.checked;
                }
                if (cb.checked) {
                    selectedConvIdSet.add(conv.id);
                } else {
                    selectedConvIdSet.delete(conv.id);
                }
                updateUploadSummary();
            });

            // 复选框独立事件
            const cb = card.querySelector('.sync-conv-checkbox');
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedConvIdSet.add(conv.id);
                } else {
                    selectedConvIdSet.delete(conv.id);
                }
                updateUploadSummary();
            });

            // 预览按钮点击事件
            const previewBtn = card.querySelector('.sync-preview-toggle-btn');
            const previewBox = card.querySelector(`#sync-preview-${conv.id}`);
            previewBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (previewBox.style.display === 'none') {
                    let previews = getFewMessagesPreview(conv, 3);
                    if (previews.length === 0 && conv.id) {
                        try {
                            const { getConversation } = await import('../db.js?v=temp');
                            const fullConv = await getConversation(conv.id);
                            if (fullConv) {
                                conv.branches = fullConv.branches;
                                conv.activeBranchIndex = fullConv.activeBranchIndex;
                                previews = getFewMessagesPreview(fullConv, 3);
                            }
                        } catch (err) {}
                    }

                    if (previews.length === 0) {
                        previewBox.innerHTML = '<span style="color:var(--text-muted);">（该会话暂无文本消息）</span>';
                    } else {
                        previewBox.innerHTML = previews.map(p => `
                            <div class="sync-preview-msg-item">
                                <span class="sync-preview-msg-role">${p.role}:</span>
                                <span class="sync-preview-msg-text">${escapeHtml(p.text)}</span>
                            </div>
                        `).join('');
                    }
                    previewBox.style.display = 'flex';
                    previewBtn.innerHTML = '<svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px;"><path d="m15 18-6-6 6-6"/></svg>收起';
                } else {
                    previewBox.style.display = 'none';
                    previewBtn.innerHTML = '<svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>预览';
                }
            });

            container.appendChild(card);
        } catch (itemErr) {
            console.error('渲染单条会话失败:', conv, itemErr);
        }
    });

    updateUploadSummary();
}

/**
 * 更新已勾选总数提示
 */
function updateUploadSummary() {
    const summaryText = document.getElementById('sync-upload-summary-text');
    const pageInfo = document.getElementById('sync-page-info');
    if (summaryText) {
        summaryText.textContent = `已勾选 ${selectedConvIdSet.size} 个会话`;
    }
}

/**
 * 绑定上传快照业务
 */
function bindUploadActions() {
    const selectAllCurrentBtn = document.getElementById('sync-select-all-btn');
    const selectGlobalBtn = document.getElementById('sync-select-global-btn');
    const deselectAllBtn = document.getElementById('sync-deselect-all-btn');
    const startUploadBtn = document.getElementById('sync-start-upload-btn');
    const searchInput = document.getElementById('sync-conv-search-input');
    const pageSizeSelect = document.getElementById('sync-page-size-select');
    const prevPageBtn = document.getElementById('sync-prev-page-btn');
    const nextPageBtn = document.getElementById('sync-next-page-btn');

    // 1. 全选当前页
    if (selectAllCurrentBtn) {
        selectAllCurrentBtn.addEventListener('click', () => {
            document.querySelectorAll('.sync-conv-checkbox').forEach(cb => {
                cb.checked = true;
                selectedConvIdSet.add(cb.value);
            });
            updateUploadSummary();
        });
    }

    // 2. 全选所有 (包含跨页)
    if (selectGlobalBtn) {
        selectGlobalBtn.addEventListener('click', () => {
            const allConvs = Object.values(state.conversations || {});
            const kw = (uploadSearchKeyword || '').trim().toLowerCase();
            allConvs.forEach(c => {
                if (!c || !c.id) return;
                if (!kw || (c.title && String(c.title).toLowerCase().includes(kw))) {
                    selectedConvIdSet.add(c.id);
                }
            });
            document.querySelectorAll('.sync-conv-checkbox').forEach(cb => cb.checked = true);
            updateUploadSummary();
        });
    }

    // 3. 清空已选
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedConvIdSet.clear();
            document.querySelectorAll('.sync-conv-checkbox').forEach(cb => cb.checked = false);
            updateUploadSummary();
        });
    }

    // 4. 搜索框输入防抖监听
    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                uploadSearchKeyword = searchInput.value;
                uploadPage = 1;
                renderUploadConversationList();
            }, 250);
        });
    }

    // 5. 分页容量切换
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', () => {
            uploadPageSize = parseInt(pageSizeSelect.value, 10) || 100;
            uploadPage = 1;
            renderUploadConversationList();
        });
    }

    // 6. 上一页 / 下一页
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (uploadPage > 1) {
                uploadPage--;
                renderUploadConversationList();
            }
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            uploadPage++;
            renderUploadConversationList();
        });
    }

    // 7. 开始打包并上传
    if (startUploadBtn) {
        startUploadBtn.addEventListener('click', async () => {
            const targetIds = Array.from(selectedConvIdSet);
            if (targetIds.length === 0) {
                showToast('请至少勾选一个要备份的会话', true);
                return;
            }
            const settings = getSyncSettings();

            try {
                setLoading(true, '正在提取并组装会话包...');
                const bundle = await buildConversationBundle(targetIds);

                setLoading(true, '正在提取轻量 Manifest 清单...');
                const manifest = generateManifest(bundle, settings.deviceName || 'Web端', 'v1.0.0');

                let encKeyHex = cachedEncKeyHex;
                if (!encKeyHex) {
                    encKeyHex = await getSyncItem('encKeyHex');
                }
                if (!encKeyHex) {
                    throw new Error('未找到加密密钥，请重新登录');
                }

                const actualCount = Object.keys(bundle.conversations || {}).length;
                const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                setLoading(true, '正在使用 AES-256-GCM 加密会话包...');
                const encryptedPacket = await encryptSnapshot(bundle, encKeyHex, settings.userId, snapshotId);

                setLoading(true, '正在加密 Manifest 清单...');
                const encManifestBase64 = await encryptManifest(manifest, encKeyHex, settings.userId, snapshotId);

                // 计算 SHA256 哈希
                let sha256Hex = '';
                if (window.crypto && window.crypto.subtle) {
                    const hashBuf = await window.crypto.subtle.digest('SHA-256', encryptedPacket);
                    sha256Hex = bytesToHex(new Uint8Array(hashBuf));
                }

                setLoading(true, '正在上传加密快照至云端...');
                const meta = {
                    snapshotId,
                    formatVersion: 1,
                    size: encryptedPacket.byteLength,
                    sha256: sha256Hex,
                    encManifest: encManifestBase64,
                    conversationCount: actualCount
                };

                await uploadSnapshot(meta, encryptedPacket);

                setLoading(false);
                showToast(`成功上传快照！包含 ${actualCount} 个会话`);
                switchMainTab('download');
            } catch (err) {
                setLoading(false);
                showToast('上传失败: ' + err.message, true);
            }
        });
    }
}

/**
 * 刷新快照时间线批量管理工具栏状态与按钮可用性
 */
function updateBatchToolbarUI() {
    const toolbar = document.getElementById('sync-batch-toolbar');
    const manageBtnText = document.getElementById('sync-batch-manage-btn-text');
    const manageBtn = document.getElementById('sync-batch-manage-btn');
    const selectedInfo = document.getElementById('sync-batch-selected-info');
    const deleteBtn = document.getElementById('sync-batch-delete-btn');

    if (toolbar) {
        toolbar.style.display = isBatchModeActive ? 'flex' : 'none';
    }
    if (manageBtnText) {
        manageBtnText.textContent = isBatchModeActive ? '退出批量' : '批量管理';
    }
    if (manageBtn) {
        if (isBatchModeActive) {
            manageBtn.classList.add('sync-btn-primary');
            manageBtn.classList.remove('sync-btn-secondary');
        } else {
            manageBtn.classList.remove('sync-btn-primary');
            manageBtn.classList.add('sync-btn-secondary');
        }
    }

    if (selectedInfo) {
        let totalBytes = 0;
        selectedBatchSnapshotMap.forEach(size => {
            totalBytes += (size || 0);
        });
        const count = selectedBatchSnapshotMap.size;
        const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);
        selectedInfo.textContent = `已勾选 ${count} 个快照 (${sizeMB} MB)`;
    }

    if (deleteBtn) {
        deleteBtn.disabled = (selectedBatchSnapshotMap.size === 0);
    }
}

/**
 * 绑定云端快照时间线与同步追加、批量管理
 */
function bindDownloadActions() {
    const refreshBtn = document.getElementById('sync-refresh-snapshots-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadSnapshotTimeline);
    }

    // 1. 批量管理模式切换
    const batchManageBtn = document.getElementById('sync-batch-manage-btn');
    if (batchManageBtn) {
        batchManageBtn.addEventListener('click', () => {
            isBatchModeActive = !isBatchModeActive;
            if (!isBatchModeActive) {
                selectedBatchSnapshotMap.clear();
            }
            updateBatchToolbarUI();
            loadSnapshotTimeline();
        });
    }

    // 2. 批量全选
    const selectAllBtn = document.getElementById('sync-batch-select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const container = document.getElementById('sync-snapshots-timeline');
            if (!container) return;
            container.querySelectorAll('.sync-batch-snap-checkbox').forEach(cb => {
                cb.checked = true;
                const snapId = cb.getAttribute('data-snapshot-id');
                const size = parseInt(cb.getAttribute('data-size') || '0', 10);
                if (snapId) selectedBatchSnapshotMap.set(snapId, size);
                const card = cb.closest('.sync-snapshot-card');
                if (card) card.classList.add('sync-card-selected');
            });
            updateBatchToolbarUI();
        });
    }

    // 3. 批量清空已选
    const deselectAllBtn = document.getElementById('sync-batch-deselect-all-btn');
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedBatchSnapshotMap.clear();
            const container = document.getElementById('sync-snapshots-timeline');
            if (container) {
                container.querySelectorAll('.sync-batch-snap-checkbox').forEach(cb => {
                    cb.checked = false;
                    const card = cb.closest('.sync-snapshot-card');
                    if (card) card.classList.remove('sync-card-selected');
                });
            }
            updateBatchToolbarUI();
        });
    }

    // 4. 批量清理按钮 -> 调起安全验证模态框
    const batchDeleteBtn = document.getElementById('sync-batch-delete-btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', openBatchPasswordDialog);
    }

    // 5. 初始化安全验证弹窗事件监听
    bindBatchPasswordDialogEvents();
}

/**
 * 打开批量清理密码安全验证弹窗
 */
function openBatchPasswordDialog() {
    const dialog = document.getElementById('sync-batch-pwd-dialog');
    const pwdInput = document.getElementById('sync-batch-pwd-input');
    const errText = document.getElementById('sync-batch-pwd-error');
    const warningText = document.getElementById('sync-batch-pwd-warning-text');
    if (!dialog) return;

    let totalBytes = 0;
    selectedBatchSnapshotMap.forEach(size => { totalBytes += (size || 0); });
    const count = selectedBatchSnapshotMap.size;
    if (count === 0) {
        showToast('请先勾选要清理的快照', true);
        return;
    }

    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);
    if (warningText) {
        warningText.textContent = `即将从云端彻底删除选中的 ${count} 个快照 (共 ${sizeMB} MB)，对应占用的存储配额将立即返还。此操作不可逆，请验证主密码以确认本人操作。`;
    }
    if (pwdInput) {
        pwdInput.value = '';
        pwdInput.type = 'password';
    }
    const toggleBtn = document.getElementById('sync-batch-pwd-toggle-btn');
    if (toggleBtn) toggleBtn.textContent = '显示';
    if (errText) errText.textContent = '';

    dialog.style.display = 'flex';
    setTimeout(() => {
        if (pwdInput) pwdInput.focus();
    }, 50);
}

let isBatchPwdBound = false;
/**
 * 绑定批量删除密码验证模态框事件
 */
function bindBatchPasswordDialogEvents() {
    if (isBatchPwdBound) return;
    isBatchPwdBound = true;

    const dialog = document.getElementById('sync-batch-pwd-dialog');
    const closeBtn = document.getElementById('sync-batch-pwd-close-btn');
    const cancelBtn = document.getElementById('sync-batch-pwd-cancel-btn');
    const confirmBtn = document.getElementById('sync-batch-pwd-confirm-btn');
    const toggleBtn = document.getElementById('sync-batch-pwd-toggle-btn');
    const pwdInput = document.getElementById('sync-batch-pwd-input');

    const closeDialog = () => {
        if (dialog) dialog.style.display = 'none';
        if (pwdInput) pwdInput.value = '';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeDialog);
    if (cancelBtn) cancelBtn.addEventListener('click', closeDialog);
    if (dialog) {
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) closeDialog();
        });
    }

    if (toggleBtn && pwdInput) {
        toggleBtn.addEventListener('click', () => {
            const isPwd = pwdInput.type === 'password';
            pwdInput.type = isPwd ? 'text' : 'password';
            toggleBtn.textContent = isPwd ? '隐藏' : '显示';
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', handleBatchDeleteConfirm);
    }

    if (pwdInput) {
        pwdInput.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                handleBatchDeleteConfirm();
            }
        });
    }

    // 支持 ESC 键关闭密码验证弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dialog && dialog.style.display !== 'none') {
            closeDialog();
        }
    });
}

/**
 * 执行批量删除确认（利用 Worker 派生哈希提交服务端验证并原子批量删除）
 */
async function handleBatchDeleteConfirm() {
    const pwdInput = document.getElementById('sync-batch-pwd-input');
    const errText = document.getElementById('sync-batch-pwd-error');
    const confirmBtn = document.getElementById('sync-batch-pwd-confirm-btn');
    const dialog = document.getElementById('sync-batch-pwd-dialog');

    // 防抖防并发重发
    if (confirmBtn && confirmBtn.disabled) return;

    const password = pwdInput ? pwdInput.value : '';

    if (!password) {
        if (errText) errText.textContent = '请输入主密码';
        if (pwdInput) pwdInput.focus();
        return;
    }

    const ids = Array.from(selectedBatchSnapshotMap.keys());
    if (ids.length === 0) {
        if (errText) errText.textContent = '未选中任何快照';
        return;
    }

    const settings = getSyncSettings();
    const username = settings.username;
    if (!username) {
        if (errText) errText.textContent = '未获取到当前登录用户名，请重新登录';
        return;
    }

    try {
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = `
                <svg class="sync-icon sync-icon-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                正在验证并清理...
            `;
        }
        if (errText) errText.textContent = '';

        // 1. 获取预登录参数 (kdfSalt 与 kdfIter)
        const pre = await prelogin(username);

        // 2. 利用 Web Worker 派生 authHash (仅需 50ms 硬件加速)
        const derived = await deriveKeysWithWorker(password, pre.kdfSalt, pre.kdfIter);

        // 3. 提交服务端在单一事务中原子校验并批量删除
        const res = await batchDeleteSnapshots(ids, derived.authHashHex);

        // 4. 清理成功，关闭弹窗并清空已选
        if (dialog) dialog.style.display = 'none';
        selectedBatchSnapshotMap.clear();
        updateBatchToolbarUI();

        const freedMB = (res.freedBytes / (1024 * 1024)).toFixed(2);
        showToast(`已成功批量清理 ${res.deletedCount} 个快照，释放 ${freedMB} MB 存储空间`);

        // 5. 重新加载快照时间线与云端配额进度条
        await loadSnapshotTimeline();
        await loadDeviceAndQuotaInfo();
    } catch (err) {
        if (errText) {
            errText.textContent = err.message || '验证失败，请重试';
        }
        if (pwdInput) {
            pwdInput.select();
        }
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `
                <svg class="sync-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                确认清理
            `;
        }
    }
}

/**
 * 加载云端快照时间线并本地解密 Manifest
 */
async function loadSnapshotTimeline() {
    const container = document.getElementById('sync-snapshots-timeline');
    if (!container) return;

    const refreshBtn = document.getElementById('sync-refresh-snapshots-btn');
    const refreshIcon = refreshBtn?.querySelector('.sync-refresh-icon');
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.classList.add('sync-icon-spin');

    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">正在加载云端快照...</div>';

    try {
        const res = await listSnapshots(0, 50);
        const items = res.items || [];

        if (items.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">云端暂无快照备份记录</div>';
            updateBatchToolbarUI();
            return;
        }

        let encKeyHex = cachedEncKeyHex;
        if (!encKeyHex) encKeyHex = await getSyncItem('encKeyHex');
        const settings = getSyncSettings();

        // 1. 批量解密所有 items 的 manifest（提取会话清单信息）
        const parsedEntries = [];
        for (const item of items) {
            let manifest = null;
            if (encKeyHex && item.encManifest) {
                try {
                    manifest = await decryptManifest(item.encManifest, encKeyHex, settings.userId, item.id);
                } catch (e) {
                    console.warn('解密 manifest 失败:', e);
                }
            }

            const convList = (manifest && Array.isArray(manifest.conversations)) ? manifest.conversations : [];
            parsedEntries.push({
                item,
                manifest,
                convList,
                isSingleConv: convList.length === 1
            });
        }

        // 清理 selectedBatchSnapshotMap 中已在云端不存在的失效快照 ID
        const validServerIds = new Set(items.map(it => it && it.id).filter(Boolean));
        for (const snapId of selectedBatchSnapshotMap.keys()) {
            if (!validServerIds.has(snapId)) {
                selectedBatchSnapshotMap.delete(snapId);
            }
        }

        // 2. 智能聚合：单会话快照按 convId 分组聚合成手风琴（Plan A），多会话快照保持独立
        const singleGroups = new Map();
        const displayGroups = [];

        for (const entry of parsedEntries) {
            const conv = entry.isSingleConv ? entry.convList[0] : null;
            const convId = conv ? (conv.id || conv.sourceConvId) : null;
            if (entry.isSingleConv && convId) {
                if (!singleGroups.has(convId)) {
                    const group = {
                        type: 'single_group',
                        convId,
                        title: conv.title || '未命名会话',
                        hasRealtime: !!conv.hasRealtime,
                        floorCount: conv.floorCount || 0,
                        latestItem: entry.item,
                        history: [], // 存储更旧的版本: [{ item, conv }]
                        latestCreatedAt: entry.item.createdAt
                    };
                    singleGroups.set(convId, group);
                    displayGroups.push(group);
                } else {
                    const group = singleGroups.get(convId);
                    if (entry.item.createdAt > group.latestCreatedAt) {
                        // 当前 item 更新，之前的降级为历史版本
                        group.history.push({
                            item: group.latestItem,
                            conv: {
                                title: group.title,
                                floorCount: group.floorCount,
                                hasRealtime: group.hasRealtime
                            }
                        });
                        group.latestItem = entry.item;
                        group.title = conv.title || group.title;
                        group.hasRealtime = !!conv.hasRealtime;
                        group.floorCount = conv.floorCount || 0;
                        group.latestCreatedAt = entry.item.createdAt;
                    } else {
                        // 当前 item 较旧，直接加入历史版本
                        group.history.push({
                            item: entry.item,
                            conv
                        });
                    }
                }
            } else {
                // — 为什么这么写 —
                // 1. 多会话备份包或未解析出会话清单的快照按原样独立呈现。
                // 2. 若单会话快照因极端异常确实缺失有效 ID，严禁 continue 吞掉丢弃，
                //    降级为通用多会话卡片呈现，彻底捍卫云端快照在界面上的 100% 可见性与删除/恢复权。
                displayGroups.push({
                    type: 'multi',
                    item: entry.item,
                    manifest: entry.manifest,
                    convList: entry.convList,
                    latestCreatedAt: entry.item.createdAt
                });
            }
        }

        // 3. 对历史版本按创建时间从新到旧降序排序
        singleGroups.forEach(group => {
            group.history.sort((a, b) => b.item.createdAt - a.item.createdAt);
        });

        // 4. 对顶层展示卡片按最新时间降序排列
        displayGroups.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt);

        container.innerHTML = '';

        // 5. 循环生成规范的两行架构快照卡片 (彻底解决移动端挤压错位与标题过度截断)
        for (const group of displayGroups) {
            const card = document.createElement('div');
            card.className = 'sync-snapshot-card';

            if (group.type === 'single_group') {
                const latestItem = group.latestItem;
                const sizeMB = (latestItem.size / (1024 * 1024)).toFixed(2);
                const dateStr = new Date(latestItem.createdAt * 1000).toLocaleString();
                const historyCount = group.history.length;
                const isLatestChecked = selectedBatchSnapshotMap.has(latestItem.id);

                if (isBatchModeActive) {
                    card.classList.add('sync-batch-mode');
                    if (isLatestChecked) card.classList.add('sync-card-selected');
                }

                let historyHtml = '';
                if (historyCount > 0) {
                    historyHtml = `
                        <div class="sync-accordion-toggle" role="button" tabindex="0">
                            <span style="display:flex;align-items:center;gap:4px;">
                                <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
                                历史备份 (${historyCount}个版本)
                            </span>
                            <svg class="sync-icon sync-accordion-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                        <div class="sync-accordion-content">
                            ${group.history.map((h, idx) => {
                                const hDate = new Date(h.item.createdAt * 1000).toLocaleString();
                                const hSize = (h.item.size / (1024 * 1024)).toFixed(2);
                                const hFloor = h.conv ? (h.conv.floorCount || 0) : '?';
                                const isHChecked = selectedBatchSnapshotMap.has(h.item.id);
                                return `
                                    <div class="sync-history-version-row ${isBatchModeActive ? 'sync-batch-mode' : ''}">
                                        ${isBatchModeActive ? `
                                            <input type="checkbox" class="sync-batch-snap-checkbox" data-snapshot-id="${h.item.id}" data-size="${h.item.size}" ${isHChecked ? 'checked' : ''} title="勾选以批量清理">
                                        ` : ''}
                                        <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;flex-wrap:wrap;">
                                            <span style="color:var(--text-muted);font-size:11px;">#${historyCount - idx}</span>
                                            <span style="font-size:11px;color:var(--text-secondary);line-height:1.2;">${hDate}</span>
                                            <span style="font-size:10px;color:var(--text-muted);">[${escapeHtml(h.item.deviceName || '本机')}]</span>
                                            <span style="font-size:10px;background:var(--bg-deep);padding:0 4px;border-radius:3px;">${hFloor} 楼</span>
                                            <span style="font-size:10px;color:var(--text-muted);">${hSize} MB</span>
                                        </div>
                                        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                                            <button class="sync-btn sync-btn-secondary sync-single-apply-btn" data-snapshot-id="${h.item.id}" data-conv-id="${group.convId}" style="padding:2px 6px;font-size:11px;display:inline-flex;align-items:center;gap:2px;" title="仅将此历史版本同步加载到本地">
                                                <svg class="sync-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                                加载此版
                                            </button>
                                            <button class="sync-btn sync-btn-secondary sync-delete-btn" data-id="${h.item.id}" style="padding:2px 6px;font-size:11px;color:var(--danger-color,#ef4444);border-color:rgba(239,68,68,0.35);display:inline-flex;align-items:center;gap:2px;" title="从云端彻底删除此历史版本并释放配额">
                                                <svg class="sync-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                            <button class="sync-clean-history-btn" data-history-ids="${group.history.map(h => h.item.id).join(',')}">
                                <svg class="sync-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                一键清理这 ${historyCount} 个旧版本 (仅保留最新版)
                            </button>
                        </div>
                    `;
                }

                const checkboxHtml = isBatchModeActive ? `
                    <div class="sync-card-checkbox-col">
                        <input type="checkbox" class="sync-batch-snap-checkbox" data-snapshot-id="${latestItem.id}" data-size="${latestItem.size}" ${isLatestChecked ? 'checked' : ''} title="勾选以批量清理">
                    </div>
                ` : '';

                card.innerHTML = `
                    ${checkboxHtml}
                    <div class="sync-card-main-content">
                        <!-- 顶层第1行：会话标题与徽章 (标题占满整行自适应，绝不在移动端提前截断) -->
                        <div class="sync-card-title-row">
                            <svg class="sync-icon sync-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            <span class="sync-card-title-text" title="${escapeHtml(group.title)}">${escapeHtml(group.title)}</span>
                            ${group.hasRealtime ? `<span class="sync-tag-realtime" title="包含实时模式时间与历法配置">实时</span>` : ''}
                            <span class="sync-tag-floor">${group.floorCount} 楼</span>
                            ${historyCount > 0 ? `<span class="sync-tag-versions">${historyCount + 1}个版本</span>` : ''}
                        </div>

                        <!-- 顶层第2行：元信息 (左侧时间与大小) + 操作按钮 (右侧紧凑按钮) -->
                        <div class="sync-card-meta-row">
                            <div class="sync-card-meta-info">
                                <span>${dateStr}</span>
                                <span>·</span>
                                <span>[${escapeHtml(latestItem.deviceName || '本机')}]</span>
                                <span>·</span>
                                <span>${sizeMB} MB</span>
                            </div>
                            <div class="sync-card-actions">
                                <button class="sync-btn sync-btn-primary sync-single-apply-btn" data-snapshot-id="${latestItem.id}" data-conv-id="${group.convId}" style="padding:4px 9px;font-size:12px;display:inline-flex;align-items:center;gap:3px;" title="将此会话最新版本加载同步到本地">
                                    <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    加载到本地
                                </button>
                                <button class="sync-btn sync-btn-secondary sync-delete-btn" data-id="${latestItem.id}" style="padding:4px 8px;font-size:12px;color:var(--danger-color,#ef4444);border-color:rgba(239,68,68,0.35);display:inline-flex;align-items:center;gap:3px;" title="从云端彻底删除此快照并释放配额">
                                    <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    删除
                                </button>
                            </div>
                        </div>

                        ${historyHtml}
                    </div>
                `;
            } else {
                // 多会话快照包
                const item = group.item;
                const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
                const dateStr = new Date(item.createdAt * 1000).toLocaleString();
                const convList = group.convList || [];
                const displayCount = convList.length > 0 ? convList.length : (item.conversationCount || 0);
                const isMultiChecked = selectedBatchSnapshotMap.has(item.id);

                if (isBatchModeActive) {
                    card.classList.add('sync-batch-mode');
                    if (isMultiChecked) card.classList.add('sync-card-selected');
                }

                let convRowsHtml = '';
                if (convList.length > 0) {
                    convRowsHtml = `
                        <div class="sync-snapshot-convs" style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">包含会话清单：</div>
                            ${convList.map(c => `
                                <div class="sync-conv-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; padding: 2px 0;">
                                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                                        <svg class="sync-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary-color, #3b82f6); flex-shrink: 0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                        <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.title || '未命名会话')}">${escapeHtml(c.title || '未命名会话')}</span>
                                        ${c.hasRealtime ? `<span class="sync-tag-realtime" title="包含实时模式时间与历法配置">实时</span>` : ''}
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                        <span class="sync-tag-floor">${c.floorCount || 0} 楼</span>
                                        <button class="sync-btn sync-btn-secondary sync-single-apply-btn" data-snapshot-id="${item.id}" data-conv-id="${c.id || c.sourceConvId}" style="padding: 1px 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 3px;" title="仅将此会话同步加载到本地">
                                            <svg class="sync-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                            仅加载此会话
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                } else if (displayCount > 0) {
                    convRowsHtml = `
                        <div class="sync-snapshot-convs" style="margin-top: 6px; font-size: 12px; color: var(--text-muted);">
                            包含 ${displayCount} 个会话（输入主密码后自动呈现明细）
                        </div>
                    `;
                }

                const checkboxHtml = isBatchModeActive ? `
                    <div class="sync-card-checkbox-col">
                        <input type="checkbox" class="sync-batch-snap-checkbox" data-snapshot-id="${item.id}" data-size="${item.size}" ${isMultiChecked ? 'checked' : ''} title="勾选以批量清理">
                    </div>
                ` : '';

                card.innerHTML = `
                    ${checkboxHtml}
                    <div class="sync-card-main-content">
                        <div class="sync-card-title-row">
                            <svg class="sync-icon sync-card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            <span class="sync-card-title-text" title="云端快照备份包">云端快照备份包</span>
                            <span class="sync-tag-floor">共 ${displayCount} 个会话</span>
                        </div>
                        <div class="sync-card-meta-row">
                            <div class="sync-card-meta-info">
                                <span>${dateStr}</span>
                                <span>·</span>
                                <span>来自 [${escapeHtml(item.deviceName || '未知设备')}]</span>
                                <span>·</span>
                                <span>${sizeMB} MB</span>
                            </div>
                            <div class="sync-card-actions">
                                <button class="sync-btn sync-btn-primary sync-apply-btn" data-id="${item.id}" style="padding:4px 9px;font-size:12px;display:inline-flex;align-items:center;gap:3px;" title="将整包所有会话加载到本地">
                                    <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    全部加载到本地
                                </button>
                                <button class="sync-btn sync-btn-secondary sync-delete-btn" data-id="${item.id}" style="padding:4px 8px;font-size:12px;color:var(--danger-color,#ef4444);border-color:rgba(239,68,68,0.35);display:inline-flex;align-items:center;gap:3px;" title="从云端彻底删除此快照并释放配额">
                                    <svg class="sync-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    删除
                                </button>
                            </div>
                        </div>
                        ${convRowsHtml}
                    </div>
                `;
            }

            container.appendChild(card);
        }

        // 6. 绑定批量勾选框事件
        container.querySelectorAll('.sync-batch-snap-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const snapId = e.currentTarget.getAttribute('data-snapshot-id');
                const size = parseInt(e.currentTarget.getAttribute('data-size') || '0', 10);
                if (e.currentTarget.checked) {
                    selectedBatchSnapshotMap.set(snapId, size);
                    const card = e.currentTarget.closest('.sync-snapshot-card');
                    if (card) card.classList.add('sync-card-selected');
                } else {
                    selectedBatchSnapshotMap.delete(snapId);
                    const card = e.currentTarget.closest('.sync-snapshot-card');
                    if (card) card.classList.remove('sync-card-selected');
                }
                updateBatchToolbarUI();
            });
        });
        updateBatchToolbarUI();

        // 6. 绑定手风琴展开/收起事件
        container.querySelectorAll('.sync-accordion-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const content = toggle.nextElementSibling;
                if (content && content.classList.contains('sync-accordion-content')) {
                    toggle.classList.toggle('expanded');
                    content.classList.toggle('open');
                }
            });
        });

        // 7. 绑定一键清理历史版本事件
        container.querySelectorAll('.sync-clean-history-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idsStr = e.currentTarget.getAttribute('data-history-ids') || '';
                const ids = idsStr.split(',').filter(Boolean);
                if (ids.length === 0) return;
                if (!confirm(`确定要清理这 ${ids.length} 个历史版本吗？\n\n• 将仅保留最新的快照版本；\n• 云端历史备份被清理后，对应的存储配额将立即释放。`)) {
                    return;
                }

                try {
                    setLoading(true, `正在清理 ${ids.length} 个历史版本...`);
                    for (const snapId of ids) {
                        await deleteSnapshot(snapId);
                    }
                    setLoading(false);
                    showToast(`已成功清理 ${ids.length} 个历史版本，配额已释放`);
                    await loadSnapshotTimeline();
                } catch (err) {
                    setLoading(false);
                    showToast('清理历史版本失败: ' + err.message, true);
                }
            });
        });

        // 8. 绑定单会话加载事件
        container.querySelectorAll('.sync-single-apply-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const snapshotId = e.currentTarget.getAttribute('data-snapshot-id');
                const convId = e.currentTarget.getAttribute('data-conv-id');
                if (snapshotId && convId) {
                    await applySnapshot(snapshotId, convId);
                }
            });
        });

        // 9. 绑定整包加载事件
        container.querySelectorAll('.sync-apply-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const snapshotId = e.currentTarget.getAttribute('data-id');
                await applySnapshot(snapshotId);
            });
        });

        // 10. 绑定删除云端快照事件
        container.querySelectorAll('.sync-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const snapshotId = e.currentTarget.getAttribute('data-id');
                if (!snapshotId) return;
                if (!confirm('确定要从云端彻底删除该快照吗？\n\n• 该操作不可撤销；\n• 对应占用的云端存储配额将立即全额释放。')) {
                    return;
                }

                try {
                    setLoading(true, '正在从云端删除快照...');
                    await deleteSnapshot(snapshotId);
                    setLoading(false);
                    showToast('云端快照已成功删除，配额已释放');
                    await loadSnapshotTimeline();
                } catch (err) {
                    setLoading(false);
                    showToast('删除快照失败: ' + err.message, true);
                }
            });
        });
    } catch (err) {
        container.innerHTML = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#ef4444;padding:16px;';
        errDiv.textContent = `获取快照记录失败: ${err.message || '未知错误'}`;
        container.appendChild(errDiv);
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.classList.remove('sync-icon-spin');
    }
}

/**
 * 下载密文并加载为本地会话（带智能差分弹窗与侧边栏即时刷新）
 */
export async function applySnapshot(snapshotId, targetConvId = null) {
    const isSingle = !!targetConvId;
    const confirmPrompt = isSingle
        ? '确定要将该会话同步加载到本地吗？（若检测到与本地内容冲突，将弹窗提供覆盖对比与保护）'
        : '确定要将快照中的会话加载到本地吗？（若检测到与本地内容冲突，将弹窗提供覆盖对比与保护）';

    if (!confirm(confirmPrompt)) {
        return;
    }

    try {
        setLoading(true, '正在连接服务器准备下载...');
        const encryptedBytes = await downloadSnapshot(snapshotId, (loaded, total, speedBps, etaSeconds) => {
            const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
            const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(1) : '?';
            const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

            // 动态格式化瞬时网速
            let speedStr = '';
            if (speedBps >= 1024 * 1024) {
                speedStr = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
            } else if (speedBps > 0) {
                speedStr = `${Math.round(speedBps / 1024)} KB/s`;
            } else {
                speedStr = '测速中...';
            }

            // 动态格式化预估剩余时间
            let etaStr = '';
            if (etaSeconds > 0) {
                if (etaSeconds >= 60) {
                    const mins = Math.floor(etaSeconds / 60);
                    const secs = etaSeconds % 60;
                    etaStr = ` · 剩余 ${mins}分${secs}秒`;
                } else {
                    etaStr = ` · 剩余 ${etaSeconds}秒`;
                }
            }

            if (total > 0) {
                setLoading(true, `正在下载密文数据包 (${loadedMB} / ${totalMB} MB · ${pct}% · ${speedStr}${etaStr})...`);
            } else {
                setLoading(true, `正在下载密文数据包 (${loadedMB} MB · ${speedStr})...`);
            }
        });

        let encKeyHex = cachedEncKeyHex;
        if (!encKeyHex) encKeyHex = await getSyncItem('encKeyHex');
        const settings = getSyncSettings();

        setLoading(true, '正在解密并验证快照完整性...');
        const bundle = await decryptSnapshot(encryptedBytes, encKeyHex, settings.userId, snapshotId);

        setLoading(true, '正在加载会话至本地 IndexedDB...');
        let convList = Object.values(bundle.conversations || {});
        let bundleMetadata = bundle;
        if (targetConvId) {
            // 精准匹配：同时比对 id 与 sourceConvId，实现新老契约双向兼容
            let matched = convList.filter(c => c && (String(c.id) === String(targetConvId) || String(c.sourceConvId) === String(targetConvId)));

            // 单会话快照安全兜底：若匹配不到且快照包中仅有唯一一个会话，安全降级使用该单会话
            if (matched.length === 0 && Object.keys(bundle.conversations || {}).length === 1) {
                const singleConv = Object.values(bundle.conversations)[0];
                if (singleConv) {
                    matched = [singleConv];
                }
            }

            // 严禁多会话快照在未匹配时跳过滤网
            if (matched.length === 0) {
                setLoading(false);
                showToast('快照中未找到指定会话记录', true);
                return;
            }

            convList = matched;

            // 对 bundleMetadata 进行作用域净化，只保留目标会话相关的 hideSummary、局部/全局 worldBook 与正则
            // — 为什么提取 targetIds 候选集 —
            // 兼容老快照或别名场景下 conv.id、conv.sourceConvId、targetConvId 存在的微小契约差异，
            // 彻底防止绑定元数据因比对单一字段而被误杀剥离。
            const targetIds = [convList[0]?.id, convList[0]?.sourceConvId, targetConvId].filter(Boolean).map(String);

            bundleMetadata = {
                ...bundle,
                hideSummary: (() => {
                    if (!bundle.hideSummary || typeof bundle.hideSummary !== 'object') return {};
                    const filtered = {};
                    for (const tid of targetIds) {
                        if (bundle.hideSummary[tid]) {
                            filtered[tid] = bundle.hideSummary[tid];
                        }
                    }
                    return filtered;
                })(),
                worldBook: (() => {
                    if (!bundle.worldBook || typeof bundle.worldBook !== 'object') return {};
                    const filtered = {};
                    Object.entries(bundle.worldBook).forEach(([wbId, entry]) => {
                        if (!entry) return;
                        const isGlobal = entry.enabled === true;
                        const isLinked = Array.isArray(entry.sessionIds) && entry.sessionIds.some(sId => targetIds.includes(String(sId)));
                        if (isGlobal || isLinked) {
                            filtered[wbId] = entry;
                        }
                    });
                    return filtered;
                })(),
                regexRules: (() => {
                    if (!bundle.regexRules || typeof bundle.regexRules !== 'object') return {};
                    const filtered = {};
                    Object.entries(bundle.regexRules).forEach(([rId, rule]) => {
                        if (!rule) return;
                        const isGlobal = (rule.scope === 'global' || !rule.scope);
                        const isLinked = rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.some(sId => targetIds.includes(String(sId)));
                        if (isGlobal || isLinked) {
                            filtered[rId] = rule;
                        }
                    });
                    return filtered;
                })(),
                sessionRegexRules: (() => {
                    if (!bundle.sessionRegexRules || typeof bundle.sessionRegexRules !== 'object') return {};
                    const filtered = {};
                    Object.entries(bundle.sessionRegexRules).forEach(([rId, rule]) => {
                        if (!rule) return;
                        const isLinked = Array.isArray(rule.sessionIds) && rule.sessionIds.some(sId => targetIds.includes(String(sId)));
                        if (isLinked) {
                            filtered[rId] = rule;
                        }
                    });
                    return filtered;
                })()
            };
            /* convList 已在上方完成非空守卫 */

            // 体验优化 Plan A：若单会话与本地现有会话内容 100% 完全一致，直接友好提示无需重复同步
            const targetId = convList[0]?.id || targetConvId;
            const localConv = state.conversations[targetId]
                || (convList[0]?.sourceConvId && state.conversations[convList[0].sourceConvId])
                || state.conversations[targetConvId];

            if (localConv && !localConv.isDeleted && isConversationContentIdentical(localConv, convList[0])) {
                setLoading(false);
                showToast('本地会话与该快照内容完全一致，无需重复同步');
                return { success: true, identical: true };
            }




        }
        const nowStr = new Date().toLocaleString();

        const result = await importConversations(convList, bundleMetadata, {
            titleSuffix: ` (同步 ${nowStr.slice(0, 10)})`,
            silent: true,
            checkConvConflicts: true,
            syncOrigin: { snapshotId, importedAt: new Date().toISOString() }
        });

        setLoading(false);

        // 用户在冲突决策弹窗中点击【取消】
        if (result && result.cancelled) {
            showToast('已取消加载此快照');
            return { success: false, cancelled: true };
        }

        // 全量快照恢复时若所有会话均与本地完全一致
        if (result && result.allIdentical) {
            showToast(isSingle ? '本地会话与该快照内容完全一致，无需重复同步' : '本地所有会话与云端快照完全一致，无需重复同步');
            return { success: true, identical: true };
        }

        // 用户选择全部【跳过】或未导入任何有效会话 (result === null)
        // — 为什么必须严格校验 —
        // 彻底修复当用户在冲突比对决策中主动选择「跳过」时，由于先前代码无条件回退 convList.length 导致弹出虚假「成功同步加载此会话至本地」的严重误导性 BUG。
        if (!result || (typeof result.count === 'number' && result.count === 0)) {
            showToast(isSingle ? '已跳过此会话加载（保持本地原状）' : '未导入任何会话（已全部跳过）');
            return { success: false, skipped: true };
        }

        const importedCount = (typeof result.count === 'number') ? result.count : convList.length;
        showToast(isSingle ? '成功同步加载此会话至本地！' : `成功加载 ${importedCount} 个会话至本地！`);

        // 立即刷新左侧侧边栏会话列表与顶栏实时模式高亮等动态UI
        try {
            const { renderHistory } = await import('../sidebar.js?v=temp');
            if (typeof renderHistory === 'function') {
                renderHistory();
            }
        } catch (e) {
            console.warn('刷新侧边栏失败:', e);
        }
        try {
            const { updateAllDynamicUI } = await import('../ui-updater.js?v=temp');
            if (typeof updateAllDynamicUI === 'function') {
                updateAllDynamicUI();
            }
        } catch (e) {
            console.warn('刷新动态UI失败:', e);
        }

        return result;
    } catch (err) {
        setLoading(false);
        showToast('加载快照失败: ' + err.message, true);
        return { success: false, error: err };
    }
}

/**
 * 统一处理退出当前设备登录（保留当前节点 serverUrl）
 * @param {boolean} [promptConfirm=true] - 是否弹窗二次确认
 */
async function handleLogout(promptConfirm = true) {
    if (promptConfirm && !confirm('确定要退出当前账号的云同步登录吗？本地会话数据不会受到任何影响。')) {
        return;
    }
    try {
        setLoading(true, '正在安全退出登录...');
        await logout();
        cachedEncKeyHex = '';
        resetQuotaAndDeviceInfo();
        showToast('已安全退出登录');
        await refreshAuthAndMainPanes();
    } catch (err) {
        showToast('退出登录异常: ' + (err.message || '未知错误'), true);
    } finally {
        setLoading(false);
    }
}

/**
 * 统一处理切换服务器节点（清除凭证并抹除 serverUrl，切回配置输入状态）
 */
async function handleChangeServer() {
    if (!confirm('切换节点将断开当前连接并重新配置服务器地址，确定切换吗？\n\n• 本地已保存的会话不受任何影响；\n• 需重新输入新节点的服务器地址。')) {
        return;
    }
    try {
        setLoading(true, '正在断开当前节点...');
        await logout();
        cachedEncKeyHex = '';
        saveSyncSettings({ serverUrl: '', username: '', userId: '', deviceId: '', token: '' });

        const serverUrlInput = document.getElementById('sync-server-url-input');
        if (serverUrlInput) {
            serverUrlInput.value = '';
            serverUrlInput.focus();
        }
        updateServerStatusUI(false, '请配置新服务器地址');
        resetQuotaAndDeviceInfo();
        showToast('已断开当前节点，请输入新服务器地址');
        await refreshAuthAndMainPanes();
    } catch (err) {
        showToast('断开节点异常: ' + (err.message || '未知错误'), true);
    } finally {
        setLoading(false);
    }
}

/**
 * 重置配额与设备展示信息
 */
function resetQuotaAndDeviceInfo() {
    const userText = document.getElementById('sync-current-user-text');
    const usedText = document.getElementById('sync-used-quota-text');
    const totalText = document.getElementById('sync-total-quota-text');
    const progressBar = document.getElementById('sync-quota-progress-bar');
    const devList = document.getElementById('sync-devices-list');
    if (userText) userText.textContent = '--';
    if (usedText) usedText.textContent = '-- MB';
    if (totalText) totalText.textContent = '-- MB';
    if (progressBar) progressBar.style.width = '0%';
    if (devList) devList.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:8px;">未登录，暂无设备与配额数据</div>';
}

/**
 * 绑定设备与退出
 */
function bindDeviceActions() {
    const logoutBtn = document.getElementById('sync-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => handleLogout(true));
    }
}

/**
 * 加载设备列表与配额信息（严格鉴权保护，必须处于合法登录态，杜绝平白调用）
 */
async function loadDeviceAndQuotaInfo() {
    const token = await getSyncItem('token');
    const settings = getSyncSettings();

    const userText = document.getElementById('sync-current-user-text');
    const usedText = document.getElementById('sync-used-quota-text');
    const totalText = document.getElementById('sync-total-quota-text');
    const progressBar = document.getElementById('sync-quota-progress-bar');
    const devList = document.getElementById('sync-devices-list');

    // 未登录或缺少凭据，绝对不平白发起网络请求
    if (!token || !settings.username || !settings.serverUrl) {
        if (userText) userText.textContent = '--';
        if (usedText) usedText.textContent = '-- MB';
        if (totalText) totalText.textContent = '-- MB';
        if (progressBar) progressBar.style.width = '0%';
        if (devList) devList.innerHTML = '<div style="color:var(--text-secondary);font-size:12px;padding:8px;">未登录，暂无设备与配额数据</div>';
        return;
    }

    try {
        const account = await getAccount();
        const devices = await getDevices();

        if (userText) userText.textContent = account.username;
        const usedMB = (account.usedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = (account.quotaBytes / (1024 * 1024)).toFixed(0);

        if (usedText) usedText.textContent = `${usedMB} MB`;
        if (totalText) totalText.textContent = `${totalMB} MB`;

        const pct = Math.min(100, Math.round((account.usedBytes / (account.quotaBytes || 1)) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;

        const devList = document.getElementById('sync-devices-list');
        if (devList) {
            devList.innerHTML = '';
            devices.forEach(d => {
                const row = document.createElement('div');
                row.className = 'sync-snapshot-card';
                row.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <strong>${escapeHtml(d.name || '未命名设备')}</strong> ${d.current ? '<span style="color:#10b981;font-size:11px;">(当前设备)</span>' : ''}
                            <div class="sync-snapshot-meta">最后活跃: ${d.lastSeenAt ? new Date(d.lastSeenAt * 1000).toLocaleString() : '未知'}</div>
                        </div>
                        ${!d.current ? `<button class="sync-btn sync-btn-danger sync-revoke-btn" data-id="${escapeHtml(d.id)}" style="padding:3px 8px;font-size:11px;">吊销</button>` : ''}
                    </div>
                `;
                devList.appendChild(row);
            });

            devList.querySelectorAll('.sync-revoke-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const devId = e.currentTarget.getAttribute('data-id');
                    if (confirm('确定吊销此设备的同步授权吗？')) {
                        try {
                            setLoading(true, '正在吊销设备...');
                            await revokeDevice(devId);
                            showToast('设备已成功吊销');
                            await loadDeviceAndQuotaInfo();
                        } catch (err) {
                            showToast('吊销设备失败: ' + (err.message || '未知错误'), true);
                        } finally {
                            setLoading(false);
                        }
                    }
                });
            });
        }
    } catch (err) {
        console.error('加载设备与配额失败:', err);
    }
}

/**
 * 打开云同步弹窗
 */
export async function openSyncModal() {
    initSyncModal();
    const modal = document.getElementById('sync-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    const settings = getSyncSettings();
    const serverUrlInput = document.getElementById('sync-server-url-input');
    if (serverUrlInput) {
        serverUrlInput.value = settings.serverUrl || '';
    }

    await refreshAuthAndMainPanes();
}

/**
 * 关闭云同步弹窗
 */
export function closeSyncModal() {
    const modal = document.getElementById('sync-modal');
    if (modal) modal.style.display = 'none';

    // 顺便关闭可能开启的批量密码验证弹窗并清空敏感输入
    const pwdDialog = document.getElementById('sync-batch-pwd-dialog');
    const pwdInput = document.getElementById('sync-batch-pwd-input');
    if (pwdDialog) pwdDialog.style.display = 'none';
    if (pwdInput) pwdInput.value = '';
}

/**
 * 直接针对单个会话执行极速端到端加密云同步 (Quick Cloud Sync)
 * @param {string} convId - 会话ID
 */
export async function syncSingleConversation(convId) {
    if (!convId) {
        showToast('会话ID无效', true);
        return;
    }

    const conv = state.conversations[convId];
    if (!conv) {
        showToast('本地未找到该会话', true);
        return;
    }
    if (conv.isDeleted) {
        showToast('回收站中的会话不可直接同步至云端', true);
        return;
    }

    const settings = getSyncSettings();
    const token = await getSyncItem('token');
    if (!settings.serverUrl || !token) {
        openSyncModal();
        showToast('请先配置并登录云同步服务', true);
        return;
    }

    let encKeyHex = cachedEncKeyHex;
    if (!encKeyHex) {
        encKeyHex = await getSyncItem('encKeyHex');
    }
    if (!encKeyHex) {
        openSyncModal();
        showToast('请在云同步面板输入主密码解锁加密密钥', true);
        return;
    }

    const convTitle = conv.title || '未命名对话';

    // 立即向用户弹出非阻塞式反馈，防止静默等待无感
    if (notify) notify.info(`正在将会话【${convTitle}】加密同步至云端...`, 3000);

    try {
        setLoading(true, `正在打包会话【${convTitle}】...`);
        const bundle = await buildConversationBundle([convId]);

        setLoading(true, '正在提取轻量清单...');
        const manifest = generateManifest(bundle, settings.deviceName || 'Web端', 'v1.0.0');

        const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        setLoading(true, '正在使用 AES-256-GCM 加密会话包...');
        const encryptedPacket = await encryptSnapshot(bundle, encKeyHex, settings.userId, snapshotId);

        setLoading(true, '正在加密 Manifest 清单...');
        const encManifestBase64 = await encryptManifest(manifest, encKeyHex, settings.userId, snapshotId);

        let sha256Hex = '';
        if (window.crypto && window.crypto.subtle) {
            const hashBuf = await window.crypto.subtle.digest('SHA-256', encryptedPacket);
            sha256Hex = bytesToHex(new Uint8Array(hashBuf));
        }

        setLoading(true, '正在极速上传至云端...');
        const meta = {
            snapshotId,
            formatVersion: 1,
            size: encryptedPacket.byteLength,
            sha256: sha256Hex,
            encManifest: encManifestBase64,
            conversationCount: 1
        };

        await uploadSnapshot(meta, encryptedPacket);

        setLoading(false);
        showToast(`会话【${convTitle}】已成功同步至云端！`);
    } catch (err) {
        setLoading(false);
        showToast(`云同步失败: ${err.message}`, true);
    }
}
