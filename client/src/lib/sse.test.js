import { describe, it, expect } from 'vitest';
import { createSseParser } from './sse';
import { sseStream, STAGES } from './__fixtures__/sse';

function parseAll(chunks) {
    const events = [];
    const parser = createSseParser((e) => events.push(e));
    chunks.forEach((c) => parser.push(c));
    parser.end();
    return events;
}

describe('createSseParser', () => {
    it('parses event and data fields', () => {
        expect(parseAll(['event: progress\ndata: {"stage":"scope"}\n\n'])).toEqual([
            { event: 'progress', data: '{"stage":"scope"}' },
        ]);
    });

    it('handles any chunk boundary, including inside a field name and between CR and LF', () => {
        const text = 'event: progress\r\ndata: {"stage":"schema"}\r\n\r\nevent: result\r\ndata: {"status":200}\r\n\r\n';
        const expected = [
            { event: 'progress', data: '{"stage":"schema"}' },
            { event: 'result', data: '{"status":200}' },
        ];
        for (let i = 1; i < text.length; i++) {
            expect(parseAll([text.slice(0, i), text.slice(i)])).toEqual(expected);
        }
        expect(parseAll(text.split(''))).toEqual(expected);
    });

    it('joins multi-line data with newlines', () => {
        expect(parseAll(['data: line one\ndata: line two\n\n'])).toEqual([{ event: 'message', data: 'line one\nline two' }]);
    });

    it('skips comments (keep-alive pings) and events without data', () => {
        expect(parseAll([': ping\n\n', 'event: progress\n\n', ': ping\nevent: result\ndata: {}\n\n'])).toEqual([
            { event: 'result', data: '{}' },
        ]);
    });

    it('accepts a field without the optional space, and CR-only line endings', () => {
        expect(parseAll(['event:result\rdata:{"a":1}\r\r'])).toEqual([{ event: 'result', data: '{"a":1}' }]);
    });

    it('dispatches a final event without its trailing blank line on end()', () => {
        expect(parseAll(['event: result\ndata: {"status":200}'])).toEqual([{ event: 'result', data: '{"status":200}' }]);
    });

    it('reads the fixture builder the e2e stubs use', () => {
        const events = parseAll([sseStream({ status: 422, body: { success: false } })]);
        expect(events.map((e) => e.event)).toEqual([...STAGES.map(() => 'progress'), 'result']);
        expect(JSON.parse(events.at(-1).data)).toEqual({ status: 422, body: { success: false } });
    });
});
