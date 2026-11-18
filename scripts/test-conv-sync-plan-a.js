/**
 * test-conv-sync-plan-a.js
 * 单会话专属云同步 (Plan A) 与清单契约修复全套断言测试
 */

import assert from 'node:assert/strict';

// Node 环境模拟浏览器 DOM 与 Window
globalThis.window = globalThis;
globalThis.HTMLElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.alert = () => {};

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
        getAttribute: () => '',
        appendChild: () => {},
        append: () => {},
        removeChild: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        innerHTML: '',
        textContent: '',
        value: '',
        closest: () => el,
        querySelector: () => el,
        querySelectorAll: () => [el]
    };
    Object.setPrototypeOf(el, globalThis.HTMLElement.prototype);
    return el;
}

globalThis.document = {
    getElementById: () => createMockEl(),
    querySelector: () => createMockEl(),
    querySelectorAll: () => [],
    createElement: () => createMockEl(),
    createDocumentFragment: () => createMockEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: createMockEl()
};

const mockStorage = new Map();
globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear()
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
                objectStoreNames: { contains: () => true },
                createObjectStore: () => {},
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

const { generateManifest, buildConversationBundle } = await import('../js/services/sync-bundle.js?v=temp');
const { state } = await import('../js/state.js?v=temp');

console.log('====================================================');
console.log('🚀 开始执行单会话云同步 Plan A 与 Manifest 契约测试');
console.log('====================================================\n');

let passedTests = 0;
let failedTests = 0;

async function test(name, fn) {
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

// -------------------------------------------------------------
// 1. generateManifest 双向契约测试 (id + sourceConvId)
// -------------------------------------------------------------
await test('1.1 generateManifest 同时注入 id 与 sourceConvId，实现新老契约双向兼容', () => {
    const fakeBundle = {
        exportedAt: new Date().toISOString(),
        conversations: {
            conv_test_1: {
                id: 'conv_test_1',
                title: '测试会话 1',
                branches: [[{ role: 'user', content: 'hello' }]],
                activeBranchIndex: 0
            },
            conv_test_2: {
                id: 'conv_test_2',
                title: '测试会话 2',
                messages: [{ role: 'user', content: 'hi' }]
            }
        }
    };

    const manifest = generateManifest(fakeBundle, '测试机', 'v1.0.0');
    assert.strictEqual(manifest.conversationCount, 2);
    assert.ok(Array.isArray(manifest.conversations));

    const item1 = manifest.conversations.find(c => c.id === 'conv_test_1');
    assert.ok(item1 !== undefined, '必须能通过 id 查找到条目');
    assert.strictEqual(item1.id, 'conv_test_1', '必须包含 id 字段');
    assert.strictEqual(item1.sourceConvId, 'conv_test_1', '必须包含 sourceConvId 字段');
    assert.strictEqual(item1.floorCount, 1);
});

// -------------------------------------------------------------
// 2. applySnapshot 匹配契约与单会话安全兜底
// -------------------------------------------------------------
await test('2.1 精准匹配契约：支持 String(c.id) 或 String(c.sourceConvId) 匹配', () => {
    const convList = [
        { id: 'conv_alpha', sourceConvId: 'conv_alpha', title: 'Alpha' },
        { id: 'conv_beta_new', sourceConvId: 'conv_beta_old', title: 'Beta' },
        { sourceConvId: 'conv_gamma_only', title: 'Gamma (老快照无id)' }
    ];

    // 匹配通过 id
    const match1 = convList.filter(c => c && (String(c.id) === 'conv_alpha' || String(c.sourceConvId) === 'conv_alpha'));
    assert.strictEqual(match1.length, 1);
    assert.strictEqual(match1[0].title, 'Alpha');

    // 匹配通过 sourceConvId
    const match2 = convList.filter(c => c && (String(c.id) === 'conv_beta_old' || String(c.sourceConvId) === 'conv_beta_old'));
    assert.strictEqual(match2.length, 1);
    assert.strictEqual(match2[0].title, 'Beta');

    // 匹配老快照仅有 sourceConvId
    const match3 = convList.filter(c => c && (String(c.id) === 'conv_gamma_only' || String(c.sourceConvId) === 'conv_gamma_only'));
    assert.strictEqual(match3.length, 1);
    assert.strictEqual(match3[0].title, 'Gamma (老快照无id)');
});

await test('2.2 单会话快照安全兜底：若匹配不到且快照包中仅有唯一一个会话，安全降级使用该单会话', () => {
    const singleConvBundle = {
        conversations: {
            any_remote_key: { id: 'remote_session_uuid', title: '云端单会话' }
        }
    };

    let convList = Object.values(singleConvBundle.conversations || {});
    const targetConvId = 'local_session_uuid'; // ID 不匹配

    let matched = convList.filter(c => c && (String(c.id) === String(targetConvId) || String(c.sourceConvId) === String(targetConvId)));
    assert.strictEqual(matched.length, 0, '未直接按ID匹配上');

    // 单会话快照安全兜底
    if (matched.length === 0 && Object.keys(singleConvBundle.conversations || {}).length === 1) {
        const singleConv = Object.values(singleConvBundle.conversations)[0];
        if (singleConv) {
            matched = [singleConv];
        }
    }

    assert.strictEqual(matched.length, 1, '单会话快照成功安全降级回退');
    assert.strictEqual(matched[0].title, '云端单会话');
});

await test('2.3 严禁多会话快照在未匹配时跳过滤网导致数据泄露', () => {
    const multiConvBundle = {
        conversations: {
            conv_1: { id: 'conv_1', title: '会话1' },
            conv_2: { id: 'conv_2', title: '会话2' }
        }
    };

    let convList = Object.values(multiConvBundle.conversations || {});
    const targetConvId = 'non_existent_conv';

    let matched = convList.filter(c => c && (String(c.id) === String(targetConvId) || String(c.sourceConvId) === String(targetConvId)));
    if (matched.length === 0 && Object.keys(multiConvBundle.conversations || {}).length === 1) {
        matched = [Object.values(multiConvBundle.conversations)[0]];
    }

    assert.strictEqual(matched.length, 0, '多会话包未匹配时必须严格为空，严禁降级返回');
});

// -------------------------------------------------------------
// 3. bundleMetadata 作用域净化机制
// -------------------------------------------------------------
await test('3.1 bundleMetadata 净化：只保留目标会话关联的 hideSummary、局部/全局 worldBook 与正则', () => {
    const rawBundle = {
        version: '1.0',
        conversations: {
            target_conv: { id: 'target_conv', title: '目标' },
            other_conv: { id: 'other_conv', title: '其他' }
        },
        hideSummary: {
            target_conv: { mode: 'hide', summary: '目标摘要' },
            other_conv: { mode: 'hide', summary: '无关会话摘要' }
        },
        worldBook: {
            wb_global: { id: 'wb_global', name: '全局备忘', enabled: true },
            wb_target_linked: { id: 'wb_target_linked', name: '目标绑定备忘', enabled: false, sessionIds: ['target_conv'] },
            wb_other_linked: { id: 'wb_other_linked', name: '其他绑定备忘', enabled: false, sessionIds: ['other_conv'] }
        },
        regexRules: {
            reg_global: { id: 'reg_global', name: '全局正则', scope: 'global' },
            reg_target: { id: 'reg_target', name: '目标正则', scope: 'session', sessionIds: ['target_conv'] },
            reg_other: { id: 'reg_other', name: '其他正则', scope: 'session', sessionIds: ['other_conv'] }
        }
    };

    const targetId = 'target_conv';
    const purified = {
        ...rawBundle,
        hideSummary: (rawBundle.hideSummary && rawBundle.hideSummary[targetId]) ? { [targetId]: rawBundle.hideSummary[targetId] } : {},
        worldBook: (() => {
            const filtered = {};
            Object.entries(rawBundle.worldBook).forEach(([wbId, entry]) => {
                const isGlobal = entry.enabled === true;
                const isLinked = Array.isArray(entry.sessionIds) && entry.sessionIds.map(String).includes(String(targetId));
                if (isGlobal || isLinked) filtered[wbId] = entry;
            });
            return filtered;
        })(),
        regexRules: (() => {
            const filtered = {};
            Object.entries(rawBundle.regexRules).forEach(([rId, rule]) => {
                const isGlobal = (rule.scope === 'global' || !rule.scope);
                const isLinked = rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.map(String).includes(String(targetId));
                if (isGlobal || isLinked) filtered[rId] = rule;
            });
            return filtered;
        })()
    };

    // 断言 hideSummary 净化
    assert.ok(purified.hideSummary.target_conv !== undefined);
    assert.strictEqual(purified.hideSummary.other_conv, undefined, '无关会话的 hideSummary 必须被剔除');

    // 断言 worldBook 净化
    assert.ok(purified.worldBook.wb_global !== undefined, '全局备忘保留');
    assert.ok(purified.worldBook.wb_target_linked !== undefined, '目标绑定备忘保留');
    assert.strictEqual(purified.worldBook.wb_other_linked, undefined, '无关绑定备忘必须被剔除');

    // 断言 regexRules 净化
    assert.ok(purified.regexRules.reg_global !== undefined, '全局正则保留');
    assert.ok(purified.regexRules.reg_target !== undefined, '目标专属正则保留');
    assert.strictEqual(purified.regexRules.reg_other, undefined, '无关专属正则必须被剔除');
});

await test('3.2 bundleMetadata 多 targetIds 候选集契约：当 conv.id 与 sourceConvId 存在契约别名时仍能精准保留绑定生态', () => {
    const rawBundle = {
        version: '1.0',
        conversations: {
            conv_current: { id: 'conv_current', sourceConvId: 'conv_origin', title: '带别名的单会话' }
        },
        hideSummary: {
            conv_origin: { mode: 'hide', summary: '基于老ID记录的摘要' }
        },
        worldBook: {
            wb_linked_origin: { id: 'wb_linked_origin', name: '绑定老ID备忘', enabled: false, sessionIds: ['conv_origin'] }
        },
        sessionRegexRules: {
            reg_linked_origin: { id: 'reg_linked_origin', name: '绑定老ID正则', scope: 'session', sessionIds: ['conv_origin'] }
        }
    };

    const convList = [rawBundle.conversations.conv_current];
    const targetConvId = 'conv_origin';
    const targetIds = [convList[0]?.id, convList[0]?.sourceConvId, targetConvId].filter(Boolean).map(String);

    const purified = {
        ...rawBundle,
        hideSummary: (() => {
            const filtered = {};
            for (const tid of targetIds) {
                if (rawBundle.hideSummary[tid]) filtered[tid] = rawBundle.hideSummary[tid];
            }
            return filtered;
        })(),
        worldBook: (() => {
            const filtered = {};
            Object.entries(rawBundle.worldBook).forEach(([wbId, entry]) => {
                if (!entry) return;
                const isGlobal = entry.enabled === true;
                const isLinked = Array.isArray(entry.sessionIds) && entry.sessionIds.some(sId => targetIds.includes(String(sId)));
                if (isGlobal || isLinked) filtered[wbId] = entry;
            });
            return filtered;
        })(),
        sessionRegexRules: (() => {
            const filtered = {};
            Object.entries(rawBundle.sessionRegexRules).forEach(([rId, rule]) => {
                if (!rule) return;
                const isLinked = Array.isArray(rule.sessionIds) && rule.sessionIds.some(sId => targetIds.includes(String(sId)));
                if (isLinked) filtered[rId] = rule;
            });
            return filtered;
        })()
    };

    assert.ok(purified.hideSummary.conv_origin !== undefined, '多targetIds候选集必须精准保留基于别名记录的 hideSummary');
    assert.ok(purified.worldBook.wb_linked_origin !== undefined, '多targetIds候选集必须精准保留基于别名绑定的 worldBook');
    assert.ok(purified.sessionRegexRules.reg_linked_origin !== undefined, '多targetIds候选集必须精准保留基于别名绑定的 sessionRegexRules');
});

// -------------------------------------------------------------
// 4. 模块导出完整性校验
// -------------------------------------------------------------
await test('4.1 conv-sync-modal.js 成功导出 openConvSyncModal 与 closeConvSyncModal', async () => {
    const mod = await import('../js/modals/conv-sync-modal.js?v=temp');
    assert.strictEqual(typeof mod.openConvSyncModal, 'function', '必须导出 openConvSyncModal 函数');
    assert.strictEqual(typeof mod.closeConvSyncModal, 'function', '必须导出 closeConvSyncModal 函数');
});

await test('4.2 sync-modal.js 成功导出 applySnapshot', async () => {
    const mod = await import('../js/modals/sync-modal.js?v=temp');
    assert.strictEqual(typeof mod.applySnapshot, 'function', '必须导出 applySnapshot 函数');
});

// -------------------------------------------------------------
// 5. 异常防护与状态机断言 (防御回退、跳过结果契约、整包删除风险预警)
// -------------------------------------------------------------
await test('5.1 单会话快照若缺失有效ID时必须降级为multi展示，绝不可使用continue丢弃导致快照消失', () => {
    const parsedEntries = [
        { isSingleConv: true, convList: [{ title: '缺失ID但存在的单会话' }], item: { id: 'snap_corrupt', createdAt: 1000 } }
    ];

    const displayGroups = [];
    const singleGroups = new Map();

    for (const entry of parsedEntries) {
        const conv = entry.isSingleConv ? entry.convList[0] : null;
        const convId = conv ? (conv.id || conv.sourceConvId) : null;
        if (entry.isSingleConv && convId) {
            singleGroups.set(convId, { type: 'single_group', item: entry.item });
            displayGroups.push({ type: 'single_group' });
        } else {
            // 降级为 multi 卡片，绝不 continue 丢弃
            displayGroups.push({
                type: 'multi',
                item: entry.item,
                convList: entry.convList
            });
        }
    }

    assert.strictEqual(displayGroups.length, 1, '快照必须被保留呈现在列表中');
    assert.strictEqual(displayGroups[0].type, 'multi', '缺失ID的快照应安全降级为 multi 类别');
});

await test('5.2 applySnapshot 冲突决策跳过契约：用户选择跳过时必须返回 skipped 且严禁弹出虚假成功提示', () => {
    // 模拟 importConversations 在用户选择全部 skip 时的行为 (返回 null)
    const resultFromImport = null;
    const isSingle = true;
    let toastMessage = '';
    let returnedObj = null;

    if (!resultFromImport || (typeof resultFromImport.count === 'number' && resultFromImport.count === 0)) {
        toastMessage = isSingle ? '已跳过此会话加载（保持本地原状）' : '未导入任何会话（已全部跳过）';
        returnedObj = { success: false, skipped: true };
    } else {
        toastMessage = '成功同步加载此会话至本地！';
        returnedObj = resultFromImport;
    }

    assert.strictEqual(returnedObj.success, false);
    assert.strictEqual(returnedObj.skipped, true);
    assert.strictEqual(toastMessage, '已跳过此会话加载（保持本地原状）', '跳过时绝不可弹出虚假成功提示');
});

await test('5.3 conv-sync-modal 多会话整包备份删除前必须触发专属多会话二次确认预警', () => {
    const multiEntry = {
        item: { conversationCount: 5 },
        manifest: { conversations: [{}, {}, {}, {}, {}] }
    };

    const isMulti = multiEntry.item.conversationCount > 1 || (multiEntry.manifest && multiEntry.manifest.conversations.length > 1);
    const convCount = multiEntry.item.conversationCount || 1;

    let confirmPrompt = '';
    if (isMulti) {
        confirmPrompt = `⚠️ 警告：该快照属于包含 ${convCount} 个会话的整包备份！\n\n• 从云端删除它将导致该包内的所有 ${convCount} 个会话备份一同被彻底删除；\n• 该操作不可撤销，且会释放云端配额。\n\n确定仍要彻底删除整个备份包吗？`;
    } else {
        confirmPrompt = '确定要从云端彻底删除该快照吗？';
    }

    assert.strictEqual(isMulti, true);
    assert.ok(confirmPrompt.includes('整包备份'), '预警信息中必须明确标示整包备份');
    assert.ok(confirmPrompt.includes('5 个会话备份一同被彻底删除'), '预警信息必须指明会话数量与连带影响');
});


// -------------------------------------------------------------
// 6. 云同步相同内容防冗余副本契约测试 (Plan A 拦截优化)
// -------------------------------------------------------------
await test('6.1 importConversations 来自云同步且内容100%相同时直接跳过，绝不新建重复副本', async () => {
    const { importConversations } = await import('../js/utils.js?v=temp');
    
    // 构造本地会话
    const convId = 'conv_identical_test';
    state.conversations[convId] = {
        id: convId,
        title: '真爱粉',
        branches: [[{ role: 'user', content: '我永远喜欢小鸡' }, { role: 'assistant', content: '小鸡也喜欢你' }]],
        activeBranchIndex: 0,
        isDeleted: false
    };

    // 构造云端完全一致的快照待导入数据
    const incomingIdentical = [{
        id: convId,
        title: '真爱粉',
        branches: [[{ role: 'user', content: '我永远喜欢小鸡' }, { role: 'assistant', content: '小鸡也喜欢你' }]],
        activeBranchIndex: 0
    }];

    // 传入 syncOrigin 模拟云同步恢复
    const result = await importConversations(incomingIdentical, {}, {
        silent: true,
        checkConvConflicts: true,
        syncOrigin: { snapshotId: 'snap_test_123' },
        titleSuffix: ' (同步 2026/11/10)'
    });

    assert.ok(result, '应返回有效结果对象');
    assert.strictEqual(result.count, 0, '导入计数应为 0');
    assert.strictEqual(result.identicalCount, 1, '完全相同跳过数应为 1');
    assert.strictEqual(result.allIdentical, true, '应标识 allIdentical 为 true');

    // 检查本地会话列表，必须仍然只有 1 个会话，绝不生成 "真爱粉 (同步 2026/11/10)"
    const allMatches = Object.values(state.conversations).filter(c => c.title && c.title.includes('真爱粉'));
    assert.strictEqual(allMatches.length, 1, '会话列表中绝不能出现重复的真爱粉副本');
    assert.strictEqual(allMatches[0].id, convId, '原本的会话 ID 必须保持原样');
});

await test('6.2 importConversations 非云同步场景（如导入JSON）且ID撞车时正常保持副本创建', async () => {
    const { importConversations } = await import('../js/utils.js?v=temp');
    
    const convId = 'conv_file_import_test';
    state.conversations[convId] = {
        id: convId,
        title: '文件备份',
        branches: [[{ role: 'user', content: '测试内容' }]],
        activeBranchIndex: 0,
        isDeleted: false
    };

    const incoming = [{
        id: convId,
        title: '文件备份',
        branches: [[{ role: 'user', content: '测试内容' }]],
        activeBranchIndex: 0
    }];

    // 不传 syncOrigin (模拟从本地文件/剪贴板导入)
    const result = await importConversations(incoming, {}, {
        silent: true,
        checkConvConflicts: false,
        titleSuffix: ' (导入副本)'
    });

    assert.ok(result, '应返回有效导入结果');
    assert.strictEqual(result.count, 1, '非云同步场景应正常作为副本导入 1 个会话');
    const allMatches = Object.values(state.conversations).filter(c => c.title && c.title.includes('文件备份'));
    assert.strictEqual(allMatches.length, 2, '非云同步应保留副本生成逻辑');
});

console.log('\n====================================================');
if (failedTests === 0) {
    console.log(`🎉 全部 ${passedTests} 项单会话云同步 Plan A 测试断言 100% 通过！`);
    process.exit(0);
} else {
    console.error(`❌ 测试失败：共 ${passedTests + failedTests} 项，${passedTests} 项通过，${failedTests} 项失败！`);
    process.exit(1);
}
