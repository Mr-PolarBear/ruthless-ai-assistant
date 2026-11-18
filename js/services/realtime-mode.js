/**
 * @file realtime-mode.js
 * @description 实时模式核心服务与历法计算引擎
 * 负责虚拟时间推算、UTC绝对历法日历差推进、平闰年（如2020年2月29天）跨月换算、
 * 自动历法星期计算、时间粒度格式化与精炼版系统提示词模板维护。
 */

// 星期映射表：通过原生 Date.getDay() (0~6) 自动计算星期，不可让用户手动选星期
export const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 精简优化版系统提示词模板（严格区隔正文禁旁白与状态栏内心戏，面对面场景升阶叙事，强约束时序因果律防穿帮）
export const DEFAULT_REALTIME_PROMPT = `【异地实时聊天规范】
1. 交互形态：当用户消息末尾带时间戳（如:--2026-11-06 08:12）时，默认为手机即时通讯异地聊天。正文仅输出口语化对话短句，严禁包含动作旁白与心理活动。
2. 状态栏呈现：对话末尾附带轻量状态栏，如实反映角色在线下的真实处境与内心想法：
【状态栏】
所在位置：教室后排
当前行为：环顾周围后拿着手机傻笑
心理活动：这个人嘴巴真会哄人
3. 时序约束：用户时间为客观基准时刻，角色作息、日常与话题必须符合该时段规律。角色回复中若提及时间，携带的时间必须在用户时间后10秒内（如用户08:12:01，控制在08:12:11内），严禁擅自跃迁推进时间防止穿帮。
4. 场景升阶：若剧情推进到双方线下碰面或同处一室，面对面场景优先级高于手机聊天，自动退出纯对话，无缝切换为包含动作、神态、环境描写的沉浸叙事模式。`;

/**
 * 格式化现实系统日期为 YYYY-MM-DD
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
export function getFormattedDateStr(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 获取默认实时模式配置对象
 * @returns {Object}
 */
export function getDefaultRealtimeConfig() {
    const now = new Date();
    return {
        enabled: false,             // 实时模式总开关
        dateMode: 'system',         // 'system'（跟随系统）| 'custom'（自定义虚拟日期）
        customYear: now.getFullYear(),// 自定义年份
        customMonth: now.getMonth() + 1,// 自定义月份 (1~12)
        customDay: now.getDate(),   // 自定义日 (1~31)
        linkDateChange: true,       // 勾选项：是否关联现实日期推进
        baseRealDate: getFormattedDateStr(now), // 设定时的现实系统锚定日期 (YYYY-MM-DD)
        includeWeekday: true,       // 勾选项：是否包含星期（由最终虚拟年月日自动求值）
        timeGranularity: {          // 时间展示粒度
            hour: true,             // 默认勾选：时
            minute: true,           // 默认勾选：分
            second: false           // 默认未勾选：秒（可选）
        },
        appendAllUser: true,        // 注入策略：true (每条用户消息追加) | false (仅最新一条追加)
        promptEnabled: true,        // 是否将精简提示词注入系统消息
        prompt: DEFAULT_REALTIME_PROMPT // 独立保存在会话中，改动不影响其他会话
    };
}

/**
 * 标准化/规范化会话的 realtimeMode 配置
 * @param {Object} [cfg]
 * @returns {Object}
 */
export function normalizeRealtimeConfig(cfg) {
    const defaults = getDefaultRealtimeConfig();
    // — 为什么这么写 —
    // 防御性兼容：若第三方外部构造数据或网络传输未反序列化而传入 JSON 字符串，
    // 优先尝试安全解析，避免误判为非法类型而导致用户配置丢失。
    if (typeof cfg === 'string') {
        try {
            cfg = JSON.parse(cfg);
        } catch (_) {
            return defaults;
        }
    }
    if (!cfg || typeof cfg !== 'object') {
        return defaults;
    }
    const customYear = parseInt(cfg.customYear, 10) || defaults.customYear;
    const customMonth = Math.min(12, Math.max(1, parseInt(cfg.customMonth, 10) || defaults.customMonth));
    // 动态根据所选年月准确获取当月最大天数（完美适配平闰年2月28/29天与大小月）
    const maxDays = new Date(customYear, customMonth, 0).getDate();
    const customDay = Math.min(maxDays, Math.max(1, parseInt(cfg.customDay, 10) || defaults.customDay));

    return {
        enabled: !!cfg.enabled,
        dateMode: (cfg.dateMode === 'custom') ? 'custom' : 'system',
        customYear: customYear,
        customMonth: customMonth,
        customDay: customDay,
        linkDateChange: cfg.linkDateChange !== undefined ? !!cfg.linkDateChange : true,
        baseRealDate: typeof cfg.baseRealDate === 'string' && cfg.baseRealDate ? cfg.baseRealDate : defaults.baseRealDate,
        includeWeekday: cfg.includeWeekday !== undefined ? !!cfg.includeWeekday : true,
        timeGranularity: {
            hour: cfg.timeGranularity?.hour !== undefined ? !!cfg.timeGranularity.hour : true,
            minute: cfg.timeGranularity?.minute !== undefined ? !!cfg.timeGranularity.minute : true,
            second: cfg.timeGranularity?.second !== undefined ? !!cfg.timeGranularity.second : false
        },
        appendAllUser: cfg.appendAllUser !== undefined ? !!cfg.appendAllUser : true,
        promptEnabled: cfg.promptEnabled !== undefined ? !!cfg.promptEnabled : true,
        prompt: typeof cfg.prompt === 'string' && cfg.prompt.trim() ? cfg.prompt : DEFAULT_REALTIME_PROMPT
    };
}

/**
 * 计算虚拟时间对象
 * — 为什么这么写 —
 * 1. dateMode === 'system': 直接返回真实消息时间，不偏离现实；
 * 2. dateMode === 'custom': 继承自定义年月日，同时保真继承消息真实的【时、分、秒、毫秒】（严禁抹除为 00:00:00）；
 * 3. 针对 0~99 年份做 setFullYear 修正，规避 JS 原生构造函数自动偏移到 1900 年代的固有缺陷；
 * 4. linkDateChange === true: 基于现实系统日期的 UTC 绝对天数差推算流逝天数，
 *    通过原生 Date.setDate() 自动进位，精准支持平闰年（如2020年2月29天）、跨月与跨年。
 *
 * @param {Object} cfg - 实时模式配置
 * @param {Date|number|string} [msgDate=new Date()] - 消息真实发送时间
 * @returns {Date} 虚拟 Date 对象
 */
export function calculateVirtualDate(cfg, msgDate = new Date()) {
    let d;
    if (msgDate instanceof Date) {
        d = !isNaN(msgDate.getTime()) ? msgDate : new Date();
    } else if (typeof msgDate === 'number' || typeof msgDate === 'string') {
        const parsed = new Date(msgDate);
        d = !isNaN(parsed.getTime()) ? parsed : new Date();
    } else {
        d = new Date();
    }

    if (!cfg || cfg.dateMode === 'system') {
        return new Date(d.getTime());
    }

    const vYear = parseInt(cfg.customYear, 10) || d.getFullYear();
    const vMonth = parseInt(cfg.customMonth, 10) || (d.getMonth() + 1);
    const vDay = parseInt(cfg.customDay, 10) || d.getDate();

    // 显式继承真实时分秒与毫秒
    const targetDate = new Date(
        vYear, vMonth - 1, vDay,
        d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
    );

    // 防御 JS 两位数年份自动解析为 1900 年代的语言缺陷
    if (vYear >= 0 && vYear <= 99) {
        targetDate.setFullYear(vYear);
    }

    if (!cfg.linkDateChange || !cfg.baseRealDate) {
        return targetDate;
    }

    // 基于 UTC 绝对日历差推算现实流逝天数
    const parts = cfg.baseRealDate.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) {
        return targetDate;
    }
    const [by, bm, bd] = parts;
    const baseUtc = Date.UTC(by, bm - 1, bd);
    const nowUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((nowUtc - baseUtc) / 86400000);

    // 原生 setDate 自动进位（支持2020年2月29天闰年跨月跨年）
    targetDate.setDate(targetDate.getDate() + diffDays);
    return targetDate;
}

/**
 * 获取星期几中文名称
 * @param {Date} date
 * @returns {string}
 */
export function getWeekdayName(date) {
    if (!date || isNaN(date.getTime())) return '';
    return WEEKDAYS[date.getDay()] || '';
}

/**
 * 格式化虚拟时间戳附加字符串
 * 示例：--2020-02-01 星期六 08:12
 *
 * @param {Date} vDate - 计算后的虚拟时间对象
 * @param {Object} cfg - 实时模式配置
 * @returns {string}
 */
export function formatVirtualTimestamp(vDate, cfg) {
    if (!vDate || isNaN(vDate.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    const y = String(vDate.getFullYear()).padStart(4, '0');
    const m = pad(vDate.getMonth() + 1);
    const d = pad(vDate.getDate());

    let res = `${y}-${m}-${d}`;

    // 星期由推算后的虚拟日期自动得出
    if (cfg?.includeWeekday) {
        res += ` ${WEEKDAYS[vDate.getDay()]}`;
    }

    const tg = cfg?.timeGranularity || {};
    const parts = [];
    if (tg.hour) parts.push(pad(vDate.getHours()));
    if (tg.minute) parts.push(pad(vDate.getMinutes()));
    if (tg.second) parts.push(pad(vDate.getSeconds()));

    if (parts.length > 0) {
        res += ` ${parts.join(':')}`;
    }

    return `--${res}`;
}
