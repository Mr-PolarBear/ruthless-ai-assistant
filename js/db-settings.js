/**
 * @file db-settings.js
 * @description 数据库连接设置管理
 */

import {state} from './state.js?v=260823';
import {dom} from './dom.js?v=260823';
import {openDB, DB_CONNECTIONS_STORE} from './db.js?v=260823';
import {DraggableList} from './draggable-list.js?v=260823';
import {saveAppSettings} from './utils.js?v=260823'; // 乌鸦：导入保存设置函数

// 乌鸦：数据库连接拖拽实例
let databaseConnectionDragInstance = null;

/**
 * 初始化数据库连接管理
 */
export function initDatabaseSettings() {
    // 从IndexedDB加载数据库连接配置
    loadDatabaseConnections();

    // 绑定事件处理程序
    bindDatabaseEvents();

    // 渲染数据库连接列表
    renderDatabaseConnections();

    // 乌鸦：加载全局表接口设置
    if (dom.globalDbTableUrlInput && state.appSettings) {
        dom.globalDbTableUrlInput.value = state.appSettings.dbTableFetchUrl || '';
    }
}

/**
 * 从IndexedDB加载数据库连接配置
 */
async function loadDatabaseConnections() {
    try {
        const db = await openDB();

        // 从 IndexedDB 获取数据
        const connections = await getDbConnectionsFromIDB(db);
        state.dbConnections = connections || {};

        // 迁移旧数据（从localStorage到IndexedDB）
        await migrateFromLocalStorage();

        // 渲染数据库连接列表
        renderDatabaseConnections();
    } catch (error) {
        console.error('加载数据库连接配置失败:', error);
        state.dbConnections = {};
        renderDatabaseConnections();
    }
}

/**
 * 从IndexedDB获取数据库连接
 * @param {IDBDatabase} db - 数据库实例
 * @returns {Promise<Object>} 数据库连接对象
 */
function getDbConnectionsFromIDB(db) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([DB_CONNECTIONS_STORE], 'readonly');
            const store = transaction.objectStore(DB_CONNECTIONS_STORE);
            const request = store.get('all_connections');

            request.onsuccess = (event) => resolve(event.target.result || {});
            request.onerror = (event) => reject(event.target.errorCode);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 从localStorage迁移数据到IndexedDB
 */
async function migrateFromLocalStorage() {
    try {
        const savedConnections = localStorage.getItem('ai-chat-db-connections');
        if (savedConnections) {
            const connections = JSON.parse(savedConnections);

            // 合并从localStorage读取的连接和从IndexedDB读取的连接
            const mergedConnections = {...state.dbConnections};

            // 将localStorage中的连接添加到合并对象
            for (const [id, conn] of Object.entries(connections)) {
                if (!mergedConnections[id]) {
                    mergedConnections[id] = conn;
                }
            }

            // 更新状态
            state.dbConnections = mergedConnections;

            // 保存到IndexedDB
            await saveDatabaseConnections();

            // 迁移完成后从localStorage中删除旧数据
            localStorage.removeItem('ai-chat-db-connections');

            console.log('数据库连接配置已从localStorage迁移到IndexedDB');
        }
    } catch (error) {
        console.error('从localStorage迁移数据库连接配置失败:', error);
    }
}

/**
 * 保存数据库连接配置到IndexedDB
 */
async function saveDatabaseConnections() {
    try {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([DB_CONNECTIONS_STORE], 'readwrite');
            const store = transaction.objectStore(DB_CONNECTIONS_STORE);
            const request = store.put(state.dbConnections, 'all_connections');

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error('保存数据库连接配置失败:', event);
                reject(event.target.errorCode);
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.errorCode);
        });
    } catch (error) {
        console.error('保存数据库连接配置失败:', error);
        throw error;
    }
}

/**
 * 绑定数据库设置页面事件处理程序
 */
function bindDatabaseEvents() {
    // 添加新数据库连接按钮
    dom.addNewDbBtn.addEventListener('click', () => {
        resetDbForm();
        // 显示表单区域
        const formSection = document.getElementById('db-connection-form-section');
        formSection.style.display = 'block';

        // 滚动到表单
        formSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // 保存数据库连接按钮
    dom.dbSaveBtn.addEventListener('click', saveDbConnection);

    // 取消编辑按钮
    dom.dbCancelBtn.addEventListener('click', () => {
        resetDbForm();
        // 隐藏表单区域
        const formSection = document.getElementById('db-connection-form-section');
        formSection.style.display = 'none';
    });

    // 测试连接按钮
    dom.dbTestBtn.addEventListener('click', testDbConnection);

    // 密码显示/隐藏按钮
    dom.dbTogglePasswordBtn.addEventListener('click', togglePasswordVisibility);

    // 乌鸦：恢复默认表获取URL按钮
    if (dom.dbResetTableUrlBtn) {
        dom.dbResetTableUrlBtn.addEventListener('click', () => {
            dom.dbTableFetchUrlInput.value = '';
        });
    }

    // 乌鸦：全局数据库设置事件
    if (dom.saveGlobalDbSettingsBtn) {
        dom.saveGlobalDbSettingsBtn.addEventListener('click', saveGlobalDbSettings);
    }
    
    if (dom.resetGlobalDbUrlBtn) {
        dom.resetGlobalDbUrlBtn.addEventListener('click', () => {
            if (dom.globalDbTableUrlInput) dom.globalDbTableUrlInput.value = '';
        });
    }
}

/**
 * 乌鸦：保存全局数据库接口设置
 */
async function saveGlobalDbSettings() {
    if (!state.appSettings) state.appSettings = {};
    const url = dom.globalDbTableUrlInput.value.trim();
    state.appSettings.dbTableFetchUrl = url;
    
    try {
        saveAppSettings(); 
        alert('全局数据库接口设置已保存');
    } catch (error) {
        console.error('保存全局设置失败:', error);
        alert('保存全局设置失败');
    }
}

/**
 * 切换密码显示/隐藏状态
 */
function togglePasswordVisibility() {
    const passwordInput = dom.dbPasswordInput;
    const toggleBtn = dom.dbTogglePasswordBtn;

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '隐藏';
    } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '显示';
    }
}

/**
 * 重置数据库连接表单
 */
function resetDbForm() {
    dom.dbFormTitle.textContent = '添加新数据库连接';
    dom.dbIdInput.value = '';
    dom.dbNameInput.value = '';
    dom.dbTypeSelector.value = 'mysql';
    dom.dbHostInput.value = '';
    dom.dbPortInput.value = '';
    dom.dbDatabaseInput.value = '';
    dom.dbUsernameInput.value = '';
    dom.dbPasswordInput.value = '';
    // dom.dbEnabledToggle.checked = true; // 已移除启用开关
    dom.dbCancelBtn.style.display = 'none';
}

/**
 * 保存数据库连接信息
 */
async function saveDbConnection() {
    const id = dom.dbIdInput.value || `db_${Date.now()}`;
    const name = dom.dbNameInput.value.trim();
    const type = dom.dbTypeSelector.value;
    const host = dom.dbHostInput.value.trim();
    const port = dom.dbPortInput.value.trim();
    const database = dom.dbDatabaseInput.value.trim();
    const username = dom.dbUsernameInput.value.trim();
    const password = dom.dbPasswordInput.value;
    // const enabled = dom.dbEnabledToggle.checked; // 已移除启用开关
    const enabled = true; // 默认始终启用

    // 简单验证
    if (!name) {
        alert('请输入连接名称');
        return;
    }

    if (!host) {
        alert('请输入主机地址');
        return;
    }

    // 乌鸦：为新数据库连接计算sort值
    let sort = 0;
    if (!dom.dbIdInput.value) { // 新数据库连接
        const existingConnections = Object.values(state.dbConnections);
        const maxSort = existingConnections.length > 0 
            ? Math.max(...existingConnections.map(conn => conn.sort || 0))
            : 0;
        sort = maxSort + 10;
    } else { // 编辑现有连接，保持原有sort值
        sort = state.dbConnections[id]?.sort || 0;
    }

    // 保存到状态
    state.dbConnections[id] = {
        id,
        name,
        type,
        host,
        port,
        database,
        username,
        password,
        enabled,
        sort // 乌鸦：添加sort字段
    };

    // 保存到IndexedDB
    try {
        await saveDatabaseConnections();

        // 重新渲染列表
        renderDatabaseConnections();

        // 重置表单
        resetDbForm();

        // 隐藏表单区域
        const formSection = document.getElementById('db-connection-form-section');
        formSection.style.display = 'none';
    } catch (error) {
        console.error('保存数据库连接失败:', error);
        alert('保存数据库连接失败，请重试');
    }
}

/**
 * 渲染数据库连接列表
 */
function renderDatabaseConnections() {
    const listContainer = dom.databaseConnectionList;
    listContainer.innerHTML = '';

    // 如果没有连接，显示提示信息
    if (Object.keys(state.dbConnections).length === 0) {
        listContainer.innerHTML = '<p class="empty-list-message">暂无数据库连接，请点击"添加新数据库连接"按钮创建。</p>';
        return;
    }

    // 创建列表
    const table = document.createElement('table');
    table.className = 'settings-table';

    // 表头
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>名称</th>
            <th>类型</th>
            <th>主机</th>
            <!--<th>状态</th>-->
            <th>操作</th>
        </tr>
    `;
    table.appendChild(thead);

    // 表格内容
    const tbody = document.createElement('tbody');

    // 按名称排序
    // 乌鸦：改为按sort字段排序，确保每个连接都有sort值
    const sortedConnections = Object.values(state.dbConnections)
        .map(conn => {
            if (typeof conn.sort !== 'number') {
                conn.sort = 0; // 为没有sort值的连接设置默认值
            }
            return conn;
        })
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));

    for (const conn of sortedConnections) {
        const tr = document.createElement('tr');
        tr.draggable = true; // 乌鸦：为数据库连接列表添加拖拽功能
        tr.dataset.id = conn.id; // 乌鸦：添加data-id属性用于拖拽识别
        tr.innerHTML = `
            <td>${conn.name}</td>
            <td>${getDbTypeName(conn.type)}</td>
            <td>${conn.host}${conn.port ? ':' + conn.port : ''}</td>
            <!--<td>${conn.enabled ? '<span class=\"status-enabled\">启用</span>' : '<span class=\"status-disabled\">禁用</span>'}</td>-->
            <td class="settings-table-actions action-btn-group" style="display:flex;gap:4px;align-items:center;">
                <button class="action-btn edit db-edit-btn" data-id="${conn.id}" title="编辑">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn copy db-copy-btn" data-id="${conn.id}" title="复制">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <button class="action-btn delete db-delete-btn" data-id="${conn.id}" title="删除">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    listContainer.appendChild(table);

    // 绑定编辑和删除按钮事件
    // 绑定编辑和删除按钮事件
    listContainer.querySelectorAll('.db-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            editDbConnection(btn.dataset.id);
        });
    });

    listContainer.querySelectorAll('.db-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            copyDbConnection(btn.dataset.id);
        });
    });

    listContainer.querySelectorAll('.db-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteDbConnection(btn.dataset.id);
        });
    });
    
    // 乌鸦：为数据库连接列表添加拖拽功能
    setupDatabaseConnectionDrag(tbody);
}

/**
 * 获取数据库类型的中文名称
 * @param {string} type 数据库类型编码
 * @returns {string} 数据库类型中文名称
 */
function getDbTypeName(type) {
    const typeMap = {
        'mysql': 'MySQL',
        'postgresql': 'PostgreSQL',
        'mongodb': 'MongoDB',
        'sqlserver': 'SQL Server',
        'oracle': 'Oracle',
        'sqlite': 'SQLite'
    };
    return typeMap[type] || type;
}

/**
 * 编辑数据库连接
 * @param {string} id 数据库连接ID
 */
function editDbConnection(id) {
    const conn = state.dbConnections[id];
    if (!conn) return;

    // 设置表单标题
    dom.dbFormTitle.textContent = `编辑数据库连接: ${conn.name}`;

    // 填充表单
    dom.dbIdInput.value = conn.id;
    dom.dbNameInput.value = conn.name;
    dom.dbTypeSelector.value = conn.type;
    dom.dbHostInput.value = conn.host;
    dom.dbPortInput.value = conn.port;
    dom.dbDatabaseInput.value = conn.database;
    dom.dbUsernameInput.value = conn.username;
    dom.dbPasswordInput.value = conn.password;
    // dom.dbEnabledToggle.checked = conn.enabled; // 已移除启用开关

    // 显示取消按钮
    dom.dbCancelBtn.style.display = 'inline-block';

    // 显示表单区域
    const formSection = document.getElementById('db-connection-form-section');
    formSection.style.display = 'block';

    // 滚动到表单
    dom.dbFormTitle.scrollIntoView({behavior: 'smooth'});
}

/**
 * 删除数据库连接
 * @param {string} id 数据库连接ID
 */
async function deleteDbConnection(id) {
    if (!confirm('确定要删除此数据库连接吗？此操作不可撤销。')) return;

    // 1. 从 state 中删除数据库连接配置
    delete state.dbConnections[id];

    // 2. 遍历所有会话，清理与该数据库相关的表选择数据
    for (const convId in state.conversations) {
        const conv = state.conversations[convId];
        if (conv.dbSelections && conv.dbSelections[id]) {
            delete conv.dbSelections[id];
            console.log(`已清理会话 ${convId} 中与数据库 ${id} 相关的表选择数据。`);
        }
        // 同时，如果当前会话正使用这个数据库，则清空选择
        if (conv.dbId === id) {
            conv.dbId = null;
        }
    }

    try {
        // 3. 将更新后的数据库连接和会话状态保存到持久化存储
        await saveDatabaseConnections();
        if (window.saveToLocalStorage) {
            await window.saveToLocalStorage(); // 这个函数会保存整个 state，包括 conversations
        }

        // 4. 重新渲染UI
        renderDatabaseConnections();
        if (window.updateAllDynamicUI) {
            window.updateAllDynamicUI(); // 更新主界面按钮状态
        }

    } catch (error) {
        console.error('删除数据库连接失败:', error);
        alert('删除数据库连接失败，请重试');
    }
}

/**
 * 测试数据库连接
 */
function testDbConnection() {
    const type = dom.dbTypeSelector.value;
    const host = dom.dbHostInput.value.trim();
    const port = dom.dbPortInput.value.trim();
    const database = dom.dbDatabaseInput.value.trim();
    const username = dom.dbUsernameInput.value.trim();

    // 简单验证
    if (!host) {
        alert('请输入主机地址');
        return;
    }

    // 在真实环境中，这里应该发送请求到后端进行实际的数据库连接测试
    // 这里仅做模拟演示
    alert(`模拟测试连接: ${type}://${username}@${host}:${port}/${database}\n\n由于安全限制，浏览器无法直接连接数据库。实际应用中，此功能应通过后端API实现。`);
}

/**
 * 复制数据库连接
 * @param {string} id 数据库连接ID
 */
async function copyDbConnection(id) {
    const conn = state.dbConnections[id];
    if (!conn) return;

    if (confirm(`您确定要复制 "${conn.name}" 这个连接吗？`)) {
        // 创建新ID
        const newId = `db_copy_${Date.now()}`;
        
        // 乌鸦：为复制的数据库连接计算新的sort值
        const existingConnections = Object.values(state.dbConnections);
        const maxSort = existingConnections.length > 0 
            ? Math.max(...existingConnections.map(conn => conn.sort || 0))
            : 0;
        
        // 复制连接并重命名
        const newConn = {
            ...conn,
            id: newId,
            name: `${conn.name} (副本)`,
            sort: maxSort + 10 // 乌鸦：添加sort字段
        };
        
        // 保存到状态
        state.dbConnections[newId] = newConn;
        
        // 保存到IndexedDB
        try {
            await saveDatabaseConnections();
            renderDatabaseConnections();
        } catch (error) {
            console.error('复制数据库连接失败:', error);
            alert('复制数据库连接失败，请重试');
        }
    }
}

/**
 * 乌鸦：为数据库连接列表设置拖拽功能
 * @param {HTMLElement} tbody - 表格体元素
 */
function setupDatabaseConnectionDrag(tbody) {
    if (databaseConnectionDragInstance) {
        databaseConnectionDragInstance.destroy();
    }
    
    databaseConnectionDragInstance = new DraggableList(tbody, {
        itemSelector: 'tr[draggable="true"]',
        onDrop: (fromIndex, toIndex) => {
            // 乌鸦：获取所有数据库连接，按当前显示顺序
            const connections = Object.values(state.dbConnections)
                .map(conn => {
                    if (typeof conn.sort !== 'number') {
                        conn.sort = 0;
                    }
                    return conn;
                })
                .sort((a, b) => (a.sort || 0) - (b.sort || 0));
            
            if (fromIndex >= connections.length || toIndex >= connections.length) return;
            
            // 乌鸦：移动元素并重新计算sort值
            const [movedConnection] = connections.splice(fromIndex, 1);
            connections.splice(toIndex, 0, movedConnection);
            
            // 乌鸦：重新设置sort值（使甉10的倍数）
            connections.forEach((conn, index) => {
                conn.sort = (index + 1) * 10;
                state.dbConnections[conn.id] = conn;
            });
            
            // 乌鸦：保存数据并重新渲染
            saveDatabaseConnections().then(() => {
                renderDatabaseConnections();
            }).catch(error => {
                console.error('保存数据库连接顺序失败:', error);
                alert('保存数据库连接顺序失败，请重试');
            });
        }
    });
} 