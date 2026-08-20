// db-choose.js
// 数据库选择弹窗及相关逻辑
import { state } from './state.js';
import { dom } from './dom.js';
import { saveConversation } from './db.js';
import { saveToLocalStorage } from './utils.js';

export function showDbChooseModal(currentDbId, onChoose) {
    let modal = document.getElementById('db-choose-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'db-choose-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-body" style="min-width:320px;max-width:90vw;">
                <h3 style="margin-bottom:10px;">选择数据库</h3>
                <div id="db-choose-list"></div>
                <div style="display:flex;justify-content:space-between;margin-top:16px;gap:8px;">
                    <button id="db-choose-clear" style="color:#e53935;">清空</button>
                    <div style="flex:1;text-align:right;">
                        <button id="db-choose-cancel">取消</button>
                        <button id="db-choose-confirm" disabled>确定</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const list = modal.querySelector('#db-choose-list');
    list.innerHTML = '';
    let selectedId = currentDbId || null;
    Object.values(state.dbConnections).forEach(conn => {
        const item = document.createElement('div');
        item.className = 'db-choose-item';
        item.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="radio" name="db-choose-radio" value="${conn.id}" ${conn.id===currentDbId?'checked':''}>
                <span>${conn.name} (${conn.type}@${conn.host}${conn.port?(':'+conn.port):''})</span>
            </label>
        `;
        list.appendChild(item);
    });
    list.querySelectorAll('input[type=radio]').forEach(radio => {
        radio.onchange = () => {
            selectedId = radio.value;
            modal.querySelector('#db-choose-confirm').disabled = false;
        };
    });
    modal.querySelector('#db-choose-cancel').onclick = () => {
        modal.style.display = 'none';
    };
    modal.querySelector('#db-choose-confirm').onclick = () => {
        if (selectedId) {
            onChoose(selectedId);
            modal.style.display = 'none';
        }
    };
    // 清空按钮逻辑
    const clearBtn = modal.querySelector('#db-choose-clear');
    if (clearBtn) {
        clearBtn.onclick = async () => {
            // 清除当前会话的dbId并持久化
            if (state.currentConversationId && state.conversations[state.currentConversationId]) {
                state.conversations[state.currentConversationId].dbId = undefined;
                await saveConversation(state.currentConversationId, state.conversations[state.currentConversationId]);
                await saveToLocalStorage();
                if (typeof onChoose === 'function') onChoose(undefined);
            }
            modal.style.display = 'none';
        };
    }
    modal.style.display = 'flex';
}

export function hideDbChooseModal() {
    const modal = document.getElementById('db-choose-modal');
    if (modal) modal.style.display = 'none';
}
