/**
 * @file import-conflict-modal.js
 * @description 专职负责配置导入时的多项目/多类型冲突批量决策面板交互。
 * 集中展示所有发生 ID 冲突的条目（全局正则、API端点、角色设定、备忘录等），
 * 提供一键【全部覆盖】、【全部都保留】、【全部跳过】、逐项微调以及【👁️ 预览对比】功能。
 */

import { escapeHtml } from '../utils.js?v=260823';

/**
 * 分类元信息映射表（类型名称与徽章样式）
 */
const CATEGORY_META = {
    regex: {
        title: '自定义全局正则',
        badgeClass: 'conflict-badge-regex',
        icon: '⚡'
    },
    api: {
        title: 'API 端点',
        badgeClass: 'conflict-badge-api',
        icon: '🌐'
    },
    persona: {
        title: '角色预设',
        badgeClass: 'conflict-badge-persona',
        icon: '🎭'
    },
    worldBook: {
        title: '世界书 / 备忘录',
        badgeClass: 'conflict-badge-wb',
        icon: '📖'
    }
};

/**
 * 格式化输出项目字段摘要供对比预览
 * @param {object} item - 项目对象
 * @param {string} category - 项目分类
 * @returns {string} HTML 字符串
 */
function formatItemSummary(item, category) {
    if (!item) return '<div class="diff-field-row" style="color: var(--text-tertiary);">（无内容）</div>';
    let html = '';
    html += `<div class="diff-field-row"><span class="diff-field-label">名称:</span> <strong>${escapeHtml(item.name || '未命名')}</strong></div>`;
    if (category === 'regex') {
        html += `<div class="diff-field-row"><span class="diff-field-label">查找:</span> <code>${escapeHtml(item.find || '')}</code></div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">替换:</span> <code>${escapeHtml(item.replace || '(留空删除)')}</code></div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">作用域:</span> ${(item.scopes || []).join(', ') || '全局'}</div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">阶段:</span> ${item.stage || 'post-markdown'} | <span class="diff-field-label">排序:</span> ${item.sort || 0}</div>`;
        if (item.minFloor || item.maxFloor) {
            html += `<div class="diff-field-row"><span class="diff-field-label">生效楼层:</span> 最小:${item.minFloor || 0}, 最大:${item.maxFloor || 0}</div>`;
        }
    } else if (category === 'api') {
        html += `<div class="diff-field-row"><span class="diff-field-label">类型:</span> ${escapeHtml(item.apiType || item.type || 'openai')}</div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">URL:</span> <code>${escapeHtml(item.url || '')}</code></div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">模型:</span> <code>${escapeHtml(item.model || '')}</code></div>`;
    } else if (category === 'persona') {
        const promptPreview = (item.prompt || '').trim();
        html += `<div class="diff-field-row"><span class="diff-field-label">设定前缀:</span> <code>${escapeHtml(promptPreview.slice(0, 80))}${promptPreview.length > 80 ? '...' : ''}</code></div>`;
    } else if (category === 'worldBook') {
        const keysPreview = Array.isArray(item.keys) ? item.keys.join(', ') : (item.keys || '');
        const contentPreview = (item.content || '').trim();
        html += `<div class="diff-field-row"><span class="diff-field-label">触发词:</span> <code>${escapeHtml(keysPreview)}</code></div>`;
        html += `<div class="diff-field-row"><span class="diff-field-label">条目内容:</span> <code>${escapeHtml(contentPreview.slice(0, 80))}${contentPreview.length > 80 ? '...' : ''}</code></div>`;
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
            const meta = CATEGORY_META[conflict.category] || { title: '配置项', badgeClass: '', icon: '📄' };
            const existingItem = (conflict.target && conflict.target[conflict.id]) || null;
            const incomingItem = conflict.item || null;

            const card = document.createElement('div');
            card.className = 'import-conflict-item-card';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'stretch';
            card.style.gap = '8px';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <div class="conflict-item-info">
                        <div class="conflict-item-title-row">
                            <span class="conflict-badge ${meta.badgeClass}">${meta.icon} ${meta.title}</span>
                            <strong class="conflict-item-name" title="${escapeHtml(conflict.name || '未命名')}">${escapeHtml(conflict.name || '未命名')}</strong>
                        </div>
                        <div class="conflict-item-id">ID: <code>${escapeHtml(conflict.id || conflict.key)}</code></div>
                    </div>
                    <div class="conflict-item-actions">
                        <button type="button" class="conflict-item-preview-btn" data-target="diff_${index}">
                            <span>👁️ 对比</span>
                        </button>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="overwrite" data-key="${escapeHtml(conflict.key)}">
                            <span>覆盖</span>
                        </label>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="keep_both" data-key="${escapeHtml(conflict.key)}" checked>
                            <span>都保留</span>
                        </label>
                        <label class="conflict-action-option">
                            <input type="radio" name="conflict_decision_${index}" value="skip" data-key="${escapeHtml(conflict.key)}">
                            <span>跳过</span>
                        </label>
                    </div>
                </div>
                <!-- 隐藏式差异对比折叠面板 -->
                <div id="diff_${index}" class="conflict-diff-panel">
                    <div class="diff-column diff-column-existing">
                        <div class="diff-column-header">📌 本地现有版本</div>
                        <div class="diff-column-body">${formatItemSummary(existingItem, conflict.category)}</div>
                    </div>
                    <div class="diff-column diff-column-incoming">
                        <div class="diff-column-header">📥 待导入版本</div>
                        <div class="diff-column-body">${formatItemSummary(incomingItem, conflict.category)}</div>
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
