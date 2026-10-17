'use strict';

const path = require('path');
const fs = require('fs');

const { joinGroundTruthToRecords, runAggregation } = require('../../../eval2/runners/aggregate');
const { joinGroundTruthToQueries, loadGroundTruthMap } = require('../../../eval2/runners/e2e_eval');
const {
  validateSingleApiKey,
  estimateTokensForQueries,
  updateSupersededRecords,
  runTargetedRerun,
} = require('../../../eval2/runners/run_targeted_reeval');

describe('Phase 2: Ground Truth Join Architecture & Runner Hardening', () => {

  // -------------------------------------------------------------------------
  // 1. Ground Truth Join in aggregate.js
  // -------------------------------------------------------------------------
  describe('aggregate.js ground truth join', () => {
    let warnSpy;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('ignores stored humanAmbiguous in raw records and uses test_split value for scoring', () => {
      const groundTruthMap = new Map([
        ['q-1', { id: 'q-1', humanAmbiguous: true, category: 'AMB_LEX', scopeCapable: true }],
        ['q-2', { id: 'q-2', humanAmbiguous: false, category: 'CLR_PLAIN', scopeCapable: true }],
      ]);

      const rawRecords = [
        {
          queryId: 'q-1',
          config: 'C0a',
          humanAmbiguous: false, // stored claims false, but test_split says true
          needsClarification: false,
          isValidPipeline: true,
          isSilentAssumption: false,
        },
        {
          queryId: 'q-2',
          config: 'C0a',
          humanAmbiguous: true, // stored claims true, but test_split says false
          needsClarification: false,
          isValidPipeline: true,
          isSilentAssumption: true,
        },
      ];

      const active = joinGroundTruthToRecords(rawRecords, groundTruthMap);

      expect(active).toHaveLength(2);
      // q-1 must be evaluated as ambiguous
      expect(active[0].humanAmbiguous).toBe(true);
      expect(active[0].isSilentAssumption).toBe(true); // ambiguous + !asked + valid = silent assumption!

      // q-2 must be evaluated as clear
      expect(active[1].humanAmbiguous).toBe(false);
      expect(active[1].isSilentAssumption).toBe(false); // clear queries cannot have silent assumptions
    });

    test('emits [GROUND TRUTH DRIFT] warning when stored humanAmbiguous differs from test_split', () => {
      const groundTruthMap = new Map([
        ['q-1', { id: 'q-1', humanAmbiguous: true, category: 'AMB_LEX' }],
      ]);

      const rawRecords = [
        {
          queryId: 'q-1',
          config: 'C2',
          humanAmbiguous: false, // drift
        },
      ];

      joinGroundTruthToRecords(rawRecords, groundTruthMap);

      expect(warnSpy).toHaveBeenCalled();
      const warningText = warnSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(warningText).toContain('[GROUND TRUTH DRIFT]');
      expect(warningText).toContain('q-1');
      expect(warningText).toContain('stored=false != test_split=true');
    });

    test('excludes superseded records from active evaluation lines', () => {
      const groundTruthMap = new Map([
        ['q-1', { id: 'q-1', humanAmbiguous: true }],
      ]);

      const rawRecords = [
        {
          recordId: 'rec_old',
          queryId: 'q-1',
          config: 'C0a',
          humanAmbiguous: true,
          supersededBy: 'rec_new', // superseded
        },
        {
          recordId: 'rec_new',
          queryId: 'q-1',
          config: 'C0a',
          humanAmbiguous: true,
          supersededBy: null, // active
        },
      ];

      const active = joinGroundTruthToRecords(rawRecords, groundTruthMap);
      expect(active).toHaveLength(1);
      expect(active[0].recordId).toBe('rec_new');
    });

    test('runAggregation throws error if test_split.jsonl contains humanAmbiguous = null', async () => {
      const tmpDir = path.resolve(__dirname, 'tmp_agg_test');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const testSplitFile = path.join(tmpDir, 'test_split_unmerged.jsonl');
      fs.writeFileSync(testSplitFile, JSON.stringify({ id: 'test-1', humanAmbiguous: null }) + '\n');

      await expect(
        runAggregation({
          testSplitPath: testSplitFile,
          resultsDir: tmpDir,
        })
      ).rejects.toThrow(/humanAmbiguous = null/);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  // -------------------------------------------------------------------------
  // 2. Ground Truth Join in e2e_eval.js
  // -------------------------------------------------------------------------
  describe('e2e_eval.js ground truth join', () => {
    let warnSpy;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('joinGroundTruthToQueries overrides query ground truth and emits drift warnings', () => {
      const groundTruthMap = new Map([
        ['mflix-0100', { id: 'mflix-0100', humanAmbiguous: true, category: 'AMB_LEX', scopeCapable: true }],
      ]);

      const queries = [
        { id: 'mflix-0100', humanAmbiguous: false, text: 'Find top movies' },
      ];

      const joined = joinGroundTruthToQueries(queries, groundTruthMap);

      expect(joined[0].humanAmbiguous).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      const warningText = warnSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(warningText).toContain('[GROUND TRUTH DRIFT]');
      expect(warningText).toContain('mflix-0100');
    });

    test('joinGroundTruthToQueries fails closed when query humanAmbiguous is null', () => {
      const groundTruthMap = new Map([
        ['mflix-0200', { id: 'mflix-0200', humanAmbiguous: null }],
      ]);

      const queries = [
        { id: 'mflix-0200', humanAmbiguous: null, text: 'Find recent titles' },
      ];

      expect(() => joinGroundTruthToQueries(queries, groundTruthMap)).toThrow(/humanAmbiguous is null/);
    });
  });

  // -------------------------------------------------------------------------
  // 3. run_targeted_reeval.js Hardening & Verification
  // -------------------------------------------------------------------------
  describe('run_targeted_reeval.js runner hardening', () => {
    describe('validateSingleApiKey', () => {
      test('accepts single valid API key', () => {
        const env = { GROQ_API_KEY: 'gsk_validkey123456789' };
        expect(validateSingleApiKey(env)).toBe('gsk_validkey123456789');
      });

      test('throws error if GROQ_API_KEY is missing or empty', () => {
        expect(() => validateSingleApiKey({})).toThrow(/GROQ_API_KEY environment variable is missing/);
        expect(() => validateSingleApiKey({ GROQ_API_KEY: '   ' })).toThrow(/GROQ_API_KEY environment variable is missing/);
      });

      test('prohibits key rotation via GROQ_API_KEYS', () => {
        const env = {
          GROQ_API_KEY: 'gsk_key1',
          GROQ_API_KEYS: 'gsk_key1,gsk_key2',
        };
        expect(() => validateSingleApiKey(env)).toThrow(/Key rotation \/ multiple keys via GROQ_API_KEYS are strictly prohibited/);
      });

      test('prohibits multiple keys delimited by commas, semicolons, or spaces', () => {
        expect(() => validateSingleApiKey({ GROQ_API_KEY: 'gsk_1,gsk_2' })).toThrow(/Comma-separated or multiple keys/);
        expect(() => validateSingleApiKey({ GROQ_API_KEY: 'gsk_1;gsk_2' })).toThrow(/Comma-separated or multiple keys/);
        expect(() => validateSingleApiKey({ GROQ_API_KEY: 'gsk_1 gsk_2' })).toThrow(/Comma-separated or multiple keys/);
      });

      test('does not leak API key value in error messages', () => {
        const secretKey = 'gsk_supersecretkeyvalue';
        try {
          validateSingleApiKey({ GROQ_API_KEY: `${secretKey},gsk_another` });
        } catch (err) {
          expect(err.message).not.toContain(secretKey);
        }
      });
    });

    describe('estimateTokensForQueries', () => {
      test('computes token estimates and cost projections accurately', () => {
        const queries = [
          { config: 'C0a', humanAmbiguous: true }, // 1 call (1500 prompt, 400 comp)
          { config: 'C0b', humanAmbiguous: false }, // 1 call
          { config: 'C2', humanAmbiguous: true },  // 2 calls (ambiguous gate trigger + oracle)
        ];

        const pricing = {
          models: {
            'openai/gpt-oss-120b': { promptPerMillion: 0.15, completionPerMillion: 0.75 },
          },
        };

        const estimates = estimateTokensForQueries(queries, 'openai/gpt-oss-120b', pricing);

        expect(estimates.totalCalls).toBe(4);
        expect(estimates.promptTokens).toBe(4 * 1500);
        expect(estimates.completionTokens).toBe(4 * 400);
        expect(estimates.totalTokens).toBe(6000 + 1600);
        expect(estimates.estimatedCostUsd).toBeGreaterThan(0);
      });
    });

    describe('updateSupersededRecords', () => {
      test('updates older matching active record with supersededBy pointer', () => {
        const existingRecords = [
          {
            recordId: 'rec_v1',
            model: 'openai/gpt-oss-120b',
            config: 'C0a',
            queryId: 'supplies-0063',
            pipeline: [{ $limit: 5 }],
            supersededBy: null,
          },
          {
            recordId: 'rec_other',
            model: 'openai/gpt-oss-120b',
            config: 'C0a',
            queryId: 'supplies-0064',
            pipeline: [{ $limit: 10 }],
            supersededBy: null,
          },
        ];

        const newRecord = {
          model: 'openai/gpt-oss-120b',
          config: 'C0a',
          queryId: 'supplies-0063',
          pipeline: [{ $limit: 20 }],
        };

        const { updatedRecords, newRecord: processedNew, supersededCount } = updateSupersededRecords(existingRecords, newRecord);

        expect(supersededCount).toBe(1);
        expect(processedNew.recordId).toBeDefined();
        expect(processedNew.supersededBy).toBeNull();

        // Older matching record is now marked with supersededBy: processedNew.recordId
        const oldRec = updatedRecords.find((r) => r.recordId === 'rec_v1');
        expect(oldRec.supersededBy).toBe(processedNew.recordId);

        // Unrelated record is unaffected
        const otherRec = updatedRecords.find((r) => r.recordId === 'rec_other');
        expect(otherRec.supersededBy).toBeNull();
      });
    });

    describe('runTargetedRerun dry-run behavior', () => {
      test('returns dryRun: true and confirmed: false without calling LLM when --confirm is omitted', async () => {
        const res = await runTargetedRerun({
          confirm: false,
          skipLiveCheck: true,
        });

        expect(res.confirmed).toBe(false);
        expect(res.dryRun).toBe(true);
        expect(res.targetCounts).toBeDefined();
        expect(res.targetCounts.c0a).toBe(100);
        expect(res.tokenEstimates).toBeDefined();
        expect(res.tokenEstimates.totalCalls).toBeGreaterThan(0);
      });
    });
  });
});
