/**
 * @file test-deepseek-import.js
 * @description DeepSeek 官方导出会话导入链路的自动化断言：
 *   结构校验、parent_id 分支建树（多分支还原+activeBranchIndex）、
 *   消息转换（REQUEST/RESPONSE/TEMPLATE_RESPONSE/THINK/FILE/TOOL_*）、
 *   以及收口到 importConversations 的端到端落库断言。
 * 运行：node scripts/test-deepseek-import.js
 *   可选用项目内 deepseek_data-xxxx 目录的真实导出文件做全量样本验证：
 *   node scripts/test-deepseek-import.js deepseek_data-2026-11-17/chat_sessions
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// 1. 浏览器环境 Polyfill（importConversations 及其依赖需要）
globalThis.window = globalThis;
function createMockEl() {
    const el = {
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        setAttribute: () => {},
        removeAttribute: () => {},
        appendChild: () => {},
        removeChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
        dataset: {},
        focus: () => {}, blur: () => {}, scrollIntoView: () => {},
        closest: () => el, querySelector: () => el, querySelectorAll: () => []
    };
    return el;
}
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.document = {
    getElementById: () => createMockEl(),
    querySelector: () => createMockEl(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => createMockEl(),
    body: Object.assign(createMockEl(), { dataset: {} })
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.alert = () => {};

// 内存版 IndexedDB polyfill（与既有测试脚本同款）
const memStores = new Map();
function getStoreMap(name) {
    if (!memStores.has(name)) memStores.set(name, new Map());
    return memStores.get(name);
}
globalThis.indexedDB = {
    open() {
        const req = {
            result: {
                objectStoreNames: { contains: () => true },
                createObjectStore: () => {},
                transaction: () => {
                    const tx = {
                        oncomplete: null, onerror: null,
                        objectStore: (storeName) => {
                            const m = getStoreMap(storeName);
                            return {
                                get: (key) => {
                                    const r = { result: m.get(key) };
                                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                    return r;
                                },
                                getAllKeys: () => {
                                    const r = { result: Array.from(m.keys()) };
                                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                    return r;
                                },
                                put: (val, key) => {
                                    const actualKey = key || (val && val.id);
                                    m.set(actualKey, val);
                                    const r = { result: actualKey };
                                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                    return r;
                                },
                                delete: (key) => {
                                    m.delete(key);
                                    const r = { result: undefined };
                                    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                    return r;
                                }
                            };
                        }
                    };
                    setTimeout(() => tx.oncomplete && tx.oncomplete(), 2);
                    return tx;
                }
            }
        };
        queueMicrotask(() => {
            if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }
};

// 2. 导入被测模块（core 是纯函数，无需额外 mock）
const core = await import('../js/modals/deepseek-import-core.js?v=temp');
const { state } = await import('../js/state.js?v=temp');
const { importConversations } = await import('../js/utils.js?v=temp');
const { initDom } = await import('../js/dom.js?v=temp');
initDom();

const NO_OPTS = { includeSearchRefs: false, embedImages: false };
let passCount = 0;
async function test(name, fn) {
    try {
        await fn();
        passCount++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// ---------- 构造样本 ----------

/** 线性会话：user -> ai(think+resp+tool) */
const linearSample = {
    id: 'aaaa-1', title: '线性会话', pinned: false, current_message_id: 2,
    inserted_at: '2025-12-01T01:00:00Z', updated_at: '2025-12-01T02:00:00Z',
    messages: [
        { id: 1, parent_id: null, role: 'USER', status: 'FINISHED', inserted_at: '2025-12-01T01:00:00Z',
          fragments: [{ type: 'REQUEST', content: '第一个问题' }] },
        { id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED', accumulated_token_usage: 100,
          inserted_at: '2025-12-01T01:01:00Z',
          fragments: [
              { type: 'THINK', content: '想一下' },
              { type: 'RESPONSE', content: '**回答A**' },
              { type: 'TOOL_SEARCH', queries: ['q1'], results: [{ url: 'https://a.com', title: 'A站', site_name: 'A' }] }
          ] }
    ]
};

/** 分支会话：msg5 下 3 个兄弟 AI（重新生成），current=8 */
const branchSample = {
    id: 'bbbb-1', title: '分支会话', current_message_id: 8,
    inserted_at: '2025-12-02T01:00:00Z', updated_at: '2025-12-02T03:00:00Z',
    messages: [
        { id: 1, parent_id: null, role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST', content: 'u1' }] },
        { id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'a1' }] },
        { id: 3, parent_id: 2, role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST', content: 'u2' }] },
        { id: 4, parent_id: 3, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'a2' }] },
        { id: 5, parent_id: 4, role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST', content: 'u3' }] },
        { id: 6, parent_id: 5, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'a3-版本1' }] },
        { id: 7, parent_id: 5, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'a3-版本2' }] },
        { id: 8, parent_id: 5, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: 'a3-版本3' }] }
    ]
};

/** 附件会话：FILE fragment + REQUEST */
const fileSample = {
    id: 'cccc-1', title: '带附件', current_message_id: 2, inserted_at: '2026-11-14T03:00:00Z',
    messages: [
        { id: 1, parent_id: null, role: 'USER', status: 'FINISHED',
          fragments: [
              { type: 'FILE', files: [
                  { id: 'f1', file_name: 'image.png', file_size: 100, is_image: true,
                    export_path: 'chat_sessions/cccc-1_files/f1_image.png' },
                  { id: 'f2', file_name: 'readme.txt', file_size: 50, is_image: false, export_path: null }
              ] },
              { type: 'REQUEST', content: '看看这个' }
          ] },
        { id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED', fragments: [{ type: 'RESPONSE', content: '看到了' }] }
    ]
};

/** 拒答会话：CONTENT_FILTER + 仅 TEMPLATE_RESPONSE */
const refuseSample = {
    id: 'dddd-1', title: '拒答会话', current_message_id: 2, inserted_at: '2025-08-26T17:00:00Z',
    messages: [
        { id: 1, parent_id: null, role: 'USER', status: 'FINISHED', fragments: [{ type: 'REQUEST', content: '敏感问题' }] },
        { id: 2, parent_id: 1, role: 'ASSISTANT', status: 'CONTENT_FILTER', accumulated_token_usage: 50,
          fragments: [{ type: 'TEMPLATE_RESPONSE', content: '你好，这个问题我暂时无法回答' }] }
    ]
};

/** 非法结构 */
const invalidSamples = [null, {}, { id: 'x' }, { id: 'x', messages: [] }, { id: 'x', messages: 'not-arr' }];

// ==================== 断言 ====================

console.log('\n== 套件1：结构校验 ==');
await test('非法结构一律返回 null', () => {
    invalidSamples.forEach(s => assert.strictEqual(core.buildSessionModel(s), null));
});
await test('合法结构产出模型与元数据', () => {
    const m = core.buildSessionModel(linearSample);
    assert.ok(m);
    assert.equal(m.meta.title, '线性会话');
    assert.equal(m.meta.floorCount, 2);
    assert.equal(m.meta.branchCount, 1);
    assert.equal(m.meta.hasThink, true);
    assert.equal(m.meta.hasSearch, true);
});

console.log('\n== 套件2：分支建树 ==');
await test('多分支还原为3条路径，current_message_id 定 activeIdx=2', () => {
    const m = core.buildSessionModel(branchSample);
    assert.equal(m.paths.length, 3);
    assert.equal(m.activeIdx, 2);
    assert.deepEqual(m.paths[2].map(x => x.id), [1, 2, 3, 4, 5, 8]);
    assert.equal(m.meta.floorCount, 6);
});
await test('孤儿消息（parent 指向不存在）按根处理不丢', () => {
    const orphan = {
        id: 'o1', messages: [
            { id: 9, parent_id: 999, role: 'USER', fragments: [{ type: 'REQUEST', content: 'orphan' }] },
            { id: 10, parent_id: 9, role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: 'r' }] }
        ]
    };
    const m = core.buildSessionModel(orphan);
    assert.equal(m.paths.length, 1);
    assert.deepEqual(m.paths[0].map(x => x.id), [9, 10]);
});

console.log('\n== 套件3：消息转换 ==');
await test('REQUEST/RESPONSE/THINK/token_usage 字段映射正确', async () => {
    const m = core.buildSessionModel(linearSample);
    const conv = await core.convertSession(m, new Map(), NO_OPTS);
    assert.equal(conv.id, 'ds_aaaa-1');
    assert.equal(conv.branches.length, 1);
    const [u, a] = conv.branches[0];
    assert.equal(u.role, 'user');
    assert.equal(u.content, '第一个问题');
    assert.equal(a.role, 'assistant');
    assert.equal(a.content, '**回答A**');
    assert.equal(a.reasoningParts.length, 1);
    assert.equal(a.reasoningParts[0].content, '想一下');
    assert.equal(a.stats.tokenCount, 100);
    assert.equal(conv.activeBranchIndex, 0);
});
await test('TEMPLATE_RESPONSE 在 RESPONSE 缺失时兜底为 AI 正文 + 状态标记', async () => {
    const m = core.buildSessionModel(refuseSample);
    const conv = await core.convertSession(m, new Map(), NO_OPTS);
    const a = conv.branches[0][1];
    assert.equal(a.content, '你好，这个问题我暂时无法回答');
    assert.equal(a.importStatus, 'CONTENT_FILTER');
});
await test('FILE fragment 默认转为文字标注（图片注明+文档注明未导出）', async () => {
    const m = core.buildSessionModel(fileSample);
    const conv = await core.convertSession(m, new Map(), NO_OPTS);
    const u = conv.branches[0][0];
    assert.ok(u.content.includes('看看这个'));
    assert.ok(u.content.includes('【附件: image.png】'));
    assert.ok(u.content.includes('【附件: readme.txt（源文件未随导出提供）】'));
    assert.ok(!u.attachments);
});
await test('embedImages 开时附件对象契约对齐系统（content=base64=dataURL）', async () => {
    // node 环境无 FileReader，mock 成"读 _fakeDataUrl 字段"
    const RealFR = globalThis.FileReader;
    globalThis.FileReader = class {
        readAsDataURL(file) {
            this.result = file._fakeDataUrl;
            queueMicrotask(() => this.onload && this.onload());
        }
    };
    try {
        const fileMap = new Map();
        const fakeFile = {
            name: 'f1_image.png',
            webkitRelativePath: 'chat_sessions/cccc-1_files/f1_image.png',
            type: 'image/png', size: 100,
            _fakeDataUrl: 'data:image/png;base64,FAKEBASE64=='
        };
        core.registerFile(fileMap, fakeFile);
        const m = core.buildSessionModel(fileSample);
        const conv = await core.convertSession(m, fileMap, { includeSearchRefs: false, embedImages: true });
        const u = conv.branches[0][0];
        assert.ok(Array.isArray(u.attachments) && u.attachments.length === 1);
        const att = u.attachments[0];
        // 关键契约：系统查看器 read dataset.filecontent(=att.content) -> img.src，
        // content 缺失就会跳 /undefined（线上已踩坑，此断言防回归）
        assert.equal(att.content, 'data:image/png;base64,FAKEBASE64==');
        assert.equal(att.base64, att.content);
        assert.equal(att.isImage, true);
        assert.equal(att.name, 'image.png');
        // 已嵌入的图片不再重复文字标注；未导出的 txt 仍标注
        assert.ok(!u.content.includes('【附件: image.png】'));
        assert.ok(u.content.includes('【附件: readme.txt（源文件未随导出提供）】'));
    } finally {
        globalThis.FileReader = RealFR;
    }
});
await test('includeSearchRefs 开时插入联网引用块', async () => {
    const m = core.buildSessionModel(linearSample);
    const conv = await core.convertSession(m, new Map(), { includeSearchRefs: true, embedImages: false });
    const a = conv.branches[0][1];
    assert.ok(a.content.includes('联网检索记录'));
    assert.ok(a.content.includes('https://a.com'));
    assert.ok(a.content.endsWith('**回答A**'));
});
await test('分支会话转3条 branches，activeBranchIndex=2', async () => {
    const m = core.buildSessionModel(branchSample);
    const conv = await core.convertSession(m, new Map(), NO_OPTS);
    assert.equal(conv.branches.length, 3);
    assert.equal(conv.activeBranchIndex, 2);
    assert.equal(conv.branches[2].length, 6);
    assert.equal(conv.branches[2][5].content, 'a3-版本3');
    assert.equal(conv.branches[0][5].content, 'a3-版本1');
});

console.log('\n== 套件4：附件路径索引 ==');
await test('webkitRelativePath 任意前缀都能命中 export_path', () => {
    const fileMap = new Map();
    const fakeFile = { name: 'f1_image.png', webkitRelativePath: 'deepseek_data-x/chat_sessions/cccc-1_files/f1_image.png' };
    core.registerFile(fileMap, fakeFile);
    assert.equal(core.findAttachedFile(fileMap, 'chat_sessions/cccc-1_files/f1_image.png'), fakeFile);
    // 只选更深层目录时同样命中（basename 兜底）——用独立 map 避免上一条精确索引抢占
    const fileMap2 = new Map();
    const deep = { name: 'f1_image.png', webkitRelativePath: 'cccc-1_files/f1_image.png' };
    core.registerFile(fileMap2, deep);
    assert.equal(core.findAttachedFile(fileMap2, 'chat_sessions/cccc-1_files/f1_image.png'), deep);
    assert.equal(core.findAttachedFile(fileMap, null), null);
    assert.equal(core.findAttachedFile(fileMap, 'chat_sessions/other_files/nope.png'), null);
});

console.log('\n== 套件5：端到端 importConversations 落库 ==');
await test('转换+导入后 state.conversations 出现 ds_ 会话且分支完整', async () => {
    const m = core.buildSessionModel(branchSample);
    const conv = await core.convertSession(m, new Map(), NO_OPTS);
    const result = await importConversations([conv], {}, { silent: true });
    assert.ok(result);
    const saved = state.conversations['ds_bbbb-1'];
    assert.ok(saved, '导入后必须存在 ds_bbbb-1');
    assert.equal(saved.branches.length, 3);
    assert.equal(saved.activeBranchIndex, 2);
    assert.equal(saved.branches[2][5].content, 'a3-版本3');
});

console.log('\n== 套件6：真实导出文件全量验证 ==');
const dir = process.argv[2];
if (dir) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    console.log(`  扫描 ${files.length} 个文件于 ${dir}`);
    let okCount = 0, badCount = 0, branchConv = 0, multiBranch = 0, msgTotal = 0;
    for (const f of files) {
        let raw;
        try { raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch { badCount++; continue; }
        const model = core.buildSessionModel(raw);
        if (!model) { badCount++; console.log(`    跳过非法: ${f}`); continue; }
        okCount++;
        msgTotal += model.meta.floorCount;
        if (model.meta.branchCount > 1) multiBranch++;
        const conv = await core.convertSession(model, new Map(), NO_OPTS);
        assert.equal(conv.branches.length, model.paths.length);
        assert.equal(conv.branches[conv.activeBranchIndex].length, model.meta.floorCount);
        branchConv++;
    }
    console.log(`  ✅ 解析成功 ${okCount}，非法 ${badCount}，多分支会话 ${multiBranch}，活动分支总楼层 ${msgTotal}`);
    assert.ok(okCount > 0, '至少应解析出一个会话');
    passCount++;
} else {
    console.log('  （未传目录参数，跳过真实文件验证）');
}

console.log(`\n========== 通过 ${passCount} 项断言 ==========\n`);
