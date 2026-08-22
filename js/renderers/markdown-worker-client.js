/**
 * @file markdown-worker-client.js
 * @description Client for communicating with the Markdown Web Worker.
 */

import { state } from '../state.js?v=260820-1';
import { getActiveRegexRules } from '../regex-engine.js?v=260820-1';

class MarkdownWorkerClient {
    constructor() {
        this.worker = null;
        this.pendingRequests = new Map();
        this.requestIdCounter = 0;
        this.isInitialized = false;
        this.initPromise = null;
    }

    async init() {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            try {
                this.worker = new Worker('js/workers/markdown-worker.js?v=' + Date.now());

                this.worker.onmessage = (e) => {
                    const { id, type, html, error } = e.data;

                    if (type === 'init_success') {
                        this.isInitialized = true;
                        resolve();
                        return;
                    }

                    const request = this.pendingRequests.get(id);
                    if (request) {
                        if (type === 'render_result') {
                            request.resolve(html);
                        } else if (type === 'error') {
                            console.error('Worker Error:', error);
                            // Fallback? Or reject?
                            // For stream resilience, maybe return empty or raw text?
                            request.reject(new Error(error));
                        }
                        this.pendingRequests.delete(id);
                    }
                };

                this.worker.onerror = (err) => {
                    console.error('Markdown Worker Error:', err);
                    reject(err);
                };

                // 乌鸦：动态获取页面中 marked 与 highlight.js 的实际引入地址（自适应本地离线版与公网 CDN 版）
                const markedScript = document.querySelector('script[src*="marked"]');
                const highlightScript = document.querySelector('script[src*="highlight"]');

                const getFullScriptUrl = (el, fallbackRelative) => {
                    if (el && el.src) {
                        return el.src;
                    }
                    try {
                        return new URL(fallbackRelative, window.location.href).href;
                    } catch (e) {
                        return fallbackRelative;
                    }
                };

                const libPaths = {
                    marked: getFullScriptUrl(markedScript, 'libs/marked.min.js'),
                    highlight: getFullScriptUrl(highlightScript, 'libs/highlight.min.js')
                };

                this.worker.postMessage({ type: 'init', libs: libPaths });

            } catch (err) {
                console.error('Failed to create Markdown Worker:', err);
                reject(err);
            }
        });

        return this.initPromise;
    }

    async render(text, role, messageIndex, totalVisibleMessages) {
        if (!this.worker) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const id = this.requestIdCounter++;
            this.pendingRequests.set(id, { resolve, reject });

            const config = {
                disableXssProtection: state.appSettings.disableXssProtection
            };

            // Pass regex rules (snapshot for current conversation)
            const regexRules = getActiveRegexRules(state.currentConversationId);

            this.worker.postMessage({
                id,
                type: 'render',
                text,
                role,
                messageIndex,
                totalVisibleMessages,
                config,
                regexRules
            });
        });
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isInitialized = false;
            this.initPromise = null;
            this.pendingRequests.clear();
        }
    }
}

export const markdownWorkerClient = new MarkdownWorkerClient();
