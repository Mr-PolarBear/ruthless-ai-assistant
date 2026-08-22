/**
 * @file quick-prompt-storage.js
 * @description 负责快捷提示数据的本地存储持久化、内置预设与兼容读取
 */

import { state } from '../state.js?v=260823';

export const QUICK_PROMPTS_STORAGE_KEY = 'quick_prompts';

// 内置预设快捷提示（优先排在最前面）
export const DEFAULT_PROMPTS = [
    {
        id: 'prompt_quote',
        title: '双引号“”',
        text: '“”',
        insertMode: 'cursor',
        cursorPosition: 'middle',
        customCursorOffset: 1
    },
    {
        id: 'prompt_bold',
        title: '双星号**',
        text: '****',
        insertMode: 'cursor',
        cursorPosition: 'middle',
        customCursorOffset: 2
    },
    {
        id: 'prompt_bracket',
        title: '括号()',
        text: '()',
        insertMode: 'cursor',
        cursorPosition: 'middle',
        customCursorOffset: 1
    },
    {
        id: 'prompt_line_start',
        title: '移到行首',
        text: '',
        insertMode: 'line_start',
        cursorPosition: 'start',
        customCursorOffset: 0
    },
    {
        id: 'prompt_line_end',
        title: '移到行尾',
        text: '',
        insertMode: 'line_end',
        cursorPosition: 'end',
        customCursorOffset: 0
    },
    {
        id: 'prompt_new_line',
        title: '换行',
        text: '\n',
        insertMode: 'cursor',
        cursorPosition: 'end',
        customCursorOffset: 0
    },
    { id: 'prompt_1', title: '代码审查', text: '请审查以下代码，寻找潜在的bug、性能问题和不符合最佳实践的地方。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_2', title: '代码优化', text: '请重构以下代码，使其更简洁、高效，并提升可读性，但不要改变其原有功能。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_3', title: '代码解释', text: '请逐行解释以下代码的功能和工作原理。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_4', title: '添加注释', text: '请为以下代码添加清晰、准确的注释，解释每个函数和复杂逻辑块的作用。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_5', title: '编写单元测试', text: '请为以下代码编写全面的单元测试用例，使用[Jest/Mocha/Pytest]框架。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_6', title: '寻找Bug', text: '我怀疑以下代码中有bug，请帮我分析问题可能出在哪里。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_7', title: '正则表达式生成', text: '我需要一个正则表达式，用于匹配[请描述规则]。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_8', title: '数据库查询', text: '请帮我写一个SQL查询，用于[请描述查询需求]。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_9', title: 'API设计', text: '我正在设计一个API，用于[请描述功能]，请帮我设计其RESTful风格的URL、请求方法和数据结构。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_10', title: '架构建议', text: '我正在开发一个[请描述项目类型]的项目，请给我一些关于技术选型和架构设计的建议。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_11', title: '翻译成英文', text: '请将以下中文文本翻译成流畅、专业的英文：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_12', title: '翻译成中文', text: '请将以下英文文本翻译成通顺、地道的中文：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_13', title: '润色文本', text: '请帮我润色以下文本，使其更专业、更具说服力。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_14', title: '总结长文', text: '请将以下长篇文章总结成500字以内的摘要。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_15', title: '提取要点', text: '请从以下文本中提取关键信息，以要点列表的形式呈现。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_16', title: '头脑风暴', text: '关于[某个主题]，我需要一些创新的想法，请帮我进行头脑风暴。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_17', title: 'SWOT分析', text: '请对[某个项目或想法]进行一次SWOT分析（优势、劣势、机会、威胁）。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_18', title: '撰写邮件', text: '请帮我写一封专业的电子邮件，主题是[主题]，收件人是[收件人]，内容要点如下：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_19', title: '角色扮演', text: '现在，请你扮演一个[角色，如面试官/投资人/用户]，和我进行对话。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_20', title: '学习计划', text: '我想学习[某个技能或领域]，请为我制定一个为期30天的详细学习计划。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_21', title: '解释概念', text: '请用简单易懂的语言，向一个初学者解释什么是[某个复杂的概念]。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_22', title: '比较异同', text: '请详细比较[事物A]和[事物B]的异同点。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_23', title: '寻找解决方案', text: '我遇到了一个问题：[详细描述问题]，请帮我分析原因并提供几种可能的解决方案。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_24', title: '制定计划', text: '我需要制定一个[项目或活动]的计划，请帮我列出关键步骤和时间节点。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_25', title: '内容续写', text: '请接着下面的故事或文章续写：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_26', title: '反驳观点', text: '以下是一个观点：“[某个观点]”，请从批判性的角度出发，提出有力的反驳论据。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_27', title: '数据模拟', text: '请帮我生成一些符合以下格式的模拟数据（例如JSON）：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_28', title: '命令转换', text: '请将这个操作需求“[操作需求]”转换成Linux/Windows的命令行指令。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_29', title: '内容分类', text: '请将以下内容进行分类，并说明你的分类标准：', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
    { id: 'prompt_30', title: '起一些名字', text: '请帮我的[项目/产品/角色]起5个候选名字。', insertMode: 'cursor', cursorPosition: 'end', customCursorOffset: 0 },
];

/**
 * 从 localStorage 读取快捷提示，并规范化字段默认值
 * @returns {Array<object>}
 */
export function loadQuickPromptsFromStorage() {
    try {
        const raw = localStorage.getItem(QUICK_PROMPTS_STORAGE_KEY);
        if (!raw) return null;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return null;

        // 兼容补齐老数据字段
        return list.map(item => ({
            id: item.id || `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            title: item.title || '未命名提示',
            text: item.text ?? '',
            insertMode: item.insertMode || 'cursor', // 'cursor' | 'line_start' | 'line_end' | 'new_line'
            cursorPosition: item.cursorPosition || 'end', // 'start' | 'middle' | 'end' | 'custom'
            customCursorOffset: Number.isFinite(item.customCursorOffset) ? item.customCursorOffset : 0
        }));
    } catch (e) {
        console.error('从 localStorage 读取快捷提示失败:', e);
        return null;
    }
}

/**
 * 将快捷提示数组可靠持久化到 localStorage
 * @param {Array<object>} prompts - 提示数组
 */
export function saveQuickPromptsToStorage(prompts = state.quickPrompts) {
    try {
        if (!Array.isArray(prompts)) return;
        localStorage.setItem(QUICK_PROMPTS_STORAGE_KEY, JSON.stringify(prompts));
    } catch (e) {
        console.error('持久化快捷提示失败:', e);
    }
}
