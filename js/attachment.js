/**
 * @file attachment.js
 * @description Manages UI for file attachments, including previews and viewers.
 */

import { dom } from './dom.js?v=260820-1';
import { state } from './state.js?v=260820-1';
import { escapeHtml } from './utils.js?v=260820-1';
// 乌鸦：导入文档类型和图标方法
import { getDocumentIcon } from './services/file-parser.js?v=260820-1';

// ======================== 乌鸦：统一风格 SVG 图标常量 ========================

/**
 * 乌鸦：文档类型 SVG 图标（统一 16x16 尺寸，统一风格）
 * 每个图标用不同颜色区分文件类型
 */
const DOC_ICON_SVG = {
    // Word 文档 - 蓝色
    word: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="margin-right:5px;flex-shrink:0;"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="#4285F4" opacity="0.15"/><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="none" stroke="#4285F4" stroke-width="1"/><path d="M9.5 0v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="none" stroke="#4285F4" stroke-width="1"/><text x="8" y="11.5" text-anchor="middle" fill="#4285F4" font-size="5" font-weight="bold" font-family="Arial">W</text></svg>',
    // PDF 文档 - 红色
    pdf: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="margin-right:5px;flex-shrink:0;"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="#EA4335" opacity="0.15"/><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="none" stroke="#EA4335" stroke-width="1"/><path d="M9.5 0v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="none" stroke="#EA4335" stroke-width="1"/><text x="8" y="11.5" text-anchor="middle" fill="#EA4335" font-size="4.5" font-weight="bold" font-family="Arial">PDF</text></svg>',
    // Excel 文档 - 绿色
    excel: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="margin-right:5px;flex-shrink:0;"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="#34A853" opacity="0.15"/><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="none" stroke="#34A853" stroke-width="1"/><path d="M9.5 0v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="none" stroke="#34A853" stroke-width="1"/><text x="8" y="11.5" text-anchor="middle" fill="#34A853" font-size="4.5" font-weight="bold" font-family="Arial">XLS</text></svg>',
    // PPTX 文档 - 橙色
    pptx: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="margin-right:5px;flex-shrink:0;"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="#FBBC04" opacity="0.15"/><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4z" fill="none" stroke="#FBBC04" stroke-width="1"/><path d="M9.5 0v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="none" stroke="#FBBC04" stroke-width="1"/><text x="8" y="11.5" text-anchor="middle" fill="#E8A000" font-size="4.5" font-weight="bold" font-family="Arial">PPT</text></svg>',
    // 普通文本文件 - 灰色回形针
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;flex-shrink:0;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>'
};

// 乌鸦：通用操作按钮 SVG（查看/编辑），14x14 与系统图标风格统一
const VIEW_BTN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
const EDIT_BTN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';

/**
 * 乌鸦：获取文档类型的 SVG 图标
 * @param {string} docType - 文档类型标识
 * @returns {string} SVG HTML 字符串
 */
function getDocumentSvgIcon(docType) {
    return DOC_ICON_SVG[docType] || DOC_ICON_SVG.text;
}

// ======================== 基础功能 ========================

/**
 * @deprecated since multi-file support. Use showAttachmentPreviewMulti instead.
 * Shows a preview for a single attached file.
 * @param {string} fileName - The name of the file.
 */
export function showAttachmentPreview(fileName) {
    dom.attachmentPreview.innerHTML = `
        <span id="attachment-name" title="${fileName}">${fileName}</span>
        <button id="remove-attachment-btn" title="移除附件">&times;</button>
    `;
    dom.attachmentPreview.classList.add('visible');
}

/**
 * Displays the file viewer modal with the content of a file.
 * @param {string} fileName - The name of the file to display.
 * @param {string} fileContent - The content of the file.
 * @param {string} [fileType] - The MIME type of the file.
 */
export function showFileViewer(fileName, fileContent, fileType) {
    dom.fileViewerTitle.textContent = fileName;
    
    // 乌鸦：判断是否为图片文件
    const isImage = fileType?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/i.test(fileName);
    
    if (isImage) {
        // 乌鸦：图片显示
        const imgEl = document.createElement('img');
        imgEl.src = fileContent;
        imgEl.alt = fileName;
        imgEl.style.cssText = 'max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px;';
        
        dom.fileViewerContent.innerHTML = '';
        dom.fileViewerContent.appendChild(imgEl);
    } else {
        // 乌鸦：文本文件显示
        const codeEl = document.createElement('code');
        const lang = fileName.split('.').pop();
        
        // 检查 highlight.js 是否支持该语言
        if (window.hljs && window.hljs.getLanguage(lang)) {
            codeEl.className = `language-${lang}`;
        }
        codeEl.textContent = fileContent;
        const preEl = document.createElement('pre');
        preEl.appendChild(codeEl);

        dom.fileViewerContent.innerHTML = '';
        dom.fileViewerContent.appendChild(preEl);

        // 确保 hljs 已经被加载
        if (window.hljs) {
            window.hljs.highlightElement(codeEl);
        }
    }

    // 乌鸦：关键修复！同时设置 display 和 visible 类
    dom.fileViewerModal.style.display = 'flex';
    dom.fileViewerModal.classList.add('visible');
}

/**
 * Clears all attached files from the state and UI.
 */
export function clearAttachment() {
    // 乌鸦：安全清理 - 释放可能的Blob URL引用
    if (Array.isArray(state.attachedFiles)) {
        state.attachedFiles.forEach(file => {
            // 乌鸦：如果有Blob URL，释放它们以防止内存泄漏
            if (file.content && file.content.startsWith('blob:')) {
                URL.revokeObjectURL(file.content);
            }
            if (file.base64 && file.base64.startsWith('blob:')) {
                URL.revokeObjectURL(file.base64);
            }
        });
    }
    
    state.attachedFiles = [];
    dom.fileInput.value = ''; // 重置文件输入框
    dom.attachmentPreview.classList.remove('visible');
    dom.attachmentPreview.innerHTML = '';
}

// ======================== 附件预览区 ========================

/**
 * Renders the preview area for multiple attached files.
 */
export function showAttachmentPreviewMulti() {
    if (!Array.isArray(state.attachedFiles) || state.attachedFiles.length === 0) {
        dom.attachmentPreview.classList.remove('visible');
        dom.attachmentPreview.innerHTML = '';
        return;
    }
    
    dom.attachmentPreview.innerHTML = state.attachedFiles.map((f, idx) => {
        // 乌鸦：为图片附件添加特殊显示
        const isImage = f.isImage || f.type?.startsWith('image/');
        // 乌鸦：判断是否为已解析的文档文件
        const isDocument = f.isDocument || false;
        // 乌鸦：安全防护 - 转义文件名防止XSS攻击
        const safeName = escapeHtml(f.name);
        const displayName = safeName.length > 20 ? safeName.slice(0, 20) + '...' : safeName;
        const sizeDisplay = f.size ? `(${(f.size / 1024).toFixed(1)}KB)` : '';
        // 乌鸦：文档类型显示已解析字符数
        const docInfo = isDocument ? ` | 已解析为文本 (${f.charCount || 0}字)` : '';
        const titleText = `${safeName}${sizeDisplay}${docInfo}`;
        
        // 乌鸦：直接可见的大小/字数标签（不再隐藏在 title 里）
        let sizeBadge = '';
        if (isDocument) {
            sizeBadge = `<span style="color:var(--text-muted);font-size:0.8em;margin-left:2px;">${f.charCount || 0}字</span>`;
        } else if (isImage) {
            const kb = f.size ? (f.size / 1024).toFixed(0) : '?';
            sizeBadge = `<span style="color:var(--text-muted);font-size:0.8em;margin-left:2px;">${kb}KB</span>`;
        } else if (f.content) {
            sizeBadge = `<span style="color:var(--text-muted);font-size:0.8em;margin-left:2px;">${f.content.length}字</span>`;
        }
        
        // 乌鸦：根据文件类型选择 SVG 图标
        let iconHtml;
        if (isImage) {
            iconHtml = `<img src="${f.base64 || f.content}" alt="${safeName}" class="attachment-thumbnail" style="width:20px;height:20px;object-fit:cover;border-radius:3px;margin-right:5px;flex-shrink:0;">`;
        } else if (isDocument) {
            iconHtml = getDocumentSvgIcon(f.documentType);
        } else {
            iconHtml = DOC_ICON_SVG.text;
        }
        
        // 乌鸦：文档类型附件额外显示编辑按钮（允许用户修改解析结果）
        const editBtn = isDocument
            ? `<button class="edit-attachment-btn" data-idx="${idx}" title="编辑内容">${EDIT_BTN_SVG}</button>`
            : '';
        
        return `<span class="attachment-item ${isImage ? 'attachment-image' : ''}" title="${titleText}">
            ${iconHtml}
            <span class="attachment-filename">${displayName}</span>
            ${sizeBadge}
            <button class="view-attachment-btn" data-idx="${idx}" title="查看">${VIEW_BTN_SVG}</button>
            ${editBtn}
            <button class="remove-attachment-btn" data-idx="${idx}" title="移除">&times;</button>
        </span>`;
    }).join('');
    
    dom.attachmentPreview.classList.add('visible');
}

/**
 * Renders the attachment preview area within the message edit modal.
 * @param {Array<Object>} attachments - The list of attachment objects.
 * @param {Array<number>} [removedIdxArr=[]] - An array of indices of attachments marked for removal.
 */
export function showMessageEditAttachmentPreview(attachments, removedIdxArr = []) {
    const container = dom.messageEditAttachmentPreview;
    if (!Array.isArray(attachments) || attachments.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.innerHTML = attachments.map((f, idx) => {
        if (removedIdxArr && removedIdxArr.includes(idx)) return '';
        
        const safeName = escapeHtml(f.name);
        const displayName = safeName.length > 20 ? safeName.slice(0, 20) + '...' : safeName;
        const isDocument = f.isDocument || false;
        
        // 乌鸦：文档类型使用 SVG 图标
        let iconHtml;
        if (isDocument) {
            iconHtml = getDocumentSvgIcon(f.documentType);
        } else {
            iconHtml = '';
        }
        
        // 乌鸦：文档类型附件显示编辑按钮
        const editBtn = isDocument
            ? `<button class="edit-attachment-btn" data-idx="${idx}" title="编辑内容">${EDIT_BTN_SVG}</button>`
            : '';
        
        return `<span class="attachment-item" title="${safeName}">
            ${iconHtml}
            <span class="attachment-filename">${displayName}</span>
            <button class="view-attachment-btn" data-idx="${idx}" title="查看">${VIEW_BTN_SVG}</button>
            ${editBtn}
            <button class="remove-attachment-btn" data-idx="${idx}" title="移除">&times;</button>
        </span>`;
    }).join('');
    container.style.display = 'grid';
}

// ======================== 解析中预览 ========================

/**
 * 乌鸦：显示文档解析中的预览状态
 * 在文件正在被解析时，显示带旋转动画的 loading 状态
 * @param {string[]} fileNames - 正在解析的文件名列表
 */
export function showParsingPreview(fileNames) {
    if (!Array.isArray(fileNames) || fileNames.length === 0) return;
    
    // 乌鸦：生成解析中的预览项（已有的附件 + 正在解析的文件）
    const existingHtml = Array.isArray(state.attachedFiles) ? state.attachedFiles.map((f, idx) => {
        const safeName = escapeHtml(f.name);
        const displayName = safeName.length > 20 ? safeName.slice(0, 20) + '...' : safeName;
        return `<span class="attachment-item" title="${safeName}">
            ${DOC_ICON_SVG.text}
            <span class="attachment-filename">${displayName}</span>
        </span>`;
    }).join('') : '';
    
    // 乌鸦：正在解析的文件显示旋转加载图标
    const parsingHtml = fileNames.map(name => {
        const safeName = escapeHtml(name);
        const displayName = safeName.length > 20 ? safeName.slice(0, 20) + '...' : safeName;
        return `<span class="attachment-item parsing-item" title="${safeName} - 解析中...">
            <span class="parsing-spinner" style="margin-right:5px;display:inline-block;animation:spin 1s linear infinite;">⏳</span>
            <span class="attachment-filename">${displayName}</span>
            <span style="color:var(--text-muted);font-size:0.85em;margin-left:4px;">解析中...</span>
        </span>`;
    }).join('');
    
    dom.attachmentPreview.innerHTML = existingHtml + parsingHtml;
    dom.attachmentPreview.classList.add('visible');
    
    // 乌鸦：注入旋转动画样式（如果尚未注入）
    if (!document.getElementById('parsing-spinner-style')) {
        const style = document.createElement('style');
        style.id = 'parsing-spinner-style';
        style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
    }
}

// ======================== 文档内容编辑 ========================

/**
 * 乌鸦：打开文档内容编辑弹窗
 * 允许用户修改文档解析后的文本内容（修正 OCR 错误等）
 * 
 * @param {number} idx - 附件在数组中的索引
 * @param {Array} filesArray - 附件数组引用（state.attachedFiles 或 window._editingMsgObj.attachments）
 * @param {Function} [refreshCallback] - 编辑完成后刷新预览的回调
 */
export function openDocumentEditor(idx, filesArray, refreshCallback) {
    const file = filesArray[idx];
    if (!file || !file.isDocument) return;
    
    // 乌鸦：创建编辑弹窗（复用 file-viewer-modal 的样式结构）
    let overlay = document.getElementById('doc-editor-overlay');
    if (overlay) overlay.remove(); // 防止重复创建
    
    overlay = document.createElement('div');
    overlay.id = 'doc-editor-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    const safeName = escapeHtml(file.name);
    const charCount = file.content ? file.content.length : 0;
    
    overlay.innerHTML = `
        <div style="
            background: var(--bg-primary, #fff); border-radius: 12px;
            width: 90%; max-width: 700px; max-height: 85vh;
            display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        ">
            <div style="
                display: flex; align-items: center; justify-content: space-between;
                padding: 16px 20px; border-bottom: 1px solid var(--border-color, #e0e0e0);
            ">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${getDocumentSvgIcon(file.documentType)}
                    <span style="font-weight:600;font-size:15px;color:var(--text-primary);">${safeName}</span>
                    <span id="doc-editor-charcount" style="font-size:12px;color:var(--text-muted);margin-left:8px;">${charCount}字</span>
                </div>
                <button id="doc-editor-close" style="
                    background:none;border:none;font-size:22px;cursor:pointer;
                    color:var(--text-secondary);padding:4px 8px;border-radius:4px;
                " title="关闭">&times;</button>
            </div>
            <textarea id="doc-editor-textarea" style="
                flex: 1; padding: 16px 20px; border: none; outline: none;
                font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; line-height: 1.6;
                resize: none; background: var(--bg-primary, #fff);
                color: var(--text-primary); min-height: 300px;
            ">${escapeHtml(file.content || '')}</textarea>
            <div style="
                display: flex; align-items: center; justify-content: flex-end; gap: 10px;
                padding: 12px 20px; border-top: 1px solid var(--border-color, #e0e0e0);
            ">
                <button id="doc-editor-cancel" style="
                    padding: 8px 20px; border-radius: 6px; border: 1px solid var(--border-color, #ccc);
                    background: var(--bg-secondary, #f5f5f5); color: var(--text-secondary);
                    cursor: pointer; font-size: 14px;
                ">取消</button>
                <button id="doc-editor-save" style="
                    padding: 8px 20px; border-radius: 6px; border: none;
                    background: var(--accent-color, #4285F4); color: #fff;
                    cursor: pointer; font-size: 14px; font-weight: 500;
                ">保存修改</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    const textarea = document.getElementById('doc-editor-textarea');
    const charCountEl = document.getElementById('doc-editor-charcount');
    
    // 乌鸦：实时更新字符数
    textarea.addEventListener('input', () => {
        charCountEl.textContent = `${textarea.value.length}字`;
    });
    
    // 乌鸦：保存按钮 — 将编辑后的内容写回附件
    document.getElementById('doc-editor-save').addEventListener('click', () => {
        const newContent = textarea.value;
        filesArray[idx].content = newContent;
        filesArray[idx].charCount = newContent.length;
        overlay.remove();
        
        // 乌鸦：刷新预览
        if (typeof refreshCallback === 'function') {
            refreshCallback();
        }
    });
    
    // 乌鸦：取消/关闭按钮
    const closeEditor = () => overlay.remove();
    document.getElementById('doc-editor-cancel').addEventListener('click', closeEditor);
    document.getElementById('doc-editor-close').addEventListener('click', closeEditor);
    
    // 乌鸦：点击遮罩层关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeEditor();
    });
    
    // 乌鸦：ESC 键关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeEditor();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
