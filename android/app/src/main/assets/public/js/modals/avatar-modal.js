/**
 * @file avatar-modal.js
 * @description Handles avatar management, cropping, and preview.
 */

import { dom } from '../dom.js';
import { state } from '../state.js';
import { getAvatar } from '../db.js';
import { 
    DEFAULT_AVATAR, 
    avatarCropper, setAvatarCropper,
    convAvatarCropper, setConvAvatarCropper,
    currentFullAvatarUrl, setCurrentFullAvatarUrl,
    setCurrentConversationIdForAvatar
} from './base.js';

export function setupUserAvatarUI() {
    if (state.appSettings.userAvatar && state.appSettings.userAvatar.type === 'indexeddb') {
        const avatarId = state.appSettings.userAvatar.id;
        
        if (state.avatarUrlCache && state.avatarUrlCache.has(avatarId)) {
            dom.userAvatarPreview.src = state.avatarUrlCache.get(avatarId);
        } else {
            getAvatar(avatarId).then(blob => {
                if (blob) {
                    if (state.avatarUrlCache && state.avatarUrlCache.has(avatarId)) {
                        const oldUrl = state.avatarUrlCache.get(avatarId);
                        if (oldUrl && oldUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(oldUrl);
                        }
                    }
                    
                    const newUrl = URL.createObjectURL(blob);
                    if (!state.avatarUrlCache) {
                        state.avatarUrlCache = new Map();
                    }
                    state.avatarUrlCache.set(avatarId, newUrl);
                    dom.userAvatarPreview.src = newUrl;
                } else {
                    dom.userAvatarPreview.src = DEFAULT_AVATAR;
                }
            }).catch(error => {
                console.error('加载用户头像失败:', error);
                dom.userAvatarPreview.src = DEFAULT_AVATAR;
            });
        }
        
        dom.userAvatarRemoveBtn.style.opacity = '1';
        dom.userAvatarRemoveBtn.style.cursor = 'pointer';
        dom.userAvatarRemoveBtn.disabled = false;
    } else {
        dom.userAvatarPreview.src = DEFAULT_AVATAR;
        dom.userAvatarRemoveBtn.style.opacity = '0.5';
        dom.userAvatarRemoveBtn.style.cursor = 'not-allowed';
        dom.userAvatarRemoveBtn.disabled = true;
    }
}

export function closeCropModal() {
    dom.avatarCropModal.style.display = 'none';
    dom.avatarCropModal.classList.remove('visible');
    if (avatarCropper) {
        avatarCropper.destroy();
        setAvatarCropper(null);
    }
}

export function openConversationAvatarModal(convId) {
    const conv = state.conversations[convId];
    if (!conv) return;
    setCurrentConversationIdForAvatar(convId);

    dom.convAvatarInput.value = '';

    if (conv.avatar && conv.avatar.type === 'indexeddb') {
        const avatarId = conv.avatar.id;
        
        if (state.avatarUrlCache && state.avatarUrlCache.has(avatarId)) {
            dom.convAvatarPreview.src = state.avatarUrlCache.get(avatarId);
        } else {
            getAvatar(avatarId).then(blob => {
                if (blob) {
                    if (state.avatarUrlCache && state.avatarUrlCache.has(avatarId)) {
                        const oldUrl = state.avatarUrlCache.get(avatarId);
                        if (oldUrl && oldUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(oldUrl);
                        }
                    }
                    
                    const newUrl = URL.createObjectURL(blob);
                    if (!state.avatarUrlCache) {
                        state.avatarUrlCache = new Map();
                    }
                    state.avatarUrlCache.set(avatarId, newUrl);
                    dom.convAvatarPreview.src = newUrl;
                } else {
                    dom.convAvatarPreview.src = DEFAULT_AVATAR;
                }
            }).catch(error => {
                console.error('加载会话头像失败:', error);
                dom.convAvatarPreview.src = DEFAULT_AVATAR;
            });
        }
        
        dom.convAvatarStatus.textContent = '已设置头像';
        dom.convAvatarRemoveBtn.style.display = 'inline-block';
    } else {
        dom.convAvatarPreview.src = DEFAULT_AVATAR;
        dom.convAvatarStatus.textContent = '未设置头像';
        dom.convAvatarRemoveBtn.style.display = 'none';
    }

    dom.conversationAvatarModal.style.display = 'flex';
    dom.conversationAvatarModal.classList.add('visible');
}

export function closeConversationAvatarModal() {
    dom.conversationAvatarModal.style.display = 'none';
    dom.conversationAvatarModal.classList.remove('visible');
    setCurrentConversationIdForAvatar(null);
}

export function setupConversationAvatarUI() {
    // Event listeners are in events.js
}

export function closeConvAvatarCropModal() {
    dom.convAvatarCropModal.style.display = 'none';
    dom.convAvatarCropModal.classList.remove('visible');
    if (convAvatarCropper) {
        convAvatarCropper.destroy();
        setConvAvatarCropper(null);
    }
}

export async function openAvatarPreview(source, type) {
    if (!source) return;

    dom.avatarPreviewImg.src = DEFAULT_AVATAR;
    dom.avatarPreviewModal.style.display = 'flex';
    dom.avatarPreviewModal.classList.add('visible');

    if (type === 'indexeddb') {
        try {
            const blob = await getAvatar(source, 'full');
            if (blob) {
                const url = URL.createObjectURL(blob);
                setCurrentFullAvatarUrl(url);
                dom.avatarPreviewImg.src = url;
            } else {
                dom.avatarPreviewImg.src = DEFAULT_AVATAR;
            }
        } catch (error) {
            console.error('加载头像大图失败:', error);
            dom.avatarPreviewImg.src = DEFAULT_AVATAR;
        }
    } else {
        dom.avatarPreviewImg.src = source;
    }
}

export function closeAvatarPreview() {
    dom.avatarPreviewModal.style.display = 'none';
    dom.avatarPreviewModal.classList.remove('visible');
    dom.avatarPreviewImg.src = '';

    if (currentFullAvatarUrl) {
        URL.revokeObjectURL(currentFullAvatarUrl);
        setCurrentFullAvatarUrl(null);
    }
}
