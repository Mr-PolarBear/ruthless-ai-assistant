// db-table-choose.js
// Added clear button for search and character limit.

// --- Module-level state and constants ---
let modal = null;

const pageState = {
    pageNum: 1,
    pageSize: 20,
    dbConnStr: '',
    tableName: '' // For search
};
let selectedTables = [];
let currentPageRecords = []; // 乌鸦：缓存当前页数据，包含表结构

// --- Core Functions ---

function getCurrentConversation() {
    const windowState = window.state;
    return windowState?.conversations?.[windowState.currentConversationId] ?? null;
}

// --- UI Rendering Functions ---

function renderSelectedTables() {
    const selectedDiv = modal.querySelector('#table-choose-selected');
    const countSpan = modal.querySelector('#selected-table-count');
    countSpan.textContent = selectedTables.length;

    if (selectedTables.length === 0) {
        selectedDiv.innerHTML = '<div class="empty-placeholder">暂未选择</div>';
        return;
    }

    selectedDiv.innerHTML = selectedTables.map(tableName => `
        <div class="selected-table-item" data-table-name="${tableName}">
            <span>${tableName}</span>
            <button class="remove-btn" title="移除">&times;</button>
        </div>
    `).join('');
}

function renderTableList(records, total, current, size) {
    const listContainer = modal.querySelector('#table-list-container');

    if (!records || records.length === 0) {
        listContainer.innerHTML = '<div class="empty-placeholder">暂无数据</div>';
        renderPagination(0, 1, size);
        return;
    }

    const table = document.createElement('table');
    table.className = 'table-choose-table';

    table.innerHTML = `
        <tbody>
            ${records.filter(row => row).map((row, index) => {
        const isChecked = selectedTables.includes(row.tableName);
        return `
                    <tr data-table-name="${row.tableName}" data-index="${index}" class="table-row-clickable">
                        <td class="col-checkbox"><input type="checkbox" data-table-name="${row.tableName}" data-index="${index}" ${isChecked ? 'checked' : ''}></td>
                        <td class="col-name">${row.tableName}</td>
                        <td class="col-comment">${row.tableComment || ''}</td>
                        <td class="col-structure"><button class="view-struct-btn pagination-btn" data-index="${index}" style="padding: 2px 6px; font-size: 12px;">查看</button></td>
                    </tr>
                `;
    }).join('')}
        </tbody>
    `;
    listContainer.innerHTML = '';
    listContainer.appendChild(table);

    renderPagination(total, current, size);
}

function renderPagination(total, current, size) {
    const pageDiv = modal.querySelector('#table-choose-pagination');
    const pageCount = Math.ceil(total / size);
    pageDiv.innerHTML = '';

    if (total === 0) {
        pageDiv.innerHTML = '<span class="total-count">共 0 条</span>';
        return;
    }

    if (pageCount <= 1 && total > 0) {
        pageDiv.innerHTML = `<span class="total-count">共 ${total} 条</span>`;
        return;
    }

    let html = `
        <button data-page="1" class="pagination-btn" ${current === 1 ? 'disabled' : ''}>首页</button>
        <button data-page="${current - 1}" class="pagination-btn" ${current === 1 ? 'disabled' : ''}>上一页</button>
        <span class="page-info">第 ${current} / ${pageCount} 页</span>
        <button data-page="${current + 1}" class="pagination-btn" ${current === pageCount ? 'disabled' : ''}>下一页</button>
        <button data-page="${pageCount}" class="pagination-btn" ${current === pageCount ? 'disabled' : ''}>尾页</button>
        <span class="total-count">共 ${total} 条</span>
    `;

    pageDiv.innerHTML = html;
    pageDiv.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.onclick = () => {
            if (!btn.disabled) {
                loadTablePage(Number(btn.getAttribute('data-page')));
            }
        };
    });
}

// --- API Call ---

async function loadTablePage(page) {
    pageState.pageNum = page;
    const listContainer = modal.querySelector('#table-list-container');
    listContainer.innerHTML = '<div class="empty-placeholder">加载中...</div>';

    try {
        const conv = getCurrentConversation();
        if (!conv || !conv.apiEndpointId) {
            listContainer.innerHTML = '<div class="error-placeholder">未配置API地址</div>';
            return;
        }
        const apiObj = window.state.apiEndpoints[conv.apiEndpointId];
        if (!apiObj || !apiObj.url) {
            listContainer.innerHTML = '<div class="error-placeholder">未配置API地址</div>';
            return;
        }

        // 乌鸦：优先使用全局配置的自定义URL
        let apiBase;
        if (window.state.appSettings && window.state.appSettings.dbTableFetchUrl) {
            apiBase = window.state.appSettings.dbTableFetchUrl;
        } else {
            // 默认回退逻辑：使用当前API地址拼接
            apiBase = apiObj.url.replace(/\/[^/]*$/, '/getTableInfoWithPage');
        }

        const requestBody = {
            database: pageState.dbConnStr,
            pageNum: pageState.pageNum,
            pageSize: pageState.pageSize,
            tableName: pageState.tableName,
            isSelectCreateTable: true // 乌鸦：强制获取表结构
        };

        const resp = await fetch(apiBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await resp.json();
        if (data && data.status === 100 && data.data && Array.isArray(data.data.records)) {
            currentPageRecords = data.data.records; // 乌鸦：缓存数据

            // 乌鸦：自动更新已选表的结构信息（如果有）
            const conv = getCurrentConversation();
            if (conv && selectedTables.length > 0) {
                if (!conv.dbTableInfos) conv.dbTableInfos = {};
                currentPageRecords.forEach(record => {
                    if (selectedTables.includes(record.tableName)) {
                        conv.dbTableInfos[record.tableName] = record.tableInfo;
                    }
                });
            }

            renderTableList(data.data.records, data.data.total, data.data.current, data.data.size);
        } else {
            const errorMessage = data.msg || data.message || '未知错误';
            listContainer.innerHTML = `<div class="error-placeholder">加载失败: ${errorMessage}</div>`;
        }
    } catch (e) {
        listContainer.innerHTML = `<div class="error-placeholder">请求出错: ${e.message}</div>`;
    }
}

// --- Modal Creation and Event Handling ---

function injectStyles() {
    const styleId = 'table-choose-modal-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        .table-choose-modal-body { 
            width: 80vw; 
            max-width: 1200px; 
            height: 80vh; 
            display: flex; 
            flex-direction: column; 
            padding: 20px; 
            box-sizing: border-box; 
            background: var(--bg-medium); /* 乌鸦：适配深色模式 */
            color: var(--text-primary);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
        }
        
        .table-choose-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-shrink: 0; }
        .table-choose-header-row h3, .table-choose-header-row h4 { margin: 0; color: var(--text-primary); }

        .table-choose-main-content { display:flex; flex:1; gap:16px; overflow:hidden; }
        
        .table-list-panel { flex: 2; display: flex; flex-direction: column; overflow: hidden; }
        .table-list-search { display: flex; gap: 8px; padding-bottom: 10px; }
        .search-input-wrapper { position: relative; flex: 1; display: flex; }
        
        .table-choose-search-input { 
            flex: 1; 
            padding: 6px 28px 6px 10px; 
            border: 1px solid var(--border-color); /* 乌鸦：变量 */
            border-radius: 4px; 
            background: var(--bg-light); /* 乌鸦：变量 */
            color: var(--text-primary);
        }
        
        .clear-search-btn { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 18px; color: var(--text-secondary); padding: 0 5px; display: none; }
        
        .search-btn { padding: 5px 12px; }
        
        .table-list-content { 
            border: 1px solid var(--border-color); /* 乌鸦：变量 */
            border-radius: 4px; 
            overflow: hidden; 
            display: flex; 
            flex-direction: column; 
            flex: 1; 
            background: var(--bg-light); 
        }
        
        .table-list-header { 
            flex-shrink: 0; 
            background: var(--bg-deep); /* 乌鸦：表头用深一点的背景 */
            border-bottom: 1px solid var(--border-color);
        }
        
        .table-list-header table, .table-choose-table { width: 100%; table-layout: fixed; border-collapse: collapse; color: var(--text-primary); }
        #table-list-container { overflow-y: auto; flex: 1; }
        
        .table-list-header th, .table-choose-table td { 
            padding: 8px 12px; 
            text-align: left; 
            overflow: hidden; 
            text-overflow: ellipsis; 
            white-space: nowrap; 
            color: var(--text-primary);
        }
        
        .table-choose-table td { border-bottom: 1px solid var(--border-color); }
        .table-choose-table tr:last-child td { border-bottom: none; }
        
        /* 乌鸦：表格行悬停高亮 */
        .table-choose-table tr:hover td { background-color: var(--bg-deep); }
        
        .col-checkbox { width: 50px; text-align: center; }
        .col-name { width: 35%; }
        .col-comment { width: 40%; color: var(--text-secondary); }
        .col-structure { width: 15%; text-align: center; }

        .right-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
        
        #table-choose-selected { 
            overflow-y:auto; 
            flex:1; 
            border: 1px solid var(--border-color); 
            border-radius:4px; 
            padding:8px; 
            background: var(--bg-light); 
        }
        
        .selected-table-item { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 5px 8px; 
            border-radius: 4px; 
            background: var(--bg-deep); /* 乌鸦：选中项用深色底 */
            margin-bottom: 5px; 
            color: var(--text-primary);
            border: 1px solid var(--border-color);
        }
        
        .remove-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px; padding: 0 5px; }
        .remove-btn:hover { color: var(--accent-red); }
        
        .table-choose-footer { display:flex; justify-content:space-between; align-items:center; margin-top:12px; flex-shrink:0; color: var(--text-primary); }
        
        /* 乌鸦：分页和操作按钮 */
        .pagination-btn, #table-choose-confirm, #table-choose-cancel, .search-btn { 
            padding: 5px 12px; 
            border-radius: 4px; 
            border: 1px solid var(--border-color); 
            cursor: pointer; 
            background: var(--bg-light); 
            color: var(--text-primary);
            transition: all 0.2s ease;
        }
        
        .pagination-btn:hover:not(:disabled), #table-choose-cancel:hover {
            background: var(--bg-deep);
            border-color: var(--accent-blue);
            color: var(--accent-blue);
        }

        .pagination-btn:disabled { opacity: 0.5; cursor: not-allowed; background: var(--bg-deep); }
        
        #table-choose-confirm, .search-btn { 
            background: var(--accent-blue); 
            color: white; 
            border-color: var(--accent-blue); 
        }
        
        #table-choose-confirm:hover, .search-btn:hover {
            background: var(--accent-blue-hover);
            border-color: var(--accent-blue-hover);
        }
        
        .empty-placeholder, .error-placeholder { text-align: center; color: var(--text-secondary); padding-top: 20px; }
        .error-placeholder { color: var(--accent-red); }
        .page-info { margin: 0 8px; color: var(--text-secondary); }
        .total-count { margin-left: 16px; color: var(--text-tertiary); }
        
        /* 乌鸦：下拉框适配 */
        #table-page-size {
            background: var(--bg-light);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
        }
    `;
    document.head.appendChild(style);
}

function createModal() {
    if (document.getElementById('table-choose-modal')) return;

    injectStyles();

    const modalElement = document.createElement('div');
    modalElement.id = 'table-choose-modal';
    modalElement.className = 'modal';
    modalElement.innerHTML = `
        <div class="modal-body table-choose-modal-body">
            <div class="table-choose-header-row">
                <h3>选择数据库表</h3>
                <h4>已选择 (<span id="selected-table-count">0</span>)</h4>
            </div>

            <div class="table-choose-main-content">
                <!-- Left Panel -->
                <div class="table-list-panel">
                    <div class="table-list-search">
                        <div class="search-input-wrapper">
                            <input type="text" id="table-search-input" class="table-choose-search-input" placeholder="输入表名..." maxlength="50">
                            <button id="clear-search-btn" class="clear-search-btn" title="清空">&times;</button>
                        </div>
                        <button id="table-search-btn" class="search-btn">搜索</button>
                    </div>
                    <div class="table-list-content">
                        <div class="table-list-header">
                            <table>
                                <thead>
                                    <tr>
                                        <th class="col-checkbox"></th>
                                        <th class="col-name">表名</th>
                                        <th class="col-comment">注释</th>
                                        <th class="col-structure">表结构</th>
                                    </tr>
                                </thead>
                            </table>
                        </div>
                        <div id="table-list-container"></div>
                    </div>
                </div>
                <!-- Right Panel -->
                <div class="right-panel">
                    <div id="table-choose-selected"></div>
                </div>
            </div>

            <!-- Footer -->
            <div class="table-choose-footer">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span>每页显示:</span>
                    <select id="table-page-size" style="padding:4px;border-radius:4px;">
                        <option value="20">20条</option>
                        <option value="50">50条</option>
                        <option value="100">100条</option>
                    </select>
                </div>
                <div id="table-choose-pagination"></div>
                <div style="display:flex;gap:8px;">
                    <button id="table-choose-confirm">确定</button>
                    <button id="table-choose-cancel">关闭</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalElement);
    modal = modalElement;

    // --- Bind events only once ---
    const searchInput = modal.querySelector('#table-search-input');
    const searchBtn = modal.querySelector('#table-search-btn');
    const clearSearchBtn = modal.querySelector('#clear-search-btn');

    function performSearch() {
        pageState.tableName = searchInput.value.trim();
        loadTablePage(1);
    }

    searchInput.addEventListener('input', () => {
        clearSearchBtn.style.display = searchInput.value ? 'block' : 'none';
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        performSearch();
        searchInput.focus();
    });

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    modal.querySelector('#table-page-size').addEventListener('change', function (e) {
        pageState.pageSize = parseInt(e.target.value);
        loadTablePage(1);
    });

    modal.querySelector('#table-choose-cancel').onclick = () => {
        modal.style.display = 'none';
        if (window.updateAllDynamicUI) {
            window.updateAllDynamicUI();
        }
    };

    modal.querySelector('#table-choose-confirm').onclick = async () => {
        const conv = getCurrentConversation();
        if (conv && conv.dbId) {
            if (!conv.dbSelections) {
                conv.dbSelections = {};
            }
            conv.dbSelections[conv.dbId] = [...selectedTables];
            console.log(`已选数据表已保存到当前会话 ${conv.id} 的数据库 ${conv.dbId} 下:`, conv.dbSelections[conv.dbId]);

            // 关键修复：立即保存状态
            if (window.saveToLocalStorage) {
                await window.saveToLocalStorage();
            }
        }
        modal.style.display = 'none';
        if (window.updateAllDynamicUI) {
            window.updateAllDynamicUI();
        }
    };

    modal.querySelector('#table-choose-selected').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
            const item = e.target.closest('.selected-table-item');
            const tableName = item.dataset.tableName;
            const index = selectedTables.indexOf(tableName);
            if (index > -1) selectedTables.splice(index, 1);
            renderSelectedTables();
            const checkbox = modal.querySelector(`#table-list-container input[data-table-name="${tableName}"]`);
            if (checkbox) checkbox.checked = false;
        }
    });

    modal.querySelector('#table-list-container').addEventListener('change', e => {
        if (e.target.type === 'checkbox') {
            const tableName = e.target.dataset.tableName;
            if (e.target.checked) {
                if (!selectedTables.includes(tableName)) selectedTables.push(tableName);

                // 乌鸦：保存表结构到会话对象
                const index = parseInt(e.target.dataset.index);
                if (!isNaN(index) && currentPageRecords[index]) {
                    const conv = getCurrentConversation();
                    if (conv) {
                        if (!conv.dbTableInfos) conv.dbTableInfos = {};
                        conv.dbTableInfos[tableName] = currentPageRecords[index].tableInfo;
                    }
                }
            } else {
                const index = selectedTables.indexOf(tableName);
                if (index > -1) selectedTables.splice(index, 1);
            }
            renderSelectedTables();
        }
    });

    modal.querySelector('#table-list-container').addEventListener('click', e => {
        // 乌鸦：处理查看表结构按钮
        if (e.target.classList.contains('view-struct-btn')) {
            e.stopPropagation(); // 阻止冒泡防止触发选中
            const index = parseInt(e.target.dataset.index);
            if (!isNaN(index) && currentPageRecords[index]) {
                const info = currentPageRecords[index].tableInfo || '暂无结构信息';
                showStructureDetail(currentPageRecords[index].tableName, info);
            }
            return;
        }

        // 如果点击的目标就是checkbox本身，则不执行任何操作，让默认行为和`change`事件处理
        if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
            return;
        }

        const row = e.target.closest('.table-row-clickable');
        if (row) {
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                // Manually trigger change event to update selection state
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
}

function initModalState() {
    const conv = getCurrentConversation();
    const dbId = conv?.dbId;

    if (dbId && conv.dbSelections && Array.isArray(conv.dbSelections[dbId])) {
        selectedTables = [...conv.dbSelections[dbId]];
    } else {
        selectedTables = [];
    }

    pageState.dbConnStr = '';
    if (conv && conv.dbId && window.state.dbConnections?.[conv.dbId]) {
        const db = window.state.dbConnections[conv.dbId];
        pageState.dbConnStr = `type=${db.type}~host=${db.host}~port=${db.port}~database=${db.database}~username=${db.username}~password=${db.password}`;
    }

    const searchInput = modal.querySelector('#table-search-input');
    modal.querySelector('#table-page-size').value = pageState.pageSize.toString();
    searchInput.value = '';
    pageState.tableName = '';
    // Also reset clear button visibility
    modal.querySelector('#clear-search-btn').style.display = 'none';
}

export function showTableChooseModal() {
    createModal();
    initModalState();

    modal.style.display = 'flex';

    renderSelectedTables();
    loadTablePage(1);
}

/**
 * 乌鸦：从 CREATE TABLE 语句中解析出字段信息
 * 支持 MySQL / PostgreSQL 等常见建表语法
 * @param {string} sql - 建表 SQL 语句
 * @returns {Array<{name: string, type: string, nullable: string, defaultVal: string, comment: string}>}
 */
function parseCreateTableSQL(sql) {
    const columns = [];
    if (!sql) return columns;

    // 乌鸦：匹配括号内的字段定义部分（第一个 '(' 到最后一个 ')' 之间）
    const bodyMatch = sql.match(/\((.+)\)/s);
    if (!bodyMatch) return columns;

    const body = bodyMatch[1];

    // 乌鸦：按行拆分，逐行解析字段定义
    const lines = body.split('\n');
    for (const line of lines) {
        const trimmed = line.trim().replace(/,\s*$/, ''); // 去掉末尾逗号

        // 乌鸦：跳过约束行（PRIMARY KEY, INDEX, UNIQUE, KEY, CONSTRAINT 等）
        if (/^(PRIMARY\s+KEY|UNIQUE|KEY|INDEX|CONSTRAINT|CHECK|FOREIGN)\b/i.test(trimmed)) {
            continue;
        }
        // 跳过空行和纯括号行
        if (!trimmed || trimmed === ')' || trimmed === '(') continue;

        // 乌鸦：匹配字段定义 —— 字段名（可能带反引号/双引号）+ 数据类型 + 修饰符
        const colMatch = trimmed.match(/^[`"']?(\w+)[`"']?\s+(\w+(?:\([^)]*\))?(?:\s+(?:unsigned|signed|zerofill))*)/i);
        if (!colMatch) continue;

        const name = colMatch[1];
        const type = colMatch[2];

        // 乌鸦：判断是否可空（NOT NULL 表示不可为空，默认可空）
        const nullable = /NOT\s+NULL/i.test(trimmed) ? 'NO' : 'YES';

        // 乌鸦：提取默认值
        let defaultVal = '';
        const defMatch = trimmed.match(/DEFAULT\s+('(?:[^'\\]|\\.)*'|\S+)/i);
        if (defMatch) {
            defaultVal = defMatch[1];
        }

        // 乌鸦：提取注释（COMMENT '...'）
        let comment = '';
        const commentMatch = trimmed.match(/COMMENT\s+'((?:[^'\\]|\\.)*)'/i);
        if (commentMatch) {
            comment = commentMatch[1].replace(/\\'/g, "'"); // 反转义
        }

        columns.push({ name, type, nullable, defaultVal, comment });
    }
    return columns;
}

/**
 * 乌鸦：HTML 转义工具函数，防 XSS
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的安全字符串
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 乌鸦：注入表结构弹窗专用的页签样式（只注入一次）
 */
function injectStructStyles() {
    const styleId = 'table-struct-tab-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        /* 乌鸦：表结构弹窗 - 页签容器 */
        .struct-tab-bar {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border-color);
            background: var(--bg-deep);
            flex-shrink: 0;
        }
        /* 乌鸦：单个页签按钮 */
        .struct-tab-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 0;           /* 乌鸦：强制覆盖全局button圆角 */
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 14px;
            border-bottom: 2px solid transparent;
            transition: color 0.2s ease, border-bottom-color 0.2s ease;
        }
        .struct-tab-btn:hover {
            color: var(--text-primary);
            background: transparent;    /* 乌鸦：确保hover时无背景 */
        }
        /* 乌鸦：激活状态的页签 —— 只有底部蓝线，无背景 */
        .struct-tab-btn.active {
            color: var(--accent-blue);
            border-bottom-color: var(--accent-blue);
            background: transparent;
            font-weight: 600;
        }
        /* 乌鸦：页签内容区 */
        .struct-tab-content {
            display: none;
            flex: 1;
            overflow: auto;
            background: var(--bg-light);
        }
        .struct-tab-content.active {
            display: block;
        }
        /* 乌鸦：字段信息表格样式 */
        .struct-field-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            color: var(--text-primary);
        }
        .struct-field-table thead {
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .struct-field-table th {
            background: var(--bg-deep);
            padding: 10px 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid var(--border-color);
            white-space: nowrap;
        }
        .struct-field-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--border-color);
            word-break: break-word;
        }
        .struct-field-table tbody tr:hover td {
            background: var(--bg-deep);
        }
        .struct-field-table tbody tr:last-child td {
            border-bottom: none;
        }
        /* 乌鸦：可空列标记颜色 */
        .struct-nullable-no {
            color: var(--accent-red, #e74c3c);
            font-weight: 600;
        }
        .struct-nullable-yes {
            color: var(--text-tertiary);
        }
    `;
    document.head.appendChild(style);
}

function showStructureDetail(tableName, content) {
    // 移除旧的（如果存在）
    const old = document.getElementById('table-structure-modal');
    if (old) old.remove();

    // 乌鸦：注入页签样式
    injectStructStyles();

    // 乌鸦：解析建表SQL，提取字段信息
    const columns = parseCreateTableSQL(content);

    // 乌鸦：生成字段信息表格 HTML
    let tableHtml;
    if (columns.length > 0) {
        const rows = columns.map(col => `
            <tr>
                <td><code>${escapeHtml(col.name)}</code></td>
                <td><code>${escapeHtml(col.type)}</code></td>
                <td class="${col.nullable === 'NO' ? 'struct-nullable-no' : 'struct-nullable-yes'}">${col.nullable}</td>
                <td>${escapeHtml(col.defaultVal) || '<span style="color:var(--text-tertiary)">-</span>'}</td>
                <td>${escapeHtml(col.comment) || '<span style="color:var(--text-tertiary)">-</span>'}</td>
            </tr>
        `).join('');
        tableHtml = `
            <table class="struct-field-table">
                <thead>
                    <tr>
                        <th>字段名</th>
                        <th>类型</th>
                        <th>可空</th>
                        <th>默认值</th>
                        <th>注释</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    } else {
        // 乌鸦：解析失败兜底，直接展示原文
        tableHtml = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">无法解析字段信息，请查看「建表语句」页签</div>`;
    }

    // 乌鸦：对建表语句做 HTML 转义（防 XSS）
    const escaped = escapeHtml(content);

    const div = document.createElement('div');
    div.id = 'table-structure-modal';
    div.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 10001;
        display: flex; align-items: center; justify-content: center;
    `;
    div.innerHTML = `
        <div style="
            background: var(--bg-medium); 
            color: var(--text-primary);
            width: 860px; max-width: 90vw; height: 80vh; 
            border-radius: 8px; display: flex; flex-direction: column;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        ">
            <div style="padding: 15px 15px 0; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin:0;">表结构: ${tableName}</h3>
                <button id="close-struct-btn" style="background:none; border:none; color:var(--text-primary); cursor:pointer; font-size:20px;">&times;</button>
            </div>
            <!-- 乌鸦：页签栏 -->
            <div class="struct-tab-bar" style="margin-top: 10px;">
                <button class="struct-tab-btn active" data-tab="fields">字段信息</button>
                <button class="struct-tab-btn" data-tab="ddl">建表语句</button>
            </div>
            <!-- 乌鸦：字段信息页签（默认展示） -->
            <div class="struct-tab-content active" data-tab-content="fields" style="padding: 0;">
                ${tableHtml}
            </div>
            <!-- 乌鸦：建表语句页签（带语法高亮） -->
            <div class="struct-tab-content" data-tab-content="ddl" style="padding: 15px;">
                <pre style="margin:0; border-radius: 6px;"><code class="language-sql" style="white-space: pre-wrap; font-family: monospace;">${escaped}</code></pre>
            </div>
            <div style="padding: 10px 15px; border-top: 1px solid var(--border-color); text-align: right; flex-shrink: 0;">
                <button id="close-struct-btn-2" style="padding: 6px 16px; background: var(--accent-blue); color: white; border: none; border-radius: 4px; cursor: pointer;">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(div);

    // 乌鸦：使用项目已有的 highlight.js 对 SQL 代码块进行语法高亮
    const codeBlock = div.querySelector('code.language-sql');
    if (codeBlock && typeof hljs !== 'undefined') {
        hljs.highlightElement(codeBlock);
    }

    // 乌鸦：页签切换逻辑
    div.querySelectorAll('.struct-tab-btn').forEach(btn => {
        btn.onclick = () => {
            const tabName = btn.dataset.tab;
            // 切换按钮激活状态
            div.querySelectorAll('.struct-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 切换内容区显示
            div.querySelectorAll('.struct-tab-content').forEach(c => c.classList.remove('active'));
            div.querySelector(`[data-tab-content="${tabName}"]`).classList.add('active');
        };
    });

    const close = () => div.remove();
    div.querySelector('#close-struct-btn').onclick = close;
    div.querySelector('#close-struct-btn-2').onclick = close;
    div.onclick = (e) => { if (e.target === div) close(); };
}
