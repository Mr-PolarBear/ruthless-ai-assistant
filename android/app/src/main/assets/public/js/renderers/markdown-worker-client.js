/**
 * @file markdown-worker-client.js
 * @description Client for communicating with the Markdown Web Worker.
 */

import { state } from '../state.js';

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

                // Initialize worker with library paths
                // Since this is a raw project structure, we point to the libs
                // We assume the worker is in js/workers/, so libs are in ../../libs/
                // But importScripts resolves relative to the worker file location.
                // So relative to js/workers/markdown-worker.js:
                // libs/marked.min.js -> ../../libs/marked.min.js
                // js/purify.min.js -> ../purify.min.js

                const libPaths = {
                    marked: '../../libs/marked.min.js',
                    highlight: '../../libs/highlight.min.js'
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

            // Pass regex rules (snapshot)
            const regexRules = state.regexRules;

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
