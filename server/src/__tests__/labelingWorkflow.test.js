'use strict';

const fs = require('fs');
const path = require('path');
const { computeKappa, validateLabels } = require('../../../eval2/benchmark/kappa');

describe('Human Labeling Workflow (eval2/benchmark)', () => {
    const labelingSheetPath = path.resolve(__dirname, '../../../eval2/benchmark/labeling_sheet.csv');
    const disagreementsPath = path.resolve(__dirname, '../../../eval2/benchmark/disagreements.csv');
    const guidePath = path.resolve(__dirname, '../../../eval2/benchmark/LABELING_GUIDE.md');

    test('LABELING_GUIDE.md exists and defines ambiguity operational criteria', () => {
        expect(fs.existsSync(guidePath)).toBe(true);
        const guide = fs.readFileSync(guidePath, 'utf8');
        expect(guide).toContain('at least two plausible numeric measures');
        expect(guide).toContain('1 = ambiguous');
        expect(guide).toContain('0 = clear');
        expect(guide).toContain('No Code Inspection');
    });

    test('labeling_sheet.csv has exactly 9 required columns and excludes gate/predicted labels', () => {
        expect(fs.existsSync(labelingSheetPath)).toBe(true);
        const content = fs.readFileSync(labelingSheetPath, 'utf8');
        const lines = content.trim().split('\n');
        expect(lines.length).toBe(331); // 1 header + 330 queries

        const header = lines[0].split(',');
        expect(header).toEqual([
            'id', 'dataset', 'scope', 'text', 'offered_options', 'labelerA', 'labelerB', 'finalLabel', 'note'
        ]);

        // Verify prohibited fields are absent
        expect(header).not.toContain('gateTerms');
        expect(header).not.toContain('category');
        expect(header).not.toContain('originalGptCategory');
        expect(header).not.toContain('prediction');
    });

    test('computeKappa computes valid agreement metrics on stratified sample (N >= 80)', () => {
        const stats = computeKappa();
        expect(stats.N).toBeGreaterThanOrEqual(80);
        expect(stats.Po).toBeGreaterThan(0.90); // > 90% observed agreement
        expect(stats.kappa).toBeGreaterThan(0.80); // Strong substantial agreement
        expect(stats.totalAgreed + stats.totalDisagreed).toBe(stats.N);

        expect(fs.existsSync(disagreementsPath)).toBe(true);
        const disContent = fs.readFileSync(disagreementsPath, 'utf8').trim().split('\n');
        expect(disContent.length).toBeGreaterThan(1); // At least 1 disagreement recorded
    });

    test('validateLabels confirms all 330 queries match finalLabel with 0 diffs and no empty labels', () => {
        const res = validateLabels();
        expect(res.valid).toBe(true);
        expect(res.diffCount).toBe(0);
    });
});
