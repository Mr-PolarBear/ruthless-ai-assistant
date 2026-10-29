/**
 * @file changelog-manager.js
 * @description 专职负责版本更新日志的弹窗调度、最新版本号感知与本地已读状态持久化管理。
 * 
 * — 为什么这么写 —
 * 1. 痛点：每次产品发布新版本后，用户往往不知道新增了什么特性或优化了什么交互，
 *    导致大量好用的功能无法被及时感知。
 * 2. 机制：
 *    - 应用启动时，从 modals.html 渲染出来的最新版本标签（.changelog-version-tag）中动态提取版本号（如 "v2.9.2"）；
 *    - 比对 localStorage 中存储的已读版本号（ai-chat-last-changelog-version）；
 *    - 若本地不存在该版本号或与最新版本不一致，则在首屏初始化完成后主动弹出更新日志弹窗；
 *    - 弹窗唤起后立即原子化记录当前版本到 localStorage，确保当前版本下后续刷新不再弹窗打扰用户。
 * 3. 架构解耦：
 *    - 遵循组件化与独立模块规范，将版本弹窗的打开、关闭、已读检测与 Tab 状态重置收敛于独立服务，
 *      不侵入大体积的 utils.js 或 ui-events.js。
 */

/** 本地存储 Key：记录用户上次查看过的更新日志版本号 */
export const CHANGELOG_STORAGE_KEY = 'ai-chat-last-changelog-version';

/**
 * 动态提取更新日志弹窗中排在最前方的最新版本号
 * @returns {string|null} 最新版本号字符串（如 "v2.9.2"），若未获取到则返回 null
 */
export function getLatestChangelogVersion() {
    // — 为什么这么写 —
    // 更新日志弹窗是按版本倒序排布的，第一条 .changelog-version-tag 即为最新发版版本。
    // 直接读取首个标签不仅无需在 JS 中硬编码版本号，更保证了开发、测试与生产环境下 100% 数据单点真理（Single Source of Truth）。
    const modal = document.getElementById('changelog-modal');
    if (!modal) return null;

    const firstTag = modal.querySelector('.changelog-version-tag');
    if (firstTag && firstTag.textContent) {
        return firstTag.textContent.trim();
    }

    return null;
}

/**
 * 打开更新日志弹窗并规范重置视图状态
 */
export function openChangelogModal() {
    const modal = document.getElementById('changelog-modal');
    if (!modal) return;

    modal.style.display = 'flex';

    // — 为什么这么写 —
    // 主动唤起时，强制激活“更新日志”标签页并滚动置顶，确保用户第一眼看到的是最新版本的更新条目，
    // 避免因上次关闭前停留在“待开发功能”标签页而展示错位。
    const tabBtns = modal.querySelectorAll('.changelog-tab-btn');
    const tabContents = modal.querySelectorAll('.changelog-tab-content');

    tabBtns.forEach(btn => {
        if (btn.getAttribute('data-changelog-tab') === 'changelog-content') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    tabContents.forEach(content => {
        if (content.id === 'changelog-content') {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
}

/**
 * 关闭更新日志弹窗
 */
export function closeChangelogModal() {
    const modal = document.getElementById('changelog-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 应用启动时检测版本并决定是否主动弹出更新日志
 * @param {number} [delayMs=400] - 延时执行毫秒数，避开首屏繁忙渲染
 */
export function checkAndShowChangelogOnStartup(delayMs = 400) {
    setTimeout(() => {
        try {
            const latestVersion = getLatestChangelogVersion();
            if (!latestVersion) {
                console.warn('[ChangelogManager] 未能提取到有效的最新更新日志版本号，跳过主动弹窗');
                return;
            }

            const savedVersion = localStorage.getItem(CHANGELOG_STORAGE_KEY);

            // 若本地未记录此版本，或与最新版本不一致，则主动弹窗
            if (savedVersion !== latestVersion) {
                console.log(`[ChangelogManager] 检测到新版本更新日志 (${latestVersion})，本地记录为 (${savedVersion || '无'})，正在主动展示更新日志弹窗...`);
                openChangelogModal();
                // 立即记录当前版本，防止该版本后续再次弹出打扰用户
                localStorage.setItem(CHANGELOG_STORAGE_KEY, latestVersion);
            }
        } catch (err) {
            console.error('[ChangelogManager] 检测更新日志弹窗逻辑异常:', err);
        }
    }, delayMs);
}
