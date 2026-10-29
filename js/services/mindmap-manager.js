/**
 * @file mindmap-manager.js
 * @description 专职负责将 AI 消息文本一键转译为交互式思维导图 (Mindmap)，支持本地纯前端即时解析、展开/收起、横纵切换、导出高清图片与可选 AI 智能浓缩提炼。
 * 
 * — 为什么独立解耦 —
 * 1. 痛点：长篇技术方案与回答动辄上千字，用户阅读容易遗漏脉络；
 * 2. 纯前端零延迟：90% 的场景直接利用本地 Markdown AST 树状解析算法，0 毫秒即刻生成，0 Token 消耗，100% 内网离线可用；
 * 3. 复用现有 ECharts 引擎：直接使用项目已有的 libs/echarts.min.js 的 Tree 关系树，无需引入额外三方库；
 * 4. 具备增强能力：支持通过当前 API 一键浓缩长文为精炼脑图，兼具灵活性与深度。
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';

class MindmapManager {
    constructor() {
        this.modalEl = null;
        this.chartContainer = null;
        this.chartInstance = null;
        this.currentTreeData = null;
        this.currentOrientation = 'LR'; // 'LR' 横向 或 'TB' 纵向
        this.currentMessage = null;
        this.isAiSummarizing = false;
        this._isInitialized = false;
    }

    /**
     * 初始化思维导图弹窗 DOM
     */
    init() {
        if (this._isInitialized) return;
        this.createModalElement();
        this._isInitialized = true;
    }

    /**
     * 创建思维导图模态框 DOM 结构
     */
    createModalElement() {
        if (document.getElementById('mindmap-modal')) {
            this.modalEl = document.getElementById('mindmap-modal');
            this.chartContainer = document.getElementById('mindmap-chart-container');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'mindmap-modal';
        modal.className = 'modal-overlay mindmap-modal-overlay';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="modal-content mindmap-modal-content">
                <div class="modal-header mindmap-modal-header">
                    <div class="mindmap-header-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="6" y1="3" x2="6" y2="15"></line>
                            <circle cx="18" cy="6" r="3"></circle>
                            <circle cx="6" cy="18" r="3"></circle>
                            <path d="M18 9a9 9 0 0 1-9 9"></path>
                        </svg>
                        <span>交互式思维导图</span>
                    </div>
                    <div class="mindmap-header-tools">
                        <button type="button" id="mindmap-orient-btn" class="mindmap-tool-btn" title="切换横向/纵向布局">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                            <span id="mindmap-orient-text">横向布局</span>
                        </button>
                        <button type="button" id="mindmap-toggle-all-btn" class="mindmap-tool-btn" title="全部展开/折叠">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg>
                            <span>全部展开</span>
                        </button>
                        <button type="button" id="mindmap-ai-refine-btn" class="mindmap-tool-btn mindmap-ai-btn" title="使用 AI 提炼为更精简浓缩的要点树">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg>
                            <span>AI 智能提炼</span>
                        </button>
                        <button type="button" id="mindmap-export-png-btn" class="mindmap-tool-btn" title="导出为清晰 PNG 图片">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>导出图片</span>
                        </button>
                        <button type="button" class="modal-close-btn mindmap-close-btn" title="关闭">&times;</button>
                    </div>
                </div>
                <div class="modal-body mindmap-modal-body">
                    <div id="mindmap-chart-container" class="mindmap-chart-container"></div>
                    <div id="mindmap-loading" class="mindmap-loading" style="display:none;">
                        <span class="spinner-mini"></span>
                        <span id="mindmap-loading-text">正在智能提炼思维导图...</span>
                    </div>
                </div>
                <div class="mindmap-modal-footer">
                    <span class="mindmap-hint">💡 滚轮可缩放、鼠标按住可平移画布；点击节点圆圈可展开/收起分支。</span>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modalEl = modal;
        this.chartContainer = modal.querySelector('#mindmap-chart-container');

        this.bindModalEvents();
    }

    /**
     * 绑定弹窗内部按钮事件
     */
    bindModalEvents() {
        if (!this.modalEl) return;

        // 关闭弹窗
        const closeBtn = this.modalEl.querySelector('.mindmap-close-btn');
        if (closeBtn) closeBtn.onclick = () => this.close();

        this.modalEl.onclick = (e) => {
            if (e.target === this.modalEl) this.close();
        };

        // 切换布局方向
        const orientBtn = this.modalEl.querySelector('#mindmap-orient-btn');
        if (orientBtn) {
            orientBtn.onclick = () => {
                this.currentOrientation = this.currentOrientation === 'LR' ? 'TB' : 'LR';
                const textEl = this.modalEl.querySelector('#mindmap-orient-text');
                if (textEl) {
                    textEl.textContent = this.currentOrientation === 'LR' ? '横向布局' : '纵向布局';
                }
                this.renderChart();
            };
        }

        // 全部展开/收起
        let isExpandedAll = true;
        const toggleAllBtn = this.modalEl.querySelector('#mindmap-toggle-all-btn');
        if (toggleAllBtn) {
            toggleAllBtn.onclick = () => {
                isExpandedAll = !isExpandedAll;
                toggleAllBtn.querySelector('span').textContent = isExpandedAll ? '全部收起' : '全部展开';
                this.toggleCollapseRecursive(this.currentTreeData, !isExpandedAll);
                this.renderChart();
            };
        }

        // 导出图片
        const exportBtn = this.modalEl.querySelector('#mindmap-export-png-btn');
        if (exportBtn) {
            exportBtn.onclick = () => this.exportAsImage();
        }

        // AI 提炼
        const refineBtn = this.modalEl.querySelector('#mindmap-ai-refine-btn');
        if (refineBtn) {
            refineBtn.onclick = () => this.refineWithAI();
        }

        // 窗口尺寸变化自适应
        window.addEventListener('resize', () => {
            if (this.chartInstance && this.modalEl && this.modalEl.style.display !== 'none') {
                this.chartInstance.resize();
            }
        });
    }

    /**
     * 打开思维导图弹窗
     * @param {object} message 消息对象
     * @param {number} index 消息在当前分支的索引
     */
    open(message, index) {
        if (!this._isInitialized) this.init();
        if (!message) return;

        this.currentMessage = message;
        this.currentOrientation = 'LR';
        const orientText = this.modalEl.querySelector('#mindmap-orient-text');
        if (orientText) orientText.textContent = '横向布局';

        const toggleBtnText = this.modalEl.querySelector('#mindmap-toggle-all-btn span');
        if (toggleBtnText) toggleBtnText.textContent = '全部展开';

        // 提取纯文本内容（剥离思考标签）
        let rawContent = typeof message.content === 'string' ? message.content : (message.originalContent || '');
        rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '')
                               .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                               .trim();

        if (!rawContent) {
            notify.warning('该消息内容为空，无法生成思维导图');
            return;
        }

        // 获取根节点名称
        const conv = state.conversations[state.currentConversationId];
        const rootTitle = conv?.title || `第 ${index + 1} 楼回复`;

        // 本地纯前端秒级解析
        this.currentTreeData = this.parseMarkdownToTree(rawContent, rootTitle);

        this.modalEl.style.display = 'flex';
        // 确保 DOM 呈现完成后初始化与渲染 ECharts
        setTimeout(() => {
            this.renderChart();
        }, 50);
    }

    /**
     * 关闭弹窗
     */
    close() {
        if (this.modalEl) {
            this.modalEl.style.display = 'none';
        }
        if (this.chartInstance) {
            this.chartInstance.dispose();
            this.chartInstance = null;
        }
    }

    /**
     * 清理 Markdown 标记，返回纯净短文本
     * @param {string} text 
     * @returns {string}
     */
    cleanMarkdownText(text) {
        if (!text) return '';
        return text
            .replace(/\*\*(.*?)\*\*/g, '$1') // 去粗体
            .replace(/\*(.*?)\*/g, '$1')     // 去斜体
            .replace(/`{1,3}(.*?)`{1,3}/g, '$1') // 去代码块标记
            .replace(/\[(.*?)\]\(.*?\)/g, '$1') // 去链接
            .replace(/<.*?>/g, '')           // 去除 HTML 标签
            .trim();
    }

    /**
     * 本地纯前端 Markdown 层级解析器
     * 支持 #~###### 标题与 -, *, +, 1. 列表树形转换
     * @param {string} text 
     * @param {string} fallbackRootTitle 
     * @returns {object} ECharts Tree 树状对象
     */
    parseMarkdownToTree(text, fallbackRootTitle) {
        const root = {
            name: fallbackRootTitle,
            children: []
        };

        const lines = text.split('\n');
        // 维护一个栈结构 [ { depth: number, node: object } ]
        const stack = [{ depth: 0, node: root }];

        for (let rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line.trim()) continue;

            // 1. 判断标题层级 (#, ##, ### 等)
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const depth = headingMatch[1].length;
                const titleText = this.cleanMarkdownText(headingMatch[2]);
                if (!titleText) continue;

                const newNode = { name: titleText, children: [] };

                // 栈顶回退至深度严格小于当前深度的父级
                while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
                    stack.pop();
                }

                stack[stack.length - 1].node.children.push(newNode);
                stack.push({ depth, node: newNode });
                continue;
            }

            // 2. 判断列表层级 (- , * , 1. 等)
            const listMatch = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
            if (listMatch) {
                const indentSpaces = listMatch[1].length;
                // 将缩进空格数映射为相对深度 (基础深度 7，每2空格算一级)
                const depth = 7 + Math.floor(indentSpaces / 2);
                const itemText = this.cleanMarkdownText(listMatch[2]);
                if (!itemText) continue;

                const newNode = { name: itemText, children: [] };

                while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
                    stack.pop();
                }

                stack[stack.length - 1].node.children.push(newNode);
                stack.push({ depth, node: newNode });
                continue;
            }

            // 3. 兜底提取常规段落中带冒号的重点（如 "核心原则：xxx" 或粗体开头）
            const boldLeadMatch = line.match(/^\s*\*\*(.*?)\*\*(?:[:：])?\s*(.*)$/);
            if (boldLeadMatch) {
                const keyText = this.cleanMarkdownText(boldLeadMatch[1]);
                const valText = this.cleanMarkdownText(boldLeadMatch[2]);
                if (keyText) {
                    const depth = 4;
                    const newNode = {
                        name: keyText,
                        children: valText ? [{ name: valText.substring(0, 30) }] : []
                    };
                    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
                        stack.pop();
                    }
                    stack[stack.length - 1].node.children.push(newNode);
                    stack.push({ depth, node: newNode });
                }
            }
        }

        // 如果解析出来的根节点没有子项（例如纯散文段落），则按段落智能切分子节点
        if (root.children.length === 0) {
            const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
            paragraphs.forEach((p, idx) => {
                const cleanP = this.cleanMarkdownText(p);
                if (cleanP) {
                    // 取首句或前 25 字作为分支标题
                    const firstSentence = cleanP.split(/[。！？\n]/)[0] || cleanP.substring(0, 25);
                    const remainder = cleanP.substring(firstSentence.length).trim();
                    root.children.push({
                        name: firstSentence.substring(0, 28) + (firstSentence.length > 28 ? '…' : ''),
                        children: remainder ? [{ name: remainder.substring(0, 30) + (remainder.length > 30 ? '…' : '') }] : []
                    });
                }
            });
        }

        // 清理空 children 属性，利于 ECharts 判断叶子节点
        this.cleanEmptyChildren(root);
        return root;
    }

    /**
     * 递归清理空 children 数组
     */
    cleanEmptyChildren(node) {
        if (!node.children || node.children.length === 0) {
            delete node.children;
        } else {
            node.children.forEach(child => this.cleanEmptyChildren(child));
        }
    }

    /**
     * 递归展开/折叠节点
     */
    toggleCollapseRecursive(node, collapsed) {
        if (!node) return;
        if (node.children) {
            node.collapsed = collapsed;
            node.children.forEach(c => this.toggleCollapseRecursive(c, collapsed));
        }
    }

    /**
     * 渲染 ECharts 关系树图
     */
    renderChart() {
        if (!this.chartContainer) return;
        if (!window.echarts) {
            notify.error('ECharts 图表库未加载');
            return;
        }

        const isDark = document.body.dataset.theme === 'dark';

        if (this.chartInstance) {
            this.chartInstance.dispose();
            this.chartInstance = null;
        }

        this.chartInstance = window.echarts.init(this.chartContainer, isDark ? 'dark' : undefined);

        const textColor = isDark ? '#f1f5f9' : '#1e293b';
        const lineColor = isDark ? '#475569' : '#cbd5e1';
        const nodeColor = isDark ? '#3b82f6' : '#2563eb';
        const bgColor = isDark ? '#1e2634' : '#ffffff';

        const isLR = this.currentOrientation === 'LR';

        const option = {
            backgroundColor: bgColor,
            tooltip: {
                trigger: 'item',
                triggerOn: 'mousemove',
                formatter: (params) => {
                    return `<div style="max-width:320px;word-break:break-all;font-size:12px;padding:2px 4px;">${params.name}</div>`;
                }
            },
            series: [
                {
                    type: 'tree',
                    data: [this.currentTreeData],
                    top: isLR ? '5%' : '8%',
                    left: isLR ? '12%' : '8%',
                    bottom: isLR ? '5%' : '8%',
                    right: isLR ? '20%' : '8%',
                    layout: 'orthogonal',
                    orient: this.currentOrientation, // 'LR' 或 'TB'
                    symbol: 'circle',
                    symbolSize: 9,
                    edgeShape: 'curve',
                    edgeForkPosition: '60%',
                    roam: true, // 允许滚轮缩放和平移！
                    initialTreeDepth: 3,
                    itemStyle: {
                        color: nodeColor,
                        borderColor: isDark ? '#93c5fd' : '#bfdbfe',
                        borderWidth: 2
                    },
                    lineStyle: {
                        color: lineColor,
                        width: 1.5,
                        curveness: 0.5
                    },
                    label: {
                        position: isLR ? 'left' : 'top',
                        verticalAlign: 'middle',
                        align: isLR ? 'right' : 'center',
                        fontSize: 12,
                        color: textColor,
                        fontWeight: 500
                    },
                    leaves: {
                        label: {
                            position: isLR ? 'right' : 'bottom',
                            verticalAlign: 'middle',
                            align: isLR ? 'left' : 'center',
                            fontSize: 12,
                            color: textColor
                        }
                    },
                    emphasis: {
                        focus: 'descendant',
                        itemStyle: {
                            color: '#10b981',
                            borderColor: '#34d399',
                            borderWidth: 3
                        }
                    },
                    expandAndCollapse: true,
                    animationDuration: 450,
                    animationDurationUpdate: 500
                }
            ]
        };

        this.chartInstance.setOption(option);
    }

    /**
     * 计算文字在指定字号下的实际显示像素宽度（支持汉字、全角标点与英文字符加权）
     * @param {string} str - 待测文本
     * @param {number} fontSize - 字号
     * @returns {number} 实际像素宽度
     */
    measureTextWidth(str, fontSize = 12.5) {
        if (!str) return 0;
        let width = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            // 中文字符、中文标点、全角符号占 1.05 个中文字宽
            if (code > 255) {
                width += fontSize * 1.05;
            } else {
                width += fontSize * 0.6;
            }
        }
        return Math.ceil(width);
    }

    /**
     * 深度解析树拓扑并重置所有分支为展开状态，精准统计根节点、中间层、叶子节点的最大像素宽度与几何特征
     * @param {object} root - 根节点
     * @returns {{ cleanTree: object, maxDepth: number, leafCount: number, rootWidth: number, maxMidWidth: number, maxLeafWidth: number }}
     */
    analyzeTreeForExport(root) {
        const cleanTree = JSON.parse(JSON.stringify(root));
        const fontSize = 12.5;
        let maxDepth = 0;
        let leafCount = 0;
        let maxMidWidth = 0;
        let maxLeafWidth = 0;
        const rootWidth = this.measureTextWidth(cleanTree.name, fontSize);

        const traverse = (node, depth) => {
            if (!node) return;
            // 确保全貌导出时所有分支全部展开，彻底避免折叠导致缺漏
            node.collapsed = false;

            if (depth > maxDepth) maxDepth = depth;
            const isLeaf = !node.children || node.children.length === 0;
            const w = this.measureTextWidth(node.name, fontSize);

            if (isLeaf) {
                leafCount++;
                if (w > maxLeafWidth) maxLeafWidth = w;
            } else if (depth > 0) {
                if (w > maxMidWidth) maxMidWidth = w;
            }

            if (node.children) {
                for (const child of node.children) {
                    traverse(child, depth + 1);
                }
            }
        };

        traverse(cleanTree, 0);

        return {
            cleanTree,
            maxDepth: Math.max(1, maxDepth),
            leafCount: Math.max(1, leafCount),
            rootWidth: Math.max(60, rootWidth),
            maxMidWidth: Math.max(80, maxMidWidth),
            maxLeafWidth: Math.max(100, maxLeafWidth)
        };
    }

    /**
     * 导出为全景高清图片（精准度量节点文本宽度并动态预留四周边距，彻底告别文字被裁切截断）
     * — 为什么这么写 —
     * 1. 痛点：ECharts Tree 的 series.left 和 series.right 仅约束节点圆圈的分布，完全不包含标签文本宽度；
     *    若叶子节点文字有 30-50 字（达数百像素），右侧如果留白不足，文字必定被画布右边缘硬生生裁切；
     *    同理，若根节点标题较长，文字向左渲染，左侧留白不足必定导致标题开头被截断；
     * 2. 真实字符度量：通过 measureTextWidth 遍历计算根节点宽度、叶子最长文本宽度与各级连线跨度；
     * 3. 动态边距匹配：左边距 = rootWidth + 80px，右边距 = maxLeafWidth + 100px，上下留白各 80px；
     * 4. 强制全分支展开 (collapsed = false) 与 1.5x Retina 输出，保证 100% 完整全貌且文字字字清晰。
     */
    async exportAsImage() {
        if (!this.currentTreeData || this.isExporting) return;
        this.isExporting = true;

        const loadingEl = this.modalEl?.querySelector('#mindmap-loading');
        const loadingTextEl = this.modalEl?.querySelector('#mindmap-loading-text');
        if (loadingTextEl) loadingTextEl.textContent = '📐 正在精密计算全貌尺寸与渲染大图...';
        if (loadingEl) loadingEl.style.display = 'flex';

        const isDark = document.body.dataset.theme === 'dark';
        const isLR = this.currentOrientation === 'LR';

        try {
            // 1. 精密解析树拓扑与各级文本实际像素宽度
            const { cleanTree, maxDepth, leafCount, rootWidth, maxMidWidth, maxLeafWidth } = this.analyzeTreeForExport(this.currentTreeData);

            let fullWidth = 1600;
            let fullHeight = 1000;
            let marginLeft = 100;
            let marginRight = 100;
            let marginTop = 80;
            let marginBottom = 80;

            if (isLR) {
                // 横向布局：
                // 1. 根节点文字在圆圈左侧 (align: 'right')，左边距必须完全容纳根节点文本 + 80px 安全留白
                marginLeft = Math.ceil(rootWidth + 80);

                // 2. 叶子节点文字在圆圈右侧 (align: 'left')，右边距必须完全容纳最长叶子文本 + 100px 安全留白
                marginRight = Math.ceil(maxLeafWidth + 100);

                // 3. 中间层级连线宽度：每一层至少为中间文本最大宽度 + 110px 呼吸间距
                const tierStep = Math.max(260, Math.ceil(maxMidWidth + 110));

                // 4. 总画布宽度 = 左边留白 + 中间层级跨度 + 右边留白
                fullWidth = marginLeft + (maxDepth * tierStep) + marginRight;

                // 5. 总画布高度 = 每个叶子节点垂直占用 48px，外加顶部与底部各 80px 留白
                marginTop = 80;
                marginBottom = 80;
                fullHeight = Math.max(900, leafCount * 48 + marginTop + marginBottom);
            } else {
                // 纵向布局：
                // 1. 顶部留白：根节点文本在上方居中
                marginTop = Math.ceil(rootWidth * 0.5 + 80);

                // 2. 底部留白：叶子节点文本在下方展开
                marginBottom = Math.ceil(maxLeafWidth + 100);

                // 3. 画布宽度：由叶子节点数量横向平铺决定
                fullWidth = Math.max(1600, leafCount * 140 + 260);

                // 4. 画布高度：层级向下延伸
                fullHeight = Math.max(1000, (maxDepth + 1) * 240 + marginTop + marginBottom);
                marginLeft = 100;
                marginRight = 100;
            }

            // 构造不可见的临时全景离屏容器
            const offscreenContainer = document.createElement('div');
            offscreenContainer.style.cssText = `position:fixed;left:-99999px;top:-99999px;width:${fullWidth}px;height:${fullHeight}px;z-index:-1000;visibility:hidden;pointer-events:none;`;
            document.body.appendChild(offscreenContainer);

            // 实例化独立全景 ECharts
            const offscreenChart = window.echarts.init(offscreenContainer, null, {
                renderer: 'canvas',
                width: fullWidth,
                height: fullHeight
            });

            const nodeColor = isDark ? '#3b82f6' : '#2563eb';
            const lineColor = isDark ? '#4b5563' : '#cbd5e1';
            const textColor = isDark ? '#f3f4f6' : '#1e293b';
            const bgColor = isDark ? '#1e2634' : '#ffffff';

            const exportOption = {
                backgroundColor: bgColor,
                animation: false,
                series: [
                    {
                        type: 'tree',
                        data: [cleanTree],
                        top: marginTop,
                        left: marginLeft,
                        bottom: marginBottom,
                        right: marginRight,
                        layout: 'orthogonal',
                        orient: this.currentOrientation,
                        symbol: 'circle',
                        symbolSize: 10,
                        edgeShape: 'curve',
                        edgeForkPosition: '60%',
                        roam: false, // 禁用平移缩放，完全自适应填满
                        initialTreeDepth: -1, // 展开整棵树全貌
                        itemStyle: {
                            color: nodeColor,
                            borderColor: isDark ? '#93c5fd' : '#bfdbfe',
                            borderWidth: 2
                        },
                        lineStyle: {
                            color: lineColor,
                            width: 1.6,
                            curveness: 0.5
                        },
                        label: {
                            position: isLR ? 'left' : 'top',
                            verticalAlign: 'middle',
                            align: isLR ? 'right' : 'center',
                            fontSize: 12.5,
                            color: textColor,
                            fontWeight: 500
                        },
                        leaves: {
                            label: {
                                position: isLR ? 'right' : 'bottom',
                                verticalAlign: 'middle',
                                align: isLR ? 'left' : 'center',
                                fontSize: 12.5,
                                color: textColor
                            }
                        }
                    }
                ]
            };

            offscreenChart.setOption(exportOption);

            // 等待下一微任务保证渲染树布局完成
            await new Promise(r => setTimeout(r, 80));

            const dataUrl = offscreenChart.getDataURL({
                type: 'png',
                pixelRatio: 1.5, // 1.5x 高清输出
                backgroundColor: bgColor
            });

            // 销毁离屏实例与清理 DOM
            offscreenChart.dispose();
            document.body.removeChild(offscreenContainer);

            // 将 Base64 转换为二进制 Blob 对象，彻底绕过局域网 HTTP 下浏览器拦截 data: URI
            const arr = dataUrl.split(',');
            const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            const blob = new Blob([u8arr], { type: mime });
            const blobUrl = URL.createObjectURL(blob);

            const filename = `思维导图_全貌_${Date.now()}.png`;
            const link = document.createElement('a');
            link.download = filename;
            link.href = blobUrl;
            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                if (link.parentNode) link.parentNode.removeChild(link);
                URL.revokeObjectURL(blobUrl);
            }, 40000);

            notify.success('🎉 思维导图全貌图片已成功导出！');
        } catch (e) {
            console.error('全貌导出图片失败:', e);
            notify.error('导出思维导图失败: ' + e.message);
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            this.isExporting = false;
        }
    }

    /**
     * 可选：调用当前 AI 接口智能提炼浓缩思维导图（支持 DeepSeek 严格规范与流式思考阶段动态反馈）
     */
    async refineWithAI() {
        if (this.isAiSummarizing || !this.currentMessage) return;

        let content = typeof this.currentMessage.content === 'string' ? this.currentMessage.content : (this.currentMessage.originalContent || '');
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, '')
                         .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                         .trim();

        if (!content) return;

        const loadingEl = this.modalEl?.querySelector('#mindmap-loading');
        const loadingTextEl = this.modalEl?.querySelector('#mindmap-loading-text');
        if (loadingTextEl) loadingTextEl.textContent = '🚀 正在连接 AI 模型并准备提炼...';
        if (loadingEl) loadingEl.style.display = 'flex';
        this.isAiSummarizing = true;

        try {
            const { buildApiRequest } = await import('../api-common.js?v=temp');
            const prompt = `请深度剖析以下内容，将其浓缩提炼为层级清晰、要点分明的 Markdown 无序列表树结构。\n【严苛要求】：\n1. 仅输出以短横线 - 缩进的层级列表（如：- 核心要点\\n  - 子要素）；\n2. 节点文字务必精炼简明（每个要点 6-18 字）；\n3. 绝对不要输出任何寒暄、开场白、解释或代码块标记，直接以短横线列表开始！\n\n【待提炼原文】：\n${content.substring(0, 4000)}`;

            const convId = state.currentConversationId;
            const requestData = buildApiRequest({
                convId,
                messages: [{ role: 'user', content: prompt }],
                includeWorldBook: false,
                includePersona: false,
                includeMcp: false,
                applyRegex: false
            });

            if (!requestData) {
                throw new Error('未找到当前会话可用的 API 端点配置，请先在会话中选择模型端点');
            }

            // — 为什么这么写 —
            // 1. 彻底解决 DeepSeek 等标准 API 报 400 "stream_options should be set along with stream = true" 的通病；
            // 2. 显式开启真流式 (stream = true) 并合法附带 stream_options，从而能够实时解析 chunk 感知当前是否正处于深度推理思考阶段；
            // 3. 兼顾普通非思考模型与纯非流式端点兼容。
            if (requestData.body) {
                requestData.body.stream = true;
                requestData.body.stream_options = { include_usage: true };
            }

            const response = await fetch(requestData.url, {
                method: 'POST',
                headers: requestData.headers,
                body: JSON.stringify(requestData.body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 错误 (${response.status}): ${errorText.substring(0, 120)}`);
            }

            let refinedText = '';
            let isThinking = false;
            let hasThoughtFinished = false;
            let hasReceivedAnyContent = false;

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/event-stream') && response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data:')) continue;
                        const jsonStr = trimmed.substring(5).trim();
                        if (jsonStr === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(jsonStr);
                            const choice = parsed.choices?.[0];
                            const delta = choice?.delta || {};

                            // 1. 感知深度思考阶段 (DeepSeek-R1 / Qwen-Thinking 官方规范)
                            const reasoning = delta.reasoning_content || delta.reasoning || '';
                            const contentChunk = delta.content || '';

                            if (reasoning) {
                                if (!isThinking) {
                                    isThinking = true;
                                    if (loadingTextEl) loadingTextEl.textContent = '🧠 正在深度思考梳理脉络...';
                                }
                            } else if (contentChunk) {
                                // 2. 检查是否在 content 中带有 <think> 标签包裹
                                if (contentChunk.includes('<think>')) {
                                    isThinking = true;
                                    if (loadingTextEl) loadingTextEl.textContent = '🧠 正在深度思考梳理脉络...';
                                } else if (contentChunk.includes('</think>')) {
                                    isThinking = false;
                                    hasThoughtFinished = true;
                                    if (loadingTextEl) loadingTextEl.textContent = '✨ 思考已结束，开始生成结构化导图...';
                                } else if (isThinking && !hasThoughtFinished) {
                                    // 还在标签思考中
                                } else {
                                    // 思考结束或者普通模型开始输出正文
                                    if (!hasReceivedAnyContent) {
                                        hasReceivedAnyContent = true;
                                        if (loadingTextEl) {
                                            loadingTextEl.textContent = isThinking || hasThoughtFinished
                                                ? '✨ 思考已结束，开始生成结构化导图...'
                                                : '⚡ 正在提炼核心要点知识树...';
                                        }
                                    }
                                }

                                refinedText += contentChunk;
                            }
                        } catch (e) { /* 忽略单个分片 JSON 解析异常 */ }
                    }
                }
            } else {
                const data = await response.json();
                refinedText = data?.choices?.[0]?.message?.content || '';
            }

            if (loadingTextEl) loadingTextEl.textContent = '🎨 正在构建全景思维导图...';

            // 清洗思考标签与可能包裹的 markdown 代码块
            refinedText = refinedText.replace(/<think>[\s\S]*?<\/think>/gi, '')
                                     .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                                     .replace(/^```[a-zA-Z]*\n?/gm, '')
                                     .replace(/```$/gm, '')
                                     .trim();

            if (refinedText) {
                const conv = state.conversations[convId];
                const rootTitle = conv?.title || 'AI 核心要点导图';
                this.currentTreeData = this.parseMarkdownToTree(refinedText, rootTitle);
                this.renderChart();
                notify.success('AI 智能提炼脑图完成！');
            } else {
                notify.warning('未能从 AI 响应中提取到有效导图内容');
            }
        } catch (err) {
            console.error('AI 提炼思维导图失败:', err);
            notify.error('AI 提炼失败: ' + err.message);
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            this.isAiSummarizing = false;
        }
    }
}

export const mindmapManager = new MindmapManager();
