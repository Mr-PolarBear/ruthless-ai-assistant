/**
 * @file import-conflict-modal.js
 * @description 专职负责配置导入时的多项目/多类型冲突批量决策面板交互。
 * 集中展示所有发生 ID 冲突的条目（全局正则、API端点、角色设定、备忘录等），
 * 提供一键【全部覆盖】、【全部都保留】、【全部跳过】、逐项微调以及【👁️ 预览对比】功能。
 */

import { escapeHtml } from '../utils.js?v=temp';
import { initGlobalFloatingTooltip } from '../services/floating-tooltip.js?v=temp';

// 确保通用视口级浮层管理器已激活
initGlobalFloatingTooltip();
/**
 * 警告差异提示 SVG 矢量图标
 */
const ALERT_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 3px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

/**
 * 差异标签徽章渲染辅助函数（统一嵌入 SVG 图标与安全转义）
 * @param {string} text - 差异说明文本
 * @returns {string} 徽章 HTML
 */
const renderDiffBadge = (text) => '<span class="diff-changed-badge">' + ALERT_ICON_SVG + escapeHtml(text) + '</span>';

/**
 * 分类元信息映射表（类型名称与徽章样式）
 */
const CATEGORY_META = {
    regex: {
        title: '自定义全局正则',
        badgeClass: 'conflict-badge-regex',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>'
    },
    api: {
        title: 'API 端点',
        badgeClass: 'conflict-badge-api',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>'
    },
    persona: {
        title: '角色预设',
        badgeClass: 'conflict-badge-persona',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>'
    },
    worldBook: {
        title: '世界书 / 备忘录',
        badgeClass: 'conflict-badge-wb',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>'
    }
};

/**
 * 提取两个条目之间的关键差异标签
 */
function getDiffSummaryTags(item, otherItem, category) {
    if (!item || !otherItem) return [];
    const tags = [];
    if (category === 'worldBook') {
        if (String(item.name || '').trim() !== String(otherItem.name || '').trim()) tags.push('名称不同');
        if (Boolean(item.enabled) !== Boolean(otherItem.enabled)) tags.push('生效状态不同');
        if (String(item.position || '') !== String(otherItem.position || '')) tags.push('位置不同');
        if (Number(item.depth || 0) !== Number(otherItem.depth || 0)) tags.push('深度不同');
        if (String(item.role || '') !== String(otherItem.role || '')) tags.push('角色不同');
        if (JSON.stringify((item.keys || []).sort()) !== JSON.stringify((otherItem.keys || []).sort())) tags.push('关键词不同');
        if (JSON.stringify((item.tags || []).sort()) !== JSON.stringify((otherItem.tags || []).sort())) tags.push('标签不同');
        if (String(item.content || '').trim() !== String(otherItem.content || '').trim()) tags.push('正文内容不同');
    } else if (category === 'regex') {
        if (String(item.name || '').trim() !== String(otherItem.name || '').trim()) tags.push('名称不同');
        const e1 = item.enabled !== false && !item.disabled;
        const e2 = otherItem.enabled !== false && !otherItem.disabled;
        if (e1 !== e2) tags.push('开关状态不同');
        if (item.find !== otherItem.find) tags.push('查找正则不同');
        if (item.replace !== otherItem.replace) tags.push('替换内容不同');
        if (JSON.stringify((item.scopes || []).sort()) !== JSON.stringify((otherItem.scopes || []).sort())) tags.push('作用域不同');
        if ((item.stage || 'post-markdown') !== (otherItem.stage || 'post-markdown')) tags.push('执行阶段不同');
        if (Number(item.sort || 0) !== Number(otherItem.sort || 0)) tags.push('排序不同');
        if (Number(item.minFloor || 0) !== Number(otherItem.minFloor || 0) || Number(item.maxFloor || 0) !== Number(otherItem.maxFloor || 0)) tags.push('生效楼层不同');
    } else if (category === 'api') {
        if (item.url !== otherItem.url) tags.push('地址不同');
        if (item.model !== otherItem.model) tags.push('模型不同');
    } else if (category === 'persona') {
        if (String(item.prompt || '').trim() !== String(otherItem.prompt || '').trim()) tags.push('设定前缀不同');
    }
    return tags;
}

/**
 * 格式化输出项目字段摘要供对比预览（支持双向差分高亮与全量字段展示）
 * @param {object} item - 当前侧项目对象
 * @param {string} category - 项目分类
 * @param {object} [otherItem=null] - 对照侧项目对象，用于高亮差异
 * @returns {string} HTML 字符串
 */
function formatItemSummary(item, category, otherItem = null) {
    if (!item) return '<div class="diff-field-row" style="color: var(--text-tertiary);">（无内容）</div>';
    let html = '';

    const hasDiff = (v1, v2) => {
        if (!otherItem) return false;
        return String(v1 ?? '').trim() !== String(v2 ?? '').trim();
    };

    const hasArrayDiff = (arr1, arr2) => {
        if (!otherItem) return false;
        const a1 = Array.isArray(arr1) ? arr1.map(String).map(s => s.trim()).filter(Boolean).sort() : [];
        const a2 = Array.isArray(arr2) ? arr2.map(String).map(s => s.trim()).filter(Boolean).sort() : [];
        if (a1.length !== a2.length) return true;
        return a1.some((v, idx) => v !== a2[idx]);
    };

    if (category === 'worldBook') {
        // 1. 条目名称
        const nameDiff = hasDiff(item.name, otherItem?.name);
        html += `<div class="diff-field-row ${nameDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">条目名称:</span> 
            <strong>${escapeHtml(item.name || '未命名')}</strong>
            ${nameDiff ? renderDiffBadge('名称不同') : ''}
        </div>`;

        // 2. 生效开关状态
        const enabledVal = Boolean(item.enabled);
        const otherEnabledVal = otherItem ? Boolean(otherItem.enabled) : enabledVal;
        const enabledDiff = enabledVal !== otherEnabledVal;
        html += `<div class="diff-field-row ${enabledDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">生效状态:</span> 
            <span class="${enabledVal ? 'diff-badge-enabled' : 'diff-badge-disabled'}">${enabledVal ? '已启用' : '已禁用'}</span>
            ${enabledDiff ? renderDiffBadge('状态不同') : ''}
        </div>`;

        // 3. 注入位置
        const posDescMap = {
            chat_start: '历史前 (chat_start)',
            chat_end: '历史后 (chat_end)',
            append_to_user: '跟随发言 (append_to_user)',
            before_system: '顶部 (before_system)'
        };
        const posText = posDescMap[item.position] || (item.position || '顶部 (before_system)');
        const otherPosText = otherItem ? (posDescMap[otherItem.position] || (otherItem.position || '顶部 (before_system)')) : posText;
        const posDiff = posText !== otherPosText;
        html += `<div class="diff-field-row ${posDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">注入位置:</span> 
            <code>${escapeHtml(posText)}</code>
            ${posDiff ? renderDiffBadge('位置不同') : ''}
        </div>`;

        // 4. 挂载深度
        const depthVal = Number(item.depth ?? 10);
        const otherDepthVal = otherItem ? Number(otherItem.depth ?? 10) : depthVal;
        const depthDiff = depthVal !== otherDepthVal;
        html += `<div class="diff-field-row ${depthDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">挂载深度:</span> 
            <code>深: ${depthVal}</code>
            ${depthDiff ? renderDiffBadge('深度不同') : ''}
        </div>`;

        // 5. 生效角色
        const roleDescMap = {
            all: '所有人 (all)',
            user: '仅用户 (user)',
            assistant: '仅AI (assistant)',
            system: '仅系统 (system)'
        };
        const roleText = roleDescMap[item.role] || (item.role || '所有人 (all)');
        const otherRoleText = otherItem ? (roleDescMap[otherItem.role] || (otherItem.role || '所有人 (all)')) : roleText;
        const roleDiff = roleText !== otherRoleText;
        html += `<div class="diff-field-row ${roleDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">生效角色:</span> 
            <code>${escapeHtml(roleText)}</code>
            ${roleDiff ? renderDiffBadge('角色不同') : ''}
        </div>`;

        // 6. 触发关键词
        const keysArr = Array.isArray(item.keys) ? item.keys : (item.keys ? String(item.keys).split(',') : []);
        const keysText = keysArr.length > 0 ? keysArr.join(', ') : '（无触发词）';
        const otherKeysArr = otherItem ? (Array.isArray(otherItem.keys) ? otherItem.keys : (otherItem.keys ? String(otherItem.keys).split(',') : [])) : keysArr;
        const keysDiff = hasArrayDiff(keysArr, otherKeysArr);
        html += `<div class="diff-field-row ${keysDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">触发关键词:</span> 
            <code>${escapeHtml(keysText)}</code>
            ${keysDiff ? renderDiffBadge('触发词不同') : ''}
        </div>`;

        // 7. 分类标签
        const tagsArr = Array.isArray(item.tags) ? item.tags : (item.tags ? String(item.tags).split(',') : []);
        const tagsText = tagsArr.length > 0 ? tagsArr.join(', ') : '（无标签）';
        const otherTagsArr = otherItem ? (Array.isArray(otherItem.tags) ? otherItem.tags : (otherItem.tags ? String(otherItem.tags).split(',') : [])) : tagsArr;
        const tagsDiff = hasArrayDiff(tagsArr, otherTagsArr);
        html += `<div class="diff-field-row ${tagsDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">分类标签:</span> 
            <code>${escapeHtml(tagsText)}</code>
            ${tagsDiff ? renderDiffBadge('标签不同') : ''}
        </div>`;

        // 8. 完整条目正文（绝不截断！配滚动条与完整内容容器）
        const contentStr = String(item.content || '');
        const otherContentStr = otherItem ? String(otherItem.content || '') : contentStr;
        const contentDiff = contentStr.trim() !== otherContentStr.trim();
        const charCount = contentStr.length;
        html += `<div class="diff-field-row diff-content-row ${contentDiff ? 'diff-field-changed' : ''}" style="margin-top: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="diff-field-label" style="font-weight:600;">条目完整正文 (${charCount} 字):</span>
                ${contentDiff ? renderDiffBadge('正文存在实质差异') : '<span style="color:var(--text-tertiary);font-size:11px;">(正文一致)</span>'}
            </div>
            <div class="diff-content-scrollbox ${contentDiff ? 'diff-content-box-changed' : ''}">
                <pre class="diff-content-pre">${escapeHtml(contentStr || '（正文内容为空）')}</pre>
            </div>
        </div>`;
    } else if (category === 'regex') {
        // 1. 规则名称
        const nameDiff = hasDiff(item.name, otherItem?.name);
        html += `<div class="diff-field-row ${nameDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">规则名称:</span> 
            <strong>${escapeHtml(item.name || '未命名规则')}</strong>
            ${nameDiff ? renderDiffBadge('名称不同') : ''}
        </div>`;

        // 2. 开关状态
        const isEnabled = item.enabled !== false && !item.disabled;
        const otherEnabled = otherItem ? (otherItem.enabled !== false && !otherItem.disabled) : isEnabled;
        const enabledDiff = isEnabled !== otherEnabled;
        html += `<div class="diff-field-row ${enabledDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">生效状态:</span> 
            <span class="${isEnabled ? 'diff-badge-enabled' : 'diff-badge-disabled'}">${isEnabled ? '已启用' : '已禁用'}</span>
            ${enabledDiff ? renderDiffBadge('状态不同') : ''}
        </div>`;

        // 3. 归属范围
        const isSessionScope = item.scope === 'session';
        const otherSessionScope = otherItem ? (otherItem.scope === 'session') : isSessionScope;
        const scopeDiff = isSessionScope !== otherSessionScope;
        html += `<div class="diff-field-row ${scopeDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">归属范围:</span> 
            <code>${isSessionScope ? '会话专属规则' : '全局通用规则'}</code>
            ${scopeDiff ? renderDiffBadge('归属不同') : ''}
        </div>`;

        // 4. 查找内容 (正则表达式)
        const findDiff = hasDiff(item.find, otherItem?.find);
        html += `<div class="diff-field-row ${findDiff ? 'diff-field-changed' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                <span class="diff-field-label" style="font-weight:600;">查找 (正则表达式):</span>
                ${findDiff ? renderDiffBadge('正则不同') : ''}
            </div>
            <div class="diff-content-scrollbox ${findDiff ? 'diff-content-box-changed' : ''}" style="max-height: 90px;">
                <pre class="diff-content-pre"><code>${escapeHtml(item.find || '（空）')}</code></pre>
            </div>
        </div>`;

        // 5. 替换内容
        const replaceDiff = hasDiff(item.replace, otherItem?.replace);
        html += `<div class="diff-field-row ${replaceDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">替换内容:</span> 
            <code>${escapeHtml(item.replace || '(留空表示删除)')}</code>
            ${replaceDiff ? renderDiffBadge('替换内容不同') : ''}
        </div>`;

        // 6. 作用域
        const scopeLabelMap = {
            'request-user': '请求时-用户',
            'request-assistant': '请求时-AI',
            'display-user': '展示时-用户',
            'display-assistant': '展示时-AI'
        };
        const scopesArr = Array.isArray(item.scopes) ? item.scopes : [];
        const scopesText = scopesArr.length > 0 ? scopesArr.map(s => scopeLabelMap[s] || s).join(', ') : '全局 (默认)';
        const otherScopesArr = otherItem ? (Array.isArray(otherItem.scopes) ? otherItem.scopes : []) : scopesArr;
        const scopesDiff = hasArrayDiff(scopesArr, otherScopesArr);
        html += `<div class="diff-field-row ${scopesDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">生效作用域:</span> 
            <code>${escapeHtml(scopesText)}</code>
            ${scopesDiff ? renderDiffBadge('作用域不同') : ''}
        </div>`;

        // 7. 执行阶段与排序
        const stageText = (item.stage === 'pre-markdown') ? '渲染前 (pre-markdown)' : '渲染后 (post-markdown)';
        const otherStageText = otherItem ? ((otherItem.stage === 'pre-markdown') ? '渲染前 (pre-markdown)' : '渲染后 (post-markdown)') : stageText;
        const stageDiff = stageText !== otherStageText;
        html += `<div class="diff-field-row ${stageDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">执行阶段:</span> 
            <code>${escapeHtml(stageText)}</code>
            ${stageDiff ? renderDiffBadge('阶段不同') : ''}
        </div>`;

        const sortVal = Number(item.sort || 0);
        const otherSortVal = otherItem ? Number(otherItem.sort || 0) : sortVal;
        const sortDiff = sortVal !== otherSortVal;
        html += `<div class="diff-field-row ${sortDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">排序序号:</span> 
            <code>${sortVal} (小号优先)</code>
            ${sortDiff ? renderDiffBadge('排序不同') : ''}
        </div>`;

        // 8. 生效楼层范围
        const minFloor = Number(item.minFloor || 0);
        const maxFloor = Number(item.maxFloor || 0);
        const otherMinFloor = otherItem ? Number(otherItem.minFloor || 0) : minFloor;
        const otherMaxFloor = otherItem ? Number(otherItem.maxFloor || 0) : maxFloor;
        const floorDiff = minFloor !== otherMinFloor || maxFloor !== otherMaxFloor;
        const floorText = (minFloor > 0 || maxFloor > 0) ? `最小: ${minFloor} 楼, 最大: ${maxFloor || '不限'} 楼` : '全楼层生效';
        html += `<div class="diff-field-row ${floorDiff ? 'diff-field-changed' : ''}">
            <span class="diff-field-label">生效楼层:</span> 
            <code>${escapeHtml(floorText)}</code>
            ${floorDiff ? renderDiffBadge('楼层范围不同') : ''}
        </div>`;
    } else if (category === 'api') {
        const urlDiff = hasDiff(item.url, otherItem?.url);
        const modelDiff = hasDiff(item.model, otherItem?.model);
        html += `<div class="diff-field-row"><span class="diff-field-label">类型:</span> ${escapeHtml(item.apiType || item.type || 'openai')}</div>`;
        html += `<div class="diff-field-row ${urlDiff ? 'diff-field-changed' : ''}"><span class="diff-field-label">接口 URL:</span> <code>${escapeHtml(item.url || '')}</code> ${urlDiff ? renderDiffBadge('不同') : ''}</div>`;
        html += `<div class="diff-field-row ${modelDiff ? 'diff-field-changed' : ''}"><span class="diff-field-label">默认模型:</span> <code>${escapeHtml(item.model || '')}</code> ${modelDiff ? renderDiffBadge('不同') : ''}</div>`;
    } else if (category === 'persona') {
        const promptPreview = String(item.prompt || '');
        const promptDiff = hasDiff(promptPreview, otherItem?.prompt);
        html += `<div class="diff-field-row ${promptDiff ? 'diff-field-changed' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="diff-field-label" style="font-weight:600;">设定前缀 (${promptPreview.length} 字):</span>
                ${promptDiff ? renderDiffBadge('前缀不同') : ''}
            </div>
            <div class="diff-content-scrollbox ${promptDiff ? 'diff-content-box-changed' : ''}">
                <pre class="diff-content-pre">${escapeHtml(promptPreview || '（无提示词）')}</pre>
            </div>
        </div>`;
    }
    return html;
}

/**
 * 弹出多项目冲突批量决策弹窗
 * @param {Array<{ key: string, category: 'regex'|'api'|'persona'|'worldBook', name: string, id: string, item: object, target: object, prefix: string }>} conflictList - 冲突项列表
 * @returns {Promise<Object<string, 'overwrite'|'keep_both'|'skip'>|null>} 返回每个项目的决策映射表，若取消则返回 null
 */
export function showBatchConflictResolutionDialog(conflictList) {
    if (!Array.isArray(conflictList) || conflictList.length === 0) {
        return Promise.resolve({});
    }

    return new Promise((resolve) => {
        const modal = document.getElementById('import-conflict-modal');
        const container = document.getElementById('import-conflict-items-container');
        const countBadge = document.getElementById('import-conflict-count-badge');
        const batchOverwriteBtn = document.getElementById('import-conflict-batch-overwrite');
        const batchKeepBtn = document.getElementById('import-conflict-batch-keep');
        const batchSkipBtn = document.getElementById('import-conflict-batch-skip');
        const confirmBtn = document.getElementById('import-conflict-confirm-btn');
        const cancelBtn = document.getElementById('import-conflict-cancel-btn');
        const closeBtn = document.getElementById('import-conflict-close-btn');

        if (!modal || !container) {
            // 降级兜底：使用原生 confirm 询问是否全部保留
            const keepAll = confirm(`【导入冲突】检测到 ${conflictList.length} 个项目 ID 重复。\n点击【确定】全部保留并重命名，点击【取消】全部跳过。`);
            const fallbackDecisions = {};
            conflictList.forEach(c => {
                fallbackDecisions[c.key] = keepAll ? 'keep_both' : 'skip';
            });
            return resolve(fallbackDecisions);
        }

        if (countBadge) {
            countBadge.textContent = `共 ${conflictList.length} 项冲突`;
        }

        // 渲染冲突列表项
        container.innerHTML = '';
        conflictList.forEach((conflict, index) => {
            const meta = CATEGORY_META[conflict.category] || { title: '配置项', badgeClass: '', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' };
            const existingItem = (conflict.target && conflict.target[conflict.id]) || null;
            const incomingItem = conflict.item || null;

            const card = document.createElement('div');
            card.className = 'import-conflict-item-card';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'stretch';
            card.style.gap = '8px';

            const diffTags = getDiffSummaryTags(existingItem, incomingItem, conflict.category);
            const diffTagsHtml = diffTags.length > 0 
                ? diffTags.map(t => `<span class="diff-summary-tag">${ALERT_ICON_SVG}${escapeHtml(t)}</span>`).join('') 
                : '<span class="diff-summary-tag" style="background:rgba(59,130,246,0.1);color:#3b82f6;">无实质差异</span>';

            card.innerHTML = `
                <div class="conflict-item-main-row">
                    <div class="conflict-item-info">
                        <div class="conflict-item-title-row" style="flex-wrap: wrap;">
                            <span class="conflict-badge ${meta.badgeClass}">${meta.icon} ${meta.title}</span>
                            <strong class="conflict-item-name" title="${escapeHtml(conflict.name || '未命名')}">${escapeHtml(conflict.name || '未命名')}</strong>
                            <div class="diff-summary-tags-container" style="display:inline-flex;gap:4px;flex-wrap:wrap;">
                                ${diffTagsHtml}
                            </div>
                        </div>
                        <div class="conflict-item-id">ID: <code>${escapeHtml(conflict.id || conflict.key)}</code></div>
                    </div>
                    <div class="conflict-item-actions">
                        <button type="button" class="conflict-item-preview-btn active" data-target="diff_${index}">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><span>详细对比</span>
                        </button>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="overwrite" data-key="${escapeHtml(conflict.key)}">
                            <span>覆盖</span>
                        </label>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="keep_both" data-key="${escapeHtml(conflict.key)}" checked>
                            <span>都保留</span><span class="conflict-help-tooltip" onclick="event.stopPropagation();" data-tooltip="【都保留】策略说明：&#10;• 本地现有条目保持原样，绝不覆盖；&#10;• 待导入条目将新建为独立的「同步副本」（名称自动追加 (同步副本)）；&#10;• 新导入的会话将自动关联至新副本，两者互不干扰互不污染。" title="【都保留】策略说明：保留本地原条目，为待导入版本创建独立同步副本并绑定新会话">!</span>
                        </label>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="skip" data-key="${escapeHtml(conflict.key)}">
                            <span>跳过</span>
                        </label>
                    </div>
                </div>
                <!-- 差异对比折叠面板 (默认展开，方便用户直观查看不一致点) -->
                <div id="diff_${index}" class="conflict-diff-panel open">
                    <div class="diff-column diff-column-existing">
                        <div class="diff-column-header"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>本地现有版本</div>
                        <div class="diff-column-body">${formatItemSummary(existingItem, conflict.category, incomingItem)}</div>
                    </div>
                    <div class="diff-column diff-column-incoming">
                        <div class="diff-column-header"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>待导入版本</div>
                        <div class="diff-column-body">${formatItemSummary(incomingItem, conflict.category, existingItem)}</div>
                    </div>
                </div>
            `;

            // 绑定单个预览对比展开/折叠事件
            const previewBtn = card.querySelector('.conflict-item-preview-btn');
            const diffPanel = card.querySelector(`#diff_${index}`);
            if (previewBtn && diffPanel) {
                previewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    diffPanel.classList.toggle('open');
                    previewBtn.classList.toggle('active');
                });
            }

            container.appendChild(card);
        });

        // 快捷批量切换函数
        const setAllDecisions = (actionValue) => {
            conflictList.forEach((_, index) => {
                const radio = container.querySelector(`input[name="conflict_decision_${index}"][value="${actionValue}"]`);
                if (radio) radio.checked = true;
            });
        };

        const handleBatchOverwrite = () => setAllDecisions('overwrite');
        const handleBatchKeep = () => setAllDecisions('keep_both');
        const handleBatchSkip = () => setAllDecisions('skip');

        const cleanup = () => {
            modal.classList.remove('visible');
            modal.style.display = 'none';
            if (batchOverwriteBtn) batchOverwriteBtn.removeEventListener('click', handleBatchOverwrite);
            if (batchKeepBtn) batchKeepBtn.removeEventListener('click', handleBatchKeep);
            if (batchSkipBtn) batchSkipBtn.removeEventListener('click', handleBatchSkip);
            if (confirmBtn) confirmBtn.removeEventListener('click', handleConfirm);
            if (cancelBtn) cancelBtn.removeEventListener('click', handleCancel);
            if (closeBtn) closeBtn.removeEventListener('click', handleCancel);
        };

        const handleConfirm = () => {
            const decisions = {};
            conflictList.forEach((conflict, index) => {
                const checkedRadio = container.querySelector(`input[name="conflict_decision_${index}"]:checked`);
                decisions[conflict.key] = checkedRadio ? checkedRadio.value : 'keep_both';
            });
            cleanup();
            resolve(decisions);
        };

        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        if (batchOverwriteBtn) batchOverwriteBtn.addEventListener('click', handleBatchOverwrite);
        if (batchKeepBtn) batchKeepBtn.addEventListener('click', handleBatchKeep);
        if (batchSkipBtn) batchSkipBtn.addEventListener('click', handleBatchSkip);
        if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);
        if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
        if (closeBtn) closeBtn.addEventListener('click', handleCancel);

        modal.style.display = 'flex';
        modal.classList.add('visible');
    });
}
