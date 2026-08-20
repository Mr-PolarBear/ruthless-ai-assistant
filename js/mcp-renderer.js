/**
 * @file mcp-renderer.js
 * @description MCP工具调用的UI渲染模块
 */

import { escapeHtml } from './utils.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { DEFAULT_TOOLS } from './mcp-tools-registry.js?v=260820-1';
import { processTemplate, preprocessApiData } from './mcp-template-engine.js?v=260820-1';
import { jsonToMarkdownTable } from './utils.js?v=260820-1';
import { scrollManager } from './scroll-manager.js?v=260820-1';

/**
 * 乌鸦：安全的DOM替换工具函数
 * @param {HTMLElement} oldElement - 要被替换的元素
 * @param {HTMLElement} newElement - 新元素
 * @param {string} operationName - 操作名称（用于日志）
 * @returns {boolean} 操作是否成功
 */
function safeReplaceElement(oldElement, newElement, operationName = 'DOM替换') {
    if (!oldElement || !oldElement.parentNode || !newElement) {
        console.warn(`乌鸦：${operationName} - 参数无效`);
        return false;
    }

    try {
        // 乌鸦：第一种方案：直接替换
        oldElement.parentNode.replaceChild(newElement, oldElement);
        //    console.log(`乌鸦：${operationName} - 直接替换成功`);
        return true;
    } catch (error) {
        console.warn(`乌鸦：${operationName} - 直接替换失败，尝试降级方案:`, error);

        try {
            // 乌鸦：第二种方案：先移除后添加
            const container = oldElement.parentNode;
            const nextSibling = oldElement.nextSibling;
            container.removeChild(oldElement);

            if (nextSibling) {
                container.insertBefore(newElement, nextSibling);
            } else {
                container.appendChild(newElement);
            }
            //    console.log(`乌鸦：${operationName} - 降级方案成功`);
            return true;
        } catch (fallbackError) {
            console.error(`乌鸦：${operationName} - 降级方案也失败:`, fallbackError);

            try {
                // 乌鸦：第三种方案：仅更新内容
                oldElement.innerHTML = newElement.innerHTML;
                // 复制类名和属性
                if (newElement.className) {
                    oldElement.className = newElement.className;
                }
                Array.from(newElement.attributes).forEach(attr => {
                    if (attr.name !== 'class') {
                        oldElement.setAttribute(attr.name, attr.value);
                    }
                });
                //    console.log(`乌鸦：${operationName} - 保底方案成功（仅更新内容）`);
                return true;
            } catch (finalError) {
                console.error(`乌鸦：${operationName} - 所有方案都失败:`, finalError);
                return false;
            }
        }
    }
}

/**
 * 乌鸦：转义正则特殊字符
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 乌鸦：处理模板中的动态JavaScript表达式
 * @param {string} html - HTML模板
 * @returns {string} 处理后的HTML
 */
function processDynamicExpressions(html) {
    // 乌鸦：安全的动态表达式列表（只允许安全的操作）
    const allowedExpressions = {
        'new Date().toLocaleString()': () => new Date().toLocaleString(),
        'new Date().toLocaleDateString()': () => new Date().toLocaleDateString(),
        'new Date().toLocaleTimeString()': () => new Date().toLocaleTimeString(),
        'Date.now()': () => Date.now(),
        'Math.random()': () => Math.random().toFixed(6)
    };

    let processedHtml = html;

    // 乌鸦：处理允许的表达式
    Object.entries(allowedExpressions).forEach(([expression, handler]) => {
        const regex = new RegExp(`\\{\\{\\s*${escapeRegex(expression)}\\s*\\}\\}`, 'g');
        try {
            const result = handler();
            processedHtml = processedHtml.replace(regex, escapeHtml(String(result)));
        } catch (error) {
            console.warn(`动态表达式执行失败: ${expression}`, error);
            processedHtml = processedHtml.replace(regex, '[Expression Error]');
        }
    });

    return processedHtml;
}

/**
 * 乌鸦：渲染工具调用结果到消息气泡中
 * @param {HTMLElement} messageElement - 消息元素
 * @param {Object} toolCallResult - 工具调用结果
 * @param {number} callIndex - 调用索引
 * @param {boolean} isInitiallyExpanded - 是否初始展开
 * @param {number} round - 调用轮次（可选，多轮调用时用于渲染轮次分隔条）
 */
export function renderToolCallResult(messageElement, toolCallResult, callIndex = 0, isInitiallyExpanded = false, round = 0) {
    // 乌鸦：生成唯一标识符，防止重复渲染
    const messageId = messageElement.dataset.index || 'unknown';
    const toolName = toolCallResult.tool || 'unknown';
    const uniqueId = `${messageId}_${callIndex}_${toolName}`;

    // 乌鸦：检查是否已存在相同的工具调用块（方案1）
    const existingBlock = messageElement.querySelector(`[data-tool-unique-id="${uniqueId}"]`);
    if (existingBlock) {
        //    console.log(`乌鸦：工具调用块 ${uniqueId} 已存在，检查是否需要更新内容`);

        // 乌鸦：如果是重试操作，需要更新内容而不是跳过
        const isRetryOperation = toolCallResult._isRetry || false;
        if (isRetryOperation || toolCallResult.success === false) {
            //    console.log(`乌鸦：重试操作或失败结果，更新现有块内容 ${uniqueId}`);
            // 乌鸦：更新现有块的内容
            const newToolBlock = createToolCallBlock(toolCallResult, callIndex, isInitiallyExpanded);
            newToolBlock.setAttribute('data-tool-unique-id', uniqueId);

            try {
                existingBlock.parentNode.replaceChild(newToolBlock, existingBlock);
                //    console.log(`乌鸦：成功更新现有工具调用块 ${uniqueId}`);

                // 乌鸦：重新初始化交互功能，修复折叠功能失效问题
                setTimeout(() => {
                    initializeMCPResultInteraction(newToolBlock);
                }, 10);

                return newToolBlock;
            } catch (error) {
                console.error(`乌鸦：更新现有工具调用块失败 ${uniqueId}:`, error);
                // 乌鸦：保底方案
                existingBlock.innerHTML = newToolBlock.innerHTML;
                existingBlock.className = newToolBlock.className;

                // 乌鸦：保底方案下也要重新初始化交互功能
                setTimeout(() => {
                    initializeMCPResultInteraction(existingBlock);
                }, 10);

                return existingBlock;
            }
        } else {
            //    console.log(`乌鸦：非重试操作，跳过重复渲染 ${uniqueId}`);
            return existingBlock;
        }
    }

    // 乌鸦：查找或创建工具调用容器（改进版 - 方案4）
    let toolContainer = messageElement.querySelector('.tool-calls-container');
    if (!toolContainer) {
        toolContainer = document.createElement('div');
        toolContainer.className = 'tool-calls-container';
        toolContainer.setAttribute('data-container-for-message', messageId);

        // 乌鸦：安全的插入到消息内容之后
        const contentElement = messageElement.querySelector('.message-content');
        if (contentElement && contentElement.parentNode) {
            try {
                contentElement.parentNode.insertBefore(toolContainer, contentElement.nextSibling);
                console.log('乌鸦：工具容器插入成功');
            } catch (error) {
                console.error('乌鸦：工具容器插入失败，使用保底方案:', error);
                // 乌鸦：保底方案 - 直接追加到消息元素
                messageElement.appendChild(toolContainer);
                console.log('乌鸦：工具容器保底插入成功');
            }
        } else {
            messageElement.appendChild(toolContainer);
        }

        // 乌鸦：同步消息折叠状态——如果消息已折叠，新创建的容器也应该隐藏
        const contentEl = messageElement.querySelector('.message-content');
        if (contentEl && contentEl.classList.contains('collapsible')) {
            toolContainer.style.display = 'none';
        }
    }

    // 乌鸦：检查容器中是否已存在相同索引的工具调用块（额外保护）
    const existingBlockByIndex = toolContainer.querySelector(`[data-call-index="${callIndex}"]`);
    if (existingBlockByIndex && existingBlockByIndex !== existingBlock) {
        //    console.log(`乌鸦：发现重复索引的工具调用块 ${callIndex}，移除旧块`);
        existingBlockByIndex.remove();
    }

    // 乌鸦：安全的创建和添加工具调用块
    let toolBlock = null;
    try {
        toolBlock = createToolCallBlock(toolCallResult, callIndex, isInitiallyExpanded);

        // 乌鸦：设置唯一标识符（关键修复）
        toolBlock.setAttribute('data-tool-unique-id', uniqueId);

        // 乌鸦：多轮调用时插入轮次分隔条
        if (round > 1) {
            const roundId = `round-indicator-${round}`;
            if (!toolContainer.querySelector(`[data-round-id="${roundId}"]`)) {
                const roundIndicator = document.createElement('div');
                roundIndicator.className = 'mcp-round-indicator';
                roundIndicator.setAttribute('data-round-id', roundId);
                roundIndicator.innerHTML = `<span><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>第${round}轮工具调用</span>`;
                toolContainer.appendChild(roundIndicator);
            }
        }

        toolContainer.appendChild(toolBlock);
        //    console.log(`乌鸦：工具调用块 ${callIndex} 添加成功，唯一ID: ${uniqueId}`);

        // 乌鸦：检查并渲染 Mermaid 图表
        const mermaidContainers = toolBlock.querySelectorAll('.mermaid-result-wrapper');
        mermaidContainers.forEach(container => {
            renderMermaidInContainer(container);
        });

        // 乌鸦：检查并渲染 ECharts 图表
        const echartsContainers = toolBlock.querySelectorAll('.echarts-result-wrapper');
        echartsContainers.forEach(container => {
            renderEChartsInContainer(container);
        });

    } catch (error) {
        console.error(`乌鸦：工具调用块 ${callIndex} 添加失败:`, error);
        // 乌鸦：创建一个简单的错误提示块
        const errorBlock = document.createElement('div');
        errorBlock.className = 'tool-call-block error';
        errorBlock.setAttribute('data-call-index', callIndex);
        errorBlock.setAttribute('data-tool-unique-id', uniqueId); // 乌鸦：错误块也需要唯一ID
        errorBlock.innerHTML = `
            <div class="tool-call-header error">
                <span class="tool-icon">❌</span>
                <span class="tool-name">渲染错误</span>
                <span class="tool-status error">DOM操作失败</span>
            </div>
        `;
        try {
            toolContainer.appendChild(errorBlock);
            toolBlock = errorBlock; // 乌鸦：使用错误块作为备选
            console.log('乌鸦：错误提示块添加成功');
        } catch (fallbackError) {
            console.error('乌鸦：连错误提示块都无法添加:', fallbackError);
            // 乌鸦：返回null，让后续代码能够安全处理
            return null;
        }
    }

    // 乌鸦：只有在toolBlock存在时才绑定事件
    if (toolBlock) {
        // 乌鸦：绑定重试按钮事件
        const retryBtn = toolBlock.querySelector('.retry-tool-call-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                const toolName = retryBtn.dataset.toolName;
                handleToolRetry(messageElement, toolName, callIndex);
            });
        }

        // 乌鸦：为MCP结果添加语法高亮和交互功能
        initializeMCPResultInteraction(toolBlock);
    }

    return toolBlock;
}

/**
 * 乌鸦：初始化MCP结果的交互功能（语法高亮、切换显示、复制）
 * @param {HTMLElement} toolBlock - 工具调用块元素
 */
function initializeMCPResultInteraction(toolBlock) {
    try {
        // 乌鸦：为所有JSON代码块添加语法高亮
        const codeBlocks = toolBlock.querySelectorAll('code.language-json');
        codeBlocks.forEach(codeBlock => {
            if (!codeBlock.dataset.highlighted) {
                try {
                    window.hljs.highlightElement(codeBlock);
                } catch (error) {
                    console.warn('乌鸦：MCP JSON语法高亮失败:', error);
                }
            }
        });

        // 乌鸦：绑定MCP JSON切换按钮事件
        const toggleBtns = toolBlock.querySelectorAll('.mcp-toggle-view-btn');
        toggleBtns.forEach((button) => {
            if (button.dataset.listenerAttached) return;
            button.dataset.listenerAttached = 'true';

            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetId = button.dataset.targetId;
                const container = toolBlock.querySelector(`[data-block-id="${targetId}"]`);
                if (!container) return;

                const tableView = container.querySelector('.table-view');
                const codeView = container.querySelector('.code-view');
                const isCurrentlyShowingTable = tableView && tableView.style.display === 'block';

                if (!isCurrentlyShowingTable) {
                    if (!tableView.innerHTML.trim() || tableView.innerHTML.includes('<!--')) {
                        try {
                            const jsonString = codeView.querySelector('code.language-json').textContent;
                            const jsonData = JSON.parse(jsonString);
                            const arrayFields = findArrayFields(jsonData);

                            if (arrayFields.length === 1 && state.appSettings.autoRenderTable) {
                                const field = arrayFields[0];
                                tableView.innerHTML = renderArrayAsTable(field.data, field.label) || '<p>无法渲染数组。</p>';
                            } else if (arrayFields.length > 0) {
                                showArrayFieldSelector(arrayFields, jsonData, tableView, button);
                                return;
                            } else {
                                tableView.innerHTML = jsonToMarkdownTable(jsonString) || '<p>无法渲染JSON。</p>';
                            }
                        } catch (error) {
                            tableView.innerHTML = '<p>表格生成失败。</p>';
                        }
                    }
                    tableView.style.display = 'block';
                    if (codeView) codeView.style.display = 'none';
                    button.textContent = '显示JSON';
                } else {
                    if (tableView) tableView.style.display = 'none';
                    if (codeView) codeView.style.display = 'block';
                    button.textContent = '渲染表格';
                }
            });
        });

        // 乌鸦：绑定MCP JSON复制按钮事件
        const copyBtns = toolBlock.querySelectorAll('.mcp-copy-json-btn');
        copyBtns.forEach(button => {
            if (button.dataset.listenerAttached) return;
            button.dataset.listenerAttached = 'true';

            button.addEventListener('click', async () => {
                const jsonString = button.dataset.json;

                // 乌鸦：优先使用现代的剪贴板API，因为它更安全、更高效
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(jsonString);
                        const originalText = button.textContent;
                        button.textContent = '✓ 已复制';
                        setTimeout(() => { button.textContent = originalText; }, 2000);
                        return; // 复制成功，任务完成
                    } catch (error) {
                        console.warn('乌鸦：现代剪贴板API复制失败，自动尝试降级方案:', error);
                        // 如果现代API失败（例如，在http页面上被浏览器阻止），则会继续执行下面的降级代码
                    }
                }

                // 乌鸦：降级方案，使用传统的 document.execCommand('copy')，兼容性更好
                const textArea = document.createElement("textarea");
                textArea.value = jsonString;

                // 乌鸦：将输入框移出屏幕外，防止干扰用户视线
                textArea.style.position = "fixed";
                textArea.style.top = "-9999px";
                textArea.style.left = "-9999px";

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    // 乌鸦：执行复制命令
                    const successful = document.execCommand('copy');
                    if (successful) {
                        const originalText = button.textContent;
                        button.textContent = '✓ 已复制';
                        setTimeout(() => { button.textContent = originalText; }, 2000);
                    } else {
                        console.error('乌鸦：降级复制命令执行失败。');
                        alert('复制失败，您的浏览器可能不支持此操作。');
                    }
                } catch (err) {
                    console.error('乌鸦：降级复制方案执行时发生异常:', err);
                    alert('复制时发生错误，请手动复制。');
                } finally {
                    // 乌鸦：无论成功与否，都从DOM中移除临时输入框
                    document.body.removeChild(textArea);
                }
            });
        });

        // 乌鸦：绑定“显示请求内容”按钮事件
        const showRequestBtns = toolBlock.querySelectorAll('.show-request-content-btn');
        showRequestBtns.forEach(button => {
            if (button.dataset.listenerAttached) return;
            button.dataset.listenerAttached = 'true';
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const messageBubble = button.closest('.message-bubble');
                if (!messageBubble) return;
                const index = parseInt(messageBubble.dataset.index, 10);
                const conv = state.conversations[state.currentConversationId];
                if (!conv) return;
                const message = conv.branches[conv.activeBranchIndex][index];
                const rawContent = message.rawContentWithTools || '没有可显示的原始请求内容。';
                showRawContentModal('原始请求内容', rawContent);
            });
        });

        // 乌鸦：绑定MCP折叠事件到整个头部
        const collapseHeaders = toolBlock.querySelectorAll('.tool-call-header');
        collapseHeaders.forEach(header => {
            // 乌鸦：移除旧的监听器标记，确保重试后能重新绑定
            delete header.dataset.listenerAttached;

            header.dataset.listenerAttached = 'true';

            // 乌鸦：移除旧的事件监听器（如果存在）
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);

            newHeader.addEventListener('click', (e) => {
                const resultElement = newHeader.nextElementSibling;
                if (!resultElement || !resultElement.classList.contains('tool-call-result')) return;

                const button = newHeader.querySelector('.mcp-collapse-btn');
                if (!button) return;

                const isCollapsed = resultElement.style.display === 'none';

                if (isCollapsed) {
                    resultElement.style.display = 'block';
                    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                    button.title = '折叠结果';
                } else {
                    resultElement.style.display = 'none';
                    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
                    button.title = '展开结果';
                }
            });
        });

    } catch (error) {
        console.error('乌鸦：初始化MCP结果交互功能失败:', error);
    }
}

/**
 * 乌鸦：查找JSON数据中的所有数组字段（改进版）
 * @param {Object} data - JSON数据对象
 * @param {string} prefix - 路径前缀
 * @param {number} maxDepth - 最大递归深度，防止无限递归
 * @param {number} currentDepth - 当前递归深度
 * @returns {Array} 数组字段列表
 */
function findArrayFields(data, prefix = '', maxDepth = 5, currentDepth = 0) {
    const arrayFields = [];
    //    console.log(`乌鸦：查找数组字段 - 前缀: "${prefix}", 数据类型:`, typeof data, `深度: ${currentDepth}/${maxDepth}`, '数据预览:', JSON.stringify(data).substring(0, 200) + '...');

    // 乌鸦：防止无限递归
    if (currentDepth >= maxDepth) {
        //    console.log(`乌鸦：达到最大递归深度，停止查找`);
        return arrayFields;
    }

    // 乌鸦：检查当前数据是否为数组
    if (Array.isArray(data)) {
        // 乌鸦：只有非空数组才添加
        if (data.length > 0) {
            const fieldInfo = {
                path: prefix || 'root',
                label: prefix ? `${prefix} (共${data.length}项)` : `根数组 (共${data.length}项)`,
                data: data,
                type: getArrayElementType(data)
            };
            arrayFields.push(fieldInfo);
            //    console.log(`乌鸦：✅ 找到数组 - ${prefix || '根数组'} (共${data.length}项), 元素类型: ${fieldInfo.type}`);

            // 乌鸦：检查数组元素中是否还有嵌套的数组
            if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
                // 乌鸦：只检查第一个元素的结构，假设数组元素结构一致
                const nestedFields = findArrayFields(data[0], prefix ? `${prefix}[0]` : 'root[0]', maxDepth, currentDepth + 1);
                arrayFields.push(...nestedFields);
            }
        } else {
            //    console.log(`乌鸦：❗ 跳过空数组 - ${prefix || '根数组'}`);
        }
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        // 乌鸦：遍历对象的所有属性
        for (const [key, value] of Object.entries(data)) {
            // 乌鸦：跳过null和undefined值
            if (value === null || value === undefined) {
                continue;
            }

            const currentPath = prefix ? `${prefix}.${key}` : key;

            if (Array.isArray(value)) {
                // 乌鸦：只有非空数组才添加
                if (value.length > 0) {
                    arrayFields.push({
                        path: currentPath,
                        label: `${currentPath} (共${value.length}项)`,
                        data: value,
                        type: getArrayElementType(value)
                    });
                    //    console.log(`乌鸦：找到数组 - ${currentPath} (共${value.length}项)`);

                    // 乌鸦：检查数组元素中是否还有嵌套的数组
                    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                        arrayFields.push(...findArrayFields(value[0], `${currentPath}[0]`, maxDepth, currentDepth + 1));
                    }
                }
            } else if (typeof value === 'object') {
                // 乌鸦：递归查找嵌套对象中的数组
                arrayFields.push(...findArrayFields(value, currentPath, maxDepth, currentDepth + 1));
            }
        }
    }

    //    console.log(`乌鸦：当前层级返回数组字段:`, arrayFields.map(f => f.label));
    return arrayFields;
}

/**
 * 乌鸦：获取数组元素类型
 * @param {Array} array - 数组
 * @returns {string} 类型描述
 */
function getArrayElementType(array) {
    if (!Array.isArray(array) || array.length === 0) {
        return 'empty';
    }

    const firstElement = array[0];
    const elementType = typeof firstElement;

    if (elementType === 'object' && firstElement !== null) {
        if (Array.isArray(firstElement)) {
            return 'array'; // 数组嵌套数组
        } else {
            return 'object'; // 对象数组
        }
    } else {
        return elementType; // 基本类型
    }
}

/**
 * 乌鸦：显示数组字段选择菜单
 * @param {Array} arrayFields - 数组字段列表
 * @param {Object} jsonData - 原始JSON数据
 * @param {HTMLElement} tableView - 表格显示容器
 * @param {HTMLElement} button - 触发按钮
 */
function showArrayFieldSelector(arrayFields, jsonData, tableView, button) {
    // 乌鸦：检查是否已存在选择菜单，如果存在则移除
    const existingMenu = document.querySelector('.array-field-selector');
    if (existingMenu) {
        existingMenu.remove();
    }

    // 乌鸦：创建选择菜单
    const menu = document.createElement('div');
    menu.className = 'array-field-selector';
    menu.style.cssText = `
        position: absolute;
        background: var(--bg-deep);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        padding: 8px;
        z-index: 1000;
        min-width: 200px;
        max-height: 300px;
        overflow-y: auto;
    `;

    // 乌鸦：添加标题
    const title = document.createElement('div');
    title.textContent = '选择要显示的数组字段：';
    title.style.cssText = `
        font-weight: 600;
        margin-bottom: 8px;
        padding: 4px 8px;
        color: var(--text-primary);
        font-size: 0.9em;
    `;
    menu.appendChild(title);

    // 乌鸦：为每个数组字段创建选项
    arrayFields.forEach(field => {
        const option = document.createElement('div');
        option.textContent = field.label;
        option.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            transition: background-color 0.2s;
            font-size: 0.85em;
        `;

        option.addEventListener('mouseover', () => {
            option.style.backgroundColor = 'var(--bg-hover)';
        });

        option.addEventListener('mouseout', () => {
            option.style.backgroundColor = 'transparent';
        });

        option.addEventListener('click', () => {
            // 乌鸦：渲染选中的数组为表格，直接使用field.data而不是通过路径获取
            console.log('乌鸦：用户选择了数组字段:', field.label, '数据:', field.data);
            const tableHtml = renderArrayAsTable(field.data, field.label);
            tableView.innerHTML = tableHtml || '<p style="color: var(--text-error);">无法渲染数组数据。</p>';

            // 乌鸦：关闭菜单
            menu.remove();

            // 乌鸦：显示表格视图
            tableView.style.display = 'block';
            const codeView = tableView.parentElement.querySelector('.code-view');
            if (codeView) codeView.style.display = 'none';
            button.textContent = '显示JSON';
        });

        menu.appendChild(option);
    });

    // 乌鸦：定位菜单
    document.body.appendChild(menu);
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let top = buttonRect.bottom + window.scrollY + 4;
    let left = buttonRect.left + window.scrollX;

    // 乌鸦：检查是否超出屏幕边界
    if (left + menuRect.width > window.innerWidth - 10) {
        left = buttonRect.right + window.scrollX - menuRect.width;
    }

    if (top + menuRect.height > window.innerHeight + window.scrollY - 10) {
        top = buttonRect.top + window.scrollY - menuRect.height - 4;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // 乌鸦：点击菜单外部时关闭
    const clickOutsideHandler = (event) => {
        if (!menu.contains(event.target) && event.target !== button) {
            menu.remove();
            document.removeEventListener('click', clickOutsideHandler, true);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', clickOutsideHandler, true);
    }, 100);
}

/**
 * 乌鸦：将数组数据渲染为表格
 * @param {Array} arrayData - 数组数据
 * @param {string} title - 表格标题
 * @returns {string} HTML表格字符串
 */
function renderArrayAsTable(arrayData, title) {
    if (!Array.isArray(arrayData) || arrayData.length === 0) {
        return '<p style="color: var(--text-secondary);">数组为空或无数据。</p>';
    }

    // 乌鸦：根据大哥的要求，添加16px间隔
    let tableHtml = `<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 12px 0; color: var(--text-primary);">${title}</h4>`;

    // 乌鸦：检查第一个元素的类型
    const firstItem = arrayData[0];

    if (typeof firstItem === 'object' && firstItem !== null) {
        // 乌鸦：对象数组，渲染为表格
        const headers = Object.keys(firstItem);
        tableHtml += '<table class="table table-bordered table-striped" style="width: 100%; border-collapse: collapse;">';

        // 乌鸦：表头
        tableHtml += '<thead><tr>';
        headers.forEach(header => {
            tableHtml += `<th style="padding: 8px; background: var(--bg-light); border: 1px solid var(--border-color); font-weight: 600;">${escapeHtml(String(header))}</th>`;
        });
        tableHtml += '</tr></thead>';

        // 乌鸦：表体
        tableHtml += '<tbody>';
        arrayData.forEach(row => {
            tableHtml += '<tr>';
            headers.forEach(header => {
                const value = row[header];
                let cellContent = '';

                if (value === null || value === undefined) {
                    cellContent = '<span style="color: var(--text-secondary); font-style: italic;">null</span>';
                } else if (typeof value === 'object') {
                    cellContent = `<code style="font-size: 0.85em; color: var(--text-secondary);">${escapeHtml(JSON.stringify(value))}</code>`;
                } else {
                    cellContent = escapeHtml(String(value));
                }

                tableHtml += `<td style="padding: 8px; border: 1px solid var(--border-color);">${cellContent}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
    } else {
        // 乌鸦：基本类型数组，渲染为列表
        tableHtml += '<table class="table table-bordered table-striped" style="width: 100%; border-collapse: collapse;">';
        tableHtml += '<thead><tr><th style="padding: 8px; background: var(--bg-light); border: 1px solid var(--border-color); font-weight: 600;">索引</th><th style="padding: 8px; background: var(--bg-light); border: 1px solid var(--border-color); font-weight: 600;">值</th></tr></thead>';
        tableHtml += '<tbody>';

        arrayData.forEach((item, index) => {
            tableHtml += '<tr>';
            tableHtml += `<td style="padding: 8px; border: 1px solid var(--border-color); text-align: center; font-weight: 500;">${index}</td>`;
            tableHtml += `<td style="padding: 8px; border: 1px solid var(--border-color);">${escapeHtml(String(item))}</td>`;
            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';
    }

    tableHtml += '</div>';
    return tableHtml;
}

/**
 * 乌鸦：显示原始数据模态框
 * @param {string} toolName - 工具名称
 * @param {Object} rawData - 原始数据
 */
function showRawDataModal(toolName, rawData) {
    // 乌鸦：创建模态框
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // 乌鸦：创建模态框内容
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.cssText = `
        background: var(--bg-medium);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        max-width: 90vw;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    `;

    // 乌鸦：创建模态框头部
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    modalHeader.style.cssText = `
        padding: 16px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

    const title = document.createElement('h3');
    title.textContent = `🔧 ${toolName} - 原始数据`;
    title.style.margin = '0';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-primary);
    `;

    modalHeader.appendChild(title);
    modalHeader.appendChild(closeBtn);

    // 乌鸦：创建模态框主体
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modalBody.style.cssText = `
        padding: 16px;
        overflow: auto;
        flex-grow: 1;
    `;

    // 乌鸦：创建代码展示区域
    const pre = document.createElement('pre');
    pre.style.cssText = `
        background: var(--bg-deep);
        padding: 16px;
        border-radius: 4px;
        overflow: auto;
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
    `;

    const code = document.createElement('code');
    code.textContent = JSON.stringify(rawData, null, 2);
    code.style.cssText = `
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 14px;
        line-height: 1.4;
    `;

    pre.appendChild(code);
    modalBody.appendChild(pre);

    // 乌鸦：组装模态框
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);

    // 乌鸦：添加关闭事件
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });

    // 乌鸦：显示模态框
    document.body.appendChild(modal);
}

/**
 * 乌鸦：处理工具重试
 * @param {HTMLElement} messageElement - 消息元素
 * @param {string} toolName - 工具名称
 * @param {number} callIndex - 调用索引
 */
function handleToolRetry(messageElement, toolName, callIndex) {
    try {
        // 乌鸦：获取原始调用参数
        const allTools = {
            ...DEFAULT_TOOLS,
            ...(state.mcpCustomTools || {})
        };

        const tool = Object.values(allTools).find(t =>
            t.name === toolName || t.id === toolName
        );

        if (!tool) {
            alert('找不到工具配置，请手动重新调用。');
            return;
        }

        if (!tool.lastCallParams) {
            alert('无法获取原始调用参数，请手动重新调用。');
            return;
        }

        //    console.log(`乌鸦：重试工具 ${toolName}，参数:`, tool.lastCallParams);

        // 乌鸦：更新状态为加载中
        const toolBlock = messageElement.querySelector(`[data-call-index="${callIndex}"]`);
        if (toolBlock) {
            updateToolCallStatus(toolBlock, 'calling', '重试中...');

            // 乌鸦：移除重试按钮
            const retryBtn = toolBlock.querySelector('.retry-tool-call-btn');
            if (retryBtn) {
                retryBtn.remove();
            }
        }

        // 乌鸦：重新执行工具调用
        import('./mcp-core.js?v=260820-1').then(async (mcpCore) => {
            try {
                //    console.log(`乌鸦：开始重试工具 ${toolName}，参数:`, tool.lastCallParams);
                const result = await mcpCore.mcpExecutor.callTool(
                    tool.id,
                    tool.lastCallParams,
                    { retry: true }
                );

                //    console.log(`乌鸦：重试工具 ${toolName} 完成，结果:`, result);

                // 乌鸦：检查结果状态
                if (result.success) {
                    //    console.log(`乌鸦：重试成功，工具 ${toolName} 调用成功`);
                } else {
                    //    console.log(`乌鸦：重试失败，工具 ${toolName} 调用失败，错误: ${result.error}`);
                }

                // 乌鸦：添加重试标记，确保更新现有块而不是跳过
                result._isRetry = true;

                // 乌鸦：更新结果显示，确保自动展开
                const newToolBlock = renderToolCallResult(messageElement, result, callIndex, true);
                if (toolBlock && toolBlock.parentNode) {
                    try {
                        // 乌鸦：安全的DOM替换，避免卡死
                        toolBlock.parentNode.replaceChild(newToolBlock, toolBlock);
                        //    console.log(`乌鸦：重试成功替换工具调用块 ${callIndex}`);
                    } catch (error) {
                        console.error(`乌鸦：重试DOM替换失败，使用保底方案:`, error);
                        // 乌鸦：保底方案 - 直接更新内容，避免卡死
                        toolBlock.innerHTML = newToolBlock.innerHTML;
                        toolBlock.className = newToolBlock.className;
                        //    console.log(`乌鸦：重试保底方案成功`);
                    }
                } else {
                    console.error(`乌鸦：重试后找不到原始工具块或父节点`);
                }

            } catch (error) {
                console.error('重试失败:', error);
                if (toolBlock) {
                    // 乌鸦：重新添加重试按钮
                    const header = toolBlock.querySelector('.tool-call-header');
                    if (header && !header.querySelector('.retry-tool-call-btn')) {
                        const retryBtn = document.createElement('button');
                        retryBtn.className = 'retry-tool-call-btn';
                        retryBtn.textContent = '重试';
                        retryBtn.dataset.toolName = toolName;
                        retryBtn.onclick = () => {
                            handleToolRetry(messageElement, toolName, callIndex);
                        };
                        header.appendChild(retryBtn);
                    }

                    updateToolCallStatus(toolBlock, 'error', `重试失败: ${error.message}`);
                } else {
                    console.error(`乌鸦：重试失败后找不到工具块`);
                }
            }
        }).catch(error => {
            console.error('重试模块加载失败:', error);
            alert('重试功能加载失败，请刷新页面后重试。');
        });

    } catch (error) {
        console.error('重试处理出错:', error);
        alert('重试出错，请稍后再试。');
    }
}

/**
 * 创建工具调用块
 * @param {Object} result - 工具调用结果
 * @param {number} index - 索引
 * @returns {HTMLElement}
 */
function createToolCallBlock(result, index, isInitiallyExpanded = false) {
    const block = document.createElement('div');
    block.className = `tool-call-block ${result.success ? 'success' : 'error'}`;
    block.setAttribute('data-call-index', index);
    block.setAttribute('data-raw-data', JSON.stringify(result.data || {}));

    const toolName = escapeHtml(result.tool || '未知工具');
    const timestamp = new Date(result.timestamp).toLocaleTimeString();

    if (result.success) {
        block.innerHTML = createSuccessContent(toolName, result.data, timestamp, isInitiallyExpanded);
    } else {
        // 乌鸦：大哥要求 - 错误时也要显示JSON数据
        block.innerHTML = createErrorContent(toolName, result.error, timestamp, result.data, isInitiallyExpanded);
    }

    return block;
}

/**
 * 乌鸦：创建成功结果内容
 */
function createSuccessContent(toolName, data, timestamp, isInitiallyExpanded = false) {
    const displayStyle = isInitiallyExpanded ? 'block' : 'none';
    const buttonIcon = isInitiallyExpanded ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    const buttonTitle = isInitiallyExpanded ? '折叠结果' : '展开结果';

    let content = `
        <div class="tool-call-header success">
            <span class="tool-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></span>
            <span class="tool-icon-text">MCP调用结果，来自: ${toolName}</span>
            <span class="tool-name">${toolName}</span>
            <span class="tool-status success">调用成功</span>
            <span class="tool-time">${timestamp}</span>
            <button class="mcp-collapse-btn" title="${buttonTitle}">
                ${buttonIcon}
            </button>
        </div>
        <div class="tool-call-result" style="display: ${displayStyle};">
    `;

    // 乌鸦：检查是否有自定义模板
    // 获取工具配置以获取参数信息
    const allTools = {
        ...(window.DEFAULT_TOOLS || {}),
        ...(state.mcpCustomTools || {})
    };

    const tool = Object.values(allTools).find(t =>
        t.name === toolName || t.id === toolName
    );

    const customContent = null; // 乌鸦：暂时禁用自定义模板，防止卡死
    // const customContent = tool ? renderWithCustomTemplate(toolName, data, tool.lastCallParams || {}) : null;
    if (customContent) {
        content += customContent;
    } else {
        // 乌鸦：根据不同工具类型渲染结果
        if (toolName.includes('天气')) {
            content += renderWeatherResult(data);
        } else if (toolName.includes('汇率')) {
            content += renderExchangeRateResult(data);
        } else if (toolName.includes('IP位置')) {
            content += renderIPLocationResult(data);
        } else if (data.type === 'mermaid_visualization') { // 乌鸦：Mermaid 可视化
            content += renderMermaidResult(data);
        } else if (data.type === 'echarts_visualization') { // 乌鸦：ECharts 可视化
            content += renderEChartsResult(data);
        } else {
            content += renderGenericResult(data);
        }
    }

    content += '</div>';

    return content;
}

/**
 * 乌鸦：渲染 Mermaid 可视化结果
 */
function renderMermaidResult(data) {
    const code = data.code || '';
    // 生成唯一的 ID 以便后续查找和渲染
    const id = `mermaid-container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return `
        <div class="mermaid-result-wrapper" id="${id}" data-mermaid-code="${escapeHtml(code)}">
            <div class="loading-spinner">正在渲染图表...</div>
            <pre class="mermaid-source" style="display:none;"><code class="language-mermaid">${escapeHtml(code)}</code></pre>
        </div>
    `;
}

/**
 * 创建错误结果内容
 */
function createErrorContent(toolName, error, timestamp, errorData = null, isInitiallyExpanded = false) {
    const displayStyle = isInitiallyExpanded ? 'block' : 'none';
    const buttonIcon = isInitiallyExpanded ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    const buttonTitle = isInitiallyExpanded ? '折叠结果' : '展开结果';

    // 乌鸦：大哥要求 - 当接口调用失败时，要把JSON展示出来
    let errorJsonDisplay = '';
    if (errorData && typeof errorData === 'object') {
        const jsonString = JSON.stringify(errorData, null, 2);
        const blockId = `error-json-block-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        errorJsonDisplay = `
            <div class="mcp-json-container" data-block-id="${blockId}" style="margin-top: 12px;">
                <div class="mcp-json-actions">
                    <div>
                        <button class="mcp-toggle-view-btn" data-target-id="${blockId}">
                            美化显示
                        </button>
                        <button class="show-request-content-btn" title="显示原始请求">显示请求</button>
                    </div>
                    <button class="mcp-copy-json-btn" data-json="${escapeHtml(jsonString)}" title="复制JSON">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>复制
                    </button>
                </div>
                
                <div class="table-view" style="display: none;">
                    <!-- 表格内容将在点击时动态生成 -->
                </div>
                
                <div class="code-view" style="display: block;">
                    <pre><code class="language-json">${escapeHtml(jsonString)}</code></pre>
                </div>
            </div>
        `;
    }

    return `
        <div class="tool-call-header error">
            <span class="tool-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></span>
            <span class="tool-icon-text">MCP调用结果，来自: ${toolName}</span>
            <span class="tool-name">${toolName}</span>
            <span class="tool-status error">调用失败</span>
            <span class="tool-time">${timestamp}</span>
            <button class="mcp-collapse-btn" title="${buttonTitle}">
                ${buttonIcon}
            </button>
        </div>
        <div class="tool-call-result error" style="display: ${displayStyle};">
            <div class="error-message">
                <strong>错误信息：</strong>${escapeHtml(error)}
            </div>
            ${errorJsonDisplay}
            <div class="tool-call-actions">
                <button class="retry-tool-call-btn" data-tool-name="${escapeHtml(toolName)}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>重试
                </button>
            </div>
        </div>
    `;
}

/**
 * 渲染天气查询结果
 */
function renderWeatherResult(data) {
    const temp = data.temperature || '--';
    const feelsLike = data.feelsLike || '--';
    const humidity = data.humidity || '--';
    const windSpeed = data.windSpeed || '--';
    const city = escapeHtml(data.city || '未知城市');
    const country = data.country ? ` (${data.country})` : '';
    const description = escapeHtml(data.weather?.description || '');

    return `
        <div class="weather-result">
            <div class="weather-header">
                <h4><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>${city}${country}</h4>
                <div class="weather-main">
                    <span class="temperature">${temp}°C</span>
                    <span class="description">${description}</span>
                </div>
            </div>
            <div class="weather-details">
                <div class="weather-item">
                    <span class="label">体感温度:</span>
                    <span class="value">${feelsLike}°C</span>
                </div>
                <div class="weather-item">
                    <span class="label">湿度:</span>
                    <span class="value">${humidity}%</span>
                </div>
                <div class="weather-item">
                    <span class="label">风速:</span>
                    <span class="value">${windSpeed} m/s</span>
                </div>
                ${data.visibility ? `
                <div class="weather-item">
                    <span class="label">能见度:</span>
                    <span class="value">${data.visibility} km</span>
                </div>
                ` : ''}
                ${data.sunrise ? `
                <div class="weather-item">
                    <span class="label">日出:</span>
                    <span class="value">${data.sunrise}</span>
                </div>
                ` : ''}
                ${data.sunset ? `
                <div class="weather-item">
                    <span class="label">日落:</span>
                    <span class="value">${data.sunset}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * 渲染汇率查询结果
 */
function renderExchangeRateResult(data) {
    const base = data.base || 'USD';
    const date = data.date || '';

    let ratesHtml = '';
    if (data.rates) {
        const topRates = Object.entries(data.rates)
            .slice(0, 10) // 只显示前10个
            .map(([currency, rate]) =>
                `<div class="rate-item">
                    <span class="currency">${currency}</span>
                    <span class="rate">${rate.toFixed(4)}</span>
                </div>`
            ).join('');
        ratesHtml = topRates;
    }

    return `
        <div class="exchange-rate-result">
            <div class="rate-header">
                <h4><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>汇率信息</h4>
                <div class="rate-meta">
                    <span>基准货币: ${base}</span>
                    ${date ? `<span>日期: ${date}</span>` : ''}
                </div>
            </div>
            <div class="rates-list">
                ${ratesHtml}
            </div>
        </div>
    `;
}

/**
 * 渲染IP位置查询结果
 */
function renderIPLocationResult(data) {
    const ip = escapeHtml(data.ip || '--');
    const country = escapeHtml(data.country || '--');
    const city = escapeHtml(data.city || '--');
    const region = escapeHtml(data.regionName || '--');
    const isp = escapeHtml(data.isp || '--');

    return `
        <div class="ip-location-result">
            <div class="location-header">
                <h4><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>IP位置信息</h4>
                <div class="ip-address">${ip}</div>
            </div>
            <div class="location-details">
                <div class="location-item">
                    <span class="label">国家:</span>
                    <span class="value">${country} (${data.countryCode || '--'})</span>
                </div>
                <div class="location-item">
                    <span class="label">地区:</span>
                    <span class="value">${region}</span>
                </div>
                <div class="location-item">
                    <span class="label">城市:</span>
                    <span class="value">${city}</span>
                </div>
                ${data.lat && data.lon ? `
                <div class="location-item">
                    <span class="label">坐标:</span>
                    <span class="value">${data.lat}, ${data.lon}</span>
                </div>
                ` : ''}
                <div class="location-item">
                    <span class="label">运营商:</span>
                    <span class="value">${isp}</span>
                </div>
                ${data.timezone ? `
                <div class="location-item">
                    <span class="label">时区:</span>
                    <span class="value">${data.timezone}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * 渲染通用结果
 */
function renderGenericResult(data) {
    // 乌鸦：为普通JSON数据创建可切换的展示界面，默认展示表格，类似错误情况下的展示方式
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blockId = `generic-json-block-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 尝试解析数据并生成表格
    let initialTableView = '';
    let initialDisplayStyle = 'none'; // 默认隐藏表格
    let initialCodeViewStyle = 'block'; // 默认显示代码
    let buttonText = '渲染表格'; // 默认按钮文字

    try {
        const parsedData = JSON.parse(jsonString);
        // 尝试生成表格
        const arrayFields = findArrayFields(parsedData);

        if (arrayFields.length === 1 && state.appSettings.autoRenderTable) {
            // 如果只有一个数组且开启了自动渲染表格，则默认显示表格
            const field = arrayFields[0];
            initialTableView = renderArrayAsTable(field.data, field.label) || '<p>无法渲染数组。</p>';
            initialDisplayStyle = 'block';
            initialCodeViewStyle = 'none';
            buttonText = '显示JSON';
        } else if (arrayFields.length > 0) {
            // 如果有多个数组，显示数组选择器
            initialTableView = '<p>检测到多个数组，请选择要显示的数组。</p>';
            buttonText = '选择数组';
        } else {
            // 如果没有数组，使用jsonToMarkdownTable尝试转换
            const tableResult = jsonToMarkdownTable(jsonString);
            if (tableResult) {
                initialTableView = tableResult;
                initialDisplayStyle = 'block';
                initialCodeViewStyle = 'none';
                buttonText = '显示JSON';
            }
        }
    } catch (error) {
        console.warn('解析JSON数据失败:', error);
    }

    return `
        <div class="mcp-json-container" data-block-id="${blockId}">
            <div class="mcp-json-actions">
                <div>
                    <button class="mcp-toggle-view-btn" data-target-id="${blockId}">
                        ${buttonText}
                    </button>
                </div>
                <button class="mcp-copy-json-btn" data-json="${escapeHtml(jsonString)}" title="复制JSON">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>复制
                </button>
            </div>
            
            <div class="table-view" style="display: ${initialDisplayStyle};">
                ${initialTableView}
            </div>
            
            <div class="code-view" style="display: ${initialCodeViewStyle};">
                <pre><code class="language-json">${escapeHtml(jsonString)}</code></pre>
            </div>
        </div>
    `;
}

/**
 * 乌鸦：在指定的容器中渲染 Mermaid
 */
async function renderMermaidInContainer(container) {
    if (!window.mermaid) {
        container.innerHTML = '<div class="error-message">Mermaid 库未加载，无法渲染图表。</div>';
        return;
    }

    const code = container.dataset.mermaidCode;
    if (!code) return;

    try {
        // 乌鸦：初始化配置
        window.mermaid.initialize({
            startOnLoad: false,
            theme: state.theme === 'dark' ? 'dark' : 'default',
            securityLevel: 'loose',
        });

        const id = 'mermaid-svg-' + Math.random().toString(36).substr(2, 9);

        // 创建临时渲染容器
        // 乌鸦：修复 Mermaid 无法在 display: none 元素中渲染的 bug
        // 改为移出屏幕外，但保持布局计算能力
        const renderDiv = document.createElement('div');
        renderDiv.style.position = 'absolute';
        renderDiv.style.left = '-99999px';
        renderDiv.style.top = '-99999px';
        renderDiv.style.width = '100px'; // 稍微给点宽度避免极其特殊的边界情况
        document.body.appendChild(renderDiv);

        const { svg } = await window.mermaid.render(id, code, renderDiv);

        container.innerHTML = `
            <div class="mermaid-chart-container">
                ${svg}
            </div>
            <div class="mermaid-actions">
                <button class="download-svg-btn" title="下载SVG图片"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>下载SVG</button>
                <button class="open-svg-btn" title="新窗口打开"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>全屏</button>
                <button class="mcp-toggle-view-btn" style="width: auto;">显示源码</button>
            </div>
            <div class="code-view" style="display: none; margin-top: 10px; padding: 12px; border-top: 1px solid var(--border-color);">
                <pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>
            </div>
        `;

        // 绑定事件
        const downloadBtn = container.querySelector('.download-svg-btn');
        const openBtn = container.querySelector('.open-svg-btn');
        const toggleBtn = container.querySelector('.mcp-toggle-view-btn');
        const codeView = container.querySelector('.code-view');

        // 下载功能
        downloadBtn.onclick = () => {
            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chart-${Date.now()}.svg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        // 新窗口打开功能
        openBtn.onclick = () => {
            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            // 注意：Blob URL 在新窗口打开后，如果不释放可能会内存泄漏，
            // 但这里为了保证新窗口能加载，暂时不立即 revoke，或者依赖浏览器的垃圾回收。
            // 更好的做法是新窗口 document.write，但 Blob URL 更方便查看（像图片一样）。
        };

        // 源码切换
        toggleBtn.onclick = () => {
            if (codeView.style.display === 'none') {
                codeView.style.display = 'block';
                toggleBtn.textContent = '隐藏源码';
            } else {
                codeView.style.display = 'none';
                toggleBtn.textContent = '显示源码';
            }
        };

        document.body.removeChild(renderDiv);

    } catch (error) {
        console.error('Mermaid 渲染失败:', error);
        container.innerHTML = `
            <div class="error-message">图表渲染失败: ${escapeHtml(error.message)}</div>
            <pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>
        `;
    }
}

/**
 * 乌鸦：使用自定义模板渲染
 * @param {string} toolName - 工具名称
 * @param {Object} data - 数据
 * @param {Object} parameters - 工具调用参数
 * @returns {string|null} 渲染结果或null
 */
function renderWithCustomTemplate(toolName, data, parameters = {}) {
    try {
        // 乌鸦：获取所有工具配置
        const allTools = {
            ...DEFAULT_TOOLS,
            ...(state.mcpCustomTools || {})
        };

        // 乌鸦：查找匹配的工具
        const tool = Object.values(allTools).find(t =>
            t.name === toolName || t.id === toolName
        );

        if (!tool || !tool.customTemplate || !tool.customTemplate.enabled) {
            return null;
        }

        const template = tool.customTemplate;
        if (!template.htmlTemplate) {
            return null;
        }

        // 乌鸦：添加超时保护，防止模板引擎卡死
        console.log('乌鸦：开始处理自定义模板:', toolName);

        let timeoutId;
        let isCompleted = false;

        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                if (!isCompleted) {
                    console.error('乌鸦：模板处理超时，强制终止');
                    reject(new Error('模板处理超时'));
                }
            }, 5000); // 5秒超时
        });

        const processPromise = new Promise((resolve) => {
            try {
                // 乌鸦：预处理数据，使用新的模板引擎
                const processedData = preprocessApiData(data, tool, parameters);

                // 乌鸦：使用新的模板引擎渲染
                let renderedHtml = processTemplate(template.htmlTemplate, processedData);

                isCompleted = true;
                clearTimeout(timeoutId);
                console.log('乌鸦：模板处理成功');
                resolve(renderedHtml);
            } catch (error) {
                isCompleted = true;
                clearTimeout(timeoutId);
                console.error('乌鸦：模板处理失败:', error);
                resolve(null);
            }
        });

        // 乌鸦：竞赛执行，超时或完成都会返回
        return Promise.race([processPromise, timeoutPromise]).catch((error) => {
            console.error('乌鸦：模板处理异常:', error);
            return null;
        });

    } catch (error) {
        console.warn('自定义模板渲染失败:', error);
        return null;
    }
}

/**
 * 乌鸦：更新工具调用状态（用于实时更新）
 * @param {HTMLElement} toolBlock - 工具调用块
 * @param {string} status - 状态
 * @param {string} message - 状态消息
 */
export function updateToolCallStatus(toolBlock, status, message = '') {
    const statusElement = toolBlock.querySelector('.tool-status');
    const headerElement = toolBlock.querySelector('.tool-call-header');

    if (statusElement) {
        statusElement.className = `tool-status ${status}`;
        statusElement.textContent = message || getStatusText(status);
    }

    if (headerElement) {
        headerElement.className = `tool-call-header ${status}`;
    }
}

/**
 * 获取状态文本
 */
function getStatusText(status) {
    const statusTexts = {
        'calling': '调用中...',
        'waiting': '等待确认',
        'success': '调用成功',
        'error': '调用失败',
        'cancelled': '已取消'
    };

    return statusTexts[status] || status;
}

/**
 * 乌鸦：显示工具调用的加载状态
 * @param {HTMLElement} messageElement - 消息元素
 * @param {string} toolName - 工具名称
 * @param {number} callIndex - 调用索引
 * @returns {HTMLElement} 工具调用块
 */
export function showToolCallLoading(messageElement, toolName, callIndex = 0) {
    const result = {
        tool: toolName,
        success: false,
        timestamp: Date.now()
    };

    const toolBlock = renderToolCallResult(messageElement, result, callIndex);

    // 乌鸦：检查toolBlock是否成功创建
    if (!toolBlock) {
        console.error('乌鸦：无法创建工具调用加载块');
        return null;
    }

    // 乌鸦：设置加载状态
    const header = toolBlock.querySelector('.tool-call-header');
    if (header) {
        header.className = 'tool-call-header calling';
        header.innerHTML = `
            <span class="tool-icon">🔧</span>
            <span class="tool-icon-text">MCP调用结果，来自: ${escapeHtml(toolName)}</span>
            <span class="tool-name">${escapeHtml(toolName)}</span>
            <span class="tool-status calling">调用中...</span>
            <span class="tool-time">${new Date().toLocaleTimeString()}</span>
        `;
    }

    // 乌鸦：移除结果区域
    const resultElement = toolBlock.querySelector('.tool-call-result');
    if (resultElement) {
        resultElement.remove();
    }

    return toolBlock;
}

/**
 * 乌鸦：新增的函数，用于显示包含原始请求内容的模态框
 * @param {string} title - 模态框标题
 * @param {string} content - 要显示的文本内容
 */
function showRawContentModal(title, content) {
    // 移除已存在的同类模态框
    const existingModal = document.getElementById('raw-content-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'raw-content-modal';
    modal.className = 'modal';
    modal.style.cssText = `
        display: flex;
        position: fixed;
        z-index: 10001; /* 比其他模态框更高一级 */
        left: 0; top: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.6);
        align-items: center;
        justify-content: center;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: var(--bg-medium);
        border-radius: 8px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        width: 60vw;
        max-width: 800px;
        height: 70vh;
        display: flex;
        flex-direction: column;
    `;

    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = `
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    modalHeader.innerHTML = `<h3 style="margin:0; font-size: 16px;">${escapeHtml(title)}</h3><button class="close-btn" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button>`;

    const modalBody = document.createElement('div');
    modalBody.style.cssText = `padding: 16px; flex-grow: 1; overflow: hidden;`;

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.value = content;
    textarea.style.cssText = `
        width: 100%;
        height: 100%;
        resize: none;
        border: 1px solid var(--border-color);
        background: var(--bg-deep);
        color: var(--text-primary);
        font-family: monospace;
        font-size: 14px;
        padding: 8px;
    `;

    modalBody.appendChild(textarea);
    modalContent.append(modalHeader, modalBody);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('.close-btn').onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };
}

/**
 * 乌鸦：生成 ECharts 结果的 HTML 容器结构
 */
function renderEChartsResult(data) {
    const option = data.option || {};
    const title = data.title || '数据图表';
    const id = `echarts-container-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 乌鸦：序列化配置以便存入 dataset
    const optionStr = JSON.stringify(option);

    return `
        <div class="echarts-result-wrapper" id="${id}" data-echarts-option="${escapeHtml(optionStr)}">
            <div class="chart-header" style="padding: 10px; border-bottom: 1px solid var(--border-color); font-weight: bold;">
                ${escapeHtml(title)}
            </div>
            <div class="echarts-chart-container" style="width: 100%; height: 400px;">
                <div class="loading-spinner">正在加载图表...</div>
            </div>
            <div class="mermaid-actions">
                <button class="download-chart-btn" title="下载图片"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>下载</button>
                <button class="mcp-toggle-view-btn" style="width: auto;">显示配置</button>
            </div>
            <div class="code-view" style="display: none; margin-top: 10px; padding: 12px; border-top: 1px solid var(--border-color);">
                <pre><code class="language-json">${escapeHtml(JSON.stringify(option, null, 2))}</code></pre>
            </div>
        </div>
    `;
}

/**
 * 乌鸦：实例化 ECharts 图表（需在 DOM 插入后调用）
 * 该函数应在 renderToolCallResult 中被调用
 */
function renderEChartsInContainer(wrapper) {
    const chartDiv = wrapper.querySelector('.echarts-chart-container');
    const optionStr = wrapper.dataset.echartsOption;

    if (!window.echarts) {
        chartDiv.innerHTML = '<div class="error-message">ECharts 库未加载，无法渲染图表。</div>';
        return;
    }

    try {
        let option;
        // 乌鸦：双重 JSON 解析防御，防止 AI 返回双重序列化的字符串
        try {
            option = JSON.parse(optionStr);
        } catch (e) {
            throw new Error('配置解析失败');
        }

        if (typeof option === 'string') {
            try {
                const cleanStr = option.replace(/```json|```/g, '').trim();
                option = JSON.parse(cleanStr);
            } catch (e) {
                throw new Error('配置必须是有效的 JSON 对象');
            }
        }

        if (!option || typeof option !== 'object') {
            throw new Error('配置项无效');
        }

        // 乌鸦：初始化 ECharts，根据主题选择配色
        const chart = window.echarts.init(chartDiv, state.theme === 'dark' ? 'dark' : undefined);
        chart.setOption(option);

        // 乌鸦：响应式调整
        const resizeObserver = new ResizeObserver(() => {
            chart.resize();
        });
        resizeObserver.observe(wrapper);

        // 乌鸦：绑定按钮
        const downloadBtn = wrapper.querySelector('.download-chart-btn');
        const toggleBtn = wrapper.querySelector('.mcp-toggle-view-btn');
        const codeView = wrapper.querySelector('.code-view');

        downloadBtn.onclick = () => {
            const url = chart.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: state.theme === 'dark' ? '#1e1e1e' : '#fff'
            });
            const a = document.createElement('a');
            a.href = url;
            a.download = `echarts-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        toggleBtn.onclick = () => {
            const isHidden = codeView.style.display === 'none';
            codeView.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? '隐藏配置' : '显示配置';
        };

    } catch (error) {
        console.error('乌鸦：ECharts 渲染失败:', error);
        chartDiv.innerHTML = `<div class="error-message">图表渲染失败: ${escapeHtml(error.message)}</div>`;
    }
}

