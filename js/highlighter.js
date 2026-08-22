/**
 * @file highlighter.js
 * @description Applies color and style formatting to rendered HTML using safe DOM traversal.
 * 乌鸦：这是最终修正版的高亮模块，负责所有内置的（非用户定义的）美化功能。
 */

import { regexPatterns } from './regex.js?v=260823';

/**
 * A robust function to apply a single type of regex-based formatting to all text nodes within a container.
 * It finds all matches for a given regex and wraps them in a styled <span>.
 * @param {HTMLElement} container - The element to process.
 * @param {object} formatter - An object containing the regex, className, and other options.
 */
function applySingleFormat(container, formatter) {
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                // 关键安全机制：拒绝处理任何已经格式化或不应被处理的标签内部的文本
                if (node.parentElement.closest('pre, code, style, script, span.quote, span.underline-text, span.italic-text')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const nodesToProcess = [];
    while (walker.nextNode()) {
        nodesToProcess.push(walker.currentNode);
    }

    nodesToProcess.forEach(node => {
        const text = node.textContent;
        const regex = formatter.regex;
        regex.lastIndex = 0;

        if (!regex.test(text)) {
            return;
        }
        regex.lastIndex = 0;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of text.matchAll(regex)) {
            // 对于引号，需要额外验证它不是一个“被忽略”的匹配项（比如HTML标签）
            if (formatter.isQuote) {
                const [, pHTML] = match;
                if (pHTML) {
                    continue;
                }
            }

            const start = match.index;
            const end = start + match[0].length;

            if (start > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, start)));
            }

            const span = document.createElement('span');
            span.className = formatter.className;
            span.textContent = formatter.contentGroup ? match[formatter.contentGroup] : match[0];
            fragment.appendChild(span);

            lastIndex = end;
        }

        if (lastIndex === 0) {
            return;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        node.replaceWith(fragment);
    });
}

/**
 * 通过遍历 HTML 字符串的 DOM 将颜色和样式格式应用于 HTML 字符串。
 * @param {string} html - The input HTML string.
 * @returns {string} The processed HTML string.
 */
export function applyColorFormatting(html) {
    if (!html) return '';

    try {
        const container = document.createElement('div');
        container.innerHTML = html;

        // 定义需要依次执行的格式化器
        const formatters = [
            { regex: regexPatterns.smartQuotes, className: 'quote', isQuote: true },
            { regex: regexPatterns.italicText, className: 'italic-text', contentGroup: 1 }
        ];

        for (const fmt of formatters) {
            applySingleFormat(container, fmt);
        }

        return container.innerHTML;
    } catch (error) {
        console.error('[Highlighter] Failed to apply color formatting:', error);
        return html;
    }
}
