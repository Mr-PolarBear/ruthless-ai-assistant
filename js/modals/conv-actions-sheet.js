/**
 * @file conv-actions-sheet.js
 * @description 移动端会话管理底部抽屉面板 (Action Sheet)
 * 
 * 为什么这么写：
 * 1. 移动端触屏无 hover，原本桌面端排布的 6 个密集小按钮极易误触；
 * 2. 将会话条目整行作为纯粹的切换热区，管理操作收纳进专门的移动端底部 Action Sheet；
 * 3. 具备中文大字标签与图标，操作安全直观，彻底消除误删与误触风险；
 * 4. 深度复用原有会话操作接口，低耦合、高可维护。
 */

import { state } from '../state.js?v=260907';
import { 
    openConvTitleModal, 
    openExportConvModal, 
    openConversationAvatarModal 
} from '../modals.js?v=260907';
import { 
    handlePinConversation, 
    handleDuplicateConversation, 
    handleDeleteConversation 
} from '../chat-events.js?v=260907';

let sheetOverlay = null;
let currentActiveConvId = null;

/**
 * 初始化或获取单例面板元素
 * @returns {HTMLElement}
 */
function getOrCreateSheetOverlay() {
    if (sheetOverlay) return sheetOverlay;

    sheetOverlay = document.createElement('div');
    sheetOverlay.id = 'conv-actions-sheet-overlay';
    sheetOverlay.className = 'conv-actions-sheet-overlay';

    sheetOverlay.innerHTML = `
        <div class="conv-actions-sheet" role="dialog" aria-modal="true" aria-labelledby="conv-sheet-title">
            <div class="conv-actions-sheet-header">
                <div class="conv-actions-sheet-drag-handle"></div>
                <div class="conv-actions-sheet-title" id="conv-sheet-title">会话管理</div>
                <div class="conv-actions-sheet-subtitle">请选择要对该会话执行的操作</div>
            </div>
            <div class="conv-actions-sheet-body">
                <button type="button" class="conv-actions-sheet-item" data-action="pin">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><polyline points="18 14 12 8 6 14"></polyline></svg>
                    <span class="action-text">置顶此对话</span>
                </button>
                <button type="button" class="conv-actions-sheet-item" data-action="rename">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                    <span>修改会话标题</span>
                </button>
                <button type="button" class="conv-actions-sheet-item" data-action="duplicate">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span>复制生成副本</span>
                </button>
                <button type="button" class="conv-actions-sheet-item" data-action="avatar">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    <span>设置会话头像</span>
                </button>
                <button type="button" class="conv-actions-sheet-item" data-action="export">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>导出会话记录</span>
                </button>
                <button type="button" class="conv-actions-sheet-item danger" data-action="delete">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    <span>删除此会话</span>
                </button>
            </div>
            <button type="button" class="conv-actions-sheet-cancel">取消</button>
        </div>
    `;

    document.body.appendChild(sheetOverlay);

    // 绑定面板内部事件委托
    sheetOverlay.addEventListener('click', (e) => {
        // 点击遮罩本身或取消按钮关闭
        if (e.target === sheetOverlay || e.target.closest('.conv-actions-sheet-cancel')) {
            e.preventDefault();
            e.stopPropagation();
            closeConvActionsSheet();
            return;
        }

        const itemBtn = e.target.closest('.conv-actions-sheet-item');
        if (!itemBtn) return;

        e.preventDefault();
        e.stopPropagation();

        const action = itemBtn.dataset.action;
        const convId = currentActiveConvId;
        if (!convId) return;

        closeConvActionsSheet();

        // 延迟触发对应业务动作，使面板收起动画更自然
        setTimeout(() => {
            switch (action) {
                case 'pin':
                    handlePinConversation(convId);
                    break;
                case 'rename':
                    openConvTitleModal(convId);
                    break;
                case 'duplicate':
                    handleDuplicateConversation(convId);
                    break;
                case 'avatar':
                    openConversationAvatarModal(convId);
                    break;
                case 'export':
                    openExportConvModal(convId);
                    break;
                case 'delete':
                    handleDeleteConversation(convId);
                    break;
                default:
                    break;
            }
        }, 120);
    });

    // ESC 按键支持
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sheetOverlay && sheetOverlay.classList.contains('active')) {
            closeConvActionsSheet();
        }
    });

    return sheetOverlay;
}

/**
 * 打开会话操作底板
 * @param {string} convId - 会话ID
 */
export function openConvActionsSheet(convId) {
    if (!convId) return;
    currentActiveConvId = convId;

    const overlay = getOrCreateSheetOverlay();
    const conv = state.conversations[convId];
    if (!conv) return;

    // 更新标题文本
    const titleEl = overlay.querySelector('.conv-actions-sheet-title');
    if (titleEl) {
        titleEl.textContent = conv.title || '无标题会话';
        titleEl.title = conv.title || '无标题会话';
    }

    // 更新置顶按钮文本与图标状态
    const pinBtn = overlay.querySelector('[data-action="pin"]');
    if (pinBtn) {
        const pinText = pinBtn.querySelector('.action-text');
        if (conv.pinned) {
            if (pinText) pinText.textContent = '取消置顶';
            pinBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                <span class="action-text">取消置顶</span>
            `;
        } else {
            if (pinText) pinText.textContent = '置顶此对话';
            pinBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><polyline points="18 14 12 8 6 14"></polyline></svg>
                <span class="action-text">置顶此对话</span>
            `;
        }
    }

    // 激活显示
    overlay.classList.add('active');
}

/**
 * 关闭会话操作底板
 */
export function closeConvActionsSheet() {
    if (sheetOverlay) {
        sheetOverlay.classList.remove('active');
    }
    currentActiveConvId = null;
}
