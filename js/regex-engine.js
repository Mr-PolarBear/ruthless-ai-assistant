/**
 * @file regex-engine.js
 * @description A dual-stage engine for applying regex rules.
 * 乌鸦：这是最终的、借鉴了SillyTavern经验的双引擎正则处理器。
 */

import { state, DEFAULT_REGEX_RULES } from './state.js?v=260823';
import { regexPatterns } from './regex.js?v=260823';

// --- 内部辅助函数 ---

/**
 * 获取当前会话生效的所有启用的正则规则（系统默认 + 全局启用 + 当前会话专属启用）
 * @param {string} [currentConvId] - 会话ID（默认读取 state.currentConversationId）
 * @returns {Array<object>} 生效规则数组
 */
export function getActiveRegexRules(currentConvId = state.currentConversationId) {
    if (!state.regexRules || typeof state.regexRules !== 'object') return [];
    return Object.values(state.regexRules).filter(rule => {
        if (!rule || !rule.enabled) return false;
        // 系统默认规则始终对所有会话生效
        if (DEFAULT_REGEX_RULES && Object.prototype.hasOwnProperty.call(DEFAULT_REGEX_RULES, rule.id)) {
            return true;
        }
        // 全局规则对所有会话生效
        if (rule.scope === 'global' || !rule.scope) {
            return true;
        }
        // 会话专属规则仅对绑定了当前会话 ID 的会话生效
        if (rule.scope === 'session') {
            return Boolean(currentConvId && Array.isArray(rule.sessionIds) && rule.sessionIds.map(String).includes(String(currentConvId)));
        }
        return false;
    });
}

/**
 * 乌鸦：新增的智能正则表达式解析器
 * @param {string} findString - 用户输入的正则表达式字符串
 * @returns {{pattern: string, flags: string | undefined}}
 * @description 支持两种格式：
 * 1. /pattern/flags (类似SillyTavern的字面量格式)
 * 2. pattern (纯字符串格式)
 */
export function parseRegex(findString) {
    // 匹配 /pattern/flags 格式
    const literalRegex = /^\/(.*)\/([gimy]*)$/;
    const match = findString.match(literalRegex);

    if (match) {
        // 成功匹配字面量格式，返回解析出的模式和标志
        return { pattern: match[1], flags: match[2] || '' };
    }

    // 未匹配，说明是纯字符串格式，直接返回
    return { pattern: findString, flags: undefined };
}


function createNodeFromHTML(htmlString) {
    const template = document.createElement('template');
    // 乌鸦：这里之前的 .trim() 会把节点两侧的空格删掉，导致渲染后单词贴在一起，必须去掉。
    template.innerHTML = htmlString;
    return template.content;
}

// --- STAGE 1: Pre-Markdown Execution ---

export function applyPreMarkdownRules(text, role, messageIndex, totalVisibleMessages) {
    try {
        // 乌鸦：直接使用原始文本，不处理 thinkTag
        let textAfterThinking = text;

        const scope = `display-${role}`;
        const activeRules = getActiveRegexRules(state.currentConversationId).filter(rule =>
            (rule.stage === 'pre-markdown') &&
            rule.scopes.includes(scope)
        );

        // 乌鸦：从内部规则中移除已被手动执行的 thinkTag
        const internalPreRules = [
            {
                name: 'underlineText',
                sort: 998, // 乌鸦：改为大数，确保在用户规则之后执行
                find: regexPatterns.underlineText.source,
                flags: regexPatterns.underlineText.flags,
                replace: '<span class="underline-text">$1</span>'
            }
        ];

        const allRules = [...activeRules, ...internalPreRules];
        allRules.sort((a, b) => (a.sort || 0) - (b.sort || 0));

        // 如果没有剩余规则，并且没有代码块，可以提前返回
        if (allRules.length === 0 && !textAfterThinking.includes('```')) {
            return textAfterThinking;
        }

        const codeBlocks = [];
        const placeholderPrefix = 'GEMINI-CODEBLOCK-ID';
        const placeholderSuffix = '-END';

        // 乌鸦：在经过 thinkTag 处理后的文本上执行代码块保护
        let protectedText = textAfterThinking.replace(regexPatterns.codeBlock, (match) => {
            const placeholder = `${placeholderPrefix}${codeBlocks.length}${placeholderSuffix}`;
            codeBlocks.push(match);
            return placeholder;
        });

        let processedText = protectedText;
        for (const rule of allRules) {
            // 乌鸦：楼层限制检查
            if (typeof messageIndex === 'number' && typeof totalVisibleMessages === 'number') {
                const indexFromEnd = totalVisibleMessages - 1 - messageIndex;
                const minFloor = parseInt(rule.minFloor, 10) || 0;
                const maxFloor = parseInt(rule.maxFloor, 10) || 0;

                if (minFloor > 0) { // 数量限制：影响最新的 minFloor 条
                    if (indexFromEnd >= minFloor) continue; // 超出范围，跳过
                } else if (maxFloor > 0) { // 起始点限制：从倒数 maxFloor+1 条开始
                    if (indexFromEnd < maxFloor) continue; // 未达到范围，跳过
                }
            }

            try {
                // 乌鸦：使用新的智能解析器
                const { pattern, flags } = parseRegex(rule.find);
                const finalFlags = flags !== undefined ? flags : (rule.flags || 'g');
                const regex = new RegExp(pattern, finalFlags);
                processedText = processedText.replace(regex, rule.replace);
            } catch (e) {
                console.error(`[Regex Engine - Pre] Invalid regex for rule "${rule.name || 'internal'}": ${rule.find}`, e);
            }
        }

        let finalText = processedText;
        for (let i = 0; i < codeBlocks.length; i++) {
            const placeholder = `${placeholderPrefix}${i}${placeholderSuffix}`;
            finalText = finalText.replace(placeholder, () => codeBlocks[i]);
        }

        return finalText;

    } catch (error) {
        console.error('[Regex Engine - Pre] Failed to apply pre-markdown rules:', error);
        return text;
    }
}


// --- STAGE 2: Post-Markdown Execution ---

export function applyPostMarkdownRules(html, role, messageIndex, totalVisibleMessages) {
    try {
        const scope = `display-${role}`;
        const activeRules = getActiveRegexRules(state.currentConversationId).filter(rule =>
            (!rule.stage || rule.stage === 'post-markdown') &&
            rule.scopes.includes(scope)
        );

        if (activeRules.length === 0) {
            return html;
        }

        activeRules.sort((a, b) => (a.sort || 0) - (b.sort || 0));

        // 乌鸦：楼层限制所需变量，提前计算，避免在循环中重复计算
        const useFloorLogic = typeof messageIndex === 'number' && typeof totalVisibleMessages === 'number';
        const indexFromEnd = useFloorLogic ? totalVisibleMessages - 1 - messageIndex : -1;

        const container = document.createElement('div');
        container.innerHTML = html;

        function traverse(node) {
            if (['PRE', 'CODE', 'STYLE', 'SCRIPT'].includes(node.nodeName)) {
                return;
            }

            const children = Array.from(node.childNodes);
            for (const child of children) {
                traverse(child);
            }

            if (node.nodeType === Node.TEXT_NODE) {
                let textContent = node.textContent;
                let modified = false;

                for (const rule of activeRules) {
                    // 乌鸦：楼层限制检查
                    if (useFloorLogic) {
                        const minFloor = parseInt(rule.minFloor, 10) || 0;
                        const maxFloor = parseInt(rule.maxFloor, 10) || 0;

                        if (minFloor > 0) { // 数量限制：影响最新的 minFloor 条
                            if (indexFromEnd >= minFloor) continue; // 超出范围，跳过
                        } else if (maxFloor > 0) { // 起始点限制：从倒数 maxFloor+1 条开始
                            if (indexFromEnd < maxFloor) continue; // 未达到范围，跳过
                        }
                    }

                    try {
                        // 乌鸦：同样使用新的智能解析器
                        const { pattern, flags } = parseRegex(rule.find);
                        const finalFlags = flags !== undefined ? flags : (rule.flags || 'g');
                        const regex = new RegExp(pattern, finalFlags);
                        if (regex.test(textContent)) {
                            textContent = textContent.replace(regex, rule.replace);
                            modified = true;
                        }
                    } catch (e) {
                        console.error(`[Regex Engine - Post] Invalid regex for rule "${rule.name}": ${rule.find}`, e);
                    }
                }

                if (modified) {
                    const newFragment = createNodeFromHTML(textContent);
                    node.replaceWith(newFragment);
                }
            }
        }

        traverse(container);

        return container.innerHTML;
    } catch (error) {
        console.error('[Regex Engine - Post] Failed to apply post-markdown rules:', error);
        return html;
    }
}
