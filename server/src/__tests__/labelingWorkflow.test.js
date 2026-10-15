'use strict';

const fs = require('fs');
const path = require('path');
const { computeKappa, validateLabels, calculateAgreementStats } = require('../../../eval2/benchmark/kappa');

describe('Human Labeling Workflow (eval2/benchmark)', () => {
    const labelingSheetPath = path.resolve(__dirname, '../../../eval2/benchmark/labeling_sheet.csv');
    const llmLabelsPath = path.resolve(__dirname, '../../../eval2/benchmark/llm_labels.csv');
    const guidePath = path.resolve(__dirname, '../../../eval2/benchmark/LABELING_GUIDE.md');
    const testSplitPath = path.resolve(__dirname, '../../../eval2/benchmark/test_split.jsonl');

    test('1. LABELING_GUIDE.md exists and defines ambiguity operational criteria', () => {
        expect(fs.existsSync(guidePath)).toBe(true);
        const guide = fs.readFileSync(guidePath, 'utf8');
        expect(guide).toContain('at least two plausible numeric measures');
        expect(guide).toContain('1 = ambiguous');
        expect(guide).toContain('0 = clear');
        expect(guide).toContain('No Code Inspection');
    });

    test('2. llm_labels.csv preserves LLM labels separately', () => {
        expect(fs.existsSync(llmLabelsPath)).toBe(true);
        const content = fs.readFileSync(llmLabelsPath, 'utf8');
        const lines = content.trim().split('\n');
        expect(lines.length).toBe(331); // 1 header + 330 queries

        const header = lines[0].split(',');
        expect(header).toEqual([
            'id', 'dataset', 'scope', 'text', 'offered_options', 'doubleLabel', 'llmLabelA', 'llmLabelB', 'llmFinal', 'note'
        ]);
    });

    test('3. labeling_sheet.csv has EMPTY labelerA/B/finalLabel/note and marks 91 double-label rows', () => {
        expect(fs.existsSync(labelingSheetPath)).toBe(true);
        const content = fs.readFileSync(labelingSheetPath, 'utf8');
        const lines = content.trim().split('\n');
        expect(lines.length).toBe(331); // 1 header + 330 queries

        const header = lines[0].split(',');
        expect(header).toEqual([
            'id', 'dataset', 'scope', 'text', 'offered_options', 'doubleLabel', 'labelerA', 'labelerB', 'finalLabel', 'note'
        ]);

        let doubleCount = 0;
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            // The doubleLabel is the 6th column (index 5)
            // But since text and offered_options can contain commas inside quotes, let's verify via endsWith
            expect(lines[i].endsWith(',,,,')).toBe(true); // labelerA, labelerB, finalLabel, note are all empty!
            if (lines[i].includes(',1,,,,') || lines[i].includes('",1,,,,')) {
                doubleCount++;
            }
        }
        expect(doubleCount).toBe(91);
    });

    test('4. test_split.jsonl has llmAmbiguous and humanAmbiguous = null', () => {
        const queries = fs.readFileSync(testSplitPath, 'utf8').trim().split('\n').map(JSON.parse);
        expect(queries.length).toBe(330);
        for (const q of queries) {
            expect(q.humanAmbiguous).toBeNull();
            expect(typeof q.llmAmbiguous).toBe('boolean');
        }
    });

    test('5. kappa.js refuses to run while doubleLabel rows have empty annotations', () => {
        const res = computeKappa();
        expect(res.refused).toBe(true);
        expect(res.pendingCount).toBe(91);
    });

    test('6. calculateAgreementStats correctly computes Po, Pe, Cohen kappa, and PABAK', () => {
        // Synthetic paired ratings
        const pairs = [
            { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, // 4 both clear
            { a: 1, b: 1 }, { a: 1, b: 1 }, // 2 both amb
            { a: 0, b: 1 }, // 1 disagreement
        ];
        const stats = calculateAgreementStats(pairs, 'a', 'b');
        expect(stats.N).toBe(7);
        expect(stats.totalAgreed).toBe(6);
        expect(stats.Po).toBeCloseTo(6 / 7, 3);
        // PABAK = 2*Po - 1
        expect(stats.pabak).toBeCloseTo(2 * (6 / 7) - 1, 3);
        expect(stats.kappa).toBeGreaterThan(0);
    });

    test('7. validateLabels fails while finalLabel is empty and reports diff count', () => {
        const res = validateLabels();
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('empty_final_labels');
    });
});
