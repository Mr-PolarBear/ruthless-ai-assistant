/**
 * @file test-trash-and-conflict.js
 * @description 回收站 (TrashManager)、覆盖冲突保护 (Conflict Resolution)、单会话打包与导出全套端到端自动化断言测试脚本
 */

import assert from 'node:assert/strict';

// 1. 设置基本的全局 Node 运行环境 Mock
globalThis.window = globalThis;
function createMockEl() {
    const el = {
        style: {},
        classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {},
            contains: () => false
        },
        setAttribute: () => {},
        removeAttribute: () => {},
        appendChild: () => {},
        append: () => {},
        prepend: () => {},
        removeChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        innerHTML: '',
        textContent: '',
        value: '',
        childNodes: [],
        children: [],
        checked: false,
        disabled: false,
        dataset: {},
        focus: () => {},
        blur: () => {},
        scrollIntoView: () => {},
        scrollTo: () => {},
        scrollHeight: 0,
        dispatchEvent: () => {},
        attachShadow: () => el,
        closest: () => el,
        querySelector: () => el,
        querySelectorAll: () => [el],
        getBoundingClientRect: () => ({ top: 100, bottom: 130, left: 10, right: 200, width: 190, height: 30 })
    };
    Object.setPrototypeOf(el, globalThis.HTMLElement.prototype);
    return el;
}

globalThis.HTMLElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.alert = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = async () => ({ text: async () => '', ok: true, status: 200 });
globalThis.CSSStyleSheet = class {
    replaceSync() {}
    replace() { return Promise.resolve(); }
};
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const mockStorage = new Map();
globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear()
};

globalThis.document = {
    getElementById: (id) => createMockEl(),
    querySelector: () => createMockEl(),
    querySelectorAll: () => [],
    createElement: (tag) => createMockEl(),
    createDocumentFragment: () => createMockEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: createMockEl()
};

// In-memory IndexedDB polyfill for Node.js test environment
const memStores = new Map();
function getStoreMap(name) {
    if (!memStores.has(name)) memStores.set(name, new Map());
    return memStores.get(name);
}

globalThis.indexedDB = {
    open(name, version) {
        const req = {
            result: {
                objectStoreNames: {
                    contains: (n) => true
                },
                createObjectStore: (n) => {},
                transaction: (storeNames, mode) => {
                    const tx = {
                        oncomplete: null,
                        onerror: null,
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

// 2. 动态加载业务模块
const { state } = await import('../js/state.js?v=temp');
const { initDom } = await import('../js/dom.js?v=temp');
initDom();
const { trashManager, TEN_DAYS_MS } = await import('../js/services/trash-manager.js?v=temp');
const { isConversationContentIdentical, importConversations } = await import('../js/utils.js?v=temp');
const { getConversationSummary } = await import('../js/modals/sync-conflict-modal.js?v=temp');
const { buildConversationBundle, buildSingleConversationData } = await import('../js/services/sync-bundle.js?v=temp');

let passedTests = 0;
let failedTests = 0;

async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(err);
        failedTests++;
    }
}

function test(name, fn) {
    try {
        fn();
        console.log(`✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(err);
        failedTests++;
    }
}

console.log('====================================================');
console.log('🚀 开始执行回收站生命周期、冲突保护与单会话全链路断言');
console.log('====================================================\n');

// -----------------------------------------------------------------
// 套件 1: 回收站生命周期与软删除核心逻辑
// -----------------------------------------------------------------
await testAsync('1.1 moveToTrash 常规软删除：打标 isDeleted 与 deletedAt，并清理草稿', async () => {
    state.conversations = {};
    const testConv = {
        id: 'conv_trash_1',
        title: '测试软删除',
        branches: [[{ role: 'user', content: 'hello' }]],
        activeBranchIndex: 0
    };
    state.conversations[testConv.id] = testConv;

    const res = await trashManager.moveToTrash(testConv.id);
    assert.ok(res !== null, 'moveToTrash 返回已软删除的对象');
    assert.strictEqual(res.isDeleted, true, 'isDeleted 必须为 true');
    assert.ok(typeof res.deletedAt === 'number' && res.deletedAt > 0, 'deletedAt 必须为有效时间戳');
    assert.strictEqual(state.conversations[testConv.id].isDeleted, true, '运行态 state 中必须标记已删除');
});

await testAsync('1.2 restoreFromTrash 恢复会话：清理 isDeleted 与 deletedAt', async () => {
    const convId = 'conv_trash_1';
    const restored = await trashManager.restoreFromTrash(convId);
    assert.ok(restored !== null, '恢复会话返回会话对象');
    assert.strictEqual(restored.isDeleted, false, 'isDeleted 恢复为 false');
    assert.strictEqual(restored.deletedAt, undefined, 'deletedAt 必须被删除');
});

await testAsync('1.3 moveToTrash 覆盖前备份模式 (isBackup: true)：生成 _backup_ 快照与规范化标题', async () => {
    state.conversations = {};
    const originalConv = {
        id: 'conv_local_conflict',
        title: '现有本地记录',
        branches: [[{ role: 'user', content: '本地旧内容' }]],
        activeBranchIndex: 0
    };
    state.conversations[originalConv.id] = originalConv;

    const backup = await trashManager.moveToTrash(originalConv, { isBackup: true });
    assert.ok(backup.id.startsWith('conv_local_conflict_backup_'), '备份ID必须带有 _backup_ 后缀');
    assert.strictEqual(backup.originalId, 'conv_local_conflict', '备份必须保留 originalId');
    assert.strictEqual(backup.title, '现有本地记录 (覆盖前备份)', '标题必须附加 (覆盖前备份)');
    assert.strictEqual(backup.isDeleted, true, '备份在回收站中 isDeleted 必须为 true');
    assert.ok(state.conversations[originalConv.id] !== undefined, '原本地对象保持在 state 中供覆盖写入');

    // 测试多次覆盖防标题膨胀
    const backup2 = await trashManager.moveToTrash(backup, { isBackup: true });
    assert.strictEqual(backup2.title, '现有本地记录 (覆盖前备份)', '多次备份绝不重复追加 (覆盖前备份)');
});

await testAsync('1.4 batchMoveToTrash 批量软删除与活动会话安全切离', async () => {
    state.conversations = {};
    const convA = { id: 'c_batch_1', title: 'A', branches: [[]], activeBranchIndex: 0 };
    const convB = { id: 'c_batch_2', title: 'B', branches: [[]], activeBranchIndex: 0 };
    const convC = { id: 'c_batch_3', title: 'C', branches: [[]], activeBranchIndex: 0 };
    state.conversations = { c_batch_1: convA, c_batch_2: convB, c_batch_3: convC };
    state.currentConversationId = 'c_batch_1';

    const moved = await trashManager.batchMoveToTrash(['c_batch_1', 'c_batch_2']);
    assert.strictEqual(moved, 2, '成功移入回收站2个');
    assert.strictEqual(state.conversations.c_batch_1.isDeleted, true);
    assert.strictEqual(state.conversations.c_batch_2.isDeleted, true);
    assert.strictEqual(state.conversations.c_batch_3.isDeleted, undefined);
    assert.strictEqual(state.currentConversationId, 'c_batch_3', '活动会话被软删除后必须自动切到非删除可用会话');
});

await testAsync('1.5 autoCleanExpiredTrash 10天自动衰期物理销毁与未过期保留', async () => {
    state.conversations = {};
    const now = Date.now();
    const elevenDaysAgo = now - (11 * 24 * 3600 * 1000);
    const fiveDaysAgo = now - (5 * 24 * 3600 * 1000);

    const expiredConv = { id: 'c_expired', title: '已超10天', isDeleted: true, deletedAt: elevenDaysAgo };
    const validTrashConv = { id: 'c_valid_trash', title: '未超10天', isDeleted: true, deletedAt: fiveDaysAgo };
    const activeConv = { id: 'c_active', title: '活跃会话', isDeleted: false };
    const corruptedTrashConv = { id: 'c_corrupt', title: '时间缺失', isDeleted: true }; // 缺失 deletedAt

    state.conversations = {
        c_expired: expiredConv,
        c_valid_trash: validTrashConv,
        c_active: activeConv,
        c_corrupt: corruptedTrashConv
    };

    const cleaned = await trashManager.autoCleanExpiredTrash(10);
    assert.strictEqual(cleaned, 1, '只有超过10天的会话被彻底物理销毁');
    assert.strictEqual(state.conversations.c_expired, undefined, '过期会话已彻底从 state 移除');
    assert.ok(state.conversations.c_valid_trash !== undefined, '未过期回收站会话必须保留');
    assert.ok(state.conversations.c_active !== undefined, '活跃会话绝不受影响');
    assert.ok(typeof state.conversations.c_corrupt.deletedAt === 'number', '异常缺失的时间戳已被自动修复');
});

await testAsync('1.6 emptyTrash 彻底清空回收站所有条目', async () => {
    const emptied = await trashManager.emptyTrash({ silent: true });
    assert.ok(emptied >= 2, '彻底清空所有已软删除会话');
    const remaining = Object.values(state.conversations);
    assert.strictEqual(remaining.length, 1, '只剩下活跃会话');
    assert.strictEqual(remaining[0].id, 'c_active');
});

// -----------------------------------------------------------------
// 套件 2: 打包与导出会话时严格隔离回收站软删除条目
// -----------------------------------------------------------------
await testAsync('2.1 buildConversationBundle 严格跳过 isDeleted 为 true 的会话', async () => {
    memStores.clear();
    state.conversations = {};
    const active1 = { id: 'act_1', title: '活跃1', branches: [[{ role: 'user', content: 'act1' }]], activeBranchIndex: 0 };
    const active2 = { id: 'act_2', title: '活跃2', branches: [[{ role: 'user', content: 'act2' }]], activeBranchIndex: 0 };
    const trash1 = { id: 'trash_1', title: '废弃1', branches: [[{ role: 'user', content: 'tr1' }]], activeBranchIndex: 0, isDeleted: true };
    state.conversations = { act_1: active1, act_2: active2, trash_1: trash1 };

    const bundleAll = await buildConversationBundle();
    assert.strictEqual(Object.keys(bundleAll.conversations).length, 2, '全量打包仅包含活跃会话');
    assert.strictEqual(bundleAll.conversations.trash_1, undefined, '回收站会话绝不可出现在打包中');

    // 显式指定 ID 包含回收站会话时，也必须严格过滤
    const bundleSpecific = await buildConversationBundle(['act_1', 'trash_1']);
    assert.strictEqual(Object.keys(bundleSpecific.conversations).length, 1, '指定目标打包也必须跳过回收站');
    assert.ok(bundleSpecific.conversations.act_1 !== undefined);
});

await testAsync('2.2 buildSingleConversationData 单会话导出严格阻断回收站条目', async () => {
    const singleTrash = await buildSingleConversationData('trash_1');
    assert.strictEqual(singleTrash, null, '导出回收站单会话必须返回 null');

    const singleActive = await buildSingleConversationData('act_1');
    assert.ok(singleActive !== null, '导出活跃单会话正常返回');
    assert.strictEqual(singleActive.id, 'act_1');
});

// -----------------------------------------------------------------
// 套件 3: 覆盖冲突探测算法与信息透视
// -----------------------------------------------------------------
test('3.1 isConversationContentIdentical 深度差分算法验证', () => {
    const base = {
        title: '对话A',
        pinned: false,
        systemPrompt: '',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '你好，有什么可以帮你的？' }
        ]]
    };

    // 1. 完全相同
    const same = JSON.parse(JSON.stringify(base));
    assert.strictEqual(isConversationContentIdentical(base, same), true, '内容完全相同时返回 true');

    // 2. 标题改变
    const diffTitle = { ...base, title: '对话B' };
    assert.strictEqual(isConversationContentIdentical(base, diffTitle), false, '标题不同返回 false');

    // 3. 置顶状态改变
    const diffPinned = { ...base, pinned: true };
    assert.strictEqual(isConversationContentIdentical(base, diffPinned), false, '置顶不同返回 false');

    // 4. 消息楼层数量不同
    const diffCount = JSON.parse(JSON.stringify(base));
    diffCount.branches[0].push({ role: 'user', content: '再问一句' });
    assert.strictEqual(isConversationContentIdentical(base, diffCount), false, '楼层数量不同返回 false');

    // 5. 消息文本正文微调
    const diffContent = JSON.parse(JSON.stringify(base));
    diffContent.branches[0][1].content = '你好，有什么可以协助你的？';
    assert.strictEqual(isConversationContentIdentical(base, diffContent), false, '正文不同返回 false');
});

test('3.2 getConversationSummary 摘要与最后 2 条消息透视提取及时间兜底', () => {
    const convWithMsgTime = {
        title: '透视测试',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '第1条问' },
            { role: 'assistant', content: '第2条答' },
            { role: 'user', content: '第3条<b>带HTML</b>', timestamp: 1700000000000 },
            { role: 'assistant', content: '第4条最新回复', timestamp: 1700000010000 }
        ]]
    };

    const summary = getConversationSummary(convWithMsgTime);
    assert.strictEqual(summary.messageCount, 4, '消息楼层数为 4');
    assert.ok(summary.lastModifiedRaw > 0, '会话无顶层 lastModified 时必须自动从最后一条消息 timestamp 提取');
    assert.strictEqual(summary.lastTwoMessages.length, 2, '必须提取最后 2 条消息');
    assert.strictEqual(summary.lastTwoMessages[0].floor, 3, '倒数第2条楼层为3');
    assert.strictEqual(summary.lastTwoMessages[0].content, '第3条带HTML', 'HTML标签必须经正则清洗为纯文本');
    assert.strictEqual(summary.lastTwoMessages[1].floor, 4, '倒数第1条楼层为4');
    assert.strictEqual(summary.lastTwoMessages[1].roleName, 'AI');
});

// -----------------------------------------------------------------
// 套件 4: 会话覆盖冲突决策导入全流程断言 (overwrite / keep_both / skip)
// -----------------------------------------------------------------
await testAsync('4.1 importConversations 决策【overwrite】: 旧版克隆入回收站保留10天，新版继承原ID', async () => {
    state.conversations = {};
    const local = {
        id: 'conv_conflict_target',
        title: '本地原版',
        branches: [[{ role: 'user', content: '本地老消息' }]],
        activeBranchIndex: 0
    };
    state.conversations[local.id] = local;
    state.currentConversationId = local.id;

    const incoming = {
        id: 'conv_conflict_target',
        title: '云端最新版',
        branches: [[
            { role: 'user', content: '本地老消息' },
            { role: 'assistant', content: '云端更新回复' }
        ]],
        activeBranchIndex: 0
    };

    const decisions = { conv_conflict_target: 'overwrite' };
    const res = await importConversations([incoming], {}, {
        silent: true,
        convConflictDecisions: decisions
    });

    assert.strictEqual(res.success, true);
    // 新版继承原ID
    const currentConv = state.conversations.conv_conflict_target;
    assert.strictEqual(currentConv.title, '云端最新版', '原ID被新版本覆盖');
    assert.strictEqual(currentConv.branches[0].length, 2, '消息内容更新为云端版本');

    // 检查原本地版本是否安全入回收站
    const trashList = trashManager.getTrashList();
    const backupItem = trashList.find(c => c.originalId === 'conv_conflict_target');
    assert.ok(backupItem !== undefined, '被覆盖的本地版本必须安全备份在回收站');
    assert.strictEqual(backupItem.title, '本地原版 (覆盖前备份)');
    assert.strictEqual(backupItem.branches[0][0].content, '本地老消息');
});

await testAsync('4.2 importConversations 决策【keep_both】: 本地保持原状，待导入另存为副本', async () => {
    state.conversations = {};
    const local = {
        id: 'conv_keep_both',
        title: '本地原版',
        branches: [[{ role: 'user', content: '旧' }]],
        activeBranchIndex: 0
    };
    state.conversations[local.id] = local;

    const incoming = {
        id: 'conv_keep_both',
        title: '本地原版',
        branches: [[{ role: 'user', content: '新' }]],
        activeBranchIndex: 0
    };

    const decisions = { conv_keep_both: 'keep_both' };
    const res = await importConversations([incoming], {}, {
        silent: true,
        convConflictDecisions: decisions
    });

    assert.strictEqual(res.success, true);
    // 本地原版完好
    assert.strictEqual(state.conversations.conv_keep_both.branches[0][0].content, '旧');
    // 生成了同步副本
    const copy = Object.values(state.conversations).find(c => c.id !== 'conv_keep_both');
    assert.ok(copy !== undefined, '必须生成副本');
    assert.strictEqual(copy.title, '本地原版 (同步副本)');
    assert.strictEqual(copy.branches[0][0].content, '新');
});

await testAsync('4.3 importConversations 决策【skip】: 放弃导入，本地维持现状', async () => {
    state.conversations = {};
    const local = {
        id: 'conv_skip_me',
        title: '不想被覆盖',
        branches: [[{ role: 'user', content: '保留不变' }]],
        activeBranchIndex: 0
    };
    state.conversations[local.id] = local;

    const incoming = {
        id: 'conv_skip_me',
        title: '云端版',
        branches: [[{ role: 'user', content: '被跳过' }]],
        activeBranchIndex: 0
    };

    const decisions = { conv_skip_me: 'skip' };
    const res = await importConversations([incoming], {}, {
        silent: true,
        convConflictDecisions: decisions
    });

    // 跳过后导入数量为 0
    assert.strictEqual(state.conversations.conv_skip_me.title, '不想被覆盖');
    assert.strictEqual(state.conversations.conv_skip_me.branches[0][0].content, '保留不变');
});

console.log('\n====================================================');
if (failedTests === 0) {
    console.log(`🎉 全部 ${passedTests} 项断言测试通过！无任何错误。`);
    process.exit(0);
} else {
    console.error(`❌ 测试未全部通过：共 ${passedTests + failedTests} 项，${passedTests} 项通过，${failedTests} 项失败！`);
    process.exit(1);
}
