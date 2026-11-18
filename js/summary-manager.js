/**
 * @file summary-manager.js
 * @description 对话记忆与智能总结模块（支持递归滚动、列表拼接、角色扮演双表3种记忆模式，支持自动触发与滚动上下文压缩）
 */

import { state } from './state.js?v=temp';
import { dom } from './dom.js?v=temp';
import { saveConversation } from './db.js?v=temp';
import { saveToLocalStorage, countTokens, isMessageHidden, extractThinkingFromContent } from './utils.js?v=temp';
import { regexPatterns } from './regex.js?v=temp';
import { buildApiRequest, processAndFilterMessages } from './api-common.js?v=temp';
import { renderChatMessages } from './renderer.js?v=temp';
import { notify, updateSummaryEditorLockState, showErrorDialog } from './ui-updater.js?v=temp';
import { getHideSummaryForConversation, setHideSummaryForConversation } from './main.js?v=temp';

// — 为什么这么写 —
// 3 种记忆模式官方默认提示词常量：
// 1. 递归滚动模式：全量融合，要求继承旧记忆与融入新进展
// 2. 列表拼接模式：增量追加，仅提炼新楼层，不要复述旧片段
// 3. 结构双表模式：结构化维护历史记录表与实体/角色信息表
export const DEFAULT_PROMPT_RECURSIVE = `请结合【已有长期记忆总结】与最新的【新增待总结对话】，提炼并生成一份整合后的全新长期记忆：
1. 【关键时间节点】：必须按时间发展脉络梳理，明确标注每一重大事件/核心阶段的关键时间节点（如年份、日期或特定纪年）。若原文或对话中缺乏明确时间线索，则默认从【第1年】开始推演并按序推进；
2. 【继承与保留】：严格保留旧记忆中仍然有效的核心背景、重要设定、关键决策与未决问题；
3. 【融合新进展】：将新对话中发生的重大事件与各主体最新动向精准融入对应时间线中；
4. 【去粗取精】：剔除已过时的琐碎临时对话，整体条理清晰、层次分明，作为后续对话全局长期记忆参考。`;

export const DEFAULT_PROMPT_APPEND = `请参考【已知历史记忆摘要集】，仅针对【本次新增对话内容】进行精炼提炼，输出一条阶段性新增记忆摘要：
1. 【必须标注关键时间节点】：摘要开头必须明确交代本阶段发生的时间节点（如年份、月份或特定纪年；若对话中无明确时间线索，请结合前文记忆递增推算，或默认从【第1年】起算）；
2. 【核心提炼】：清晰概括该阶段新发生的核心重大事件、关键地点与涉及主体状态变动；
3. 【避免冗余】：不要重复上方已有的旧记忆内容，保持独立完整与高度精炼。`;

export const DEFAULT_PROMPT_TABLE = `请根据【最新对话与上下文】，对【历史记录表】与【最新实体信息表】进行结构化维护。
为了保证事实脉络完整与高效率，请不要重抄已有全部记录，请严格按照以下【更新 -> 删除 -> 新增追加】格式输出：

### 表1：历史记录表操作
【更新】
- 序号: 修改内容（例如: E2: 事件=补充说明在此处达成了重要共识。若无更新填：无）
【删除】
- 序号（例如: E5。若无删除填：无）
【新增追加】
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |
| ... | ... | ... | ... | ... |
（注意：【新增追加】严格固定为 5 列，第一列必须是“时间”，绝对禁止添加“序号”或 [E...] 列！系统会自动按序分配序号；时间列必须明确标注关键时间节点，若无明确时间线索默认从【第1年】起算；
★【涉及物品】强约束：仅收录对剧情推进、因果转折、身份凭证、案件线索或生死利益具有重大关键影响的物品（如：密信、密旨、官凭令牌、毒药解药、重要账册、核心机密、定情信物等）；坚决禁止记录任何日常衣物（如外套、裙子、拖鞋）、日常家具陈设（如沙发、床单、夜灯）、无特殊因果作用的普通生活日用品。若本事件无关键影响物品，必须填“-”或“无”，严禁拿生活起居用品充数；若无新重大事件填：无）

### 表2：实体信息表操作
【更新】
- 序号: 最新状态说明=... | 持有关键道具=...（例如: C1: 最新状态说明=正常履职 | 持有关键道具=密诏。未变动的实体无需列出；若全部无变动填：无）
【删除】
- 序号（仅在实体彻底失效或退场时填写，若无填：无）
【新增追加】
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |
| ... | ... | ... | ... |
（注意：【新增追加】严格固定为 4 列，第一列必须是“姓名”，绝对禁止添加“序号”或 [C...] 列！系统会自动按序分配序号；
★【持有关键道具】强约束：仅收录该实体专属的、象征其特殊身份、能力增幅或具有重大因果绑定的核心信物、专属神兵、授权凭证或机密文书；坚决禁止记录日常饮食消耗品（如水果、奶茶、烟酒茶、零食）、日常办公杂物与生活随身物（如烟灰缸、文件夹、普通文件袋、发票单据、普通手机、拉杆箱等）。若该实体当前未持有决定性影响的关键道具，必须填“无”；若无新登场实体填：无）`;

// 向下兼容别名
export const DEFAULT_SUMMARY_PROMPT = DEFAULT_PROMPT_RECURSIVE;

// — 为什么这么写 —
// 记忆精炼与跨模式重构官方默认提示词（覆盖 3 种记忆模式的同模式脱水与跨模式结构重构）
export const CONDENSE_PROMPTS = {
    recursive: {
        balanced: `请对以下【已有长期记忆总结】进行二次深度提炼与脱水精炼：
1. 【时间发展脉络】：必须按时间发展脉络梳理，明确标注重大事件与核心转折发生的关键时间节点（年份、日期或特定纪年；若原文缺乏明确时间线索，统一默认从【第1年】起算推进推演），确保提炼后的记忆具备清晰严密的时间概念；
2. 【核心转折与首次记忆保留（最高保护级）】：
   - 首次交汇记忆：严格保留核心角色之间奠定关系基石的「首次关键事件」（如初遇契机、首次交锋、首次关系升温、达成共识/誓约、交付信物或产生信任的源头事件）；
   - 不可逆转折点：完整保留推动局势与人物关系走向质变的「重大转折事件」（如身份揭露、生死救援、立场倒戈、重大背叛、关系破裂、心境巨变等）；
   - 强禁令：严禁因追求字数精炼而将奠定角色核心动机与深刻羁绊的起源及转折事件抹除，或笼统概括为失去情感张力的模糊一笔；
3. 【去粗取精】：剔除已被后续对话覆盖的过时状态、临时推测以及冗余的过渡细节；
4. 【合并归纳】：将同一主题或事件脉络的分散片段进行整合，语言保持高度凝练、条理分明；
5. 【核心保留】：严格保留核心设定、关键决策与共识、不可逆的重大转折与未决事项；
6. 【篇幅目标】：在完整保留核心事实、关键记忆与逻辑链条的前提下，削减约 40%~60% 冗余篇幅，输出紧凑精炼的全新长期记忆。`,
        extreme: `请对以下【已有长期记忆总结】进行极限脱水与骨架压缩：
1. 【时间轴与核心骨架】：必须保留核心时间轴脉络，明确标注关键分水岭时间节点（若无明确时间线索统一默认从【第1年】起算）；
2. 【关键起源与转折锚点】：即使极限压缩，也必须保留核心角色关系的「初遇契机/首次交锋/首次关系升温」及「生死/背叛/盟约等不可逆命运转折」，绝不能抹平角色动机源头；
3. 仅保留最核心的世界线/业务主轴、不可动摇的核心背景、各关键实体的最终定位与关键要素；
4. 彻底删除所有过渡描写、次要情节、日常寒暄与临时推论；
5. 以极简大纲条目化输出，文字高度精简（压缩 70%~80%），仅留时间节点、骨架与核心真相。`,
        to_table: `请将以下【已有长期记忆长文】，通过深度实体对齐与时序分析，全面重构抽取为规范的【结构双表】（历史记录表 + 核心实体信息表）：
1. 【历史记录表与时间线强规则】：
   - 必须建立清晰严谨的时间发展脉络，将长文中的事件因果严格按时序排列；
   - 表格中的【时间】列必须严谨填写具体时间节点（年份、日期或特定纪年）；
   - 若上下文或长文中缺乏明确时间线索，必须统一强制默认从【第1年】起算依序推演推进（严禁留空、填“未知”或模糊带过）；
   - 提炼为规范结构化表格（字段：时间、地点、涉及角色、事件、涉及物品）；
   - 【涉及物品强约束】：仅收录对剧情有关键因果与凭据价值的核心物品（如密信、令牌、机密账册等），严禁记录衣物、家具与日常起居消耗品，无则填“-”；
2. 【最新实体信息表】：对齐并抽取出对话中涉及的所有核心实体/角色，整理其最新状态与关键属性（字段：姓名、简介、最新状态说明、持有关键道具）；
   - 【关键道具强约束】：仅收录专属信物、身份凭证或核心神兵机密，严禁收录水果、奶茶、办公杂物等日常饮食或随身杂物，无则填“无”；
3. 必须严格按照以下 Markdown 双表格式输出，不要输出任何多余废话：

### 历史记录表
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |

### 最新实体信息表
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |`,
        to_append: `请将以下【已有长期记忆长文】，按时间因果与发展阶段，重构提炼为一组具有严密时间概念与时序里程碑意义的【记忆卡片流】：
1. 【时间脉络与阶段划分】：必须建立清晰的时间发展脉络，将长文内容梳理为 3~5 个关键阶段卡片；
2. 【强制标注时间节点】：每张卡片的标题与开头必须明确标注该阶段发生的核心时间节点或时间跨度（年份、日期或特定纪年；若长文中缺乏明确时间线索，统一强制默认从【第1年】起算推进推演，确保每张卡片具备明确时间概念）；
3. 每张卡片严格按照如下标准格式输出：
[阶段 X (第Y年 / 具体时间跨度)]: 提炼该阶段发生的核心事件、重大转折及各实体的状态变迁；
4. 各阶段之间时序衔接紧密，因果分明，重点突出，不要有重复描述。`
    },
    append: {
        balanced: `请对以下【历史记忆摘要集】进行合并重构与精炼：
1. 【时间脉络与节点】：必须按时间发展脉络将分散的小片段重新整合为 3~5 个具有里程碑意义的大阶段记忆卡片，卡片标题与内容必须明确标注时间节点或时间跨度（若无明确时间线索统一默认从【第1年】起算推演）；
2. 【核心转折与首次记忆保留（最高保护级）】：
   - 严格保留核心角色间的「初遇契机、首次交锋、首次关系升温、立约交付信物」等起源事件，以及「生死救援、背叛决裂、立场巨变」等重大转折里程碑；
   - 严禁为了压缩篇幅而将建立羁绊与矛盾的核心记忆抹平；
3. 每张卡片严格按照如下格式输出：
[阶段 X (第Y年 / 第 A~B 楼)]: 核心事件脉络与实体关键状态；
4. 剔除重复交代的情节，文字凝练有力，时间概念清晰。`,
        extreme: `请将以下【历史记忆摘要集】进行极限压缩，仅输出 1~2 个覆盖全盘的超简宏观大纲卡片：
1. 必须包含宏观时间跨度（若无明确时间线索统一默认从【第1年】起算）；
2. 格式：
[阶段 1 (全局核心历程 / 时间跨度)]: ...`,
        to_table: `请将以下【历史记忆摘要集】，通过深度实体对齐与时序分析，全面重构抽取为规范的【结构双表】（历史记录表 + 核心实体信息表）：
1. 【历史记录表与时间线强规则】：
   - 必须建立清晰严谨的时间发展脉络，将各阶段卡片事件按时序梳理；
   - 表格中的【时间】列必须严谨填写具体时间节点（年份、日期或特定纪年）；
   - 若上下文缺乏明确时间线索，必须统一强制默认从【第1年】起算依序推演推进（严禁留空、填“未知”或模糊带过）；
   - 提炼为规范结构化表格（字段：时间、地点、涉及角色、事件、涉及物品）；
   - 【涉及物品强约束】：仅收录对剧情有关键因果与凭据价值的核心物品（如密信、令牌、机密账册等），严禁记录衣物、家具与日常起居消耗品，无则填“-”；
2. 【最新实体信息表】：对齐并抽取出对话中涉及的所有核心实体/角色，整理其最新状态与关键属性（字段：姓名、简介、最新状态说明、持有关键道具）；
   - 【关键道具强约束】：仅收录专属信物、身份凭证或核心神兵机密，严禁收录水果、奶茶、办公杂物等日常饮食或随身杂物，无则填“无”；
3. 必须严格按照以下 Markdown 双表格式输出，不要输出任何多余废话：

### 历史记录表
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |

### 最新实体信息表
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |`,
        to_recursive: `请将以下【历史记忆摘要集】的所有阶段卡片，融合成一篇逻辑严密、叙事流畅、重点突出的【递归全景记忆长文】：
1. 【严谨编年时序与时间概念】：
   - 必须建立清晰的时间发展脉络，将各阶段卡片按严谨的编年时序有机融汇；
   - 明确标注每个核心阶段与重大事件发生的准确时间节点（年份、日期或特定纪年；若原文缺乏明确时间线索，统一强制默认从【第1年】起算推进推演，杜绝时间概念缺失）；
2. 【因果还原与长文叙事】：完整还原关键事件的起因、经过、转折与最终结果；
3. 【实体状态对齐】：准确体现各核心实体/人物的关键特质、最新处境、核心属性与未决事项；
4. 【结构化组织】：剔除卡片机械分割，组织为条理清晰的编年体段落长文（可使用清晰的 Markdown 二级标题与结构化小节），作为后续大模型对话的系统级全景记忆背景。`
    },
    table: {
        balanced: `请根据给定的【结构双表】，进行结构化合并与降维精炼，并严格按照以下 Markdown 双表格式输出：
1. 【历史记录表与时间线维护】：
   - 合并时间线，确保每一行【时间】列都有明确严谨的时间节点（若无明确线索统一默认从【第1年】起算推进）；
   - 【核心转折与首次记忆强保留】：严格保留角色间奠定羁绊的首次关键事件（初遇契机、首次交锋、首次关系升温、立约信物）与不可逆转折点（身份揭露、生死救援、背叛决裂等），严禁当作琐碎情节误删；
   - 将琐碎过渡事件合并至关键里程碑中，清理非关键事件行；清理所有普通日用品，【涉及物品】仅保留密信、令牌等因果核心凭证；
2. 【最新实体信息表】：清理已退场或无关紧要的临时实体，合并核心实体最新状态与关键要素；
   - 清理水果、奶茶、办公杂物等日常消耗，【持有关键道具】仅保留专属核心信物与机密，无则填“无”；
3. 必须保持表头字段完全一致。

### 历史记录表
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |

### 最新实体信息表
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |`,
        extreme: `请根据给定的【结构双表】，进行极限压缩，大幅精简表格行数，严格按照以下 Markdown 双表格式输出：
1. 【历史记录表】：仅保留改变局势走向的 3~5 个重大分水岭事件，时间列明确标注关键年份或节点（若无明确线索统一默认从【第1年】起算），删除一切次要事件；
2. 【最新实体信息表】：仅保留最核心的关键实体与当期活跃对象，删除所有普通附属项；
3. 必须保持表头字段完全一致。

### 历史记录表
| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |

### 最新实体信息表
| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |`,
        to_recursive: `请将以下【结构双表】（历史记录表与实体信息表）中的所有设定、因果脉络、事件历程与实体状态，融合成一篇逻辑严密、叙事流畅、重点突出的【递归全景记忆长文】：
1. 【严谨编年时序与时间脉络】：
   - 严格依托历史记录表中的时间节点，建立清晰连贯的时间发展脉络；
   - 明确标注每个核心阶段与重大事件发生的准确时间（年份、日期或特定纪年；若表格中时间缺失，统一强制默认从【第1年】起算顺次推进推演，确保全文时间概念清晰严密）；
2. 【因果还原与长文叙事】：完整还原关键事件的起因、经过、转折与最终结果；
3. 【实体状态对齐】：准确体现各核心实体/人物的关键特质、最新处境、核心属性与未决事项；
4. 【结构化组织】：剔除表格机械痕迹，组织为条理清晰的编年体段落长文（使用清晰的 Markdown 二级标题与时间小节），作为后续大模型对话的系统级全景记忆背景。`,
        to_append: `请将以下【结构双表】中的历史事件与实体发展历程，按时间发展阶段重构提炼为一组具有严谨时间概念与时序里程碑意义的【记忆卡片流】：
1. 【时间脉络与阶段划分】：必须建立清晰的时间发展脉络，将双表中的历史事件按时序归并为 3~5 个关键阶段卡片；
2. 【强制标注时间节点】：每张卡片的标题与开头必须明确标注该阶段发生的具体时间节点或时间跨度（年份、日期或特定纪年；若表格中缺乏明确时间线索，统一强制默认从【第1年】起算推进推演，确保每张卡片具备明确时间概念）；
3. 每张卡片严格按照如下标准格式输出：
[阶段 X (第Y年 / 具体时间跨度)]: 提炼该阶段发生的核心事件、重大转折及各实体的状态变迁；
4. 各阶段之间时序衔接紧密，因果分明，重点突出，不要有重复描述。`
    }
};

/**
 * 根据记忆模式与策略获取二次浓缩/跨模式重构默认提示词
 * @param {string} mode - 'recursive' | 'table' | 'append'
 * @param {string} strategy - 'balanced' | 'extreme' | 'to_table' | 'to_recursive' | 'to_append'
 * @returns {string} 提示词内容
 */
export function getDefaultCondensePrompt(mode = 'recursive', strategy = 'balanced') {
    return CONDENSE_PROMPTS[mode]?.[strategy] || CONDENSE_PROMPTS.recursive.balanced;
}

/**
 * 根据模式获取默认提示词
 * @param {string} mode - 'recursive' | 'append' | 'table'
 * @returns {string} 提示词内容
 */
export function getDefaultPromptForMode(mode) {
    if (mode === 'append') return DEFAULT_PROMPT_APPEND;
    if (mode === 'table') return DEFAULT_PROMPT_TABLE;
    return DEFAULT_PROMPT_RECURSIVE;
}

/**
 * 检查给定提示词是否属于官方旧版默认提示词指纹
 * 必须严格匹配官方旧版特征指纹，严禁误伤用户自己撰写的个性化提示词
 * @param {string} prompt - 待检测的提示词文本
 * @param {string} mode - 'recursive' | 'append' | 'table'
 * @returns {boolean} 是否为官方旧版默认提示词
 */
export function isLegacyDefaultPrompt(prompt, mode = 'recursive') {
    if (!prompt || typeof prompt !== 'string') return false;
    const trimmed = prompt.trim();

    if (mode === 'recursive') {
        // 旧版初代（DEFAULT_SUMMARY_PROMPT）
        if (trimmed.includes('请对上述可见的历史对话内容进行全面、客观且条理清晰的提炼与总结')) {
            return true;
        }
        // 旧版二代：包含核心引导句，但缺少【关键时间节点】规范或【第1年】推演设定
        if (trimmed.includes('请结合【已有长期记忆总结】与最新的【新增待总结对话】')) {
            if (!trimmed.includes('【关键时间节点】') || !trimmed.includes('第1年')) {
                return true;
            }
        }
        return false;
    }

    if (mode === 'append') {
        // 旧版初代或缺少时间节点要求的列表拼接指纹
        if (trimmed.includes('请参考【已知历史记忆摘要集】，仅针对【本次新增对话内容】进行精炼提炼')) {
            if (!trimmed.includes('【必须标注关键时间节点】') || !trimmed.includes('第1年')) {
                return true;
            }
        }
        return false;
    }

    if (mode === 'table') {
        // 匹配官方双表指纹特征：必须具备官方双表组合特征，严禁误伤仅提及“角色信息表”的用户自定义提示词
        const isOfficialTable = (
            trimmed.includes('结合现有的【历史记录表】和【最新角色信息表】') ||
            (trimmed.includes('历史记录表') && trimmed.includes('最新角色信息表')) ||
            (trimmed.includes('历史记录表') && trimmed.includes('实体信息表') && trimmed.includes('【更新 -> 删除 -> 新增追加】')) ||
            (trimmed.includes('表1：历史记录表操作') && trimmed.includes('表2：实体信息表操作')) ||
            (trimmed.includes('请根据【最新对话与上下文】') && trimmed.includes('历史记录表')) ||
            (trimmed.includes('请根据【最新剧情对话】') && trimmed.includes('历史记录表'))
        );

        if (isOfficialTable) {
            // 旧版初代跑团双表（包含最新角色信息表或缺少 Diff Patch 三阶段）
            if (trimmed.includes('最新角色信息表')) return true;
            if (!trimmed.includes('【更新】') || !trimmed.includes('【删除】') || !trimmed.includes('【新增追加】')) return true;
            // 旧版 Diff 提示词（缺少第1年时间列强制要求，或缺少物品/道具强负向排除规范）
            if (!trimmed.includes('第1年')) return true;
            if (!trimmed.includes('★【涉及物品】强约束') || !trimmed.includes('日常衣物') || !trimmed.includes('日常饮食消耗品')) return true;
        }
        return false;
    }

    return false;
}

/**
 * 若检测到官方旧版默认提示词指纹，自动静默升级为最新版本；否则原样保留
 * @param {string} prompt - 待升级的提示词
 * @param {string} mode - 'recursive' | 'append' | 'table'
 * @returns {string} 升级后的提示词
 */
export function upgradeLegacyDefaultPrompt(prompt, mode = 'recursive') {
    if (isLegacyDefaultPrompt(prompt, mode)) {
        return getDefaultPromptForMode(mode);
    }
    return prompt;
}

/**
 * 标准化并补齐会话隐藏与记忆总结配置结构（向下兼容旧版单文本数据并自动静默升级旧版默认提示词）
 * @param {object} config - 原始配置对象
 * @returns {object} 标准化后的配置对象
 */
export function normalizeHideSummaryConfig(config = {}) {
    const memoryMode = (config && config.memoryMode) ? config.memoryMode : 'recursive';
    const oldPrompt = (config && typeof config.prompt === 'string') ? config.prompt : '';

    let recursivePrompt = (config && config.prompts && config.prompts.recursive) || (oldPrompt && memoryMode === 'recursive' ? oldPrompt : DEFAULT_PROMPT_RECURSIVE);
    let appendPrompt = (config && config.prompts && config.prompts.append) || (oldPrompt && memoryMode === 'append' ? oldPrompt : DEFAULT_PROMPT_APPEND);
    let tablePrompt = (config && config.prompts && config.prompts.table) || (oldPrompt && memoryMode === 'table' ? oldPrompt : DEFAULT_PROMPT_TABLE);

    // 自动静默升级旧版默认提示词指纹（强化关键时间节点与【第1年】起算推演规范）
    recursivePrompt = upgradeLegacyDefaultPrompt(recursivePrompt, 'recursive');
    appendPrompt = upgradeLegacyDefaultPrompt(appendPrompt, 'append');
    tablePrompt = upgradeLegacyDefaultPrompt(tablePrompt, 'table');

    const prompts = {
        ...((config && config.prompts) || {}),
        recursive: recursivePrompt,
        append: appendPrompt,
        table: tablePrompt
    };

    return {
        enabled: !!config.enabled,
        memoryMode,
        autoSummaryEnabled: !!config.autoSummaryEnabled,
        autoSummaryType: config.autoSummaryType || 'floors',
        autoSummaryFloorInterval: Number(config.autoSummaryFloorInterval) || 10,
        autoSummaryTokenThreshold: Number(config.autoSummaryTokenThreshold) || 4000,
        dropSummarizedFloors: config.dropSummarizedFloors !== false,
        keepRecentFloors: config.keepRecentFloors !== false,
        keepRecentFloorsCount: Number(config.keepRecentFloorsCount) || 2,
        withRole: !!config.withRole,
        withWorldBook: !!config.withWorldBook,
        messageLimit: Number(config.messageLimit) || 0,
        prompts,
        prompt: prompts[memoryMode] || getDefaultPromptForMode(memoryMode),
        summary: typeof config.summary === 'string' ? config.summary : '',
        summaryList: Array.isArray(config.summaryList) ? config.summaryList : [],
        tableData: {
            eventHistory: (config.tableData && Array.isArray(config.tableData.eventHistory)) ? config.tableData.eventHistory : [],
            characterInfo: (config.tableData && Array.isArray(config.tableData.characterInfo)) ? config.tableData.characterInfo : []
        },
        hiddenFloors: Array.isArray(config.hiddenFloors) ? config.hiddenFloors : [],
        start: Number(config.start) || 1,
        end: Number(config.end) || 1,
        history: Array.isArray(config.history) ? config.history : [],
        // — 为什么这么写 —
        // appliedVersionId/appliedAt 是"当前记忆基线版本"溯源指针（回滚目标或最近落盘的快照）。
        // 本函数是白名单标准化，不显式放行的话，下一次任意 config 保存就会把它静默抹掉。
        appliedVersionId: config.appliedVersionId || null,
        appliedAt: Number(config.appliedAt) || 0,
        lastAutoSummaryFloor: Number(config.lastAutoSummaryFloor) || 0,
        relayAutoSummaryPolicy: config.relayAutoSummaryPolicy || 'ask'
    };
}

/**
 * 将模式2的 summaryList 格式化为纯文本字符串
 * @param {Array<{id, time, floorRange, content}>} summaryList 
 * @returns {string} 格式化文本
 */
export function formatSummaryListToText(summaryList) {
    if (!Array.isArray(summaryList) || summaryList.length === 0) return '';
    return summaryList.map((item, idx) => {
        const title = item.floorRange ? `[阶段 ${idx + 1} (${item.floorRange})]` : `[阶段 ${idx + 1}]`;
        return `${title}: ${item.content || ''}`;
    }).join('\n\n');
}

/**
 * 将模式3的结构化双表对象序列化为标准 Markdown 表格文本
 * @param {Array} eventHistory - 历史记录列表
 * @param {Array} characterInfo - 角色信息列表
 * @returns {string} Markdown 文本
 */
export function formatTablesToMarkdown(eventHistory = [], characterInfo = []) {
    let md = '### 历史记录表\n| 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |\n| :--- | :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(eventHistory) && eventHistory.length > 0) {
        eventHistory.forEach(row => {
            const time = (row.time || '-').replace(/\|/g, '&#124;');
            const location = (row.location || '-').replace(/\|/g, '&#124;');
            const characters = (row.characters || '-').replace(/\|/g, '&#124;');
            const event = (row.event || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${time} | ${location} | ${characters} | ${event} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    md += '\n### 最新实体信息表\n| 姓名 | 简介 | 最新状态说明 | 持有关键道具 |\n| :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(characterInfo) && characterInfo.length > 0) {
        characterInfo.forEach(row => {
            const name = (row.name || '-').replace(/\|/g, '&#124;');
            const bio = (row.bio || '-').replace(/\|/g, '&#124;');
            const status = (row.status || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${name} | ${bio} | ${status} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    return md.trim();
}

/**
 * 重建某条历史版本快照的"记忆全文"（与历史版本列表/详情弹窗的渲染逻辑保持同一来源）
 * @param {object} item - 快照对象（含 mode/summary/summaryList/tableData）
 * @returns {string} 该快照对外展示用的完整记忆文本
 */
export function getSnapshotFullText(item) {
    if (!item) return '';
    let text = item.summary || '';
    if (item.mode === 'table' && item.tableData && (item.tableData.eventHistory?.length || item.tableData.characterInfo?.length)) {
        text = formatTablesToMarkdown(item.tableData.eventHistory, item.tableData.characterInfo);
    } else if (item.mode === 'append' && Array.isArray(item.summaryList) && item.summaryList.length > 0) {
        text = formatSummaryListToText(item.summaryList);
    }
    return text;
}

/**
 * 格式化双表数据为带业务序号的 Markdown 文本（用于 Diff Patch 协议注入大模型上下文）
 * @param {Array} eventHistory - 历史事件列表
 * @param {Array} characterInfo - 实体信息列表
 * @returns {string} 带业务序号的 Markdown 表格
 */
export function formatTablesToMarkdownWithIndex(eventHistory = [], characterInfo = []) {
    let md = '### 历史记录表 (已有记录)\n| 序号 | 时间 | 地点 | 涉及角色 | 事件 | 涉及物品 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(eventHistory) && eventHistory.length > 0) {
        eventHistory.forEach((row, idx) => {
            const seq = `[E${idx + 1}]`;
            const time = (row.time || '-').replace(/\|/g, '&#124;');
            const location = (row.location || '-').replace(/\|/g, '&#124;');
            const characters = (row.characters || '-').replace(/\|/g, '&#124;');
            const event = (row.event || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${seq} | ${time} | ${location} | ${characters} | ${event} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    md += '\n### 最新实体信息表 (已有记录)\n| 序号 | 姓名 | 简介 | 最新状态说明 | 持有关键道具 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n';
    if (Array.isArray(characterInfo) && characterInfo.length > 0) {
        characterInfo.forEach((row, idx) => {
            const seq = `[C${idx + 1}]`;
            const name = (row.name || '-').replace(/\|/g, '&#124;');
            const bio = (row.bio || '-').replace(/\|/g, '&#124;');
            const status = (row.status || '-').replace(/\|/g, '&#124;');
            const items = (row.items || '-').replace(/\|/g, '&#124;');
            md += `| ${seq} | ${name} | ${bio} | ${status} | ${items} |\n`;
        });
    } else {
        md += '| (暂无) | (暂无) | (暂无) | (暂无) | (暂无) |\n';
    }

    return md.trim();
}


/**
 * 健壮解析 AI 输出的 Markdown 表格文本为结构化双表对象
 * @param {string} text - 包含 Markdown 表格的响应文本
 * @param {object} [options] - 解析选项
 * @param {'history'|'character'} [options.defaultSection] - 默认目标表区域（当文本仅包含数据行、省略表头时使用）
 * @returns {{ eventHistory: Array, characterInfo: Array }} 结构化表格数据
 */
export function parseMarkdownTables(text, options = {}) {
    const result = {
        eventHistory: [],
        characterInfo: [],
        hasInvalidColumns: false,
        invalidReason: ''
    };
    if (!text || typeof text !== 'string') return result;

    const { mainContent } = extractThinkingFromContent(text);
    const cleanText = mainContent || text;
    const lines = cleanText.split('\n');
    let currentSection = options.defaultSection || null; // 'history' | 'character'
    let historyColMap = null;
    let characterColMap = null;

    // — 为什么这么写 —
    // 严格判断是否为真实 Markdown 表格表头，绝不能用简单的 includes('事件') 模糊匹配！
    // 避免正文剧情含有“发生抢劫事件”等词汇导致正常剧情行被误判为表头而被吞噬，并导致后续所有行列索引全部沦为 -1 的重大灾难。
    const isHistoryHeaderRow = (cells, nextLine) => {
        if (!cells || cells.length < 2) return false;
        const isFollowedBySep = nextLine && regexPatterns.markdownTableSeparator && regexPatterns.markdownTableSeparator.test(nextLine.trim());
        const isHdrCell = (c) => {
            const t = c.trim();
            if (t.length > 10) return false;
            return /^(?:序号|编号|No\.?|NO\.?|#|时间|年代|日期|节点|发生时间|地点|位置|场所|场景|发生地点|角色|人物|涉及角色|参与主体|主要角色|参与人物|事件|剧情|经历|概要|内容|事件描述|物品|道具|装备|涉及物品|关键道具)$/i.test(t);
        };
        const matched = cells.filter(isHdrCell);
        if (isFollowedBySep) {
            return matched.length >= 1;
        }
        return matched.length >= 2 && cells.every(c => c.trim().length <= 15);
    };

    const isCharacterHeaderRow = (cells, nextLine) => {
        if (!cells || cells.length < 2) return false;
        const isFollowedBySep = nextLine && regexPatterns.markdownTableSeparator && regexPatterns.markdownTableSeparator.test(nextLine.trim());
        const isHdrCell = (c) => {
            const t = c.trim();
            if (t.length > 10) return false;
            return /^(?:序号|编号|No\.?|NO\.?|#|姓名|名称|实体|角色|人物|角色姓名|实体名称|简介|身份|背景|描述|设定|人物简介|状态|最新状态|说明|现状|最新状态说明|道具|物品|装备|持有道具|关键道具|持有关键道具)$/i.test(t);
        };
        const matched = cells.filter(isHdrCell);
        if (isFollowedBySep) {
            return matched.length >= 1;
        }
        return matched.length >= 2 && cells.every(c => c.trim().length <= 15);
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.includes('历史记录') || line.includes('事件记录')) {
            currentSection = 'history';
            historyColMap = null;
            continue;
        } else if (line.includes('角色信息') || line.includes('人物信息') || line.includes('NPC信息') || line.includes('实体信息') || line.includes('状态信息')) {
            currentSection = 'character';
            characterColMap = null;
            continue;
        }

        // 识别表格行 (以 | 开头并以 | 结尾)
        if (line.startsWith('|') && line.endsWith('|')) {
            // 过滤 |---|---| 表格分隔线
            if (regexPatterns.markdownTableSeparator && regexPatterns.markdownTableSeparator.test(line)) continue;

            const cells = line.slice(1, -1).split('|').map(c => c.trim().replace(/&#124;/g, '|'));
            // 过滤全空或占位符行
            if (cells.every(c => !c || c === '-' || c === '(暂无)')) continue;

            const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
            const isHistHdr = isHistoryHeaderRow(cells, nextLine);
            const isCharHdr = !isHistHdr && isCharacterHeaderRow(cells, nextLine);

            if (isHistHdr) {
                currentSection = 'history';
                historyColMap = { index: -1, time: -1, location: -1, characters: -1, event: -1, items: -1 };
                cells.forEach((rawC, idx) => {
                    const c = rawC.trim();
                    if (/^(?:序号|编号|No\.?|NO\.?|#)$/i.test(c)) historyColMap.index = idx;
                    else if (c.includes('时间') || c.includes('年代') || c.includes('日期') || c.includes('节点')) historyColMap.time = idx;
                    else if (c.includes('地点') || c.includes('位置') || c.includes('场所') || c.includes('场景')) historyColMap.location = idx;
                    else if (c.includes('角色') || c.includes('人物') || c.includes('参与') || c.includes('主体')) historyColMap.characters = idx;
                    else if (c.includes('事件') || c.includes('剧情') || c.includes('经历') || c.includes('概要') || c.includes('内容')) historyColMap.event = idx;
                    else if (c.includes('物品') || c.includes('道具') || c.includes('装备')) historyColMap.items = idx;
                });
                continue;
            }

            if (isCharHdr) {
                currentSection = 'character';
                characterColMap = { index: -1, name: -1, bio: -1, status: -1, items: -1 };
                cells.forEach((rawC, idx) => {
                    const c = rawC.trim();
                    if (/^(?:序号|编号|No\.?|NO\.?|#)$/i.test(c)) characterColMap.index = idx;
                    else if (c.includes('姓名') || c.includes('名称') || c.includes('实体') || (c.includes('角色') && !c.includes('状态') && !c.includes('说明'))) characterColMap.name = idx;
                    else if (c.includes('简介') || c.includes('身份') || c.includes('背景') || c.includes('描述') || c.includes('设定')) characterColMap.bio = idx;
                    else if (c.includes('状态') || c.includes('说明') || c.includes('现状')) characterColMap.status = idx;
                    else if (c.includes('道具') || c.includes('物品') || c.includes('装备')) characterColMap.items = idx;
                });
                continue;
            }

            if (currentSection === 'history') {
                let rowCells = [...cells];
                // 若数据行自带误加的序号（如 1.、E24:、[1] 等），先行剥离首列多余序号
                if (regexPatterns.tableIndexPrefix && regexPatterns.tableIndexPrefix.test(rowCells[0])) {
                    if (rowCells.length > 5 || (historyColMap && historyColMap.index === -1) || (!historyColMap && rowCells.length >= 5)) {
                        rowCells.shift();
                    }
                }

                // — 为什么这么写 —
                // 严禁前端代码硬猜列映射！若有效业务列不足 5 列（说明 AI 省略了列或遗漏了空列管道符 |），
                // 立即标记无效列并抛出异常，交给上层弹窗提示大爷，杜绝私自映射引发更隐蔽的错位灾难！
                if (rowCells.length < 5 && !historyColMap) {
                    result.hasInvalidColumns = true;
                    result.invalidReason = `历史记录表第 ${result.eventHistory.length + 1} 行有效列数不足 5 列 (仅有 ${rowCells.length} 列)，缺少必要分隔符`;
                    continue;
                }

                if (historyColMap) {
                    const hasIndexInHeader = historyColMap.index >= 0;
                    const hasIndexInRow = regexPatterns.tableIndexPrefix && regexPatterns.tableIndexPrefix.test(rowCells[0]);
                    const getVal = (col) => {
                        if (col === -1) return '';
                        let targetIdx = col;
                        if (hasIndexInHeader && !hasIndexInRow && col > historyColMap.index) {
                            targetIdx = col - 1;
                        }
                        return rowCells[targetIdx] || '';
                    };

                    result.eventHistory.push({
                        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        time: getVal(historyColMap.time),
                        location: getVal(historyColMap.location),
                        characters: getVal(historyColMap.characters),
                        event: getVal(historyColMap.event),
                        items: getVal(historyColMap.items)
                    });
                } else {
                    result.eventHistory.push({
                        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        time: rowCells[0] || '',
                        location: rowCells[1] || '',
                        characters: rowCells[2] || '',
                        event: rowCells[3] || '',
                        items: rowCells[4] || ''
                    });
                }
            } else if (currentSection === 'character') {
                let rowCells = [...cells];
                if (regexPatterns.tableIndexPrefix && regexPatterns.tableIndexPrefix.test(rowCells[0])) {
                    if (rowCells.length > 4 || (characterColMap && characterColMap.index === -1) || (!characterColMap && rowCells.length >= 4)) {
                        rowCells.shift();
                    }
                }

                // 实体信息表严格校验 4 列
                if (rowCells.length < 4 && !characterColMap) {
                    result.hasInvalidColumns = true;
                    result.invalidReason = `实体信息表第 ${result.characterInfo.length + 1} 行有效列数不足 4 列 (仅有 ${rowCells.length} 列)，缺少必要分隔符`;
                    continue;
                }

                if (characterColMap) {
                    const hasIndexInHeader = characterColMap.index >= 0;
                    const hasIndexInRow = regexPatterns.tableIndexPrefix && regexPatterns.tableIndexPrefix.test(rowCells[0]);
                    const getVal = (col) => {
                        if (col === -1) return '';
                        let targetIdx = col;
                        if (hasIndexInHeader && !hasIndexInRow && col > characterColMap.index) {
                            targetIdx = col - 1;
                        }
                        return rowCells[targetIdx] || '';
                    };

                    result.characterInfo.push({
                        id: 'chr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        name: getVal(characterColMap.name),
                        bio: getVal(characterColMap.bio),
                        status: getVal(characterColMap.status),
                        items: getVal(characterColMap.items)
                    });
                } else {
                    result.characterInfo.push({
                        id: 'chr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                        name: rowCells[0] || '',
                        bio: rowCells[1] || '',
                        status: rowCells[2] || '',
                        items: rowCells[3] || ''
                    });
                }
            }
        }
    }

    return result;
}

export function parseCardsFromCondensedText(text, options = {}) {
    if (!text || typeof text !== 'string') return [];
    const { mainContent } = extractThinkingFromContent(text);
    const cleanText = (mainContent || text).trim();
    if (!cleanText) return [];

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 使用集中管理的正则（重新实例化避免全局 lastIndex 并发污染）
    const regex = new RegExp(regexPatterns.summaryCardStage.source, 'g');
    const cards = [];
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
        let stageRaw = (match[1] || match[2] || match[3] || '').trim();
        if (regexPatterns.summaryCardStageClean) {
            stageRaw = stageRaw.replace(regexPatterns.summaryCardStageClean, '').trim();
        }
        const stageRange = stageRaw ? (stageRaw.startsWith('阶段') ? stageRaw : `阶段 ${stageRaw}`) : `阶段 ${cards.length + 1}`;
        let cardContent = (match[4] || '').trim();
        if (regexPatterns.summaryCardTrailingDivider) {
            cardContent = cardContent.replace(regexPatterns.summaryCardTrailingDivider, '').trim();
        }
        if (cardContent) {
            cards.push({
                id: `chunk_${Date.now()}_${cards.length}`,
                time: timeStr,
                floorRange: stageRange,
                content: cardContent
            });
        }
    }

    if (cards.length > 0) {
        return cards;
    }

    // 严格模式：若未能识别出任何标准阶段卡片，绝不静默兜底，返回空数组交由上层阻断并弹窗提醒
    if (options.strict) {
        return [];
    }

    const paragraphs = cleanText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
        return paragraphs.map((para, idx) => ({
            id: `chunk_${Date.now()}_${idx}`,
            time: timeStr,
            floorRange: `阶段 ${idx + 1}`,
            content: para
        }));
    }

    return [{
        id: `chunk_${Date.now()}_condensed`,
        time: timeStr,
        floorRange: '全局重构大纲',
        content: cleanText
    }];
}

/**
 * 健壮执行大模型输出的结构双表三阶段 Diff Patch 协议（更新 -> 删除 -> 新增追加）
 * @param {object} existingTableData - 已有的双表数据 { eventHistory: [], characterInfo: [] }
 * @param {string} patchText - 大模型响应文本
 * @returns {object|null} 成功则返回新双表数据，未匹配协议则返回 null
 */
export function applyTableDiffPatch(existingTableData = {}, patchText = '') {
    if (!patchText || typeof patchText !== 'string') return null;

    const { mainContent } = extractThinkingFromContent(patchText);
    const cleanText = (mainContent || patchText).trim();

    // 协议标志检测：必须包含至少一个操作阶段关键字
    const hasOperationTag = cleanText.includes('【更新】') || cleanText.includes('【删除】') || cleanText.includes('【新增追加】') || cleanText.includes('【追加】');
    if (!hasOperationTag) {
        return null;
    }

    const existingEvents = Array.isArray(existingTableData.eventHistory)
        ? existingTableData.eventHistory.map(item => ({ ...item }))
        : [];
    const existingChars = Array.isArray(existingTableData.characterInfo)
        ? existingTableData.characterInfo.map(item => ({ ...item }))
        : [];

    let eventSectionText = '';
    let charSectionText = '';

    const charHeaderMatch = cleanText.match(regexPatterns.diffPatchCharacterHeader);
    const eventHeaderMatch = cleanText.match(regexPatterns.diffPatchEventHeader);

    if (eventHeaderMatch && charHeaderMatch) {
        if (eventHeaderMatch.index < charHeaderMatch.index) {
            eventSectionText = cleanText.substring(eventHeaderMatch.index, charHeaderMatch.index);
            charSectionText = cleanText.substring(charHeaderMatch.index);
        } else {
            charSectionText = cleanText.substring(charHeaderMatch.index, eventHeaderMatch.index);
            eventSectionText = cleanText.substring(eventHeaderMatch.index);
        }
    } else if (charHeaderMatch) {
        eventSectionText = '';
        charSectionText = cleanText.substring(charHeaderMatch.index);
    } else if (eventHeaderMatch) {
        eventSectionText = cleanText.substring(eventHeaderMatch.index);
        charSectionText = '';
    } else {
        eventSectionText = cleanText;
        charSectionText = '';
    }

    const isNoneOrEmpty = (str) => {
        if (!str) return true;
        const clean = str.trim().replace(/^[-*•\s]+/, '').trim();
        return !clean || clean === '无' || clean === '无。' || clean === '暂无' || clean === '(暂无)';
    };

    const extractPhases = (sectionText) => {
        const updateMatch = sectionText.match(regexPatterns.diffPatchUpdateBlock);
        const deleteMatch = sectionText.match(regexPatterns.diffPatchDeleteBlock);
        const appendMatch = sectionText.match(regexPatterns.diffPatchAppendBlock);

        return {
            updateText: updateMatch ? updateMatch[1].trim() : '',
            deleteText: deleteMatch ? deleteMatch[1].trim() : '',
            appendText: appendMatch ? appendMatch[1].trim() : ''
        };
    };

    const eventPhases = extractPhases(eventSectionText);
    const charPhases = extractPhases(charSectionText);

    // 1. 执行表1 (历史记录表) 事务
    let mergedEvents = [...existingEvents];

    if (eventPhases.updateText && !isNoneOrEmpty(eventPhases.updateText)) {
        const updateLines = eventPhases.updateText.split('\n');
        updateLines.forEach(line => {
            const trimmed = line.trim().replace(/^[-*•]\s*/, '');
            const idxMatch = trimmed.match(regexPatterns.diffPatchEventIndex);
            if (!idxMatch) return;
            const seqNum = parseInt(idxMatch[1], 10);
            const targetIdx = seqNum - 1;
            if (targetIdx >= 0 && targetIdx < mergedEvents.length) {
                const target = mergedEvents[targetIdx];
                const colonIdx = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('：');
                const content = colonIdx !== -1 ? trimmed.substring(colonIdx + 1).trim() : trimmed;
                if (content.includes('=')) {
                    // — 为什么这么写 —
                    // 仅按管道符 | 或 ｜ 切分键值对，严禁按中文逗号 ， 切分！
                    // 彻底避免大模型在事件长句中使用逗号时整段文字被截断的重大灾难。
                    const pairs = content.split(/\s*[|｜]\s*/);
                    pairs.forEach(pair => {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) return;
                        const k = pair.substring(0, eqIdx).trim();
                        const v = pair.substring(eqIdx + 1).trim();
                        if (!k || !v) return;
                        if (k.includes('时间')) target.time = v;
                        else if (k.includes('地点')) target.location = v;
                        else if (k.includes('角色') || k.includes('人物')) target.characters = v;
                        else if (k.includes('事件')) target.event = v;
                        else if (k.includes('物品') || k.includes('道具') || k.includes('装备')) target.items = v;
                    });
                } else if (content && !isNoneOrEmpty(content)) {
                    target.event = content;
                }
            }
        });
    }

    if (eventPhases.deleteText && !isNoneOrEmpty(eventPhases.deleteText)) {
        const deleteIndices = new Set();
        const matches = eventPhases.deleteText.matchAll(regexPatterns.diffPatchEventIndexAll);
        for (const m of matches) {
            deleteIndices.add(parseInt(m[1], 10) - 1);
        }
        if (deleteIndices.size > 0) {
            mergedEvents = mergedEvents.filter((_, idx) => !deleteIndices.has(idx));
        }
    }

    if (eventPhases.appendText && !isNoneOrEmpty(eventPhases.appendText)) {
        const histParsed = parseMarkdownTables(eventPhases.appendText, { defaultSection: 'history' });
        if (histParsed.hasInvalidColumns) {
            console.warn('[applyTableDiffPatch] 历史记录表追加数据列数不足，拒绝合并，触发挂起单保护:', histParsed.invalidReason);
            return null; // 拒绝盲目合并，转交挂起单异常弹窗
        }
        const appendRows = histParsed.eventHistory;
        if (appendRows.length > 0) {
            appendRows.forEach(item => {
                mergedEvents.push({
                    id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    time: item.time || '',
                    location: item.location || '',
                    characters: item.characters || '',
                    event: item.event || '',
                    items: item.items || ''
                });
            });
        }
    }

    // 2. 执行表2 (角色信息表) 事务
    let mergedChars = [...existingChars];

    if (charPhases.updateText && !isNoneOrEmpty(charPhases.updateText)) {
        const updateLines = charPhases.updateText.split('\n');
        updateLines.forEach(line => {
            const trimmed = line.trim().replace(/^[-*•]\s*/, '');
            const idxMatch = trimmed.match(regexPatterns.diffPatchCharacterIndex);
            let targetChar = null;
            if (idxMatch) {
                const seqNum = parseInt(idxMatch[1], 10);
                const targetIdx = seqNum - 1;
                if (targetIdx >= 0 && targetIdx < mergedChars.length) {
                    targetChar = mergedChars[targetIdx];
                }
            } else {
                const colonIdx = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('：');
                const rawName = colonIdx !== -1 ? trimmed.substring(0, colonIdx).trim() : '';
                if (rawName) {
                    targetChar = mergedChars.find(c => (c.name || '').trim().toLowerCase() === rawName.toLowerCase());
                }
            }

            if (targetChar) {
                const colonIdx = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('：');
                const content = colonIdx !== -1 ? trimmed.substring(colonIdx + 1).trim() : trimmed;
                if (content.includes('=')) {
                    const pairs = content.split(/\s*[|｜]\s*/);
                    pairs.forEach(pair => {
                        const eqIdx = pair.indexOf('=');
                        if (eqIdx === -1) return;
                        const k = pair.substring(0, eqIdx).trim();
                        const v = pair.substring(eqIdx + 1).trim();
                        if (!k || !v) return;
                        if (k.includes('状态') || k.includes('说明')) targetChar.status = v;
                        else if (k.includes('道具') || k.includes('物品') || k.includes('装备')) targetChar.items = v;
                        else if (k.includes('简介') || k.includes('背景')) targetChar.bio = v;
                        else if (k.includes('姓名') || k.includes('名称')) targetChar.name = v;
                    });
                } else if (content && !isNoneOrEmpty(content)) {
                    targetChar.status = content;
                }
            }
        });
    }

    if (charPhases.deleteText && !isNoneOrEmpty(charPhases.deleteText)) {
        const deleteIndices = new Set();
        const matches = charPhases.deleteText.matchAll(regexPatterns.diffPatchCharacterIndexAll);
        for (const m of matches) {
            deleteIndices.add(parseInt(m[1], 10) - 1);
        }
        if (deleteIndices.size > 0) {
            mergedChars = mergedChars.filter((_, idx) => !deleteIndices.has(idx));
        }
    }

    if (charPhases.appendText && !isNoneOrEmpty(charPhases.appendText)) {
        const charParsed = parseMarkdownTables(charPhases.appendText, { defaultSection: 'character' });
        if (charParsed.hasInvalidColumns) {
            console.warn('[applyTableDiffPatch] 实体信息表追加数据列数不足，拒绝合并，触发挂起单保护:', charParsed.invalidReason);
            return null;
        }
        const appendRows = charParsed.characterInfo;
        if (appendRows.length > 0) {
            appendRows.forEach(item => {
                if (item.name && item.name !== '(暂无)') {
                    const existing = mergedChars.find(c => (c.name || '').trim().toLowerCase() === (item.name || '').trim().toLowerCase());
                    if (existing) {
                        if (item.status) existing.status = item.status;
                        if (item.items) existing.items = item.items;
                        if (item.bio && (!existing.bio || existing.bio === '-')) existing.bio = item.bio;
                    } else {
                        mergedChars.push({
                            id: 'chr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                            name: item.name,
                            bio: item.bio || '',
                            status: item.status || '',
                            items: item.items || ''
                        });
                    }
                }
            });
        }
    }

    return {
        eventHistory: mergedEvents,
        characterInfo: mergedChars
    };
}

/**
 * 智能合并已有双表与模型新解析的双表（指纹排重追加 + 姓名 Upsert）
 * @param {object} existingData - 已有双表数据 { eventHistory: [], characterInfo: [] }
 * @param {object} incomingData - 新解析的双表数据 { eventHistory: [], characterInfo: [] }
 * @returns {object} 合并后的双表数据
 */
export function mergeTableData(existingData = {}, incomingData = {}) {
    const existingEvents = Array.isArray(existingData.eventHistory) ? existingData.eventHistory : [];
    const existingChars = Array.isArray(existingData.characterInfo) ? existingData.characterInfo : [];

    const incomingEvents = Array.isArray(incomingData.eventHistory) ? incomingData.eventHistory : [];
    const incomingChars = Array.isArray(incomingData.characterInfo) ? incomingData.characterInfo : [];

    if (existingEvents.length === 0 && existingChars.length === 0) {
        return { eventHistory: incomingEvents, characterInfo: incomingChars };
    }
    if (incomingEvents.length === 0 && incomingChars.length === 0) {
        return { eventHistory: existingEvents, characterInfo: existingChars };
    }

    const buildFp = (item) => `${(item.time || '').trim()}___${(item.location || '').trim()}___${(item.event || '').trim()}`;
    const existingFps = new Set(existingEvents.map(buildFp));
    const mergedEvents = [...existingEvents];

    incomingEvents.forEach(inc => {
        const fp = buildFp(inc);
        if ((inc.event || inc.time || inc.location) && !existingFps.has(fp)) {
            existingFps.add(fp);
            mergedEvents.push({
                ...inc,
                id: inc.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6))
            });
        }
    });

    const normalizeName = (name) => (name || '').trim().toLowerCase();
    const mergedChars = existingChars.map(chr => ({ ...chr }));
    const charIndexMap = new Map();
    mergedChars.forEach((chr, idx) => {
        const key = normalizeName(chr.name);
        if (key) charIndexMap.set(key, idx);
    });

    incomingChars.forEach(inc => {
        const nameKey = normalizeName(inc.name);
        if (!nameKey || nameKey === '(暂无)') return;

        if (charIndexMap.has(nameKey)) {
            const target = mergedChars[charIndexMap.get(nameKey)];
            if (inc.status && inc.status !== '-' && inc.status !== '(暂无)') target.status = inc.status;
            if (inc.items && inc.items !== '-' && inc.items !== '(暂无)') target.items = inc.items;
            if ((!target.bio || target.bio === '-' || target.bio === '(暂无)') && inc.bio && inc.bio !== '-') target.bio = inc.bio;
        } else {
            mergedChars.push({
                ...inc,
                id: inc.id || ('chr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6))
            });
            charIndexMap.set(nameKey, mergedChars.length - 1);
        }
    });

    return {
        eventHistory: mergedEvents,
        characterInfo: mergedChars
    };
}


/**
 * 格式化会话记忆内容，用于注入 API 请求的 System 消息或计算 Token
 * @param {object} config - hideSummary 配置对象
 * @returns {string} 格式化后的完整注入文本（若未开启或内容为空则返回空字符串）
 */
export function formatMemoryForApi(config) {
    if (!config || !config.enabled) return '';
    const norm = normalizeHideSummaryConfig(config);
    const mode = norm.memoryMode;

    if (mode === 'recursive') {
        const summary = norm.summary.trim();
        if (!summary) return '';
        return '本条消息属于对历史对话内容的长期记忆总结，你必须阅读后作为上下文参考再进行回答：\n' + summary;
    } else if (mode === 'append') {
        const stitched = formatSummaryListToText(norm.summaryList);
        if (!stitched) return '';
        return '本条消息属于对历史对话内容的长期记忆摘要集（按阶段排序）：\n' + stitched;
    } else if (mode === 'table') {
        const hasHistory = norm.tableData.eventHistory && norm.tableData.eventHistory.length > 0;
        const hasCharacters = norm.tableData.characterInfo && norm.tableData.characterInfo.length > 0;
        if (!hasHistory && !hasCharacters) {
            if (norm.summary && norm.summary.trim()) {
                return '本条消息属于对历史对话内容的长期记忆总结：\n' + norm.summary.trim();
            }
            return '';
        }
        const tablesMd = formatTablesToMarkdown(norm.tableData.eventHistory, norm.tableData.characterInfo);
        return '本条消息属于对历史对话与核心实体的长期记忆结构双表，你必须严格遵循表中的事实脉络与设定状态：\n\n' + tablesMd;
    }

    return '';
}

/**
 * 智能解析已隐藏楼层与未隐藏空洞区间信息 (Plan B 智能双模算法)
 * @param {number[]} hiddenFloors - 已隐藏楼层数字数组 (1-indexed)
 * @returns {{ mainText: string, hasUnhiddenRow: boolean, unhiddenCount: number, unhiddenRanges: Array<[number, number]> }}
 */
export function formatHiddenFloorsBannerInfo(hiddenFloors) {
    if (!Array.isArray(hiddenFloors) || hiddenFloors.length === 0) {
        return {
            mainText: '无隐藏楼层 (全部可见)',
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    // 1. 升序排序与去重
    const sorted = Array.from(new Set(hiddenFloors.map(n => Number(n)).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return {
            mainText: '无隐藏楼层 (全部可见)',
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    const minFloor = sorted[0];
    const maxFloor = sorted[sorted.length - 1];
    const totalSpan = maxFloor - minFloor + 1;
    const hiddenCount = sorted.length;
    const unhiddenCount = totalSpan - hiddenCount;

    // 2. 将连续数字聚类为区间数组 [[start1, end1], [start2, end2], ...]
    const toRanges = (nums) => {
        if (!nums || nums.length === 0) return [];
        const ranges = [];
        let start = nums[0];
        let prev = nums[0];
        for (let i = 1; i < nums.length; i++) {
            if (nums[i] === prev + 1) {
                prev = nums[i];
            } else {
                ranges.push([start, prev]);
                start = nums[i];
                prev = nums[i];
            }
        }
        ranges.push([start, prev]);
        return ranges;
    };

    // 3. 将区间数组格式化为可读文本 "第 1 ~ 10 楼、第 15 楼"
    const formatRangesText = (ranges) => {
        return ranges.map(([s, e]) => (s === e ? `第 ${s} 楼` : `第 ${s} ~ ${e} 楼`)).join('、');
    };

    const hiddenRanges = toRanges(sorted);

    // Case 1: 完美全覆盖 (中间 0 空洞)
    if (unhiddenCount === 0) {
        const text = (minFloor === maxFloor)
            ? `第 ${minFloor} 楼 (共 1 层)`
            : `第 ${minFloor} ~ ${maxFloor} 楼 (共 ${hiddenCount} 层)`;
        return {
            mainText: text,
            hasUnhiddenRow: false,
            unhiddenCount: 0,
            unhiddenRanges: []
        };
    }

    // 计算区间内的未隐藏楼层
    const hiddenSet = new Set(sorted);
    const unhiddenNums = [];
    for (let f = minFloor; f <= maxFloor; f++) {
        if (!hiddenSet.has(f)) {
            unhiddenNums.push(f);
        }
    }
    const unhiddenRanges = toRanges(unhiddenNums);

    // Case 2: 大面积隐藏，存在少量空洞（大爷关心的核心场景：空洞 <= 15 或 空洞比例 <= 25%）
    // 采用两行制：第一行展示主跨度，第二行展示未隐藏明细
    const unhiddenRatio = unhiddenCount / totalSpan;
    if (unhiddenCount <= 15 || unhiddenRatio <= 0.25) {
        return {
            mainText: `覆盖区间：第 ${minFloor} ~ ${maxFloor} 楼 (已隐藏 ${hiddenCount} 层)`,
            hasUnhiddenRow: true,
            unhiddenCount,
            unhiddenRanges
        };
    }

    // Case 3: 完全离散的多大段隐藏（如仅隐藏 1~10 楼和 490~500 楼，中间空了 480 楼）
    // 直接展示紧凑的多段区间，无误导
    return {
        mainText: `${formatRangesText(hiddenRanges)} (共 ${hiddenCount} 层)`,
        hasUnhiddenRow: false,
        unhiddenCount: 0,
        unhiddenRanges: []
    };
}


/**
 * 获取当前活跃分支上所有尚未被隐藏的可见消息
 * @param {Array} activeBranch - 当前分支消息列表
 * @param {Object} hideConfig - 隐藏配置
 * @returns {Array<{msg: Object, floor: number, index: number}>} 可见消息及其楼层号
 */
export function getVisibleMessagesForSummary(activeBranch, hideConfig) {
    if (!Array.isArray(activeBranch)) return [];
    return activeBranch
        .map((msg, index) => ({ msg, floor: index + 1, index }))
        .filter(({ msg, floor }) => !isMessageHidden(msg, floor, hideConfig));
}

/**
 * 调用 LLM 执行总结请求（自适应 3 种记忆模式）
 * @param {Object} options
 * @param {string} options.convId - 会话ID
 * @param {Array} options.messagesToSummarize - 待总结的消息列表
 * @param {string} [options.customPrompt] - 总结提示词（若未提供则读取该模式配置）
 * @param {boolean} [options.withRole] - 是否携带角色人设
 * @param {boolean} [options.withWorldBook] - 是否携带世界书/备忘录
 * @param {AbortSignal} [options.signal] - 中断信号
 * @param {Function} [options.onChunk] - 流式返回回调
 * @returns {Promise<string>} 总结结果文本
 */
export async function generateSummaryApiCall(options) {
    const {
        convId,
        messagesToSummarize,
        customPrompt,
        withRole = false,
        withWorldBook = false,
        signal,
        onChunk
    } = options;

    const conv = state.conversations[convId];
    if (!conv) throw new Error('未找到当前会话数据。');

    const apiEndpoint = state.apiEndpoints[conv.apiEndpointId];
    if (!apiEndpoint) throw new Error('当前会话未配置有效的 API 端点。');

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const mode = config.memoryMode || 'recursive';

    // 1. 构造对话历史消息
    const conversationMessages = messagesToSummarize.map(({ msg, floor }) => ({
        role: msg.role,
        content: msg.content,
        _idx: floor
    }));

    const filteredMessages = processAndFilterMessages(conversationMessages, {
        convId,
        activeBranch,
        applyMcpRules: false,
        applyHideSummary: false
    });

    const summaryMessages = [];

    // — 为什么这么写 —
    // 关键升级：把当前已有的记忆（全量总结/已有List/已有双表格）作为前置已知背景带给 AI，彻底终结单窗口遗忘
    let existingMemoryContext = '';
    if (mode === 'recursive') {
        const oldSummary = config.summary ? config.summary.trim() : '';
        if (oldSummary) {
            existingMemoryContext = `【已有长期记忆总结】\n${oldSummary}\n\n`;
        }
    } else if (mode === 'append') {
        const oldList = formatSummaryListToText(config.summaryList);
        if (oldList) {
            existingMemoryContext = `【已知历史记忆摘要集】\n${oldList}\n\n`;
        }
    } else if (mode === 'table') {
        const oldTables = formatTablesToMarkdownWithIndex(config.tableData?.eventHistory, config.tableData?.characterInfo);
        if (oldTables) {
            existingMemoryContext = `【已有剧情与角色状态表】\n${oldTables}\n\n`;
        }
    }

    if (existingMemoryContext) {
        summaryMessages.push({
            role: 'system',
            content: existingMemoryContext.trim()
        });
    }

    summaryMessages.push(...filteredMessages);

    // 2. 添加总结指令提示词
    const promptText = (customPrompt && customPrompt.trim())
        || config.prompts?.[mode]
        || getDefaultPromptForMode(mode);

    summaryMessages.push({ role: 'user', content: promptText });

    // 3. 构建 API 请求
    const requestData = buildApiRequest({
        convId,
        messages: summaryMessages,
        includeWorldBook: withWorldBook,
        includePersona: withRole,
        includeMcp: false,
        includeRealtime: false,
        applyRegex: true
    });

    if (!requestData) throw new Error('构建 API 请求失败。');

    const startTime = Date.now();
    let summaryResult = '';

    // — 为什么这么写 —
    // 检查是否开启了云端后台任务中转保护。总结涉及大量上下文，遭遇切屏/断网时直连长连接易作废。
    // 开启中转时转交自建服务端后台接力长跑，并支持实时 chunk 回传与取消。
    const { isRelayAvailable, executeRelaySummary } = await import('./services/ai-task-relay.js?v=temp');
    const relayInfo = await isRelayAvailable();

    if (relayInfo.available && !options.forceLocal) {
        const conv = state.conversations[convId];
        const apiEndpoint = conv && conv.apiEndpointId ? (state.apiEndpoints[conv.apiEndpointId] || window.API_PRESETS[conv.apiEndpointId]) : null;
        summaryResult = await executeRelaySummary({
            requestData,
            apiEndpoint,
            signal,
            onChunk
        });
    } else {
        const response = await fetch(requestData.url, {
            method: 'POST',
            headers: requestData.headers,
            body: JSON.stringify(requestData.body),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 错误 (${response.status}): ${errorText}`);
        }

        // 4. 解析响应（流式与非流式兼容）
        if (requestData.body.stream && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.substring(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            summaryResult += delta;
                            if (typeof onChunk === 'function') onChunk(delta, summaryResult);
                        }
                    } catch (e) { /* ignore chunk error */ }
                }
            }
        } else {
            const responseData = await response.json();
            summaryResult = responseData.choices?.[0]?.message?.content || '';
            if (typeof onChunk === 'function') onChunk(summaryResult, summaryResult);
        }
    }

    const responseDuration = Date.now() - startTime;
    logSummaryApiDebugResponse({
        convId,
        mode,
        messages: summaryMessages,
        rawResponse: summaryResult,
        responseTime: responseDuration,
        requestUrl: requestData.url
    });



    return summaryResult;
}

/**
 * 记录并沉淀历史总结版本快照（自适应 3 种模式）
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结文本或快照源
 * @param {number[]} hiddenFloors - 当时的隐藏楼层数组
 * @param {string} source - 来源 ('自动总结' | '手动保存')
 */
export function recordSummaryVersion(convId, summaryText, hiddenFloors = [], source = '手动保存') {
    if (!convId) return;

    const existingConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    const history = Array.isArray(existingConfig.history) ? [...existingConfig.history] : [];

    const sortedFloors = [...new Set(hiddenFloors)].sort((a, b) => a - b);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const conv = state.conversations[convId];
    const activeBranch = conv && conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const currentMaxFloor = activeBranch ? activeBranch.length : (sortedFloors.length ? Math.max(...sortedFloors) : 0);

    const mode = existingConfig.memoryMode || 'recursive';

    const newSnapshot = {
        id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
        time: timeStr,
        mode,
        summary: existingConfig.summary,
        summaryList: JSON.parse(JSON.stringify(existingConfig.summaryList || [])),
        tableData: JSON.parse(JSON.stringify(existingConfig.tableData || { eventHistory: [], characterInfo: [] })),
        hiddenFloors: sortedFloors,
        maxFloor: currentMaxFloor,
        charCount: formatMemoryForApi(existingConfig).length,
        source
    };

    // — 为什么这么写 —
    // aiRawText 记录"本次应用的原文"（自动/手动/重试总结时即 AI 原始返回去思维链文本），
    // 供历史版本面板回看这一轮 AI 到底增删了什么（尤其双表 Diff Patch 合并后即丢失的证据）。
    // 按需去重：若本次应用文本与快照自身重建全文一致（递归模式 AI 原文即快照正文、
    // 手动保存、浓缩/跨模式转换前备份等场景），说明快照本身已是原文，不再重复落盘，
    // 避免 localStorage 5MB 限额与云同步流量无谓翻倍。
    const appliedText = (summaryText || '').trim();
    if (appliedText && appliedText !== getSnapshotFullText(newSnapshot).trim()) {
        newSnapshot.aiRawText = summaryText.trim();
    }

    history.unshift(newSnapshot);

    // 最大保留 30 条历史快照，防止存储膨胀
    if (history.length > 30) {
        history.length = 30;
    }

    existingConfig.history = history;
    // 新快照落盘即成为当前记忆基线（回滚场景在 executeRollback 里单独覆写；浓缩应用在调用方置空）
    existingConfig.appliedVersionId = newSnapshot.id;
    existingConfig.appliedAt = newSnapshot.timestamp;
    setHideSummaryForConversation(convId, existingConfig);

    if (convId === state.currentConversationId && window.updateHideSummaryHistoryCount) {
        window.updateHideSummaryHistoryCount();
    }
}

/**
 * 校验分叉重发楼层与当前记忆的时间线因果关系，寻找最适合该分叉点的历史快照（最后一次保存的最优版）
 * — 为什么这么写 —
 * 1. 若当前记忆生成时的楼层 <= 重发楼层，说明记忆库里根本没有未来的废弃剧情，不需要弹窗打扰；
 * 2. 若当前记忆生成时的楼层 > 重发楼层，说明包含废弃剧情，算法按倒序在快照树中找到 maxFloor <= branchFloor 的最新一条快照推荐给用户一键恢复。
 * @param {string} convId - 会话ID
 * @param {number} branchFloor - 重发分叉目标楼层（1-indexed）
 * @returns {{ needPrompt: boolean, bestSnapshot: object|null, currentMemoryFloor: number, branchFloor: number }}
 */
export function checkBranchMemoryStatus(convId, branchFloor) {
    if (!convId || !branchFloor) return { needPrompt: false, bestSnapshot: null, currentMemoryFloor: 0, branchFloor: 0 };
    const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    const mode = config.memoryMode || 'recursive';
    const hasMemory = (mode === 'recursive' && !!config.summary.trim())
        || (mode === 'append' && Array.isArray(config.summaryList) && config.summaryList.length > 0)
        || (mode === 'table' && (
            (Array.isArray(config.tableData?.eventHistory) && config.tableData.eventHistory.length > 0) ||
            (Array.isArray(config.tableData?.characterInfo) && config.tableData.characterInfo.length > 0)
        ));

    const history = Array.isArray(config.history) ? config.history : [];

    // 如果未开启总结且无有效记忆内容，且历史快照为空，则无需提示
    if (!hasMemory && history.length === 0) {
        return { needPrompt: false, bestSnapshot: null, currentMemoryFloor: 0, branchFloor };
    }

    // 获取当前最新记忆对应的发生楼层（以最新快照为准，无快照时以当前隐藏楼层最大值为准）
    const latestSnapshot = history[0];
    const currentMemoryFloor = latestSnapshot
        ? (latestSnapshot.maxFloor || (latestSnapshot.hiddenFloors?.length ? Math.max(...latestSnapshot.hiddenFloors) : 0))
        : (config.hiddenFloors?.length ? Math.max(...config.hiddenFloors) : 0);

    // 如果当前记忆生成时的楼层 <= 重发分叉楼层，因果完全一致，无需回滚提示
    if (currentMemoryFloor <= branchFloor) {
        return { needPrompt: false, bestSnapshot: null, currentMemoryFloor, branchFloor };
    }

    // 当前记忆生成时的楼层 > 重发楼层，说明包含分叉点之后的废弃信息！
    // 逆序查找最适合该分叉楼层的历史快照（即保存时发生楼层 <= branchFloor 的最新一条快照，优先保留大爷最近编辑的心血）
    let bestSnapshot = null;
    for (const snap of history) {
        const snapFloor = snap.maxFloor || (snap.hiddenFloors?.length ? Math.max(...snap.hiddenFloors) : 0);
        if (snapFloor <= branchFloor) {
            bestSnapshot = snap;
            break;
        }
    }

    return {
        needPrompt: true,
        bestSnapshot,
        currentMemoryFloor,
        branchFloor
    };
}

/**
 * 保存并应用总结结果（若勾选归档，将对应消息批量标记隐藏）
 * @param {string} convId - 会话ID
 * @param {string} summaryText - 总结结果文本
 * @param {Array<{msg: Object, floor: number}>} summarizedMessages - 本次被总结的消息列表
 * @param {boolean} dropFloors - 是否自动隐藏被总结的楼层
 * @param {string} [source='自动总结'] - 来源标记
 */
export async function applySummaryResult(convId, summaryText, summarizedMessages, dropFloors, source = '自动总结', targetMode = null) {
    if (!convId || !summaryText || !summaryText.trim()) return;

    const { mainContent } = extractThinkingFromContent(summaryText);
    const cleanSummaryText = (mainContent && mainContent.trim()) ? mainContent.trim() : summaryText.trim();

    const conv = state.conversations[convId];
    if (!conv) return;

    const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
    const existingConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));

    // — 为什么这么写 —
    // 1. 若开启了“总结后抛弃被总结楼层”，将本次参与总结的消息批量标记为 msg.hidden = true
    // 2. 若开启了“保留最后 K 楼不隐藏”，截取排除末尾 K 条消息，保留其可见性以供大模型做格式与近期语境参考；
    //    当总可见消息数 <= K 时，所有消息都应被保留（hideLength = 0），绝不能回退为全部隐藏。
    if (dropFloors && Array.isArray(summarizedMessages) && summarizedMessages.length > 0) {
        const keepCount = existingConfig.keepRecentFloors !== false
            ? (Number(existingConfig.keepRecentFloorsCount) || 2)
            : 0;

        let messagesToHide = summarizedMessages;
        if (existingConfig.keepRecentFloors !== false && keepCount > 0) {
            const hideLength = Math.max(0, summarizedMessages.length - keepCount);
            messagesToHide = summarizedMessages.slice(0, hideLength);
        }

        messagesToHide.forEach(({ msg }) => {
            if (msg) msg.hidden = true;
        });
    }

    // 重新统计当前分支的所有隐藏楼层集合
    const hiddenFloors = activeBranch
        ? activeBranch.map((m, i) => (m.hidden ? i + 1 : null)).filter(Boolean)
        : [];

    const mode = targetMode || existingConfig.memoryMode || 'recursive';
    const newConfig = {
        ...existingConfig,
        memoryMode: mode,
        enabled: true,
        hiddenFloors,
        start: hiddenFloors.length > 0 ? Math.min(...hiddenFloors) : 1,
        end: hiddenFloors.length > 0 ? Math.max(...hiddenFloors) : 1,
        lastAutoSummaryFloor: activeBranch ? activeBranch.length : 0 // 记录当前总结保存时的最新分支总楼层
    };

    if (mode === 'recursive') {
        newConfig.summary = cleanSummaryText;
    } else if (mode === 'append') {
        const floorRange = (Array.isArray(summarizedMessages) && summarizedMessages.length > 0)
            ? `第 ${summarizedMessages[0].floor}~${summarizedMessages[summarizedMessages.length - 1].floor} 楼`
            : '新增对话';
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        
        newConfig.summaryList = [
            ...(newConfig.summaryList || []),
            {
                id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                time: timeStr,
                floorRange,
                content: cleanSummaryText
            }
        ];
    } else if (mode === 'table') {
        // — 为什么这么写 —
        // 1. 优先尝试大爷的三阶段 Diff Patch 协议（更新 -> 删除 -> 拼接追加），保护历史剧情不被冲刷
        // 2. 若未包含操作协议标签，自动降级到智能合并引擎（事件指纹去重追加 + 角色按姓名 Upsert）
        // 3. 若两者均无法提取出有效数据（格式严重损坏），绝不破坏旧数据，沉淀挂起单 pendingSummaryError 并弹窗让大爷决策
        let mergedTableData = applyTableDiffPatch(existingConfig.tableData, cleanSummaryText);

        if (!mergedTableData) {
            const parsed = parseMarkdownTables(cleanSummaryText);
            if (parsed.eventHistory.length > 0 || parsed.characterInfo.length > 0) {
                mergedTableData = mergeTableData(existingConfig.tableData, parsed);
            }
        }

        if (mergedTableData && (mergedTableData.eventHistory.length > 0 || mergedTableData.characterInfo.length > 0)) {
            // 成功合并：清除此前可能残留的挂起单
            delete newConfig.pendingSummaryError;
            newConfig.tableData = mergedTableData;
        } else {
            // 格式严重损坏：旧数据 100% 物理保护，记录挂起单并调起异常处理弹窗
            const floorRange = (Array.isArray(summarizedMessages) && summarizedMessages.length > 0)
                ? `第 ${summarizedMessages[0].floor} ~ ${summarizedMessages[summarizedMessages.length - 1].floor} 楼`
                : '新增楼层';

            newConfig.pendingSummaryError = {
                timestamp: Date.now(),
                floorRange,
                rawContent: cleanSummaryText,
                source,
                errorMessage: '⚠️ AI 提炼的结构双表列数不符合规范（缺少必要的分隔符或列数不足：表1严格需5列、表2严格需4列）。为了防止记忆数据错乱，系统已物理保护原有数据未被修改。'
            };

            setHideSummaryForConversation(convId, newConfig);
            await saveConversation(convId, conv);
            await saveToLocalStorage();

            if (window.showSummaryFormatErrorModal) {
                window.showSummaryFormatErrorModal(convId, newConfig.pendingSummaryError);
            }
            return;
        }
    }

    setHideSummaryForConversation(convId, newConfig);
    recordSummaryVersion(convId, cleanSummaryText, hiddenFloors, source);

    await saveConversation(convId, conv);
    await saveToLocalStorage();

    // 仅当总结完成的会话恰好就是用户当前正驻留的活动会话时，才去局部刷新当前聊天流与顶栏徽章
    if (convId === state.currentConversationId) {
        renderChatMessages({ updateVisibilityOnly: true });
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.updateSessionTokenBadge) window.updateSessionTokenBadge();
        if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    }
}

/**
 * 全局自动总结上下文（供并发冲突弹窗订阅流式输出与耗时秒表）
 */
export const autoSummaryContext = {
    convId: null,
    startTime: 0,
    currentStreamText: '',
    listeners: new Set(),
    abortController: null
};

/**
 * 校准并获取当前分支自动总结的有效基准楼层（自愈回滚、截断与历史分支切换）
 * @param {Array} activeBranch - 当前活跃分支消息数组
 * @param {Object} hideConfig - 隐藏与总结配置
 * @returns {number} 有效基准楼层 lastFloor
 */
/**
 * 检查配置中是否包含有效的长期记忆内容
 * @param {Object} hideConfig - 标准化配置对象
 * @returns {boolean} 是否有有效记忆
 */
export function hasValidSummaryContent(hideConfig) {
    if (!hideConfig) return false;
    const mode = hideConfig.memoryMode || 'recursive';
    if (mode === 'recursive') {
        return typeof hideConfig.summary === 'string' && hideConfig.summary.trim().length > 0;
    } else if (mode === 'append') {
        return Array.isArray(hideConfig.summaryList) && hideConfig.summaryList.length > 0;
    } else if (mode === 'table') {
        const td = hideConfig.tableData;
        return !!(td && ((Array.isArray(td.eventHistory) && td.eventHistory.length > 0) || (Array.isArray(td.characterInfo) && td.characterInfo.length > 0)));
    }
    return false;
}

export function clearSkippedAutoSummaryRound(convId) {
    if (!convId) return;
    if (window._skippedAutoSummaryRounds && window._skippedAutoSummaryRounds[convId]) {
        delete window._skippedAutoSummaryRounds[convId];
    }
}

export function getNormalizedLastAutoSummaryFloor(activeBranch, hideConfig) {
    if (!activeBranch || activeBranch.length === 0) return 0;
    const currentTotalFloors = activeBranch.length;

    // — 为什么这么写 —
    // 无论是按楼层还是按 Token 自动总结，都必须基于“上次总结保存完成时的基准楼层”进行状态校准：
    // 1. 【纯白板无记忆状态归零校准】：
    //    若当前会话既无有效长期记忆内容、且当前分支未隐藏任何楼层（例如一键重置为初始无记忆状态并重发，或新建会话），
    //    无论历史快照列表中是否存有被废弃的归档版本，当前分支在因果上均属于"初始无记忆"状态，
    //    基准楼层必须严格归零 (return 0)，确保从第 1 楼开始重新准确统计未总结累积量！
    const hasValidMemory = hasValidSummaryContent(hideConfig);
    const hasHiddenFloors = Array.isArray(hideConfig?.hiddenFloors) && hideConfig.hiddenFloors.length > 0;
    if (!hasValidMemory && !hasHiddenFloors) {
        return 0;
    }

    let lastFloor = (hideConfig?.lastAutoSummaryFloor !== undefined && hideConfig?.lastAutoSummaryFloor !== null)
        ? Number(hideConfig.lastAutoSummaryFloor)
        : NaN;

    // 2. 仅当老会话升级从未初始化过 lastAutoSummaryFloor（为 NaN）时，才尝试读取最新快照的发生楼层作为基准
    if (isNaN(lastFloor)) {
        const hasHistorySnap = Array.isArray(hideConfig?.history) && hideConfig.history.length > 0;
        if (hasHistorySnap) {
            const latestSnap = hideConfig.history[0];
            const snapFloor = latestSnap?.maxFloor || (latestSnap?.hiddenFloors?.length ? Math.max(...latestSnap.hiddenFloors) : 0);
            if (snapFloor > 0 && snapFloor <= currentTotalFloors) {
                lastFloor = snapFloor;
            } else {
                lastFloor = 0;
            }
        } else {
            lastFloor = 0;
        }
    }

    // 3. 若当前总楼层小于记录的上次楼层（用户从此重发、回滚截断或切换到了较短分支），
    //    自动将基准校准为当前分支的最大已隐藏楼层（无隐藏则为 0），防止增量变为负数长久不触发；
    if (currentTotalFloors < lastFloor) {
        const hiddenMax = hasHiddenFloors ? Math.max(...hideConfig.hiddenFloors) : 0;
        lastFloor = Math.min(hiddenMax, currentTotalFloors);
    }

    return Math.max(0, lastFloor);
}

/**
 * 计算自动总结自上次基准楼层以来新积累的纯正文 Token 详情（Plan A 真增量步进模型）
 * @param {Object} conv - 会话对象
 * @param {Object} hideConfig - 标准化后的隐藏与总结配置
 * @returns {Object} 积累统计详情与触发状态
 */
/**
 * 计算自动总结楼层增量与剩余楼层进度详情（步进增量模型）
 * @param {Object} conv - 会话对象
 * @param {Object} hideConfig - 标准化后的隐藏与总结配置
 * @returns {Object} 楼层积累详情与剩余楼层信息
 */
export function calculateAutoSummaryFloorProgress(conv, hideConfig) {
    const rawInterval = Number(hideConfig?.autoSummaryFloorInterval);
    // 强制上下限安全钳制 2 ~ 100
    const floorInterval = isNaN(rawInterval) ? 10 : Math.max(2, Math.min(100, rawInterval));

    if (!conv || !conv.branches) {
        return {
            startFloor: 1,
            lastFloor: 0,
            currentTotalFloors: 0,
            deltaFloors: 0,
            floorInterval,
            remainingFloors: floorInterval,
            visibleCount: 0,
            keepCount: 2,
            isDropFloors: true,
            canTrigger: false
        };
    }

    const activeBranch = conv.branches[conv.activeBranchIndex] || [];
    const currentTotalFloors = activeBranch.length;
    const lastFloor = getNormalizedLastAutoSummaryFloor(activeBranch, hideConfig);
    const startFloor = lastFloor + 1;
    const deltaFloors = Math.max(0, currentTotalFloors - lastFloor);
    const remainingFloors = Math.max(0, floorInterval - deltaFloors);

    const visibleItems = getVisibleMessagesForSummary(activeBranch, hideConfig);
    const isDropFloors = hideConfig?.dropSummarizedFloors !== false;
    const keepCount = (hideConfig?.keepRecentFloors !== false)
        ? (Number(hideConfig?.keepRecentFloorsCount) || 2)
        : 0;

    // — 为什么这么写 —
    // 1. 【楼层步进增量闭环】：与“每隔 N 楼自动总结一次”判定规则保持 100% 同步；
    // 2. 自上次总结基准 (lastFloor) 之后，新产生累积的消息楼层达到设定间隔 (deltaFloors >= floorInterval)，
    //    即满足总结步长；
    // 3. 若开启自动隐藏，仍需确保可见楼层数大于保留楼层数 (visibleItems.length > keepCount)，
    //    才能真正执行释放。
    let canTrigger = false;
    if (deltaFloors >= floorInterval) {
        if (isDropFloors) {
            canTrigger = visibleItems.length > keepCount;
        } else {
            canTrigger = visibleItems.length > 0;
        }
    }

    return {
        startFloor,
        lastFloor,
        currentTotalFloors,
        deltaFloors,
        floorInterval,
        remainingFloors,
        visibleCount: visibleItems.length,
        keepCount,
        isDropFloors,
        canTrigger
    };
}

export function calculateAutoSummaryTokenProgress(conv, hideConfig) {
    const rawThreshold = Number(hideConfig?.autoSummaryTokenThreshold);
    // 强制上下限安全钳制 500 ~ 100000
    const tokenThreshold = isNaN(rawThreshold) ? 4000 : Math.max(500, Math.min(100000, rawThreshold));

    if (!conv || !conv.branches) {
        return {
            startFloor: 1,
            lastFloor: 0,
            accumulatedTokens: 0,
            tokenThreshold,
            totalVisibleTokens: 0,
            visibleCount: 0,
            keepCount: 2,
            isDropFloors: true,
            canTrigger: false
        };
    }

    const activeBranch = conv.branches[conv.activeBranchIndex] || [];
    const lastFloor = getNormalizedLastAutoSummaryFloor(activeBranch, hideConfig);
    const startFloor = lastFloor + 1;

    const visibleItems = getVisibleMessagesForSummary(activeBranch, hideConfig);
    let totalVisibleTokens = 0;
    let deltaTokens = 0;

    visibleItems.forEach(({ msg, floor }) => {
        const raw = msg.content || '';
        const mainText = (msg.role === 'assistant')
            ? (extractThinkingFromContent(raw).mainContent || '')
            : raw;
        const msgTokens = countTokens(mainText);
        totalVisibleTokens += msgTokens;

        if (floor > lastFloor) {
            deltaTokens += msgTokens;
        }
    });

    const isDropFloors = hideConfig?.dropSummarizedFloors !== false;
    const keepCount = (hideConfig?.keepRecentFloors !== false)
        ? (Number(hideConfig?.keepRecentFloorsCount) || 2)
        : 0;

    // — 为什么这么写 —
    // 1. 【真增量步进闭环】：小说或长篇创作时，保留的最后 K 楼本身可能包含数千字，若按总水位判定会导致隔轮频繁总结；
    // 2. 唯有自上次总结基准 (lastFloor) 之后，新产生累积的纯正文达到设定的阈值 (deltaTokens >= tokenThreshold)，
    //    才真正代表用户积累了一整个完整批次的新内容；
    // 3. 当开启自动隐藏时，必须确保当前可见楼层总数大于保留楼层数 (visibleItems.length > keepCount)，
    //    才能真正执行释放，杜绝无消息可藏时的误触发。
    let canTrigger = false;
    if (deltaTokens >= tokenThreshold) {
        if (isDropFloors) {
            canTrigger = visibleItems.length > keepCount;
        } else {
            canTrigger = visibleItems.length > 0;
        }
    }

    return {
        startFloor,
        lastFloor,
        accumulatedTokens: deltaTokens,
        tokenThreshold,
        totalVisibleTokens,
        visibleCount: visibleItems.length,
        keepCount,
        isDropFloors,
        canTrigger
    };
}

/**
 * 自动总结触发检查器（在流式响应结束或用户发送后调用）
 * @param {string} convId - 会话ID
 * @param {number} branchIndex - 分支索引
 */
export async function checkAndTriggerAutoSummary(convId, branchIndex) {
    if (!convId) return;
    if (state.isAutoSummarizing) return; // 避免并发重复触发

    const conv = state.conversations[convId];
    if (!conv || !conv.branches) return;
    const activeBranch = conv.branches[branchIndex ?? conv.activeBranchIndex];
    if (!activeBranch || activeBranch.length === 0) return;

    const hideConfig = normalizeHideSummaryConfig(state.hideSummary && state.hideSummary[convId]);
    if (!hideConfig.autoSummaryEnabled) return;

    // 获取当前分支所有未隐藏的可见消息
    const visibleItems = getVisibleMessagesForSummary(activeBranch, hideConfig);
    if (visibleItems.length === 0) return;

    // — 为什么这么写 —
    // 1. 自动总结必须在 AI 回复成功且完整结束后触发；
    // 2. 若最后一条消息是用户提问（AI 尚未回复或生成中断）或包含错误标记（如连接报错/网络中断/空文本），绝不能盲目发起总结，
    //    避免在网络或服务故障时产生“幽灵弹窗”与并发报错。
    const lastMsg = activeBranch[activeBranch.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;
    const lastMsgContent = (lastMsg.content || '').trim();
    if (!lastMsgContent) return;
    if (lastMsgContent.includes('error-indicator') || lastMsgContent.includes('[Response Error:') || lastMsgContent.includes('[ 该消息意外中断') || lastMsgContent.includes('[ 生成已中断')) {
        return;
    }

    const autoType = hideConfig.autoSummaryType || 'floors';
    const floorInterval = Number(hideConfig.autoSummaryFloorInterval) || 10;
    const currentTotalFloors = activeBranch.length;
    const lastFloor = getNormalizedLastAutoSummaryFloor(activeBranch, hideConfig);

    let shouldTrigger = false;
    let deltaFloors = 0;

    if (autoType === 'floors') {
        // “每隔 N 楼自动总结一次”以新增楼层的步进增量为核心判定条件：deltaFloors >= floorInterval
        deltaFloors = currentTotalFloors - lastFloor;
        if (deltaFloors >= floorInterval && visibleItems.length > 0) {
            shouldTrigger = true;
        }
    } else if (autoType === 'tokens') {
        // “可见消息达 N Token 自动总结”采用 Plan A 真增量步进模型：
        const progress = calculateAutoSummaryTokenProgress(conv, hideConfig);
        if (progress.canTrigger) {
            shouldTrigger = true;
        }
    }

    if (!shouldTrigger) {
        // 前瞻预警：当本次未达到触发阈值时，若下一轮对话完成即触发，主动弹出 Toast 提示
        checkAndWarnNextSummary(conv, hideConfig, activeBranch, lastFloor, floorInterval, currentTotalFloors);
        if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
        return;
    }

    // 触发总结时隐藏前瞻预警贴纸
    hideAutoSummaryPreWarning();

    // 如果用户此前选择了“稍后提醒 (跳过本次)”，在该会话尚未新增消息前不重复打扰
    window._skippedAutoSummaryRounds = window._skippedAutoSummaryRounds || {};
    if (window._skippedAutoSummaryRounds[convId] === currentTotalFloors) {
        return;
    }

    // — 为什么这么写 —
    // 当开启了 AI 后台任务中转时，由于长文本总结上下文体积大且耗时，若遭遇切屏或断网直连容易掐断。
    // 系统支持根据用户偏好策略（relayAutoSummaryPolicy）决定是弹窗询问、还是直接云端中转或本地直连：
    // 1. 若未开启中转 (未登录云端或未启用中转保护)，保持原有的本地静默自动总结，不增加额外交互打扰；
    // 2. 若已开启中转：
    //    - 'always_relay': 自动在云端后台接力长跑；
    //    - 'always_local': 自动在浏览器发起本地直连流式；
    //    - 'ask' (默认): 弹出专属决策弹窗，供用户明确知情选择，并可勾选记住偏好。
    let forceLocal = false;
    const { isRelayAvailable } = await import('./services/ai-task-relay.js?v=temp');
    const relayInfo = await isRelayAvailable();

    if (relayInfo.available) {
        const policy = hideConfig.relayAutoSummaryPolicy || 'ask';
        if (policy === 'always_relay') {
            forceLocal = false;
        } else if (policy === 'always_local') {
            forceLocal = true;
        } else {
            const { openAutoSummaryRelayModal } = await import('./modals/auto-summary-relay-modal.js?v=temp');
            let triggerDesc = `当前已累积新增 ${deltaFloors} 楼，已达到设定的总结步长 (${floorInterval} 楼)`;
            if (autoType === 'tokens') {
                const prog = calculateAutoSummaryTokenProgress(conv, hideConfig);
                triggerDesc = `当前已累积 ${prog.accumulatedTokens.toLocaleString()} Token，已达到设定的总结阈值 (${prog.tokenThreshold.toLocaleString()} Token)`;
            }

            const decision = await openAutoSummaryRelayModal({
                convId,
                triggerDesc,
                isRelayReady: true
            });

            if (decision.action === 'skip') {
                window._skippedAutoSummaryRounds = window._skippedAutoSummaryRounds || {};
                window._skippedAutoSummaryRounds[convId] = currentTotalFloors;
                return;
            }

            if (decision.action === 'local') {
                forceLocal = true;
            } else {
                forceLocal = false;
            }

            if (decision.remember) {
                hideConfig.relayAutoSummaryPolicy = forceLocal ? 'always_local' : 'always_relay';
                setHideSummaryForConversation(convId, hideConfig);
                await saveToLocalStorage();
            }
        }
    }

    // 异步执行自动总结并维护流式广播上下文
    state.isAutoSummarizing = true;
    state.autoSummarizingConvId = convId;
    updateSummaryEditorLockState();
    autoSummaryContext.convId = convId;
    autoSummaryContext.startTime = Date.now();
    autoSummaryContext.currentStreamText = '';
    autoSummaryContext.abortController = new AbortController();

    // 立即刷新顶栏总结按钮动画与状态
    if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();

    // 立即弹出提示：开始进行自动总结
    if (relayInfo.available && !forceLocal) {
        notify.info('☁️ 已通过云端中转开始自动记忆总结 (切后台/息屏不中断)...');
    } else {
        notify.info('🔄 开始进行自动记忆总结...');
    }

    try {
        const mode = hideConfig.memoryMode || 'recursive';
        const customPrompt = hideConfig.prompts?.[mode] || getDefaultPromptForMode(mode);

        const summaryResult = await generateSummaryApiCall({
            convId,
            messagesToSummarize: visibleItems,
            customPrompt,
            withRole: !!hideConfig.withRole,
            withWorldBook: !!hideConfig.withWorldBook,
            forceLocal,
            signal: autoSummaryContext.abortController.signal,
            onChunk: (delta, fullText) => {
                autoSummaryContext.currentStreamText = fullText;
                // 广播给所有并发订阅者
                autoSummaryContext.listeners.forEach(listener => {
                    try {
                        if (typeof listener === 'function') listener(delta, fullText);
                        else if (listener && typeof listener.onChunk === 'function') listener.onChunk(delta, fullText);
                    } catch (e) { /* ignore listener error */ }
                });
            }
        });

        if (summaryResult && summaryResult.trim()) {
            await applySummaryResult(convId, summaryResult, visibleItems, !!hideConfig.dropSummarizedFloors, '自动总结', hideConfig.memoryMode || 'recursive');
            notify.success(`✨ 智能记忆：已自动总结前文对话并压缩了 ${visibleItems.length} 个楼层！`);
            // 历史版本首次达到 10 个时弹一次提醒（仅后台自动总结路径，手动总结不打扰）
            await maybeWarnHistoryVersionLimit(convId);
        }

        // 通知完成
        autoSummaryContext.listeners.forEach(listener => {
            try {
                if (listener && typeof listener.onFinish === 'function') listener.onFinish(summaryResult);
            } catch (e) {}
        });
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn('[AutoSummary] 自动总结失败:', err);
            notify.warning(`⚠️ 自动记忆总结未完成: ${err.message || '网络或接口请求异常'}`);
        }
        autoSummaryContext.listeners.forEach(listener => {
            try {
                if (listener && typeof listener.onError === 'function') listener.onError(err);
            } catch (e) {}
        });
    } finally {
        state.isAutoSummarizing = false;
        state.autoSummarizingConvId = null;
        updateSummaryEditorLockState();
        autoSummaryContext.convId = null;
        autoSummaryContext.startTime = 0;
        autoSummaryContext.currentStreamText = '';
        autoSummaryContext.abortController = null;
        if (window.updateHideSummaryBtnColor) window.updateHideSummaryBtnColor();
        if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
    }
}


/**
 * 历史总结版本数量达到阈值时的一次性提醒
 * — 为什么这么写 —
 * 1. 每次自动总结都会沉淀一条历史版本快照（上限 30 条），长期运行会无限堆积，
 *    用户容易遗忘清理入口，故在版本数首次达到 10 个时弹一次提示；
 * 2. config.historyLimitWarned 标记保证"每次达到 10 个只弹一次"：
 *    版本数回落到 10 以下时自动重置标记，下次再达到 10 个仍会提醒一次；
 * 3. 只挂在后台自动总结成功路径，手动总结与重试总结不打扰用户。
 * @param {string} convId - 会话ID
 */
async function maybeWarnHistoryVersionLimit(convId) {
    try {
        const config = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
        const historyCount = Array.isArray(config.history) ? config.history.length : 0;

        // 回落到阈值以下时重置提醒标记，保证"再次达到 10 个"还能提醒
        if (historyCount < 10) {
            if (config.historyLimitWarned) {
                config.historyLimitWarned = false;
                setHideSummaryForConversation(convId, config);
                await saveToLocalStorage();
            }
            return;
        }

        if (config.historyLimitWarned) return;
        config.historyLimitWarned = true;
        setHideSummaryForConversation(convId, config);
        await saveToLocalStorage();

        showErrorDialog(
            '历史版本提醒',
            `当前会话的历史总结版本已达到 <strong>${historyCount}</strong> 个。版本快照会持续累积（上限 30 条），建议及时在【会话记忆与智能总结 → 历史版本】中清理或回滚旧版本，避免存储膨胀。`,
            'warning'
        );
    } catch (e) {
        console.warn('[AutoSummary] 历史版本提醒检查失败:', e);
    }
}


/**
 * 调用 LLM 执行记忆二次浓缩与精炼请求
 * @param {Object} options
 * @param {string} options.convId - 会话ID
 * @param {string} options.memoryText - 待浓缩的原始记忆内容
 * @param {string} options.prompt - 浓缩提示词
 * @param {boolean} [options.withRole=true] - 是否携带角色人设
 * @param {boolean} [options.withWorldBook=true] - 是否携带备忘录
 * @param {AbortSignal} [options.signal] - 中断信号
 * @param {Function} [options.onChunk] - 流式返回回调
 * @returns {Promise<string>} 浓缩结果文本
 */
export async function condenseMemoryApiCall(options) {
    const {
        convId,
        memoryText,
        prompt,
        withRole = true,
        withWorldBook = true,
        signal,
        onChunk
    } = options;

    if (!memoryText || !memoryText.trim()) {
        throw new Error('待浓缩的记忆内容为空。');
    }

    const conv = state.conversations[convId];
    if (!conv) throw new Error('未找到当前会话数据。');

    const apiEndpoint = state.apiEndpoints[conv.apiEndpointId];
    if (!apiEndpoint) throw new Error('当前会话未配置有效的 API 端点。');

    const condenseMessages = [
        {
            role: 'system',
            content: '你是一位专业的信息提炼架构师，擅长长程记忆的深度脱水、降维压缩与核心脉络梳理。你必须严格遵循用户的精炼要求与格式规范进行输出。'
        },
        {
            role: 'user',
            content: `【待处理的长期记忆内容】\n${memoryText.trim()}\n\n【处理要求】\n${prompt.trim()}`
        }
    ];

    const requestData = buildApiRequest({
        convId,
        messages: condenseMessages,
        includeWorldBook: !!withWorldBook,
        includePersona: !!withRole,
        includeMcp: false,
        includeRealtime: false,
        applyRegex: false
    });

    if (!requestData) throw new Error('构建 API 请求失败。');

    let result = '';

    // — 为什么这么写 —
    // 记忆精炼提炼同样支持 AI 后台任务中转，防御切屏中断
    const { isRelayAvailable: isRelayForCondense, executeRelaySummary: executeRelayForCondense } = await import('./services/ai-task-relay.js?v=temp');
    const relayCondenseInfo = await isRelayForCondense();

    if (relayCondenseInfo.available) {
        const conv = state.conversations[convId];
        const apiEndpoint = conv && conv.apiEndpointId ? (state.apiEndpoints[conv.apiEndpointId] || window.API_PRESETS[conv.apiEndpointId]) : null;
        result = await executeRelayForCondense({
            requestData,
            apiEndpoint,
            signal,
            onChunk
        });
    } else {
        const response = await fetch(requestData.url, {
            method: 'POST',
            headers: requestData.headers,
            body: JSON.stringify(requestData.body),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 错误 (${response.status}): ${errorText}`);
        }

        if (requestData.body.stream && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.substring(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            result += delta;
                            if (typeof onChunk === 'function') onChunk(delta, result);
                        }
                    } catch (e) {}
                }
            }
        } else {
            const responseData = await response.json();
            result = responseData.choices?.[0]?.message?.content || '';
            if (typeof onChunk === 'function') onChunk(result, result);
        }
    }

    return result;
}

/**
 * 显示输入框上方自动总结前瞻醒目预警贴纸 (Plan A)
 * @param {string} text - 提示文本
 * @param {string} warnKey - 防重复标识
 */
export function showAutoSummaryPreWarning(text, warnKey) {
    if (!dom.autoSummaryPreWarning || !dom.autoSummaryPreWarningText) return;
    if (window._dismissedAutoSummaryWarnKey === warnKey) return;

    dom.autoSummaryPreWarningText.textContent = text;
    dom.autoSummaryPreWarning.classList.remove('hidden');

    if (dom.autoSummaryPreWarningDismiss) {
        dom.autoSummaryPreWarningDismiss.onclick = (e) => {
            e.stopPropagation();
            window._dismissedAutoSummaryWarnKey = warnKey;
            dom.autoSummaryPreWarning.classList.add('hidden');
        };
    }
}

/**
 * 隐藏输入框上方自动总结前瞻醒目预警贴纸
 */
export function hideAutoSummaryPreWarning() {
    if (dom.autoSummaryPreWarning) {
        dom.autoSummaryPreWarning.classList.add('hidden');
    }
}
window.hideAutoSummaryPreWarning = hideAutoSummaryPreWarning;

/**
 * 自动总结前瞻预检：当本次未达到触发阈值时，若下一轮对话完成即达到门槛，主动显示醒目预警 (Plan A)
 * @param {object} conv - 会话对象
 * @param {object} hideConfig - 总结配置
 * @param {Array} activeBranch - 当前活跃分支
 * @param {number} lastFloor - 上一次总结基准楼层
 * @param {number} floorInterval - 楼层总结步长
 * @param {number} currentTotalFloors - 当前总楼层数
 */
export function checkAndWarnNextSummary(conv, hideConfig, activeBranch, lastFloor, floorInterval, currentTotalFloors) {
    if (!conv || !hideConfig || !hideConfig.autoSummaryEnabled) {
        hideAutoSummaryPreWarning();
        return;
    }
    const convId = conv.id;
    if (convId !== state.currentConversationId) {
        hideAutoSummaryPreWarning();
        return;
    }

    const autoType = hideConfig.autoSummaryType || 'floors';

    if (autoType === 'floors') {
        const deltaFloors = currentTotalFloors - lastFloor;
        // 正常一问一答增加 2 楼。若再进行一轮问答将达到或超出步长设定
        if (deltaFloors > 0 && (deltaFloors + 2) >= floorInterval) {
            const warnKey = `${convId}_flr_${currentTotalFloors}`;
            const msg = `⚡ 记忆总结预警：下一轮对话完成后将自动触发会话记忆总结 (当前已累积 ${deltaFloors}/${floorInterval} 楼)`;
            showAutoSummaryPreWarning(msg, warnKey);
            if (window._lastAutoSummaryWarnKey !== warnKey) {
                window._lastAutoSummaryWarnKey = warnKey;
                notify.info(msg);
            }
        } else {
            // 未处于触发临界点时隐藏横条
            hideAutoSummaryPreWarning();
        }
    } else if (autoType === 'tokens') {
        const progress = calculateAutoSummaryTokenProgress(conv, hideConfig);
        if (progress.tokenThreshold > 0 && progress.accumulatedTokens >= progress.tokenThreshold * 0.8) {
            const warnKey = `${convId}_tok_${Math.floor(progress.accumulatedTokens / 500)}`;
            const msg = `⚡ 记忆总结预警：当前已累积 ${progress.accumulatedTokens.toLocaleString()} / ${progress.tokenThreshold.toLocaleString()} Token，预计下一轮对话将触发自动总结`;
            showAutoSummaryPreWarning(msg, warnKey);
            if (window._lastAutoSummaryWarnKey !== warnKey) {
                window._lastAutoSummaryWarnKey = warnKey;
                notify.info(msg);
            }
        } else {
            hideAutoSummaryPreWarning();
        }
    }
}

/**
 * 处理未决的记忆总结格式异常挂起单（支持重试或忽略）
 * @param {string} convId - 会话ID
 * @param {'retry'|'ignore'} action - 处理动作
 */
export async function resolvePendingSummaryError(convId, action) {
    if (!convId) return;
    const conv = state.conversations[convId];
    if (!conv) return;

    const hideConfig = normalizeHideSummaryConfig(getHideSummaryForConversation(convId));
    if (!hideConfig.pendingSummaryError) return;

    if (action === 'ignore') {
        delete hideConfig.pendingSummaryError;
        setHideSummaryForConversation(convId, hideConfig);
        await saveConversation(convId, conv);
        await saveToLocalStorage();
        notify.info('已忽略本次记忆总结，前文历史完好保留。');
    } else if (action === 'retry') {
        delete hideConfig.pendingSummaryError;
        setHideSummaryForConversation(convId, hideConfig);
        await saveConversation(convId, conv);
        await saveToLocalStorage();

        const activeBranch = conv.branches ? conv.branches[conv.activeBranchIndex] : [];
        const visibleItems = getVisibleMessagesForSummary(activeBranch, hideConfig);
        if (visibleItems.length === 0) {
            notify.warning('未找到待总结的可见消息。');
            return;
        }

        notify.info('🔄 正在重新尝试进行记忆总结...');
        try {
            const mode = hideConfig.memoryMode || 'table';
            const customPrompt = hideConfig.prompts?.[mode] || getDefaultPromptForMode(mode);
            const summaryResult = await generateSummaryApiCall({
                convId,
                messagesToSummarize: visibleItems,
                customPrompt,
                withRole: !!hideConfig.withRole,
                withWorldBook: !!hideConfig.withWorldBook
            });

            if (summaryResult && summaryResult.trim()) {
                await applySummaryResult(convId, summaryResult, visibleItems, !!hideConfig.dropSummarizedFloors, '重试总结', mode);
                notify.success('✨ 重试成功！记忆双表已完成合并更新。');
                if (window.refreshHideSummaryModalViews) window.refreshHideSummaryModalViews();
            }
        } catch (err) {
            notify.error(`重试总结失败: ${err.message}`);
        }
    }
}


/**
 * 输出智能总结调试日志并触发虚拟 /debug/api-response 请求
 * 支持在控制台展开查看完整发送内容与大模型原始返回，并在 Network 面板过滤 api-response
 * @param {object} params
 * @param {string} params.convId - 会话ID
 * @param {string} params.mode - 记忆模式
 * @param {Array<object>} params.messages - 发送的完整 messages
 * @param {string} params.rawResponse - 大模型完整原始输出
 * @param {number} params.responseTime - 耗时 ms
 * @param {string} params.requestUrl - 真实请求的目标 API 地址
 */
export function logSummaryApiDebugResponse({ convId, mode, messages, rawResponse, responseTime, requestUrl }) {
    const totalChars = (rawResponse || '').length;
    const estTokens = countTokens(rawResponse || '');

    // 1. 控制台结构化折叠输出（醒目蓝色标识）
    console.groupCollapsed(
        `%c[debug/api-response] 智能总结完成 | 模式: ${mode} | 耗时: ${responseTime}ms | 字符: ${totalChars.toLocaleString()} (约 ${estTokens.toLocaleString()}T)`,
        'color: #0969da; font-weight: bold; background: rgba(9, 105, 218, 0.08); padding: 2px 6px; border-radius: 4px;'
    );
    console.log('📌 【1. 发送给大模型的完整上下文与指令 (Messages)】:\n', messages);
    console.log('✨ 【2. 大模型返回的完整原始输出 (Content)】:\n', rawResponse);
    console.groupEnd();

    // 2. 发起虚拟 POST 请求到 /debug/api-response，供 F12 Network 面板过滤查看
    try {
        const debugResponse = {
            id: `summary_debug_${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: `summary-${mode}`,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: rawResponse
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: 0,
                completion_tokens: estTokens,
                total_tokens: estTokens
            },
            debug_info: {
                type: 'summary_api_response',
                conversation_id: convId,
                memory_mode: mode,
                response_time: responseTime,
                request_url: requestUrl || '',
                timestamp: new Date().toISOString()
            },
            request_payload: {
                messages
            }
        };

        const debugUrl = window.location.origin + '/debug/api-response';
        fetch(debugUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Debug-Type': 'summary-complete',
                'X-Summary-Mode': mode,
                'X-Original-URL': requestUrl || ''
            },
            body: JSON.stringify(debugResponse, null, 2),
            mode: 'no-cors'
        }).catch(() => { });
    } catch (e) {
        // 静默捕获避免调试逻辑影响业务主流程
    }
}
