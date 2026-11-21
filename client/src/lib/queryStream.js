import { createSseParser } from './sse';

/**
 * Read a POST /api/query/stream response.
 *
 * Resolves with the response body on a 2xx `result`, and otherwise rejects with
 * an axios-shaped `{ response: { status, data } }`, so callers (the Conversation
 * reducer's `failed` path: blockedBodyFromError, errorTurn) treat it exactly like
 * a failed `sendQuery`. A response that is not an event stream (requireAuth's 401,
 * llmLimiter's 429) is read as JSON the same way.
 *
 * Pure apart from the Response it is given, so node unit tests can drive it.
 *
 * @param {Response} res
 * @param {(stage: string) => void} [onProgress]
 * @returns {Promise<object>}
 */
export async function readQueryStream(res, onProgress) {
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/event-stream')) {
        let data = null;
        try {
            data = await res.json();
        } catch {
            data = null;
        }
        if (res.ok) return data;
        throw httpError(res.status, data);
    }

    let result = null;
    const parser = createSseParser(({ event, data }) => {
        if (result) return;
        let payload;
        try {
            payload = JSON.parse(data);
        } catch {
            return;
        }
        if (event === 'progress' && payload && typeof payload.stage === 'string') {
            try {
                onProgress?.(payload.stage);
            } catch {
                // a UI callback must never break the request
            }
        } else if (event === 'result' && payload && typeof payload.status === 'number') {
            result = payload;
        }
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
        if (result) {
            reader.cancel().catch(() => {});
            break;
        }
    }
    if (!result) {
        parser.push(decoder.decode());
        parser.end();
    }

    if (!result) {
        throw new Error('The connection closed before the query finished. Please try again.');
    }
    if (result.status >= 200 && result.status < 300) return result.body;
    throw httpError(result.status, result.body);
}

function httpError(status, data) {
    const message = data?.error?.message || `Request failed with status code ${status}`;
    return Object.assign(new Error(message), { response: { status, data } });
}
