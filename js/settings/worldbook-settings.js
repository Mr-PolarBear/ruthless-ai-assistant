
// 全局单例问号悬浮提示浮层管理器
let globalWbTooltipEl = null;

function showWbTooltip(targetEl) {
    const text = targetEl.dataset.tooltip || targetEl.title;
    if (!text) return;

    if (!globalWbTooltipEl) {
        globalWbTooltipEl = document.createElement('div');
        globalWbTooltipEl.className = 'global-wb-floating-tooltip';
        document.body.appendChild(globalWbTooltipEl);
    }

    globalWbTooltipEl.textContent = text;
    globalWbTooltipEl.style.display = 'block';

    const rect = targetEl.getBoundingClientRect();
    const tooltipRect = globalWbTooltipEl.getBoundingClientRect();

    let top = rect.top - tooltipRect.height - 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // 屏幕顶部边界检测：若顶部放不下，翻转到下方
    if (top < 10) {
        top = rect.bottom + 8;
    }

    // 屏幕左右边界检测
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
    }

    globalWbTooltipEl.style.top = `${top}px`;
    globalWbTooltipEl.style.left = `${left}px`;
    globalWbTooltipEl.classList.add('visible');
}

function hideWbTooltip() {
    if (globalWbTooltipEl) {
        globalWbTooltipEl.classList.remove('visible');
        globalWbTooltipEl.style.display = 'none';
    }
}

﻿/**
 * @file worldbook-settings.js
 * @description Handles World Book (Memo) settings events.
 */

import { dom } from '../dom.js?v=temp';
import { state } from '../state.js?v=temp';
import { saveToLocalStorage, saveAppSettings, escapeHtml } from '../utils.js?v=temp';
import { 
    renderWorldBookList, resetWorldBookForm, updateCharCounter,
    openWorldBookModal, renderWorldBookTagsPanel, filterWorldBookByTags, sortWorldBookEntries,
    updateFormSessionToggleState, getSafeActiveConversationId, setWorldBookMobileView, toggleWorldBookContentExpand
} from '../modals.js?v=temp';
import { updateAllDynamicUI, updateWorldBookButton, notify } from '../ui-updater.js?v=temp';
import { DraggableList } from '../draggable-list.js?v=temp';
import { createNewConversation } from '../main.js?v=temp';

let lastWorldBookCopyTime = 0;
let worldBookDragInstance = null;

/**
 * 联动更新注入位置与深度、角色、每条合并开关的表单交互状态
 * @param {string} position 
 * @param {boolean} appendAllUser - 是否每条用户发言都合并（仅在 append_to_user 时生效）
 */
export function updatePositionFormLinkage(position = 'top', appendAllUser = false) {
    if (!dom.worldBookPositionSelector) return;
    dom.worldBookPositionSelector.value = position;

    if (position === 'append_to_user') {
        // 隐藏深度组，显示每条合并切换开关
        if (dom.worldBookDepthGroup) dom.worldBookDepthGroup.style.display = 'none';
        if (dom.worldBookAppendAllGroup) dom.worldBookAppendAllGroup.style.display = 'flex';
        if (dom.worldBookAppendAllToggle) dom.worldBookAppendAllToggle.checked = Boolean(appendAllUser);

        if (dom.worldBookDepthInput) {
            dom.worldBookDepthInput.disabled = true;
            dom.worldBookDepthInput.value = 0;
        }
        if (dom.worldBookRoleSelector) {
            dom.worldBookRoleSelector.disabled = true;
            dom.worldBookRoleSelector.value = 'user';
        }
    } else {
        // 显示深度组，隐藏每条合并切换开关
        if (dom.worldBookDepthGroup) dom.worldBookDepthGroup.style.display = '';
        if (dom.worldBookAppendAllGroup) dom.worldBookAppendAllGroup.style.display = 'none';

        if (dom.worldBookDepthInput) {
            dom.worldBookDepthInput.disabled = false;
        }
        if (dom.worldBookRoleSelector) {
            dom.worldBookRoleSelector.disabled = false;
        }

        if (position === 'chat_end') {
            if (dom.worldBookDepthLabelText) {
                dom.worldBookDepthLabelText.textContent = '倒数深度';
            }
        } else {
            if (dom.worldBookDepthLabelText) {
                dom.worldBookDepthLabelText.textContent = '挂载深度';
            }
        }
    }
}

// 初始化或重新初始化拖拽实例
function initWorldBookDragInstance(enabled = true) {
    if (worldBookDragInstance) {
        worldBookDragInstance.destroy();
        worldBookDragInstance = null;
    }
    
    if (!enabled || !dom.worldBookList) return;
    
    worldBookDragInstance = new DraggableList(dom.worldBookList, {
        itemSelector: '.worldbook-item',
        onDrop: (fromIndex, toIndex) => {
            if (fromIndex === toIndex) return;

            // 1. 获取当前可见 DOM 列表中的卡片 ID
            const currentItemEls = Array.from(dom.worldBookList.querySelectorAll('.worldbook-item'));
            const currentVisibleIds = currentItemEls.map(el => el.dataset.id).filter(Boolean);
            if (currentVisibleIds.length === 0) return;

            // 2. 获取全局所有条目按 order 升序排序的数组
            const allEntries = sortWorldBookEntries(Object.values(state.worldBook));

            // 如果当前在全部标签且无筛选，直接按 DOM 顺序重新赋予全局 order
            const isFullList = currentVisibleIds.length === allEntries.length;

            if (isFullList) {
                currentVisibleIds.forEach((id, index) => {
                    if (state.worldBook[id]) {
                        state.worldBook[id].order = (index + 1) * 10;
                    }
                });
            } else {
                // 在标签筛选状态下拖拽：
                // 被移动的项是 currentVisibleIds[toIndex]（因为 DOM 已在 drop 前就位）
                const movedId = currentVisibleIds[toIndex];
                if (!movedId) return;

                const movedIdx = allEntries.findIndex(e => e.id === movedId);
                if (movedIdx === -1) return;
                const [movedEntry] = allEntries.splice(movedIdx, 1);

                if (toIndex === 0) {
                    const nextVisibleId = currentVisibleIds[1];
                    const nextGlobalIdx = allEntries.findIndex(e => e.id === nextVisibleId);
                    if (nextGlobalIdx !== -1) {
                        allEntries.splice(nextGlobalIdx, 0, movedEntry);
                    } else {
                        allEntries.unshift(movedEntry);
                    }
                } else {
                    const prevVisibleId = currentVisibleIds[toIndex - 1];
                    const prevGlobalIdx = allEntries.findIndex(e => e.id === prevVisibleId);
                    if (prevGlobalIdx !== -1) {
                        allEntries.splice(prevGlobalIdx + 1, 0, movedEntry);
                    } else {
                        allEntries.push(movedEntry);
                    }
                }

                allEntries.forEach((entry, index) => {
                    entry.order = (index + 1) * 10;
                });
            }

            // 绝不篡改用户的 entry.depth！
            saveToLocalStorage();
            
            // 保持当前标签筛选状态不变
            filterWorldBookByTags();
            updateWorldBookButton();

            // 专属明确 Toast 提示
            if (typeof notify !== 'undefined' && notify.success) {
                notify.success('✅ 已更新备忘录顺序（同深度/同位置下优先按此顺序发送，不影响设定深度）');
            }
        }
    });
}

/**
 * 确保备忘录处于“全部”标签页视图（若当前处于“已选中”视图，智能自动切换回“全部”并启用标签列表）
 */
function ensureWorldBookAllTabActive() {
    if (state.worldBookFilter.activeTab === 'selected') {
        state.worldBookFilter.activeTab = 'all';
        if (dom.worldBookListTabs) {
            dom.worldBookListTabs.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === 'all');
            });
        }
        if (dom.worldBookTagList) {
            dom.worldBookTagList.classList.remove('disabled');
        }
        initWorldBookDragInstance(true);
    }
}

export function setupWorldBookEvents() {
    if (dom.manageWorldBookBtn) dom.manageWorldBookBtn.addEventListener('click', openWorldBookModal);
    if (dom.worldBookMergeToggle) dom.worldBookMergeToggle.addEventListener('change', () => {
        state.appSettings.mergeWorldBook = dom.worldBookMergeToggle.checked;
        saveAppSettings();
    });
    if (dom.worldBookSaveBtn) dom.worldBookSaveBtn.addEventListener('click', saveWorldBookEntry);
    if (dom.worldBookCancelBtn) dom.worldBookCancelBtn.addEventListener('click', () => {
        resetWorldBookForm();
        setWorldBookMobileView('list');
        toggleWorldBookContentExpand(false);
    });
    // 注入位置与表单联动
    const posSelector = document.getElementById('worldbook-position-selector');
    if (posSelector) {
        posSelector.addEventListener('change', (e) => {
            const curAppendAll = dom.worldBookAppendAllToggle ? dom.worldBookAppendAllToggle.checked : false;
            updatePositionFormLinkage(e.target.value, curAppendAll);
        });
    }

    // 动态宏变量快捷插入（事件委托到模态框或直接监听容器）
    const macroBar = document.getElementById('worldbook-macro-bar');
    if (macroBar) {
        macroBar.addEventListener('click', (e) => {
            const chip = e.target.closest('.wb-macro-chip');
            if (!chip) return;
            const macro = chip.dataset.macro;
            const textarea = document.getElementById('worldbook-content-input');
            if (!macro || !textarea) return;

            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const currentVal = textarea.value;

            textarea.value = currentVal.substring(0, start) + macro + currentVal.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + macro.length;
            textarea.focus();
            updateCharCounter();
        });
    }

    // 圆形问号说明点击 (尤其移动端友好弹出提示)
    
    // 圆形问号说明：鼠标悬停即现浮层
    document.addEventListener('mouseover', (e) => {
        const tooltipEl = e.target.closest('.wb-help-tooltip');
        if (tooltipEl) {
            showWbTooltip(tooltipEl);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const tooltipEl = e.target.closest('.wb-help-tooltip');
        if (tooltipEl) {
            hideWbTooltip();
        }
    });

    document.addEventListener('click', (e) => {
        const tooltipEl = e.target.closest('.wb-help-tooltip');
        if (tooltipEl) {
            e.preventDefault();
            e.stopPropagation();
            const text = tooltipEl.dataset.tooltip || tooltipEl.title;
            if (text && typeof notify !== 'undefined' && notify.info) {
                notify.info(text, { duration: 6000 });
            }
        }
    });
    
    // 文本输入框全屏放大/缩小按钮
    if (dom.worldBookContentExpandBtn) {
        dom.worldBookContentExpandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleWorldBookContentExpand();
        });
    }

    // 移动端视图导航切换
    if (dom.worldBookMobileNav) {
        dom.worldBookMobileNav.addEventListener('click', (e) => {
            const navBtn = e.target.closest('.wb-mobile-nav-btn');
            if (navBtn && navBtn.dataset.wbView) {
                setWorldBookMobileView(navBtn.dataset.wbView);
            }
        });
    }

    // 展开标签筛选（移动端打开抽屉 / PC端展开左侧栏）
    if (dom.worldBookTagsOpenBtn) {
        dom.worldBookTagsOpenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                openWorldBookTagsDrawer();
            } else {
                if (dom.worldBookModal) {
                    dom.worldBookModal.classList.remove('tags-collapsed');
                }
            }
        });
    }

    // 向左收起标签面板（移动端关闭抽屉 / PC端收起左侧栏）
    if (dom.worldBookTagsCollapseBtn) {
        dom.worldBookTagsCollapseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                closeWorldBookTagsDrawer();
            } else {
                if (dom.worldBookModal) {
                    dom.worldBookModal.classList.add('tags-collapsed');
                }
            }
        });
    }

    // 移动端点击标签遮罩层关闭抽屉
    if (dom.worldBookTagsBackdrop) {
        dom.worldBookTagsBackdrop.addEventListener('click', () => {
            closeWorldBookTagsDrawer();
        });
    }

    // ESC 快捷键退出文本放大模式
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.worldBookModal && dom.worldBookModal.classList.contains('content-expanded')) {
            e.preventDefault();
            e.stopPropagation();
            toggleWorldBookContentExpand(false);
        }
    });
    
    // 表单内全局生效开关变更时，联动更新局部生效开关的禁用与选中状态
    
    // 监听局部生效开关容器点击
    if (dom.worldBookSessionToggleContainer) {
        dom.worldBookSessionToggleContainer.addEventListener('click', async (e) => {
            const isGlobal = dom.worldBookEnabledToggle && dom.worldBookEnabledToggle.checked;
            if (isGlobal) {
                e.preventDefault();
                e.stopPropagation();
                if (notify && notify.info) {
                    notify.info('ℹ️ 当前已开启「全局生效」（已在所有会话生效）；若想仅限某个会话，请先关闭左侧的「全局」开关');
                }
                return;
            }

            let currentConvId = (typeof getSafeActiveConversationId === 'function') ? getSafeActiveConversationId() : state.currentConversationId;
            // 意图驱动（Plan A）：若当前未选择任何会话（空白态/未发消息），点击局部生效时自动创建新会话！
            if (!currentConvId) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const newConv = await createNewConversation();
                    if (newConv && newConv.id) {
                        currentConvId = newConv.id;
                        updateFormSessionToggleState(false, true);
                        if (notify && notify.success) {
                            notify.success('✨ 已自动为您创建新会话，局部生效已开启！');
                        }
                    }
                } catch (err) {
                    console.error('自动创建新会话失败:', err);
                }
            }
        });
    }

    if (dom.worldBookEnabledToggle) {
        dom.worldBookEnabledToggle.addEventListener('change', () => {
            const isGlobal = dom.worldBookEnabledToggle.checked;
            const currentConvId = (typeof getSafeActiveConversationId === 'function') ? getSafeActiveConversationId() : state.currentConversationId;
            const editingId = dom.worldBookIdInput?.value;
            let wasSessionChecked = false;
            if (editingId && state.worldBook[editingId] && Array.isArray(state.worldBook[editingId].sessionIds)) {
                wasSessionChecked = Boolean(currentConvId && state.worldBook[editingId].sessionIds.includes(currentConvId));
            } else if (!editingId) {
                // 新建条目关闭全局时，意图通常是针对当前会话生效，默认保持勾选
                wasSessionChecked = true;
            }
            updateFormSessionToggleState(isGlobal, wasSessionChecked);
        });
    }
    
    if (dom.worldBookTagsInput) {
        dom.worldBookTagsInput.addEventListener('input', updateWorldBookTags);
    }
    
    if (dom.worldBookList) {
        dom.worldBookList.addEventListener('click', handleWorldBookListActions);
        
        // 初始化拖拽实例（默认启用）
        initWorldBookDragInstance();
    }
    if (dom.worldBookContentInput) dom.worldBookContentInput.addEventListener('input', updateCharCounter);
    
    if (dom.worldBookTagSearchInput) {
        dom.worldBookTagSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const tagItems = dom.worldBookTagList.querySelectorAll('.tag-item');
            tagItems.forEach(item => {
                const tagName = item.dataset.tag.toLowerCase();
                item.style.display = tagName.includes(searchTerm) ? 'flex' : 'none';
            });
        });
    }
    
    if (dom.worldBookTagList) {
        const oldCheckboxListener = dom.worldBookTagList._checkboxListener;
        if (oldCheckboxListener) {
            dom.worldBookTagList.removeEventListener('change', oldCheckboxListener);
        }
        
        const oldClickListener = dom.worldBookTagList._clickListener;
        if (oldClickListener) {
            dom.worldBookTagList.removeEventListener('click', oldClickListener);
        }
        
        const newClickListener = (e) => {
            const tagItem = e.target.closest('.tag-item');
            if (tagItem && !e.target.classList.contains('tag-checkbox')) {
                // 智能自愈：若当前在“已选中”视图，自动切回“全部”并激活标签筛选
                ensureWorldBookAllTabActive();
                
                const checkbox = tagItem.querySelector('.tag-checkbox');
                if (checkbox) {
                    // 若点击的是"全部"且已经是勾选状态，不重复触发反选
                    if (tagItem.dataset.tag === '全部' && checkbox.checked) {
                        return;
                    }
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        };
        dom.worldBookTagList.addEventListener('click', newClickListener);
        dom.worldBookTagList._clickListener = newClickListener;
        
        const newCheckboxListener = (e) => {
            if (e.target.classList.contains('tag-checkbox')) {
                // 智能自愈：若当前在“已选中”视图，自动切回“全部”并激活标签筛选
                ensureWorldBookAllTabActive();
                
                const isSingleMode = state.worldBookFilter.mode === 'single';
                const tagItem = e.target.closest('.tag-item');
                const clickedTag = tagItem?.dataset.tag;
                const isChecked = e.target.checked;
                
                const allItem = dom.worldBookTagList.querySelector('.tag-item[data-tag="全部"]');
                const allCheckbox = allItem?.querySelector('.tag-checkbox');
                
                // — 为什么这么写 —
                // 1. 点击“全部”：勾选时取消所有具体标签；不让用户取消勾选“全部”（保持至少选中全部）
                // 2. 点击具体标签：勾选时取消“全部”；若单选模式则取消其它具体标签；
                // 3. 取消具体标签：若无任何具体标签选中，自动回退勾选“全部”
                if (clickedTag === '全部') {
                    if (isChecked) {
                        dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"])').forEach(item => {
                            item.classList.remove('active');
                            const cb = item.querySelector('.tag-checkbox');
                            if (cb) cb.checked = false;
                        });
                        tagItem.classList.add('active');
                    } else {
                        e.target.checked = true;
                        tagItem.classList.add('active');
                    }
                } else {
                    if (isChecked) {
                        if (allCheckbox) {
                            allCheckbox.checked = false;
                            allItem?.classList.remove('active');
                        }
                        tagItem.classList.add('active');
                        
                        if (isSingleMode) {
                            dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"])').forEach(item => {
                                if (item !== tagItem) {
                                    item.classList.remove('active');
                                    const cb = item.querySelector('.tag-checkbox');
                                    if (cb) cb.checked = false;
                                }
                            });
                        }
                    } else {
                        tagItem.classList.remove('active');
                        const specificChecked = dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"]) .tag-checkbox:checked');
                        if (specificChecked.length === 0) {
                            if (allCheckbox) {
                                allCheckbox.checked = true;
                                allItem?.classList.add('active');
                            }
                        }
                    }
                }
                
                filterWorldBookByTags();
            }
        };
        dom.worldBookTagList.addEventListener('change', newCheckboxListener);
        dom.worldBookTagList._checkboxListener = newCheckboxListener;
    }
    
    const tagLogicContainer = dom.worldBookTagsPanel || document;
    const oldLogicListener = tagLogicContainer._logicListener;
    if (oldLogicListener) {
        tagLogicContainer.removeEventListener('change', oldLogicListener);
    }
    
    const newLogicListener = (e) => {
        if (e.target.name === 'tag-logic') {
            ensureWorldBookAllTabActive();
            const newMode = e.target.value;
            const oldMode = state.worldBookFilter.mode;
            state.worldBookFilter.mode = newMode;
            
            // 从多选切换到单选时，只保留第一个选中的标签
            if (oldMode === 'multi' && newMode === 'single') {
                const checkedBoxes = dom.worldBookTagList.querySelectorAll('.tag-checkbox:checked');
                if (checkedBoxes.length > 1) {
                    checkedBoxes.forEach((checkbox, index) => {
                        if (index > 0) {
                            checkbox.checked = false;
                            checkbox.closest('.tag-item')?.classList.remove('active');
                        }
                    });
                }
            }
            
            filterWorldBookByTags();
        }
    };
    tagLogicContainer.addEventListener('change', newLogicListener);
    tagLogicContainer._logicListener = newLogicListener;
    
    // 标签页切换事件
    if (dom.worldBookListTabs) {
        const oldTabListener = dom.worldBookListTabs._tabListener;
        if (oldTabListener) {
            dom.worldBookListTabs.removeEventListener('click', oldTabListener);
        }
        
        const newTabListener = (e) => {
            const tabBtn = e.target.closest('.tab-btn');
            if (!tabBtn) return;
            
            const tab = tabBtn.dataset.tab;
            if (tab && tab !== state.worldBookFilter.activeTab) {
                state.worldBookFilter.activeTab = tab;
                
                // 更新按钮样式
                dom.worldBookListTabs.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === tab);
                });
                
                // 根据标签页启用/禁用拖拽
                initWorldBookDragInstance(tab === 'all');
                
                // 根据标签页启用/禁用标签列表
                if (dom.worldBookTagList) {
                    dom.worldBookTagList.classList.toggle('disabled', tab === 'selected');
                }
                
                // 重新渲染列表
                filterWorldBookByTags();
            }
        };
        dom.worldBookListTabs.addEventListener('click', newTabListener);
        dom.worldBookListTabs._tabListener = newTabListener;
    }

    if (dom.worldBookClearFilterBtn) {
        dom.worldBookClearFilterBtn.addEventListener('click', clearWorldBookFilter);
    }
}

function clearWorldBookFilter() {
    ensureWorldBookAllTabActive();
    if (!dom.worldBookTagList) return;
    
    // 取消所有具体标签的选中
    dom.worldBookTagList.querySelectorAll('.tag-item:not([data-tag="全部"])').forEach(item => {
        item.classList.remove('active');
        const cb = item.querySelector('.tag-checkbox');
        if (cb) cb.checked = false;
    });
    
    // 恢复"全部"为选中状态
    const allItem = dom.worldBookTagList.querySelector('.tag-item[data-tag="全部"]');
    if (allItem) {
        allItem.classList.add('active');
        const allCb = allItem.querySelector('.tag-checkbox');
        if (allCb) allCb.checked = true;
    }
    
    if (dom.worldBookTagSearchInput) {
        dom.worldBookTagSearchInput.value = '';
        dom.worldBookTagList.querySelectorAll('.tag-item').forEach(item => {
            item.style.display = 'flex';
        });
    }

    if (dom.worldBookTagsPanel) {
        dom.worldBookTagsPanel.classList.remove('expanded');
        closeWorldBookTagsDrawer();
    }
    
    filterWorldBookByTags();
}

export function openWorldBookTagsDrawer() {
    if (dom.worldBookTagsPanel) {
        dom.worldBookTagsPanel.classList.add('drawer-open');
    }
    if (dom.worldBookTagsBackdrop) {
        dom.worldBookTagsBackdrop.classList.add('active');
    }
}

export function closeWorldBookTagsDrawer() {
    if (dom.worldBookTagsPanel) {
        dom.worldBookTagsPanel.classList.remove('drawer-open');
    }
    if (dom.worldBookTagsBackdrop) {
        dom.worldBookTagsBackdrop.classList.remove('active');
    }
}

function updateWorldBookTags() {
    if (!dom.worldBookTagsInput) return;
    
    const tagsInput = dom.worldBookTagsInput.value;
    const tags = tagsInput
        .split(/[,，\n]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    
    if (!dom.worldBookTagsDisplay) return;
    
    dom.worldBookTagsDisplay.innerHTML = tags.map(tag => 
        `<span class="tag-item-delete">${escapeHtml(tag)}<span class="tag-delete-icon">×</span></span>`
    ).join('');
    
    dom.worldBookTagsDisplay.querySelectorAll('.tag-item-delete').forEach(el => {
        el.addEventListener('click', (e) => {
            const tagToRemove = el.textContent.replace('×', '').trim();
            const newTags = tags.filter(t => t !== tagToRemove);
            dom.worldBookTagsInput.value = newTags.join(', ');
            updateWorldBookTags();
        });
    });
}

async function saveWorldBookEntry() {
    const id = dom.worldBookIdInput.value;
    const name = dom.worldBookNameInput.value.trim();
    const content = dom.worldBookContentInput.value.trim();
    const position = dom.worldBookPositionSelector?.value || 'top';
    const appendAllUser = (position === 'append_to_user') ? Boolean(dom.worldBookAppendAllToggle?.checked) : false;
    let depth = parseInt(dom.worldBookDepthInput.value, 10);
    let role = dom.worldBookRoleSelector.value;
    const enabled = dom.worldBookEnabledToggle.checked;

    if (!name || !content) return alert('名称和内容不能为空！');

    // 智能深度与角色校验
    if (position === 'append_to_user') {
        depth = 0;
        role = 'user';
    } else {
        if (isNaN(depth) || depth < 0 || depth > 100) {
            return alert('挂载深度必须是 0 到 100 之间的数字！');
        }
    }

    const tagsInput = dom.worldBookTagsInput?.value || '';
    const tags = tagsInput
        .split(/[,，\n]/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);

    const entryId = id || `wb_${Date.now()}`;
    let sessionIds = [];
    let createdAt = Date.now();
    let order = Date.now();

    if (state.worldBook[entryId]) {
        if (Array.isArray(state.worldBook[entryId].sessionIds)) {
            sessionIds = [...state.worldBook[entryId].sessionIds];
        }
        if (state.worldBook[entryId].createdAt) {
            createdAt = state.worldBook[entryId].createdAt;
        }
        if (typeof state.worldBook[entryId].order === 'number') {
            order = state.worldBook[entryId].order;
        }
    }

    // 会话局部关联处理
    let currentConvId = (typeof getSafeActiveConversationId === 'function') ? getSafeActiveConversationId() : state.currentConversationId;
    if (!enabled && dom.worldBookSessionToggleInput) {
        const isSessionChecked = dom.worldBookSessionToggleInput.checked;
        if (isSessionChecked) {
            // 意图驱动（Plan A）：若关闭全局且想在当前新会话生效，但此时底层未生成会话，自动为大爷创建新会话！
            if (!currentConvId) {
                try {
                    const newConv = await createNewConversation();
                    if (newConv && newConv.id) {
                        currentConvId = newConv.id;
                    }
                } catch (err) {
                    console.error('保存条目时自动创建会话失败:', err);
                }
            }
            if (currentConvId && !sessionIds.includes(currentConvId)) {
                sessionIds.push(currentConvId);
            }
        } else {
            if (currentConvId) {
                sessionIds = sessionIds.filter(cid => cid !== currentConvId);
            }
        }
    }

    state.worldBook[entryId] = { 
        id: entryId, 
        name, 
        content, 
        depth, 
        role, 
        position,
        appendAllUser,
        order,
        enabled, 
        sessionIds,
        tags,
        createdAt
    };

    saveToLocalStorage();
    renderWorldBookTagsPanel();
    filterWorldBookByTags();

    // — 为什么这么写 —
    // 依大爷要求：保存后不直接清空，而是停留在当前条目继续编辑状态
    // 1. 将表单 id 设置为当前条目 ID，标题切换为编辑状态
    // 2. 显示取消编辑按钮，方便用户随时切换新建
    // 3. 弹出成功 Toast，保持流程连续性
    dom.worldBookIdInput.value = entryId;
    dom.worldBookFormTitle.textContent = '编辑条目';
    if (dom.wbMobileFormTabText) dom.wbMobileFormTabText.textContent = '编辑条目';
    if (dom.worldBookCancelBtn) dom.worldBookCancelBtn.style.display = 'inline-flex';

    // 保存后，立即同步刷新表单内局部生效开关的最新状态与可用性，以及注入位置与每条合并联动
    updateFormSessionToggleState(enabled, Boolean(currentConvId && sessionIds.includes(currentConvId)));
    updatePositionFormLinkage(position, appendAllUser);

    updateWorldBookButton();

    // 专属 Toast 通知
    if (notify && notify.success) {
        notify.success(`✅ 备忘录「${name}」保存成功！`);
    } else if (typeof window !== 'undefined' && window.notify && window.notify.success) {
        window.notify.success(`✅ 备忘录「${name}」保存成功！`);
    }
}

function handleWorldBookListActions(e) {
    const target = e.target;
    const button = target.closest('button');
    const globalSwitch = target.closest('.worldbook-item-toggle');
    const sessionSwitch = target.closest('.worldbook-session-toggle');

    if (globalSwitch) {
        e.stopPropagation();
        const id = globalSwitch.dataset.id;
        const entry = state.worldBook[id];
        if (entry) {
            entry.enabled = globalSwitch.checked;
            saveToLocalStorage();
            renderWorldBookTagsPanel();
            filterWorldBookByTags();
            updateAllDynamicUI();
        }
        return;
    }
    
    if (sessionSwitch) {
        e.stopPropagation();
        const id = sessionSwitch.dataset.id;
        const entry = state.worldBook[id];
        if (!entry) return;
        if (!Array.isArray(entry.sessionIds)) entry.sessionIds = [];
        let convId = (typeof getSafeActiveConversationId === 'function') ? getSafeActiveConversationId() : state.currentConversationId;
        
        if (sessionSwitch.checked) {
            // 如果勾选但此时没有活动会话，自动为大爷创建新会话！
            if (!convId) {
                (async () => {
                    try {
                        const newConv = await createNewConversation();
                        if (newConv && newConv.id) {
                            convId = newConv.id;
                            if (!entry.sessionIds.includes(convId)) entry.sessionIds.push(convId);
                            saveToLocalStorage();
                            renderWorldBookTagsPanel();
                            filterWorldBookByTags();
                            updateWorldBookButton();
                            if (notify && notify.success) {
                                notify.success('✨ 已自动创建新会话，该条目已在此会话生效！');
                            }
                        }
                    } catch (err) {
                        console.error('列表勾选局部时自动创建会话失败:', err);
                    }
                })();
                return;
            }
            if (!entry.sessionIds.includes(convId)) entry.sessionIds.push(convId);
        } else {
            if (convId) {
                entry.sessionIds = entry.sessionIds.filter(cid => cid !== convId);
            }
        }
        if (!entry.enabled && entry.sessionIds.length === 0) {
            sessionSwitch.checked = false;
        }
        saveToLocalStorage();
        renderWorldBookTagsPanel();
        filterWorldBookByTags();
        updateWorldBookButton();
        return;
    }

    if (button) {
        const id = button.dataset.id;
        if (button.classList.contains('worldbook-edit-btn')) {
            const entry = state.worldBook[id];
            dom.worldBookIdInput.value = entry.id;
            dom.worldBookNameInput.value = entry.name;
            dom.worldBookContentInput.value = entry.content;
            // 联动回显注入位置与深度、角色的可用性，以及每条合并开关
            updatePositionFormLinkage(entry.position || 'top', Boolean(entry.appendAllUser));
            dom.worldBookDepthInput.value = (typeof entry.depth === 'number') ? entry.depth : 10;
            dom.worldBookRoleSelector.value = entry.role || 'system';
            dom.worldBookEnabledToggle.checked = entry.enabled;
            
            // 回显局部生效开关状态与可用性
            const currentConvId = (typeof getSafeActiveConversationId === 'function') ? getSafeActiveConversationId() : state.currentConversationId;
            const isSessionChecked = entry.enabled || (currentConvId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(currentConvId));
            updateFormSessionToggleState(entry.enabled, isSessionChecked);
            
            dom.worldBookTagsInput.value = Array.isArray(entry.tags) ? entry.tags.join(', ') : '';
            updateWorldBookTags();
            dom.worldBookFormTitle.textContent = '编辑条目';
            if (dom.wbMobileFormTabText) dom.wbMobileFormTabText.textContent = '编辑条目';
            
            if (dom.worldBookCancelBtn) {
                dom.worldBookCancelBtn.style.display = 'inline-block';
            }
            updateCharCounter();
            setWorldBookMobileView('form');
        } else if (button.classList.contains('worldbook-delete-btn')) {
            if (confirm(`确定要删除备忘录条目 "${state.worldBook[id].name}" 吗？`)) {
                delete state.worldBook[id];
                saveToLocalStorage();
                renderWorldBookTagsPanel();
                filterWorldBookByTags();
                updateWorldBookButton();
            }
        } else if (button.classList.contains('worldbook-copy-btn')) {
            if (Date.now() - lastWorldBookCopyTime < 1000) return alert('请勿频繁点击复制！');
            lastWorldBookCopyTime = Date.now();
            const entryToCopy = state.worldBook[id];
            if (confirm(`确定要复制备忘录条目 "${entryToCopy.name}" 吗？`)) {
                const newEntry = JSON.parse(JSON.stringify(entryToCopy));
                newEntry.id = `wb_${Date.now()}`;
                newEntry.name = `${entryToCopy.name}_copy`;
                newEntry.createdAt = Date.now();
                newEntry.order = Date.now();
                state.worldBook[newEntry.id] = newEntry;
                saveToLocalStorage();
                renderWorldBookTagsPanel();
                filterWorldBookByTags();
                updateWorldBookButton();
            }
        }
    }
}
