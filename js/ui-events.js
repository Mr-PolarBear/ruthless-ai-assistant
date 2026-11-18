/**
 * @file ui-events.js
 * @description Handles basic UI interaction events like sidebar toggle, fullscreen, scrolling, theme changes, etc.
 */

import { dom } from './dom.js?v=temp';
import { state } from './state.js?v=temp';
import { scrollToBottom, updateScrollButtonsVisibility, applyTheme, adjustTextareaHeight, notify } from './ui-updater.js?v=temp';
import { renderChatMessages } from './renderer.js?v=temp';
import { saveAppSettings } from './utils.js?v=temp';
import { clearAttachment } from './attachment.js?v=temp';
import { renderQuickPromptMenu } from './quick-prompts.js?v=temp';
import { updateFloatingButton } from './floating-button.js?v=temp';
import { scrollManager } from './scroll-manager.js?v=temp';
import { openChangelogModal } from './services/changelog-manager.js?v=temp';
import { draftManager } from './services/draft-manager.js?v=temp';
import { scrollPillManager } from './services/scroll-pill-manager.js?v=temp';
import { openLoadAllConfirmModal } from './modals/load-all-confirm-modal.js?v=temp';
import { isMobileDevice } from './services/viewport-manager.js?v=temp';

function positionPopupNearButton(button, popup) {
    if (!button || !popup) return;

    const rect = button.getBoundingClientRect();
    const popupWidth = popup.offsetWidth || 700;
    const popupHeight = popup.offsetHeight || 480;
    const gap = 8;

    let left = rect.left;
    let bottom = window.innerHeight - rect.top + gap;

    if (left + popupWidth > window.innerWidth - 10) {
        left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) {
        left = 10;
    }

    if (bottom + popupHeight > window.innerHeight - 10) {
        bottom = window.innerHeight - popupHeight - 10;
    }

    popup.style.left = `${left}px`;
    popup.style.bottom = `${bottom}px`;
}

/**
 * 关闭移动端侧边栏抽屉
 * — 为什么这么写 —
 * 移除对 document.body 增删 'sidebar-open' 的无用操作。
 * 在根节点修改 class 会触发整个 DOM 树上万节点的全局样式重算（Style Recalculation）。
 * 移动端关闭由遮罩层 #sidebar-backdrop 与关闭按钮精准接管。
 */
export function closeSidebarMobile() {
    if (dom.sidebar) {
        dom.sidebar.classList.remove('sidebar-visible');
    }
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.classList.remove('active');
}

/**
 * 打开移动端侧边栏抽屉
 */
export function openSidebarMobile() {
    if (dom.sidebar) {
        dom.sidebar.classList.add('sidebar-visible');
    }
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.classList.add('active');
}

/**
 * 切换移动端侧边栏状态
 */
export function toggleSidebarMobile() {
    if (!dom.sidebar) return;
    const isVisible = dom.sidebar.classList.contains('sidebar-visible');
    if (isVisible) {
        closeSidebarMobile();
    } else {
        openSidebarMobile();
    }
}

export function setupUIEvents() {
    // Sidebar toggle
    if (dom.sidebarToggleBtn) {
        // — 为什么这么写 —
        // 1. 移动端极速通道：监听 touchend 并在松手瞬间立即触发，彻底跳过 Alook / 移动端 WebView
        //    默认等待 300ms 判定双击缩放或滑动的手势延迟与长任务队列积压；
        // 2. 时间戳防抖锁 (400ms)：调用 preventDefault 阻断合成虚拟 click，同时记录时间戳，
        //    防止部分安卓国产浏览器穿透执行随后的 click 事件导致抽屉被秒开又秒关；
        // 3. 桌面端平滑保留原有 click 逻辑，100% 互不干扰。
        let lastToggleTime = 0;

        const handleMobileFastToggle = (e) => {
            const isMobile = isMobileDevice();
            if (!isMobile) return;

            const now = performance.now ? performance.now() : Date.now();
            if (now - lastToggleTime < 400) return;
            lastToggleTime = now;

            if (e && e.cancelable) {
                e.preventDefault();
            }
            toggleSidebarMobile();
        };

        dom.sidebarToggleBtn.addEventListener('touchend', handleMobileFastToggle, { passive: false });

        dom.sidebarToggleBtn.addEventListener('click', () => {
            const isMobile = isMobileDevice();
            if (isMobile) {
                const now = performance.now ? performance.now() : Date.now();
                if (now - lastToggleTime < 400) return; // 已被 touchend 极速通道处理过，直接跳过
                lastToggleTime = now;
                toggleSidebarMobile();
            } else { // Desktop view
                dom.app.classList.toggle('sidebar-collapsed');
                dom.sidebar.classList.toggle('collapsed');
            }
        });
    }

    // 移动端遮罩层点击关闭侧边栏（同步接入 touchend 极速通道）
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
        let lastBackdropCloseTime = 0;

        const handleBackdropFastClose = (e) => {
            const now = performance.now ? performance.now() : Date.now();
            if (now - lastBackdropCloseTime < 400) return;
            lastBackdropCloseTime = now;

            if (e && e.cancelable) {
                e.preventDefault();
            }
            closeSidebarMobile();
        };

        backdrop.addEventListener('touchend', handleBackdropFastClose, { passive: false });
        backdrop.addEventListener('click', () => {
            const now = performance.now ? performance.now() : Date.now();
            if (now - lastBackdropCloseTime < 400) return;
            lastBackdropCloseTime = now;
            closeSidebarMobile();
        });
    }

    // 移动端侧边栏顶部显式关闭按钮
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    if (sidebarCloseBtn) {
        let lastBtnCloseTime = 0;
        const handleBtnFastClose = (e) => {
            const now = performance.now ? performance.now() : Date.now();
            if (now - lastBtnCloseTime < 400) return;
            lastBtnCloseTime = now;

            if (e && e.cancelable) e.preventDefault();
            closeSidebarMobile();
        };
        sidebarCloseBtn.addEventListener('touchend', handleBtnFastClose, { passive: false });
        sidebarCloseBtn.addEventListener('click', handleBtnFastClose);
    }

    // Fullscreen toggle
    if (dom.fullscreenBtn) {
        dom.fullscreenBtn.addEventListener('click', () => toggleFullscreen(true));
    }
    if (dom.exitFullscreenBtn) {
        dom.exitFullscreenBtn.addEventListener('click', () => toggleFullscreen(false));
    }

    // Input area listeners
    if (dom.messageInput) {
        dom.messageInput.addEventListener('input', () => {
            adjustTextareaHeight();
            const hasContent = dom.messageInput.value.trim().length > 0;
            const hasAttachment = state.attachedFiles && state.attachedFiles.length > 0;
            dom.clearInputBtn.classList.toggle('hidden', !hasContent && !hasAttachment);
            // 乌鸦：输入框实时输入时，防抖暂存草稿并同步侧边栏 [草稿] 徽章
            draftManager.handleInput(state.currentConversationId, dom.messageInput.value);
        });
    }

    if (dom.clearInputBtn) {
        dom.clearInputBtn.addEventListener('click', () => {
            dom.messageInput.value = '';
            clearAttachment();
            dom.messageInput.rows = 1;
            dom.messageInput.style.height = 'auto';
            dom.clearInputBtn.classList.add('hidden');
            // 乌鸦：手动点击清空按钮时，立即清空当前会话的草稿
            draftManager.clearDraft(state.currentConversationId);
            dom.messageInput.focus();
        });
    }

    // Scroll listeners
    if (dom.chatMessages) {
        dom.chatMessages.addEventListener('scroll', handleChatScroll);
        setTimeout(handleChatScroll, 200);
    }
    // 乌鸦：回到顶部按钮 - 改用同步scrollTop而非smooth动画，避免在流式渲染时被阻塞
    if (dom.scrollToTopBtn) dom.scrollToTopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        dom.chatMessages.scrollTop = 0; // 立即跳转，不等smooth动画
    });
    if (dom.scrollToBottomBtn) dom.scrollToBottomBtn.addEventListener('click', () => {
        // 乌鸦：使用 forceScrollToBottom 同时重置 scrollIntention 为 'bottom'
        // 确保流式输出期间点击此按钮后能恢复自动跟随
        scrollManager.forceScrollToBottom();
        scrollPillManager.notifyReachedBottom();
    });

    // General body click handlers
    document.body.addEventListener('click', (e) => {
        // 快捷提示菜单的外部点击关闭逻辑
        if (dom.quickPromptMenu && !dom.quickPromptMenu.contains(e.target) && !e.target.closest('#quick-prompt-btn')) {
            dom.quickPromptMenu.style.display = 'none';
        }
    }, true); // Use capture to catch the click early

    // Quick prompt button & menu hover/click interactions
    if (dom.quickPromptBtn && dom.quickPromptMenu) {
        let quickPromptHideTimeout = null;

        const showQuickPromptMenu = () => {
            if (quickPromptHideTimeout) {
                clearTimeout(quickPromptHideTimeout);
                quickPromptHideTimeout = null;
            }

            // 关闭MCP工具弹窗
            if (dom.mcpToolsMenu) {
                dom.mcpToolsMenu.style.display = 'none';
            }

            renderQuickPromptMenu();
            dom.quickPromptMenu.style.display = 'flex';
            positionPopupNearButton(dom.quickPromptBtn, dom.quickPromptMenu);
        };

        const scheduleHideQuickPromptMenu = () => {
            if (quickPromptHideTimeout) {
                clearTimeout(quickPromptHideTimeout);
            }
            quickPromptHideTimeout = setTimeout(() => {
                if (dom.quickPromptMenu) {
                    dom.quickPromptMenu.style.display = 'none';
                }
                quickPromptHideTimeout = null;
            }, 200); // 200ms 延时，保证用户鼠标在按钮与弹窗之间平滑滑动不误关
        };

        // 鼠标悬浮进入按钮时展示
        dom.quickPromptBtn.addEventListener('mouseenter', showQuickPromptMenu);
        // 鼠标离开按钮时计划延时关闭
        dom.quickPromptBtn.addEventListener('mouseleave', scheduleHideQuickPromptMenu);

        // 鼠标进入菜单内部时清除定时器保持显示
        dom.quickPromptMenu.addEventListener('mouseenter', () => {
            if (quickPromptHideTimeout) {
                clearTimeout(quickPromptHideTimeout);
                quickPromptHideTimeout = null;
            }
        });
        // 鼠标离开菜单内部时计划延时关闭
        dom.quickPromptMenu.addEventListener('mouseleave', scheduleHideQuickPromptMenu);

        // 点击按钮时切换展示/隐藏
        dom.quickPromptBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dom.quickPromptMenu.style.display === 'flex';
            if (isVisible) {
                if (quickPromptHideTimeout) {
                    clearTimeout(quickPromptHideTimeout);
                    quickPromptHideTimeout = null;
                }
                dom.quickPromptMenu.style.display = 'none';
            } else {
                showQuickPromptMenu();
            }
        });
    }

    // Theme and appearance settings
    setupThemeAndAppearanceEvents();

    // Send key settings
    setupSendKeyEvents();

    // Model parameter listeners
    setupModelParameterEvents();

    // 乌鸦：首次加载消息数设置和加载全部按钮事件
    setupLazyLoadEvents();

    // 乌鸦：【性能优化】主题变化监听器
    // 现在使用共享样式表（adoptedStyleSheets），hljs 主题会自动更新，无需完全重绘
    // 监听器已移至 renderer.js 中的共享样式表管理模块

    // 阻止AI生成时修改渲染模式
    document.addEventListener('click', (e) => {
        const targetId = e.target.id;
        const isTargetSelector = targetId === 'user-render-mode-selector' || targetId === 'ai-render-mode-selector';

        if (isTargetSelector && Object.keys(state.generatingMessages).length > 0) {
            e.preventDefault();
            e.stopPropagation();
            alert('请等待所有会话请求结束后再修改');
        }
    }, true);

    // 乌鸦：更新日志弹窗事件绑定
    setupChangelogEvents();

    // 开源代码仓库地址复制事件绑定
    setupRepoLinkEvents();

    // 移动端顶栏横向滚动指引（Plan A: 渐隐 + 动态向右微标）
    setupPersonaBarScrollHint();
}

/**
 * Toggles fullscreen mode for the chat interface.
 * @param {boolean} isEnteringFullscreen - True to enter fullscreen, false to exit.
 */
function toggleFullscreen(isEnteringFullscreen) {
    if (isEnteringFullscreen) {
        document.body.classList.add('fullscreen-active');
        if (dom.fullscreenBtn) dom.fullscreenBtn.classList.add('hidden');
        if (dom.exitFullscreenBtn) dom.exitFullscreenBtn.classList.remove('hidden');
    } else {
        document.body.classList.remove('fullscreen-active');
        if (dom.fullscreenBtn) dom.fullscreenBtn.classList.remove('hidden');
        if (dom.exitFullscreenBtn) dom.exitFullscreenBtn.classList.add('hidden');
    }
    // Scroll to bottom after toggling fullscreen to ensure correct view
    scrollToBottom();
}

/**
 * Handles chat scroll events
 * 乌鸦：统一的滚动处理，同时更新滚动按钮和悬浮按钮
 * 乌鸦：现在使用增强的滚动管理器，不再需要手动节流
 */
let scrollThrottleTimer = null; // 乌鸦：保留原有节流作为备用

export function handleChatScroll() {
    const chatContainer = dom.chatMessages;
    if (!chatContainer) return;

    // 乌鸦：新的滚动管理器已经在监听，这里只做必要的UI更新
    // 乌鸦：使用节流防抖，提高性能
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = setTimeout(() => {
        // 乌鸦：更新滚动按钮的可见性
        updateScrollButtonsVisibility();
        // 乌鸦：更新悬浮折叠按钮的状态
        updateFloatingButton();
        scrollThrottleTimer = null;
    }, 100); // 100毫秒的节流频率
}

/**
 * Sets up theme and appearance related events
 */
function setupThemeAndAppearanceEvents() {
    dom.themeSelector.addEventListener('change', (e) => {
        state.appSettings.theme = e.target.value;
        applyTheme(e.target.value);
    });

    // 为渲染模式选择器添加事件监听
    if (dom.userRenderModeSelector) {
        dom.userRenderModeSelector.addEventListener('change', (e) => {
            state.appSettings.userMessageDefaultRenderMode = e.target.value;
            saveAppSettings();
            renderChatMessages(); // 立即重绘以应用更改
        });
    }

    if (dom.aiRenderModeSelector) {
        dom.aiRenderModeSelector.addEventListener('change', (e) => {
            state.appSettings.aiMessageDefaultRenderMode = e.target.value;
            saveAppSettings();
            renderChatMessages(); // 立即重绘以应用更改
        });
    }

    // Font size listener
    if (dom.fontSizeSelector) {
        dom.fontSizeSelector.value = state.appSettings.fontSize || 16;
        dom.fontSizeSelector.onchange = function () {
            const val = parseInt(dom.fontSizeSelector.value, 10);
            state.appSettings.fontSize = val;
            document.documentElement.style.setProperty('--font-size-base', val + 'px');
            saveAppSettings();
        };
    }

    // Auto-collapse listener
    if (dom.autoCollapseCheckbox) {
        dom.autoCollapseCheckbox.checked = state.appSettings.autoCollapseLongMessage !== false;
        dom.autoCollapseCheckbox.onchange = function () {
            state.appSettings.autoCollapseLongMessage = dom.autoCollapseCheckbox.checked;
            saveAppSettings();
            renderChatMessages();
        };
    }

    // 乌鸦：调试模式复选框事件处理
    if (dom.debugModeCheckbox) {
        dom.debugModeCheckbox.checked = state.appSettings.debugMode || false;
        dom.debugModeCheckbox.onchange = function () {
            state.appSettings.debugMode = dom.debugModeCheckbox.checked;
            saveAppSettings();
        };
    }

    // 乌鸦：XSS防护开关事件处理
    if (dom.disableXssProtectionCheckbox) {
        dom.disableXssProtectionCheckbox.checked = state.appSettings.disableXssProtection || false;
        dom.disableXssProtectionCheckbox.onchange = function () {
            const checkbox = dom.disableXssProtectionCheckbox;
            const originalState = state.appSettings.disableXssProtection;

            if (confirm('警告：更改此设置将立即重绘所有消息，并可能带来安全风险。确定吗？')) {
                // 用户点击“确定”，应用新设置
                state.appSettings.disableXssProtection = checkbox.checked;
                saveAppSettings();
                renderChatMessages();
            } else {
                // 用户点击“取消”，恢复复选框状态
                checkbox.checked = originalState;
            }
        };
    }

    // 乌鸦：自动渲染表格设置事件处理
    if (dom.autoRenderCheckbox) {
        // 乌鸦：确保初始状态同步
        dom.autoRenderCheckbox.checked = state.appSettings.autoRenderTable !== false;
        console.log('乌鸦：自动渲染表格初始设置:', dom.autoRenderCheckbox.checked, '对应state值:', state.appSettings.autoRenderTable);

        dom.autoRenderCheckbox.addEventListener('change', () => {
            const newValue = dom.autoRenderCheckbox.checked;
            state.appSettings.autoRenderTable = newValue;
            console.log('乌鸦：自动渲染表格设置变更为:', newValue);
            saveAppSettings();
            // 乌鸦：重新渲染消息以应用新设置
            if (typeof renderChatMessages === 'function') {
                renderChatMessages();
            }
        });
    } else {
        console.warn('乌鸦：找不到 autoRenderCheckbox 元素');
    }

    // 乌鸦：自动展开代码侧边栏设置事件处理
    if (dom.autoExpandCodeCheckbox) {
        dom.autoExpandCodeCheckbox.checked = state.appSettings.autoExpandCode !== false;

        dom.autoExpandCodeCheckbox.addEventListener('change', () => {
            const newValue = dom.autoExpandCodeCheckbox.checked;
            state.appSettings.autoExpandCode = newValue;
            console.log('乌鸦：自动展开侧边栏设置变更为:', newValue);
            saveAppSettings();
        });
    }
}

/**
 * Sets up send key related events
 */
function setupSendKeyEvents() {
    if (dom.sendKeyEnter) dom.sendKeyEnter.addEventListener('change', handleSendKeyChange);
    if (dom.sendKeyCtrlEnter) dom.sendKeyCtrlEnter.addEventListener('change', handleSendKeyChange);
    if (dom.sendKeyButton) dom.sendKeyButton.addEventListener('change', handleSendKeyChange);
}

/**
 * Sets up model parameter related events
 */
function setupModelParameterEvents() {
    const paramInputs = [dom.paramTempInput, dom.paramTopPInput, dom.paramTopKInput, dom.paramMinPInput];
    paramInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const id = e.target.id.replace('param-', '');
            document.getElementById(`${id}-value`).textContent = e.target.value;
        });
        input.addEventListener('change', handleModelParamChange);
    });
    dom.paramMaxTokensInput.addEventListener('change', handleModelParamChange);
    dom.paramEnableTopK.addEventListener('change', handleModelParamChange);
    dom.paramEnableMinP.addEventListener('change', handleModelParamChange);

    // 乌鸦：流式模式开关事件处理
    if (dom.streamModeToggle) {
        dom.streamModeToggle.checked = state.appSettings.streamMode !== false;
        dom.streamModeToggle.addEventListener('change', () => {
            state.appSettings.streamMode = dom.streamModeToggle.checked;
            saveAppSettings();
        });
    }
}

/**
 * Handles send key change events
 */
function handleSendKeyChange(e) {
    if (e.target.checked) {
        state.appSettings.sendKey = e.target.value;
        saveAppSettings();
        // 乌鸦：切换发送快捷键后，同步刷新输入框占位提示文案
        import('./ui-updater.js?v=temp').then(mod => mod.updateInputPlaceholder());
    }
}

/**
 * Handles model parameter change events
 */
function handleModelParamChange() {
    state.appSettings.modelParams = {
        temperature: parseFloat(dom.paramTempInput.value),
        top_p: parseFloat(dom.paramTopPInput.value),
        enableTopK: dom.paramEnableTopK.checked,
        top_k: parseInt(dom.paramTopKInput.value, 10),
        enableMinP: dom.paramEnableMinP.checked,
        min_p: parseFloat(dom.paramMinPInput.value),
        max_tokens: parseInt(dom.paramMaxTokensInput.value, 10),
    };
    saveAppSettings();
}

/**
 * 乌鸦：设置懒加载相关的事件监听器
 */
function setupLazyLoadEvents() {
    // 首次加载消息数设罫
    if (dom.recentMessageCountInput) {
        // 乌鸦：注意：0表示不使用懒加载，需要明确判断不能用 || 5
        const defaultCount = state.appSettings.recentMessageCount !== undefined && state.appSettings.recentMessageCount !== null
            ? state.appSettings.recentMessageCount
            : 5;
        dom.recentMessageCountInput.value = defaultCount;
        dom.recentMessageCountInput.addEventListener('change', function () {
            const count = parseInt(this.value, 10);
            if (count >= 1 && count <= 100) {
                state.appSettings.recentMessageCount = count;
                saveAppSettings();
                console.log(`乌鸦：首次加载消息数已设置为: ${count}`);
            } else {
                // 乌鸦：恢复为上一个有效值
                const prevCount = state.appSettings.recentMessageCount !== undefined && state.appSettings.recentMessageCount !== null
                    ? state.appSettings.recentMessageCount
                    : 5;
                this.value = prevCount;
            }
        });
    }

    // 乌鸦/小鸡：加载全部消息按钮事件（带确认弹窗与性能安全提示）
    if (dom.loadAllMessagesBtn) {
        const btn = dom.loadAllMessagesBtn.querySelector('button');
        if (btn) {
            btn.addEventListener('click', function () {
                openLoadAllConfirmModal(() => {
                    // 乌鸦：加载全部是一次性操作，不应该永久保存
                    // 只在当前会话显示全部，刷新后应该回到用户设置的值
                    renderChatMessages({ scrollBehavior: 'bottom', forceLoadAll: true });
                    console.log('乌鸦：用户确认加载全部消息');
                });
            });
        }
    }
}

/**
 * 乌鸦：设置更新日志弹窗的事件监听器
 * 包含：打开/关闭弹窗、标签页切换
 */
function setupChangelogEvents() {
    const modal = dom.changelogModal;
    const btn = dom.changelogBtn;

    if (!btn || !modal) return;

    // 点击按钮打开弹窗并规范重置为更新日志 Tab
    btn.addEventListener('click', () => {
        openChangelogModal();
    });

    // 关闭按钮
    const closeBtn = modal.querySelector('.modal-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // 点击遮罩层关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // 标签页切换逻辑
    const tabBtns = modal.querySelectorAll('.changelog-tab-btn');
    const tabContents = modal.querySelectorAll('.changelog-tab-content');

    tabBtns.forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            // 移除所有active
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // 激活当前标签
            tabBtn.classList.add('active');
            const targetId = tabBtn.getAttribute('data-changelog-tab');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

/**
 * 绑定通用设置中开源代码仓库复制按钮事件
 */
function setupRepoLinkEvents() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-repo-link-btn');
        if (!btn) return;
        const url = btn.dataset.url;
        const name = btn.dataset.name || '仓库';
        if (url) {
            navigator.clipboard.writeText(url).then(() => {
                notify.success(`${name} 地址已复制到剪贴板！`);
            }).catch(() => {
                notify.error('复制失败，请长按手动复制链接');
            });
        }
    });
}


/**
 * 移动端顶栏横向滚动提示指引 (Plan A: 渐隐遮罩 + 动态微动小箭头)
 * 监听 personaBar 的滚动、视口尺寸及内容宽度变化，动态控制右侧微标与渐隐的显隐，并支持一键顺滑翻屏
 */
let personaBarHintUpdater = null;

export function updatePersonaBarScrollHint() {
    if (typeof personaBarHintUpdater === 'function') {
        personaBarHintUpdater();
    }
}

function setupPersonaBarScrollHint() {
    const bar = dom.personaBar;
    const hint = dom.personaBarScrollHint || document.getElementById('persona-bar-scroll-hint');
    if (!bar || !hint) return;

    let rafId = null;
    function updateHintVisibility() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            if (window.innerWidth > 768) {
                hint.classList.remove('visible');
                return;
            }

            const canScroll = bar.scrollWidth > bar.clientWidth + 5;
            const reachedEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 10;

            if (canScroll && !reachedEnd) {
                hint.classList.add('visible');
            } else {
                hint.classList.remove('visible');
            }
        });
    }

    personaBarHintUpdater = updateHintVisibility;

    bar.addEventListener('scroll', updateHintVisibility, { passive: true });
    window.addEventListener('resize', updateHintVisibility, { passive: true });

    // — 为什么这么写 —
    // 监听角色容器内部尺寸与子节点变动，无论是异步载入人设、动态字体渲染还是增删角色，
    // 均能瞬时自适应重新测量并刷新微标可见性，彻底告别单次 setTimeout 的生命周期脆弱性
    if (window.ResizeObserver) {
        try {
            const ro = new ResizeObserver(() => updateHintVisibility());
            ro.observe(bar);
        } catch (_) {}
    }
    window.addEventListener('personabar:update', updateHintVisibility);

    hint.addEventListener('click', (e) => {
        e.stopPropagation();
        bar.scrollBy({ left: 160, behavior: 'smooth' });
    });

    setTimeout(updateHintVisibility, 350);
}