'use strict';

const { buildSystemPrompt } = require('../prompts/systemPrompt');
const { classifyExecution } = require('../services/safetyGuard');

// The prompt must describe the same write rule the Safe Execution verdict enforces (ADR 0004).
describe('System prompt write rules match the guard', () => {
    const prompt = buildSystemPrompt('schema context', [], {});

    test('allows only a single final $out/$merge, on explicit request, with approval', () => {
        expect(prompt).toContain('a single $out or $merge as the LAST stage');
        expect(prompt).toContain('EXPLICITLY asks to save, copy, export or materialize');
        expect(prompt).toContain('must approve every write');
        expect(prompt).not.toContain('NEVER use write operations: $out, $merge');
    });

    test('does not call $set/$unset stages writes', () => {
        expect(prompt).not.toMatch(/\$set \(as stage\)/);
        expect(prompt).toContain('$set and $unset only reshape documents');
    });

    test('still refuses in-place updates and deletes', () => {
        expect(prompt).toContain("I can't delete or update documents in place.");
    });

    test('the prompt examples are approvable writes for the guard', () => {
        const read = { $match: { status: 'paid' } };
        for (const write of [
            { $out: 'orders_archive' },
            { $merge: { into: 'orders_archive', whenMatched: 'replace', whenNotMatched: 'insert' } },
        ]) {
            const verdict = classifyExecution({ collection: 'orders', pipeline: [read, write], scope: null, tenantDatabase: 'salesDB' });
            expect(verdict.kind).toBe('needs_approval');
        }
    });
});
