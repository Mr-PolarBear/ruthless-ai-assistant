/**
 * @file model-fetcher.js
 * @description Handles fetching model lists from APIs.
 */

/**
 * Fetches the list of available models from an OpenAI-compatible API endpoint.
 * @param {string} baseUrl - The base URL of the API endpoint.
 * @param {string} apiKey - The API key for authentication.
 * @returns {Promise<Array<string>>} A promise that resolves with an array of model names.
 */
export async function fetchModels(baseUrl, apiKey) {
    let finalUrl = baseUrl;
    if (finalUrl.endsWith('/')) {
        finalUrl = finalUrl.slice(0, -1);
    }
    if (finalUrl.endsWith('/v1')) {
        finalUrl = finalUrl.slice(0, -3);
    }
    if (finalUrl.endsWith('/chat/completions')) {
        finalUrl = finalUrl.slice(0, -17);
    }

    const modelsUrl = `${finalUrl}/v1/models`;

    try {
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey || 'no-key'}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({message: response.statusText}));
            throw new Error(`Failed to fetch models: ${errorData.message || response.statusText}`);
        }

        const data = await response.json();

        // The response can be an object with a 'data' property (OpenAI standard)
        // or an array directly (some other services).
        const models = (Array.isArray(data) ? data : data.data) || [];

        return models.map(model => model.id).sort();

    } catch (error) {
        console.error('Error fetching models:', error);
        throw error; // Re-throw the error to be caught by the caller
    }
}
