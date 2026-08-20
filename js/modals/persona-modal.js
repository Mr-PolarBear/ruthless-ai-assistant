/**
 * @file persona-modal.js
 * @description Handles persona editing and management modals.
 */

import { dom } from '../dom.js?v=260820-1';
import { state } from '../state.js?v=260820-1';
import { renderPersonaModal } from '../ui-populator.js?v=260820-1';

// Re-export renderPersonaModal for consistency
export { renderPersonaModal };

export function openPersonaEditModal() {
    dom.personaEditModal.style.display = 'flex';
    dom.personaEditModal.classList.add('visible');
    const charCount = dom.personaEditPromptInput.value.length;
    const counter = document.getElementById('persona-edit-char-counter');
    if (counter) {
        counter.textContent = `${charCount} 字`;
    }
}

export function closePersonaEditModal() {
    dom.personaEditModal.classList.remove('visible');
}

export function resetPersonaEditForm() {
    dom.personaEditIdInput.value = '';
    dom.personaEditNameInput.value = '';
    dom.personaEditPromptInput.value = '';
    dom.personaEditFormTitle.textContent = '添加新角色';
    const counter = document.getElementById('persona-edit-char-counter');
    if (counter) {
        counter.textContent = '0 字';
    }
}

export function resetPersonaForm() {
    dom.personaIdInput.value = '';
    dom.personaNameInput.value = '';
    dom.personaPromptInput.value = '';
    dom.personaFormTitle.textContent = '添加新角色';
    dom.personaCancelBtn.style.display = 'none';
}

export function openPersonaModal() {
    renderPersonaModal();
    dom.personaModal.style.display = 'flex';
    dom.personaModal.classList.add('visible');
}
