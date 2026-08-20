/**
 * @file content-search.js
 * @description 流式游标分批全文搜索（Cursor-Streamed Search）与【左右二级分栏 (Master-Detail)】双栏可拖拽浮窗
 */

import { state } from './state.js?v=260820-1';
import { dom } from './dom.js?v=260820-1';
import { getAllConversationIds, getConversation } from './db.js?v=260820-1';
import { escapeHtml } from './utils.js?v=260820-1';
import { switchToConversation, switchBranchTo } from './main.js?v=260820-1';

let contentSearchModalEl = null;
let currentSearchToken = 0; // 防止旧搜索覆盖新搜索
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panelInitialLeft = 0;
let panelInitialTop = 0;

// 当前选中的会话 ID（左侧 Master -> 右侧 Detail 联动）
let selectedConvIdInSearch = null;
let aggregatedSearchResultsMap = {};

/**
 * 初始化全文内容搜索全局代理事件
 */
export function initContentSearchModule() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#content-search-btn');
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            openContentSearchFloatingPanel();
        }
    });
}

/**
 * 打开全文搜索可拖拽双栏浮窗
 */
export function openContentSearchFloatingPanel() {
    if (!contentSearchModalEl) {
        createContentSearchFloatingPanelDOM();
    }
    contentSearchModalEl.style.display = 'flex';
    contentSearchModalEl.classList.add('visible');

    const inputEl = contentSearchModalEl.querySelector('#content-search-query-input');
    if (inputEl) {
        setTimeout(() => {
            inputEl.focus();
            inputEl.select();
        }, 100);
    }
}

/**
 * 创建【左右二级双栏】浮窗 DOM 及事件绑定
 */
function createContentSearchFloatingPanelDOM() {
    contentSearchModalEl = document.createElement('div');
    contentSearchModalEl.id = 'content-search-modal';
    contentSearchModalEl.className = 'content-search-floating-panel';

    contentSearchModalEl.innerHTML = `
        <div class="panel-header drag-header" id="content-search-drag-handle">
            <div class="panel-title-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>全文内容检索 (左右二级视图)</span>
            </div>
            <button class="panel-close-btn" id="content-search-close-btn" title="关闭">&times;</button>
        </div>
        <div class="panel-search-bar">
            <input type="search" id="content-search-query-input" name="content-search-query-no-autofill" placeholder="输入关键词全文检索消息与分支..." autocomplete="chrome-off" data-lpignore="true">
            <span class="search-counter" id="content-search-counter-info">0 结果</span>
        </div>
        <div class="panel-body-split">
            <div class="panel-left-master" id="content-search-master-list">
                <div class="search-empty-state">输入关键词开始检索...</div>
            </div>
            <div class="panel-right-detail" id="content-search-detail-list">
                <div class="search-empty-state">在左侧选择会话查看分支消息</div>
            </div>
        </div>
    `;

    document.body.appendChild(contentSearchModalEl);

    // 1. 关闭按钮：强力规则，只有点击右上角 × 才会关闭
    const closeBtn = contentSearchModalEl.querySelector('#content-search-close-btn');
    closeBtn.addEventListener('click', () => {
        contentSearchModalEl.style.display = 'none';
        contentSearchModalEl.classList.remove('visible');
    });

    // 2. 拖拽逻辑 (Draggable Header)
    const dragHandle = contentSearchModalEl.querySelector('#content-search-drag-handle');
    dragHandle.addEventListener('mousedown', (e) => {
        if (e.target.closest('#content-search-close-btn')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = contentSearchModalEl.getBoundingClientRect();
        panelInitialLeft = rect.left;
        panelInitialTop = rect.top;

        contentSearchModalEl.style.margin = '0';
        contentSearchModalEl.style.left = `${panelInitialLeft}px`;
        contentSearchModalEl.style.top = `${panelInitialTop}px`;
        contentSearchModalEl.style.right = 'auto';
        contentSearchModalEl.style.bottom = 'auto';

        document.addEventListener('mousemove', onPanelDragMove);
        document.addEventListener('mouseup', onPanelDragEnd);
        e.preventDefault();
    });

    // 3. 搜索防抖监听
    let searchDebounceTimer = null;
    const searchInput = contentSearchModalEl.querySelector('#content-search-query-input');
    searchInput.addEventListener('input', () => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            const query = searchInput.value.trim();
            executeStreamedContentSearch(query);
        }, 250);
    });
}

function onPanelDragMove(e) {
    if (!isDragging || !contentSearchModalEl) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    let newLeft = panelInitialLeft + dx;
    let newTop = panelInitialTop + dy;

    // 边缘限制
    newLeft = Math.max(10, Math.min(window.innerWidth - 360, newLeft));
    newTop = Math.max(10, Math.min(window.innerHeight - 150, newTop));

    contentSearchModalEl.style.left = `${newLeft}px`;
    contentSearchModalEl.style.top = `${newTop}px`;
}

function onPanelDragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', onPanelDragMove);
    document.removeEventListener('mouseup', onPanelDragEnd);
}

/**
 * 核心：流式游标分批全文搜索（按会话聚合数据模型）
 * @param {string} query - 搜索关键词
 */
async function executeStreamedContentSearch(query) {
    if (!contentSearchModalEl) return;
    const masterListEl = contentSearchModalEl.querySelector('#content-search-master-list');
    const detailListEl = contentSearchModalEl.querySelector('#content-search-detail-list');
    const counterEl = contentSearchModalEl.querySelector('#content-search-counter-info');

    if (!query) {
        currentSearchToken++;
        aggregatedSearchResultsMap = {};
        selectedConvIdInSearch = null;
        masterListEl.innerHTML = `<div class="search-empty-state">输入关键词开始检索...</div>`;
        detailListEl.innerHTML = `<div class="search-empty-state">在左侧选择会话查看分支消息</div>`;
        counterEl.textContent = `0 结果`;
        return;
    }

    const thisToken = ++currentSearchToken;
    aggregatedSearchResultsMap = {};
    selectedConvIdInSearch = null;

    masterListEl.innerHTML = `<div class="search-loading-state"><span class="spinner-mini"></span> 扫全库中...</div>`;
    detailListEl.innerHTML = `<div class="search-empty-state">等待扫描完成...</div>`;
    counterEl.textContent = `检索中...`;

    try {
        const conversationIds = await getAllConversationIds();
        if (thisToken !== currentSearchToken) return;

        let totalMatchedMessages = 0;
        let isFirstBatch = true;
        const lowerQuery = query.toLowerCase();

        // 异步分批切片：每批处理 4 个会话
        const batchSize = 4;
        for (let i = 0; i < conversationIds.length; i += batchSize) {
            if (thisToken !== currentSearchToken) return;

            const batchIds = conversationIds.slice(i, i + batchSize);
            const batchPromises = batchIds.map(id => getConversation(id));
            const batchConvs = await Promise.all(batchPromises);

            if (thisToken !== currentSearchToken) return;

            batchConvs.forEach(conv => {
                if (!conv) return;
                const convId = conv.id;
                const convTitle = conv.title || '未命名会话';
                const activeBranchIdx = conv.activeBranchIndex || 0;
                const branches = Array.isArray(conv.branches) ? conv.branches : [];

                let convMatchCount = 0;
                const branchGroupMap = {};

                branches.forEach((branch, bIdx) => {
                    if (!Array.isArray(branch)) return;

                    const totalBranches = branches.length;
                    const isOtherBranch = bIdx !== activeBranchIdx;
                    const branchLabel = totalBranches > 1 
                        ? (isOtherBranch ? `分支 ${bIdx + 1}/${totalBranches}` : `当前分支 ${bIdx + 1}/${totalBranches}`)
                        : '主对话';

                    branch.forEach((msg, mIdx) => {
                        if (!msg || !msg.content || typeof msg.content !== 'string') return;
                        const lowerContent = msg.content.toLowerCase();
                        const matchPos = lowerContent.indexOf(lowerQuery);

                        if (matchPos !== -1) {
                            const start = Math.max(0, matchPos - 25);
                            const end = Math.min(msg.content.length, matchPos + query.length + 25);
                            let snippetPrefix = start > 0 ? '...' : '';
                            let snippetSuffix = end < msg.content.length ? '...' : '';

                            const rawSnippet = msg.content.substring(start, end);
                            const safeSnippet = escapeHtml(rawSnippet).replace(
                                new RegExp(escapeRegExp(query), 'gi'),
                                match => `<mark class="search-match-highlight">${escapeHtml(match)}</mark>`
                            );

                            if (!branchGroupMap[bIdx]) {
                                branchGroupMap[bIdx] = [];
                            }

                            branchGroupMap[bIdx].push({
                                convId,
                                convTitle,
                                branchIndex: bIdx,
                                activeBranchIdx,
                                isOtherBranch,
                                branchLabel,
                                totalBranches,
                                role: msg.role,
                                snippet: snippetPrefix + safeSnippet + snippetSuffix,
                                messageIndex: mIdx,
                                timestamp: msg.timestamp
                            });

                            convMatchCount++;
                        }
                    });
                });

                if (convMatchCount > 0) {
                    aggregatedSearchResultsMap[convId] = {
                        convId,
                        convTitle,
                        activeBranchIdx,
                        totalBranches: branches.length,
                        totalMatchesCount: convMatchCount,
                        branchGroupMap,
                        lastModified: conv.lastModified || ''
                    };
                    totalMatchedMessages += convMatchCount;
                }
            });

            if (Object.keys(aggregatedSearchResultsMap).length > 0) {
                if (isFirstBatch) {
                    masterListEl.innerHTML = '';
                    isFirstBatch = false;
                }
                renderMasterConversationList(masterListEl, detailListEl);
                counterEl.textContent = `${Object.keys(aggregatedSearchResultsMap).length} 会话 (${totalMatchedMessages} 条消息)`;
            }

            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (thisToken === currentSearchToken) {
            const totalConvs = Object.keys(aggregatedSearchResultsMap).length;
            if (totalConvs === 0) {
                masterListEl.innerHTML = `<div class="search-empty-state">未找到包含 "${escapeHtml(query)}" 的内容</div>`;
                detailListEl.innerHTML = `<div class="search-empty-state">暂无细节</div>`;
                counterEl.textContent = `0 结果`;
            } else {
                counterEl.textContent = `${totalConvs} 会话 (${totalMatchedMessages} 条消息)`;
                // 默认选择第一个会话
                if (!selectedConvIdInSearch) {
                    const firstConvId = Object.keys(aggregatedSearchResultsMap)[0];
                    selectMasterConversation(firstConvId, masterListEl, detailListEl);
                }
            }
        }

    } catch (err) {
        console.error('流式双栏搜索失败:', err);
        if (thisToken === currentSearchToken) {
            masterListEl.innerHTML = `<div class="search-empty-state" style="color:var(--danger-color,#ef4444);">检索失败</div>`;
        }
    }
}

/**
 * 渲染左侧 Master 会话卡片列表
 */
function renderMasterConversationList(masterListEl, detailListEl) {
    masterListEl.innerHTML = '';
    const convIds = Object.keys(aggregatedSearchResultsMap);

    convIds.forEach((convId, index) => {
        const itemData = aggregatedSearchResultsMap[convId];
        const isSelected = convId === selectedConvIdInSearch;

        const cardEl = document.createElement('div');
        cardEl.className = `search-master-item ${isSelected ? 'active' : ''}`;
        cardEl.dataset.convid = convId;

        const branchInfoStr = itemData.totalBranches > 1 ? `含 ${itemData.totalBranches} 分支` : '主对话';

        cardEl.innerHTML = `
            <div class="master-title">${escapeHtml(itemData.convTitle)}</div>
            <div class="master-meta">
                <span>${branchInfoStr}</span>
                <span class="master-badge">${itemData.totalMatchesCount} 条</span>
            </div>
        `;

        cardEl.addEventListener('click', () => {
            selectMasterConversation(convId, masterListEl, detailListEl);
        });

        masterListEl.appendChild(cardEl);
    });
}

/**
 * 选中左侧某会话，在右侧 Detail 展示该会话下按分支分组的匹配消息
 */
function selectMasterConversation(convId, masterListEl, detailListEl) {
    selectedConvIdInSearch = convId;

    // 1. 高亮左侧对应项
    const allMasterItems = masterListEl.querySelectorAll('.search-master-item');
    allMasterItems.forEach(el => {
        if (el.dataset.convid === convId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // 2. 在右侧渲染该会话下的分支消息详情
    const convData = aggregatedSearchResultsMap[convId];
    if (!convData) {
        detailListEl.innerHTML = `<div class="search-empty-state">未找到对应消息</div>`;
        return;
    }

    detailListEl.innerHTML = '';

    const branchGroupMap = convData.branchGroupMap;
    const branchIndexes = Object.keys(branchGroupMap).sort((a, b) => Number(a) - Number(b));

    branchIndexes.forEach(bIdx => {
        const msgList = branchGroupMap[bIdx];
        if (!msgList || msgList.length === 0) return;

        const firstMsg = msgList[0];
        const groupEl = document.createElement('div');
        groupEl.className = 'search-detail-branch-group';

        const isOther = firstMsg.isOtherBranch;
        const branchHeaderTitle = firstMsg.totalBranches > 1 
            ? (isOther ? `🔸 ${firstMsg.branchLabel} (非当前使用分支)` : `🔹 ${firstMsg.branchLabel} (当前分支)`)
            : `💬 消息匹配 (${msgList.length} 条)`;

        groupEl.innerHTML = `
            <div class="search-detail-branch-header">
                <span>${escapeHtml(branchHeaderTitle)}</span>
            </div>
        `;

        msgList.forEach(res => {
            const msgEl = document.createElement('div');
            msgEl.className = `search-detail-msg-item ${res.isOtherBranch ? 'other-branch-msg' : ''}`;
            const roleIcon = res.role === 'user' ? '👤' : '🤖';

            msgEl.innerHTML = `
                <div class="item-header">
                    <span style="font-size:0.75rem;font-weight:600;color:var(--text-primary);">${roleIcon} ${res.role === 'user' ? '提问' : '回复'}</span>
                    ${res.totalBranches > 1 ? `<span class="branch-badge ${res.isOtherBranch ? 'warn-branch' : 'active-branch'}">${escapeHtml(res.branchLabel)}</span>` : ''}
                </div>
                <div class="item-snippet">
                    <span class="item-text">${res.snippet}</span>
                </div>
            `;

            msgEl.addEventListener('click', () => {
                handleSearchResultItemClick(res);
            });

            groupEl.appendChild(msgEl);
        });

        detailListEl.appendChild(groupEl);
    });
}

/**
 * 点击搜索结果消息处理：支持跨分支二次确认提示
 */
async function handleSearchResultItemClick(res) {
    if (res.isOtherBranch) {
        const confirmMsg = `此消息位于 [${res.branchLabel}]，点击将为您自动切换到该分支，是否继续？`;
        if (!confirm(confirmMsg)) {
            return;
        }
    }

    // 1. 切换到对应会话
    await switchToConversation(res.convId);

    // 2. 如果是非当前分支，执行分支切换
    if (res.isOtherBranch) {
        await switchBranchTo(res.branchIndex);
    }

    // 3. 滚动定位到对应消息气泡高亮（若处于精简折叠卡片状态则自动加载展开）
    setTimeout(async () => {
        let messageBubble = document.querySelector(`.message-bubble[data-index="${res.messageIndex}"]`);
        if (messageBubble) {
            // 乌鸦：如果当前消息处于精简折叠状态，自动触发“加载此消息”展开
            const loadBtn = messageBubble.querySelector('.placeholder-load-btn');
            if (loadBtn) {
                loadBtn.click();
                await new Promise(resolve => setTimeout(resolve, 200));
                messageBubble = document.querySelector(`.message-bubble[data-index="${res.messageIndex}"]`) || messageBubble;
            }

            messageBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
            messageBubble.classList.add('search-target-highlight');
            setTimeout(() => {
                messageBubble.classList.remove('search-target-highlight');
            }, 2500);
        }
    }, 350);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
