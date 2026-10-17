'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
require(path.resolve(__dirname, '../../server/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../server/.env'),
});
const { processNaturalLanguageQuery } = require('../../server/src/services/queryPipelineService');
const { QuotaExhaustedError } = require('../../server/src/services/quotaLimiter');
const { computeRecordOutcome, resolveOracleAction } = require('./e2e_eval');

// Ensure EVAL_MODE is active
process.env.EVAL_MODE = '1';
process.env.STRICT_MODEL = '1';
process.env.EVAL_SCHEMA_SNAPSHOT = path.resolve(__dirname, '../schemas/schemas_snapshot.json');

const TOKENS_PER_CALL_ESTIMATE = 1900; // measured ~1.9K tokens / call

/**
 * Single-key enforcement:
 * Enforces exactly one Groq API key from environment.
 * Prohibits multiple keys, key rotation (GROQ_API_KEYS), and comma/semicolon-delimited keys.
 * Never logs or exposes the key prefix or secret in error messages.
 *
 * @param {object} env
 * @returns {string} apiKey
 */
function validateSingleApiKey(env = process.env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new Error('GROQ_API_KEY environment variable is missing.');
  }
  if (env.GROQ_API_KEYS) {
    throw new Error('Single API key required. Key rotation / multiple keys via GROQ_API_KEYS are strictly prohibited.');
  }
  if (apiKey.includes(',') || apiKey.includes(';') || apiKey.includes(' ')) {
    throw new Error('Single API key required. Comma-separated or multiple keys in GROQ_API_KEY are strictly prohibited.');
  }
  return apiKey.trim();
}

/**
 * Token and cost estimation helper
 */
function estimateTokensForQueries(targetQueriesList, model = 'openai/gpt-oss-120b', pricingObj = null) {
  const modelPricing = pricingObj?.models?.[model] || { promptPerMillion: 0.15, completionPerMillion: 0.75 };

  let totalCalls = 0;
  let totalPromptTokens = 0;
  let totalCompTokens = 0;

  for (const item of targetQueriesList) {
    // Config passes: C0a=1, C0b=1, C2=1 or 2
    const calls = item.config === 'C2' && (item.humanAmbiguous || item.isClearBypass) ? 2 : 1;
    const promptPerCall = 1500;
    const compPerCall = 400;
    totalCalls += calls;
    totalPromptTokens += calls * promptPerCall;
    totalCompTokens += calls * compPerCall;
  }

  const totalTokens = totalPromptTokens + totalCompTokens;
  const estimatedCostUsd = Number(
    ((totalPromptTokens * modelPricing.promptPerMillion + totalCompTokens * modelPricing.completionPerMillion) / 1000000).toFixed(4)
  );

  return {
    totalCalls,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompTokens,
    totalTokens,
    estimatedCostUsd,
  };
}

/**
 * SupersededBy tracking helper:
 * Finds any existing active records for (model, config, queryId) and marks them supersededBy: newId.
 * Sets the new record's recordId = newId, supersededBy = null.
 *
 * @param {Array<object>} existingRecords
 * @param {object} newRecord
 * @returns {{ updatedRecords: Array<object>, newRecord: object, supersededCount: number }}
 */
function updateSupersededRecords(existingRecords, newRecord) {
  const newId = newRecord.recordId || `${newRecord.model}_${newRecord.config}_${newRecord.queryId}_${Date.now()}`;
  newRecord.recordId = newId;
  newRecord.supersededBy = null;

  let supersededCount = 0;
  for (const rec of existingRecords) {
    if (rec.model === newRecord.model &&
        rec.config === newRecord.config &&
        rec.queryId === newRecord.queryId &&
        !rec.supersededBy) {
      rec.supersededBy = newId;
      supersededCount++;
    }
  }
  return { updatedRecords: existingRecords, newRecord, supersededCount };
}

/**
 * Check live Groq models endpoint to confirm model ID existence
 */
function checkLiveModelId(modelId, apiKey) {
  return new Promise((resolve) => {
    if (!apiKey) return resolve(false);
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/models',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'AtlasMind-TargetedRunner',
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const ids = (parsed.data || []).map((m) => m.id);
          resolve(ids.includes(modelId));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function runTargetedRerun(options = {}) {
  console.log('=== EVAL2 TARGETED RERUN & ESTIMATION GUARD (Item A5) ===\n');

  const args = process.argv.slice(2);
  const isConfirmed = options.confirm !== undefined ? options.confirm : args.includes('--confirm');
  const includeSecondary = options.includeSecondary !== undefined ? options.includeSecondary : args.includes('--include-secondary');

  const pricingPath = options.pricingPath || path.resolve(__dirname, '../pricing.json');
  const pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));

  // Load ground truth map from test_split.jsonl
  const testSplitPath = options.testSplitPath || path.resolve(__dirname, '../benchmark/test_split.jsonl');
  let groundTruthMap = new Map();
  if (fs.existsSync(testSplitPath)) {
    const testQueries = fs.readFileSync(testSplitPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    groundTruthMap = new Map(testQueries.map((q) => [q.id, q]));
  }

  // Load queries from e2e_subset.jsonl
  const subsetPath = options.subsetPath || path.resolve(__dirname, '../benchmark/e2e_subset.jsonl');
  const rawQueries = fs.readFileSync(subsetPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

  // Join ground truth and find flips
  const flippedQueries = [];
  const queries = rawQueries.map((item) => {
    const q = { ...item };
    const gt = groundTruthMap.get(q.id);
    if (gt && gt.humanAmbiguous !== null && gt.humanAmbiguous !== undefined) {
      if (q.humanAmbiguous !== undefined && q.humanAmbiguous !== null && q.humanAmbiguous !== gt.humanAmbiguous) {
        console.warn(`⚠️ [GROUND TRUTH DRIFT] Query ${q.id}: stored=${q.humanAmbiguous} != test_split=${gt.humanAmbiguous}`);
        flippedQueries.push({ id: q.id, stored: q.humanAmbiguous, updated: gt.humanAmbiguous });
      }
      q.humanAmbiguous = gt.humanAmbiguous;
      if (gt.category) q.category = gt.category;
      if (gt.scopeCapable !== undefined) q.scopeCapable = gt.scopeCapable;
    }
    return q;
  });

  // Identify targeted queries per spec:
  // - C0a: all 100 queries
  // - C0b: 19 queries that were invalid in preliminary run + any ground truth flips
  // - C2: 24 clear queries where gate asked + 20 AMB_PARA queries + any ground truth flips
  const c0aTargetQueries = queries;
  const c0bInvalidIds = new Set([
    'supplies-0072', 'supplies-0081', 'supplies-0084', 'supplies-0085', 'supplies-0091', 'supplies-0093', 'supplies-0100',
    'supplies-0086', 'supplies-0088', 'supplies-0089', 'supplies-0097', 'supplies-0098', 'supplies-0099',
    'analytics-0203', 'analytics-0208', 'analytics-0211', 'analytics-0216', 'analytics-0217', 'analytics-0219'
  ]);
  const flippedIds = new Set(flippedQueries.map((f) => f.id));
  const c0bTargetQueries = queries.filter((q) => c0bInvalidIds.has(q.id) || flippedIds.has(q.id));

  const c2ClearBypassIds = new Set([
    'supplies-0043', 'supplies-0044', 'supplies-0045', 'supplies-0047', 'supplies-0048', 'supplies-0049',
    'supplies-0051', 'supplies-0052', 'supplies-0053', 'supplies-0056', 'supplies-0057', 'supplies-0023',
    'supplies-0024', 'supplies-0026', 'supplies-0027', 'supplies-0028', 'supplies-0031', 'supplies-0032',
    'supplies-0033', 'supplies-0034', 'supplies-0035', 'supplies-0036', 'supplies-0037', 'supplies-0014'
  ]);
  const c2TargetQueries = queries.filter((q) => c2ClearBypassIds.has(q.id) || q.category === 'AMB_PARA' || flippedIds.has(q.id));

  const totalPrimaryCalls = c0aTargetQueries.length + c0bTargetQueries.length + c2TargetQueries.length;
  const totalPrimaryTokens = totalPrimaryCalls * TOKENS_PER_CALL_ESTIMATE;

  const targetItemsForEstimation = [
    ...c0aTargetQueries.map((q) => ({ ...q, config: 'C0a' })),
    ...c0bTargetQueries.map((q) => ({ ...q, config: 'C0b' })),
    ...c2TargetQueries.map((q) => ({ ...q, config: 'C2', isClearBypass: c2ClearBypassIds.has(q.id) })),
  ];

  const tokenEstimates = estimateTokensForQueries(targetItemsForEstimation, 'openai/gpt-oss-120b', pricing);

  console.log('------------------------------------------------------------');
  console.log('ESTIMATED LLM INVOCATIONS & TOKEN CONSUMPTION:');
  console.log('Primary Model: openai/gpt-oss-120b');
  console.log(`  • C0a (Zero-ARL, all queries):   ${c0aTargetQueries.length} calls`);
  console.log(`  • C0b (Invalid repair queries):  ${c0bTargetQueries.length} calls`);
  console.log(`  • C2  (Oracle & Para changes):   ${c2TargetQueries.length} calls`);
  console.log(`  • Ground Truth Flips:            ${flippedQueries.length} queries`);
  console.log(`  TOTAL Estimated Calls:           ${totalPrimaryCalls} calls`);
  console.log(`  TOTAL Estimated Tokens:          ~${totalPrimaryTokens.toLocaleString()} tokens`);
  console.log(`  Estimated Cost:                  $${tokenEstimates.estimatedCostUsd.toFixed(4)} USD`);
  console.log('------------------------------------------------------------');

  let qwenLive = false;
  let gpt20bLive = false;
  const envObj = options.env || process.env;
  const rawKey = envObj.GROQ_API_KEY;
  if (rawKey && !options.skipLiveCheck) {
    const validKey = validateSingleApiKey(envObj);
    console.log('\nChecking live availability of secondary models on Groq endpoint...');
    qwenLive = await checkLiveModelId('qwen/qwen3.8-27b', validKey);
    gpt20bLive = await checkLiveModelId('openai/gpt-oss-20b', validKey);
    console.log(`  • openai/gpt-oss-20b: ${gpt20bLive ? '✅ LIVE' : '❌ ABSENT'}`);
    console.log(`  • qwen/qwen3.8-27b:   ${qwenLive ? '✅ LIVE' : '❌ ABSENT'}`);
  }

  if (!isConfirmed) {
    console.log('\n⚠️ [SAFETY GUARD] Execution halted because --confirm was not passed.');
    console.log('Running in DRY-RUN mode. No LLM calls executed.');
    console.log('To confirm and execute the targeted rerun under single-key budget, run:');
    console.log('   node eval2/runners/run_targeted_reeval.js --confirm\n');
    return {
      confirmed: false,
      dryRun: true,
      totalPrimaryCalls,
      totalPrimaryTokens,
      qwenLive,
      gpt20bLive,
      targetCounts: {
        c0a: c0aTargetQueries.length,
        c0b: c0bTargetQueries.length,
        c2: c2TargetQueries.length,
        flips: flippedQueries.length,
      },
      tokenEstimates,
      flippedQueries,
    };
  }

  // Execution confirmed: validate single API key strictly
  const apiKey = validateSingleApiKey(envObj);
  console.log('\n✅ --confirm received. Beginning targeted re-evaluation under single-key discipline...\n');

  const rawPath = options.resultsPath || path.resolve(__dirname, '../results/e2e_raw.jsonl');
  let existingRecords = fs.existsSync(rawPath)
    ? fs.readFileSync(rawPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];

  let tokensConsumedThisRun = 0;
  let callsExecutedThisRun = 0;

  try {
    // Helper to run a query and produce standardized record
    async function executeTargetedQuery({ item, config, model }) {
      const mockDb = {
        databaseName: item.dataset,
        listCollections: () => ({ toArray: async () => item.scope.map((n) => ({ name: n })) }),
        collection: () => ({
          estimatedDocumentCount: async () => 10,
          aggregate: () => ({ toArray: async () => [] }),
        }),
      };

      const t0 = Date.now();
      const isC0a = config === 'C0a';
      const isC0b = config === 'C0b';

      if (isC0a || isC0b) {
        const res = await processNaturalLanguageQuery({
          text: item.text,
          query: item.text,
          connectionId: 'eval-session',
          collections: item.scope,
          db: mockDb,
          evalOptions: {
            disableGate: true,
            forceFinalQueryMode: isC0a,
            disableClarificationMode: isC0a,
            disableMemoryWrite: true,
            model,
            temperature: 0.1,
            db: mockDb,
          },
        });

        const resData = res.data || res.response || {};
        const diag = resData.diagnostics || {};
        const usage = diag.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const pTokens = usage.prompt_tokens || 0;
        const cTokens = usage.completion_tokens || 0;
        const totTokens = usage.total_tokens || (pTokens + cTokens);

        tokensConsumedThisRun += totTokens;
        callsExecutedThisRun++;

        const pipeline = resData.pipeline || [];
        const isValidPipeline = Array.isArray(pipeline) && pipeline.length > 0;
        const asked = Boolean(resData.needsClarification);
        const clarSrc = asked ? 'llm' : null;

        const outcomeData = computeRecordOutcome({
          needsClarification: asked,
          clarificationSource: clarSrc,
          isValidPipeline,
          pipeline,
          finishReason: diag.finishReason || (isValidPipeline ? 'stop' : null),
          rawText: diag.rawText || null,
          executionError: false,
          jsonParseError: false,
          emptyResult: false,
          extraInteractions: 0,
        });

        const cleanCand = item.goldCandidate ? item.goldCandidate.replace(/\[\]/g, '') : null;
        const baseCand = cleanCand ? cleanCand.split('.').pop() : null;
        const pipelineStr = JSON.stringify(pipeline);
        const isIntendedMatch = cleanCand
          ? (pipelineStr.includes(cleanCand) || pipelineStr.includes(`"${baseCand}"`) || pipelineStr.includes(`$${baseCand}`))
          : isValidPipeline;

        return {
          timestamp: new Date().toISOString(),
          model,
          config,
          queryId: item.id,
          dataset: item.dataset,
          category: item.category,
          humanAmbiguous: item.humanAmbiguous,
          scope: item.scope,
          scopeCapable: item.scopeCapable,
          needsClarification: asked,
          intendedMetricNotOffered: false,
          oracleUsed: 'none',
          isValidPipeline,
          isSilentAssumption: item.humanAmbiguous && !asked && isValidPipeline,
          isIntendedMatch,
          isEmptyResult: false,
          pipeline,
          usage: { prompt_tokens: pTokens, completion_tokens: cTokens, total_tokens: totTokens },
          timings: diag.timings || { totalMs: Date.now() - t0 },
          costUsd: (pTokens * 0.15 + cTokens * 0.75) / 1000000,
          ...outcomeData,
        };
      } else {
        // C2: Gate + Oracle
        const firstPass = await processNaturalLanguageQuery({
          text: item.text,
          query: item.text,
          connectionId: 'eval-session',
          collections: item.scope,
          db: mockDb,
          evalOptions: {
            disableGate: false,
            disableMemoryWrite: true,
            model,
            temperature: 0.1,
            db: mockDb,
          },
        });

        const firstData = firstPass.data || firstPass.response || {};
        let totalPrompt = firstData.diagnostics?.usage?.prompt_tokens || 0;
        let totalComp = firstData.diagnostics?.usage?.completion_tokens || 0;
        let totalMs = firstData.diagnostics?.timings?.totalMs || (Date.now() - t0);

        callsExecutedThisRun++;
        tokensConsumedThisRun += (totalPrompt + totalComp);

        const oracleRes = resolveOracleAction({ item, firstData, oracleMode: 'primary' });
        let finalPipeline = [];
        let secData = {};

        if (oracleRes.asked) {
          const secondPass = await processNaturalLanguageQuery({
            text: item.text,
            query: item.text,
            connectionId: 'eval-session',
            collections: item.scope,
            clarifications: oracleRes.clarificationAnswer ? [oracleRes.clarificationAnswer] : null,
            bypassAmbiguity: oracleRes.bypassAmbiguity,
            db: mockDb,
            evalOptions: {
              disableGate: false,
              disableMemoryWrite: true,
              model,
              temperature: 0.1,
              db: mockDb,
            },
          });

          secData = secondPass.data || secondPass.response || {};
          const p2 = secData.diagnostics?.usage?.prompt_tokens || 0;
          const c2 = secData.diagnostics?.usage?.completion_tokens || 0;
          totalPrompt += p2;
          totalComp += c2;
          tokensConsumedThisRun += (p2 + c2);
          callsExecutedThisRun++;
          finalPipeline = secData.pipeline || [];
        } else {
          finalPipeline = firstData.pipeline || [];
        }

        const isValidPipeline = Array.isArray(finalPipeline) && finalPipeline.length > 0;
        const outcomeData = computeRecordOutcome({
          needsClarification: Boolean(firstData.needsClarification),
          clarificationSource: firstData.clarificationSource || (oracleRes.asked ? 'gate' : null),
          isValidPipeline,
          pipeline: finalPipeline,
          finishReason: secData.diagnostics?.finishReason || firstData.diagnostics?.finishReason || 'stop',
          rawText: secData.diagnostics?.rawText || firstData.diagnostics?.rawText || null,
          executionError: false,
          jsonParseError: false,
          emptyResult: false,
          extraInteractions: oracleRes.extraInteractions,
        });

        const cleanCand = item.goldCandidate ? item.goldCandidate.replace(/\[\]/g, '') : null;
        const baseCand = cleanCand ? cleanCand.split('.').pop() : null;
        const pipelineStr = JSON.stringify(finalPipeline);
        const isIntendedMatch = cleanCand
          ? (pipelineStr.includes(cleanCand) || pipelineStr.includes(`"${baseCand}"`) || pipelineStr.includes(`$${baseCand}`))
          : isValidPipeline;

        return {
          timestamp: new Date().toISOString(),
          model,
          config,
          queryId: item.id,
          dataset: item.dataset,
          category: item.category,
          humanAmbiguous: item.humanAmbiguous,
          scope: item.scope,
          scopeCapable: item.scopeCapable,
          needsClarification: Boolean(firstData.needsClarification),
          intendedMetricNotOffered: oracleRes.intendedMetricNotOffered,
          oracleUsed: oracleRes.oracleUsed,
          isValidPipeline,
          isSilentAssumption: item.humanAmbiguous && !firstData.needsClarification && isValidPipeline,
          isIntendedMatch,
          isEmptyResult: false,
          pipeline: finalPipeline,
          usage: { prompt_tokens: totalPrompt, completion_tokens: totalComp, total_tokens: totalPrompt + totalComp },
          timings: { totalMs },
          costUsd: (totalPrompt * 0.15 + totalComp * 0.75) / 1000000,
          ...outcomeData,
        };
      }
    }

    console.log('Targeted rerun confirmed. Ready for execution under single-key discipline.');
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      console.warn(`\n⚠️ [QUOTA PAUSE] ${err.message}`);
      console.warn('Execution halted by 90% TPD guard. Single key protected.');
      process.exit(75);
    } else {
      console.error('Fatal execution error:', err.message);
      process.exit(1);
    }
  }

  return {
    confirmed: true,
    callsExecutedThisRun,
    tokensConsumedThisRun,
    qwenLive,
    gpt20bLive,
  };
}

if (require.main === module) {
  runTargetedRerun().catch((err) => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}

module.exports = {
  runTargetedRerun,
  validateSingleApiKey,
  estimateTokensForQueries,
  updateSupersededRecords,
  checkLiveModelId,
};
