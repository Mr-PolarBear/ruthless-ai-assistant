/**
 * @file regex-utils.js
 * @description Pure regex processing logic shared between Main Thread and Worker.
 */

import { regexPatterns } from '../regex.js?v=260820-1';

export function parseRegex(findString) {
    const literalRegex = /^\/(.*)\/([gimy]*)$/;
    const match = findString.match(literalRegex);

    if (match) {
        return { pattern: match[1], flags: match[2] || '' };
    }

    return { pattern: findString, flags: undefined };
}

export function applyPreMarkdownRules(text, role, messageIndex, totalVisibleMessages, regexRules) {
    try {
        let textAfterThinking = text;

        const scope = `display-${role}`;
        // 乌鸦：Worker 中无法直接访问 state，所以 activeRules 需要在外部过滤好传进来
        // 或者传入所有 rules，在这里过滤。为了通用性，我们假设传入的是对象或数组
        
        let activeRules = [];
        if (Array.isArray(regexRules)) {
            activeRules = regexRules; // 假设已经过滤好了
        } else if (regexRules && typeof regexRules === 'object') {
             activeRules = Object.values(regexRules).filter(rule =>
                rule.enabled &&
                (rule.stage === 'pre-markdown') &&
                rule.scopes.includes(scope)
            );
        }

        const internalPreRules = [
            {
                name: 'underlineText',
                sort: 998,
                find: regexPatterns.underlineText.source,
                flags: regexPatterns.underlineText.flags,
                replace: '<span class="underline-text">$1</span>'
            }
        ];

        const allRules = [...activeRules, ...internalPreRules];
        allRules.sort((a, b) => (a.sort || 0) - (b.sort || 0));

        if (allRules.length === 0 && !textAfterThinking.includes('```')) {
            return textAfterThinking;
        }

        const codeBlocks = [];
        const placeholderPrefix = 'GEMINI-CODEBLOCK-ID';
        const placeholderSuffix = '-END';

        let protectedText = textAfterThinking.replace(regexPatterns.codeBlock, (match) => {
            const placeholder = `${placeholderPrefix}${codeBlocks.length}${placeholderSuffix}`;
            codeBlocks.push(match);
            return placeholder;
        });

        let processedText = protectedText;
        for (const rule of allRules) {
            if (typeof messageIndex === 'number' && typeof totalVisibleMessages === 'number') {
                const indexFromEnd = totalVisibleMessages - 1 - messageIndex;
                const minFloor = parseInt(rule.minFloor, 10) || 0;
                const maxFloor = parseInt(rule.maxFloor, 10) || 0;

                if (minFloor > 0) {
                    if (indexFromEnd >= minFloor) continue;
                } else if (maxFloor > 0) {
                    if (indexFromEnd < maxFloor) continue;
                }
            }

            try {
                const { pattern, flags } = parseRegex(rule.find);
                const finalFlags = flags !== undefined ? flags : (rule.flags || 'g');
                const regex = new RegExp(pattern, finalFlags);
                processedText = processedText.replace(regex, rule.replace);
            } catch (e) {
                console.error(`[Regex Utils] Invalid regex for rule "${rule.name || 'internal'}": ${rule.find}`, e);
            }
        }

        let finalText = processedText;
        for (let i = 0; i < codeBlocks.length; i++) {
            const placeholder = `${placeholderPrefix}${i}${placeholderSuffix}`;
            finalText = finalText.replace(placeholder, () => codeBlocks[i]);
        }

        return finalText;

    } catch (error) {
        console.error('[Regex Utils] Failed to apply pre-markdown rules:', error);
        return text;
    }
}
