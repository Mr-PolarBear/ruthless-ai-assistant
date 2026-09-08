/**
 * @file version-checker.js
 * @description 客户端版本检测与防缓存无损在线更新服务
 * 
 * — 为什么这么写 —
 * 1. 痛点根源：手机浏览器（如夸克、UC、小米/华为自带等）缺乏类似 PC 端的 Ctrl+F5 强制刷新，
 *    入口 index.html 常被手机强行缓存在本地磁盘中，导致用户刷新后依然运行旧代码；
 *    为了获取新版，用户被迫在浏览器中执行“清除缓存”，结果误勾选“清除网站数据”，
 *    把 IndexedDB 与 LocalStorage 中的历史会话和 API Key 一并抹除！
 * 2. 方案机制：
 *    - 发版工具 (release.ps1) 会在根目录下自动生成附带最新版本号与构建时间戳的 version.json；
 *    - 前端启动时、或从手机后台切回前台 (visibilitychange) 时，带 _t=时间戳与 no-store 静默比对；
 *    - 一旦线上版本高于当前页面版本，顶部无缝弹出提示横幅，支持一键无损更新；
 * 3. 极速穿透且零数据损失：
 *    - 点击“立即更新”或“强制重载”时，带时间戳重新导航 (location.replace)，
 *      100% 击穿手机浏览器的 Disk Cache，秒级拉取最新 HTML 与资源；
 *    - 完全不触碰 IndexedDB 和 LocalStorage，保证用户会话数据绝对安全！
 */

import { notify } from '../ui-updater.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';

/** 记录上次检测时间戳，防止切换前台过于频繁 */
let lastCheckTime = 0;
const CHECK_MIN_INTERVAL_MS = 60 * 1000; // 最低静默检测间隔：60秒

/** 缓存最新获取的线上版本信息 */
let latestRemoteVersionInfo = null;

/**
 * 获取当前页面运行的应用版本号
 * @returns {string} 版本号字符串 (如 "260907" 或 "2609081430")
 */
export function getCurrentAppVersion() {
    // 优先从 <meta name="app-version"> 读取
    const metaTag = document.querySelector('meta[name="app-version"]');
    if (metaTag && metaTag.content) {
        return metaTag.content.trim();
    }

    // 备用：从页面标题匹配 (智能摸鱼 (v260907))
    const titleMatch = document.title.match(regexPatterns.versionFromTitle);
    if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim();
    }

    return 'unknown';
}

/**
 * 比对线上版本与本地版本，判断是否有更新
 * @param {string} remoteVer - 线上版本
 * @param {string} localVer - 当前运行版本
 * @returns {boolean} 是否为较新版本
 */
function isNewerVersion(remoteVer, localVer) {
    if (!remoteVer || remoteVer === 'unknown') return false;
    if (!localVer || localVer === 'unknown') return true;

    // 若均为纯数字（如 yyMMddHHmm 或 yyMMdd），直接通过数字大小比对（时间越新数值越大）
    const numRemote = Number(remoteVer);
    const numLocal = Number(localVer);
    if (!isNaN(numRemote) && !isNaN(numLocal)) {
        return numRemote > numLocal;
    }

    // 非纯数字退化为不相等即视为不同版本
    return remoteVer !== localVer;
}

/**
 * 核心：发起线上版本检测
 * @param {boolean} [isManual=false] - 是否为用户在设置中手动点击“检查更新”
 * @returns {Promise<{hasUpdate: boolean, remoteVersion: string, currentVersion: string, buildTime: string}|null>}
 */
export async function checkNewVersion(isManual = false) {
    const currentVersion = getCurrentAppVersion();
    const now = Date.now();

    try {
        // 请求根目录 version.json，必须附加时间戳与 no-store 头，彻底击穿任何网络/本地缓存
        const response = await fetch(`version.json?_t=${now}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const remoteVersion = (data.version || '').trim();
        const buildTime = data.buildTime || '';
        latestRemoteVersionInfo = { remoteVersion, buildTime, currentVersion };

        lastCheckTime = now;

        const hasUpdate = isNewerVersion(remoteVersion, currentVersion);

        // 同步刷新设置弹窗中的卡片显示（若当前在设置界面）
        updateVersionCardUI({ hasUpdate, remoteVersion, currentVersion, buildTime });

        if (hasUpdate) {
            // 如果不是手动点击，且用户在此次会话中曾经点击“稍后”，则不频繁弹窗打扰
            const snoozedVer = sessionStorage.getItem('snoozed_update_version');
            if (!isManual && snoozedVer === remoteVersion) {
                return { hasUpdate: true, remoteVersion, currentVersion, buildTime };
            }

            // 弹出顶部更新横幅
            showUpdateBanner(remoteVersion, buildTime);

            if (isManual) {
                notify.info(`发现新版本 (v${remoteVersion})，已在顶部弹出更新提示！`);
            }
        } else {
            if (isManual) {
                notify.success(`当前已是最新版本 (v${currentVersion})，无需更新！`);
            }
        }

        return { hasUpdate, remoteVersion, currentVersion, buildTime };

    } catch (err) {
        console.warn('版本检测失败:', err);
        if (isManual) {
            notify.warning('检查版本失败，请确认本地服务已启动或网络正常连接。');
        }
        return null;
    }
}

/**
 * 执行无损在线强制更新（穿透缓存重载）
 * 100% 保留 IndexedDB 会话记录与 LocalStorage API 配置！
 */
export async function forceUpdateApp() {
    notify.info('正在获取最新版本并刷新...');

    // 1. 若浏览器支持 CacheStorage，尝试清理静态资源缓存条目（注意：绝不碰 IndexedDB 和 LocalStorage）
    if ('caches' in window) {
        try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(k => caches.delete(k)));
        } catch (_) {}
    }

    // 2. 带随机时间戳重载主入口 URL，彻底迫使手机浏览器重新从服务器拉取 index.html
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('_update', Date.now().toString());

    // 使用 replace 避免在手机后退历史里留下重复条目
    setTimeout(() => {
        window.location.replace(targetUrl.toString());
    }, 200);
}

/**
 * 渲染或展示顶部全局版本更新横幅
 * @param {string} newVersion - 新版本号
 * @param {string} buildTime - 构建时间
 */
export function showUpdateBanner(newVersion, buildTime = '') {
    let banner = document.getElementById('version-update-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'version-update-banner';
        banner.className = 'version-update-banner';
        document.body.prepend(banner);
    }

    const timeLabel = buildTime ? ` (发布于 ${buildTime})` : '';

    banner.innerHTML = `
        <div class="version-banner-container">
            <div class="version-banner-info">
                <span class="version-banner-icon">🚀</span>
                <div class="version-banner-text">
                    <strong>发现新版本</strong>
                    <span class="version-banner-badge">v${newVersion}</span>${timeLabel}
                    <span>，点击立即更新即可载入最新代码（对话记录与配置 100% 保留）。</span>
                </div>
            </div>
            <div class="version-banner-actions">
                <button id="version-btn-update-now" class="version-btn-update" type="button">立即更新</button>
                <button id="version-btn-snooze-banner" class="version-btn-snooze" type="button" title="本次会话不再提示">稍后</button>
            </div>
        </div>
    `;

    banner.classList.remove('banner-hiding');
    banner.style.display = 'block';

    // 绑定立即更新按钮
    const updateBtn = banner.querySelector('#version-btn-update-now');
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            forceUpdateApp();
        });
    }

    // 绑定稍后按钮
    const snoozeBtn = banner.querySelector('#version-btn-snooze-banner');
    if (snoozeBtn) {
        snoozeBtn.addEventListener('click', () => {
            sessionStorage.setItem('snoozed_update_version', newVersion);
            banner.classList.add('banner-hiding');
            setTimeout(() => {
                banner.style.display = 'none';
            }, 300);
        });
    }
}

/**
 * 更新设置面板中的“版本与在线更新”卡片信息
 * @param {Object} [info] - 版本详情
 */
export function updateVersionCardUI(info = null) {
    const curVerLabel = document.getElementById('app-current-version-label');
    const statusBadge = document.getElementById('app-version-status-badge');
    const updateTimeDesc = document.getElementById('app-version-build-time');

    const currentVersion = getCurrentAppVersion();
    if (curVerLabel) {
        curVerLabel.textContent = `v${currentVersion}`;
    }

    if (!info) {
        info = latestRemoteVersionInfo;
    }

    if (!statusBadge) return;

    if (info) {
        const hasUpdate = isNewerVersion(info.remoteVersion, currentVersion);
        if (hasUpdate) {
            statusBadge.className = 'badge badge-warning';
            statusBadge.style.background = '#fef3c7';
            statusBadge.style.color = '#b45309';
            statusBadge.textContent = `可更新至 v${info.remoteVersion}`;
        } else {
            statusBadge.className = 'badge badge-success';
            statusBadge.style.background = '#dcfce7';
            statusBadge.style.color = '#15803d';
            statusBadge.textContent = '已是最新版';
        }

        if (updateTimeDesc && info.buildTime) {
            updateTimeDesc.textContent = `线上构建时间: ${info.buildTime}`;
        }
    } else {
        statusBadge.textContent = '未检测';
    }

    // 绑定设置卡片中的“检查更新”与“强制刷新”按钮（防重复绑定）
    const checkBtn = document.getElementById('check-app-update-btn');
    if (checkBtn && !checkBtn.dataset.bound) {
        checkBtn.dataset.bound = 'true';
        checkBtn.addEventListener('click', () => {
            checkNewVersion(true);
        });
    }

    const forceBtn = document.getElementById('force-app-reload-btn');
    if (forceBtn && !forceBtn.dataset.bound) {
        forceBtn.dataset.bound = 'true';
        forceBtn.addEventListener('click', () => {
            forceUpdateApp();
        });
    }
}

/**
 * 初始化版本检测机制：
 * 1. 启动延迟检测
 * 2. 注册前后台切换 (visibilitychange) 唤醒检测
 * 3. 挂载全局便捷对象 window.AppVersion
 */
export function initVersionChecker() {
    // 启动 2.5 秒后静默检测一次（避开首屏繁忙渲染）
    setTimeout(() => {
        checkNewVersion(false);
    }, 2500);

    // 手机端：用户切换 App 回来或锁屏解锁时，静默检测一次
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const now = Date.now();
            if (now - lastCheckTime > CHECK_MIN_INTERVAL_MS) {
                checkNewVersion(false);
            }
        }
    });

    // 挂载控制台与全局辅助
    window.AppVersion = {
        getCurrent: getCurrentAppVersion,
        check: (manual = true) => checkNewVersion(manual),
        forceUpdate: forceUpdateApp
    };
}
