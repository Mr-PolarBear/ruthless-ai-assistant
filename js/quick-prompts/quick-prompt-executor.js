/**
 * @file quick-prompt-executor.js
 * @description 专职负责快捷提示的插入位置计算、光标偏移计算与文本注入
 */

import { adjustTextareaHeight } from '../ui-updater.js?v=260820-1';

/**
 * 计算光标在插入内容中的相对偏移量
 * @param {string} text - 插入的文本内容
 * @param {string} cursorPosition - 'start' | 'middle' | 'end' | 'custom'
 * @param {number} customCursorOffset - 自定义偏移数字
 * @returns {number} 相对偏移量
 */
export function calculateCursorOffset(text = '', cursorPosition = 'end', customCursorOffset = 0) {
    const len = text.length;
    if (len === 0) return 0;

    switch (cursorPosition) {
        case 'start':
            return 0;
        case 'middle':
            // — 居中动态计算规则 —
            // 如果偶数则直接除以2；如果奇数则先减1再除以2（例如3个字居中在第1个字后）
            return len % 2 === 0 ? len / 2 : (len - 1) / 2;
        case 'custom': {
            const num = parseInt(customCursorOffset, 10);
            if (isNaN(num)) return len;
            return Math.min(Math.max(0, num), len);
        }
        case 'end':
        default:
            return len;
    }
}

/**
 * 执行快捷提示注入与光标定位
 * @param {object} prompt - 快捷提示对象
 * @param {HTMLTextAreaElement} textarea - 目标输入框元素
 */
export function executeQuickPrompt(prompt, textarea) {
    if (!prompt || !textarea) return;

    const fullVal = textarea.value;
    const selStart = textarea.selectionStart ?? fullVal.length;
    const selEnd = textarea.selectionEnd ?? fullVal.length;

    const insertMode = prompt.insertMode || 'cursor';
    const textToInsert = prompt.text ?? '';
    const cursorPosition = prompt.cursorPosition || 'end';
    const customCursorOffset = prompt.customCursorOffset || 0;

    let insertIndex = selStart;
    let deleteCount = selEnd - selStart;
    let finalInsertText = textToInsert;

    // — 计算插入位置 —
    if (insertMode === 'line_start') {
        // 当前行开头：从 selStart 往前寻找最后一个 \n
        const prevNewline = fullVal.lastIndexOf('\n', selStart - 1);
        insertIndex = prevNewline === -1 ? 0 : prevNewline + 1;
        deleteCount = 0; // 行首插入不覆盖选区
    } else if (insertMode === 'line_end') {
        // 当前行结尾：从 selEnd 往后寻找第一个 \n
        const nextNewline = fullVal.indexOf('\n', selEnd);
        insertIndex = nextNewline === -1 ? fullVal.length : nextNewline;
        deleteCount = 0; // 行尾插入不覆盖选区
    } else if (insertMode === 'new_line') {
        // 下一行：找到当前行尾，插入换行符 + 文本
        const nextNewline = fullVal.indexOf('\n', selEnd);
        const lineEnd = nextNewline === -1 ? fullVal.length : nextNewline;
        insertIndex = lineEnd;
        deleteCount = 0;
        finalInsertText = '\n' + textToInsert;
    } else {
        // 默认为 cursor 当前光标位置（如有选中内容则替换选中内容）
        insertIndex = selStart;
    }

    // 拼接替换后的文本
    const prefix = fullVal.substring(0, insertIndex);
    const suffix = fullVal.substring(insertIndex + deleteCount);
    textarea.value = prefix + finalInsertText + suffix;

    // — 计算插入后的绝对光标位置 —
    // 如果是 new_line 模式，因为多了一个前置换行符 '\n'，需要计入偏移
    const prefixOffset = insertMode === 'new_line' ? 1 : 0;
    const relativeOffset = calculateCursorOffset(textToInsert, cursorPosition, customCursorOffset);
    const targetCursorPos = insertIndex + prefixOffset + relativeOffset;

    // 聚焦输入框并设置光标
    textarea.focus();
    textarea.setSelectionRange(targetCursorPos, targetCursorPos);

    // 自动调整输入框高度
    adjustTextareaHeight();
}
