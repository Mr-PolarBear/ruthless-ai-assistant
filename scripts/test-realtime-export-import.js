/**
 * @file test-realtime-export-import.js
 * @description 实时模式与历法时间配置在单会话导出、批量导出、云端同步打包及还原导入的全链路自动化断言测试脚本。
 */

import assert from 'node:assert/strict';

// 1. 设置基本的运行环境 Polyfill (在动态导入任何应用模块前即刻生效)
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
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        disabled: false,
        dataset: {},
        focus: () => {},
        blur: () => {},
        scrollIntoView: () => {},
        closest: () => el,
        querySelector: () => el,
        querySelectorAll: () => []
    };
    return el;
}

globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
globalThis.document = {
    getElementById: (id) => createMockEl(),
    querySelector: (sel) => createMockEl(),
    querySelectorAll: (sel) => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tag) => createMockEl(),
    body: Object.assign(createMockEl(), { dataset: {} })
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.alert = (msg) => { /* Mock alert in tests */ };

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

// 2. 动态导入业务模块 (确保全局 window/document 已就绪)
const {
    getDefaultRealtimeConfig,
    normalizeRealtimeConfig,
    DEFAULT_REALTIME_PROMPT,
    getFormattedDateStr
} = await import('../js/services/realtime-mode.js?v=temp');

const { state } = await import('../js/state.js?v=temp');
const {
    buildSingleConversationData,
    buildConversationBundle,
    generateManifest
} = await import('../js/services/sync-bundle.js?v=temp');
const { initDom } = await import('../js/dom.js?v=temp');
initDom();
const { importConversations } = await import('../js/utils.js?v=temp');
const {
    formatBranchMessagesToText,
    formatBranchMessagesToMarkdown
} = await import('../js/modals/export-modal.js?v=temp');

console.log('====================================================');
console.log('🚀 开始执行实时模式导出导入与云同步全链路自动化断言');
console.log('====================================================\n');

let totalCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
    totalCount++;
    try {
        fn();
        console.log(`✅ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(err);
        failCount++;
        process.exitCode = 1;
    }
}

async function testAsync(name, fn) {
    totalCount++;
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(err);
        failCount++;
        process.exitCode = 1;
    }
}

// -----------------------------------------------------------------
// 测试套件 1: normalizeRealtimeConfig 规范化校验
// -----------------------------------------------------------------
test('1.1 normalizeRealtimeConfig 空输入应安全回退默认配置，且保持 enabled=false', () => {
    const res = normalizeRealtimeConfig(null);
    assert.strictEqual(res.enabled, false);
    assert.strictEqual(res.dateMode, 'system');
    assert.strictEqual(typeof res.customYear, 'number');
    assert.strictEqual(typeof res.customMonth, 'number');
    assert.strictEqual(typeof res.customDay, 'number');
    assert.strictEqual(res.linkDateChange, true);
    assert.strictEqual(typeof res.baseRealDate, 'string');
    assert.strictEqual(res.includeWeekday, true);
    assert.deepStrictEqual(res.timeGranularity, { hour: true, minute: true, second: false });
    assert.strictEqual(res.appendAllUser, true);
    assert.strictEqual(res.promptEnabled, true);
    assert.strictEqual(res.prompt, DEFAULT_REALTIME_PROMPT);
});

test('1.2 normalizeRealtimeConfig 平闰年精准校验 (2020年2月29日闰年 vs 2021年2月平年截断)', () => {
    // 2020年是闰年，2月有29天
    const leap = normalizeRealtimeConfig({
        enabled: true,
        dateMode: 'custom',
        customYear: 2020,
        customMonth: 2,
        customDay: 29
    });
    assert.strictEqual(leap.customDay, 29);

    // 2021年是平年，2月只有28天，传入31天应自动截断为28天
    const nonLeap = normalizeRealtimeConfig({
        enabled: true,
        dateMode: 'custom',
        customYear: 2021,
        customMonth: 2,
        customDay: 31
    });
    assert.strictEqual(nonLeap.customDay, 28);
});

test('1.3 normalizeRealtimeConfig 自定义提示词与时间粒度完整继承', () => {
    const customPrompt = '【自定义测试提示词】角色必须回复实时时间';
    const cfg = normalizeRealtimeConfig({
        enabled: true,
        dateMode: 'custom',
        customYear: 2026,
        customMonth: 11,
        customDay: 9,
        linkDateChange: false,
        baseRealDate: '2026-11-09',
        includeWeekday: false,
        timeGranularity: { hour: true, minute: true, second: true },
        appendAllUser: false,
        promptEnabled: true,
        prompt: customPrompt
    });
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.dateMode, 'custom');
    assert.strictEqual(cfg.linkDateChange, false);
    assert.strictEqual(cfg.includeWeekday, false);
    assert.deepStrictEqual(cfg.timeGranularity, { hour: true, minute: true, second: true });
    assert.strictEqual(cfg.appendAllUser, false);
    assert.strictEqual(cfg.prompt, customPrompt);
});

test('1.4 normalizeRealtimeConfig 支持 JSON 字符串入参安全解析与规整', () => {
    const rawJson = JSON.stringify({
        enabled: true,
        dateMode: 'custom',
        customYear: 2030,
        customMonth: 5,
        customDay: 20,
        prompt: '测试字符串解析'
    });
    const cfg = normalizeRealtimeConfig(rawJson);
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.customYear, 2030);
    assert.strictEqual(cfg.prompt, '测试字符串解析');

    // 格式损坏的非法字符串安全回退默认配置
    const invalidCfg = normalizeRealtimeConfig('{bad json}');
    assert.strictEqual(invalidCfg.enabled, false);
});

// -----------------------------------------------------------------
// 测试套件 2: buildSingleConversationData 单会话导出打包断言
// -----------------------------------------------------------------
await testAsync('2.1 buildSingleConversationData 单会话导出时完整保留并规范化 conv.realtimeMode', async () => {
    const convId = 'conv_test_single_001';
    state.conversations[convId] = {
        id: convId,
        title: '测试单会话导出',
        createdAt: Date.now(),
        lastModified: new Date().toISOString(),
        branches: [[
            { role: 'user', content: '你好，现在几点了？' },
            { role: 'assistant', content: '现在是虚拟时间上午十点。' }
        ]],
        activeBranchIndex: 0,
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2020,
            customMonth: 2,
            customDay: 29,
            linkDateChange: true,
            baseRealDate: '2026-11-09',
            includeWeekday: true,
            timeGranularity: { hour: true, minute: true, second: false },
            appendAllUser: true,
            promptEnabled: true,
            prompt: '【测试提示词】专属时间规范'
        }
    };

    const exported = await buildSingleConversationData(convId);
    assert.ok(exported, '导出对象不应为空');
    assert.ok(exported.realtimeMode, '导出数据必须包含 realtimeMode 字段');
    assert.strictEqual(exported.realtimeMode.enabled, true);
    assert.strictEqual(exported.realtimeMode.dateMode, 'custom');
    assert.strictEqual(exported.realtimeMode.customYear, 2020);
    assert.strictEqual(exported.realtimeMode.customMonth, 2);
    assert.strictEqual(exported.realtimeMode.customDay, 29);
    assert.strictEqual(exported.realtimeMode.prompt, '【测试提示词】专属时间规范');

    // 验证深拷贝切断引用
    exported.realtimeMode.customYear = 1999;
    assert.strictEqual(state.conversations[convId].realtimeMode.customYear, 2020, '导出深拷贝严禁反向污染运行态');
});

// -----------------------------------------------------------------
// 测试套件 3: buildConversationBundle 与 generateManifest 云同步多会话包
// -----------------------------------------------------------------
await testAsync('3.1 buildConversationBundle 批量会话打包与 Manifest 提取全覆盖', async () => {
    const convA = 'conv_bundle_a';
    const convB = 'conv_bundle_b';
    const convC = 'conv_bundle_c';

    state.conversations[convA] = {
        id: convA,
        title: '会话A-开启虚拟历法',
        createdAt: Date.now(),
        branches: [[{ role: 'user', content: '测试A' }]],
        activeBranchIndex: 0,
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2025,
            customMonth: 5,
            customDay: 20,
            prompt: '提示词A'
        }
    };

    state.conversations[convB] = {
        id: convB,
        title: '会话B-未配置实时模式',
        createdAt: Date.now(),
        branches: [[{ role: 'user', content: '测试B' }]],
        activeBranchIndex: 0
    };

    state.conversations[convC] = {
        id: convC,
        title: '会话C-实时模式已停用',
        createdAt: Date.now(),
        branches: [[{ role: 'user', content: '测试C' }]],
        activeBranchIndex: 0,
        realtimeMode: {
            enabled: false,
            dateMode: 'system'
        }
    };

    const bundle = await buildConversationBundle([convA, convB, convC]);
    assert.ok(bundle.conversations[convA], '会话A应在包中');
    assert.ok(bundle.conversations[convB], '会话B应在包中');
    assert.ok(bundle.conversations[convC], '会话C应在包中');

    // 会话A的 realtimeMode 应完整规范化
    assert.strictEqual(bundle.conversations[convA].realtimeMode.enabled, true);
    assert.strictEqual(bundle.conversations[convA].realtimeMode.customYear, 2025);
    assert.strictEqual(bundle.conversations[convA].realtimeMode.prompt, '提示词A');

    // 会话B没有配置实时模式，不强行注入
    assert.strictEqual(bundle.conversations[convB].realtimeMode, undefined);

    // 会话C配置了但已停用，保持 enabled=false
    assert.strictEqual(bundle.conversations[convC].realtimeMode.enabled, false);

    // 验证 Manifest
    const manifest = generateManifest(bundle, '自动化测试设备', 'v1.0.0');
    assert.strictEqual(manifest.conversationCount, 3);
    const itemA = manifest.conversations.find(c => c.sourceConvId === convA);
    const itemB = manifest.conversations.find(c => c.sourceConvId === convB);
    const itemC = manifest.conversations.find(c => c.sourceConvId === convC);

    assert.strictEqual(itemA.hasRealtime, true, '开启实时模式的会话A其 hasRealtime 应为 true');
    assert.strictEqual(itemB.hasRealtime, false, '未配置的会话B其 hasRealtime 应为 false');
    assert.strictEqual(itemC.hasRealtime, false, '已停用的会话C其 hasRealtime 应为 false');
});

// -----------------------------------------------------------------
// 测试套件 4: importConversations 恢复导入全链路与 UI 联动触发
// -----------------------------------------------------------------
await testAsync('4.1 importConversations 导入时将 conv.realtimeMode 完整恢复并标准化', async () => {
    // 构造待导入的会话数据包（模拟从 JSON 文件或云端快照下载解析出的会话）
    const incomingConvs = [
        {
            id: 'conv_incoming_001',
            title: '从云端同步的会话',
            branches: [[
                { role: 'user', content: '测试消息--2020-02-29 10:00' },
                { role: 'assistant', content: '收到！' }
            ]],
            activeBranchIndex: 0,
            realtimeMode: {
                enabled: true,
                dateMode: 'custom',
                customYear: 2020,
                customMonth: 2,
                customDay: 29,
                linkDateChange: true,
                baseRealDate: '2026-11-09',
                includeWeekday: true,
                timeGranularity: { hour: true, minute: true, second: false },
                appendAllUser: true,
                promptEnabled: true,
                prompt: '【云端提示词】跨设备无损同步'
            }
        }
    ];

    const result = await importConversations(incomingConvs, {}, { silent: true });
    assert.ok(result, '导入结果应成功返回');
    const importedId = typeof result === 'string' ? result : result.lastImportedId;
    assert.ok(importedId, '应获取到生成的导入会话ID');

    const importedConv = state.conversations[importedId];
    assert.ok(importedConv, '导入的会话必须已写入 state.conversations');
    assert.ok(importedConv.realtimeMode, '导入后必须完整保留 realtimeMode');
    assert.strictEqual(importedConv.realtimeMode.enabled, true);
    assert.strictEqual(importedConv.realtimeMode.customYear, 2020);
    assert.strictEqual(importedConv.realtimeMode.customMonth, 2);
    assert.strictEqual(importedConv.realtimeMode.customDay, 29);
    assert.strictEqual(importedConv.realtimeMode.prompt, '【云端提示词】跨设备无损同步');
    assert.deepStrictEqual(importedConv.realtimeMode.timeGranularity, { hour: true, minute: true, second: false });
});

await testAsync('4.2 importConversations 导入缺省部分属性的旧版会话，安全补全默认值', async () => {
    const incomingConvs = [
        {
            id: 'conv_incoming_legacy',
            title: '旧版不完整会话',
            branches: [[]],
            activeBranchIndex: 0,
            realtimeMode: {
                enabled: true,
                dateMode: 'custom',
                customYear: 2022
                // 缺少 customMonth, customDay, timeGranularity, prompt 等
            }
        }
    ];

    const result = await importConversations(incomingConvs, {}, { silent: true });
    const importedId = typeof result === 'string' ? result : result.lastImportedId;
    const importedConv = state.conversations[importedId];

    assert.strictEqual(importedConv.realtimeMode.enabled, true);
    assert.strictEqual(importedConv.realtimeMode.customYear, 2022);
    // 缺少的值被安全补全
    assert.strictEqual(typeof importedConv.realtimeMode.customMonth, 'number');
    assert.strictEqual(typeof importedConv.realtimeMode.customDay, 'number');
    assert.strictEqual(importedConv.realtimeMode.prompt, DEFAULT_REALTIME_PROMPT);
    assert.deepStrictEqual(importedConv.realtimeMode.timeGranularity, { hour: true, minute: true, second: false });
});

// -----------------------------------------------------------------
// 测试套件 5: 云同步 E2EE 结构端到端往返完整性
// -----------------------------------------------------------------
await testAsync('5.1 云同步打包 -> 模拟网络序列化传输 -> 解包导入 端到端全要素保真', async () => {
    const originalConvId = 'conv_e2ee_origin';
    const originalConfig = {
        enabled: true,
        dateMode: 'custom',
        customYear: 2030,
        customMonth: 12,
        customDay: 31,
        linkDateChange: false,
        baseRealDate: '2026-11-09',
        includeWeekday: true,
        timeGranularity: { hour: true, minute: false, second: true },
        appendAllUser: false,
        promptEnabled: true,
        prompt: '【端到端测试】跨设备加密同步保真'
    };

    state.conversations[originalConvId] = {
        id: originalConvId,
        title: 'E2EE保真会话',
        branches: [[{ role: 'user', content: '测试云端推送' }]],
        activeBranchIndex: 0,
        realtimeMode: originalConfig
    };

    // 1. 本地打包 (push 端)
    const bundle = await buildConversationBundle([originalConvId]);
    assert.ok(bundle.conversations[originalConvId]);

    // 2. 模拟加密与序列化
    const serialized = JSON.stringify(bundle);
    const deserialized = JSON.parse(serialized);

    // 3. 远端拉取解包恢复 (pull 端)
    const convList = Object.values(deserialized.conversations || {});
    const importRes = await importConversations(convList, deserialized, { silent: true });
    const newConvId = typeof importRes === 'string' ? importRes : importRes.lastImportedId;

    const restoredConv = state.conversations[newConvId];
    assert.ok(restoredConv);
    assert.deepStrictEqual(restoredConv.realtimeMode, normalizeRealtimeConfig(originalConfig));
});

// -----------------------------------------------------------------
// 测试套件 6: TXT / Markdown 导出会话文本与提示词头部渲染断言
// -----------------------------------------------------------------
test('6.1 formatBranchMessagesToText 导出会话 TXT 时在头部与正文中完整呈现实时模式变量与提示词', () => {
    const todayStr = getFormattedDateStr(new Date());
    const testConv = {
        id: 'conv_txt_test',
        title: 'TXT时间导出测试',
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2020,
            customMonth: 2,
            customDay: 29,
            linkDateChange: true,
            baseRealDate: todayStr,
            includeWeekday: true,
            timeGranularity: { hour: true, minute: true, second: false },
            appendAllUser: true,
            promptEnabled: true,
            prompt: '【异地实时聊天规范】这是专属测试提示词'
        }
    };
    const messages = [
        { role: 'user', content: '现在是哪一年？', timestamp: Date.now() },
        { role: 'assistant', content: '现在是2020年闰年。', timestamp: Date.now() }
    ];
    const range = { start: 1, end: 2, isCustom: false };

    const txtOutput = formatBranchMessagesToText(messages, 'full_txt', false, testConv.title, 0, range, testConv);
    assert.ok(txtOutput.includes(`实时模式：已启用 [基准: 自定义历法 (2020年2月29日，随现实推进，基准:${todayStr}) | 粒度: 时/分 | 包含星期: 是 | 注入策略: 每条用户消息 | 提示词注入: 已启用]`), 'TXT头部必须包含格式化后的时间变量全要素');
    assert.ok(txtOutput.includes('实时提示词：\n【异地实时聊天规范】这是专属测试提示词'), 'TXT头部必须包含实时提示词内容');
    assert.ok(txtOutput.includes('--2020-02-29 星期六'), '用户提问正文末尾必须包含注入的虚拟时间戳变量');
    assert.ok(txtOutput.includes('虚拟时间: 2020-02-29 星期六'), '消息楼层行必须呈现对应的虚拟历法时间');
});

test('6.2 formatBranchMessagesToMarkdown 导出会话 Markdown 时在头部与正文中完整呈现实时模式变量与提示词', () => {
    const testConv = {
        id: 'conv_md_test',
        title: 'MD时间导出测试',
        realtimeMode: {
            enabled: true,
            dateMode: 'system',
            timeGranularity: { hour: true, minute: true, second: true },
            includeWeekday: true,
            appendAllUser: true,
            promptEnabled: true,
            prompt: '【异地规范】测试MD导出'
        }
    };
    const messages = [
        { role: 'user', content: '几点了？', timestamp: Date.now() }
    ];
    const range = { start: 1, end: 1, isCustom: false };

    const mdOutput = formatBranchMessagesToMarkdown(messages, 'full_txt', false, testConv.title, 0, range, testConv);
    assert.ok(mdOutput.includes('> **实时模式**：已启用 [基准: 跟随现实系统时间 | 粒度: 时/分/秒 | 包含星期: 是 | 注入策略: 每条用户消息 | 提示词注入: 已启用]'), 'Markdown头部必须包含系统模式时间变量');
    assert.ok(mdOutput.includes('【异地规范】测试MD导出'), 'Markdown头部必须包含实时提示词内容');
    assert.ok(mdOutput.includes('--'), 'Markdown用户提问末尾必须包含注入的时间戳');
});

test('6.3 formatBranchMessagesToText 在实时模式停用时干净利落不误注入多余提示词', () => {
    const testConv = {
        id: 'conv_disabled_test',
        title: '停用模式导出测试',
        realtimeMode: {
            enabled: false,
            prompt: '不应出现的提示词'
        }
    };
    const messages = [{ role: 'user', content: '纯净内容', timestamp: Date.now() }];
    const range = { start: 1, end: 1, isCustom: false };

    const txtOutput = formatBranchMessagesToText(messages, 'full_txt', false, testConv.title, 0, range, testConv);
    assert.ok(!txtOutput.includes('实时模式：已启用'), '停用时不应标记为启用');
    assert.ok(!txtOutput.includes('不应出现的提示词'), '停用时不应注入提示词');
    assert.ok(!/--\d{4}-\d{2}-\d{2}/.test(txtOutput), '停用时不应在消息后注入时间戳');
    assert.ok(!txtOutput.includes('虚拟时间:'), '停用时不应在楼层显示虚拟时间');
    assert.ok(txtOutput.includes('纯净内容'), '纯净正文必须保真呈现');
});

test('6.4 formatBranchMessagesToText 在 convSource 缺省时自动从运行态安全回溯', () => {
    const testConvId = 'conv_auto_fallback';
    state.conversations[testConvId] = {
        id: testConvId,
        title: '回溯会话测试',
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2018,
            customMonth: 8,
            customDay: 8,
            prompt: '回溯提示词'
        }
    };
    state.currentConversationId = testConvId;

    const messages = [{ role: 'user', content: '测试未传convSource', timestamp: Date.now() }];
    const range = { start: 1, end: 1, isCustom: false };

    // 未传 convSource 依然能安全生效
    const txtOutput = formatBranchMessagesToText(messages, 'full_txt', false, '回溯会话测试', 0, range);
    assert.ok(txtOutput.includes('实时模式：已启用 [基准: 自定义历法 (2018年8月8日'), '缺省convSource时必须自动回溯当前导出状态');
    assert.ok(txtOutput.includes('回溯提示词'), '缺省convSource时必须自动导出实时提示词');
    assert.ok(txtOutput.includes('--2018-08-08 星期三'), '缺省convSource时用户消息末尾仍需保真注入时间戳');
});

test('6.5 appendAllUser 为 false 时仅最新一条用户消息追加时间变量', () => {
    const testConv = {
        id: 'conv_append_latest',
        title: '仅最新一条测试',
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2025,
            customMonth: 1,
            customDay: 1,
            linkDateChange: false,
            appendAllUser: false,
            includeWeekday: true,
            promptEnabled: true,
            prompt: '最新一条提示词'
        }
    };
    const messages = [
        { role: 'user', content: '第一条提问', timestamp: 1000000000000 },
        { role: 'assistant', content: '第一条回复', timestamp: 1000000010000 },
        { role: 'user', content: '第二条提问', timestamp: 1000000020000 }
    ];
    const range = { start: 1, end: 3, isCustom: false };
    const txtOutput = formatBranchMessagesToText(messages, 'full_txt', false, testConv.title, 0, range, testConv);

    const firstMsgBlock = txtOutput.slice(txtOutput.indexOf('【#1 楼】'), txtOutput.indexOf('【#2 楼】'));
    const thirdMsgBlock = txtOutput.slice(txtOutput.indexOf('【#3 楼】'));

    assert.ok(!firstMsgBlock.includes('--2025-01-01'), '第一条非最新用户消息不得追加时间变量');
    assert.ok(thirdMsgBlock.includes('--2025-01-01'), '最后一条最新用户消息必须追加时间变量');
});

test('6.6 formatBranchMessagesToText 防御性清理旧时间戳后缀，避免重复追加形成双重后缀', () => {
    const testConv = {
        id: 'conv_clean_old_ts',
        title: '旧时间戳清理测试',
        realtimeMode: {
            enabled: true,
            dateMode: 'custom',
            customYear: 2026,
            customMonth: 12,
            customDay: 25,
            linkDateChange: false,
            appendAllUser: true,
            includeWeekday: false,
            timeGranularity: { hour: true, minute: false, second: false }
        }
    };
    const messages = [
        { role: 'user', content: '内容包含旧时间戳\n--2010-01-01 10:00', timestamp: 1000000000000 }
    ];
    const range = { start: 1, end: 1, isCustom: false };
    const txtOutput = formatBranchMessagesToText(messages, 'full_txt', false, testConv.title, 0, range, testConv);
    assert.ok(!txtOutput.includes('--2010-01-01'), '旧时间戳后缀必须被安全剥离');
    assert.ok(txtOutput.includes('--2026-12-25'), '新虚拟时间戳必须正确替换注入');
});

test('6.7 formatBranchMessagesToMarkdown 在实时模式停用时干净利落', () => {
    const testConv = {
        id: 'conv_md_disabled',
        title: 'MD停用测试',
        realtimeMode: {
            enabled: false,
            prompt: '停用提示词'
        }
    };
    const messages = [{ role: 'user', content: '纯净MD正文', timestamp: Date.now() }];
    const range = { start: 1, end: 1, isCustom: false };
    const mdOutput = formatBranchMessagesToMarkdown(messages, 'full_txt', false, testConv.title, 0, range, testConv);
    assert.ok(!mdOutput.includes('实时模式：已启用'), '停用时不应输出启用标记');
    assert.ok(!mdOutput.includes('停用提示词'), '停用时不应输出提示词');
    assert.ok(!/--\d{4}-\d{2}-\d{2}/.test(mdOutput), '停用时不应注入时间戳');
});

// -----------------------------------------------------------------
// 测试套件 7: 单会话与全量导出 JSON 统一调用 buildSingleConversationData 契约对齐
// -----------------------------------------------------------------
await testAsync('7.1 buildSingleConversationData 包含 sessionRegexRules、relatedRegexRules 与规范化 realtimeMode', async () => {
    const convId = 'conv_unified_contract';
    state.conversations[convId] = {
        id: convId,
        title: '统一契约会话',
        branches: [[{ role: 'user', content: 'hello' }]],
        realtimeMode: {
            enabled: true,
            customYear: 2028,
            customMonth: 10,
            customDay: 1
        }
    };
    state.regexRules = {
        'reg_session': { id: 'reg_session', name: '专属规则', scope: 'session', sessionIds: [convId] },
        'reg_other': { id: 'reg_other', name: '其他规则', scope: 'session', sessionIds: ['other'] }
    };

    const singleData = await buildSingleConversationData(convId);
    assert.ok(singleData);
    assert.strictEqual(singleData.realtimeMode.enabled, true);
    assert.strictEqual(singleData.realtimeMode.customYear, 2028);
    assert.strictEqual(singleData.sessionRegexRules.length, 1);
    assert.strictEqual(singleData.relatedRegexRules.length, 1);
});

console.log('\n====================================================');
if (failCount > 0) {
    console.error(`❌ 测试未全部通过：共 ${totalCount} 项断言，${passCount} 项通过，${failCount} 项失败！`);
    console.log('====================================================');
    process.exit(1);
} else {
    console.log(`🎉 全部 ${passCount} 项断言测试通过！无任何错误。`);
    console.log('====================================================');
    process.exit(0);
}
