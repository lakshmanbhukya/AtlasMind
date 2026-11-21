/**
 * Builders for POST /api/query/stream bodies, shared by the unit tests and the
 * Playwright stubs (tests/e2e/chat.spec.ts).
 */

export const STAGES = ['scope', 'schema', 'ambiguity', 'generating', 'safety', 'executing'];

/** One SSE event block. */
export const sseEvent = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * A full stream: a progress event per stage, then the one `result` event.
 * @param {{ status?: number, body: unknown, stages?: string[] }} reply
 */
export function sseStream({ status = 200, body, stages = STAGES }) {
    return stages.map((stage) => sseEvent('progress', { stage })).join('') + sseEvent('result', { status, body });
}
