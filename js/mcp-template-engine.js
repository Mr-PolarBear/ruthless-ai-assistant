/**
 * @file mcp-template-engine.js
 * @description MCP模板引擎 - 支持路径表达式的数据驱动模板系统
 */

import { escapeHtml } from './utils.js?v=260820-1';

/**
 * 乌鸦：智能数据结构适配器 - 缓存对象，避免重复扫描
 */
const dataStructureCache = new Map();

/**
 * 乌鸦：清理数据结构缓存（用于测试环境）
 */
export function clearDataStructureCache() {
    dataStructureCache.clear();
    console.log('🧺 数据结构缓存已清理');
}

/**
 * 乌鸦：智能识别数据结构中的容器字段
 * @param {Object} obj - 数据对象
 * @returns {Object} 结构信息
 */
export function analyzeDataStructure(obj) {
    if (!obj || typeof obj !== 'object') return { containers: [], arrays: [] };
    
    // 乌鸦：为了防止数据污染，使用更精准的缓存键（包含数据结构特征）
    const structureSignature = JSON.stringify({
        keys: Object.keys(obj).sort(),
        dataTypes: Object.keys(obj).reduce((acc, key) => {
            const value = obj[key];
            if (Array.isArray(value)) {
                acc[key] = `array_${value.length}_${value[0] ? Object.keys(value[0]).sort().join(',') : 'empty'}`;
            } else if (typeof value === 'object' && value !== null) {
                acc[key] = `object_${Object.keys(value).sort().join(',')}`;
            } else {
                acc[key] = typeof value;
            }
            return acc;
        }, {})
    });
    
    // 检查缓存
    if (dataStructureCache.has(structureSignature)) {
        console.log('📦 使用缓存的数据结构分析');
        return dataStructureCache.get(structureSignature);
    }
    
    const containers = []; // 可能包含数据的容器字段（如 result, data 等）
    const arrays = [];     // 直接的数组字段
    
    // 扫描第一层字段
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key];
            
            if (Array.isArray(value)) {
                arrays.push({ key, path: key, data: value });
            } else if (typeof value === 'object' && value !== null) {
                // 检查是否为数据容器（包含数组或多个字段的对象）
                const subArrays = [];
                const subFields = Object.keys(value).length;
                
                for (const subKey in value) {
                    if (Array.isArray(value[subKey])) {
                        subArrays.push({ key: subKey, path: `${key}.${subKey}`, data: value[subKey] });
                    }
                }
                
                if (subArrays.length > 0 || subFields > 1) {
                    containers.push({ key, path: key, data: value, arrays: subArrays });
                }
            }
        }
    }
    
    const result = { containers, arrays };
    console.log('🔍 新的数据结构分析结果:', result);
    dataStructureCache.set(structureSignature, result);
    return result;
}

/**
 * 乌鸦：智能路径解析器 - 支持通用路径适配
 * @param {Object} obj - 对象
 * @param {string} path - 逻辑路径，如 "result.name" 或 "result.[i].title"
 * @returns {any} 值
 */
export function getNestedValue(obj, path) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (!path) return undefined;
    
    // 乌鸦：调试信息
    console.log(`🔍 路径解析开始: "${path}"`);
    console.log('📦 原始数据:', obj);
    
    // 乌鸦：分析数据结构
    const structure = analyzeDataStructure(obj);
    
    // 乌鸦：智能路径适配 - 处理通用容器名称
    let adaptedPath = path;
    
    // 乌鸦：处理 "result" 路径 - 查找实际的数据容器
    if (path.startsWith('result.') || path === 'result') {
        console.log('🎯 检测到 result 路径，开始适配...');
        const containerNames = ['result', 'data', 'response', 'payload'];
        let foundContainer = null;
        
        // 乌鸦：查找实际存在的容器
        for (const name of containerNames) {
            if (obj[name]) {
                foundContainer = name;
                console.log(`✅ 找到容器: ${name}`);
                break;
            }
        }
        
        if (foundContainer && foundContainer !== 'result') {
            adaptedPath = path.replace(/^result/, foundContainer);
            console.log(`🔄 路径适配: "${path}" → "${adaptedPath}"`);
        } else if (!obj.result && structure.containers.length > 0) {
            // 乌鸦：如果没有 result 字段，但有其他容器，使用第一个容器
            const replacementContainer = structure.containers[0].key;
            adaptedPath = path.replace(/^result/, replacementContainer);
            console.log(`🔄 路径适配（使用第一个容器）: "${path}" → "${adaptedPath}"`);
        }
    }
    
    // 乌鸦：处理 "data" 路径 - 处理不同的数据容器格式
    if (path.startsWith('data.') || path === 'data') {
        const containerNames = ['data', 'result', 'response', 'payload'];
        let foundContainer = null;
        
        for (const name of containerNames) {
            if (obj[name]) {
                foundContainer = name;
                break;
            }
        }
        
        if (foundContainer && foundContainer !== 'data') {
            adaptedPath = path.replace(/^data/, foundContainer);
        } else if (!obj.data && structure.containers.length > 0) {
            adaptedPath = path.replace(/^data/, structure.containers[0].key);
        }
    }
    
    // 乌鸦：处理 "list" 路径 - 查找实际的数组字段
    if (adaptedPath.includes('.list') || adaptedPath.startsWith('list')) {
        console.log('🎯 检测到 list 路径，开始适配...');
        // 乌鸦：查找所有可能的数组路径
        const allArrays = [...structure.arrays];
        structure.containers.forEach(container => {
            allArrays.push(...container.arrays);
        });
        
        console.log('📊 所有可用数组:', allArrays.map(a => a.path));
        
        if (allArrays.length > 0) {
            // 乌鸦：智能选择最合适的数组
            let targetArray = null;
            
            // 乌鸦：优先级选择：1. 命名匹配 2. 数据量最大
            if (adaptedPath.includes('.list')) {
                // 对于 result.list 类型的路径，先找名为 'list' 的数组
                targetArray = allArrays.find(a => a.key === 'list') || 
                            allArrays.reduce((max, current) => current.data.length > max.data.length ? current : max);
            } else {
                // 对于 list.xxx 类型的路径，优先查找常见的数组名称
                const priorityArrayNames = ['newslist', 'list', 'items', 'data'];
                
                // 先尝试找到匹配的优先数组名称
                for (const priorityName of priorityArrayNames) {
                    const found = allArrays.find(a => a.key === priorityName || a.path.endsWith('.' + priorityName));
                    if (found) {
                        targetArray = found;
                        break;
                    }
                }
                
                // 如果没找到匹配的，选择数据量最大的
                if (!targetArray) {
                    targetArray = allArrays.reduce((max, current) => current.data.length > max.data.length ? current : max);
                }
            }
            
            console.log(`🎯 选择的数组: ${targetArray.path}`);
            
            if (adaptedPath.startsWith('list')) {
                // 乌鸦： list.xxx -> targetArray.path.xxx
                adaptedPath = adaptedPath.replace(/^list/, targetArray.path);
            } else {
                // 乌鸦：处理 .list 替换，只替换最后一个 .list
                const lastListIndex = adaptedPath.lastIndexOf('.list');
                if (lastListIndex !== -1) {
                    const beforeList = adaptedPath.substring(0, lastListIndex);
                    const afterList = adaptedPath.substring(lastListIndex + 5); // 5 = '.list'.length
                    adaptedPath = `${beforeList}.${targetArray.key}${afterList}`;
                }
            }
            
            console.log(`🔄 list 路径适配: "${path}" → "${adaptedPath}"`);
        }
    }
    
    // 乌鸦：处理数组索引表达式 [i] -> 0, 1, 2...
    adaptedPath = adaptedPath.replace(/\[i\]/g, '0'); // 默认取第一个元素
    adaptedPath = adaptedPath.replace(/\[(\d+)\]/g, '$1'); // [0] -> 0
    
    // 乌鸦：执行路径解析
    console.log(`🚀 最终路径: "${adaptedPath}"`);
    const keys = adaptedPath.split('.');
    console.log(`🔑 路径分段:`, keys);
    let current = obj;
    
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        console.log(`📍 步骤 ${i + 1}: 访问键 "${key}", 当前值类型: ${Array.isArray(current) ? 'Array' : typeof current}`);
        
        if (current === null || current === undefined) {
            console.log(`❌ 路径中断: 在步骤 ${i + 1} 处值为 null/undefined`);
            return undefined;
        }
        
        // 处理数组索引
        if (Array.isArray(current) && /^\d+$/.test(key)) {
            const index = parseInt(key);
            console.log(`📊 数组索引访问: [${index}], 数组长度: ${current.length}`);
            current = current[index];
        } else {
            console.log(`🗝️ 属性访问: .${key}`);
            if (current[key] === undefined) {
                console.log(`❌ 属性 "${key}" 不存在，可用属性:`, Object.keys(current));
            }
            current = current[key];
        }
        
        console.log(`📍 步骤 ${i + 1} 结果:`, current);
    }
    
    console.log(`✅ 路径解析完成，结果:`, current);
    return current;
}

/**
 * 乌鸦：模板辅助函数
 */
const templateHelpers = {
    // 乌鸦：相等比较
    eq: (a, b) => a == b,
    
    // 乌鸦：严格相等比较
    eql: (a, b) => a === b,
    
    // 乌鸦：不相等比较
    ne: (a, b) => a != b,
    
    // 乌鸦：大于比较
    gt: (a, b) => a > b,
    
    // 乌鸦：小于比较
    lt: (a, b) => a < b,
    
    // 乌鸦：大于等于比较
    gte: (a, b) => a >= b,
    
    // 乌鸦：小于等于比较
    lte: (a, b) => a <= b,
    
    // 乌鸦：逻辑与
    and: (...args) => args.slice(0, -1).every(Boolean), // 排除最后一个参数（options）
    
    // 乌鸦：逻辑或
    or: (...args) => args.slice(0, -1).some(Boolean),   // 排除最后一个参数（options）
    
    // 乌鸦：逻辑非
    not: (value) => !value,
    
    // 乌鸦：长度检查
    length: (value) => Array.isArray(value) ? value.length : (value ? String(value).length : 0)
};

/**
 * 乌鸦：解析辅助函数调用
 * @param {string} expression - 表达式，如 "(eq code 200)"
 * @param {Object} context - 数据上下文
 * @returns {any} 解析结果
 */
function parseHelperFunction(expression, context) {
    // 去掉外层括号
    expression = expression.trim();
    if (expression.startsWith('(') && expression.endsWith(')')) {
        expression = expression.slice(1, -1).trim();
    }
    
    // 解析函数名和参数
    const parts = expression.split(/\s+/);
    const helperName = parts[0];
    const args = parts.slice(1);
    
    // 检查是否是已知的辅助函数
    if (!templateHelpers[helperName]) {
        return false;
    }
    
    // 解析参数值
    const resolvedArgs = args.map(arg => {
        // 字符串字面量
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
            return arg.slice(1, -1);
        }
        // 数字字面量
        if (/^\d+$/.test(arg)) {
            return parseInt(arg);
        }
        // 浮点数字面量
        if (/^\d+\.\d+$/.test(arg)) {
            return parseFloat(arg);
        }
        // 布尔字面量
        if (arg === 'true') return true;
        if (arg === 'false') return false;
        if (arg === 'null') return null;
        if (arg === 'undefined') return undefined;
        
        // 从上下文获取值
        return getNestedValue(context, arg);
    });
    
    // 调用辅助函数
    try {
        return templateHelpers[helperName](...resolvedArgs);
    } catch (error) {
        console.warn(`模板辅助函数 ${helperName} 执行失败:`, error);
        return false;
    }
}

/**
 * 乌鸦：处理条件渲染表达式
 * @param {string} condition - 条件表达式
 * @param {Object} context - 数据上下文
 * @returns {boolean} 条件结果
 */
function evaluateCondition(condition, context) {
    // 移除首尾空格
    condition = condition.trim();
    
    // 乌鸦：检查是否是辅助函数调用，如 (eq code 200)
    if (condition.startsWith('(') && condition.endsWith(')')) {
        const helperResult = parseHelperFunction(condition, context);
        if (helperResult !== false || condition.includes(' ')) {
            return helperResult;
        }
    }
    
    // 处理括号表达式，如 (data.result.list.0.type == 1)
    // 需要递归处理，但要注意避免无限循环
    const parenRegex = /\(([^()]+)\)/g;
    let match;
    while ((match = parenRegex.exec(condition)) !== null) {
        const [fullMatch, innerExpression] = match;
        const result = evaluateCondition(innerExpression, context);
        condition = condition.replace(fullMatch, result ? 'true' : 'false');
        // 重置正则表达式的lastIndex，因为字符串已被修改
        parenRegex.lastIndex = 0;
    }
    
    // 处理逻辑操作符 && 和 ||
    if (condition.includes('&&') || condition.includes('||')) {
        // 按照操作符优先级处理，先处理 &&
        const andParts = condition.split('&&');
        if (andParts.length > 1) {
            // 所有部分都为真时才返回真
            return andParts.every(part => evaluateCondition(part.trim(), context));
        }
        
        // 再处理 ||
        const orParts = condition.split('||');
        if (orParts.length > 1) {
            // 任一部分为真时就返回真
            return orParts.some(part => evaluateCondition(part.trim(), context));
        }
    }
    
    // 处理比较操作符
    const operators = {
        '==': (a, b) => a == b,
        '===': (a, b) => a === b,
        '!=': (a, b) => a != b,
        '!==': (a, b) => a !== b,
        '>': (a, b) => a > b,
        '<': (a, b) => a < b,
        '>=': (a, b) => a >= b,
        '<=': (a, b) => a <= b
    };
    
    // 查找操作符
    for (const [op, fn] of Object.entries(operators)) {
        // 使用lastIndexOf确保找到最后一个操作符，避免在复杂表达式中出错
        const opIndex = condition.lastIndexOf(op);
        if (opIndex > 0) {
            const left = condition.substring(0, opIndex).trim();
            const right = condition.substring(opIndex + op.length).trim();
            
            // 解析左侧值
            let leftValue;
            if (left.startsWith('"') && left.endsWith('"')) {
                leftValue = left.slice(1, -1); // 字符串字面量
            } else if (left.startsWith("'") && left.endsWith("'")) {
                leftValue = left.slice(1, -1); // 字符串字面量
            } else if (/^\d+$/.test(left)) {
                leftValue = parseInt(left); // 数字字面量
            } else {
                leftValue = getNestedValue(context, left);
            }
            
            // 解析右侧值
            let rightValue;
            if (right.startsWith('"') && right.endsWith('"')) {
                rightValue = right.slice(1, -1); // 字符串字面量
            } else if (right.startsWith("'") && right.endsWith("'")) {
                rightValue = right.slice(1, -1); // 字符串字面量
            } else if (/^\d+$/.test(right)) {
                rightValue = parseInt(right); // 数字字面量
            } else {
                rightValue = getNestedValue(context, right);
            }
            
            return fn(leftValue, rightValue);
        }
    }
    
    // 处理简单变量检查（检查是否存在且不为假值）
    const value = getNestedValue(context, condition);
    return value !== undefined && value !== null && value !== false && value !== '';
}

/**
 * 乌鸦：处理循环渲染表达式
 * @param {string} template - 循环模板
 * @param {string} collectionPath - 集合路径
 * @param {Object} context - 数据上下文
 * @returns {string} 渲染结果
 */
function renderLoop(template, collectionPath, context) {
    // 乌鸦：智能路径解析，自动适配不同的数据结构
    let collection = getNestedValue(context, collectionPath);
    
    // 乌鸦：如果没有找到指定路径的数据，尝试常见的路径
    if (!Array.isArray(collection)) {
        console.log(`🔍 路径 "${collectionPath}" 没有找到数组，尝试智能匹配...`);
        
        // 乌鸦：尝试常见的数组路径
        const tryPaths = [
            'result.list',
            'data.list', 
            'result.data',
            'data.result',
            'newslist',
            'list',
            'data',
            'result'
        ];
        
        for (const tryPath of tryPaths) {
            const tryCollection = getNestedValue(context, tryPath);
            if (Array.isArray(tryCollection) && tryCollection.length > 0) {
                console.log(`✅ 找到数组数据: ${tryPath}`);
                collection = tryCollection;
                break;
            }
        }
        
        if (!Array.isArray(collection)) {
            console.warn(`❌ 无法找到数组数据，collectionPath: ${collectionPath}`, context);
            return '';
        }
    }
    
    console.log(`📋 渲染循环，数组长度: ${collection.length}`);
    
    return collection.map((item, index) => {
        // 乌鸦：为每个项目创建数据上下文，将item的属性直接暴露到上下文中
        const itemContext = {
            ...context,    // 保留原有上下文
            ...item,       // 将item的所有属性直接暴露（如title, description等）
            item: item,    // 保留item引用
            index: index,
            first: index === 0,
            last: index === collection.length - 1
        };
        
        // 处理循环内的占位符
        return processTemplate(template, itemContext);
    }).join('');
}

/**
 * 乌鸦：处理模板中的数据占位符
 * @param {string} html - HTML模板
 * @param {Object} context - 数据上下文
 * @returns {string} 处理后的HTML
 */
function processTemplatePlaceholders(html, context) {
    // 匹配 {{...}} 格式的占位符
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    
    return html.replace(placeholderRegex, (match, expression) => {
        // 去除前后空格
        expression = expression.trim();
        
        // 特殊处理：如果表达式是纯文本内容（如循环中的{{content}}），直接返回
        if (expression === 'content' && context.content) {
            return escapeHtml(String(context.content));
        }
        
        // 处理简单的数据访问
        const value = getNestedValue(context, expression);
        return value !== undefined ? escapeHtml(String(value)) : '';
    });
}

/**
 * 乌鸦：处理条件块
 * @param {string} html - HTML模板
 * @param {Object} context - 数据上下文
 * @returns {string} 处理后的HTML
 */
function processConditionals(html, context) {
    let result = html;
    
    // 乌鸦：持续处理直到没有更多条件语句
    while (result.includes('{{#if')) {
        // 查找最内层的if语句（不包含嵌套if的）
        const regex = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
        let hasMatches = false;
        
        result = result.replace(regex, (fullMatch, condition, content) => {
            hasMatches = true;
            
            // 乌鸦：检查是否包含嵌套的if，如果有则跳过此次处理
            if (content.includes('{{#if')) {
                return fullMatch; // 保持不变，留给下次循环处理
            }
            
            // 乌鸦：处理else分支
            let ifContent = content;
            let elseContent = '';
            
            const elseIndex = content.indexOf('{{else}}');
            if (elseIndex !== -1) {
                ifContent = content.substring(0, elseIndex);
                elseContent = content.substring(elseIndex + 8); // '{{else}}'.length = 8
            }
            
            // 乌鸦：评估条件
            const conditionResult = evaluateCondition(condition, context);
            
            return conditionResult ? ifContent : elseContent;
        });
        
        // 如果没有找到匹配项，退出循环避免无限循环
        if (!hasMatches) {
            break;
        }
    }
    
    return result;
}

/**
 * 乌鸦：处理循环块
 * @param {string} html - HTML模板
 * @param {Object} context - 数据上下文
 * @returns {string} 处理后的HTML
 */
function processLoops(html, context) {
    // 匹配 {{#each collection}}...{{/each}} 格式，支持嵌套
    // 为了正确处理嵌套，我们需要从最内层开始处理
    let result = html;
    
    // 持续处理直到没有更多循环语句
    while (result.includes('{{#each')) {
        // 使用非贪婪匹配查找最内层的each语句（没有嵌套其他each语句的）
        const innerLoopRegex = /\{\{#each\s+([^}]+)\}\}((?!\{\{#each)[\s\S]*?)\{\{\/each\}\}/g;
        let hasReplaced = false;
        
        // 创建新的结果字符串
        let newResult = result.replace(innerLoopRegex, (fullMatch, collectionPath, content) => {
            hasReplaced = true;
            return renderLoop(content, collectionPath, context);
        });
        
        // 如果没有替换发生，说明可能有无法解析的嵌套结构
        if (!hasReplaced) {
            break;
        }
        
        result = newResult;
    }
    
    return result;
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
        const regex = new RegExp(`\\{\\{\\s*${expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
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
 * 乌鸦：主模板处理函数
 * @param {string} template - 模板字符串
 * @param {Object} context - 数据上下文
 * @returns {string} 渲染后的HTML
 */
export function processTemplate(template, context) {
    // 1. 处理动态表达式
    let result = processDynamicExpressions(template);
    
    // 2. 处理循环（从最内层开始）
    result = processLoops(result, context);
    
    // 3. 处理条件渲染（从最内层开始）
    result = processConditionals(result, context);
    
    // 4. 处理数据占位符
    result = processTemplatePlaceholders(result, context);
    
    return result;
}

/**
 * 乌鸦：智能预处理API数据，提供通用的数据访问接口
 * @param {Object} data - 原始API数据
 * @param {Object} tool - 工具配置
 * @param {Object} parameters - 工具调用参数
 * @returns {Object} 处理后的数据
 */
export function preprocessApiData(data, tool, parameters = {}) {
    // 乌鸦：分析数据结构
    const structure = analyzeDataStructure(data);
    
    // 乌鸦：创建基础处理结果
    const processed = {
        // 保留原始数据结构
        data: data,
        
        // 工具信息
        tool: {
            id: tool.id,
            name: tool.name,
            parameters: parameters
        },
        
        // 元数据
        meta: {
            timestamp: new Date().toLocaleString(),
            status: detectDataStatus(data)
        }
    };
    
    // 乌鸦：合并原始数据到顶层，方便直接访问
    Object.assign(processed, data);
    
    // 乌鸦：创建通用数据访问接口
    createUniversalDataAccess(processed, structure);
    
    return processed;
}

/**
 * 乌鸦：检测数据状态 - 严格按照统一错误处理规范
 * @param {Object} data - 数据对象
 * @returns {string} 状态字符串
 */
function detectDataStatus(data) {
    // 乌鸦：严格的成功条件 - 仅当code=200或status=100才为成功
    if (data.code === 200 || data.code === '200') {
        return 'success';
    }
    if (data.status === 100) {
        return 'success';
    }
    
    // 乌鸦：其他情况都为失败，包括：
    // 1. code不等于200的所有情况（如code=230）
    // 2. status不等于100的所有情况
    // 3. 显式的错误标识
    if (data.code && data.code !== 200 && data.code !== '200') {
        return 'error';
    }
    if (data.status && data.status !== 100) {
        return 'error';
    }
    if (data.error || data.success === false) {
        return 'error';
    }
    
    // 乌鸦：如果没有明确的状态标识，默认为成功（兼容旧数据）
    if (!data.hasOwnProperty('code') && !data.hasOwnProperty('status') && !data.hasOwnProperty('error')) {
        return 'success';
    }
    
    // 乌鸦：其他未明确情况，默认为错误
    return 'error';
}

/**
 * 乌鸦：创建通用数据访问接口
 * @param {Object} processed - 处理中的数据对象
 * @param {Object} structure - 数据结构信息
 */
function createUniversalDataAccess(processed, structure) {
    // 乌鸦：收集所有数组
    const allArrays = [...structure.arrays];
    structure.containers.forEach(container => {
        allArrays.push(...container.arrays);
    });
    
    // 乌鸦：调试信息
    console.log('🔍 数据结构分析:', {
        containers: structure.containers,
        arrays: structure.arrays,
        allArrays: allArrays
    });
    
    if (allArrays.length > 0) {
        // 乌鸦：按数据量排序，选择主要数据数组
        allArrays.sort((a, b) => b.data.length - a.data.length);
        const mainArray = allArrays[0];
        
        console.log('🎯 主数组选择:', mainArray);
        
        // 乌鸦：创建通用访问接口
        processed.items = mainArray.data;  // 主要数据列表
        processed.list = mainArray.data;   // 通用列表别名
        
        // 乌鸦：为所有数组创建带名称的访问接口
        allArrays.forEach((arr, index) => {
            const name = arr.key;
            processed[`${name}_list`] = arr.data;
            
            // 乌鸦：如果数组名是 newslist，也创建 news 别名
            if (name === 'newslist') {
                processed.news = arr.data;
            }
            // 乌鸦：如果数组名是 list，也创建直接访问
            if (name === 'list') {
                processed.listData = arr.data;
            }
        });
        
        // 乌鸦：添加数组元信息
        processed.meta.totalItems = mainArray.data.length;
        processed.meta.hasData = mainArray.data.length > 0;
        
        console.log('✅ 创建的通用访问接口:', {
            hasItems: !!processed.items,
            hasList: !!processed.list,
            itemsLength: processed.items ? processed.items.length : 0,
            totalItems: processed.meta.totalItems
        });
    }
    
    // 乌鸦：创建智能容器访问 - 无论数据在 result/data 还是顶层
    if (structure.containers.length > 0) {
        const mainContainer = structure.containers[0];
        // 乌鸦：为主要容器创建多个别名，支持不同的命名习惯
        processed.result = mainContainer.data;  // 创建 result 别名
        processed.data = mainContainer.data;    // 创建 data 别名
        processed.response = mainContainer.data; // 创建 response 别名
        
        console.log('✅ 创建的容器别名:', {
            containerKey: mainContainer.key,
            hasResult: !!processed.result,
            hasData: !!processed.data
        });
    }
}