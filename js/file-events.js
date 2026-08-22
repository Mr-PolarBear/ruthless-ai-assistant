/**
 * @file file-events.js
 * @description Handles file-related events including uploads, attachments, avatars, and file operations.
 */

import { dom } from './dom.js?v=260820-1';
import { state, ALLOWED_FILE_TYPES } from './state.js?v=260820-1';
import { 
    showAttachmentPreviewMulti, showFileViewer, showMessageEditAttachmentPreview,
    showParsingPreview, openDocumentEditor
} from './attachment.js?v=260820-1';
import { 
    setupUserAvatarUI, setupConversationAvatarUI, closeCropModal, closeConvAvatarCropModal, 
    DEFAULT_AVATAR, currentConversationIdForAvatar
} from './modals.js?v=260820-1';
import { renderChatMessages } from './renderer.js?v=260820-1';
import { saveAppSettings, exportConfig, exportAllConversations, saveToLocalStorage } from './utils.js?v=260820-1';
import { saveAvatar, deleteAvatar, saveConversation } from './db.js?v=260820-1';
import { renderHistory } from './sidebar.js?v=260820-1';
// 乌鸦：导入文档解析服务
import { isDocumentFile, parseDocumentFile, getDocumentType, MAX_DOCUMENT_SIZE_BYTES } from './services/file-parser.js?v=260820-1';
// 乌鸦：导入通知与弹窗组件
import { notify, showErrorDialog } from './ui-updater.js?v=260820-1';
// 导入配置导出多选弹窗
import { openExportConfigModal, setupExportConfigModalEvents } from './modals/export-config-modal.js?v=260820-1';

/**
 * Sets up file-related event listeners
 */
export function setupFileEvents() {
    // File attachment events
    setupFileAttachmentEvents();

    // 乌鸦：设置聊天区文件拖拽上传事件
    setupDragAndDropEvents();

    // User avatar events
    setupUserAvatarEvents();

    // Conversation avatar events
    setupConversationAvatarEvents();

    // Message edit attachment events
    setupMessageEditAttachmentEvents();

    // Export events
    setupExportEvents();

    // Code download events
    setupCodeDownloadEvents();
}

/**
 * Sets up file attachment related events
 */
function setupFileAttachmentEvents() {
    // Attachment button click
    if (dom.attachmentBtn && dom.fileInput) {
        dom.attachmentBtn.onclick = (e) => {
            e.preventDefault();
            if (dom.fileInput.getAttribute('data-busy') === '1') return;
            dom.fileInput.setAttribute('data-busy', '1');
            dom.fileInput.click();
            setTimeout(() => dom.fileInput.removeAttribute('data-busy'), 500);
        };
    }

    // File input change
    if (dom.fileInput) {
        dom.fileInput.addEventListener('change', handleFileSelect);
    }

    // Attachment preview interactions
    if (dom.attachmentPreview) {
        dom.attachmentPreview.addEventListener('click', (e) => {
            // 乌鸦：修复预览按钮点击无反应 - 添加完整的事件处理
            const viewBtn = e.target.closest('.view-attachment-btn');
            const removeBtn = e.target.closest('.remove-attachment-btn');
            
            if (viewBtn) {
                e.stopPropagation();
                const idx = parseInt(viewBtn.dataset.idx);
                const file = state.attachedFiles[idx];
                if (file) {
                    showFileViewer(file.name, file.content, file.type);
                }
            } else if (e.target.closest('.edit-attachment-btn')) {
                // 乌鸦：编辑按钮 — 打开文档内容编辑弹窗
                e.stopPropagation();
                const idx = parseInt(e.target.closest('.edit-attachment-btn').dataset.idx);
                openDocumentEditor(idx, state.attachedFiles, showAttachmentPreviewMulti);
            } else if (removeBtn) {
                e.stopPropagation();
                const idx = parseInt(removeBtn.dataset.idx);
                state.attachedFiles.splice(idx, 1);
                showAttachmentPreviewMulti();
            }
        });
    }
}

/**
 * 乌鸦：设置聊天主区域文件拖拽上传事件（Drag & Drop）
 */
function setupDragAndDropEvents() {
    const dropZone = dom.chatDropZone || document.getElementById('chat-drop-zone');
    const mainChat = document.querySelector('main.main-chat');
    if (!dropZone || !mainChat) return;

    let dragCounter = 0; // 跟踪拖拽进入/离开计数，防止子节点引起的闪烁

    // 辅助函数：判断拖拽内容是否包含文件
    function hasFiles(e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return false;
        return Array.from(e.dataTransfer.types).includes('Files');
    }

    // 1. 在 mainChat 区域监听 dragenter
    mainChat.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        dropZone.classList.remove('hidden');
    });

    // 2. 在 mainChat 区域监听 dragover
    mainChat.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    });

    // 3. 在 mainChat 区域监听 dragleave
    mainChat.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropZone.classList.add('hidden');
        }
    });

    // 4. 在 mainChat 区域监听 drop
    mainChat.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropZone.classList.add('hidden');

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            handleFiles(files);
        }
    });

    // 5. 全局 window 级别的兜底防御：防止用户误拖到窗口边缘时浏览器直接打开文件
    window.addEventListener('dragover', (e) => {
        if (hasFiles(e)) {
            e.preventDefault();
        }
    });
    window.addEventListener('drop', (e) => {
        if (hasFiles(e)) {
            e.preventDefault();
            dragCounter = 0;
            dropZone.classList.add('hidden');
        }
    });
}

/**
 * Sets up user avatar related events
 */
function setupUserAvatarEvents() {
    // Setup avatar UI
    setupUserAvatarUI();

    // Avatar input change
    if (dom.userAvatarInput) {
        dom.userAvatarInput.addEventListener('change', handleUserAvatarInputChange);
    }

    // Avatar remove button
    if (dom.userAvatarRemoveBtn) {
        dom.userAvatarRemoveBtn.addEventListener('click', handleUserAvatarRemove);
    }

    // Avatar crop confirm
    if (dom.avatarCropConfirmBtn) {
        dom.avatarCropConfirmBtn.addEventListener('click', handleUserAvatarCropConfirm);
    }

    // Avatar crop cancel
    if (dom.avatarCropCancelBtn) {
        dom.avatarCropCancelBtn.addEventListener('click', closeCropModal);
    }
    if (dom.avatarCropCancelBtn2) {
        dom.avatarCropCancelBtn2.addEventListener('click', closeCropModal);
    }
}

/**
 * Sets up conversation avatar related events
 */
function setupConversationAvatarEvents() {
    // Setup conversation avatar UI
    setupConversationAvatarUI();

    // Conversation avatar input change
    if (dom.convAvatarInput) {
        dom.convAvatarInput.addEventListener('change', handleConversationAvatarInputChange);
    }

    // Conversation avatar remove
    if (dom.convAvatarRemoveBtn) {
        dom.convAvatarRemoveBtn.addEventListener('click', handleConversationAvatarRemove);
    }

    // Conversation avatar crop confirm
    if (dom.convAvatarCropConfirmBtn) {
        dom.convAvatarCropConfirmBtn.addEventListener('click', handleConversationAvatarCropConfirm);
    }

    // Conversation avatar crop cancel
    if (dom.convAvatarCropCancelBtn) {
        dom.convAvatarCropCancelBtn.addEventListener('click', closeConvAvatarCropModal);
    }
    if (dom.convAvatarCropCancelBtn2) {
        dom.convAvatarCropCancelBtn2.addEventListener('click', closeConvAvatarCropModal);
    }
}

/**
 * Sets up message edit attachment events
 */
function setupMessageEditAttachmentEvents() {
    if (dom.messageEditAttachmentPreview) {
        dom.messageEditAttachmentPreview.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.view-attachment-btn');
            const editBtn = e.target.closest('.edit-attachment-btn');
            const removeBtn = e.target.closest('.remove-attachment-btn');
            if (editBtn) {
                // 乌鸦：消息编辑弹窗中的文档内容编辑
                e.stopPropagation();
                const idx = parseInt(editBtn.getAttribute('data-idx'));
                openDocumentEditor(idx, window._editingMsgObj.attachments, () => {
                    showMessageEditAttachmentPreview(window._editingMsgObj.attachments, window._editingMsgRemovedAttachments);
                });
            } else if (viewBtn) {
                const idx = parseInt(viewBtn.getAttribute('data-idx'));
                const att = window._editingMsgObj.attachments[idx];
                showFileViewer(att.name, att.content);
            } else if (removeBtn) {
                const idx = parseInt(removeBtn.getAttribute('data-idx'));
                if (!window._editingMsgRemovedAttachments) window._editingMsgRemovedAttachments = [];
                if (!window._editingMsgRemovedAttachments.includes(idx)) window._editingMsgRemovedAttachments.push(idx);
                showMessageEditAttachmentPreview(window._editingMsgObj.attachments, window._editingMsgRemovedAttachments);
            }
        });
    }
}

/**
 * Sets up export related events
 */
function setupExportEvents() {
    setupExportConfigModalEvents();

    if (dom.exportConfigBtn) {
        dom.exportConfigBtn.addEventListener('click', openExportConfigModal);
    }
    
    if (dom.exportAllConversationsBtn) {
        dom.exportAllConversationsBtn.addEventListener('click', exportAllConversations);
    }
}

/**
 * Sets up code download events (placeholder for future implementation)
 */
function setupCodeDownloadEvents() {
    // This would handle code block download functionality
    // Implementation would depend on how code blocks are structured in the app
}

/**
 * 乌鸦：检查文件魔数（文件头字节）来真正验证文件类型
 * @param {File} file - 要检查的文件
 * @returns {Promise<boolean>} - 是否为真正的图片文件
 */
function checkFileSignature(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const buffer = new Uint8Array(e.target.result);
            
            // 乌鸦：检查常见图片格式的魔数
            const signatures = {
                // PNG: 89 50 4E 47 0D 0A 1A 0A
                png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
                // JPEG: FF D8 FF
                jpeg: [0xFF, 0xD8, 0xFF],
                // GIF87a: 47 49 46 38 37 61
                gif87a: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
                // GIF89a: 47 49 46 38 39 61
                gif89a: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
                // WebP: 52 49 46 46 xx xx xx xx 57 45 42 50
                webp: [0x52, 0x49, 0x46, 0x46]
            };
            
            // 乌鸦：检查PNG魔数
            if (buffer.length >= 8 && signatures.png.every((byte, i) => buffer[i] === byte)) {
                resolve(true);
                return;
            }
            
            // 乌鸦：检查JPEG魔数
            if (buffer.length >= 3 && signatures.jpeg.every((byte, i) => buffer[i] === byte)) {
                resolve(true);
                return;
            }
            
            // 乌鸦：检查GIF魔数
            if (buffer.length >= 6 && 
                (signatures.gif87a.every((byte, i) => buffer[i] === byte) ||
                 signatures.gif89a.every((byte, i) => buffer[i] === byte))) {
                resolve(true);
                return;
            }
            
            // 乌鸦：检查WebP魔数
            if (buffer.length >= 12 && 
                signatures.webp.every((byte, i) => buffer[i] === byte) &&
                buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
                resolve(true);
                return;
            }
            
            console.log('乌鸦安全检查 - 文件魔数验证失败:', file.name, 'hex:', Array.from(buffer.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            resolve(false);
        };
        reader.onerror = () => resolve(false);
        // 乌鸦：只读取前16字节用于魔数检查
        reader.readAsArrayBuffer(file.slice(0, 16));
    });
}

/**
 * 智能解码文本字节流：BOM 优先 → 严格 UTF-8 → GB18030 兜底
 * — 为什么这么写 —
 * 1. FileReader.readAsText 默认 UTF-8，遇到 Windows ANSI（中文系统下=GBK/GB18030）会乱码
 * 2. BOM 探测最可靠，优先级最高
 * 3. 严格 UTF-8（fatal:true）能识别无 BOM 的 UTF-8；GBK 多字节序列几乎必触发抛错
 * 4. 抛错后用 GB18030（GBK 超集）兜底，覆盖 ANSI 中文 txt 场景
 * 5. 浏览器原生 TextDecoder 支持 gb18030，无需第三方库，内网部署友好
 * @param {ArrayBuffer} buf - 文件原始字节流
 * @returns {{ text: string, encoding: string, fallback: boolean }} text=解码后文本; encoding=识别到的编码; fallback=是否走了兜底分支
 */
function decodeTextSmart(buf) {
    const bytes = new Uint8Array(buf);
    // 1. BOM 探测（最高优先级，零误判）
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        // UTF-8 with BOM：跳过 BOM 字节避免文本里残留 \uFEFF
        return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom', fallback: false };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', fallback: false };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', fallback: false };
    }
    // 2. 严格 UTF-8 试解（fatal:true 让非法字节抛 TypeError，便于切换分支）
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', fallback: false };
    } catch (_) {
        // 3. 兜底 GB18030（GBK 超集，覆盖 Windows ANSI 中文）
        try {
            return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030', fallback: true };
        } catch (e) {
            // 极端情况：浏览器不支持 gb18030（理论上不会发生），降级为非严格 UTF-8
            console.warn('小鸡：gb18030 解码失败，降级为非严格 UTF-8', e);
            return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'unknown', fallback: true };
        }
    }
}

/**
 * 乌鸦：统一处理文件数组（支持 input 选择与拖拽 drop）
 * 包含魔数校验、类型校验、大小限制、文档解析分流
 * @param {File[]} files - 文件对象列表
 */
export async function handleFiles(files) {
    if (!files || !files.length) return;

    if (!Array.isArray(state.attachedFiles)) state.attachedFiles = [];

    const defaultAllowedExtensions = ['txt', 'xml', 'js', 'py', 'html', 'css', 'json', 'md', 'csv', 'java', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'doc', 'pdf', 'xlsx', 'xls', 'et', 'pptx', 'wps'];
    const allowedExtensions = (dom.fileInput && dom.fileInput.accept)
        ? dom.fileInput.accept.split(',').map(ext => ext.trim().replace('.', ''))
        : defaultAllowedExtensions;
    const allowedTypes = typeof ALLOWED_FILE_TYPES !== 'undefined' ? ALLOWED_FILE_TYPES : [];

    let filesToAdd = [];
    let errorFiles = [];
    
    // 乌鸦：安全防护 - 文件大小限制（图片2MB，文本2MB，文档10MB）
    const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
    const MAX_TEXT_SIZE_BYTES = 2 * 1024 * 1024;

    try {
        for (let file of files) {
            const fileExtension = file.name.split('.').pop().toLowerCase();
            const declaredIsImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExtension);
            const actualIsImage = file.type.startsWith('image/');
            // 乌鸦：新增文档类型判断
            const declaredIsDocument = isDocumentFile(file.name);
            
            console.log(`乌鸦安全检查 - 文件: ${file.name}, 扩展名: ${fileExtension}, 是图片: ${declaredIsImage}, 是文档: ${declaredIsDocument}, MIME: ${file.type}`);
            
            // 乌鸦：对于声明为图片的文件，进行深度验证
            if (declaredIsImage) {
                const isRealImage = await checkFileSignature(file);
                if (!isRealImage) {
                    errorFiles.push(`${file.name} (安全警告：文件伪造，实际不是图片文件)`);
                    continue;
                }
            }
            
            // 乌鸦：如果是真正的图片但没有图片扩展名（排除文档类型）
            if (!declaredIsImage && !declaredIsDocument && actualIsImage) {
                errorFiles.push(`${file.name} (图片文件必须使用正确的图片扩展名)`);
                continue;
            }
            
            // 乌鸦：标准文件类型验证
            if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
                errorFiles.push(`${file.name} (不支持的文件类型)`);
                continue;
            }
            
            // 乌鸦：文件大小验证（文档类型用更宽松的限制）
            let maxSize;
            if (declaredIsDocument) {
                maxSize = MAX_DOCUMENT_SIZE_BYTES; // 10MB
            } else if (declaredIsImage) {
                maxSize = MAX_IMAGE_SIZE_BYTES;     // 2MB
            } else {
                maxSize = MAX_TEXT_SIZE_BYTES;       // 2MB
            }
            if (file.size > maxSize) {
                const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
                const limitMB = (maxSize / (1024 * 1024)).toFixed(0);
                errorFiles.push(`${file.name} (文件过大: ${sizeMB}MB, 最大允许${limitMB}MB)`);
                continue;
            }
            
            filesToAdd.push(file);
        }
        
        // 乌鸦：处理错误文件
        if (errorFiles.length) {
            const errorMsg = `发现问题文件：\n${errorFiles.join('\n')}\n\n支持的文件类型: ${allowedExtensions.join(', ')}\n文本/图片最大: 2MB，文档最大: 10MB`;
            alert(errorMsg);
            if (filesToAdd.length === 0) return;
        }
        
        // 乌鸦：处理通过验证的文件
        processValidFiles(filesToAdd);
    } catch (error) {
        console.error('乌鸦错误 - 文件处理失败:', error);
        alert('文件处理出错，请重试');
    }
}

/**
 * Handles file selection for attachments
 */
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    handleFiles(files).finally(() => {
        // 乌鸦：关键修复！重置 file-input 的 value，否则选择同一文件不会触发 change 事件
        if (dom.fileInput) {
            dom.fileInput.value = '';
        }
    });
}

/**
 * 乌鸦：处理通过验证的文件
 * 将文件分为普通文件（图片/文本）和文档文件（Word/PDF/Excel）两条路径处理
 */
function processValidFiles(filesToAdd) {
    // 乌鸦：分离文档文件和普通文件
    const documentFiles = filesToAdd.filter(f => isDocumentFile(f.name));
    const normalFiles = filesToAdd.filter(f => !isDocumentFile(f.name));

    // 乌鸦：处理普通文件（图片和文本，保持原有逻辑）
    let readCount = 0;
    const totalNormal = normalFiles.length;
    
    normalFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const actualIsImage = file.type.startsWith('image/');
            
            // 乌鸦：安全防护 - 验证Base64数据的合法性
            if (actualIsImage && e.target.result) {
                const base64Data = e.target.result;
                if (!base64Data.startsWith('data:image/')) {
                    alert(`文件 ${file.name} 不是有效的图片文件`);
                    readCount++;
                    if (readCount === totalNormal && documentFiles.length === 0) showAttachmentPreviewMulti();
                    return;
                }
                const allowedImageMimes = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/gif', 'data:image/webp'];
                if (!allowedImageMimes.some(mime => base64Data.startsWith(mime))) {
                    alert(`文件 ${file.name} 不是支持的图片格式`);
                    readCount++;
                    if (readCount === totalNormal && documentFiles.length === 0) showAttachmentPreviewMulti();
                    return;
                }
            }
            
            // 小鸡：图片走 DataURL 老路径；非图片用智能解码处理 ArrayBuffer，自动识别 UTF-8/GBK/UTF-16 等编码
            let finalContent = e.target.result;
            let detectedEncoding = null;
            if (!actualIsImage) {
                // — 为什么这么写 —
                // 1. e.target.result 此时是 ArrayBuffer（下面 readAsArrayBuffer 读出来的）
                // 2. decodeTextSmart 内部按 BOM → 严格 UTF-8 → GB18030 顺序识别，解决 ANSI 中文乱码
                // 3. 走兜底分支时 toast 提示用户，便于排查极端情况
                try {
                    const decoded = decodeTextSmart(e.target.result);
                    finalContent = decoded.text;
                    detectedEncoding = decoded.encoding;
                    if (decoded.fallback) {
                        // 兜底分支：非严格 UTF-8（多半是 GBK/ANSI），提示用户已自动转码
                        notify.warning(`文件 ${file.name} 非 UTF-8 编码（已按 ${decoded.encoding} 自动识别），如发现乱码请将文件另存为 UTF-8 后重新上传`, 5000);
                    }
                } catch (decodeErr) {
                    console.error('小鸡：文本解码失败', file.name, decodeErr);
                    notify.error(`文件 ${file.name} 编码识别失败，可能包含不支持的字符`, 4000);
                    readCount++;
                    if (readCount === totalNormal && documentFiles.length === 0) showAttachmentPreviewMulti();
                    return;
                }
            }

            state.attachedFiles.push({
                name: file.name,
                content: finalContent,
                type: file.type,
                size: file.size,
                isImage: actualIsImage,
                base64: actualIsImage ? e.target.result : null,
                // 小鸡：记录识别到的编码到附件元数据，便于调试和未来扩展（如查看器显示编码标签）
                encoding: detectedEncoding
            });
            readCount++;
            if (readCount === totalNormal && documentFiles.length === 0) showAttachmentPreviewMulti();
        };
        reader.onerror = () => notify.error(`读取文件 ${file.name} 时出错`, 4000);
        
        if (file.type.startsWith('image/')) {
            reader.readAsDataURL(file);
        } else {
            // 小鸡：改为读取原始字节，由 decodeTextSmart 智能识别编码（修复 ANSI/GBK txt 乱码）
            reader.readAsArrayBuffer(file);
        }
    });

    // 乌鸦：处理文档文件（Word/PDF/Excel）—— 异步解析流程
    if (documentFiles.length > 0) {
        processDocumentFiles(documentFiles);
    } else if (totalNormal === 0) {
        showAttachmentPreviewMulti();
    }
}

/**
 * 乌鸦：处理文档类型文件（Word/PDF/Excel）
 * 使用 file-parser.js 进行异步解析，解析期间锁定发送和会话切换
 * @param {File[]} documentFiles - 文档文件数组
 */
async function processDocumentFiles(documentFiles) {
    // 乌鸦：设置解析锁定状态
    state.isParsingFile = true;
    
    // 乌鸦：显示全局加载框
    const { showLoadingOverlay, hideLoadingOverlay } = await import('./ui-updater.js?v=260820-1');
    showLoadingOverlay();
    
    // 乌鸦：立即显示解析中的预览状态
    showParsingPreview(documentFiles.map(f => f.name));
    
    let parseErrors = [];
    
    // 乌鸦：逐个解析文档文件
    for (const file of documentFiles) {
        try {
            console.log(`乌鸦：开始解析文档 [${file.name}]...`);
            const result = await parseDocumentFile(file);
            
            // 乌鸦：解析成功，将提取的纯文本作为附件存入
            state.attachedFiles.push({
                name: file.name,
                content: result.text,          // 乌鸦：提取出的纯文本
                type: 'text/plain',            // 乌鸦：标记为已解析的文本
                size: file.size,
                isImage: false,
                isDocument: true,              // 乌鸦：文档标记，用于 UI 显示专属图标
                documentType: getDocumentType(file.name),
                originalType: file.type,
                charCount: result.charCount,
                truncated: result.truncated,
                parseTimeMs: result.parseTimeMs
            });
            
            console.log(`乌鸦：文档解析成功 [${file.name}]，${result.charCount}字，耗时${result.parseTimeMs}ms`);
        } catch (error) {
            console.error(`乌鸦：文档解析失败 [${file.name}]:`, error);
            parseErrors.push(`${file.name}: ${error.message}`);
        }
    }
    
    // 乌鸦：隐藏全局加载框
    hideLoadingOverlay();
    
    // 乌鸦：解除解析锁定
    state.isParsingFile = false;
    
    // 乌鸦：显示解析错误/引导提示（使用持久模态弹窗，避免 Toast 3秒自动消失导致用户无法读完）
    if (parseErrors.length > 0) {
        showErrorDialog('文件解析提示', parseErrors.join('\n\n'));
    }
    
    // 乌鸦：刷新附件预览区
    showAttachmentPreviewMulti();
}

/**
 * Handles user avatar input change
 */
function handleUserAvatarInputChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 限制头像文件大小为5MB
    const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
        alert('头像文件大小不能超过5MB！');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        // 清空modal-body，确保每次只加载一张图片
        dom.avatarCropModal.querySelector('.modal-body').innerHTML = '';

        const newImg = document.createElement('img');
        newImg.id = 'avatar-crop-image';
        newImg.style.cssText = 'max-width:100%;max-height:300px;display:block;margin:0 auto;';
        dom.avatarCropModal.querySelector('.modal-body').appendChild(newImg);
        dom.avatarCropImage = newImg;

        dom.avatarCropImage.src = '';
        dom.avatarCropImage.src = e.target.result;
        dom.avatarCropModal.style.display = 'flex';
        dom.avatarCropModal.classList.add('visible');

        // 确保图片加载完成后再初始化Cropper
        dom.avatarCropImage.onload = () => {
            if (window.avatarCropper) {
                window.avatarCropper.destroy();
            }
            window.avatarCropper = new Cropper(dom.avatarCropImage, {
                aspectRatio: 1,
                viewMode: 1,
                background: false,
                autoCropArea: 0.8,
            });
        };
    };
    reader.readAsDataURL(file);
}

/**
 * Handles user avatar removal
 */
async function handleUserAvatarRemove() {
    if (confirm('确定要删除您的头像吗？')) {
        const avatarId = state.appSettings.userAvatar?.id;
        if (state.appSettings.userAvatar && state.appSettings.userAvatar.type === 'indexeddb') {
            await deleteAvatar(avatarId);
        }
        
        // 从缓存中移除并释放URL
        if (avatarId && state.avatarUrlCache.has(avatarId)) {
            const url = state.avatarUrlCache.get(avatarId);
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
            state.avatarUrlCache.delete(avatarId);
        }

        state.appSettings.userAvatar = null;
        saveAppSettings();
        setupUserAvatarUI();
        renderChatMessages();
    }
}

/**
 * Handles user avatar crop confirmation
 */
async function handleUserAvatarCropConfirm() {
    if (!window.avatarCropper || !window.avatarCropper.ready) {
        alert('裁剪器尚未准备好，请稍候。');
        return;
    }

    const getCroppedBlob = (cropper, width, height) => {
        return new Promise((resolve, reject) => {
            cropper.getCroppedCanvas({ width, height }).toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('无法生成裁剪后的图片Blob。'));
                }
            }, 'image/png');
        });
    };

    try {
        // 先删除旧头像
        const oldAvatarId = state.appSettings.userAvatar?.id;
        if (oldAvatarId) {
            await deleteAvatar(oldAvatarId);
        }

        const [fullBlob, thumbBlob] = await Promise.all([
            getCroppedBlob(window.avatarCropper, 1000, 1000),
            getCroppedBlob(window.avatarCropper, 200, 200)
        ]);

        const avatarId = `user_avatar_${Date.now()}`;
        
        await saveAvatar(avatarId, fullBlob, thumbBlob); 

        state.appSettings.userAvatar = { type: 'indexeddb', id: avatarId };
        saveAppSettings();
        setupUserAvatarUI();
        renderChatMessages();
        closeCropModal();

    } catch (error) {
        console.error('处理头像裁剪和保存时出错:', error);
        alert('无法裁剪或保存图片，请重试。');
    }
}

/**
 * Handles conversation avatar input change
 */
async function handleConversationAvatarInputChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
        alert('头像文件大小不能超过5MB！');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        dom.convAvatarCropModal.querySelector('.modal-body').innerHTML = '';

        const newImg = document.createElement('img');
        newImg.id = 'conv-avatar-crop-image';
        newImg.style.cssText = 'max-width:100%;max-height:300px;display:block;margin:0 auto;';
        dom.convAvatarCropModal.querySelector('.modal-body').appendChild(newImg);
        dom.convAvatarCropImage = newImg;

        dom.convAvatarCropImage.src = '';
        dom.convAvatarCropImage.src = e.target.result;
        dom.convAvatarCropModal.style.display = 'flex';
        dom.convAvatarCropModal.classList.add('visible');

        dom.convAvatarCropImage.onload = () => {
            if (window.convAvatarCropper) {
                window.convAvatarCropper.destroy();
            }
            window.convAvatarCropper = new Cropper(dom.convAvatarCropImage, {
                aspectRatio: 1,
                viewMode: 1,
                background: false,
                autoCropArea: 0.8,
            });
        };
    };
    reader.readAsDataURL(file);
}

/**
 * Handles conversation avatar removal
 */
async function handleConversationAvatarRemove() {
    if (!currentConversationIdForAvatar) return;

    if (confirm('确定要删除当前会话的头像吗？')) {
        const conv = state.conversations[currentConversationIdForAvatar];
        const avatarId = conv?.avatar?.id;

        if (conv && conv.avatar && conv.avatar.type === 'indexeddb') {
            await deleteAvatar(avatarId);
        }

        if (avatarId && state.avatarUrlCache.has(avatarId)) {
            const url = state.avatarUrlCache.get(avatarId);
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
            state.avatarUrlCache.delete(avatarId);
        }

        if (conv) {
            conv.avatar = null;
            saveConversation(currentConversationIdForAvatar, conv);
            saveToLocalStorage();
            renderChatMessages();
            renderHistory();
            dom.convAvatarPreview.src = DEFAULT_AVATAR;
            dom.convAvatarStatus.textContent = '未设置头像';
            dom.convAvatarRemoveBtn.style.display = 'none';
        }
    }
}

/**
 * Handles conversation avatar crop confirmation
 */
async function handleConversationAvatarCropConfirm() {
    if (!currentConversationIdForAvatar) return;
    if (!window.convAvatarCropper || !window.convAvatarCropper.ready) {
        alert('裁剪器尚未准备好，请稍候。');
        return;
    }

    const getCroppedBlob = (cropper, width, height) => {
        return new Promise((resolve, reject) => {
            cropper.getCroppedCanvas({ width, height }).toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('无法生成裁剪后的图片Blob。'));
                }
            }, 'image/png');
        });
    };

    try {
        const conv = state.conversations[currentConversationIdForAvatar];
        if (!conv) {
            alert('找不到当前会话！');
            return;
        }

        const oldAvatarId = conv.avatar?.id;
        if (oldAvatarId) {
            await deleteAvatar(oldAvatarId);
        }

        const [fullBlob, thumbBlob] = await Promise.all([
            getCroppedBlob(window.convAvatarCropper, 1000, 1000),
            getCroppedBlob(window.convAvatarCropper, 200, 200)
        ]);

        const avatarId = `conv_avatar_${currentConversationIdForAvatar}_${Date.now()}`;
        
        await saveAvatar(avatarId, fullBlob, thumbBlob);

        conv.avatar = { type: 'indexeddb', id: avatarId };
        await saveConversation(currentConversationIdForAvatar, conv);
        saveToLocalStorage();
        renderChatMessages();
        renderHistory();
        
        const thumbUrl = URL.createObjectURL(thumbBlob);
        dom.convAvatarPreview.src = thumbUrl;

        dom.convAvatarStatus.textContent = '已设置头像';
        dom.convAvatarRemoveBtn.style.display = 'inline-block';
        
        closeConvAvatarCropModal();

    } catch (error) {
        console.error('处理会话头像裁剪和保存时出错:', error);
        alert('无法裁剪或保存图片，请重试。');
    }
}