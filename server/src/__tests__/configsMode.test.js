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
});
