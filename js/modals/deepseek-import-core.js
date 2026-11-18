/**
 * @file deepseek-import-core.js
 * @description DeepSeek 官方导出会话（chat_sessions/*.json）的【纯逻辑层】：
 *   结构校验、parent_id 分支建树、附件路径索引、会话/消息向系统结构的转换。
 *   不依赖任何 DOM/全局状态，可直接在 node 测试脚本中独立断言。
 *   DOM 交互与导入编排见 deepseek-import-modal.js。
 */

import { regexPatterns } from '../regex.js?v=temp';

// ==================== 附件路径索引 ====================

/**
 * 注册文件到路径索引。
 * — 为什么这么写 —
 * 附件匹配靠 export_path（形如 chat_sessions/<convId>_files/<uuid>_name.png），
 * 而用户可能选的是导出根目录、chat_sessions 或更深层目录，webkitRelativePath 前缀不定；
 * 统一转小写正斜杠后按"chat_sessions/ 起始的后缀"与"文件 basename"双路索引，保证都能命中。
 * @param {Map<string, File>} fileMap - 调用方持有的路径->File 索引
 * @param {File} file - 用户所选文件（webkitdirectory 下带 webkitRelativePath）
 */
export function registerFile(fileMap, file) {
    // _dsRelPath：showDirectoryPicker 遍历收集时挂的相对路径（无 webkitRelativePath 可用）；
    // 与 webkitRelativePath 同样带所选目录名前缀，保证 export_path 后缀匹配一致命中
    const rel = (file._dsRelPath || file.webkitRelativePath || file.name)
        .replace(regexPatterns.deepseekBackslashPath, '/').toLowerCase();
    fileMap.set(rel, file);
    const idx = rel.indexOf('chat_sessions/');
    if (idx >= 0) fileMap.set(rel.slice(idx), file);
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (base) fileMap.set(base, file);
}

/**
 * 按 export_path 反查用户所选 File 对象。
 * @param {Map<string, File>} fileMap
 * @param {string} exportPath - DeepSeek 导出里的相对路径，如 chat_sessions/<id>_files/<uuid>_x.png
 */
export function findAttachedFile(fileMap, exportPath) {
    if (!exportPath) return null;
    const norm = exportPath.replace(regexPatterns.deepseekBackslashPath, '/').toLowerCase();
    const direct = fileMap.get(norm);
    if (direct) return direct;
    const base = norm.slice(norm.lastIndexOf('/') + 1);
    return base ? (fileMap.get(base) || null) : null;
}

// ==================== 会话模型（解析+分支建树） ====================

/**
 * 校验 DeepSeek 会话 JSON 并构建预览/转换模型。
 * @returns {null|{raw:object, paths:Array, activeIdx:number, meta:object}} 非法结构返回 null
 */
export function buildSessionModel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.id || !Array.isArray(raw.messages) || raw.messages.length === 0) return null;

    const paths = buildBranchPaths(raw.messages);
    if (!paths.length) return null;

    const activeIdx = activeBranchIndexOf(paths, raw.current_message_id);
    const activePath = paths[activeIdx] || [];

    // 列表元数据（一次性算好，避免每次渲染重算）
    let attachCount = 0, hasThink = false, hasSearch = false;
    raw.messages.forEach(m => (m.fragments || []).forEach(f => {
        if (f.type === 'FILE') attachCount += (f.files || []).length;
        else if (f.type === 'THINK') hasThink = true;
        else if (f.type === 'TOOL_SEARCH' || f.type === 'TOOL_OPEN') hasSearch = true;
    }));

    return {
        raw,
        paths,
        activeIdx,
        meta: {
            title: raw.title || '未命名会话',
            updatedAt: raw.updated_at || raw.inserted_at || '',
            floorCount: activePath.length,
            branchCount: paths.length,
            attachCount,
            hasThink,
            hasSearch,
            pinned: !!raw.pinned
        }
    };
}

/**
 * 按 parent_id 把消息数组建树，DFS 取全部 root->leaf 路径。
 * — 为什么这么写 —
 * 1. DeepSeek 重新生成的回复是同 parent_id 的兄弟节点，每条叶路径=一条系统分支；
 * 2. parent_id 指向不存在消息的孤儿节点按根处理，防止导出残缺时消息丢失；
 * 3. 兄弟节点按 id 升序（id 即发言顺序），保证分支顺序与官方展示一致。
 */
export function buildBranchPaths(messages) {
    const byId = new Map();
    (messages || []).forEach(m => {
        if (m && m.id != null && !byId.has(m.id)) byId.set(m.id, m);
    });
    const children = new Map();
    const roots = [];
    for (const m of byId.values()) {
        const p = m.parent_id;
        if (p == null || !byId.has(p)) roots.push(m);
        else {
            if (!children.has(p)) children.set(p, []);
            children.get(p).push(m);
        }
    }
    const byIdAsc = (a, b) => (a.id || 0) - (b.id || 0);
    roots.sort(byIdAsc);
    children.forEach(list => list.sort(byIdAsc));

    const paths = [];
    const dfs = (node, acc) => {
        acc.push(node);
        const kids = children.get(node.id);
        if (!kids || !kids.length) paths.push([...acc]);
        else kids.forEach(k => dfs(k, acc));
        acc.pop();
    };
    roots.forEach(r => dfs(r, []));
    return paths;
}

/** current_message_id 所在路径即 DeepSeek 当前选中分支 */
export function activeBranchIndexOf(paths, currentMsgId) {
    const idx = paths.findIndex(p => p.some(m => m.id === currentMsgId));
    return idx >= 0 ? idx : Math.max(paths.length - 1, 0);
}

// ==================== 会话/消息转换 ====================

/**
 * DeepSeek 会话 -> 系统会话结构。
 * 字段映射：ds_uuid 定 ID（重复导入走系统冲突弹窗）、updated_at->lastModified、
 * pinned->pinned；模型只标来源，不绑定任何 API 端点（续聊时按当前选择器端点）。
 * @param {{raw:object, paths:Array, activeIdx:number}} session - buildSessionModel 产物
 * @param {Map<string, File>} fileMap - 附件路径索引（嵌入选项开启时读图用）
 * @param {{includeSearchRefs:boolean, embedImages:boolean}} opts - 导入选项
 */
export async function convertSession(session, fileMap, opts) {
    const raw = session.raw;
    const branches = [];
    for (const path of session.paths) {
        const msgs = [];
        for (const m of path) {
            msgs.push(await convertMessage(m, raw.id, fileMap, opts));
        }
        branches.push(msgs);
    }
    return {
        id: `ds_${raw.id}`,
        title: raw.title || '未命名会话',
        lastModified: raw.updated_at || raw.inserted_at || new Date().toISOString(),
        apiEndpointId: null,
        model: '',
        branches,
        activeBranchIndex: session.activeIdx,
        personaId: null,
        selectedMcpTools: [],
        pinned: !!raw.pinned,
        importSource: 'deepseek'
    };
}

/**
 * 单条 DeepSeek 消息 -> 系统消息结构。
 * - 用户：REQUEST.content -> content；FILE fragment -> attachments(仅图片可选嵌入) 或文字标注
 * - AI：RESPONSE.content ?? TEMPLATE_RESPONSE.content（拒答/繁忙话术也是用户所见的真实记录）；
 *   THINK -> reasoningParts；token_usage -> stats.tokenCount；
 *   TOOL_SEARCH/TOOL_OPEN 可选转为正文头部引用块
 */
export async function convertMessage(m, sessionId, fileMap, opts) {
    const role = m.role === 'USER' ? 'user' : 'assistant';
    const frags = Array.isArray(m.fragments) ? m.fragments : [];
    const msg = { role, timestamp: m.inserted_at };

    if (role === 'user') {
        const req = frags.find(f => f.type === 'REQUEST');
        let content = (req && req.content) || '';

        const fileFrag = frags.find(f => f.type === 'FILE');
        const files = (fileFrag && Array.isArray(fileFrag.files)) ? fileFrag.files : [];
        const attachNotes = [];
        const attachments = [];
        for (const f of files) {
            if (opts.embedImages && f.is_image) {
                const target = findAttachedFile(fileMap, f.export_path);
                if (target) {
                    const base64 = await readAsDataUrl(target);
                    attachments.push({
                        name: f.file_name || target.name,
                        // 与系统图片附件契约对齐：content 必须是 dataURL
                        // （渲染器 dataset.filecontent -> showFileViewer -> img.src 全链都读 content，
                        //  只写 base64 会导致查看器 src="undefined" 跳 /undefined ——已踩坑）
                        content: base64,
                        type: target.type || 'image/png',
                        size: f.file_size || target.size,
                        isImage: true,
                        base64
                    });
                    continue; // 已嵌入的图片不再文字标注
                }
            }
            attachNotes.push(`【附件: ${f.file_name || '未命名'}${f.is_image ? '' : '（源文件未随导出提供）'}】`);
        }
        if (attachNotes.length) {
            content = content ? `${content}\n\n${attachNotes.join(' ')}` : attachNotes.join(' ');
        }
        msg.content = content;
        if (attachments.length) msg.attachments = attachments;
    } else {
        const resp = frags.find(f => f.type === 'RESPONSE');
        const tpl = frags.find(f => f.type === 'TEMPLATE_RESPONSE');
        let content = (resp && resp.content) ?? (tpl && tpl.content) ?? '';

        if (opts.includeSearchRefs) {
            const refBlock = buildSearchRefBlock(frags);
            if (refBlock) content = `${refBlock}\n\n---\n\n${content}`;
        }
        msg.id = `ds_msg_${sessionId}_${m.id}`;
        msg.content = content;
        msg.originalContent = content;

        const thinks = frags.filter(f => f.type === 'THINK' && f.content && f.content.trim());
        if (thinks.length) {
            msg.reasoningParts = thinks.map((t, i) => ({ content: t.content, source: 'deepseek-import', order: i }));
        }
        if (m.accumulated_token_usage) {
            msg.stats = { tokenCount: m.accumulated_token_usage };
        }
        if (m.status && m.status !== 'FINISHED') {
            msg.importStatus = m.status; // 自定义标记，保留中断/过滤等真实状态
        }
    }
    return msg;
}

/**
 * 把 TOOL_SEARCH/TOOL_OPEN 片段转成 markdown 引用块（可选导入项）。
 * 保留搜索词与前 10 条来源链接，插在 AI 正文头部。
 */
export function buildSearchRefBlock(frags) {
    const lines = [];
    frags.forEach(f => {
        if (f.type === 'TOOL_SEARCH') {
            const queries = (f.queries || []).filter(Boolean);
            if (queries.length) lines.push(`> **联网搜索**：${queries.join('、')}`);
            (f.results || []).slice(0, 10).forEach(r => {
                if (r && r.url) lines.push(`> - [${r.title || r.url}](${r.url})${r.site_name ? `（${r.site_name}）` : ''}`);
            });
        } else if (f.type === 'TOOL_OPEN' && f.url) {
            lines.push(`> - 打开网页：[${f.title || f.url}](${f.url})`);
        }
    });
    if (!lines.length) return '';
    return `> _以下为导入时保留的联网检索记录_\n${lines.join('\n')}`;
}

/** File -> base64 dataURL（嵌入附件用，仅浏览器环境可用） */
function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
