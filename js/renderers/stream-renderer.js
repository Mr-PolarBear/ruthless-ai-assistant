/**
 * @file stream-renderer.js
 * @description Handles smart DOM updates for streaming content, preserving code block states.
 */

// 乌鸦：导入侧边栏管理器
import { codePreviewManager } from '../code-preview-manager.js';

/**
 * 乌鸦：智能 DOM 更新函数，保留未变的代码块 DOM 节点
 * 以解决流式输出时代码块按钮点击事件失效的问题
 * @param {HTMLElement} container - 目标容器
 * @param {string} newHtml - 新的 HTML 内容
 * @param {boolean} isStreaming - 是否处于流式传输中 (默认为 false)
 */
export function updateDomPreservingCodeBlocks(container, newHtml, isStreaming = false) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;

    const newNodes = Array.from(tempDiv.childNodes);
    const oldNodes = Array.from(container.childNodes);

    // 遍历新节点列表，逐个与旧节点对比
    for (let i = 0; i < newNodes.length; i++) {
        const newNode = newNodes[i];
        const oldNode = oldNodes[i];

        // 1. 如果旧节点不存在（新内容比旧内容长），直接追加
        if (!oldNode) {
            container.appendChild(newNode);

            // 乌鸦：检查新追加的代码块是否需要遮罩
            if (newNode.nodeType === 1 && newNode.classList.contains('code-block-container')) {
                const pre = newNode.querySelector('pre');
                if (pre) {
                    requestAnimationFrame(() => {
                        if (pre.scrollHeight > pre.clientHeight) {
                            newNode.classList.add('truncated');
                        }
                    });
                }
                // 乌鸦：尝试自动展开新代码块
                const blockId = newNode.dataset?.blockId;
                if (blockId) {
                    codePreviewManager.tryAutoExpand(blockId, newNode, isStreaming);
                }
            }
            continue;
        }

        // 2. 检查是否为代码块且 ID 匹配
        const newId = newNode.nodeType === 1 ? newNode.dataset?.blockId : null;
        const oldId = oldNode.nodeType === 1 ? oldNode.dataset?.blockId : null;

        if (newId && oldId && newId === oldId) {
            // 乌鸦：检测结构类型是否发生变更
            // 例如从 .code-block-container 变成 .tool-call-request-bar（tool_call 申请条）
            // 此时必须整体替换，不能原地更新
            const oldIsCodeBlock = oldNode.classList.contains('code-block-container');
            const newIsRequestBar = newNode.classList.contains('tool-call-request-bar');
            if (oldIsCodeBlock && newIsRequestBar) {
                // 乌鸦：旧的 code-block-container 被替换后，MutationObserver 与 DOM 断开，
                // 侧边栏无法感知变化，会残留最后一次同步的不完整内容。
                // 必须在替换前检查侧边栏是否正在显示这个代码块，是则主动关闭
                if (codePreviewManager.isActive && codePreviewManager.currentBlockId === oldId) {
                    codePreviewManager.close();
                }
                container.replaceChild(newNode, oldNode);
                continue;
            }

            // 乌鸦：修复"解析中"永久残留问题
            // 当 old 和 new 都是 tool-call-request-bar 时，tool-call-request-bar 没有 <code> 标签
            // 原有的 querySelector('code') 路径对其无效，导致"解析中"在流式期间无法被更新
            // 修复：比较工具名是否变化，有变化则整体替换 header 部分（更新工具名显示）
            const oldIsRequestBar = oldNode.classList.contains('tool-call-request-bar');
            if (oldIsRequestBar && newIsRequestBar) {
                const oldTools = oldNode.querySelector('.tool-call-request-tools');
                const newTools = newNode.querySelector('.tool-call-request-tools');
                if (oldTools && newTools && oldTools.innerHTML !== newTools.innerHTML) {
                    // 乌鸦：只替换工具名区域，保留按钮绑定事件
                    oldTools.innerHTML = newTools.innerHTML;
                }

                // 乌鸦：同步更新隐藏 div 中的原始代码块内容
                // 否则用户点击"展开"时，读取到的永远是第一次转换时的不完整 JSON
                const oldHidden = oldNode.querySelector('div[style*="display:none"]');
                const newHidden = newNode.querySelector('div[style*="display:none"]');
                if (oldHidden && newHidden && oldHidden.innerHTML !== newHidden.innerHTML) {
                    oldHidden.innerHTML = newHidden.innerHTML;
                }

                continue;
            }

            // === 核心修复 ===
            // 身份匹配：这是同一个代码块。
            // 策略：原地更新内部数据，绝对不要触碰 oldNode 本身（不要 remove/replace/append）。
            // 这样 oldNode 就从未脱离过文档树，点击事件绝不会被打断。

            const newCode = newNode.querySelector('code');
            const oldCode = oldNode.querySelector('code');

            if (newCode && oldCode) {
                // 1. 同步内容
                let contentChanged = false;
                if (newCode.innerHTML !== oldCode.innerHTML) {
                    oldCode.innerHTML = newCode.innerHTML;
                    contentChanged = true;

                    // 注意：这里更新了 innerHTML，highlight.js 的高亮会丢失
                    // 但主渲染函数的后续逻辑会检测 data-highlighted 并重新高亮
                    if (oldCode.dataset.highlighted) {
                        delete oldCode.dataset.highlighted; // 标记需要重新高亮
                    }
                }

                // 2. 独立同步类名（修复高亮类名更新延迟导致一直显示txt的问题）
                if (newCode.className !== oldCode.className) {
                    oldCode.className = newCode.className;
                    // 如果类名变了，可能意味着从txt变成了具体的语言，也应该触发侧边栏检查
                    contentChanged = true;
                }

                // 乌鸦：核心修复 - 同步 Header 中的语言标签和按钮属性
                // 因为 stream-renderer 只保留了 oldNode 容器，丢弃了 newNode 的 Header
                // 所以必须手动把 newNode Header 里的新信息搬运过来
                const newLangTag = newNode.querySelector('.code-lang-tag');
                const oldLangTag = oldNode.querySelector('.code-lang-tag');
                if (newLangTag && oldLangTag && newLangTag.textContent !== oldLangTag.textContent) {
                    oldLangTag.textContent = newLangTag.textContent;
                }

                // 同步下载按钮的 data-language 属性
                const newDownloadBtn = newNode.querySelector('.download-code-btn');
                const oldDownloadBtn = oldNode.querySelector('.download-code-btn');
                if (newDownloadBtn && oldDownloadBtn && newDownloadBtn.dataset.language !== oldDownloadBtn.dataset.language) {
                    oldDownloadBtn.dataset.language = newDownloadBtn.dataset.language;
                }

                // 乌鸦：核心修复 - 同步 .code-block-actions 中的按钮列表
                // 场景：流式输出时代码块语言从 txt 变为 html，新 HTML 中包含预览按钮
                // 而旧节点中没有预览按钮。原来的逻辑只更新了语言标签和下载按钮属性，
                // 导致预览按钮永远不会出现——刷新页面后才能显示。
                // 策略：比较新旧按钮区域的按钮数量，如果不一致则整体替换按钮区域的 innerHTML
                const newActions = newNode.querySelector('.code-block-actions');
                const oldActions = oldNode.querySelector('.code-block-actions');
                if (newActions && oldActions) {
                    const newBtnCount = newActions.querySelectorAll('button').length;
                    const oldBtnCount = oldActions.querySelectorAll('button').length;
                    // 乌鸦：按钮数量不一致（比如 html 多了预览按钮），整体替换
                    // 同时也覆盖了 data-language 同步，因此上面的单独同步逻辑作为保底
                    if (newBtnCount !== oldBtnCount) {
                        oldActions.innerHTML = newActions.innerHTML;
                        contentChanged = true;
                    }
                }

                // 乌鸦：内容或样式更新时，尝试保持侧边栏同步或切换
                if (contentChanged) {
                    codePreviewManager.tryAutoExpand(oldId, oldNode, isStreaming);
                }
            }

            // 同步其他属性
            if (newNode.dataset.language !== oldNode.dataset.language) {
                oldNode.dataset.language = newNode.dataset.language;
            }

            // 乌鸦：动态检查高度，添加遮罩提示
            const pre = oldNode.querySelector('pre');
            if (pre) {
                // 使用 requestAnimationFrame 避免强制同步布局导致性能下降
                requestAnimationFrame(() => {
                    if (pre.scrollHeight > pre.clientHeight) {
                        oldNode.classList.add('truncated');
                    } else {
                        oldNode.classList.remove('truncated');
                    }
                });
            }

            // 跳过 replaceChild，保留 oldNode 在 DOM 中的位置
            continue;
        }

        // 3. 非代码块，或者 ID 不匹配
        // 检查是否完全相等（防止文本节点的无意义抖动）
        if (newNode.isEqualNode(oldNode)) {
            continue;
        }

        // 4. 确实不同，执行替换
        container.replaceChild(newNode, oldNode);

        // 乌鸦：对新插入的代码块也进行检查
        if (newNode.nodeType === 1 && newNode.classList.contains('code-block-container')) {
            const pre = newNode.querySelector('pre');
            if (pre) {
                requestAnimationFrame(() => {
                    if (pre.scrollHeight > pre.clientHeight) {
                        newNode.classList.add('truncated');
                    }
                });
            }
            // 乌鸦：尝试自动展开新替换的代码块
            const blockId = newNode.dataset?.blockId;
            if (blockId) {
                codePreviewManager.tryAutoExpand(blockId, newNode, isStreaming);
            }
        }
    }

    // 5. 清理多余的旧节点（新内容比旧内容短）
    while (container.childNodes.length > newNodes.length) {
        container.removeChild(container.lastChild);
    }
}
