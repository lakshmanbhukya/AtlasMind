'use strict';

const { buildSystemPrompt } = require('../prompts/systemPrompt');

describe('A2: Configs Prompt Mode Validation', () => {
    test('C0a: forceFinalQueryMode === true uses FINAL QUERY MODE and omits CLARIFICATION MODE', () => {
        const prompt = buildSystemPrompt('schema context', [], { forceFinalQueryMode: true });
        expect(prompt).toContain('## FINAL QUERY MODE (REQUIRED)');
        expect(prompt).toContain('DO NOT return needsClarification:true');
        expect(prompt).not.toContain('### CLARIFICATION MODE');
    });

    test('C0b: default options uses CLARIFICATION MODE and allows needsClarification', () => {
        const prompt = buildSystemPrompt('schema context', [], {});
        expect(prompt).toContain('### CLARIFICATION MODE');
        expect(prompt).toContain('needsClarification": true');
        expect(prompt).not.toContain('## FINAL QUERY MODE (REQUIRED)');
    });

    test('isClarificationPass === true forces FINAL QUERY MODE', () => {
        const prompt = buildSystemPrompt('schema context', [], { isClarificationPass: true });
        expect(prompt).toContain('## FINAL QUERY MODE (REQUIRED)');
        expect(prompt).not.toContain('### CLARIFICATION MODE');
    });

    test('disableClarificationMode === true forces FINAL QUERY MODE', () => {
        const prompt = buildSystemPrompt('schema context', [], { disableClarificationMode: true });
        expect(prompt).toContain('## FINAL QUERY MODE (REQUIRED)');
        expect(prompt).not.toContain('### CLARIFICATION MODE');
    });
    test('default prompt stays read-only and has no SAVE RESULTS MODE', () => {
        const prompt = buildSystemPrompt('schema context', [], {});
        expect(prompt).toContain('2. NEVER use write operations: $out, $merge');
        expect(prompt).toContain('NEVER generate pipelines that modify, delete, or write data');
        expect(prompt).not.toContain('SAVE RESULTS MODE');
    });

    test('allowWriteStage adds SAVE RESULTS MODE and still refuses delete/update', () => {
        const prompt = buildSystemPrompt('schema context', [], { allowWriteStage: true });
        expect(prompt).toContain('## SAVE RESULTS MODE');
        expect(prompt).toContain('EXACTLY ONE final stage');
        expect(prompt).toContain('whenMatched');
        expect(prompt).toContain('If the user asks to delete, update, or modify data, respond with:');
        expect(prompt).toContain('I can only generate read-only queries.');
        expect(prompt).not.toContain('2. NEVER use write operations: $out, $merge');
    });
});
