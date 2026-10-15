'use strict';

const {
    computeWilsonCI,
    computePairedBootstrap,
    computeExactMcNemar,
    compareMultisets,
    normalizeValue,
} = require('../../../eval2/runners/aggregate');

describe('A4: Aggregate Statistics & Normalization Math', () => {
    describe('Wilson Score CI', () => {
        test('computes exact Wilson CI for 73/108 (67.6%)', () => {
            const ci = computeWilsonCI(73, 108);
            expect(ci.mean).toBeCloseTo(0.6759, 3);
            expect(ci.lower).toBeGreaterThan(0.57);
            expect(ci.lower).toBeLessThan(0.60);
            expect(ci.upper).toBeGreaterThan(0.74);
            expect(ci.upper).toBeLessThan(0.77);
            expect(ci.pointPct).toBe('67.6%');
        });

        test('computes exact UCR Wilson CI for 77/210 (36.7%)', () => {
            const ci = computeWilsonCI(77, 210);
            expect(ci.pointPct).toBe('36.7%');
            expect(ci.lower).toBeCloseTo(0.304, 2);
            expect(ci.upper).toBeCloseTo(0.434, 2);
        });

        test('handles 0/35 cleanly without throwing', () => {
            const ci = computeWilsonCI(0, 35);
            expect(ci.pointPct).toBe('0.0%');
            expect(ci.lower).toBe(0);
            expect(ci.upper).toBeGreaterThan(0);
        });
    });

    describe('Paired Bootstrap Difference CI', () => {
        test('computes negative difference when C2 reduces errors over C0b', () => {
            const arr0b = [1, 1, 1, 1, 0, 0];
            const arrC2 = [0, 0, 0, 0, 0, 0];
            const res = computePairedBootstrap(arr0b, arrC2, 500);

            expect(res.diffMean).toBeGreaterThan(0);
            expect(res.lower).toBeGreaterThan(0);
        });
    });

    describe('Exact McNemar Paired Test', () => {
        test('matches binomial exact p-value for b=28, c=0', () => {
            const res = computeExactMcNemar(28, 0);
            expect(res.b).toBe(28);
            expect(res.c).toBe(0);
            expect(res.pValue).toBeCloseTo(7.45e-9, 10);
            expect(res.significant).toBe(true);
            expect(res.pDisplay).toBe('7.45e-9');
        });

        test('returns 1.0 when no discordant pairs exist (b=0, c=0)', () => {
            const res = computeExactMcNemar(0, 0);
            expect(res.pValue).toBe(1.0);
            expect(res.significant).toBe(false);
        });
    });

    describe('Multiset Normalization & Result Matching', () => {
        test('normalizes floats to 4 decimals and converts Decimal128 to number', () => {
            const dec = { _bsontype: 'Decimal128', toString: () => '123.456789' };
            expect(normalizeValue(dec)).toBe(123.4568);

            const num = 45.67891;
            expect(normalizeValue(num)).toBe(45.6789);
        });

        test('correctly compares unordered multisets of documents', () => {
            const doc1 = [{ name: 'A', total: 100.00001 }, { name: 'B', total: 200 }];
            const doc2 = [{ name: 'B', total: 200.00004 }, { name: 'A', total: 100 }];

            expect(compareMultisets(doc1, doc2)).toBe(true);
        });

        test('rejects different multisets', () => {
            const doc1 = [{ name: 'A', total: 100 }];
            const doc2 = [{ name: 'A', total: 101 }];

            expect(compareMultisets(doc1, doc2)).toBe(false);
        });
    });
});
