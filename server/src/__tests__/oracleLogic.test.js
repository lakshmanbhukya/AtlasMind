'use strict';

const { resolveOracleAction } = require('../../../eval2/runners/e2e_eval');

describe('A3: Simulated User Oracle Logic', () => {
    const qObj = {
        id: 'q1',
        options: [
            { label: 'Revenue', value: 'revenue' },
            { label: 'Sales Count', value: 'sales_count' },
        ],
    };

    const firstDataWithGate = {
        needsClarification: true,
        clarificationSource: 'gate',
        questions: [qObj],
    };

    describe('Primary Oracle', () => {
        test('clear query triggers bypass with extraInteractions = 2', () => {
            const item = { id: 'clr-1', humanAmbiguous: false, goldCandidate: null };
            const res = resolveOracleAction({ item, firstData: firstDataWithGate, oracleMode: 'primary' });

            expect(res.asked).toBe(true);
            expect(res.bypassAmbiguity).toBe(true);
            expect(res.clarificationAnswer).toBeNull();
            expect(res.oracleUsed).toBe('bypass');
            expect(res.extraInteractions).toBe(2);
            expect(res.intendedMetricNotOffered).toBe(false);
        });

        test('ambiguous query with gold in offered options picks strict gold with extraInteractions = 1', () => {
            const item = { id: 'amb-1', humanAmbiguous: true, goldCandidate: 'revenue' };
            const res = resolveOracleAction({ item, firstData: firstDataWithGate, oracleMode: 'primary' });

            expect(res.asked).toBe(true);
            expect(res.bypassAmbiguity).toBe(false);
            expect(res.clarificationAnswer).toEqual({ id: 'q1', value: 'revenue' });
            expect(res.oracleUsed).toBe('strict_offered');
            expect(res.extraInteractions).toBe(1);
            expect(res.intendedMetricNotOffered).toBe(false);
        });

        test('ambiguous query with gold NOT in offered options triggers bypass with extraInteractions = 2', () => {
            const item = { id: 'amb-2', humanAmbiguous: true, goldCandidate: 'unoffered_metric' };
            const res = resolveOracleAction({ item, firstData: firstDataWithGate, oracleMode: 'primary' });

            expect(res.asked).toBe(true);
            expect(res.bypassAmbiguity).toBe(true);
            expect(res.clarificationAnswer).toBeNull();
            expect(res.oracleUsed).toBe('bypass');
            expect(res.extraInteractions).toBe(2);
            expect(res.intendedMetricNotOffered).toBe(true);
        });
    });

    describe('Secondary Oracle Flags', () => {
        test('lenient_other enters gold candidate via __other__ when gold is not offered', () => {
            const item = { id: 'amb-3', humanAmbiguous: true, goldCandidate: 'custom_margin' };
            const res = resolveOracleAction({ item, firstData: firstDataWithGate, oracleMode: 'lenient_other' });

            expect(res.asked).toBe(true);
            expect(res.bypassAmbiguity).toBe(false);
            expect(res.clarificationAnswer).toEqual({ id: 'q1', value: '__other__', customText: 'custom_margin' });
            expect(res.oracleUsed).toBe('lenient_other');
            expect(res.extraInteractions).toBe(1);
            expect(res.intendedMetricNotOffered).toBe(true);
        });

        test('wrong_pick sensitivity picks offeredOptions[0] on clear query', () => {
            const item = { id: 'clr-2', humanAmbiguous: false, goldCandidate: null };
            const res = resolveOracleAction({ item, firstData: firstDataWithGate, oracleMode: 'wrong_pick' });

            expect(res.asked).toBe(true);
            expect(res.bypassAmbiguity).toBe(false);
            expect(res.clarificationAnswer).toEqual({ id: 'q1', value: 'revenue' });
            expect(res.oracleUsed).toBe('wrong_pick');
            expect(res.extraInteractions).toBe(1);
        });
    });

    describe('Unambiguous / No Clarification', () => {
        test('returns asked: false and extraInteractions: 0 when needsClarification is false', () => {
            const item = { id: 'clr-3', humanAmbiguous: false };
            const res = resolveOracleAction({ item, firstData: { needsClarification: false } });

            expect(res.asked).toBe(false);
            expect(res.oracleUsed).toBe('none');
            expect(res.extraInteractions).toBe(0);
        });
    });
});
