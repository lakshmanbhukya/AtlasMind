'use strict';

const fs = require('fs');
const path = require('path');
const {
    computeKappa,
    validateLabels,
    calculateAgreementStats,
    loadProcedureMetadata,
    getDesignatedAdjudicationIds,
} = require('../../../eval2/benchmark/kappa');

describe('Human Labeling Workflow (eval2/benchmark)', () => {
    const labelingSheetPath = path.resolve(__dirname, '../../../eval2/benchmark/labeling_sheet.csv');
    const llmLabelsPath = path.resolve(__dirname, '../../../eval2/benchmark/llm_labels.csv');
    const guidePath = path.resolve(__dirname, '../../../eval2/benchmark/LABELING_GUIDE.md');
    const testSplitPath = path.resolve(__dirname, '../../../eval2/benchmark/test_split.jsonl');
    const bRelabelPath = path.resolve(__dirname, '../../../eval2/benchmark/b_relabel.csv');
    const needsDecisionPath = path.resolve(__dirname, '../../../eval2/benchmark/needs_human_decision.csv');
    const suggestionsPath = path.resolve(__dirname, '../../../eval2/benchmark/agent_suggestions.csv');
    const procedurePath = path.resolve(__dirname, '../../../eval2/benchmark/PROCEDURE.md');

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

    test('3. Review sheets and PROCEDURE.md generated correctly', () => {
        // b_relabel.csv: exactly 8 rows, empty labelerB, no labelerA column
        expect(fs.existsSync(bRelabelPath)).toBe(true);
        const bContent = fs.readFileSync(bRelabelPath, 'utf8').trim().split('\n');
        expect(bContent.length).toBe(9); // header + 8 rows
        const bHeader = bContent[0].split(',');
        expect(bHeader).toEqual(['id', 'scope', 'text', 'offered_options', 'labelerB']);
        expect(bHeader).not.toContain('labelerA');
        for (let i = 1; i < bContent.length; i++) {
            expect(bContent[i].endsWith(',')).toBe(true); // empty labelerB
        }

        // needs_human_decision.csv: exactly 6 rows, empty finalLabel and note
        expect(fs.existsSync(needsDecisionPath)).toBe(true);
        const nhdContent = fs.readFileSync(needsDecisionPath, 'utf8').trim().split('\n');
        expect(nhdContent.length).toBe(7); // header + 6 rows
        const nhdHeader = nhdContent[0].split(',');
        expect(nhdHeader).toEqual(['id', 'dataset', 'scope', 'text', 'offered_options', 'labelerA', 'labelerB', 'finalLabel', 'note']);

        // agent_suggestions.csv: separate file for optional human reference
        expect(fs.existsSync(suggestionsPath)).toBe(true);

        // PROCEDURE.md: defines protocol fields
        expect(fs.existsSync(procedurePath)).toBe(true);
        const meta = loadProcedureMetadata();
        expect(meta).toHaveProperty('pass1_annotatorA');
        expect(meta).toHaveProperty('pass1_annotatorB');
        expect(meta).toHaveProperty('pass1_blind');
        expect(meta).toHaveProperty('relabel_blind');
    });

    test('4. test_split.jsonl has llmAmbiguous and humanAmbiguous = null (pending merge)', () => {
        const queries = fs.readFileSync(testSplitPath, 'utf8').trim().split('\n').map(JSON.parse);
        expect(queries.length).toBe(330);
        for (const q of queries) {
            expect(q.humanAmbiguous).toBeNull();
            expect(typeof q.llmAmbiguous).toBe('boolean');
        }
    });

    test('5. kappa.js refuses execution while designated doubleLabel rows lack labelerB', () => {
        const res = computeKappa();
        expect(res.refused).toBe(true);
        expect(res.pendingCount).toBe(4);
        expect(res.pendingIds).toEqual(['mflix-0307', 'mflix-0312', 'mflix-0315', 'mflix-0321']);
        expect(res.totalDesignated).toBe(91);

        // Dual subset reporting exists in output
        expect(res.designatedStats).toBeDefined();
        expect(res.allTwoLabelStats).toBeDefined();
        expect(res.allTwoLabelStats.N).toBe(91);
    });

    test('6. calculateAgreementStats correctly computes Po, Pe, Cohen kappa, and PABAK', () => {
        const pairs = [
            { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, // 4 both clear
            { a: 1, b: 1 }, { a: 1, b: 1 }, // 2 both amb
            { a: 0, b: 1 }, // 1 disagreement
        ];
        const stats = calculateAgreementStats(pairs, 'a', 'b');
        expect(stats.N).toBe(7);
        expect(stats.totalAgreed).toBe(6);
        expect(stats.Po).toBeCloseTo(6 / 7, 3);
        expect(stats.pabak).toBeCloseTo(2 * (6 / 7) - 1, 3);
        expect(stats.kappa).toBeGreaterThan(0);
    });

    test('7. validateLabels fails while designated double-label rows lack labelerB', () => {
        const res = validateLabels();
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('missing_double_label_b');
        expect(res.count).toBe(4);
    });
});
