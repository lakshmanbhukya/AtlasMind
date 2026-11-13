/**
 * Best human-readable message for a failed request.
 * Pure (no `window`, no `import.meta.env`), so node unit tests can import it.
 * @param {unknown} err
 * @param {string} [fallback]
 */
export function apiErrorMessage(err, fallback = 'An unexpected error occurred') {
    const data = err?.response?.data;
    const fromBody = data?.error?.message || (typeof data?.error === 'string' ? data.error : null);
    return fromBody || err?.message || fallback;
}
