import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readQueryStream } from './queryStream';
import { blockedBodyFromError } from './conversation';
import { apiErrorMessage } from './apiError';
import { sseEvent, sseStream, STAGES } from './__fixtures__/sse';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

/** A streamed Response whose body arrives in the given chunks. */
function streamed(chunks) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

describe('readQueryStream', () => {
    it('reports each stage and resolves with the body of a 2xx result', async () => {
        const stages = [];
        const body = await readQueryStream(streamed([sseStream({ body: fixture('answer') })]), (s) => stages.push(s));
        expect(stages).toEqual(STAGES);
        expect(body).toEqual(fixture('answer'));
    });

    it('works when events are split across chunks', async () => {
        const text = sseStream({ body: { success: true, aiMessage: 'ok' } });
        const chunks = text.match(/[\s\S]{1,7}/g);
        expect(await readQueryStream(streamed(chunks))).toEqual({ success: true, aiMessage: 'ok' });
    });

    it('rejects a 422 result with the axios shape blockedBodyFromError reads', async () => {
        const err = await readQueryStream(streamed([sseStream({ status: 422, body: fixture('blocked-422') })])).catch((e) => e);
        expect(err.response).toEqual({ status: 422, data: fixture('blocked-422') });
        expect(blockedBodyFromError(err)).toMatchObject({ safetyBlocked: true });
    });

    it('rejects an engine error result with its status and message', async () => {
        const body = { success: false, error: { code: 'workspace_not_found', message: 'Workspace not found' } };
        const err = await readQueryStream(streamed([sseEvent('result', { status: 400, body })])).catch((e) => e);
        expect(err.response.status).toBe(400);
        expect(apiErrorMessage(err)).toBe('Workspace not found');
    });

    it('rejects a plain JSON error (401 from requireAuth, 429 from the limiter) the same way', async () => {
        const body = { success: false, error: { code: 'too_many_requests', message: 'Slow down' } };
        const err = await readQueryStream(json(429, body)).catch((e) => e);
        expect(err.response).toEqual({ status: 429, data: body });
    });

    it('rejects with a readable error when the stream ends without a result', async () => {
        const err = await readQueryStream(streamed([sseEvent('progress', { stage: 'scope' })])).catch((e) => e);
        expect(err.response).toBeUndefined();
        expect(err.message).toMatch(/closed before the query finished/);
    });

    it('ignores pings, events after the result, and a throwing onProgress', async () => {
        const res = streamed([': ping\n\n', sseStream({ body: { success: true } }), sseEvent('result', { status: 500, body: {} })]);
        const body = await readQueryStream(res, () => { throw new Error('ui'); });
        expect(body).toEqual({ success: true });
    });
});
