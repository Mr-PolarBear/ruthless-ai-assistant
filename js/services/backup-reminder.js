/**
 * @file backup-reminder.js
 * @description 专职负责本地 IndexedDB 数据备份健康度检测与定期提醒服务。
 * 遵循高内聚、低耦合设计，提供分别导出会话/配置、一键全量备份与30天延期提醒。
 */

import { getAllConversationIds } from '../db.js?v=260820-1';
import { exportAllConversations, exportConfig } from '../utils.js?v=260820-1';
import { notify } from '../ui-updater.js?v=260820-1';

const STORAGE_KEYS = {
    LAST_BACKUP_TIME: 'last_full_backup_time',
    LAST_CONFIG_TIME: 'last_config_backup_time',
    SNOOZED_UNTIL: 'backup_reminder_snoozed_until'
};

/** 默认未备份预警阈值（14天） */
const DEFAULT_WARNING_DAYS = 14;
/** 最少会话数阈值（少于3条不打扰） */
const MIN_CONV_COUNT = 3;

/**
 * 延期提醒
 * @param {number} days - 延期天数
 */
export function snoozeBackupReminder(days = 7) {
    const snoozeUntil = Date.now() + days * 24 * 60 * 60 * 1000;
    try {
        localStorage.setItem(STORAGE_KEYS.SNOOZED_UNTIL, String(snoozeUntil));
    } catch (e) {
        console.warn('保存延期时间失败:', e);
    }
    hideBackupReminder();
}

/**
 * 隐藏备份提醒横幅
 */
export function hideBackupReminder() {
    const container = document.getElementById('backup-reminder-container');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

/**
 * 执行一键备份全部（依次分别导出全局配置与全量会话文件）
 */
export async function executeBackupAll() {
    try {
        // 1. 导出全局配置
        exportConfig();

        // 2. 稍作延迟触发会话导出，避免浏览器拦截连续下载
        setTimeout(async () => {
            await exportAllConversations();
            const now = Date.now();
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_BACKUP_TIME, String(now));
                localStorage.setItem(STORAGE_KEYS.LAST_CONFIG_TIME, String(now));
            } catch (_) {}
            notify.success('配置与会话已全部备份下载！');
            hideBackupReminder();
        }, 400);
    } catch (err) {
        console.error('一键备份失败:', err);
        notify.error('备份执行失败，请重试');
    }
}

/**
 * 渲染备份提醒横幅
 * @param {number} daysUnbacked - 未备份天数
 */
function renderReminderBanner(daysUnbacked) {
    const container = document.getElementById('backup-reminder-container');
    if (!container) return;

    const daysText = daysUnbacked > 99 ? '99+' : String(daysUnbacked);

    container.innerHTML = `
        <div class="backup-reminder-card">
            <div class="backup-reminder-header">
                <div class="backup-reminder-title-wrap">
                    <span class="backup-reminder-icon">🛡️</span>
                    <span class="backup-reminder-title">数据备份健康度提醒</span>
                </div>
                <button class="backup-reminder-close-btn" title="7天后再提醒">&times;</button>
            </div>
            <div class="backup-reminder-body">
                <div class="backup-reminder-msg">
                    已有 <strong class="backup-days-highlight">${daysText}</strong> 天未全量备份，为防止浏览器缓存意外清理，建议备份：
                </div>
                <div class="backup-reminder-actions-row">
                    <button id="backup-btn-all" class="backup-action-btn primary" title="依次导出配置与会话两个文件">🚀 一键备份全部</button>
                    <button id="backup-btn-conv" class="backup-action-btn secondary" title="仅导出全部会话 JSON">📦 导出会话</button>
                    <button id="backup-btn-config" class="backup-action-btn secondary" title="仅导出全局配置 JSON">⚙️ 导出配置</button>
                    <button id="backup-btn-snooze30" class="backup-action-btn text-btn" title="30天内不再显示此提醒">🕒 延期30天提醒</button>
                </div>
            </div>
        </div>
    `;

    container.style.display = 'block';

    // 绑定事件
    const btnAll = container.querySelector('#backup-btn-all');
    const btnConv = container.querySelector('#backup-btn-conv');
    const btnConfig = container.querySelector('#backup-btn-config');
    const btnSnooze30 = container.querySelector('#backup-btn-snooze30');
    const btnClose = container.querySelector('.backup-reminder-close-btn');

    if (btnAll) {
        btnAll.addEventListener('click', executeBackupAll);
    }
    if (btnConv) {
        btnConv.addEventListener('click', async () => {
            await exportAllConversations();
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_BACKUP_TIME, String(Date.now()));
            } catch (_) {}
            notify.success('已完成全量会话备份！');
            hideBackupReminder();
        });
    }
    if (btnConfig) {
        btnConfig.addEventListener('click', () => {
            exportConfig();
            try {
                localStorage.setItem(STORAGE_KEYS.LAST_CONFIG_TIME, String(Date.now()));
            } catch (_) {}
            notify.success('已完成全局配置导出！');
        });
    }
    if (btnSnooze30) {
        btnSnooze30.addEventListener('click', () => {
            snoozeBackupReminder(30);
            notify.info('已设置 30 天后再次提醒备份');
        });
    }
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            snoozeBackupReminder(7);
            notify.info('已设置 7 天后再次提醒备份');
        });
    }
}

/**
 * 检测本地数据健康度并决定是否展现提醒
 */
export async function checkBackupHealth() {
    try {
        // 1. 检查是否在用户延期提醒期内
        const snoozedUntil = localStorage.getItem(STORAGE_KEYS.SNOOZED_UNTIL);
        if (snoozedUntil && Date.now() < Number(snoozedUntil)) {
            return;
        }

        // 2. 统计当前实际会话数量
        const convIds = await getAllConversationIds();
        if (!Array.isArray(convIds) || convIds.length < MIN_CONV_COUNT) {
            return; // 会话较少时不打扰
        }

        // 3. 计算距离上次全量备份的天数
        const lastBackupStr = localStorage.getItem(STORAGE_KEYS.LAST_BACKUP_TIME);
        let daysUnbacked = DEFAULT_WARNING_DAYS;

        if (lastBackupStr && !isNaN(Number(lastBackupStr))) {
            const lastTime = Number(lastBackupStr);
            daysUnbacked = Math.floor((Date.now() - lastTime) / (24 * 60 * 60 * 1000));
        } else {
            // 从未备份过：设置默认未备份天数为 15 天
            daysUnbacked = 15;
        }

        // 4. 超过阈值则展示提醒横幅
        if (daysUnbacked >= DEFAULT_WARNING_DAYS) {
            renderReminderBanner(daysUnbacked);
        }
    } catch (err) {
        console.warn('备份健康度检测失败:', err);
    }
}

/**
 * 初始化备份提醒服务
 */
export function initBackupReminder() {
    // 延迟 1.2 秒检测，避免阻塞页面首屏渲染
    setTimeout(() => {
        checkBackupHealth();
    }, 1200);
}
