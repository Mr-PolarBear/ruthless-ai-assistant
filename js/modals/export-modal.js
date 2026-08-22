/**
 * @file export-modal.js
 * @description 专职负责会话导出弹窗的交互、多分支选择、楼层切片范围过滤、TXT/Markdown多格式文本转换与导出逻辑。
 * 遵循高内聚、低耦合设计，避免在 utils.js 或 chat-events.js 中堆砌代码。
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { getConversation } from '../db.js?v=260820-1';
import { regexPatterns } from '../regex.js?v=260820-1';
import { notify } from '../ui-updater.js?v=260820-1';
import { extractThinkingFromContent } from '../utils.js?v=260820-1';

/** 当前正在准备导出的会话ID */
let currentExportConvId = null;
/** 当前导出的会话数据缓存 */
let currentExportConvData = null;

/**
 * 触发浏览器下载 Blob 内容
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME类型
 */
function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 格式化时间戳为可读字符串 (YYYY-MM-DD HH:mm:ss)
 * @param {string|number} timestamp - ISO字符串或毫秒时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatReadableTime(timestamp) {
    if (!timestamp) return '未知时间';
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '未知时间';
        const pad = (n) => String(n).padStart(2, '0');
        const year = d.getFullYear();
        const month = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hours = pad(d.getHours());
        const mins = pad(d.getMinutes());
        const secs = pad(d.getSeconds());
        return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
    } catch {
        return '未知时间';
    }
}

/**
 * 清理文本中的 AI 思考过程标签 (<think>...</think> 或 <thinking>...</thinking>)
 * @param {string} text - 原始文本
 * @returns {string} 过滤思考过程后的纯正文
 */
function removeThinkingTags(text) {
    if (!text || typeof text !== 'string') return '';
    regexPatterns.thinkTag.lastIndex = 0;
    return text.replace(regexPatterns.thinkTag, '').trim();
}

/**
 * 提取 AI 消息中的思考过程与纯正文内容
 * 系统在接收/流式渲染时将思考内容剔除并保存至 msg.reasoningParts 等字段中，
 * 因此导出时需统一从 reasoningParts、analysisReasoning、reasoning_content 及内联标签中聚合。
 * @param {object} msg - 消息对象
 * @returns {{ thinkingText: string, cleanMainContent: string }}
 */
function extractMessageThinkingAndContent(msg) {
    const rawContent = msg.originalContent || msg.content || '';
    const contentStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2);

    // 1. 提取正文中可能内联残留的 <think>...</think> 或 <thinking>...</thinking> 标签
    const { reasoningParts: inlineParts, mainContent: cleanFromInline } = extractThinkingFromContent(contentStr);

    const thinkingSnippets = [];

    // 2. 读取 msg.reasoningParts（系统最核心保存思考内容的字段，结构为 [{ content, source, order }]）
    if (Array.isArray(msg.reasoningParts) && msg.reasoningParts.length > 0) {
        msg.reasoningParts.forEach(part => {
            if (part && typeof part.content === 'string' && part.content.trim()) {
                const text = part.content.trim();
                if (!thinkingSnippets.includes(text)) {
                    thinkingSnippets.push(text);
                }
            }
        });
    }

    // 3. 补充内联提取到的思考段落
    if (inlineParts && inlineParts.length > 0) {
        inlineParts.forEach(part => {
            if (part && part.content && typeof part.content === 'string') {
                const text = part.content.trim();
                if (text && !thinkingSnippets.includes(text)) {
                    thinkingSnippets.push(text);
                }
            }
        });
    }

    // 4. 补充 msg.analysisReasoning（如果存在）
    if (msg.analysisReasoning && typeof msg.analysisReasoning === 'string' && msg.analysisReasoning.trim()) {
        const text = msg.analysisReasoning.trim();
        if (!thinkingSnippets.includes(text)) {
            thinkingSnippets.push(text);
        }
    }

    // 5. 补充 msg.reasoning_content（如果存在原始 API 字段）
    if (msg.reasoning_content && typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
        const text = msg.reasoning_content.trim();
        if (!thinkingSnippets.includes(text)) {
            thinkingSnippets.push(text);
        }
    }

    // 6. 补充 msg.thought（如果存在）
    if (msg.thought && typeof msg.thought === 'string' && msg.thought.trim()) {
        const text = msg.thought.trim();
        if (!thinkingSnippets.includes(text)) {
            thinkingSnippets.push(text);
        }
    }

    const thinkingText = thinkingSnippets.join('\n\n');
    const cleanMainContent = cleanFromInline.trim();

    return {
        thinkingText,
        cleanMainContent
    };
}

/**
 * 将指定分支的消息列表按 TXT 纯文本格式要求转换（带 ASCII 楼层分隔符与切片范围）
 * @param {Array<object>} messages - 分支中的全部消息数组
 * @param {string} formatType - 导出格式 ('ai_txt' | 'full_txt' | 'user_txt')
 * @param {boolean} includeThink - 是否保留 AI 思考过程
 * @param {string} convTitle - 会话标题
 * @param {number} branchIndex - 分支索引
 * @param {{ start: number, end: number, isCustom: boolean }} range - 楼层切片范围
 * @returns {string} 组合后的 TXT 文本内容
 */
function formatBranchMessagesToText(messages, formatType, includeThink, convTitle, branchIndex, range) {
    // 1. 过滤符合楼层切片范围和角色的消息
    const indexedMessages = [];
    messages.forEach((msg, idx) => {
        if (!msg) return;
        const floor = idx + 1; // 楼层以 1 开始计数
        if (floor < range.start || floor > range.end) return;

        if (formatType === 'ai_txt' && msg.role === 'assistant') {
            indexedMessages.push({ msg, floor });
        } else if (formatType === 'user_txt' && msg.role === 'user') {
            indexedMessages.push({ msg, floor });
        } else if (formatType === 'full_txt') {
            indexedMessages.push({ msg, floor });
        }
    });

    const formatNameMap = {
        ai_txt: '纯 AI 回复',
        full_txt: '完整对话 (问答交替)',
        user_txt: '纯用户提问'
    };

    const now = new Date();
    const exportTimeStr = formatReadableTime(now);
    const rangeDesc = range.isCustom ? `第 ${range.start} ~ ${range.end} 楼 (切片范围)` : `全部楼层 (共 ${messages.length} 楼)`;
    const { textDesc: wbDesc } = getEffectiveWorldBookInfo(currentExportConvId);

    // 2. 组装文件头部元信息
    let output = [
        `================================================================================`,
        ` 会话名称：${convTitle || '未命名会话'}`,
        ` 导出格式：${formatNameMap[formatType] || '纯文本'} (.txt)`,
        ` 导出分支：第 ${branchIndex + 1} 号分支`,
        ` 楼层范围：${rangeDesc}`,
        ` 导出记录：共 ${indexedMessages.length} 条`,
        ` 生效备忘：${wbDesc}`,
        ` 导出时间：${exportTimeStr}`,
        `================================================================================\n`
    ].join('\n');

    if (indexedMessages.length === 0) {
        output += `\n（在第 ${range.start} ~ ${range.end} 楼范围内未找到符合【${formatNameMap[formatType]}】条件的消息记录）\n`;
        return output;
    }

    // 3. 逐条渲染消息楼层与内容
    indexedMessages.forEach(({ msg, floor }) => {
        let roleName = '消息';
        if (msg.role === 'user') {
            roleName = '用户提问';
        } else if (msg.role === 'assistant') {
            roleName = 'AI回复';
        } else if (msg.role === 'system') {
            roleName = '系统设定';
        }

        const msgTime = formatReadableTime(msg.timestamp);

        // 处理正文内容与思考过程
        let content = '';

        if (msg.role === 'assistant') {
            const { thinkingText, cleanMainContent } = extractMessageThinkingAndContent(msg);
            if (includeThink && thinkingText) {
                if (cleanMainContent) {
                    content = `<think>\n${thinkingText}\n</think>\n\n${cleanMainContent}`;
                } else {
                    content = `<think>\n${thinkingText}\n</think>`;
                }
            } else {
                content = cleanMainContent;
            }
        } else {
            const rawContent = msg.originalContent || msg.content || '';
            content = typeof rawContent === 'string' ? rawContent.trim() : JSON.stringify(rawContent, null, 2);
        }

        let attachmentInfo = '';
        if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            const fileNames = msg.attachments.map(att => att.name || '未命名附件').join(', ');
            attachmentInfo = `\n【附件列表】：${fileNames}`;
        }

        output += [
            `--------------------------------------------------------------------------------`,
            `【#${floor} 楼】 ${roleName}   |   时间: ${msgTime}`,
            `--------------------------------------------------------------------------------`,
            content.trim() ? content : '（空内容）',
            attachmentInfo,
            `\n`
        ].filter(Boolean).join('\n');
    });

    return output;
}

/**
 * 将指定分支的消息列表按 Markdown 格式要求转换（原生支持代码块高亮与分块排版）
 * @param {Array<object>} messages - 分支中的全部消息数组
 * @param {string} formatType - 导出格式 ('ai_txt' | 'full_txt' | 'user_txt')
 * @param {boolean} includeThink - 是否保留 AI 思考过程
 * @param {string} convTitle - 会话标题
 * @param {number} branchIndex - 分支索引
 * @param {{ start: number, end: number, isCustom: boolean }} range - 楼层切片范围
 * @returns {string} 组合后的 Markdown 文本内容
 */
function formatBranchMessagesToMarkdown(messages, formatType, includeThink, convTitle, branchIndex, range) {
    const indexedMessages = [];
    messages.forEach((msg, idx) => {
        if (!msg) return;
        const floor = idx + 1;
        if (floor < range.start || floor > range.end) return;

        if (formatType === 'ai_txt' && msg.role === 'assistant') {
            indexedMessages.push({ msg, floor });
        } else if (formatType === 'user_txt' && msg.role === 'user') {
            indexedMessages.push({ msg, floor });
        } else if (formatType === 'full_txt') {
            indexedMessages.push({ msg, floor });
        }
    });

    const formatNameMap = {
        ai_txt: '纯 AI 回复',
        full_txt: '完整对话 (问答交替)',
        user_txt: '纯用户提问'
    };

    const now = new Date();
    const exportTimeStr = formatReadableTime(now);
    const rangeDesc = range.isCustom ? `第 ${range.start} ~ ${range.end} 楼` : `第 1 ~ ${messages.length} 楼 (全部)`;
    const { textDesc: wbDesc } = getEffectiveWorldBookInfo(currentExportConvId);

    let output = [
        `# ${convTitle || '未命名会话'}`,
        ``,
        `> **导出格式**：${formatNameMap[formatType] || 'Markdown'}  `,
        `> **导出分支**：分支 ${branchIndex + 1}  `,
        `> **楼层范围**：${rangeDesc}（共 ${indexedMessages.length} 条记录）  `,
        `> **生效备忘**：${wbDesc}  `,
        `> **导出时间**：${exportTimeStr}  `,
        ``,
        `---`,
        ``
    ].join('\n');

    if (indexedMessages.length === 0) {
        output += `\n*（在第 ${range.start} ~ ${range.end} 楼范围内未找到符合【${formatNameMap[formatType]}】条件的消息记录）*\n`;
        return output;
    }

    indexedMessages.forEach(({ msg, floor }) => {
        let roleTitle = '消息';
        if (msg.role === 'user') {
            roleTitle = '👤 用户提问';
        } else if (msg.role === 'assistant') {
            roleTitle = '🤖 AI回复';
        } else if (msg.role === 'system') {
            roleTitle = '⚙️ 系统设定';
        }

        const msgTime = formatReadableTime(msg.timestamp);

        let content = '';
        if (msg.role === 'assistant') {
            const { thinkingText, cleanMainContent } = extractMessageThinkingAndContent(msg);
            if (includeThink && thinkingText) {
                if (cleanMainContent) {
                    content = `<think>\n${thinkingText}\n</think>\n\n${cleanMainContent}`;
                } else {
                    content = `<think>\n${thinkingText}\n</think>`;
                }
            } else {
                content = cleanMainContent;
            }
        } else {
            const rawContent = msg.originalContent || msg.content || '';
            content = typeof rawContent === 'string' ? rawContent.trim() : JSON.stringify(rawContent, null, 2);
        }

        let attachmentBlock = '';
        if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            const fileNames = msg.attachments.map(att => `\`${att.name || '未命名附件'}\``).join(', ');
            attachmentBlock = `\n\n> 📎 **附件**：${fileNames}`;
        }

        output += [
            `### #${floor} 楼 ${roleTitle} \`${msgTime}\``,
            ``,
            content.trim() ? content : '*（空内容）*',
            attachmentBlock,
            ``,
            `---`,
            ``
        ].filter(Boolean).join('\n');
    });

    return output;
}

/**
 * 刷新弹窗内格式卡片、格式后缀胶囊、分支与楼层切片控件的联动状态
 */
export function updateExportModalFormState() {
    const selectedRadio = document.querySelector('input[name="export-conv-format"]:checked');
    const format = selectedRadio ? selectedRadio.value : 'ai_txt';

    // 1. 同步卡片 active 类
    const cards = document.querySelectorAll('.export-format-card');
    cards.forEach(card => {
        const radio = card.querySelector('input[type="radio"]');
        if (radio && radio.checked) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    // 2. 同步文件后缀胶囊状态
    const extRadios = document.querySelectorAll('input[name="export-file-ext"]');
    const extCapsules = document.querySelectorAll('.export-ext-capsule');
    extCapsules.forEach(capsule => {
        const radio = capsule.querySelector('input[type="radio"]');
        if (radio && radio.checked) {
            capsule.classList.add('active');
        } else {
            capsule.classList.remove('active');
        }
    });

    // 3. 楼层切片模式联动
    const floorModeRadio = document.querySelector('input[name="export-floor-mode"]:checked');
    const isCustomFloor = floorModeRadio ? floorModeRadio.value === 'custom' : false;
    if (dom.exportRangeStart && dom.exportRangeEnd) {
        dom.exportRangeStart.disabled = !isCustomFloor;
        dom.exportRangeEnd.disabled = !isCustomFloor;
    }

    // 4. 根据 JSON / 文本 切换分支、后缀与楼层切片区
    if (!dom.exportBranchGroup || !dom.exportConvBranchSelect) return;

    if (format === 'json') {
        // JSON 导出为全量备份，无需指定单分支与切片
        dom.exportBranchGroup.style.opacity = '0.5';
        dom.exportConvBranchSelect.disabled = true;
        if (dom.exportBranchTip) {
            dom.exportBranchTip.textContent = '（JSON格式将导出所有分支全部数据）';
        }
        if (dom.exportFileExtGroup) {
            dom.exportFileExtGroup.style.opacity = '0.4';
            dom.exportFileExtGroup.style.pointerEvents = 'none';
        }
        if (dom.exportFloorRangeGroup) {
            dom.exportFloorRangeGroup.style.display = 'none';
        }
        if (dom.exportOptionsGroup) {
            dom.exportOptionsGroup.style.display = 'none';
        }
    } else {
        // 文本 / Markdown 格式导出
        dom.exportBranchGroup.style.opacity = '1';
        dom.exportConvBranchSelect.disabled = false;
        if (dom.exportBranchTip) {
            dom.exportBranchTip.textContent = '（已默认选中最新分支）';
        }

        if (dom.exportFileExtGroup) {
            dom.exportFileExtGroup.style.opacity = '1';
            dom.exportFileExtGroup.style.pointerEvents = 'auto';
        }

        if (dom.exportFloorRangeGroup) {
            dom.exportFloorRangeGroup.style.display = 'block';
        }

        if (dom.exportOptionsGroup) {
            if (format === 'user_txt') {
                dom.exportOptionsGroup.style.display = 'none';
            } else {
                dom.exportOptionsGroup.style.display = 'block';
            }
        }
    }
}

/**
 * 刷新当前选中分支的楼层总数与切片输入框最大值
 */
function updateFloorRangeLimits() {
    if (!currentExportConvData) return;
    const branches = Array.isArray(currentExportConvData.branches) ? currentExportConvData.branches : [[]];
    const branchIndex = dom.exportConvBranchSelect ? parseInt(dom.exportConvBranchSelect.value, 10) : 0;
    const branch = branches[branchIndex] || [];
    const totalCount = branch.length;

    if (dom.exportFloorTotalTip) {
        dom.exportFloorTotalTip.textContent = `（当前分支共 ${totalCount} 楼）`;
    }

    if (dom.exportRangeStart && dom.exportRangeEnd) {
        dom.exportRangeStart.max = String(Math.max(1, totalCount));
        dom.exportRangeEnd.max = String(Math.max(1, totalCount));

        // 默认将结束楼层设为总楼层
        if (!dom.exportRangeEnd.value || parseInt(dom.exportRangeEnd.value, 10) > totalCount || parseInt(dom.exportRangeEnd.value, 10) <= 1) {
            dom.exportRangeEnd.value = String(Math.max(1, totalCount));
        }
        if (!dom.exportRangeStart.value || parseInt(dom.exportRangeStart.value, 10) < 1) {
            dom.exportRangeStart.value = '1';
        }
    }
}

/**
 * 打开导出会话弹窗
 * @param {string} convId - 会话ID
 */
export async function openExportConvModal(convId) {
    if (!convId) return;

    let conversation = state.conversations[convId];
    if (!conversation || !conversation.branches) {
        try {
            conversation = await getConversation(convId);
        } catch (err) {
            console.error('从 IndexedDB 获取会话详情失败:', err);
        }
    }

    if (!conversation) {
        notify.error('会话不存在或已被删除');
        return;
    }

    currentExportConvId = convId;
    currentExportConvData = conversation;

    // 1. 设置展示标题
    if (dom.exportConvTitleDisplay) {
        const titleText = conversation.title || '未命名对话';
        dom.exportConvTitleDisplay.textContent = titleText;
        dom.exportConvTitleDisplay.title = titleText;
    }

    // 2. 初始化分支选择下拉框（默认选中最新分支）
    if (dom.exportConvBranchSelect) {
        dom.exportConvBranchSelect.innerHTML = '';
        const branches = Array.isArray(conversation.branches) ? conversation.branches : [[]];
        const totalBranches = branches.length;
        const defaultBranchIndex = Math.max(0, totalBranches - 1);

        branches.forEach((branch, bIdx) => {
            const count = Array.isArray(branch) ? branch.length : 0;
            const isLatest = (bIdx === totalBranches - 1);
            const isCurrent = (bIdx === conversation.activeBranchIndex);

            let tag = '';
            if (isLatest && isCurrent) {
                tag = ' [当前·最新]';
            } else if (isLatest) {
                tag = ' [最新]';
            } else if (isCurrent) {
                tag = ' [当前]';
            }

            const option = document.createElement('option');
            option.value = String(bIdx);
            option.textContent = `分支 ${bIdx + 1} / ${totalBranches} (共 ${count} 条消息)${tag}`;
            dom.exportConvBranchSelect.appendChild(option);
        });

        dom.exportConvBranchSelect.value = String(defaultBranchIndex);
    }

    // 3. 重置楼层范围与输入框
    const allFloorRadio = document.querySelector('input[name="export-floor-mode"][value="all"]');
    if (allFloorRadio) allFloorRadio.checked = true;
    updateFloorRangeLimits();

    // 4. 重置思考过程勾选框
    if (dom.exportIncludeThinkCheckbox) {
        dom.exportIncludeThinkCheckbox.checked = false;
    }

    // 5. 重置导出格式单选为默认的“纯 AI 回复 (ai_txt)”
    const defaultRadio = document.querySelector('input[name="export-conv-format"][value="ai_txt"]');
    if (defaultRadio) {
        defaultRadio.checked = true;
    }

    // 6. 重置文件后缀为 .txt
    const txtExtRadio = document.querySelector('input[name="export-file-ext"][value="txt"]');
    if (txtExtRadio) {
        txtExtRadio.checked = true;
    }

    // 7. 刷新界面状态
    updateExportModalFormState();

    // 8. 展示弹窗
    if (dom.exportConvModal) {
        dom.exportConvModal.style.display = 'flex';
        dom.exportConvModal.classList.add('visible');
    }
}

/**
 * 关闭导出会话弹窗
 */
export function closeExportConvModal() {
    if (!dom.exportConvModal) return;
    dom.exportConvModal.classList.remove('visible');
    dom.exportConvModal.style.display = 'none';
    currentExportConvId = null;
    currentExportConvData = null;
}

/**
 * 读取当前设置的楼层切片范围
 * @param {number} totalCount - 当前分支消息总数
 * @returns {{ start: number, end: number, isCustom: boolean }}
 */
function getSelectedFloorRange(totalCount) {
    const floorModeRadio = document.querySelector('input[name="export-floor-mode"]:checked');
    const isCustom = floorModeRadio ? floorModeRadio.value === 'custom' : false;

    if (!isCustom || totalCount <= 0) {
        return { start: 1, end: Math.max(1, totalCount), isCustom: false };
    }

    let start = dom.exportRangeStart ? parseInt(dom.exportRangeStart.value, 10) : 1;
    let end = dom.exportRangeEnd ? parseInt(dom.exportRangeEnd.value, 10) : totalCount;

    if (isNaN(start) || start < 1) start = 1;
    if (isNaN(end) || end < 1) end = totalCount;
    if (start > totalCount) start = totalCount;
    if (end > totalCount) end = totalCount;
    if (start > end) {
        const temp = start;
        start = end;
        end = temp;
    }

    return { start, end, isCustom: true };
}

/**
 * 执行导出操作
 */
/**
 * 获取当前会话生效的备忘录摘要信息（包含全局生效与局部生效）
 * @param {string} convId - 会话ID
 * @returns {{ textDesc: string, relatedEntries: Array<object> }}
 */
function getEffectiveWorldBookInfo(convId) {
    if (!state.worldBook || typeof state.worldBook !== 'object') {
        return { textDesc: '无', relatedEntries: [] };
    }

    const globalEntries = [];
    const localEntries = [];

    Object.values(state.worldBook).forEach(entry => {
        if (!entry) return;
        if (entry.enabled) {
            globalEntries.push(entry);
        } else if (convId && Array.isArray(entry.sessionIds) && entry.sessionIds.includes(convId)) {
            localEntries.push(entry);
        }
    });

    const descParts = [];
    if (localEntries.length > 0) {
        const localNames = localEntries.map(e => `${e.name}(局部·深度:${e.depth})`).join(', ');
        descParts.push(`当前会话局部: ${localNames}`);
    }
    if (globalEntries.length > 0) {
        const globalNames = globalEntries.map(e => `${e.name}(全局·深度:${e.depth})`).join(', ');
        descParts.push(`全局挂载: ${globalNames}`);
    }

    return {
        textDesc: descParts.length > 0 ? descParts.join(' | ') : '无',
        relatedEntries: localEntries
    };
}

export async function executeExportConversation() {
    if (!currentExportConvData) {
        notify.warning('未找到待导出的会话数据');
        closeExportConvModal();
        return;
    }

    const conversation = currentExportConvData;
    const selectedRadio = document.querySelector('input[name="export-conv-format"]:checked');
    const format = selectedRadio ? selectedRadio.value : 'ai_txt';
    const branchIndex = dom.exportConvBranchSelect ? parseInt(dom.exportConvBranchSelect.value, 10) : 0;
    const includeThink = dom.exportIncludeThinkCheckbox ? dom.exportIncludeThinkCheckbox.checked : false;

    // 清理文件名非法字符
    const sanitizedTitle = (conversation.title || '对话')
        .replace(/[\/:*?"<>|]/g, '_')
        .substring(0, 50);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(regexPatterns.timestampFormat, '-');

    try {
        if (format === 'json') {
            // === 导出 JSON 格式（全量数据 + 关联备忘录 + 隐藏总结） ===
            const convToExport = JSON.parse(JSON.stringify(conversation));
            convToExport.version = '2.0';
            convToExport.exportedAt = new Date().toISOString();

            // 附带当前会话关联生效的局部备忘录
            const { relatedEntries } = getEffectiveWorldBookInfo(conversation.id);
            if (relatedEntries.length > 0) {
                convToExport.relatedWorldBook = relatedEntries;
            }

            // 附带当前会话隐藏总结配置
            if (state.hideSummary && state.hideSummary[conversation.id]) {
                convToExport.hideSummary = state.hideSummary[conversation.id];
            }

            // 附带当前会话专属正则规则
            const sessionRegex = [];
            if (state.regexRules && typeof state.regexRules === 'object') {
                Object.values(state.regexRules).forEach(rule => {
                    if (rule && rule.scope === 'session' && Array.isArray(rule.sessionIds) && rule.sessionIds.map(String).includes(String(conversation.id))) {
                        sessionRegex.push(JSON.parse(JSON.stringify(rule)));
                    }
                });
            }
            if (sessionRegex.length > 0) {
                convToExport.sessionRegexRules = sessionRegex;
            }

            const jsonString = JSON.stringify(convToExport, null, 2);
            const fileName = `${sanitizedTitle}-${dateStr}_${timeStr}.json`;
            downloadBlob(jsonString, fileName, 'application/json;charset=utf-8');
        } else {
            // === 导出 TXT 或 Markdown 格式 ===
            const branches = Array.isArray(conversation.branches) ? conversation.branches : [[]];
            const activeBranch = branches[branchIndex] || branches[0] || [];
            const range = getSelectedFloorRange(activeBranch.length);

            // 读取文件后缀选择 (.txt 或 .md)
            const extRadio = document.querySelector('input[name="export-file-ext"]:checked');
            const fileExt = extRadio ? extRadio.value : 'txt';

            const formatSuffixMap = {
                ai_txt: '纯AI回复',
                full_txt: '完整对话',
                user_txt: '纯用户提问'
            };

            const suffix = formatSuffixMap[format] || '文本';
            const rangeTag = range.isCustom ? `-第${range.start}_${range.end}楼` : '';
            const fileName = `${sanitizedTitle}-${suffix}-分支${branchIndex + 1}${rangeTag}-${dateStr}_${timeStr}.${fileExt}`;

            if (fileExt === 'md') {
                const mdContent = formatBranchMessagesToMarkdown(
                    activeBranch,
                    format,
                    includeThink,
                    conversation.title,
                    branchIndex,
                    range
                );
                downloadBlob(mdContent, fileName, 'text/markdown;charset=utf-8');
            } else {
                const textContent = formatBranchMessagesToText(
                    activeBranch,
                    format,
                    includeThink,
                    conversation.title,
                    branchIndex,
                    range
                );
                downloadBlob(textContent, fileName, 'text/plain;charset=utf-8');
            }
        }

        notify.success('会话导出成功');
        closeExportConvModal();
    } catch (err) {
        console.error('导出会话失败:', err);
        notify.error('导出会话失败，请重试');
    }
}

/**
 * 初始化导出会话弹窗的全部事件绑定
 */
export function setupExportConvModalEvents() {
    // 1. 确认导出按钮
    if (dom.exportConvConfirmBtn) {
        dom.exportConvConfirmBtn.addEventListener('click', executeExportConversation);
    }

    // 2. 取消按钮
    if (dom.exportConvCancelBtn) {
        dom.exportConvCancelBtn.addEventListener('click', closeExportConvModal);
    }

    // 3. 弹窗蒙层点击与关闭按钮
    if (dom.exportConvModal) {
        dom.exportConvModal.addEventListener('click', (e) => {
            if (e.target === dom.exportConvModal || e.target.classList.contains('modal-close-btn')) {
                closeExportConvModal();
            }
        });
    }

    // 4. 单选格式卡片点击与变更事件监听
    const formatRadios = document.querySelectorAll('input[name="export-conv-format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener('change', updateExportModalFormState);
    });

    const formatCards = document.querySelectorAll('.export-format-card');
    formatCards.forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target && e.target.tagName === 'INPUT') return;
            const radio = card.querySelector('input[type="radio"]');
            if (radio && !radio.checked) {
                radio.checked = true;
                updateExportModalFormState();
            }
        });
    });

    // 5. 文件后缀胶囊变更监听
    const extRadios = document.querySelectorAll('input[name="export-file-ext"]');
    extRadios.forEach(radio => {
        radio.addEventListener('change', updateExportModalFormState);
    });

    // 6. 楼层切片单选变更监听
    const floorModeRadios = document.querySelectorAll('input[name="export-floor-mode"]');
    floorModeRadios.forEach(radio => {
        radio.addEventListener('change', updateExportModalFormState);
    });

    // 7. 分支切换联动更新楼层限制
    if (dom.exportConvBranchSelect) {
        dom.exportConvBranchSelect.addEventListener('change', updateFloorRangeLimits);
    }

    // 8. 键盘快捷键监听 (Enter 快速导出, Esc 关闭)
    document.addEventListener('keydown', (e) => {
        if (!dom.exportConvModal || !dom.exportConvModal.classList.contains('visible')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeExportConvModal();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || document.activeElement === dom.exportConvConfirmBtn)) {
            e.preventDefault();
            executeExportConversation();
        }
    });
}
