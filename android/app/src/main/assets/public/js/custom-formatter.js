/**
 * @file custom-formatter.js
 * @description 在Markdown渲染前，对原生文本进行预处理
 */

import { regexPatterns } from './regex.js';

/**
 * 对原生文本应用自定义格式，包裹特殊标签
 * @param {string} text - 原始文本
 * @returns {string} - 经过预处理的文本
 */
export function applyCustomFormatting(text) {
  let formattedText = text;
  if (!formattedText) return '';

  // 步骤 1: 统一处理代码块、引号和HTML标签
  // 这是一个关键步骤，用一个复杂的正则表达式和回调函数，一次性完成三件事：
  // 1. 为代码块末尾添加换行符，解决合并问题。
  // 2. 为各种引号包裹的文本添加高亮标签。
  // 3. 跳过已有的HTML标签，防止破坏结构。
  formattedText = formattedText.replace(
    regexPatterns.smartQuotes,
    (match, pHTML, pCodeBlock1, pCodeBlock2, pQuote1, pQuote2, pQuote3, pQuote4, pQuote5, pQuote6) => {
      // 如果匹配到的是代码块 (```...``` 或 `...`)
      if (pCodeBlock1 || pCodeBlock2) {
        // 原样返回代码块，并在末尾追加一个换行符
        return `${match}\n`;
      }
      // 如果匹配到的是HTML标签，直接返回，不做任何处理
      if (pHTML) {
        return match;
      }
      // 如果匹配到的是任何一种引号
      if (pQuote1 || pQuote2 || pQuote3 || pQuote4 || pQuote5 || pQuote6) {
        return `<span class="quote">${match}</span>`;
      }
      // 理论上不应该执行到这里，但作为保险返回原匹配
      return match;
    }
  );

  // 步骤 2. 处理下划线文本
  // 这一步在处理完代码块和引号后执行，避免冲突
  formattedText = formattedText.replace(
    regexPatterns.underlineText,
    '<span class="underline-text">$1</span>'
  );

  // 步骤 3. 处理斜体文本
  // 同上，最后处理，避免冲突
  formattedText = formattedText.replace(
    regexPatterns.italicText,
    '<span class="italic-text">$1</span>'
  );

  return formattedText;
}