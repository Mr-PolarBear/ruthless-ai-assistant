/**
 * @file tools-manager.js
 * @description Manages the tools dropdown menu and tool navigation.
 */

import { dom } from './dom.js';

const TOOLS = [
    {
        id: 'draw',
        name: 'AI 绘图',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>',
        action: () => window.open('draw.html', '_blank')
    }
    // 未来可以在这里添加更多工具
];

export class ToolsManager {
    constructor() {
        this.btn = null;
        this.menu = null;
        this.isOpen = false;
    }

    init() {
        // 1. 查找插入点
        // 我们要把按钮插入到 #hide-summary-btn 之前
        const hideBtn = document.getElementById('hide-summary-btn');
        if (!hideBtn) return;

        const parent = hideBtn.parentNode; // .sidebar-actions

        // 2. 创建按钮
        this.btn = document.createElement('button');
        this.btn.id = 'tool-box-btn';
        this.btn.title = '工具箱';
        this.btn.className = 'sidebar-secondary-btn';
        this.btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
            </svg>
        `;

        // 3. 创建下拉菜单
        this.menu = document.createElement('div');
        this.menu.className = 'tools-dropdown';
        
        TOOLS.forEach(tool => {
            const item = document.createElement('div');
            item.className = 'tool-item';
            item.innerHTML = `${tool.icon}<span>${tool.name}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
                tool.action();
            });
            this.menu.appendChild(item);
        });

        // 4. 将菜单挂载到按钮内部（方便定位）或者 body（防止被截断）
        // 为了简单定位，挂载到按钮内部，并设 position: relative
        // 但 sidebar-actions 可能有 overflow: hidden? 通常没有。
        // 为了稳妥，挂载到按钮内部。
        this.btn.appendChild(this.menu);

        // 5. 插入到 DOM
        parent.insertBefore(this.btn, hideBtn);

        // 6. 绑定事件
        this.btn.addEventListener('click', (e) => {
            // 防止点击菜单项时触发按钮点击
            if (e.target.closest('.tools-dropdown')) return;
            this.toggle();
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.btn.contains(e.target)) {
                this.close();
            }
        });
    }

    toggle() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.menu.classList.add('visible');
            this.btn.classList.add('active');
        } else {
            this.close();
        }
    }

    close() {
        this.isOpen = false;
        if (this.menu) this.menu.classList.remove('visible');
        if (this.btn) this.btn.classList.remove('active');
    }
}

export const toolsManager = new ToolsManager();
