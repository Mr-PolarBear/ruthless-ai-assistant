/**
 * @file dynamic-variable-engine.js
 * @description 动态变量引擎：负责解析与替换备忘录、人设与提示词中的 {{date}}、{{time}}、{{model}} 等动态宏。
 * 遵循架构解耦原则，纯函数设计，发请求时实时求值。
 */

import { regexPatterns } from '../regex.js?v=temp';

/**
 * 获取当前运行平台名称
 * @returns {'Windows' | 'Mac' | 'Linux' | 'Android' | 'iOS' | 'Web'}
 */
export function getSystemPlatform() {
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    if (/android/i.test(userAgent)) return 'Android';
    if (/ipad|iphone|ipod/i.test(userAgent)) return 'iOS';
    if (/win/i.test(userAgent)) return 'Windows';
    if (/mac/i.test(userAgent)) return 'Mac';
    if (/linux/i.test(userAgent)) return 'Linux';
    return 'Web';
}

/**
 * 格式化两位数字（补0）
 * @param {number} n 
 * @returns {string}
 */
function padZero(n) {
    return n < 10 ? `0${n}` : String(n);
}

/**
 * 中文星期映射
 */
const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 格式化自定义日期模板
 * 支持 YYYY, MM, DD, HH, mm, ss, W
 * @param {Date} date 
 * @param {string} formatStr 
 * @returns {string}
 */
function formatCustomDate(date, formatStr) {
    const YYYY = String(date.getFullYear());
    const MM = padZero(date.getMonth() + 1);
    const DD = padZero(date.getDate());
    const HH = padZero(date.getHours());
    const mm = padZero(date.getMinutes());
    const ss = padZero(date.getSeconds());
    const W = WEEKDAY_NAMES[date.getDay()];

    return formatStr
        .replace(/YYYY/g, YYYY)
        .replace(/MM/g, MM)
        .replace(/DD/g, DD)
        .replace(/HH/g, HH)
        .replace(/mm/g, mm)
        .replace(/ss/g, ss)
        .replace(/W/g, W);
}

/**
 * 支持的动态变量元信息清单（用于 UI 提示与快捷插入）
 */
export const DYNAMIC_VARIABLES_METADATA = [
    { key: '{{datetime}}', label: '完整时间', desc: '示例：2026-10-29 10:00:00' },
    { key: '{{date}}', label: '当前日期', desc: '示例：2026-10-29' },
    { key: '{{time}}', label: '当前时刻', desc: '示例：10:00:00' },
    { key: '{{weekday}}', label: '当前星期', desc: '示例：星期四' },
    { key: '{{model}}', label: '当前模型', desc: '示例：gpt-4o' },
    { key: '{{conversation_title}}', label: '会话标题', desc: '当前对话的主题名称' },
    { key: '{{platform}}', label: '运行平台', desc: '示例：Windows / Android' }
];

/**
 * 解析并替换文本中的动态变量
 * @param {string} text - 待解析的原始文本
 * @param {object} [context] - 上下文环境
 * @param {object} [context.currentConv] - 当前会话对象
 * @param {object} [context.apiEndpoint] - 当前 API 端点配置
 * @param {Date} [context.nowDate] - 可选的固定时间（主要用于单元测试）
 * @returns {string} 替换后的文本
 */
export function resolveDynamicVariables(text, context = {}) {
    if (typeof text !== 'string' || !text.includes('{{')) {
        return text;
    }

    const now = context.nowDate instanceof Date ? context.nowDate : new Date();
    const currentConv = context.currentConv || {};
    const apiEndpoint = context.apiEndpoint || {};

    const YYYY = String(now.getFullYear());
    const MM = padZero(now.getMonth() + 1);
    const DD = padZero(now.getDate());
    const HH = padZero(now.getHours());
    const mm = padZero(now.getMinutes());
    const ss = padZero(now.getSeconds());
    const weekday = WEEKDAY_NAMES[now.getDay()];

    // 基础预置宏映射表
    const macroMap = {
        'date': `${YYYY}-${MM}-${DD}`,
        'time': `${HH}:${mm}:${ss}`,
        'datetime': `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`,
        'year': YYYY,
        'month': MM,
        'day': DD,
        'hour': HH,
        'minute': mm,
        'second': ss,
        'weekday': weekday,
        'week': weekday,
        'timestamp': String(now.getTime()),
        'platform': getSystemPlatform(),
        'model': String(currentConv.model || apiEndpoint.model || 'unknown'),
        'conversation_title': String(currentConv.title || '新会话')
    };

    // 使用集中管理的正则匹配 {{...}}
    const pattern = new RegExp(regexPatterns.dynamicPlaceholder.source, regexPatterns.dynamicPlaceholder.flags);

    return text.replace(pattern, (match, rawExpr) => {
        const expr = (rawExpr || '').trim();
        if (!expr) return match;

        // 1. 直接全字匹配基础宏（忽略大小写）
        const lowerExpr = expr.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(macroMap, lowerExpr)) {
            return macroMap[lowerExpr];
        }

        // 2. 支持参数化日期格式，例如 {{date:YYYY年MM月DD日 HH:mm}}
        if (lowerExpr.startsWith('date:') || lowerExpr.startsWith('datetime:')) {
            const formatPart = expr.substring(expr.indexOf(':') + 1).trim();
            if (formatPart) {
                return formatCustomDate(now, formatPart);
            }
        }

        // 3. 未知占位符安全保留原样，避免普通模板或代码块冲突
        return match;
    });
}
