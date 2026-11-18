/**
 * @file test-copy-conversation.js
 * @description 复制会话智能对比与减负分支克隆全链路自动化测试
 */

import assert from 'node:assert/strict';

// 1. 设置基本的全局 Node 运行环境 Mock
globalThis.window = globalThis;
globalThis.HTMLElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
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
        remove: () => {},
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

globalThis.document = {
    getElementById: () => createMockEl(),
    querySelector: () => createMockEl(),
    querySelectorAll: () => [createMockEl()],
    createElement: () => createMockEl(),
    createDocumentFragment: () => createMockEl(),
    body: createMockEl(),
    documentElement: createMockEl(),
    addEventListener: () => {},
    removeEventListener: () => {}
};

globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

// 内存版 IndexedDB Mock
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
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
    }
};

// 动态导入待测模块
const { initDom } = await import('../js/dom.js?v=temp');
initDom();
const { executeCloneConversation } = await import('../js/modals/copy-conv-modal.js?v=temp');
const { state } = await import('../js/state.js?v=temp');

console.log('====================================================');
console.log('🚀 开始执行复制会话智能减负与生态数据克隆全链路测试');
console.log('====================================================\n');

async function runTests() {
    // 准备基础 state
    state.conversations = {};
    state.hideSummary = {};
    state.worldBook = {};
    state.regexRules = {};

    // ----------------------------------------------------
    // 测试 1：单分支会话完整复制
    // ----------------------------------------------------
    const singleConv = {
        id: 'conv_single_1',
        title: '厦门旅游攻略',
        pinned: true,
        branches: [
            [
                { id: 'm1', role: 'user', content: '厦门有什么好玩的？' },
                { id: 'm2', role: 'assistant', content: '鼓浪屿、南普陀寺、环岛路。' }
            ]
        ],
        activeBranchIndex: 0
    };
    state.conversations[singleConv.id] = singleConv;

    await executeCloneConversation(singleConv, 'full');

    const singleCloneKey = Object.keys(state.conversations).find(k => k !== 'conv_single_1');
    assert(singleCloneKey, '应生成新副本会话');
    const singleClone = state.conversations[singleCloneKey];
    assert.strictEqual(singleClone.title, '厦门旅游攻略 (副本)', '完整复制标题应追加 (副本)');
    assert.strictEqual(singleClone.pinned, false, '副本默认应取消置顶');
    assert.strictEqual(singleClone.branches.length, 1, '分支数应保持为 1');
    assert.strictEqual(singleClone.branches[0].length, 2, '消息数应保持为 2');
    console.log('✅ [PASS] 1. 单分支会话完整复制：标题、分支结构与取消置顶符合预期');

    // ----------------------------------------------------
    // 测试 2：多分支会话完整复制
    // ----------------------------------------------------
    const multiConv = {
        id: 'conv_multi_1',
        title: '深度学习研讨',
        pinned: false,
        branches: [
            [
                { id: 'm10', role: 'user', content: '什么是 Transformer？' },
                { id: 'm11_fail', role: 'assistant', content: '（回答不够好）' }
            ],
            [
                { id: 'm10', role: 'user', content: '什么是 Transformer？' },
                { id: 'm11_retry', role: 'assistant', content: '基于自注意力机制的序列模型。' },
                { id: 'm12', role: 'user', content: '注意力机制怎么算的？' },
                { id: 'm13', role: 'assistant', content: 'Q*K转置除以根号dk，softmax后乘V。' }
            ],
            [
                { id: 'm10', role: 'user', content: '什么是 Transformer？' },
                { id: 'm11_third', role: 'assistant', content: '第三次尝试...' }
            ]
        ],
        activeBranchIndex: 1 // 当前活动分支是第 2 个分支（包含 4 楼）
    };
    state.conversations[multiConv.id] = multiConv;

    await new Promise(r => setTimeout(r, 10));
    await executeCloneConversation(multiConv, 'full');

    const multiFullKey = Object.keys(state.conversations).find(k => k !== 'conv_single_1' && k !== singleCloneKey && k !== 'conv_multi_1');
    assert(multiFullKey, '应生成多分支完整副本');
    const multiFullClone = state.conversations[multiFullKey];
    assert.strictEqual(multiFullClone.title, '深度学习研讨 (副本)');
    assert.strictEqual(multiFullClone.branches.length, 3, '完整复制应保留全部 3 个分支');
    assert.strictEqual(multiFullClone.activeBranchIndex, 1, '应保留活动分支索引 1');
    assert.strictEqual(multiFullClone.branches[1].length, 4, '活动分支应有 4 楼');
    console.log('✅ [PASS] 2. 多分支会话完整复制：全部 3 个分支与 activeBranchIndex 完整保真');

    // ----------------------------------------------------
    // 测试 3：多分支会话精简减负复制 (active_branch)
    // ----------------------------------------------------
    await new Promise(r => setTimeout(r, 10));
    await executeCloneConversation(multiConv, 'active_branch');

    const multiSlimKey = Object.keys(state.conversations).find(k => 
        k !== 'conv_single_1' && k !== singleCloneKey && k !== 'conv_multi_1' && k !== multiFullKey
    );
    assert(multiSlimKey, '应生成减负精简副本');
    const multiSlimClone = state.conversations[multiSlimKey];
    assert.strictEqual(multiSlimClone.title, '深度学习研讨 (精简副本)', '精简复制标题应追加 (精简副本)');
    assert.strictEqual(multiSlimClone.branches.length, 1, '精简复制应剔除其余废弃分支，仅保留 1 个分支');
    assert.strictEqual(multiSlimClone.activeBranchIndex, 0, '精简复制后活动分支索引重置为 0');
    assert.strictEqual(multiSlimClone.branches[0].length, 4, '保留的分支必须是原活动分支 (4楼)');
    assert.strictEqual(multiSlimClone.branches[0][1].id, 'm11_retry', '保留的内容必须是原活动分支的优质回复');
    console.log('✅ [PASS] 3. 多分支会话减负精简复制：精准剔除 2 个冗余分支，仅保留当前活动分支并重置索引');

    // ----------------------------------------------------
    // 测试 4：生态数据克隆（worldBook、regexRules、hideSummary）
    // ----------------------------------------------------
    state.worldBook = {
        wb1: { id: 'wb1', name: 'AI设定集', sessionIds: ['conv_multi_1'] }
    };
    state.regexRules = {
        rg1: { id: 'rg1', name: '脱敏规则', scope: 'session', scopes: ['request-user'], sessionIds: ['conv_multi_1'] }
    };
    state.hideSummary = {
        'conv_multi_1': { enabled: true, hideFloors: [1, 2] }
    };

    await new Promise(r => setTimeout(r, 10));
    await executeCloneConversation(multiConv, 'active_branch');

    const ecoCloneKey = Object.keys(state.conversations).find(k => 
        ![singleConv.id, singleCloneKey, multiConv.id, multiFullKey, multiSlimKey].includes(k)
    );
    assert(ecoCloneKey, '应生成包含生态数据的新副本');

    // 校验备忘录自动追加 newId
    assert(state.worldBook.wb1.sessionIds.includes(ecoCloneKey), '备忘录绑定会话列表应自动包含新会话 ID');

    // 校验专属正则派生新规则
    const newRegexKey = Object.keys(state.regexRules).find(k => k !== 'rg1');
    assert(newRegexKey, '应派生出专属正则的新规则');
    assert(state.regexRules[newRegexKey].sessionIds.includes(ecoCloneKey), '新正则应仅绑定新会话');

    // 校验隐藏总结配置复制
    assert(state.hideSummary[ecoCloneKey], '隐藏与总结配置应深拷贝至新会话');
    assert.deepStrictEqual(state.hideSummary[ecoCloneKey].hideFloors, [1, 2], '隐藏楼层配置应一致');
    console.log('✅ [PASS] 4. 生态数据克隆：备忘录绑定追加、专属正则深拷贝独立派生、隐藏配置拷贝完全保真');

    console.log('\n====================================================');
    console.log('🎉 全部 4 组单元测试断言 100% 通过！');
    console.log('====================================================');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ 测试未通过:', err);
    process.exit(1);
});
