'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
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

    test('3. Review sheets and PROCEDURE.md contain completed human inputs', () => {
        // b_relabel.csv: exactly 8 completed relabel rows, no labelerA column
        expect(fs.existsSync(bRelabelPath)).toBe(true);
        const bContent = fs.readFileSync(bRelabelPath, 'utf8').trim().split('\n');
        expect(bContent.length).toBe(9); // header + 8 rows
        expect(bContent[0]).not.toContain('labelerA');

        // Verify each row has an adjudicated labelerB value (0 or 1)
        for (let i = 1; i < bContent.length; i++) {
            const row = bContent[i];
            expect(row).toMatch(/,[01],/);
        }

        // needs_human_decision.csv: exactly 6 adjudicated rows
        expect(fs.existsSync(needsDecisionPath)).toBe(true);
        const nhdContent = fs.readFileSync(needsDecisionPath, 'utf8').trim().split('\n');
        expect(nhdContent.length).toBe(7); // header + 6 rows
        const nhdHeader = nhdContent[0].split(',').map((h) => h.trim());
        expect(nhdHeader).toEqual(['id', 'dataset', 'scope', 'text', 'offered_options', 'labelerA', 'labelerB', 'finalLabel', 'note']);
        for (let i = 1; i < nhdContent.length; i++) {
            const parts = nhdContent[i].split(',');
            // finalLabel is not empty and is 0 or 1
            expect(nhdContent[i]).toMatch(/,[01],/);
        }

        // agent_suggestions.csv: separate file for optional human reference
        expect(fs.existsSync(suggestionsPath)).toBe(true);

        // PROCEDURE.md: defines protocol fields with confirmed human inputs
        expect(fs.existsSync(procedurePath)).toBe(true);
        const meta = loadProcedureMetadata();
        expect(meta).toHaveProperty('pass1_annotatorA');
        expect(meta).toHaveProperty('pass1_annotatorB');
        expect(meta).toHaveProperty('pass1_blind');
        expect(meta).toHaveProperty('relabel_blind');
        expect(meta.isConfirmed).toBe(true);
    });

    test('4. test_split.jsonl has finalized humanAmbiguous and preserves llmAmbiguous', () => {
        const queries = fs.readFileSync(testSplitPath, 'utf8').trim().split('\n').map(JSON.parse);
        expect(queries.length).toBe(330);
        let ambCount = 0;
        let clrCount = 0;
        for (const q of queries) {
            expect(typeof q.humanAmbiguous).toBe('boolean');
            expect(typeof q.llmAmbiguous).toBe('boolean');
            if (q.humanAmbiguous) ambCount++;
            else clrCount++;
        }
        expect(ambCount).toBe(83);
        expect(clrCount).toBe(247);
    });

    test('5. kappa.js computes agreement on merged sheet and refuses on missing doubleLabel cells', () => {
        // Live production merged sheet
        const res = computeKappa();
        expect(res.refused).toBe(false);
        expect(res.pendingCount).toBe(0);
        expect(res.totalDesignated).toBe(91);

        // Stratified designated 91 rows agreement: 100% agreement, kappa = 1.0
        expect(res.designatedStats).toBeDefined();
        expect(res.designatedStats.N).toBe(91);
        expect(res.designatedStats.Po).toBe(1.0);
        expect(res.designatedStats.kappa).toBe(1.0);

        // All 95 double-labeled rows: 97.89% agreement, kappa = 0.9568
        expect(res.allTwoLabelStats).toBeDefined();
        expect(res.allTwoLabelStats.N).toBe(95);
        expect(res.allTwoLabelStats.totalAgreed).toBe(93);
        expect(res.allTwoLabelStats.kappa).toBeCloseTo(0.9568, 3);

        // Refusal guard check with an incomplete sheet fixture
        const tmpSheet = path.join(os.tmpdir(), `test_labeling_${Date.now()}.csv`);
        const incompleteCsv = [
            'id,dataset,scope,text,offered_options,doubleLabel,labelerA,labelerB,finalLabel,note',
            'q-001,sample,scope,query 1,opt,1,1,,,', // doubleLabel=1 but labelerB is missing
            'q-002,sample,scope,query 2,opt,0,0,,,',
        ].join('\n') + '\n';
        fs.writeFileSync(tmpSheet, incompleteCsv, 'utf8');

        try {
            const refusalRes = computeKappa({ sheetPath: tmpSheet });
            expect(refusalRes.refused).toBe(true);
            expect(refusalRes.pendingCount).toBe(1);
            expect(refusalRes.pendingIds).toEqual(['q-001']);
        } finally {
            if (fs.existsSync(tmpSheet)) fs.unlinkSync(tmpSheet);
        }
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

    test('7. validateLabels succeeds on merged data and fails on missing double-label rows', () => {
        // Merged production state
        const res = validateLabels();
        expect(res.valid).toBe(true);
        expect(res.diffCount).toBe(0);

        // Failure guard check with incomplete sheet
        const tmpSheet = path.join(os.tmpdir(), `test_val_${Date.now()}.csv`);
        const incompleteCsv = [
            'id,dataset,scope,text,offered_options,doubleLabel,labelerA,labelerB,finalLabel,note',
            'q-001,sample,scope,query 1,opt,1,1,,,', // doubleLabel=1 but missing labelerB
        ].join('\n') + '\n';
        fs.writeFileSync(tmpSheet, incompleteCsv, 'utf8');

        try {
            const refusalRes = validateLabels({ sheetPath: tmpSheet });
            expect(refusalRes.valid).toBe(false);
            expect(refusalRes.reason).toBe('missing_double_label_b');
            expect(refusalRes.count).toBe(1);
        } finally {
            if (fs.existsSync(tmpSheet)) fs.unlinkSync(tmpSheet);
        }
    });
});
