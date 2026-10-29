/**
 * @file mcp-error-modal.js
 * @description MCP 工具调用错误详情诊断弹窗
 * 提供错误摘要展示、请求参数格式化、服务端原始响应展示、一键复制诊断报告及立即重试能力。
 */

import { dom } from '../dom.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

// 记录当前弹窗绑定的错误详情与重试回调
let currentErrorDetail = null;
let currentRetryCallback = null;

/**
 * 格式化 JSON 或对象为美化字符串
 * @param {*} data 
 * @returns {string}
 */
function formatJsonString(data) {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return JSON.stringify(parsed, null, 2);
        } catch (e) {
            return data;
        }
    }
    try {
        return JSON.stringify(data, null, 2);
    } catch (e) {
        return String(data);
    }
}

/**
 * 打开 MCP 错误详情弹窗
 * @param {Object} options
 * @param {string} options.toolName - 工具显示名称
 * @param {string} options.toolId - 工具唯一标识符
 * @param {string} options.error - 错误信息概要
 * @param {*} options.parameters - 请求参数
 * @param {*} options.errorData - 服务端返回的原始错误数据/响应体
 * @param {number|string} [options.timestamp] - 发生时间
 * @param {Function} [options.onRetry] - 重试回调函数
 */
export function openMcpErrorModal(options = {}) {
    const modal = dom.mcpErrorModal || document.getElementById('mcp-error-modal');
    if (!modal) {
        console.warn('mcpErrorModal DOM 节点不存在');
        return;
    }

    currentErrorDetail = options;
    currentRetryCallback = typeof options.onRetry === 'function' ? options.onRetry : null;

    const toolNameEl = document.getElementById('mcp-error-tool-name');
    const toolIdEl = document.getElementById('mcp-error-tool-id');
    const timeEl = document.getElementById('mcp-error-time');
    const summaryEl = document.getElementById('mcp-error-summary-text');
    const paramsCodeEl = document.getElementById('mcp-error-params-code');
    const responseCodeEl = document.getElementById('mcp-error-response-code');
    const retryBtn = document.getElementById('mcp-error-retry-action-btn');

    const toolName = options.toolName || '未知工具';
    const toolId = options.toolId || options.toolName || 'unknown';
    const timestamp = options.timestamp ? new Date(options.timestamp).toLocaleString() : new Date().toLocaleString();
    const errorMsg = options.error || '未知调用错误';

    if (toolNameEl) toolNameEl.textContent = toolName;
    if (toolIdEl) toolIdEl.textContent = toolId;
    if (timeEl) timeEl.textContent = timestamp;
    if (summaryEl) summaryEl.textContent = errorMsg;

    // 参数格式化与代码高亮
    const paramsStr = formatJsonString(options.parameters) || '(无传递参数)';
    if (paramsCodeEl) {
        paramsCodeEl.textContent = paramsStr;
        paramsCodeEl.removeAttribute('data-highlighted');
        if (window.hljs) {
            try { window.hljs.highlightElement(paramsCodeEl); } catch (e) {}
        }
    }

    // 响应体格式化与代码高亮
    let respStr = formatJsonString(options.errorData);
    if (!respStr || respStr === '{}') {
        respStr = '(未获取到服务端响应体，可能是网络不通、域名跨域(CORS)或连接中断)';
    }
    if (responseCodeEl) {
        responseCodeEl.textContent = respStr;
        responseCodeEl.removeAttribute('data-highlighted');
        if (window.hljs && options.errorData) {
            try { window.hljs.highlightElement(responseCodeEl); } catch (e) {}
        }
    }

    // 控制弹窗底部的重试按钮显隐
    if (retryBtn) {
        retryBtn.style.display = currentRetryCallback ? 'inline-flex' : 'none';
        retryBtn.disabled = false;
        retryBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>立即重试
        `;
    }

    modal.style.display = 'flex';
    modal.classList.add('visible');
}

/**
 * 关闭 MCP 错误详情弹窗
 */
export function closeMcpErrorModal() {
    const modal = dom.mcpErrorModal || document.getElementById('mcp-error-modal');
    if (!modal) return;

    modal.classList.remove('visible');
    modal.style.display = 'none';
    currentErrorDetail = null;
    currentRetryCallback = null;
}

/**
 * 复制文本到系统剪贴板
 * @param {string} text 
 * @param {string} successTip 
 */
async function copyToClipboard(text, successTip = '复制成功') {
    if (!text) {
        notify.warning('没有可复制的内容');
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        notify.success(successTip);
    } catch (err) {
        console.error('复制失败:', err);
        notify.error('复制到剪贴板失败，请手动选择复制');
    }
}

/**
 * 初始化 MCP 错误弹窗事件监听
 */
export function initMcpErrorModal() {
    const modal = document.getElementById('mcp-error-modal');
    if (!modal) return;

    // 缓存到 dom 对象上
    dom.mcpErrorModal = modal;

    // 绑定关闭按钮（包含 header close 和 footer cancel）
    modal.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMcpErrorModal();
        });
    });

    // 点击遮罩层背景关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeMcpErrorModal();
        }
    });

    // ESC 键快捷关闭弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('visible')) {
            closeMcpErrorModal();
        }
    });

    // 复制参数按钮
    const copyParamsBtn = document.getElementById('mcp-error-copy-params-btn');
    if (copyParamsBtn) {
        copyParamsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = document.getElementById('mcp-error-params-code')?.textContent || '';
            copyToClipboard(text, '已复制调用参数 JSON');
        });
    }

    // 复制响应数据按钮
    const copyRespBtn = document.getElementById('mcp-error-copy-response-btn');
    if (copyRespBtn) {
        copyRespBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = document.getElementById('mcp-error-response-code')?.textContent || '';
            copyToClipboard(text, '已复制服务端响应内容');
        });
    }

    // 一键复制完整排查报告
    const copyAllBtn = document.getElementById('mcp-error-copy-all-btn');
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!currentErrorDetail) {
                notify.warning('暂无错误信息');
                return;
            }
            const report = [
                `【MCP 工具调用失败诊断报告】`,
                `工具名称: ${currentErrorDetail.toolName || '未知'}`,
                `工具 ID: ${currentErrorDetail.toolId || '未知'}`,
                `发生时间: ${currentErrorDetail.timestamp ? new Date(currentErrorDetail.timestamp).toLocaleString() : new Date().toLocaleString()}`,
                `\n[错误概要]\n${currentErrorDetail.error || '无'}`,
                `\n[调用参数]\n${formatJsonString(currentErrorDetail.parameters) || '{}'}`,
                `\n[服务端响应/原始数据]\n${formatJsonString(currentErrorDetail.errorData) || '无'}`
            ].join('\n');

            copyToClipboard(report, '已复制完整诊断报告');
        });
    }

    // 弹窗内的立即重试按钮
    const retryBtn = document.getElementById('mcp-error-retry-action-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (typeof currentRetryCallback === 'function') {
                const cb = currentRetryCallback;
                closeMcpErrorModal();
                try {
                    await cb();
                } catch (err) {
                    console.error('弹窗触发重试失败:', err);
                }
            }
        });
    }
}

// 暴露到全局供调试与兼容调用
window.openMcpErrorModal = openMcpErrorModal;
window.closeMcpErrorModal = closeMcpErrorModal;
