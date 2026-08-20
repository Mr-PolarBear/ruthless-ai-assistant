/**
 * @file reasoning-renderer.js
 * @description Handles rendering of reasoning/thinking content blocks.
 */

import { scrollToBottom } from '../ui-updater.js';
// 乌鸦：导入滚动管理器，避免跳转后被强制拉到底部
import { scrollManager } from '../scroll-manager.js';

/**
 * 来源标注文案映射
 */
const SOURCE_LABELS = {
    field: '来自 reasoning 字段',
    inline: '来自正文标签'
};

/**
 * 乌鸦：创建或更新消息气泡中的思考内容区域（支持多段独立显示）
 * @param {HTMLElement} messageBubble - 消息气泡元素（或目标父容器）
 * @param {Array<{content: string, source: string, order: number}>} reasoningParts - 思考内容段落数组
 * @param {boolean} isStreaming - 是否正在流式输出
 * @param {boolean} isThinkingComplete - 思考内容是否已完成（标签已闭合）
 * @param {HTMLElement} [targetParent=null] - 乌鸦：新增可选参数，指定插入的目标父容器。如果不传，默认根据 messageBubble 的结构自动查找。
 */
export function updateReasoningContainer(messageBubble, reasoningParts, isStreaming = false, isThinkingComplete = true, targetParent = null) {
    // 乌鸦：【核心修复】放宽检查条件。只要 messageBubble 或 targetParent 存在其一即可。
    if ((!messageBubble && !targetParent) || !reasoningParts || reasoningParts.length === 0) return;

    // 乌鸦：确定查找容器的上下文。如果指定了 targetParent，就在它里面找；否则在 messageBubble 里找
    const context = targetParent || messageBubble;
    let container = context.querySelector('.reasoning-container');
    let isNewContainer = false;
    const wasAtBottom = isStreaming ? scrollManager.isNearBottom(10) : false;

    // 如果容器不存在，创建它
    if (!container) {
        isNewContainer = true;
        container = document.createElement('div');
        // 乌鸦：新建容器时，流式输出展开，否则收起
        container.className = isStreaming ? 'reasoning-container expanded' : 'reasoning-container';
        container.innerHTML = `
            <div class="reasoning-header">
                <div class="reasoning-header-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 3l14 9-14 9V3z"></path>
                    </svg>
                </div>
                <span class="reasoning-header-title">思考过程</span>
                <span class="reasoning-header-badge">点击展开/收起</span>
            </div>
            <div class="reasoning-body"></div>
            <button class="reasoning-collapse-btn">▲ 收起思考内容</button>
        `;

        // 乌鸦：绑定 header 点击事件
        const header = container.querySelector('.reasoning-header');
        header.addEventListener('click', () => {
            // 用户手动操作，移除自动收起类
            container.classList.remove('auto-collapsed');
            container.classList.toggle('expanded');
            container.dataset.userToggled = 'true';
        });

        // 乌鸦：【修复】绑定收起按钮事件（固定元素，不随内容更新重建）
        const collapseBtn = container.querySelector('.reasoning-collapse-btn');
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            container.classList.remove('expanded');
            container.dataset.userToggled = 'true';
        });

        // 插入逻辑
        if (targetParent) {
            // 乌鸦：如果指定了目标父容器（例如分析结果框），直接插到最前面
            // 或者插到 header 后面？分析框有 header 吗？有。
            const analysisHeader = targetParent.querySelector('.analysis-header');
            if (analysisHeader) {
                analysisHeader.insertAdjacentElement('afterend', container);
            } else {
                targetParent.insertBefore(container, targetParent.firstChild);
            }
        } else {
            // 默认插入逻辑（主消息气泡）
            // 插入到 .message-header 之后、.message-content 之前
            const messageHeader = messageBubble.querySelector('.message-header');
            const messageContent = messageBubble.querySelector('.message-content');
            if (messageHeader && messageContent) {
                messageHeader.insertAdjacentElement('afterend', container);
            } else if (messageContent) {
                messageContent.insertAdjacentElement('beforebegin', container);
            } else {
                // 降级：插入到气泡开头
                messageBubble.insertBefore(container, messageBubble.firstChild);
            }
        }

    }

    // 更新流式状态
    container.classList.toggle('streaming', isStreaming);

    // 乌鸦：【核心修复】展开/收起状态管理
    // 使用 CSS 类控制，比内联样式更可靠
    const userToggled = container.dataset.userToggled === 'true';

    if (!userToggled) {
        if (isThinkingComplete) {
            // 思考完成，添加强制收起类
            container.classList.add('auto-collapsed');
            container.classList.remove('expanded');
        } else {
            // 思考进行中，移除强制收起类，确保展开
            container.classList.remove('auto-collapsed');
            if (!isNewContainer) {
                container.classList.add('expanded');
            }
        }
    }

    // 更新段落数量标注
    const badge = container.querySelector('.reasoning-header-badge');
    if (badge) {
        const count = reasoningParts.length;
        if (isStreaming && !isThinkingComplete) {
            badge.textContent = '思考中...';
        } else {
            badge.textContent = count > 1 ? `共 ${count} 段思考` : '点击展开/收起';
        }
    }

    // 乌鸦：思考结束后，添加复制按钮
    if (isThinkingComplete) {
        let copyBtn = container.querySelector('.reasoning-copy-btn');
        if (!copyBtn) {
            const header = container.querySelector('.reasoning-header');
            const badge = container.querySelector('.reasoning-header-badge');

            if (header && badge) {
                copyBtn = document.createElement('button');
                copyBtn.className = 'reasoning-copy-btn';
                copyBtn.title = '复制思考内容';
                copyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                `;

                // 插入到标题后面，徽章前面
                header.insertBefore(copyBtn, badge);

                // 绑定点击事件
                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation(); // 防止触发折叠/展开

                    const textToCopy = reasoningParts.map(p => p.content).join('\n\n');

                    const showSuccess = () => {
                        const originalHtml = copyBtn.innerHTML;
                        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        copyBtn.style.color = 'var(--accent-green, #4caf50)';
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHtml;
                            copyBtn.style.color = '';
                        }, 2000);
                    };

                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(textToCopy);
                            showSuccess();
                        } else {
                            // Fallback for non-secure contexts (http)
                            const textArea = document.createElement("textarea");
                            textArea.value = textToCopy;

                            // Make it invisible but part of the DOM
                            textArea.style.position = "fixed";
                            textArea.style.left = "-9999px";
                            textArea.style.top = "0";
                            document.body.appendChild(textArea);

                            textArea.focus();
                            textArea.select();

                            const successful = document.execCommand('copy');
                            document.body.removeChild(textArea);

                            if (successful) {
                                showSuccess();
                            } else {
                                console.error('Fallback copy failed.');
                            }
                        }
                    } catch (err) {
                        console.error('复制思考内容失败:', err);
                    }
                });
            }
        }
    }

    // 更新内容主体
    const bodyEl = container.querySelector('.reasoning-body');
    if (bodyEl) {
        // 清空旧内容
        bodyEl.innerHTML = '';

        // 渲染每个思考段落
        reasoningParts.forEach((part, index) => {
            const partEl = document.createElement('div');
            partEl.className = 'reasoning-part';
            partEl.dataset.index = index + 1;  // 序号从1开始

            // 思考内容（保留换行，转义HTML特殊字符）
            const contentText = part.content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');

            // 来源标注
            const sourceLabel = SOURCE_LABELS[part.source] || '未知来源';

            partEl.innerHTML = `
                <div class="reasoning-part-content">${contentText}</div>
                <span class="reasoning-part-source">${sourceLabel}</span>
            `;

            bodyEl.appendChild(partEl);
        });
    }

    // 乌鸦：流式输出时统一由 smartScrollToBottom 内部决策，不再外部双重门控
    if (isStreaming) {
        scrollManager.smartScrollToBottom(wasAtBottom);
    }
}

/**
 * 乌鸦：流式渲染时的快速更新函数（仅更新最后一段，避免重绘全部）
 * @param {HTMLElement} messageBubble - 消息气泡元素
 * @param {string} latestContent - 最新的思考内容
 * @param {number} partIndex - 段落索引（从0开始）
 */
export function updateReasoningPartContent(messageBubble, latestContent, partIndex) {
    const container = messageBubble?.querySelector('.reasoning-container');
    if (!container) return;

    const parts = container.querySelectorAll('.reasoning-part');
    const targetPart = parts[partIndex];
    if (!targetPart) return;

    const contentEl = targetPart.querySelector('.reasoning-part-content');
    if (contentEl) {
        contentEl.innerHTML = latestContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }
}
