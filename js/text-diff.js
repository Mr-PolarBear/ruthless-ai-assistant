/**
 * text-diff.js
 * 轻量行级文本差异比对工具（供历史总结版本"对比上版"视图使用）
 *
 * — 为什么这么写 —
 * 1. 相邻两个版本快照的记忆文本往往 95% 以上相同，先裁剪公共前缀/后缀，
 *    只对中间差异段做 LCS 动态规划，计算量从 O(M*N) 降到 O(m*n)（m,n 为差异段长度）；
 * 2. LCS 需要完整 DP 矩阵做回溯，差异段行数乘积超过 LCS_CELL_LIMIT 时
 *    降级为"先删后增"顺序输出，避免几万行文本比对时分配数百 MB 内存卡死页面；
 * 3. 纯数据层实现（只产出操作序列），不依赖 DOM，渲染层自行决定如何着色。
 */

/** LCS DP 矩阵单元数上限（超过则降级，Uint32Array 下约对应 16MB 内存） */
const LCS_CELL_LIMIT = 4000000;

/**
 * 对两个差异片段做 LCS 回溯，输出 del/add/same 操作序列
 * @param {string[]} oldArr - 旧文本差异段行数组
 * @param {string[]} newArr - 新文本差异段行数组
 * @returns {Array<{type: 'same'|'add'|'del', text: string}>}
 */
function lcsDiffOps(oldArr, newArr) {
    const m = oldArr.length;
    const n = newArr.length;
    if (m === 0 && n === 0) return [];

    // 超大差异段降级保护：不做 O(m*n) 回溯，按"先全部删除、再全部新增"输出，
    // 宁可牺牲行对齐精度，也要保证内存与耗时可控（极端重写场景）
    if (m * n > LCS_CELL_LIMIT) {
        return [
            ...oldArr.map(text => ({ type: 'del', text })),
            ...newArr.map(text => ({ type: 'add', text }))
        ];
    }

    // 自底向上构建 LCS 长度矩阵（Typed Array 省内存且避免对象开销）
    const width = n + 1;
    const dp = new Uint32Array((m + 1) * width);
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i * width + j] = oldArr[i] === newArr[j]
                ? dp[(i + 1) * width + j + 1] + 1
                : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
        }
    }

    // 从 (0,0) 贪心回溯：等值行记 same，否则沿 LCS 较大的方向走 del/add
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (oldArr[i] === newArr[j]) {
            ops.push({ type: 'same', text: oldArr[i] });
            i++;
            j++;
        } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
            ops.push({ type: 'del', text: oldArr[i] });
            i++;
        } else {
            ops.push({ type: 'add', text: newArr[j] });
            j++;
        }
    }
    while (i < m) { ops.push({ type: 'del', text: oldArr[i++] }); }
    while (j < n) { ops.push({ type: 'add', text: newArr[j++] }); }
    return ops;
}

/**
 * 行级文本 diff：先裁剪公共前后缀，再对中间差异段做 LCS
 * @param {string} oldText - 旧文本（上一版本）
 * @param {string} newText - 新文本（当前版本）
 * @returns {Array<{type: 'same'|'add'|'del', text: string}>} 有序操作序列
 *   - same：两版一致；del：旧版有而新版移除；add：新版相对旧版新增
 */
export function diffLines(oldText, newText) {
    const oldLines = String(oldText || '').split('\n');
    const newLines = String(newText || '').split('\n');

    // 1. 裁剪公共前缀行
    const minLen = Math.min(oldLines.length, newLines.length);
    let start = 0;
    while (start < minLen && oldLines[start] === newLines[start]) start++;

    // 2. 裁剪公共后缀行
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
        oldEnd--;
        newEnd--;
    }

    // 3. 组装结果：前缀 same + 中间差异段 LCS + 后缀 same
    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ type: 'same', text: oldLines[i] });
    ops.push(...lcsDiffOps(oldLines.slice(start, oldEnd), newLines.slice(start, newEnd)));
    for (let i = oldEnd; i < oldLines.length; i++) ops.push({ type: 'same', text: oldLines[i] });
    return ops;
}

/**
 * 折叠过长的连续 same 段，只保留差异点前后 context 行上下文
 * — 为什么这么写 —
 * 版本快照全文可能数千行，diff 视图的意义是"看变更点"，
 * 把长相同段折叠为一行计数提示，既保住上下文又不至于让用户滚屏到失联。
 * @param {Array<{type: string, text?: string}>} ops - diffLines 输出的操作序列
 * @param {number} [context=3] - 差异点前后保留的上下文行数
 * @returns {Array<{type: 'same'|'add'|'del'|'collapsed', text?: string, count?: number}>}
 *   collapsed 类型的 op.count 表示被折叠的相同行数
 */
export function collapseDiffOps(ops, context = 3) {
    const result = [];
    let sameRun = [];

    const flush = () => {
        if (sameRun.length === 0) return;
        // 短相同段（不足 2*context+1 行）折叠后反而更啰嗦，原样保留
        if (sameRun.length <= context * 2 + 1) {
            for (const op of sameRun) result.push(op);
        } else {
            for (let k = 0; k < context; k++) result.push(sameRun[k]);
            result.push({ type: 'collapsed', count: sameRun.length - context * 2 });
            for (let k = sameRun.length - context; k < sameRun.length; k++) result.push(sameRun[k]);
        }
        sameRun = [];
    };

    for (const op of ops) {
        if (op.type === 'same') {
            sameRun.push(op);
        } else {
            flush();
            result.push(op);
        }
    }
    flush();
    return result;
}
