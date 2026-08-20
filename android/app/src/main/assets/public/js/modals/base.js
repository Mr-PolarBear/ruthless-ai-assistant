/**
 * @file base.js
 * @description Base constants and shared state for modals.
 */

// 现代简约Material风格人形轮廓SVG，作为默认头像
export const DEFAULT_AVATAR =
    'data:image/svg+xml;utf8,' + encodeURIComponent('<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="#f3f4f6"/><circle cx="32" cy="26" r="12" fill="#b0b8c1"/><path d="M16 50c0-8.837 7.163-16 16-16s16 7.163 16 16" fill="#b0b8c1"/></svg>');

// 全局状态变量
export let avatarCropper = null;
export let convAvatarCropper = null;
export let currentFullAvatarUrl = null;
export let currentConversationIdForAvatar = null;

export let _editingMsgObj = null;
export let _editingMsgIndex = null;

// 设置器（供其他模块修改状态）
export function setAvatarCropper(cropper) { avatarCropper = cropper; window.avatarCropper = cropper; }
export function setConvAvatarCropper(cropper) { convAvatarCropper = cropper; window.convAvatarCropper = cropper; }
export function setCurrentFullAvatarUrl(url) { currentFullAvatarUrl = url; }
export function setCurrentConversationIdForAvatar(id) { currentConversationIdForAvatar = id; }
export function setEditingMsg(msg, index) { 
    _editingMsgObj = msg; 
    _editingMsgIndex = index;
    window._editingMsgObj = msg;
    window._editingMsgIndex = index;
}

// 暴露到全局（兼容旧代码）
window.avatarCropper = avatarCropper;
window.convAvatarCropper = convAvatarCropper;
window._editingMsgObj = _editingMsgObj;
window._editingMsgIndex = _editingMsgIndex;
