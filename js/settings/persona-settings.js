/**
 * @file persona-settings.js
 * @description Handles Persona settings events.
 */

import { dom } from '../dom.js?v=260823';
import { state } from '../state.js?v=260823';
import { saveToLocalStorage } from '../utils.js?v=260823';
import { 
    renderPersonaModal, populatePersonaSelector, resetPersonaForm,
    openPersonaModal, openPersonaEditModal, closePersonaEditModal,
    resetPersonaEditForm
} from '../modals.js?v=260823';
import { closeModalWithAnimation } from '../modal-events.js?v=260823';
import { DraggableList } from '../draggable-list.js?v=260823';

let lastPersonaCopyTime = 0;
let personaDragInstance = null;

export function setupPersonaEvents() {
    if (dom.managePersonasBtn) dom.managePersonasBtn.addEventListener('click', openPersonaModal);
    if (dom.personaSaveBtn) dom.personaSaveBtn.addEventListener('click', savePersona);
    if (dom.personaCancelBtn) dom.personaCancelBtn.addEventListener('click', resetPersonaForm);
    if (dom.personaList) {
        dom.personaList.addEventListener('click', handlePersonaListActions);
        
        if (personaDragInstance) {
            personaDragInstance.destroy();
        }
        personaDragInstance = new DraggableList(dom.personaList, {
            itemSelector: '.persona-item',
            onDrop: (fromIndex, toIndex) => {
                const personas = Object.values(state.personas)
                    .map(p => {
                        if (typeof p.sort !== 'number') {
                            p.sort = 0;
                        }
                        return p;
                    })
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                
                if (fromIndex < personas.length && toIndex < personas.length) {
                    const [movedPersona] = personas.splice(fromIndex, 1);
                    personas.splice(toIndex, 0, movedPersona);
                    
                    personas.forEach((persona, index) => {
                        persona.sort = (index + 1) * 10;
                    });
                    
                    saveToLocalStorage();
                    renderPersonaModal();
                    populatePersonaSelector();
                }
            }
        });
    }
    if (dom.addNewPersonaBtn) dom.addNewPersonaBtn.addEventListener('click', () => {
        if (typeof resetPersonaEditForm === 'function' && typeof openPersonaEditModal === 'function') {
            resetPersonaEditForm();
            openPersonaEditModal();
        } else {
            setTimeout(() => {
                if (typeof resetPersonaEditForm === 'function' && typeof openPersonaEditModal === 'function') {
                    resetPersonaEditForm();
                    openPersonaEditModal();
                } else {
                    console.error('resetPersonaEditForm 或 openPersonaEditModal 函数未定义');
                    alert('功能模块加载失败，请刷新页面重试');
                }
            }, 100);
        }
    });

    if (dom.personaEditSaveBtn) dom.personaEditSaveBtn.addEventListener('click', savePersonaEdit);
    if (dom.personaEditCancelBtn) dom.personaEditCancelBtn.addEventListener('click', () => closeModalWithAnimation(dom.personaEditModal, closePersonaEditModal));
    if (dom.personaEditPromptInput) {
        dom.personaEditPromptInput.addEventListener('input', () => {
            const charCount = dom.personaEditPromptInput.value.length;
            const counter = document.getElementById('persona-edit-char-counter');
            if (counter) {
                counter.textContent = `${charCount} 字`;
            }
        });
    }
}

function savePersona() {
    const id = dom.personaIdInput.value;
    const name = dom.personaNameInput.value.trim();
    const prompt = dom.personaPromptInput.value.trim();

    if (!name || !prompt) return alert('名称和提示词不能为空！');

    const personaId = id || `persona_${Date.now()}`;
    
    let sort = 0;
    if (!id) { // 新角色
        const existingPersonas = Object.values(state.personas);
        const maxSort = existingPersonas.length > 0 
            ? Math.max(...existingPersonas.map(p => p.sort || 0))
            : 0;
        sort = maxSort + 10;
    } else { // 编辑现有角色
        sort = state.personas[personaId]?.sort || 0;
    }
    
    state.personas[personaId] = {id: personaId, name, prompt, sort};
    saveToLocalStorage();
    renderPersonaModal();
    populatePersonaSelector();
    resetPersonaForm();
    dom.personaSelector.disabled = false;
}

function savePersonaEdit() {
    const id = dom.personaEditIdInput.value;
    const name = dom.personaEditNameInput.value.trim();
    const prompt = dom.personaEditPromptInput.value.trim();

    if (!name || !prompt) return alert('名称和提示词不能为空！');

    const personaId = id || `persona_${Date.now()}`;
    
    let sort = 0;
    if (!id) { // 新角色
        const existingPersonas = Object.values(state.personas);
        const maxSort = existingPersonas.length > 0 
            ? Math.max(...existingPersonas.map(p => p.sort || 0))
            : 0;
        sort = maxSort + 10;
    } else { // 编辑现有角色
        sort = state.personas[personaId]?.sort || 0;
    }
    
    state.personas[personaId] = {id: personaId, name, prompt, sort};
    saveToLocalStorage();
    renderPersonaModal();
    populatePersonaSelector();
    closeModalWithAnimation(dom.personaEditModal, closePersonaEditModal);
    dom.personaSelector.disabled = false;
}

function handlePersonaListActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    const personaId = button.dataset.id;
    
    if (button.classList.contains('persona-edit-btn')) {
        const persona = state.personas[personaId];
        dom.personaEditIdInput.value = persona.id;
        dom.personaEditNameInput.value = persona.name;
        dom.personaEditPromptInput.value = persona.prompt;
        dom.personaEditFormTitle.textContent = '编辑角色';
        openPersonaEditModal();
    } else if (button.classList.contains('persona-copy-btn')) {
        if (Date.now() - lastPersonaCopyTime < 1000) return alert('请勿频繁点击复制！');
        lastPersonaCopyTime = Date.now();
        const personaToCopy = state.personas[personaId];
        if (confirm(`确定要复制角色 "${personaToCopy.name}" 吗？`)) {
            const newPersona = JSON.parse(JSON.stringify(personaToCopy));
            newPersona.id = `persona_${Date.now()}`;
            newPersona.name = `${personaToCopy.name}_copy`;
            
            const existingPersonas = Object.values(state.personas);
            const maxSort = existingPersonas.length > 0 
                ? Math.max(...existingPersonas.map(p => p.sort || 0))
                : 0;
            newPersona.sort = maxSort + 10;
            
            state.personas[newPersona.id] = newPersona;
            saveToLocalStorage();
            renderPersonaModal();
            populatePersonaSelector();
        }
    } else if (button.classList.contains('persona-delete-btn')) {
        if (confirm(`确定要删除角色 "${state.personas[personaId].name}" 吗？`)) {
            delete state.personas[personaId];
            saveToLocalStorage();
            renderPersonaModal();
            populatePersonaSelector();
        }
    }
}
