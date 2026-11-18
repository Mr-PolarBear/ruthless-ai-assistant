/**
 * test-ai-task-relay.js
 * AI 接口后台任务中转与离线自愈系统全套单元测试与契约验证
 */

import assert from 'node:assert/strict';

// 1. Mock 浏览器环境 (必须在动态导入任何项目 ESM 模块之前完成挂载)
globalThis.window = globalThis;
globalThis.HTMLElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.alert = () => {};

function createMockElement(tagName = 'div') {
    const listeners = {};
    const classes = new Set();
    const children = [];
    const el = {
        tagName: tagName.toUpperCase(),
        style: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c) => classes.has(c) ? classes.delete(c) : classes.add(c),
            contains: (c) => classes.has(c)
        },
        dataset: {},
        innerHTML: '',
        textContent: '',
        value: '',
        disabled: false,
        checked: false,
        focus: () => {},
        children,
        childNodes: children,
        parentNode: null,
        appendChild(child) {
            child.parentNode = el;
            children.push(child);
            return child;
        },
        insertBefore(newNode, refNode) {
            const idx = children.indexOf(refNode);
            newNode.parentNode = el;
            if (idx === -1) children.push(newNode);
            else children.splice(idx, 0, newNode);
            return newNode;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx !== -1) {
                children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        },
        remove() {
            if (el.parentNode) el.parentNode.removeChild(el);
        },
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(f => f !== fn);
            }
        },
        dispatchEvent(evt) {
            const fns = listeners[evt.type] || [];
            fns.forEach(f => f(evt));
        },
        querySelector(sel) {
            if (sel.startsWith('.')) {
                const cls = sel.slice(1);
                if (classes.has(cls)) return el;
                for (const c of children) {
                    const found = c.querySelector?.(sel);
                    if (found) return found;
                }
            }
            if (sel.startsWith('#')) {
                const id = sel.slice(1);
                if (el.id === id) return el;
                for (const c of children) {
                    const found = c.querySelector?.(sel);
                    if (found) return found;
                }
            }
            if (sel.includes('[data-msg-id=')) {
                for (const c of children) {
                    const found = c.querySelector?.(sel);
                    if (found) return found;
                }
            }
            return null;
        },
        querySelectorAll(sel) {
            const matches = [];
            if (sel.startsWith('.')) {
                const cls = sel.slice(1);
                if (classes.has(cls)) matches.push(el);
            }
            for (const c of children) {
                if (c.querySelectorAll) {
                    matches.push(...c.querySelectorAll(sel));
                }
            }
            return matches;
        }
    };
    return el;
}

const mockDomElements = new Map();
globalThis.document = {
    getElementById: (id) => {
        if (!mockDomElements.has(id)) {
            const el = createMockElement('div');
            el.id = id;
            mockDomElements.set(id, el);
        }
        return mockDomElements.get(id);
    },
    createElement: (tag) => createMockElement(tag),
    querySelector: (sel) => {
        if (sel.startsWith('#')) return globalThis.document.getElementById(sel.slice(1));
        return createMockElement('div');
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
    body: createMockElement('body'),
    head: createMockElement('head')
};

const localStorageMock = new Map();
globalThis.localStorage = {
    getItem: (k) => localStorageMock.get(k) || null,
    setItem: (k, v) => localStorageMock.set(k, String(v)),
    removeItem: (k) => localStorageMock.delete(k),
    clear: () => localStorageMock.clear()
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
            },
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null
        };
        setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
    }
};

async function runTests() {
    console.log('--- 开始执行 AI 后台任务中转与离线自愈全套测试 ---\n');

    // 动态导入模块
    const {
        isRelayAvailable,
        submitRelayTask,
        cancelRelayTask,
        pollTaskStatus,
        parseSSEChunk,
        generateExpiredCardHtml,
        bindExpiredCardActions,
        executeRelaySummary,
        recoverRelayTaskForConversation,
        pollAndStreamRelayTask
    } = await import('../js/services/ai-task-relay.js?v=temp');

    const { state } = await import('../js/state.js?v=temp');
    const { dom } = await import('../js/dom.js?v=temp');
    dom.branchNavigator = createMockElement('div');
    dom.chatMessages = createMockElement('div');
    dom.sendButton = createMockElement('button');
    dom.messageInput = createMockElement('textarea');
    dom.historyList = createMockElement('div');
    dom.historyGroupedList = createMockElement('div');

    const { getSyncSettings, saveSyncSettings } = await import('../js/services/sync-client.js?v=temp');
    const { setSyncItem, clearSyncCredentials } = await import('../js/services/sync-store.js?v=temp');

    // Test 1: getSyncSettings & isRelayAvailable 状态矩阵
    console.log('[Test 1] 测试 isRelayAvailable 门禁状态机判定...');
    localStorage.clear();
    
    // 初始状态
    let avail = await isRelayAvailable();
    assert.strictEqual(avail.available, false, '默认未配置时必须为 false');

    // 仅配置了 serverUrl 但未开启中转
    saveSyncSettings({ serverUrl: 'http://127.0.0.1:8443', enableAiRelay: false });
    avail = await isRelayAvailable();
    assert.strictEqual(avail.available, false, '未开启 enableAiRelay 时必须为 false');

    // 开启了 enableAiRelay 但缺少 token
    saveSyncSettings({ serverUrl: 'http://127.0.0.1:8443', enableAiRelay: true });
    avail = await isRelayAvailable();
    assert.strictEqual(avail.available, false, '缺少云端鉴权 token 时必须为 false');

    // 注入 token，所有前置就绪
    await setSyncItem('token', 'mock_jwt_token_12345');
    avail = await isRelayAvailable();
    assert.strictEqual(avail.available, true, '就绪时必须为 true');
    assert.strictEqual(avail.serverUrl, 'http://127.0.0.1:8443');
    assert.strictEqual(avail.token, 'mock_jwt_token_12345');
    console.log('✓ [Test 1] PASSED');

    // Test 2: submitRelayTask 请求构造与透传契约
    console.log('[Test 2] 测试 submitRelayTask 接口请求头与参数透传...');
    let lastFetchCall = null;
    globalThis.fetch = async (url, options) => {
        lastFetchCall = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                id: 'task_1739281729_a1b2c3d4',
                task_id: 'task_1739281729_a1b2c3d4',
                status: 'pending',
                created_at: 1739281729
            })
        };
    };

    const submitRes = await submitRelayTask({
        requestData: {
            url: 'https://api.deepseek.com/v1/chat/completions',
            headers: { 'Authorization': 'Bearer sk-deepseek-key-999' },
            body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] }
        },
        apiEndpoint: { url: 'https://api.deepseek.com/v1', key: 'sk-deepseek-key-999' },
        token: 'mock_jwt_token_12345',
        serverUrl: 'http://127.0.0.1:8443'
    });

    assert.strictEqual(submitRes.task_id, 'task_1739281729_a1b2c3d4');
    assert.strictEqual(lastFetchCall.url, 'http://127.0.0.1:8443/v1/openai/tasks');
    assert.strictEqual(lastFetchCall.options.headers['X-Target-Url'], 'https://api.deepseek.com/v1/chat/completions');
    assert.strictEqual(lastFetchCall.options.headers['Authorization'], 'Bearer sk-deepseek-key-999');
    assert.strictEqual(lastFetchCall.options.headers['X-Sync-Token'], 'mock_jwt_token_12345');
    console.log('✓ [Test 2] PASSED');

    // Test 3: cancelRelayTask 取消后台任务
    console.log('[Test 3] 测试 cancelRelayTask 主动取消任务...');
    globalThis.fetch = async (url, options) => {
        lastFetchCall = { url, options };
        return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) };
    };

    await cancelRelayTask('task_1739281729_a1b2c3d4', 'http://127.0.0.1:8443', 'mock_jwt_token_12345');
    assert.strictEqual(lastFetchCall.url, 'http://127.0.0.1:8443/v1/openai/tasks/task_1739281729_a1b2c3d4/cancel');
    assert.strictEqual(lastFetchCall.options.headers['X-Sync-Token'], 'mock_jwt_token_12345');
    console.log('✓ [Test 3] PASSED');

    // Test 4: pollTaskStatus 轮询响应与 404 过期优雅捕获
    console.log('[Test 4] 测试 pollTaskStatus 轮询与 404 捕获...');
    // 4.1 正常轮询中
    globalThis.fetch = async (url) => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'task_1', status: 'processing', done: false, chunks: [], next_after: 0 })
    });
    let pollRes = await pollTaskStatus('task_1', 0, 'http://127.0.0.1:8443', 'tok');
    assert.strictEqual(pollRes.done, false);

    // 4.2 服务端 24h 过期 (404 Not Found)
    globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'task not found or expired', type: 'not_found' } })
    });
    pollRes = await pollTaskStatus('task_expired', 0, 'http://127.0.0.1:8443', 'tok');
    assert.strictEqual(pollRes.notFound, true, '404 必须解析为 notFound: true');
    assert.strictEqual(pollRes.isExpired, true, '404 必须标记为 isExpired: true');
    console.log('✓ [Test 4] PASSED');

    // Test 5: parseSSEChunk 流式分片解析与 [DONE] 标记
    console.log('[Test 5] 测试 parseSSEChunk 分片解析与思维链提取...');
    const sseChunk1 = 'data: {"choices":[{"delta":{"content":"你好","reasoning_content":"思考中..."}}]}\n\n';
    const parsed1 = parseSSEChunk(sseChunk1);
    assert.strictEqual(parsed1.text, '你好');
    assert.strictEqual(parsed1.reasoning, '思考中...');
    assert.strictEqual(parsed1.isDone, false);

    const sseChunk2 = 'data: [DONE]\n\n';
    const parsed2 = parseSSEChunk(sseChunk2);
    assert.strictEqual(parsed2.isDone, true);
    console.log('✓ [Test 5] PASSED');

    // Test 6: generateExpiredCardHtml 与 bindExpiredCardActions
    console.log('[Test 6] 测试 generateExpiredCardHtml 结构与事件绑定...');
    const html = generateExpiredCardHtml('msg_12345');
    assert.ok(html.includes('回复已超过 24 小时云端留存期'), '必须包含明确的 24 小时过期提示');
    assert.ok(html.includes('relay-regenerate-btn'), '必须包含重新生成按钮');
    assert.ok(html.includes('relay-delete-msg-btn'), '必须包含删除按钮');
    assert.ok(html.includes('msg_12345'), '必须透传 msgId 供事件精准识别');
    console.log('✓ [Test 6] PASSED');

    // Test 7: executeRelaySummary 总结任务中转全链路
    console.log('[Test 7] 测试 executeRelaySummary 总结中转流程...');
    let pollCount = 0;
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/v1/openai/tasks')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 'summary_task_1', task_id: 'summary_task_1', status: 'pending' })
            };
        }
        if (url.includes('/summary_task_1')) {
            pollCount++;
            if (pollCount === 1) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'summary_task_1',
                        status: 'processing',
                        done: false,
                        chunks: ['data: {"choices":[{"delta":{"content":"剧情进行至"}}]}\n\n'],
                        next_after: 1
                    })
                };
            } else {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'summary_task_1',
                        status: 'completed',
                        done: true,
                        result: {
                            choices: [{ message: { content: '剧情进行至第10章，主角获得新装备。' } }]
                        }
                    })
                };
            }
        }
        throw new Error('Unexpected URL: ' + url);
    };

    const chunks = [];
    const summaryResult = await executeRelaySummary({
        requestData: { url: 'https://api.openai.com/v1/chat/completions', body: { model: 'gpt-4o' } },
        apiEndpoint: { url: 'https://api.openai.com/v1' },
        onChunk: (delta, acc) => {
            chunks.push(delta);
        }
    });

    assert.strictEqual(summaryResult, '剧情进行至第10章，主角获得新装备。');
    assert.ok(chunks.length > 0, '必须触发 onChunk 回调');
    console.log('✓ [Test 7] PASSED');

    // Test 8: recoverRelayTaskForConversation 离线完成任务自愈 (done: true, completed)
    console.log('[Test 8] 测试 recoverRelayTaskForConversation 恢复已完成任务...');
    state.conversations['conv_test_done'] = {
        id: 'conv_test_done',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '测试问题', id: 'msg_u1' },
            { role: 'assistant', content: '', id: 'msg_a1', taskId: 'task_done_100', relayStatus: 'processing', stats: {} }
        ]]
    };
    state.currentConversationId = 'conv_test_done';

    globalThis.fetch = async (url) => {
        if (url.includes('/task_done_100')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'task_done_100',
                    status: 'completed',
                    done: true,
                    created_at: 100,
                    updated_at: 105,
                    result: {
                        choices: [{ message: { content: '<think>这是思考过程</think>自愈成功完成的回答' } }],
                        usage: { completion_tokens: 35 }
                    }
                })
            };
        }
        throw new Error('Unexpected URL: ' + url);
    };

    await recoverRelayTaskForConversation('conv_test_done');
    const recoveredMsg1 = state.conversations['conv_test_done'].branches[0][1];
    assert.strictEqual(recoveredMsg1.relayStatus, 'completed');
    assert.strictEqual(recoveredMsg1.isRelayCompleted, true);
    assert.strictEqual(recoveredMsg1.content, '自愈成功完成的回答');
    assert.strictEqual(recoveredMsg1.reasoningParts[0].content, '这是思考过程');
    assert.strictEqual(recoveredMsg1.stats.tokenCount, 35);
    console.log('✓ [Test 8] PASSED');

    // Test 9: recoverRelayTaskForConversation 离线失败任务自愈 (done: true, failed)
    console.log('[Test 9] 测试 recoverRelayTaskForConversation 恢复失败任务...');
    state.conversations['conv_test_failed'] = {
        id: 'conv_test_failed',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '测试问题2', id: 'msg_u2' },
            { role: 'assistant', content: '', id: 'msg_a2', taskId: 'task_failed_100', relayStatus: 'processing', stats: {} }
        ]]
    };

    globalThis.fetch = async (url) => {
        if (url.includes('/task_failed_100')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'task_failed_100',
                    status: 'failed',
                    done: true,
                    error: '上游 API 速率限制 (Rate limit exceeded)'
                })
            };
        }
        throw new Error('Unexpected URL: ' + url);
    };

    await recoverRelayTaskForConversation('conv_test_failed');
    const recoveredMsg2 = state.conversations['conv_test_failed'].branches[0][1];
    assert.strictEqual(recoveredMsg2.relayStatus, 'failed');
    assert.ok(recoveredMsg2.content.includes('上游 API 速率限制'));
    console.log('✓ [Test 9] PASSED');

    // Test 10: recoverRelayTaskForConversation 404 过期自愈 (超过 24h 留存期)
    console.log('[Test 10] 测试 recoverRelayTaskForConversation 404 过期优雅降级...');
    state.conversations['conv_test_expired'] = {
        id: 'conv_test_expired',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '测试问题3', id: 'msg_u3' },
            { role: 'assistant', content: '', id: 'msg_a3', taskId: 'task_expired_100', relayStatus: 'processing', stats: {} }
        ]]
    };

    globalThis.fetch = async (url) => {
        if (url.includes('/task_expired_100')) {
            return {
                ok: false,
                status: 404,
                json: async () => ({ error: { message: 'task not found or expired', type: 'not_found' } })
            };
        }
        throw new Error('Unexpected URL: ' + url);
    };

    await recoverRelayTaskForConversation('conv_test_expired');
    const recoveredMsg3 = state.conversations['conv_test_expired'].branches[0][1];
    assert.strictEqual(recoveredMsg3.relayStatus, 'expired');
    assert.ok(recoveredMsg3.content.includes('回复已超过 24 小时云端留存期'));
    assert.ok(recoveredMsg3.content.includes('relay-regenerate-btn'));
    assert.ok(recoveredMsg3.content.includes('relay-delete-msg-btn'));
    console.log('✓ [Test 10] PASSED');

    // Test 11: recoverRelayTaskForConversation 恢复正在执行的任务 (done: false，严禁重新提单！)
    console.log('[Test 11] 测试 recoverRelayTaskForConversation 恢复生成中任务且绝不提交新任务...');
    state.conversations['conv_test_ongoing'] = {
        id: 'conv_test_ongoing',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '测试长文本', id: 'msg_u4' },
            { role: 'assistant', content: '', id: 'msg_a4', taskId: 'task_ongoing_100', relayStatus: 'processing', stats: {} }
        ]]
    };

    let postTaskSubmitted = false;
    let ongoingPollCount = 0;
    globalThis.fetch = async (url, options = {}) => {
        if (url.endsWith('/v1/openai/tasks') && options.method === 'POST') {
            postTaskSubmitted = true;
            return { ok: true, status: 200, json: async () => ({ id: 'new_wrong_task', task_id: 'new_wrong_task' }) };
        }
        if (url.includes('/task_ongoing_100')) {
            ongoingPollCount++;
            if (ongoingPollCount === 1) {
                // 首次探测：生成中
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'task_ongoing_100',
                        status: 'processing',
                        done: false,
                        chunks: ['data: {"choices":[{"delta":{"content":"第一波内容"}}]}\n\n'],
                        next_after: 1
                    })
                };
            } else {
                // 接力轮询完成
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'task_ongoing_100',
                        status: 'completed',
                        done: true,
                        result: {
                            choices: [{ message: { content: '第一波内容加第二波完成内容' } }]
                        }
                    })
                };
            }
        }
        throw new Error('Unexpected URL: ' + url);
    };

    await recoverRelayTaskForConversation('conv_test_ongoing');
    // 等待后台持续接力轮询一轮
    await new Promise(r => setTimeout(r, 1000));

    assert.strictEqual(postTaskSubmitted, false, '恢复未决任务时严禁调用 submitRelayTask 重新提交任务！');
    const recoveredMsg4 = state.conversations['conv_test_ongoing'].branches[0][1];
    assert.strictEqual(recoveredMsg4.taskId, 'task_ongoing_100', '必须保留原 taskId');
    assert.strictEqual(recoveredMsg4.relayStatus, 'completed');
    assert.strictEqual(recoveredMsg4.content, '第一波内容加第二波完成内容');
    console.log('✓ [Test 11] PASSED');

    // Test 12: pollAndStreamRelayTask 用户点击停止 (AbortSignal 取消)
    console.log('[Test 12] 测试 pollAndStreamRelayTask 用户手动停止与云端同步取消...');
    state.conversations['conv_test_abort'] = {
        id: 'conv_test_abort',
        activeBranchIndex: 0,
        branches: [[
            { role: 'user', content: '测试取消', id: 'msg_u5' },
            { role: 'assistant', content: '生成中...', id: 'msg_a5', taskId: 'task_abort_100', relayStatus: 'processing', stats: {} }
        ]]
    };

    let cancelApiCalled = false;
    globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/task_abort_100/cancel')) {
            cancelApiCalled = true;
            return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) };
        }
        if (url.includes('/task_abort_100')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 'task_abort_100',
                    status: 'processing',
                    done: false,
                    chunks: [],
                    next_after: 0
                })
            };
        }
        throw new Error('Unexpected URL: ' + url);
    };

    const abortCtrl = new AbortController();
    const pollPromise = pollAndStreamRelayTask({
        taskId: 'task_abort_100',
        convId: 'conv_test_abort',
        msgId: 'msg_a5',
        token: 'tok',
        serverUrl: 'http://127.0.0.1:8443',
        abortSignal: abortCtrl.signal
    });

    // 稍后触发中断
    setTimeout(() => abortCtrl.abort(), 100);
    await pollPromise;

    assert.strictEqual(cancelApiCalled, true, '中断时必须调用云端 cancelRelayTask 接口');
    const abortedMsg = state.conversations['conv_test_abort'].branches[0][1];
    assert.strictEqual(abortedMsg.relayStatus, 'cancelled');
    assert.ok(abortedMsg.content.includes('[ 用户手动停止 ]'));
    console.log('✓ [Test 12] PASSED');

    console.log('\n=============================================');
    console.log('🎉 所有 12 项 AI 后台任务中转与离线自愈测试全部通过！');
    console.log('=============================================\n');
}

runTests().catch(err => {
    console.error('❌ 测试运行失败:', err);
    process.exit(1);
});

