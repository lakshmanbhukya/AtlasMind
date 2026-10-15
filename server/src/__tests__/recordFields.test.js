'use strict';

const path = require('path');
const fs = require('fs');
const { computeRecordOutcome } = require('../../../eval2/runners/e2e_eval');

describe('A1: Standardized Record Fields', () => {
    const ALLOWED_OUTCOMES = new Set([
        'pipeline_returned',
        'asked_resolved',
        'asked_unresolved',
        'invalid_json',
        'truncated',
        'execution_error',
        'empty_result',
    ]);

    const ALLOWED_ERROR_TYPES = new Set([
        'none',
        'json_parse',
        'truncated',
        'execution_error',
        'empty_result',
        'llm_clarification',
    ]);

    test('produces pipeline_returned when valid pipeline without clarification', () => {
        const out = computeRecordOutcome({
            needsClarification: false,
            isValidPipeline: true,
            pipeline: [{ $match: { x: 1 } }],
            finishReason: 'stop',
            rawText: '{"pipeline": [{"$match": {"x": 1}}]}',
        });
        expect(out.outcome).toBe('pipeline_returned');
        expect(out.errorType).toBe('none');
        expect(out.clarificationSource).toBeNull();
        expect(out.finishReason).toBe('stop');
        expect(out.extraInteractions).toBe(0);
    });

    test('produces asked_resolved when clarification is answered with valid pipeline', () => {
        const out = computeRecordOutcome({
            needsClarification: true,
            clarificationSource: 'gate',
            isValidPipeline: true,
            pipeline: [{ $match: { revenue: { $gt: 100 } } }],
            extraInteractions: 1,
        });
        expect(out.outcome).toBe('asked_resolved');
        expect(out.errorType).toBe('none');
        expect(out.clarificationSource).toBe('gate');
        expect(out.extraInteractions).toBe(1);
    });

    test('produces asked_resolved with extraInteractions=2 when bypassed', () => {
        const out = computeRecordOutcome({
            needsClarification: true,
            clarificationSource: 'gate',
            isValidPipeline: true,
            pipeline: [{ $match: { active: true } }],
            extraInteractions: 2,
        });
        expect(out.outcome).toBe('asked_resolved');
        expect(out.errorType).toBe('none');
        expect(out.clarificationSource).toBe('gate');
        expect(out.extraInteractions).toBe(2);
    });

    test('produces asked_unresolved when clarification is asked but pipeline is empty', () => {
        const out = computeRecordOutcome({
            needsClarification: true,
            clarificationSource: 'llm',
            isValidPipeline: false,
            pipeline: [],
        });
        expect(out.outcome).toBe('asked_unresolved');
        expect(out.errorType).toBe('llm_clarification');
        expect(out.clarificationSource).toBe('llm');
    });

    test('produces truncated when finishReason is length', () => {
        const out = computeRecordOutcome({
            needsClarification: false,
            isValidPipeline: false,
            finishReason: 'length',
        });
        expect(out.outcome).toBe('truncated');
        expect(out.errorType).toBe('truncated');
    });

    test('produces invalid_json when jsonParseError is true', () => {
        const out = computeRecordOutcome({
            needsClarification: false,
            isValidPipeline: false,
            jsonParseError: true,
        });
        expect(out.outcome).toBe('invalid_json');
        expect(out.errorType).toBe('json_parse');
    });

    test('produces execution_error when executionError is true', () => {
        const out = computeRecordOutcome({
            needsClarification: false,
            isValidPipeline: true,
            executionError: true,
        });
        expect(out.outcome).toBe('execution_error');
        expect(out.errorType).toBe('execution_error');
    });

    test('produces empty_result when pipeline is empty', () => {
        const out = computeRecordOutcome({
            needsClarification: false,
            isValidPipeline: false,
            pipeline: [],
        });
        expect(out.outcome).toBe('empty_result');
        expect(out.errorType).toBe('empty_result');
    });

    test('all 300 records in e2e_raw.jsonl strictly satisfy required schema', () => {
        const e2ePath = path.resolve(__dirname, '../../../eval2/results/e2e_raw.jsonl');
        if (!fs.existsSync(e2ePath)) return;
        const records = fs.readFileSync(e2ePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

        expect(records.length).toBe(300);
        for (const r of records) {
            expect(ALLOWED_OUTCOMES.has(r.outcome)).toBe(true);
            expect(ALLOWED_ERROR_TYPES.has(r.errorType)).toBe(true);
            expect(['gate', 'llm', null].includes(r.clarificationSource)).toBe(true);
            expect([0, 1, 2].includes(r.extraInteractions)).toBe(true);
            expect(r).toHaveProperty('rawText');
            expect(r).toHaveProperty('finishReason');
        }
    });
});
