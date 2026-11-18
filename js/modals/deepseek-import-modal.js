/**
 * @file deepseek-import-modal.js
 * @description DeepSeek 官方导出会话导入工具的【交互层】：
 *   弹窗开关、文件选择、列表渲染(排序/过滤/勾选)、会话预览(markdown 安全渲染)、导入编排。
 *   纯逻辑（结构校验/分支建树/消息转换/附件索引）见 deepseek-import-core.js。
 *
 * 设计说明：
 * 1. 数据链路：选择文件夹/JSON -> 解析校验 -> 列表 -> 预览
 *    -> convertSession 转换 -> 收口到 utils.importConversations() 完成冲突处理与落库；
 * 2. 附件策略：is_image=true 且源文件在所选目录 -> 预览从 File 对象直接读（零存储成本）；
 *    导入默认仅标注文件名，勾选"嵌入图片"才写 base64（防 IndexedDB 膨胀）；
 * 3. 本模块独立高内聚，不污染 utils/chat-events 等大文件。
 */

import { notify } from '../ui-updater.js?v=temp';
import { importConversations, escapeHtml } from '../utils.js?v=temp';
import { regexPatterns } from '../regex.js?v=temp';
import {
    registerFile,
    findAttachedFile,
    buildSessionModel,
    convertSession
} from './deepseek-import-core.js?v=temp';

// ==================== 模块内状态 ====================
const ds = {
    sessions: [],            // 解析出的合法会话 [{raw, meta, paths, activeIdx}]
    selectedIds: new Set(),  // 勾选的会话 id
    activeSessionId: null,   // 当前预览的会话 id
    sortMode: 'time',        // 'time' | 'title'
    filterText: '',
    fileMap: new Map(),      // 归一化相对路径(小写) -> File（附件预览/嵌入用）
    previewUrls: [],         // 预览产生的 ObjectURL（切换/关闭时统一 revoke）
    importing: false,
    eventsBound: false
};

let els = null; // DOM 引用缓存

/** 缓存弹窗内所有 DOM 引用 */
function cacheEls() {
    els = {
        modal: document.getElementById('deepseek-import-modal'),
        pickFolderBtn: document.getElementById('ds-pick-folder-btn'),
        pickFilesBtn: document.getElementById('ds-pick-files-btn'),
        folderInput: document.getElementById('ds-folder-input'),
        filesInput: document.getElementById('ds-files-input'),
        loadSummary: document.getElementById('ds-load-summary'),
        filterInput: document.getElementById('ds-filter-input'),
        sortTimeBtn: document.getElementById('ds-sort-time-btn'),
        sortTitleBtn: document.getElementById('ds-sort-title-btn'),
        list: document.getElementById('ds-session-list'),
        preview: document.getElementById('ds-session-preview'),
        optSearchRefs: document.getElementById('ds-opt-search-refs'),
        optEmbedImages: document.getElementById('ds-opt-embed-images'),
        checkAllBtn: document.getElementById('ds-check-all-btn'),
        checkNoneBtn: document.getElementById('ds-check-none-btn'),
        importSelectedBtn: document.getElementById('ds-import-selected-btn'),
        importAllBtn: document.getElementById('ds-import-all-btn'),
        selectedCount: document.getElementById('ds-selected-count')
    };
}

/**
 * 工具箱入口：打开导入弹窗。
 * 每次打开重置数据状态（不缓存上次的会话，防止脏数据误导入）。
 */
export function openDeepseekImportModal() {
    cacheEls();
    if (!els.modal) {
        notify.error('导入弹窗未加载，请刷新页面后重试');
        return;
    }
    bindEventsOnce();
    resetState();
    renderAll();
    // 系统通用 closeModalWithAnimation 关弹窗时会留内联 style.display='none'，
    // 它会压过 .visible 的 display:flex —— 每次打开必须显式恢复，否则二次打开隐身（已踩坑）
    els.modal.style.display = 'flex';
    els.modal.classList.add('visible');
}

/** 事件只绑定一次（模块级 flag） */
function bindEventsOnce() {
    if (ds.eventsBound) return;
    ds.eventsBound = true;

    // 文件夹选择优先走 File System Access API（showDirectoryPicker）：
    // webkitdirectory 的原生确认框会提示"上传N个文件到此网站"，文案误导且无法去掉；
    // showDirectoryPicker 的授权框是"查看文件"语义，与本工具纯本地处理的事实一致。
    els.pickFolderBtn.addEventListener('click', () => pickDirectory());
   
    els.pickFilesBtn.addEventListener('click', () => els.filesInput.click());
    els.folderInput.addEventListener('change', e => handleFilesPicked(e.target.files));
    els.filesInput.addEventListener('change', e => handleFilesPicked(e.target.files));

    els.filterInput.addEventListener('input', () => {
        ds.filterText = els.filterInput.value.trim().toLowerCase();
        renderList();
    });
    els.sortTimeBtn.addEventListener('click', () => switchSort('time'));
    els.sortTitleBtn.addEventListener('click', () => switchSort('title'));

    els.checkAllBtn.addEventListener('click', () => {
        sortedSessions().forEach(s => ds.selectedIds.add(s.raw.id));
        renderList();
        refreshImportButtons();
    });
    els.checkNoneBtn.addEventListener('click', () => {
        ds.selectedIds.clear();
        renderList();
        refreshImportButtons();
    });

    els.importSelectedBtn.addEventListener('click', () => doImport([...ds.selectedIds]));
    els.importAllBtn.addEventListener('click', () => doImport(ds.sessions.map(s => s.raw.id)));

    // 点击遮罩空白关闭（与全局 modal 习惯一致，关闭前清理预览 ObjectURL）
    els.modal.addEventListener('click', e => {
        if (e.target === els.modal) closeModal();
    });
    // 关闭按钮走全局 .modal-close-btn 默认分支（会移除 visible），这里额外挂清理
    const closeBtn = els.modal.querySelector('.modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => revokePreviewUrls());
}

/** 关闭弹窗并清理预览资源 */
function closeModal() {
    revokePreviewUrls();
    els.modal.classList.remove('visible');
}

/** 重置全部解析状态 */
function resetState() {
    revokePreviewUrls();
    ds.sessions = [];
    ds.selectedIds.clear();
    ds.activeSessionId = null;
    ds.sortMode = 'time';
    ds.filterText = '';
    ds.fileMap.clear();
    ds.importing = false;
    els.filterInput.value = '';
    els.optSearchRefs.checked = false;
    els.optEmbedImages.checked = false;
    switchSort('time');
}

/** 预览图片用的是 createObjectURL，必须及时 revoke 防内存泄漏 */
function revokePreviewUrls() {
    ds.previewUrls.forEach(u => URL.revokeObjectURL(u));
    ds.previewUrls = [];
}

// ==================== 文件选择与解析 ====================

/**
 * 目录选择入口：优先 showDirectoryPicker（无"上传到网站"误导提示），
 * 不支持的老浏览器（Firefox/Safari 旧版）回退 webkitdirectory input。
 * 注意：必须在用户手势链上直接 await，否则浏览器会拒弹授权框。
 */
async function pickDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
        els.folderInput.click();
        return;
    }
    let dirHandle;
    try {
        dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
        if (e && e.name !== 'AbortError') console.warn('[DeepSeek导入] 目录选择异常:', e);
        return; // AbortError = 用户主动取消，静默
    }
    const files = await walkDirectory(dirHandle, `${dirHandle.name}/`);
    if (files.length) handleFilesPicked(files);
    else notify.warning('所选文件夹为空');
}

/**
 * 递归遍历 FileSystemDirectoryHandle 收集所有 File。
 * File 是只读对象，相对路径挂到自定义属性 _dsRelPath 上，
 * 前缀带所选目录名（与 webkitRelativePath 语义对齐，core 的路径后缀匹配才能命中附件）。
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} prefix - 当前递归层的路径前缀（含尾部 '/'）
 */
async function walkDirectory(dirHandle, prefix) {
    const files = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            const f = await entry.getFile();
            f._dsRelPath = prefix + entry.name;
            files.push(f);
        } else if (entry.kind === 'directory') {
            files.push(...await walkDirectory(entry, `${prefix}${entry.name}/`));
        }
    }
    return files;
}

/**
 * 处理所选文件（文件夹或散选 JSON）。
 * 1. 所有 File 先注册进 fileMap（附件匹配要用 webkitRelativePath）；
 * 2. 过滤 .json 逐个解析并做结构校验；
 * 3. 合法会话建预览模型（分支路径等），非法文件计数。
 */
async function handleFilesPicked(fileList) {
    const files = Array.from(fileList || []);
    els.folderInput.value = '';
    els.filesInput.value = '';
    if (!files.length) return;

    // 先全量注册附件文件（json 也会被注册，无害）
    files.forEach(f => registerFile(ds.fileMap, f));

    const jsonFiles = files.filter(f => regexPatterns.deepseekJsonFileExt.test(f.name));
    if (!jsonFiles.length) {
        notify.warning('所选内容中没有 .json 文件，请选择 DeepSeek 导出的 chat_sessions 目录或会话 JSON');
        return;
    }

    els.loadSummary.textContent = `解析中... (0/${jsonFiles.length})`;
    setToolbarBusy(true);

    const ok = [];
    let badCount = 0;
    for (let i = 0; i < jsonFiles.length; i++) {
        try {
            const text = await jsonFiles[i].text();
            const raw = JSON.parse(text);
            const model = buildSessionModel(raw);
            if (model) ok.push(model);
            else badCount++;
        } catch (err) {
            badCount++;
        }
        if ((i + 1) % 20 === 0) {
            els.loadSummary.textContent = `解析中... (${i + 1}/${jsonFiles.length})`;
            await new Promise(r => setTimeout(r, 0)); // 让出主线程防长列表卡死
        }
    }

    ds.sessions = ok;
    // 默认不勾选任何会话：批量导入是破坏性操作的前奏，
    // 必须由大爷逐条确认勾选（或显式点"全选"），杜绝误导入
    ds.selectedIds = new Set();
    ds.activeSessionId = null;
    setToolbarBusy(false);

    const skipped = badCount ? `，跳过非法文件 ${badCount} 个` : '';
    els.loadSummary.textContent = `识别 ${ok.length} 个会话${skipped}`;
    if (!ok.length) {
        notify.warning('未识别到合法的 DeepSeek 会话 JSON（需要含 id/title/messages 结构）');
    } else if (badCount) {
        notify.warning(`成功识别 ${ok.length} 个会话，${badCount} 个文件结构不符被跳过`);
    }
    renderAll();
}

function setToolbarBusy(busy) {
    els.pickFolderBtn.disabled = busy;
    els.pickFilesBtn.disabled = busy;
}

// ==================== 列表渲染 ====================

function switchSort(mode) {
    ds.sortMode = mode;
    if (els) {
        els.sortTimeBtn.classList.toggle('active', mode === 'time');
        els.sortTitleBtn.classList.toggle('active', mode === 'title');
    }
    if (els && els.modal && els.modal.classList.contains('visible')) renderList();
}

function sortedSessions() {
    const list = [...ds.sessions];
    if (ds.sortMode === 'title') {
        list.sort((a, b) => a.meta.title.localeCompare(b.meta.title, 'zh-Hans-CN'));
    } else {
        list.sort((a, b) => String(b.meta.updatedAt).localeCompare(String(a.meta.updatedAt)));
    }
    return list;
}

function filteredSessions() {
    const list = sortedSessions();
    if (!ds.filterText) return list;
    return list.filter(s => String(s.meta.title).toLowerCase().includes(ds.filterText));
}

function renderAll() {
    renderList();
    renderPreview();
    refreshImportButtons();
}

function renderList() {
    const list = filteredSessions();
    if (!ds.sessions.length) {
        els.list.innerHTML = `<div class="ds-list-empty">请选择 DeepSeek 官方导出的文件夹<br><span style="font-size:0.75rem;">（deepseek_data-xxxx/chat_sessions 或其中的 JSON 文件）</span></div>`;
        refreshImportButtons();
        return;
    }
    if (!list.length) {
        els.list.innerHTML = `<div class="ds-list-empty">没有匹配「${escapeHtml(ds.filterText)}」的会话</div>`;
        refreshImportButtons();
        return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(s => {
        const item = document.createElement('div');
        item.className = 'ds-session-item' + (s.raw.id === ds.activeSessionId ? ' active' : '');
        item.dataset.id = s.raw.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = ds.selectedIds.has(s.raw.id);
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            if (cb.checked) ds.selectedIds.add(s.raw.id);
            else ds.selectedIds.delete(s.raw.id);
            refreshImportButtons();
        });

        const body = document.createElement('div');
        body.className = 'ds-session-item-body';

        const badges = [];
        if (s.meta.branchCount > 1) badges.push(`<span class="ds-meta-badge">分支×${s.meta.branchCount}</span>`);
        if (s.meta.attachCount) badges.push(`<span class="ds-meta-badge">附件×${s.meta.attachCount}</span>`);
        if (s.meta.hasThink) badges.push(`<span class="ds-meta-badge">思维链</span>`);
        if (s.meta.hasSearch) badges.push(`<span class="ds-meta-badge">联网</span>`);
        const pinIcon = s.meta.pinned
            ? '<svg class="ds-pin-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>'
            : '';
        body.innerHTML = `
            <div class="ds-session-title">${pinIcon}${escapeHtml(s.meta.title)}</div>
            <div class="ds-session-meta">
                <span>${escapeHtml(formatTime(s.meta.updatedAt))}</span>
                <span>${s.meta.floorCount} 楼</span>
                ${badges.join('')}
            </div>`;

        item.appendChild(cb);
        item.appendChild(body);
        item.addEventListener('click', () => {
            ds.activeSessionId = s.raw.id;
            renderList();
            renderPreview();
        });
        frag.appendChild(item);
    });
    els.list.innerHTML = '';
    els.list.appendChild(frag);
}

function refreshImportButtons() {
    const n = ds.selectedIds.size;
    els.selectedCount.textContent = n;
    els.importSelectedBtn.disabled = ds.importing || n === 0;
    els.importAllBtn.disabled = ds.importing || ds.sessions.length === 0;
}

// ==================== 预览渲染 ====================

function renderPreview() {
    revokePreviewUrls();
    const s = ds.sessions.find(x => x.raw.id === ds.activeSessionId);
    if (!s) {
        els.preview.innerHTML = `<div class="ds-preview-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <div>点击左侧会话查看内容</div></div>`;
        return;
    }

    let html = `<div class="ds-preview-head">
        <h3 class="ds-preview-title">${escapeHtml(s.meta.title)}</h3>
        <div class="ds-preview-sub">
            <span>更新于 ${escapeHtml(formatTime(s.meta.updatedAt))}</span>
            <span>共 ${s.meta.branchCount} 条分支 / 当前 ${s.meta.floorCount} 楼</span>
        </div>
    </div>`;

    // 分支选择器（存在多分支时）：预览可逐条查看，导入仍按全部分支导入
    const path = s.paths[s.previewIdx ?? s.activeIdx] || [];
    if (s.paths.length > 1) {
        const cur = s.previewIdx ?? s.activeIdx;
        const opts = s.paths.map((p, i) =>
            `<option value="${i}" ${i === cur ? 'selected' : ''}>分支 ${i + 1}（${p.length} 楼）${i === s.activeIdx ? ' ★当前' : ''}</option>`).join('');
        html += `<div class="ds-branch-tip">该会话含 ${s.paths.length} 条重新生成分支：<select id="ds-branch-select">${opts}</select></div>`;
    }

    html += path.map(m => renderMsgHtml(m)).join('');
    els.preview.innerHTML = html;

    const sel = document.getElementById('ds-branch-select');
    if (sel) {
        sel.addEventListener('change', () => {
            s.previewIdx = parseInt(sel.value, 10) || 0;
            renderPreview();
        });
    }
    // 预览图点击放大（复用浏览器新页签，最简实现）
    els.preview.querySelectorAll('.ds-attach-img').forEach(img => {
        img.addEventListener('click', () => window.open(img.src, '_blank'));
    });
}

/**
 * 渲染单条 DeepSeek 消息为预览 HTML。
 * 正文用 marked + DOMPurify（与系统 fallback 管线同款）；THINK/TOOL/FILE 各有专属呈现。
 */
function renderMsgHtml(m) {
    const role = m.role === 'USER' ? 'user' : 'assistant';
    const roleName = role === 'user' ? '用户' : 'DeepSeek';
    const frags = Array.isArray(m.fragments) ? m.fragments : [];
    const timeStr = formatTime(m.inserted_at);
    const statusBadge = (m.status && m.status !== 'FINISHED')
        ? `<span class="ds-status-badge">${escapeHtml(m.status)}</span>` : '';

    let inner = '';

    // 附件块（FILE fragment）：图片能读则真显示，读不到/非图则标注
    const fileFrag = frags.find(f => f.type === 'FILE');
    const files = (fileFrag && Array.isArray(fileFrag.files)) ? fileFrag.files : [];
    files.forEach(f => {
        const target = f.is_image ? findAttachedFile(ds.fileMap, f.export_path) : null;
        if (target) {
            const url = URL.createObjectURL(target);
            ds.previewUrls.push(url);
            inner += `<img class="ds-attach-img" src="${url}" alt="${escapeHtml(f.file_name || '图片')}" title="${escapeHtml(f.file_name || '')}（点击放大）">`;
        } else {
            inner += `<div class="ds-attach-note">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                附件：${escapeHtml(f.file_name || '未命名')}${f.is_image ? '（源文件未在所选目录中）' : '（源文件未随导出提供）'}</div>`;
        }
    });

    // 正文
    const reqFrag = frags.find(f => f.type === 'REQUEST');
    const respFrag = frags.find(f => f.type === 'RESPONSE');
    const tplFrag = frags.find(f => f.type === 'TEMPLATE_RESPONSE');
    const rawContent = role === 'user'
        ? (reqFrag && reqFrag.content) || ''
        : (respFrag && respFrag.content) ?? (tplFrag && tplFrag.content) ?? '';
    if (rawContent) {
        inner += `<div class="ds-md-body">${renderMarkdownSafe(rawContent)}</div>`;
    } else if (!inner) {
        inner = '<div style="color:var(--text-muted,var(--text-secondary));font-size:0.8rem;">（无文本内容）</div>';
    }

    // 思考链折叠
    const thinks = frags.filter(f => f.type === 'THINK' && f.content && f.content.trim());
    thinks.forEach(t => {
        inner += `<details class="ds-think-block"><summary>思维链（点击展开）</summary><div class="ds-think-body">${escapeHtml(t.content)}</div></details>`;
    });

    // 联网记录小字标注（默认仅提示存在，导入可选写入正文）
    const searches = frags.filter(f => f.type === 'TOOL_SEARCH');
    const opens = frags.filter(f => f.type === 'TOOL_OPEN' && f.url);
    if (searches.length || opens.length) {
        const queries = searches.flatMap(x => x.queries || []).filter(Boolean);
        // 预览链接是手工拼接、不走 DOMPurify，必须自行限制 http(s) 协议防 javascript: 注入
        const links = opens.slice(0, 5).map(o =>
            `<a href="${escapeHtml(safeHttpUrl(o.url))}" target="_blank" rel="noopener">${escapeHtml(o.title || o.url)}</a>`);
        inner += `<div class="ds-tool-note">联网检索${queries.length ? '：' + escapeHtml(queries.join('、')) : ''}${links.length ? '<br>' + links.join('<br>') : ''}</div>`;
    }

    return `<div class="ds-msg ${role}">
        <div class="ds-msg-label">${roleName} · ${timeStr} ${statusBadge}</div>
        <div class="ds-msg-bubble">${inner}</div>
    </div>`;
}

/**
 * 安全渲染 Markdown：marked 解析 + DOMPurify 消毒。
 * 预览不套用系统自定义正则——导入查看就该是 DeepSeek 原始内容。
 */
function renderMarkdownSafe(text) {
    let html = '';
    try {
        html = window.marked ? window.marked.parse(text, { gfm: true, breaks: true }) : escapeHtml(text);
    } catch {
        html = escapeHtml(text);
    }
    if (window.DOMPurify) {
        html = window.DOMPurify.sanitize(html);
    }
    return html;
}

// ==================== 导入编排 ====================

/**
 * 批量导入选中/全部会话。
 * 收口到 importConversations：ID冲突决策、回收站备份、IndexedDB 落库、侧边栏刷新全部复用。
 */
async function doImport(ids) {
    if (ds.importing) return;
    const targets = ds.sessions.filter(s => ids.includes(s.raw.id));
    if (!targets.length) {
        notify.warning('没有可导入的会话');
        return;
    }
    ds.importing = true;
    refreshImportButtons();
    const opts = {
        includeSearchRefs: !!(els.optSearchRefs && els.optSearchRefs.checked),
        embedImages: !!(els.optEmbedImages && els.optEmbedImages.checked)
    };
    try {
        const convList = [];
        for (const s of targets) {
            try {
                convList.push(await convertSession(s, ds.fileMap, opts));
            } catch (err) {
                console.warn('[DeepSeekImport] 会话转换失败跳过:', s.raw.id, err);
            }
        }
        if (!convList.length) {
            notify.error('所有会话转换失败，未执行导入');
            return;
        }
        await importConversations(convList, {}, { titleSuffix: ' (DeepSeek导入)' });
    } finally {
        ds.importing = false;
        refreshImportButtons();
    }
}

// ==================== 工具 ====================

/**
 * 仅放行 http/https 链接，其余协议一律清空。
 * — 为什么这么写 — 预览中的 <a href> 是手工拼接的 HTML 片段，escapeHtml 只能防属性断裂，
 * 防不了 javascript:/data: 协议注入；DeepSeek 来源链接正常都是 http(s)，其他协议直接丢。
 */
function safeHttpUrl(url) {
    return regexPatterns.deepseekSafeHttpUrl.test(url || '') ? url : '';
}

/** 时间戳格式化（ISO -> YYYY-MM-DD HH:mm） */
function formatTime(iso) {
    if (!iso) return '未知时间';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
