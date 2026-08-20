// chat-search.js
// 聊天消息搜索功能
import { renderChatMessages } from './renderer.js?v=260820-1';
import { dom } from './dom.js?v=260820-1'; // 乌鸦：导入dom模块以获取聊天消息容器的引用

let lastSearchKeyword = '';
let searchResults = [];
let currentResultIndex = -1;

// 乌鸦：把DOM元素引用缓存起来，避免反复查询
let searchInput, prevBtn, nextBtn, counter;
let searchBox; // 乌鸦：提升searchBox的作用域

/**
 * @description 乌鸦：关闭并重置搜索框状态的函数
 */
export function closeChatSearch() {
    if (!searchBox || searchBox.style.display === 'none') {
        return; // 如果搜索框不存在或已关闭，则不执行任何操作
    }

    searchBox.style.display = 'none';

    // 乌鸦：直接隐藏按钮和清空计数器，确保状态干净
    if(prevBtn) prevBtn.style.display = 'none';
    if(nextBtn) nextBtn.style.display = 'none';
    if(counter) counter.textContent = '';
    
    // 只有在确实有搜索关键词时才执行重置和重绘
    if (lastSearchKeyword) {
        lastSearchKeyword = '';
        currentResultIndex = -1;
        searchResults = [];
        renderChatMessages(); // 通过移除关键词并重绘来清除高亮
    }
}

export function setupChatSearch() {
    const searchBtn = document.getElementById('chat-search-btn');
    searchBox = document.getElementById('chat-search-box'); // 乌鸦：赋值给更高作用域的变量
    const closeBtn = document.getElementById('chat-search-close');
    
    // 乌鸦：在设置时一次性获取所有需要的DOM元素
    searchInput = document.getElementById('chat-search-input');
    prevBtn = document.getElementById('chat-search-prev');
    nextBtn = document.getElementById('chat-search-next');
    counter = document.getElementById('chat-search-counter');

    if (!searchBtn || !searchBox || !searchInput || !closeBtn || !prevBtn || !nextBtn || !counter) return;

    // 显示搜索框
    searchBtn.onclick = () => {
        searchBox.style.display = 'flex';
        searchInput.value = lastSearchKeyword;
        searchInput.focus();
        searchInput.select();
    };

    // 关闭搜索框
    closeBtn.onclick = closeChatSearch; // 乌鸦：直接调用封装好的函数

    // 快捷键支持
    searchInput.onkeydown = e => {
        if (e.key === 'Escape') {
            closeChatSearch();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                prevBtn.click();
            } else {
                nextBtn.click();
            }
        }
    };

    // 搜索输入
    searchInput.oninput = () => {
        lastSearchKeyword = searchInput.value.trim();
        renderChatMessages();
        // 乌鸦：用setTimeout确保DOM渲染完成后再更新搜索状态
        setTimeout(updateSearchState, 100);
    };

    // 导航按钮
    prevBtn.onclick = () => navigateToResult(currentResultIndex - 1);
    nextBtn.onclick = () => navigateToResult(currentResultIndex + 1);
}

/**
 * 乌鸦：更新搜索结果的状态，并决定是否显示导航控件
 */
function updateSearchState() {
    searchResults = [];
    // 乌鸦：修正 - 只在聊天消息容器内部查找，避免污染其他UI
    const messageContents = dom.chatMessages.querySelectorAll('.message-content');
    messageContents.forEach(contentEl => {
        if (contentEl.shadowRoot) {
            const highlightsInBubble = contentEl.shadowRoot.querySelectorAll('.chat-search-highlight');
            if (highlightsInBubble.length > 0) {
                searchResults.push(...Array.from(highlightsInBubble));
            }
        }
    });

    currentResultIndex = -1;

    if (searchResults.length > 0) {
        prevBtn.style.display = 'inline-block';
        nextBtn.style.display = 'inline-block';
        counter.style.display = 'inline-block';
        navigateToResult(0); // 自动定位到第一个结果
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        counter.style.display = 'none';
        counter.textContent = '';
    }
}

/**
 * 乌鸦：导航到指定索引的搜索结果
 * @param {number} index - 要导航到的结果索引
 */
function navigateToResult(index) {
    if (searchResults.length === 0) return;

    // 移除上一个结果的激活状态
    if (currentResultIndex !== -1 && searchResults[currentResultIndex]) {
        searchResults[currentResultIndex].classList.remove('chat-search-highlight--active');
    }

    // 乌鸦：计算新的索引，实现循环导航（到头了就从尾开始，反之亦然）
    if (index < 0) {
        currentResultIndex = searchResults.length - 1;
    } else if (index >= searchResults.length) {
        currentResultIndex = 0;
    } else {
        currentResultIndex = index;
    }

    const currentResult = searchResults[currentResultIndex];
    if (!currentResult) return;

    // 乌鸦：为当前结果添加激活状态，并将其滚动到视野中央
    currentResult.classList.add('chat-search-highlight--active');
    currentResult.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 更新计数器
    counter.textContent = `${currentResultIndex + 1} / ${searchResults.length}`;
}


// 扩展渲染消息时的高亮逻辑
export function getChatSearchKeyword() {
    return lastSearchKeyword;
}