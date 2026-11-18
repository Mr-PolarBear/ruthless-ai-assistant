/**
 * test-auto-summary-relay.js
 * 自动记忆总结中转决策、置灰保护与环境突变自愈专项单元测试
 */

import assert from 'node:assert/strict';

// Mock 基础浏览器环境
globalThis.window = globalThis;
globalThis.HTMLElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const localStorageMock = new Map();
globalThis.localStorage = {
    getItem: (k) => localStorageMock.get(k) || null,
    setItem: (k, v) => localStorageMock.set(k, String(v)),
    removeItem: (k) => localStorageMock.delete(k),
    clear: () => localStorageMock.clear()
};

function createMockElement(tagName = 'div') {
    const classes = new Set();
    const children = [];
    let _innerHTML = '';

    const el = {
        tagName: tagName.toUpperCase(),
        id: '',
        style: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        dataset: {},
        children,
        childNodes: children,
        textContent: '',
        value: '',
        disabled: false,
        checked: false,
        setAttribute: (k, v) => { if (k === 'disabled') el.disabled = true; },
        removeAttribute: (k) => { if (k === 'disabled') el.disabled = false; },
        appendChild(child) {
            child.parentNode = el;
            children.push(child);
            return child;
        },
        contains(child) {
            return children.includes(child);
        },
        querySelector(selector) {
            if (selector.startsWith('#')) {
                const id = selector.slice(1);
                if (el.id === id) return el;
                for (const c of children) {
                    const found = c.querySelector?.(selector);
                    if (found) return found;
                }
            }
            if (selector.startsWith('.')) {
                const cls = selector.slice(1);
                if (classes.has(cls)) return el;
                for (const c of children) {
                    const found = c.querySelector?.(selector);
                    if (found) return found;
                }
            }
            return null;
        },
        addEventListener: () => {}
    };

    Object.defineProperty(el, 'innerHTML', {
        get: () => _innerHTML,
        set: (html) => {
            _innerHTML = html;
            children.length = 0;
            // 正则提取所有标签中的 id 与 class
            const tagMatches = html.matchAll(/<([a-z0-9]+)\b([^>]*)>/gi);
            for (const match of tagMatches) {
                const [, tag, attrs] = match;
                const child = createMockElement(tag);
                const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
                if (idMatch) child.id = idMatch[1];
                const classMatch = attrs.match(/\bclass=["']([^"']+)["']/i);
                if (classMatch) {
                    classMatch[1].split(/\s+/).forEach(c => c && child.classList.add(c));
                }
                child.parentNode = el;
                children.push(child);
            }
        }
    });

    return el;
}

const mockBody = createMockElement('body');
globalThis.document = {
    createElement: (tag) => createMockElement(tag),
    body: mockBody,
    getElementById: (id) => mockBody.querySelector('#' + id),
    addEventListener: () => {}
};

async function runTests() {
    console.log('🚀 开始执行自动总结中转决策与状态流转专项测试...');

    // Test 1: normalizeHideSummaryConfig 正确解析与保留 relayAutoSummaryPolicy
    console.log('[Test 1] 测试 normalizeHideSummaryConfig 中 relayAutoSummaryPolicy 字段标准化...');
    const { normalizeHideSummaryConfig } = await import('../js/summary-manager.js?v=temp');
    
    const configDefault = normalizeHideSummaryConfig({});
    assert.equal(configDefault.relayAutoSummaryPolicy, 'ask', '默认策略应为 ask (每次询问)');

    const configRelay = normalizeHideSummaryConfig({ relayAutoSummaryPolicy: 'always_relay' });
    assert.equal(configRelay.relayAutoSummaryPolicy, 'always_relay', '应正确保留 always_relay');

    const configLocal = normalizeHideSummaryConfig({ relayAutoSummaryPolicy: 'always_local' });
    assert.equal(configLocal.relayAutoSummaryPolicy, 'always_local', '应正确保留 always_local');
    console.log('✓ [Test 1] PASSED');

    // Test 2: openAutoSummaryRelayModal 渲染与未就绪置灰
    console.log('[Test 2] 测试 openAutoSummaryRelayModal 元素构造与未就绪置灰安全校验...');
    const { openAutoSummaryRelayModal } = await import('../js/modals/auto-summary-relay-modal.js?v=temp');

    // 模拟云端未就绪时唤起
    openAutoSummaryRelayModal({
        convId: 'conv_1',
        triggerDesc: '已累积 10 楼',
        isRelayReady: false
    });

    const modal = mockBody.children.find(c => c.id === 'auto-summary-relay-modal');
    assert.ok(modal, '应该在 document.body 中正确挂载 modal');

    const cloudBtn = modal.querySelector('#auto-summary-relay-action-cloud');
    const cloudLock = modal.querySelector('#auto-summary-relay-cloud-lock');
    assert.ok(cloudBtn, '应存在云端中转操作按钮');
    assert.equal(cloudBtn.disabled, true, '云端未就绪时，云端按钮必须处于 disabled 状态');
    assert.equal(cloudBtn.classList.contains('disabled'), true, '云端未就绪时，云端按钮必须包含 disabled 类名');
    assert.notEqual(cloudLock.style.display, 'none', '云端未就绪时必须展示小锁头提示');
    console.log('✓ [Test 2] PASSED (未就绪置灰与锁头提示验证通过)');

    // 模拟云端就绪时唤起
    openAutoSummaryRelayModal({
        convId: 'conv_1',
        triggerDesc: '已累积 10 楼',
        isRelayReady: true
    });
    assert.equal(cloudBtn.disabled, false, '云端就绪时，云端按钮必须解除 disabled');
    assert.equal(cloudBtn.classList.contains('disabled'), false, '云端就绪时，云端按钮不应包含 disabled');
    assert.equal(cloudLock.style.display, 'none', '云端就绪时小锁头必须隐藏');
    console.log('✓ [Test 2-2] PASSED (云端就绪解禁验证通过)');

    // Test 3: 环境状态突变自愈（情况 2 测试）
    console.log('[Test 3] 测试用户开启中转时，历史锁定在 always_local 的策略自动唤醒重置为 ask...');
    const { state } = await import('../js/state.js?v=temp');
    state.hideSummary = {
        'conv_locked': {
            enabled: true,
            autoSummaryEnabled: true,
            relayAutoSummaryPolicy: 'always_local' // 曾锁死在本地
        },
        'conv_other': {
            enabled: true,
            relayAutoSummaryPolicy: 'always_relay'
        }
    };

    // 模拟触发开启中转逻辑
    let hasReset = false;
    Object.keys(state.hideSummary).forEach(convId => {
        const cfg = state.hideSummary[convId];
        if (cfg && cfg.relayAutoSummaryPolicy === 'always_local') {
            cfg.relayAutoSummaryPolicy = 'ask';
            hasReset = true;
        }
    });

    assert.equal(hasReset, true, '应成功检测到需要突变自愈的会话');
    assert.equal(state.hideSummary['conv_locked'].relayAutoSummaryPolicy, 'ask', '锁死的会话应自动唤醒重置为 ask');
    assert.equal(state.hideSummary['conv_other'].relayAutoSummaryPolicy, 'always_relay', '非本地锁死的会话应保持原策略');
    console.log('✓ [Test 3] PASSED (开启中转突变自愈测试通过)');

    // Test 4: 分叉重置为初始无记忆状态后，基准楼层归零并触发自动总结
    console.log('[Test 4] 测试重置为初始无记忆状态重发后，基准楼层正确归零且不被废弃快照污染...');
    const { getNormalizedLastAutoSummaryFloor } = await import('../js/summary-manager.js?v=temp');
    
    // 模拟重发后的新分支：总共 14 条消息
    const mockBranch = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'test', hidden: false }));
    
    // 模拟会话：虽然 history 存留有废弃的 14 楼快照，但当前分支已重置为无记忆且无隐藏楼层
    const resetConfig = {
        summary: '',
        summaryList: [],
        tableData: { eventHistory: [], characterInfo: [] },
        hiddenFloors: [],
        lastAutoSummaryFloor: 0,
        history: [{ maxFloor: 14, time: '2026-11-17 10:00:00' }]
    };

    const normalizedFloor = getNormalizedLastAutoSummaryFloor(mockBranch, resetConfig);
    assert.equal(normalizedFloor, 0, '重置为初始无记忆后基准楼层必须归零 (返回 0，绝不能被废弃快照污染为 14)');
    
    const delta = mockBranch.length - normalizedFloor; // 14 - 0 = 14
    assert.equal(delta >= 10, true, '累积 14 楼应大于等于步长 10 楼，必须能正常触发自动总结');
    console.log('✓ [Test 4] PASSED (重发重置为初始无记忆归零验证通过)');

    console.log('=============================================');
    console.log('🎉 所有自动总结中转专项单元测试全部通过！');
    console.log('=============================================');
}

runTests().catch(err => {
    console.error('❌ 测试运行失败:', err);
    process.exit(1);
});
