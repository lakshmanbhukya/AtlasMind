import axios from 'axios';
import { apiErrorMessage } from '../lib/apiError';

export { apiErrorMessage };

/**
 * Axios instance for all AtlasMind API calls.
 *
 * withCredentials: true — ensures the httpOnly `am_token` JWT cookie is sent
 * with every request automatically. No manual connectionId needed.
 */
const api = axios.create({
    baseURL: (import.meta.env.VITE_SERVER_URL || window.location.origin).replace(/\/$/, '') + '/api/',
    timeout: 60000,
    withCredentials: true, // Send cookies on every request
    headers: {
        'Content-Type': 'application/json',
    },
});

// Response interceptor — log errors (dev only) but preserve the full response for callers
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (import.meta.env.DEV) console.error('[API Error]', apiErrorMessage(error));
        // IMPORTANT: re-throw the original error, not a plain Error,
        // so callers can access error.response.data (e.g. availableDatabases)
        return Promise.reject(error);
    }
);

// ─── Connections API ────────────────────────────────────────────────────────

/**
 * List the non-empty databases a connection string can see (public, no session).
 * @param {string} connectionString
 * @returns {Promise<Array<{ name: string, collectionCount: number }>>}
 */
export async function listDatabases(connectionString) {
    const { data } = await api.post('connections/databases', { connectionString });
    return data.databases || [];
}

// ─── Query API ──────────────────────────────────────────────────────────────

/**
 * Send a natural language query → MQL → execute → visualize.
 * @param {{ text: string, model?: string, collections?: string[], bypassAmbiguity?: boolean,
 *           clarifications?: object, workspaceId?: string, dropMissing?: boolean, isEdit?: boolean }} payload
 * @returns {Promise<object>} { aiMessage, pipeline, results, chartType, ... }
 */
export async function sendQuery(payload) {
    const { data } = await api.post('query', payload);
    return data;
}

/**
 * Approve and execute a staged write operation.
 * @param {string} approvalToken
 * @returns {Promise<object>}
 */
export async function approveWriteQuery(approvalToken) {
    const { data } = await api.post('query/approve', { approvalToken });
    return data;
}

/**
 * Send audio blob for speech-to-query.
 * @param {Blob} audioBlob
 * @param {string} [model]
 * @param {{ collections?: string[], workspaceId?: string }} [scopeOptions] - same scope as sendQuery
 * @returns {Promise<object>}
 */
export async function sendVoice(audioBlob, model, scopeOptions = {}) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    if (model) {
        formData.append('model', model);
    }
    // Multipart fields are strings, so the collection list travels as JSON
    if (Array.isArray(scopeOptions.collections) && scopeOptions.collections.length > 0) {
        formData.append('collections', JSON.stringify(scopeOptions.collections));
    }
    if (scopeOptions.workspaceId) {
        formData.append('workspaceId', scopeOptions.workspaceId);
    }
    const { data } = await api.post('voice', formData, {
        headers: { 'Content-Type': undefined },
        timeout: 45000,
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

/**
 * Delete a specific query history item.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function deleteQueryHistoryItem(id) {
    const { data } = await api.delete(`query/history/${id}`);
    return data;
}

/**
 * Rename a query history item's display label.
 * @param {string} id
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function renameQueryHistoryItem(id, name) {
    const { data } = await api.patch(`query/history/${id}`, { name });
    return data;
}

/**
 * Pin or unpin a query history item. Pinned items always appear in the history list.
 * @param {string} id
 * @param {boolean} pinned
 * @returns {Promise<object>}
 */
export async function setQueryHistoryPinned(id, pinned) {
    const { data } = await api.patch(`query/history/${id}`, { pinned });
    return data;
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
export async function fetchSharedDashboardPin(pinId) {
    const { data } = await api.get(`dashboard/shared/${pinId}`);
    return data;
}

// ─── Workspace API ──────────────────────────────────────────────────────────

/**
 * Fetch all saved workspaces for the active connection.
 * @returns {Promise<Array>}
 */
export async function fetchWorkspaces() {
    const { data } = await api.get('workspaces');
    return data.data || data;
}

/**
 * Create a new workspace.
 * @param {{ name: string, collections: string[] }} workspaceData
 * @returns {Promise<object>}
 */
export async function createWorkspace(workspaceData) {
    const { data } = await api.post('workspaces', workspaceData);
    return data.data || data;
}

/**
 * Update an existing workspace by ID.
 * @param {string} id
 * @param {{ name?: string, collections?: string[] }} updateData
 * @returns {Promise<object>}
 */
export async function updateWorkspace(id, updateData) {
    const { data } = await api.patch(`workspaces/${id}`, updateData);
    return data.data || data;
}

/**
 * Delete a workspace by ID.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function deleteWorkspace(id) {
    const { data } = await api.delete(`workspaces/${id}`);
    return data.data || data;
}

// ─── Auth / connection API ──────────────────────────────────────────────────

/** Current session (`auth/me`). */
export async function getSession() {
    const { data } = await api.get('auth/me');
    return data;
}

export async function logout() {
    await api.post('auth/logout');
}

/** @param {{ connectionString: string, dbName: string, label?: string }} payload */
export async function connect(payload) {
    const { data } = await api.post('connections/connect', payload);
    return data;
}

export default api;
