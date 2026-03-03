import axios from 'axios';

/**
 * Axios instance for all AtlasMind API calls.
 *
 * withCredentials: true — ensures the httpOnly `am_token` JWT cookie is sent
 * with every request automatically. No manual connectionId needed.
 */
const api = axios.create({
    baseURL: (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '') + '/api/',
    timeout: 60000,
    withCredentials: true, // Send cookies on every request
    headers: {
        'Content-Type': 'application/json',
    },
});

// Response interceptor — log errors but preserve the full response for callers
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const message = error.response?.data?.error?.message
            || error.response?.data?.error
            || error.message
            || 'An unexpected error occurred';
        console.error('[API Error]', message);
        // IMPORTANT: re-throw the original error, not a plain Error,
        // so callers can access error.response.data (e.g. availableDatabases)
        return Promise.reject(error);
    }
);

// ─── Query API ──────────────────────────────────────────────────────────────

/**
 * Send a natural language query → MQL → execute → visualize.
 * @param {string} text
 * @returns {Promise<object>} { aiMessage, pipeline, results, chartType, ... }
 */
export async function sendQuery(text) {
    const { data } = await api.post('query', { text });
    return data;
}

/**
 * Send audio blob for speech-to-query.
 * @param {Blob} audioBlob
 * @returns {Promise<object>}
 */
export async function sendVoice(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    const { data } = await api.post('voice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
    });
    return data;
}

// ─── Schema API ─────────────────────────────────────────────────────────────

/**
 * Fetch the database schema (collections + fields) for the authenticated user's DB.
 * @param {boolean} forceRefresh
 * @returns {Promise<object>}
 */
export async function fetchSchema(forceRefresh = false) {
    const endpoint = forceRefresh ? 'schema/refresh' : 'schema';
    const { data } = await api.get(endpoint);
    return data.data || data;
}

// ─── Query History ──────────────────────────────────────────────────────────

/**
 * Fetch recent query history for the sidebar.
 * @returns {Promise<Array>}
 */
export async function fetchQueryHistory() {
    const { data } = await api.get('query/history');
    return data.data || [];
}

// ─── Dashboard API ──────────────────────────────────────────────────────────

/** @returns {Promise<Array>} */
export async function fetchDashboard() {
    const { data } = await api.get('dashboard');
    return data;
}

/**
 * @param {{ query, pipeline, collection, chartType, name? }} pin
 * @returns {Promise<object>}
 */
export async function pinToDashboard(pin) {
    const { data } = await api.post('dashboard/pin', pin);
    return data;
}

/** @param {string} pinId */
export async function removeDashboardPin(pinId) {
    await api.delete(`dashboard/${pinId}`);
}

/** @param {string} pinId */
export async function refreshDashboardPin(pinId) {
    const { data } = await api.post(`dashboard/${pinId}/refresh`);
    return data;
}

// ─── Export API ─────────────────────────────────────────────────────────────

/**
 * Export query results as JSON.
 * @param {{ query, pipeline, collection, results }} payload
 */
export async function exportQueryResults(payload) {
    const { data } = await api.post('query/export', payload);
    return data;
}

export default api;
