/**
 * @file draggable-list.js
 * @description 通用的列表拖拽排序类
 */

export class DraggableList {
    /**
     * 构造函数
     * @param {HTMLElement} container - 列表的容器元素 (e.g., <tbody> or <ul>)
     * @param {object} options - 配置项
     * @param {string} options.itemSelector - 可拖拽的子元素的CSS选择器 (e.g., 'tr' or '.list-item')
     * @param {function(number, number)} options.onDrop - 拖拽结束后的回调函数，接收 fromIndex 和 toIndex
     */
    constructor(container, options) {
        if (!container) {
            throw new Error('DraggableList: container is required.');
        }
        this.container = container;
        this.options = Object.assign({ itemSelector: 'li', onDrop: () => {} }, options);
        this.draggedItem = null;
        this.fromIndex = -1;

        this.init();
    }

    /**
     * 初始化，绑定事件
     */
    init() {
        // 乌鸦：确保所有子元素都是可拖拽的
        this.container.querySelectorAll(this.options.itemSelector).forEach(item => {
            item.draggable = true;
        });

        this.container.addEventListener('dragstart', this.handleDragStart.bind(this));
        this.container.addEventListener('dragend', this.handleDragEnd.bind(this));
        this.container.addEventListener('dragover', this.handleDragOver.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
    }

    handleDragStart(e) {
        const target = e.target.closest(this.options.itemSelector);
        if (!target || !this.container.contains(target)) return;

        this.draggedItem = target;
        this.fromIndex = this.getItemIndex(target);

        // 乌鸦：设置拖拽效果
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', target.outerHTML);
        
        // 乌鸦：创建一个透明的拖拽图像来减少虚影（但不完全禁用拖拽）
        try {
            const dragImage = document.createElement('canvas');
            dragImage.width = 1;
            dragImage.height = 1;
            const ctx = dragImage.getContext('2d');
            ctx.globalAlpha = 0.01; // 几乎透明但不完全透明
            e.dataTransfer.setDragImage(dragImage, 0, 0);
        } catch (error) {
            // 乌鸦：如果设置拖拽图像失败，不影响拖拽功能
            console.warn('设置拖拽图像失败:', error);
        }

        // 乌鸦：使用setTimeout确保样式在拖拽开始后应用
        setTimeout(() => {
            this.draggedItem.classList.add('dragging');
        }, 0);
    }

    handleDragEnd() {
        if (this.draggedItem) {
            this.draggedItem.classList.remove('dragging');
        }
        this.draggedItem = null;
        this.fromIndex = -1;
    }

    handleDragOver(e) {
        e.preventDefault(); // 乌鸦：必须阻止默认行为，否则drop事件不会触发
        const afterElement = this.getDragAfterElement(e.clientY);
        if (this.draggedItem) {
            if (afterElement == null) {
                this.container.appendChild(this.draggedItem);
            } else {
                this.container.insertBefore(this.draggedItem, afterElement);
            }
        }
    }

    handleDrop(e) {
        e.preventDefault();
        if (!this.draggedItem) return;

        const toIndex = this.getItemIndex(this.draggedItem);

        if (this.fromIndex !== -1 && toIndex !== -1 && this.fromIndex !== toIndex) {
            // 乌鸦：调用外部传入的回调函数，让外部处理数据更新
            this.options.onDrop(this.fromIndex, toIndex);
        }
    }

    /**
     * 获取当前拖拽元素的目标位置
     * @param {number} y - 鼠标的垂直坐标
     * @returns {HTMLElement|null}
     */
    getDragAfterElement(y) {
        const draggableElements = [...this.container.querySelectorAll(`${this.options.itemSelector}:not(.dragging)`)];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    /**
     * 获取元素在其容器中的索引
     * @param {HTMLElement} item - 要查找的元素
     * @returns {number}
     */
    getItemIndex(item) {
        const items = [...this.container.querySelectorAll(this.options.itemSelector)];
        return items.indexOf(item);
    }

    /**
     * 销毁实例，移除事件监听
     */
    destroy() {
        this.container.removeEventListener('dragstart', this.handleDragStart.bind(this));
        this.container.removeEventListener('dragend', this.handleDragEnd.bind(this));
        this.container.removeEventListener('dragover', this.handleDragOver.bind(this));
        this.container.removeEventListener('drop', this.handleDrop.bind(this));
    }
}
