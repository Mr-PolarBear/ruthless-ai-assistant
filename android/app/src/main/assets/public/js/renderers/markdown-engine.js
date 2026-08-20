/**
 * @file markdown-engine.js
 * @description Handles Markdown parsing, sanitization, and enhancement pipeline. 
 */

import { state } from '../state.js';
import { applyPreMarkdownRules, applyPostMarkdownRules } from '../regex-engine.js';
import { applyColorFormatting } from '../highlighter.js';
import CodeBlockEnhancer from '../code-block-enhancer.js';
import { jsonToMarkdownTable } from '../utils.js';
import { regexPatterns } from '../regex.js';
import { markdownWorkerClient } from './markdown-worker-client.js';

// --- Internal Helpers ---

function escapeRegex(str) {
    return str.replace(regexPatterns.escapeSpecialChars, '\\$&');
}

/**
 * @function isJsonArrayString
 * @description Checks if a string is a valid JSON array.
 * @param {string} str - The string to check.
 * @returns {boolean} - True if the string is a valid JSON array.
 */
function isJsonArrayString(str) {
    if (typeof str !== 'string' || str.trim() === '') {
        return false;
    }
    try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed);
    } catch (e) {
        return false;
    }
}

/**
 * @function enhanceJsonCodeBlocks
 * @description Finds all JSON code blocks in an HTML string and wraps them for table rendering.
 * @param {string} html - The input HTML string.
 * @returns {string} - The enhanced HTML string.
 */
export function enhanceJsonCodeBlocks(html) {
    let jsonBlockId = 0;
    const codeBlockRegex = /<pre><code class="language-json">([\s\S]*?)<\/code><\/pre>/g;

    return html.replace(codeBlockRegex, (match, jsonContent) => {
        const decodedJsonContent = new DOMParser().parseFromString(jsonContent, "text/html").documentElement.textContent;

        if (isJsonArrayString(decodedJsonContent)) {
            jsonBlockId++;
            // 乌鸦：修复 ID 不稳定导致流式更新时节点被替换的问题
            // 移除 Date.now()，确保每次渲染生成的 ID 一致（前提是 JSON 块顺序不变，这在流式输出中是成立的）
            const uniqueId = `json-block-${jsonBlockId}`;

            const autoRender = state.appSettings.autoRenderTable;
            const tableDisplay = autoRender ? 'block' : 'none';
            const codeDisplay = autoRender ? 'none' : 'block';
            const buttonText = autoRender ? '显示代码' : '渲染表格';
            const originalCodeBlock = match;

            return `
                <div class="json-table-container" data-block-id="${uniqueId}">
                    <div class="json-table-actions">
                        <button class="toggle-json-table-btn" data-target-id="${uniqueId}">${buttonText}</button>
                    </div>
                    <div class="table-view" style="display: ${tableDisplay};">
                        ${autoRender ? jsonToMarkdownTable(decodedJsonContent) : ''}
                    </div>
                    <div class="code-view" style="display: ${codeDisplay};">
                        ${originalCodeBlock}
                    </div>
                </div>
            `;
        }
        return match;
    });
}

// --- Core Pipeline (Async) ---

export async function formatMessagePipeline(text, role, messageIndex, totalVisibleMessages) {
    // 乌鸦：紧急修复 - 数据类型防御
    let content = text;
    if (typeof text === 'object' && text !== null) {
        if (text.content && typeof text.content === 'string') {
            content = text.content;
        } else {
            console.warn('formatMessagePipeline 收到非字符串输入，尝试强制转换:', text);
            content = JSON.stringify(text);
        }
    }
    
    content = content || '';

    try {
        // Step 1 & 2: Pre-markdown, Parsing, Highlighting, Code Enhancement (In Worker)
        let html = await markdownWorkerClient.render(content, role, messageIndex, totalVisibleMessages);

        // Step 2.5: Sanitization (Main Thread)
        // DOMPurify needs DOM context, so it must run here
        if (state.appSettings.disableXssProtection !== true) {
            if (window.DOMPurify) {
                html = window.DOMPurify.sanitize(html);
            } else {
                console.error('DOMPurify not loaded in main thread!');
                // Fallback basic escape
                // Note: Worker already produces HTML, so simple escaping might break tags.
                // But since we control the Worker output, and marked handles XSS to some extent...
                // Ideally DOMPurify should be loaded.
            }
        }

        // Step 3: Post-markdown processing (Main Thread)
        // 这些步骤依赖 DOM 或者轻量级，留在主线程
        html = applyPostMarkdownRules(html, role, messageIndex, totalVisibleMessages);
        html = applyColorFormatting(html);
        
        // 乌鸦：JSON 表格增强 (需要 DOMParser，留在主线程)
        html = enhanceJsonCodeBlocks(html);

        return html;
    } catch (err) {
        console.error('Markdown Worker failed, falling back to main thread:', err);
        return fallbackFormatPipeline(content, role, messageIndex, totalVisibleMessages);
    }
}

// Fallback synchronous pipeline (Original implementation)
function fallbackFormatPipeline(text, role, messageIndex, totalVisibleMessages) {
    let content = text || '';
    content = applyPreMarkdownRules(content, role, messageIndex, totalVisibleMessages);
    let html = '';
    
    if (window.marked) {
        html = window.marked.parse(content, {gfm: true, breaks: true});
    } else {
        html = '<p style="color:red">Error: Marked library not loaded.</p>' + content;
    }

    if (state.appSettings.disableXssProtection !== true) {
        if (window.DOMPurify) {
            html = window.DOMPurify.sanitize(html);
        } else {
            const tempDiv = document.createElement('div');
            tempDiv.textContent = content; 
            html = tempDiv.innerHTML.replace(/\n/g, '<br>'); 
        }
    }
    html = applyPostMarkdownRules(html, role, messageIndex, totalVisibleMessages);
    html = applyColorFormatting(html);
    html = CodeBlockEnhancer.enhanceAllCodeBlocks(html);
    // Also enhance JSON tables in fallback
    html = enhanceJsonCodeBlocks(html);
    return html;
}
