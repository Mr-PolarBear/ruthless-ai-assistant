/**
 * @file regex-examples-modal.js
 * @description 常用正则表达式示例与速查指南弹窗模块
 * — 为什么这么写 —
 * 1. 遵循「控大防膨与优先新建独立文件」铁律，将正则示例数据集与渲染逻辑从 modals.html 和 regex-settings.js 中完全解耦
 * 2. 提供丰富的开箱即用示例（折叠卡片化、思考过程过滤、高亮修饰、排版净化、结构化提取等）
 * 3. 支持实时搜索、分类快速筛选、一键复制正则、一键复制替换、以及「⚡ 一键套用到编辑表单」直接载入
 */

import { copyTextToClipboard } from '../utils.js?v=temp';
import { notify } from '../ui-updater.js?v=temp';
import { dom } from '../dom.js?v=temp';
import { startNewRegexRule } from '../settings/regex-settings.js?v=temp';

/**
 * 分类定义
 */
const CATEGORIES = [
    { key: 'all', label: '🔥 全部示例' },
    { key: 'collapse', label: '📦 折叠与卡片化' },
    { key: 'thinking', label: '💭 思考过程处理' },
    { key: 'highlight', label: '🎨 文本高亮与修饰' },
    { key: 'formatting', label: '🧹 格式排版净化' },
    { key: 'structure', label: '🏷️ 结构化标签增强' }
];

/**
 * 常用正则示例数据集
 */
const REGEX_EXAMPLES = [
    {
        id: 'ex_triple_dash_collapse',
        category: 'collapse',
        name: '三虚线包裹内容折叠卡片 (------)',
        desc: '将连续 3 个以上减号包裹的多行文本转换为美观的原生折叠卡片。\n⚠️ 重要注意：减号在 Markdown 中会被编译器解析为 <hr> 分割线，因此执行阶段【必须选择：渲染前 (pre-markdown)】！',
        find: '/(?:^|\\r?\\n)-{3,}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*-{3,}[ \\t]*(?=\\r?\\n|$)/g',
        replace: '<details open style="margin:12px 0;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-surface);box-shadow:0 1px 2px rgba(0,0,0,.06);overflow:hidden;">\n<summary style="cursor:pointer;padding:10px 14px;font-weight:600;font-size:14px;color:var(--text-primary);background:var(--bg-medium);border-bottom:1px solid var(--border-color);user-select:none;">📋 点击查看详细内容</summary>\n<div style="padding:12px 14px;background:var(--bg-surface);color:var(--text-primary);font-size:14px;line-height:1.7;white-space:pre-wrap;">$1</div>\n</details>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (高风险，处理原始减号)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '这是前面的内容。\n------\n第一行详细说明\n第二行关键数据\n第三行补充信息\n------\n这是后面的总结。'
    },
    {
        id: 'ex_star_equal_card',
        category: 'collapse',
        name: '星号或等号线包裹内容卡片化 (*** 或 ===)',
        desc: '将以 *** 或 === 包裹的多行剧情、剧透或备忘段落包装为专属浅色微渐变卡片。',
        find: '/(?:^|\\r?\\n)[*=]{3,}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*[*=]{3,}[ \\t]*(?=\\r?\\n|$)/g',
        replace: '<div style="margin:12px 0;padding:12px 16px;border-left:4px solid var(--accent-blue);border-radius:0 8px 8px 0;background:var(--bg-surface);box-shadow:0 1px 3px rgba(0,0,0,.05);"><strong style="color:var(--accent-blue);display:block;margin-bottom:6px;">📌 核心备忘 / 剧情卡片</strong><div style="line-height:1.65;">$1</div></div>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '***\n【系统通告】\n角色当前经验值已满，解锁下一阶段技能。\n***'
    },
    {
        id: 'ex_branch_options_capsule',
        category: 'collapse',
        name: '剧情选项/分支选择胶囊按钮化 (1. 2. 3.)',
        desc: '将 AI 输出的「1. 探索密室」、「2. 拔剑攻击」等独立行选项转为带悬停高亮的原生胶囊按钮排版。',
        find: '/^([1-9]|10)\\.\\s*([^\\n\\r]+)$/gm',
        replace: '<div style="display:inline-flex;align-items:center;margin:4px 6px 4px 0;padding:6px 14px;border:1px solid var(--accent-blue);border-radius:20px;background:rgba(37,99,235,0.08);color:var(--accent-blue);font-weight:600;font-size:0.9em;cursor:pointer;">$1. $2</div>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '请选择你的行动：\n1. 悄悄靠近石门\n2. 原地施展侦测魔法\n3. 呼叫同伴掩护'
    },
    {
        id: 'ex_callout_box',
        category: 'collapse',
        name: 'GitHub 风格引用告示栏 (> [!NOTE])',
        desc: '将 Markdown 中的 > [!NOTE] 或 > [!WARNING] 引用块增强为带有色标指示条的高级告示框。',
        find: '/^>\\s*\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\][ \\t]*\\r?\\n>\\s*([^\\n\\r]+(?:\\r?\\n>[ \\t]*[^\\n\\r]+)*)/gm',
        replace: '<div style="margin:12px 0;padding:10px 14px;border-left:4px solid var(--accent-blue);border-radius:4px;background:var(--bg-surface);box-shadow:0 1px 3px rgba(0,0,0,.05);"><strong style="color:var(--accent-blue);font-size:0.92em;">💡 $1</strong><div style="margin-top:4px;line-height:1.6;">$2</div></div>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '> [!NOTE]\n> 本机运行环境纯离线存储，数据绝不上传云端。'
    },
    {
        id: 'ex_think_fold',
        category: 'thinking',
        name: 'DeepSeek / QwQ <think> 思考过程折叠化',
        desc: '将模型输出的 <think> 深度思考过程包裹为原生折叠区，默认收起，点击随时展开查看，保持对话整洁。',
        find: '/<(think|thinking)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/gi',
        replace: '<details style="margin:8px 0;padding:6px 12px;background:var(--bg-medium);border:1px dashed var(--border-color);border-radius:6px;"><summary style="cursor:pointer;color:var(--text-secondary);font-size:13px;user-select:none;font-weight:500;">💭 展开查看深度思考过程...</summary><div style="margin-top:6px;font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">$2</div></details>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '<think>\n首先分析用户的需求，用户想要一个关于正则表达式的解决方案...\n</think>\n大爷你好，方案如下：'
    },
    {
        id: 'ex_think_remove',
        category: 'thinking',
        name: '彻底净化删除 <think> 思考标签与内容',
        desc: '直接抹除所有的 <think> 标签及其包裹的所有内部思考过程，只保留最终正文（替换内容留空）。',
        find: '/<(think|thinking)\\b[^>]*>[\\s\\S]*?<\\/\\1>/gi',
        replace: '',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '<think>\n这里是冗长的思考过程...\n</think>\n这是最终的有效回答。'
    },
    {
        id: 'ex_phone_desensitize',
        category: 'thinking',
        name: '发送前手机号/身份证号码脱敏掩码',
        desc: '在用户消息发送给大模型 API 前，自动将手机号中间 4 位转为星号（138****5678），杜绝个人隐私外泄。',
        find: '/(1[3-9]\\d)\\d{4}(\\d{4})/g',
        replace: '$1****$2',
        stage: 'post-markdown',
        stageDesc: '渲染后 (作用域为请求时自动生效)',
        scopes: ['request-user'],
        scopesDesc: '请求时-用户',
        sampleText: '我的联系电话是 13812345678，请尽快给我答复。'
    },
    {
        id: 'ex_dialogue_highlight',
        category: 'highlight',
        name: '中文双引号“...”高亮对话台词',
        desc: '将 AI 角色回复中所有双引号内的台词染成醒目的主题蓝色并加粗，让对话与旁白环境描写层次分明。',
        find: '/“([^”\\n]+)”/g',
        replace: '<span style="color:var(--accent-blue);font-weight:600;">“$1”</span>',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全，仅操作纯文本节点)',
        scopes: ['display-assistant', 'display-user'],
        scopesDesc: '展示时-AI / 展示时-用户',
        sampleText: '乌鸦推开酒馆的木门，“老板，来一杯最浓的黑麦酒。”说完便坐到了角落。'
    },
    {
        id: 'ex_parenthesis_italic',
        category: 'highlight',
        name: '中文全角括号（...）心理描写淡化斜体',
        desc: '将全角括号内的心理活动、动作补充描写设置为淡灰色斜体，烘托剧情氛围。',
        find: '/（([^）\\n]+)）/g',
        replace: '<span style="color:var(--text-secondary);font-style:italic;opacity:0.85;">（$1）</span>',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '“这件法宝售价三千灵石。”（其实这只是个劣质仿品，他在心里暗想）'
    },
    {
        id: 'ex_keywords_badge',
        category: 'highlight',
        name: '重要警戒词汇徽章化 (剧透/注意/警告)',
        desc: '自动识别消息中的警示词汇，转换成红色醒目小徽章。',
        find: '/(【(?:剧透|警告|注意|提示|重要)】)/g',
        replace: '<mark style="background:rgba(239,68,68,0.15);color:#ef4444;padding:1px 6px;border-radius:4px;font-weight:600;font-size:0.88em;">$1</mark>',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '【注意】请在执行删除操作前做好数据库备份！【剧透】最终Boss其实是他的亲生哥哥。'
    },
    {
        id: 'ex_role_status_card',
        category: 'structure',
        name: '角色状态/属性面板结构化卡片 (【状态】...【/状态】)',
        desc: '将跑团、TRPG 或战斗结算时的数值面板转换成精致的仪表卡片。',
        find: '/【(状态|属性|面板)】([\\s\\S]*?)【\\/\\1】/g',
        replace: '<div style="margin:12px 0;border:1px solid var(--accent-blue);border-radius:8px;padding:12px 16px;background:var(--bg-surface);box-shadow:0 1px 3px rgba(0,0,0,.05);"><div style="font-weight:bold;color:var(--accent-blue);margin-bottom:8px;display:flex;align-items:center;gap:6px;"><span>⚔️</span><span>角色$1面板</span></div><div style="line-height:1.7;font-family:monospace;font-size:0.92em;">$2</div></div>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '【状态】\n生命值: 85/100\n法力值: 40/50\n异常状态: 中毒 (持续2轮)\n【/状态】'
    },
    {
        id: 'ex_custom_xml_card',
        category: 'structure',
        name: '自定义 XML 标签卡片化 (<card> / <quest>)',
        desc: '匹配大模型输出的自定义 XML 标签（如 <card>、<quest>、<info>），美化为现代化卡片容器。',
        find: '/<(card|quest|info)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/gi',
        replace: '<div style="margin:12px 0;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-surface);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05);"><div style="padding:8px 14px;background:var(--bg-medium);font-weight:600;font-size:0.9em;color:var(--accent-blue);border-bottom:1px solid var(--border-color);">📦 $1 详情</div><div style="padding:12px 14px;line-height:1.65;">$2</div></div>',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '<quest>\n任务目标：前往黑森林寻找失落的水晶。\n奖励：500 金币 + 史诗护甲\n</quest>'
    },
    {
        id: 'ex_compress_empty_lines',
        category: 'formatting',
        name: '连续多余空行压缩为标准双换行',
        desc: '很多模型在换段或列点时容易连敲多行回车导致聊天气泡过长，此规则将 3 个以上连续回车收敛为 2 个换行。',
        find: '/\\n{3,}/g',
        replace: '\n\n',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '第一段话\n\n\n\n\n第二段话，中间有好多空行\n\n\n第三段话'
    },
    {
        id: 'ex_trim_line_trailing_spaces',
        category: 'formatting',
        name: '清理每行末尾多余空格与不可见制表符',
        desc: '消除每行行尾悬挂的多余空格或 Tab 制表符，防止 Markdown 产生非预期的强制硬换行。',
        find: '/[ \\t]+$/gm',
        replace: '',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '这一行末尾有好多看不见的空格    \n第二行也是   '
    },
    {
        id: 'ex_fix_english_punctuation_space',
        category: 'formatting',
        name: '英文标点后自动补空格修正 (逗号/句号/问号)',
        desc: '修复类似「Hello,world」或「No.1」这类英文标点后漏打空格导致单词连缀成大块的问题。',
        find: '/([,\\.?!])(?=[A-Za-z])/g',
        replace: '$1 ',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: 'Hello,world!This is a test.Are you ready?'
    },
    {
        id: 'ex_fix_broken_markdown_bold',
        category: 'formatting',
        name: '修复两端多余空格导致无法加粗的 Markdown (** 文本 **)',
        desc: '在 Markdown 语法中，如果 ** 与文字之间有空格（如 ** 重点 **），加粗会失效。此正则自动剔除多余空格修复加粗。',
        find: '/\\*\\*\\s+([^\\*\\n]+?)\\s+\\*\\*/g',
        replace: '**$1**',
        stage: 'pre-markdown',
        stageDesc: '渲染前 (pre-markdown)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '这是一个 ** 无法正常加粗的错误语法 ** 示例。'
    },
    {
        id: 'ex_dash_ellipsis_beautify',
        category: 'formatting',
        name: '中文两字线破折号（——）与六点省略号排版美化',
        desc: '修复不同字体下破折号中间断开、省略号位置过低的问题，保证纯正出版级排版。',
        find: '/(——|……)/g',
        replace: '<span style="letter-spacing:-0.15em;font-family:SimSun,serif;font-weight:bold;">$1</span>',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全)',
        scopes: ['display-assistant', 'display-user'],
        scopesDesc: '展示时-AI / 展示时-用户',
        sampleText: '他沉思良久——终于下定决心……'
    },
    {
        id: 'ex_inline_code_tag_color',
        category: 'structure',
        name: '特定技术标签反引号文字彩色高亮 (`API`, `DB`, `FIX`)',
        desc: '将带有指定技术前缀的反引号行内代码块渲染为专属高饱和度徽章。',
        find: '/`((?:API|DB|FIX|BUG|TODO|NOTE):[^`]+)`/g',
        replace: '<code style="background:rgba(37,99,235,0.12);color:var(--accent-blue);padding:2px 6px;border-radius:4px;font-weight:600;font-size:0.88em;">$1</code>',
        stage: 'post-markdown',
        stageDesc: '渲染后 (安全)',
        scopes: ['display-assistant'],
        scopesDesc: '展示时-AI',
        sampleText: '本次更新涉及 `API:v2/chat/completions` 与 `DB:sqlite_migration`，请尽快修复 `BUG:102`。'
    }
];

let activeCategory = 'all';
let currentSearchKeyword = '';

/**
 * 初始化示例弹窗事件监听
 */
export function initRegexExamplesModal() {
    const triggerBtn = document.getElementById('regex-examples-btn');
    const modal = document.getElementById('regex-examples-modal');
    const closeBtn = document.getElementById('regex-examples-close-btn');
    const bottomCloseBtn = document.getElementById('regex-examples-bottom-close-btn');
    const searchInput = document.getElementById('regex-examples-search-input');
    const listContainer = document.getElementById('regex-examples-list');

    if (triggerBtn) {
        triggerBtn.addEventListener('click', openRegexExamplesModal);
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', closeRegexExamplesModal);
    }
    if (bottomCloseBtn) {
        bottomCloseBtn.addEventListener('click', closeRegexExamplesModal);
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeRegexExamplesModal();
            }
        });
    }

    // 搜索实时过滤
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchKeyword = e.target.value.trim().toLowerCase();
            renderExamplesList();
        });
    }

    // 列表内部按钮事件委托（复制正则、复制替换、一键套用）
    if (listContainer) {
        listContainer.addEventListener('click', handleExampleActionClick);
    }
}

/**
 * 打开示例弹窗并渲染
 */
export function openRegexExamplesModal() {
    const modal = document.getElementById('regex-examples-modal');
    const searchInput = document.getElementById('regex-examples-search-input');
    if (!modal) return;

    activeCategory = 'all';
    currentSearchKeyword = '';
    if (searchInput) searchInput.value = '';

    renderCategoryButtons();
    renderExamplesList();

    modal.style.display = 'flex';
}

/**
 * 关闭示例弹窗
 */
export function closeRegexExamplesModal() {
    const modal = document.getElementById('regex-examples-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * 渲染分类药丸筛选栏
 */
function renderCategoryButtons() {
    const container = document.getElementById('regex-examples-categories');
    if (!container) return;

    container.innerHTML = CATEGORIES.map(cat => `
        <button type="button" class="regex-cat-pill ${cat.key === activeCategory ? 'active' : ''}" data-cat="${cat.key}">
            ${cat.label}
        </button>
    `).join('');

    container.querySelectorAll('.regex-cat-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCategory = btn.dataset.cat;
            container.querySelectorAll('.regex-cat-pill').forEach(b => b.classList.toggle('active', b === btn));
            renderExamplesList();
        });
    });
}

/**
 * 渲染示例卡片列表
 */
function renderExamplesList() {
    const container = document.getElementById('regex-examples-list');
    if (!container) return;

    let filtered = REGEX_EXAMPLES;

    // 1. 分类过滤
    if (activeCategory !== 'all') {
        filtered = filtered.filter(item => item.category === activeCategory);
    }

    // 2. 搜索词过滤
    if (currentSearchKeyword) {
        filtered = filtered.filter(item => {
            const haystack = `${item.name} ${item.desc} ${item.find} ${item.replace} ${item.stageDesc} ${item.scopesDesc}`.toLowerCase();
            return haystack.includes(currentSearchKeyword);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
                <div style="font-size: 0.95em;">未找到匹配的正则表达式示例</div>
                <div style="font-size: 0.82em; margin-top: 4px; opacity: 0.8;">请尝试更换搜索关键词或切换分类筛选</div>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(item => `
        <div class="regex-example-card" data-id="${item.id}">
            <!-- 头部 -->
            <div class="regex-example-card-header">
                <div class="regex-example-card-title">
                    <span>${escapeHtml(item.name)}</span>
                </div>
                <div class="regex-example-badges">
                    <span class="regex-pill-badge stage ${item.stage === 'pre-markdown' ? 'pre' : 'post'}">${escapeHtml(item.stageDesc)}</span>
                    <span class="regex-pill-badge scope">${escapeHtml(item.scopesDesc)}</span>
                </div>
            </div>

            <!-- 说明 -->
            <div class="regex-example-desc">${escapeHtml(item.desc).replace(/\\n/g, '<br>')}</div>

            <!-- 规则细节 -->
            <div class="regex-example-fields">
                <!-- 查找内容 -->
                <div class="regex-example-field-row">
                    <span class="field-label">查找内容 (正则)：</span>
                    <div class="code-box">
                        <code>${escapeHtml(item.find)}</code>
                        <button type="button" class="example-copy-btn" data-action="copy-find" data-id="${item.id}" title="复制查找正则">
                            <span>📋</span> <span>复制正则</span>
                        </button>
                    </div>
                </div>

                <!-- 替换内容 -->
                <div class="regex-example-field-row">
                    <span class="field-label">替换内容：</span>
                    <div class="code-box">
                        <code>${item.replace ? escapeHtml(item.replace) : '<i style="color:var(--text-secondary);">(留空表示直接删除)</i>'}</code>
                        <button type="button" class="example-copy-btn" data-action="copy-replace" data-id="${item.id}" title="复制替换内容" ${!item.replace ? 'disabled style="opacity:0.5;"' : ''}>
                            <span>📋</span> <span>复制替换</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- 底部一键应用操作栏 -->
            <div class="regex-example-card-footer">
                <span class="example-hint">💡 点击右侧按钮可直接载入当前规则并自动切换阶段与作用域</span>
                <button type="button" class="example-apply-btn" data-action="apply" data-id="${item.id}">
                    <span>⚡ 一键套用到编辑表单</span>
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * 处理卡片内点击动作（复制与套用）
 */
function handleExampleActionClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const example = REGEX_EXAMPLES.find(item => item.id === id);
    if (!example) return;

    if (action === 'copy-find') {
        copyTextToClipboard(example.find).then(() => {
            notify.copy('已复制查找正则表达式！');
            highlightSuccessBtn(btn);
        }).catch(err => {
            alert('复制失败，请手动选择复制: ' + err.message);
        });
    } else if (action === 'copy-replace') {
        if (!example.replace) return;
        copyTextToClipboard(example.replace).then(() => {
            notify.copy('已复制替换内容！');
            highlightSuccessBtn(btn);
        }).catch(err => {
            alert('复制失败，请手动选择复制: ' + err.message);
        });
    } else if (action === 'apply') {
        applyExampleToForm(example);
    }
}

/**
 * 按钮成功短暂反馈
 */
function highlightSuccessBtn(btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>✅</span> <span>已复制</span>';
    btn.classList.add('success');
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('success');
    }, 1500);
}

/**
 * 一键套用示例到右侧表单
 * @param {object} example - 选中的示例对象
 */
function applyExampleToForm(example) {
    // 1. 触发空白新增状态，清空残留 id
    startNewRegexRule('global');

    // 2. 注入各输入控件
    if (dom.regexNameInput) dom.regexNameInput.value = example.name;
    if (dom.regexFindInput) dom.regexFindInput.value = example.find;
    if (dom.regexReplaceInput) dom.regexReplaceInput.value = example.replace;
    if (dom.regexTestInput) dom.regexTestInput.value = example.sampleText || '';

    // 3. 注入执行阶段
    if (dom.regexStageSelect) {
        dom.regexStageSelect.value = example.stage || 'post-markdown';
    }

    // 4. 注入作用域多选框
    if (dom.regexScopeReqUser) dom.regexScopeReqUser.checked = example.scopes.includes('request-user');
    if (dom.regexScopeReqAssistant) dom.regexScopeReqAssistant.checked = example.scopes.includes('request-assistant');
    if (dom.regexScopeDisplayUser) dom.regexScopeDisplayUser.checked = example.scopes.includes('display-user');
    if (dom.regexScopeDisplayAssistant) dom.regexScopeDisplayAssistant.checked = example.scopes.includes('display-assistant');

    // 5. 派发输入事件触发实时校验与高度自适应
    if (dom.regexFindInput) dom.regexFindInput.dispatchEvent(new Event('input'));
    if (dom.regexTestInput) dom.regexTestInput.dispatchEvent(new Event('input'));

    // 6. 关闭示例弹窗并提示
    closeRegexExamplesModal();
    notify.success(`已将「${example.name}」套用到规则表单！`);

    // 7. 聚焦名称框
    if (dom.regexNameInput) {
        dom.regexNameInput.focus();
    }
}

/**
 * HTML 转义防御 XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
