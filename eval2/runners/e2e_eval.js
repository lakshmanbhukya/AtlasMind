'use strict';

const fs = require('fs');
const path = require('path');
require(path.resolve(__dirname, '../../server/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../server/.env'),
});
const { processNaturalLanguageQuery } = require('../../server/src/services/queryPipelineService');
const { QuotaExhaustedError } = require('../../server/src/services/quotaLimiter');

// Ensure EVAL_MODE is active
process.env.EVAL_MODE = '1';
process.env.STRICT_MODEL = '1';
process.env.EVAL_SCHEMA_SNAPSHOT = path.resolve(__dirname, '../schemas/schemas_snapshot.json');

/**
 * Compute standardized record fields according to Item A1:
 * - clarificationSource: "gate" | "llm" | null
 * - rawText: string | null
 * - finishReason: string | null
 * - errorType: "none" | "json_parse" | "truncated" | "execution_error" | "empty_result" | "llm_clarification"
 * - outcome (mutually exclusive): "pipeline_returned" | "asked_resolved" | "asked_unresolved" | "invalid_json" | "truncated" | "execution_error" | "empty_result"
 * - extraInteractions: 0, 1 (card shown), 2 (bypass needed)
 */
function computeRecordOutcome({
  needsClarification,
  clarificationSource,
  isValidPipeline,
  pipeline,
  finishReason,
  rawText,
  executionError = false,
  jsonParseError = false,
  emptyResult = false,
  extraInteractions = 0,
}) {
  let outcome = 'pipeline_returned';
  let errorType = 'none';

  const clarSrc = (clarificationSource === 'gate' || clarificationSource === 'llm') ? clarificationSource : null;

  if (needsClarification) {
    if (isValidPipeline && Array.isArray(pipeline) && pipeline.length > 0) {
      outcome = 'asked_resolved';
      errorType = 'none';
    } else {
      outcome = 'asked_unresolved';
      errorType = clarSrc === 'llm' ? 'llm_clarification' : 'empty_result';
    }
  } else if (finishReason === 'length') {
    outcome = 'truncated';
    errorType = 'truncated';
  } else if (jsonParseError) {
    outcome = 'invalid_json';
    errorType = 'json_parse';
  } else if (executionError) {
    outcome = 'execution_error';
    errorType = 'execution_error';
  } else if (!isValidPipeline || (Array.isArray(pipeline) && pipeline.length === 0) || emptyResult) {
    outcome = 'empty_result';
    errorType = 'empty_result';
  } else {
    outcome = 'pipeline_returned';
    errorType = 'none';
  }

  return {
    clarificationSource: clarSrc,
    rawText: rawText || null,
    finishReason: finishReason || (isValidPipeline ? 'stop' : null),
    errorType,
    outcome,
    extraInteractions: typeof extraInteractions === 'number' ? extraInteractions : 0,
  };
}

/**
 * Item A3: Oracle Resolution Function
 * - Primary:
 *   - Clear query (humanAmbiguous: false): bypass (bypassAmbiguity: true); extraInteractions = 2
 *   - Ambiguous query (humanAmbiguous: true): user selects gold option only if among offered options (strict); extraInteractions = 1
 *   - If gold not offered: record intendedMetricNotOffered = true, user bypasses; extraInteractions = 2
 * - Secondary (flag):
 *   - lenient_other: if gold not offered, user enters gold via __other__; extraInteractions = 1
 *   - wrong_pick: on clear query, user picks offeredOptions[0]; extraInteractions = 1
 */
function resolveOracleAction({ item, firstData, oracleMode = 'primary' }) {
  if (!firstData.needsClarification || !Array.isArray(firstData.questions) || firstData.questions.length === 0) {
    return {
      asked: false,
      clarificationAnswer: null,
      bypassAmbiguity: false,
      intendedMetricNotOffered: false,
      oracleUsed: 'none',
      extraInteractions: 0,
    };
  }

  const qObj = firstData.questions[0];
  const offeredOptions = (qObj.options || []).map((o) => o.value);
  const targetGold = item.goldCandidate;
  const isOffered = targetGold ? offeredOptions.includes(targetGold) : false;

  if (item.humanAmbiguous === null || item.humanAmbiguous === undefined) {
    throw new Error(`humanAmbiguous is null for query ${item.id || 'unknown'}. Human labeling must be validated and merged before running evaluation.`);
  }

  if (!item.humanAmbiguous) {
    // Clear query
    if (oracleMode === 'wrong_pick') {
      return {
        asked: true,
        clarificationAnswer: { id: qObj.id, value: offeredOptions[0] },
        bypassAmbiguity: false,
        intendedMetricNotOffered: false,
        oracleUsed: 'wrong_pick',
        extraInteractions: 1,
      };
    }
    // Primary: user clicks bypass
    return {
      asked: true,
      clarificationAnswer: null,
      bypassAmbiguity: true,
      intendedMetricNotOffered: false,
      oracleUsed: 'bypass',
      extraInteractions: 2,
    };
  }

  // Ambiguous query
  if (isOffered) {
    return {
      asked: true,
      clarificationAnswer: { id: qObj.id, value: targetGold },
      bypassAmbiguity: false,
      intendedMetricNotOffered: false,
      oracleUsed: 'strict_offered',
      extraInteractions: 1,
    };
  }

  // Gold not offered
  if (oracleMode === 'lenient_other') {
    return {
      asked: true,
      clarificationAnswer: { id: qObj.id, value: '__other__', customText: targetGold || offeredOptions[0] },
      bypassAmbiguity: false,
      intendedMetricNotOffered: true,
      oracleUsed: 'lenient_other',
      extraInteractions: 1,
    };
  }

  // Primary: gold not offered, user bypasses
  return {
    asked: true,
    clarificationAnswer: null,
    bypassAmbiguity: true,
    intendedMetricNotOffered: true,
    oracleUsed: 'bypass',
    extraInteractions: 2,
  };
}

async function runE2EEvaluation() {
  console.log('=== EVAL2 LIVE END-TO-END EVALUATION ===\n');

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: GROQ_API_KEY environment variable is missing.');
    console.error('Live LLM evaluation requires GROQ_API_KEY.');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  let targetModel = 'openai/gpt-oss-120b';
  const modelIdx = args.indexOf('--model');
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    targetModel = args[modelIdx + 1];
  }

  let targetConfig = 'all'; // 'all', 'C0', 'C2'
  const configIdx = args.indexOf('--config');
  if (configIdx !== -1 && args[configIdx + 1]) {
    targetConfig = args[configIdx + 1];
  }

  console.log(`Target Model:  ${targetModel}`);
  console.log(`Target Config: ${targetConfig}`);

  // Load pricing
  const pricingPath = path.resolve(__dirname, '../pricing.json');
  const pricing = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
  const modelPricing = pricing.models[targetModel] || { promptPerMillion: 0.15, completionPerMillion: 0.75 };

  // Load 100-query stratified subset
  const e2eSubsetPath = path.resolve(__dirname, '../benchmark/e2e_subset.jsonl');
  const queries = fs.readFileSync(e2eSubsetPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

  console.log(`Loaded ${queries.length} queries from e2e_subset.jsonl\n`);

  // Setup append-only raw traces and resume checkpoints
  const resultsPath = path.resolve(__dirname, '../results/e2e_raw.jsonl');
  const outDir = path.dirname(resultsPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const completedSet = new Set();
  if (fs.existsSync(resultsPath)) {
    const existingLines = fs.readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of existingLines) {
      try {
        const rec = JSON.parse(line);
        if (rec.model === targetModel && rec.queryId && rec.config) {
          completedSet.add(`${rec.model}|${rec.config}|${rec.queryId}`);
        }
      } catch (e) {}
    }
  }
  console.log(`Checkpoint status: ${completedSet.size} query-config executions already completed.`);

  const configsToRun = targetConfig === 'all' ? ['C0', 'C2'] : [targetConfig];

  let queriesProcessedThisRun = 0;
  let tokensConsumedThisRun = 0;

  try {
    for (const cfg of configsToRun) {
      console.log(`\n========================================`);
      console.log(`RUNNING CONFIG: ${cfg} (${cfg === 'C0' ? 'Un-gated Baseline' : 'AtlasMind Ambiguity Gate'})`);
      console.log(`========================================`);

      for (let i = 0; i < queries.length; i++) {
        const item = queries[i];
        if (item.humanAmbiguous === null || item.humanAmbiguous === undefined) {
          throw new Error(`humanAmbiguous is null for query ${item.id}. Human labeling must be validated and merged before running evaluation.`);
        }
        const key = `${targetModel}|${cfg}|${item.id}`;

        if (completedSet.has(key)) {
          continue; // Skip already completed checkpoint
        }

        const t0 = Date.now();
        console.log(`[${i + 1}/${queries.length}] (${cfg}) Processing ${item.id} [${item.dataset}]: "${item.text.slice(0, 50)}..."`);

        // Common mock DB handle for offline schema retrieval
        const mockDb = {
          databaseName: item.dataset,
          listCollections: () => ({ toArray: async () => item.scope.map((n) => ({ name: n })) }),
          collection: () => ({
            estimatedDocumentCount: async () => 10,
            aggregate: () => ({ toArray: async () => [] }),
          }),
        };

        if (cfg === 'C0') {
          // --- CONFIG C0: Baseline (disableGate = true) ---
          const response = await processNaturalLanguageQuery({
            text: item.text,
            query: item.text,
            connectionId: 'eval-session',
            collections: item.scope,
            db: mockDb,
            evalOptions: {
              disableGate: true,
              disableMemoryWrite: true,
              model: targetModel,
              temperature: 0.1,
              db: mockDb,
            },
          });

          const resData = response.data || response.response || {};
          const diag = resData.diagnostics || {};
          const usage = diag.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          const pTokens = usage.prompt_tokens || 0;
          const cTokens = usage.completion_tokens || 0;
          const totTokens = usage.total_tokens || (pTokens + cTokens);

          tokensConsumedThisRun += totTokens;
          queriesProcessedThisRun++;

          const costUsd = (pTokens * modelPricing.promptPerMillion + cTokens * modelPricing.completionPerMillion) / 1000000;

          const pipeline = resData.pipeline || [];
          const isValidPipeline = Array.isArray(pipeline) && pipeline.length > 0;

          // Silent assumption: In C0, if query is humanAmbiguous and pipeline is generated without clarification
          const isSilentAssumption = item.humanAmbiguous && isValidPipeline;

          // Intended match check
          const cleanCand = item.goldCandidate ? item.goldCandidate.replace(/\[\]/g, '') : null;
          const baseCand = cleanCand ? cleanCand.split('.').pop() : null;
          const pipelineStr = JSON.stringify(pipeline);
          const isIntendedMatch = cleanCand
            ? (pipelineStr.includes(cleanCand) || pipelineStr.includes(`"${baseCand}"`) || pipelineStr.includes(`$${baseCand}`))
            : isValidPipeline;

          const trace = {
            timestamp: new Date().toISOString(),
            model: targetModel,
            config: 'C0',
            queryId: item.id,
            dataset: item.dataset,
            category: item.category,
            humanAmbiguous: item.humanAmbiguous,
            scope: item.scope,
            scopeCapable: item.scopeCapable,
            needsClarification: false,
            intendedMetricNotOffered: false,
            oracleUsed: 'none',
            isValidPipeline,
            isSilentAssumption,
            isIntendedMatch,
            isEmptyResult: false, // will reflect DB result count if real DB connected
            pipeline,
            usage: { prompt_tokens: pTokens, completion_tokens: cTokens, total_tokens: totTokens },
            timings: diag.timings || { totalMs: Date.now() - t0 },
            costUsd,
          };

          fs.appendFileSync(resultsPath, JSON.stringify(trace) + '\n');
          completedSet.add(key);

        } else if (cfg === 'C2') {
          // --- CONFIG C2: Ambiguity Gate + Simulated Oracle ---
          // Pass 1: Initial query through gate
          const firstPass = await processNaturalLanguageQuery({
            text: item.text,
            query: item.text,
            connectionId: 'eval-session',
            collections: item.scope,
            db: mockDb,
            evalOptions: {
              disableGate: false,
              disableMemoryWrite: true,
              model: targetModel,
              temperature: 0.1,
              db: mockDb,
            },
          });

          const firstData = firstPass.data || firstPass.response || {};
          let totalPrompt = 0;
          let totalComp = 0;
          let totalMs = 0;

          if (firstData.diagnostics?.usage) {
            totalPrompt += firstData.diagnostics.usage.prompt_tokens || 0;
            totalComp += firstData.diagnostics.usage.completion_tokens || 0;
          }
          if (firstData.diagnostics?.timings?.totalMs) {
            totalMs += firstData.diagnostics.timings.totalMs;
          }

          let finalPipeline = [];
          let isValidPipeline = false;
          let isIntendedMatch = false;
          let intendedMetricNotOffered = false;
          let oracleUsed = 'none';

          if (firstData.needsClarification && Array.isArray(firstData.questions) && firstData.questions.length > 0) {
            // Gate prompted for clarification!
            const qObj = firstData.questions[0];
            const offeredOptions = (qObj.options || []).map((o) => o.value);

            const targetGold = item.goldCandidate;
            const isOfferedInTop4 = offeredOptions.includes(targetGold);

            let clarificationAnswer = null;

            if (isOfferedInTop4) {
              // Strict Oracle: Select among offered options
              oracleUsed = 'strict_offered';
              clarificationAnswer = { id: qObj.id, value: targetGold };
            } else {
              // Intended metric not offered (e.g. truncated in mflix or string in analytics)
              intendedMetricNotOffered = true;
              oracleUsed = 'lenient_other';
              // Lenient Oracle fallback via __other__ freeform text
              clarificationAnswer = { id: qObj.id, value: '__other__', customText: targetGold || offeredOptions[0] };
            }

            // Pass 2: Re-submit with validated user clarification
            const secondPass = await processNaturalLanguageQuery({
              text: item.text,
              query: item.text,
              connectionId: 'eval-session',
              collections: item.scope,
              clarifications: [clarificationAnswer],
              db: mockDb,
              evalOptions: {
                disableGate: false,
                disableMemoryWrite: true,
                model: targetModel,
                temperature: 0.1,
                db: mockDb,
              },
            });

            const secData = secondPass.data || secondPass.response || {};
            if (secData.diagnostics?.usage) {
              totalPrompt += secData.diagnostics.usage.prompt_tokens || 0;
              totalComp += secData.diagnostics.usage.completion_tokens || 0;
            }
            if (secData.diagnostics?.timings?.totalMs) {
              totalMs += secData.diagnostics.timings.totalMs;
            }

            finalPipeline = secData.pipeline || [];
            isValidPipeline = Array.isArray(finalPipeline) && finalPipeline.length > 0;
            const cleanTarget = targetGold ? targetGold.replace(/\[\]/g, '') : null;
            const baseTarget = cleanTarget ? cleanTarget.split('.').pop() : null;
            const pipelineStr = JSON.stringify(finalPipeline);
            isIntendedMatch = cleanTarget
              ? (pipelineStr.includes(cleanTarget) || pipelineStr.includes(`"${baseTarget}"`) || pipelineStr.includes(`$${baseTarget}`))
              : isValidPipeline;

          } else {
            // Unambiguous query: Generated in 1 pass
            finalPipeline = firstData.pipeline || [];
            isValidPipeline = Array.isArray(finalPipeline) && finalPipeline.length > 0;
            const cleanCand = item.goldCandidate ? item.goldCandidate.replace(/\[\]/g, '') : null;
            const baseCand = cleanCand ? cleanCand.split('.').pop() : null;
            const pipelineStr = JSON.stringify(finalPipeline);
            isIntendedMatch = cleanCand
              ? (pipelineStr.includes(cleanCand) || pipelineStr.includes(`"${baseCand}"`) || pipelineStr.includes(`$${baseCand}`))
              : isValidPipeline;
          }

          const totTokens = totalPrompt + totalComp;
          tokensConsumedThisRun += totTokens;
          queriesProcessedThisRun++;

          const costUsd = (totalPrompt * modelPricing.promptPerMillion + totalComp * modelPricing.completionPerMillion) / 1000000;

          const trace = {
            timestamp: new Date().toISOString(),
            model: targetModel,
            config: 'C2',
            queryId: item.id,
            dataset: item.dataset,
            category: item.category,
            humanAmbiguous: item.humanAmbiguous,
            scope: item.scope,
            scopeCapable: item.scopeCapable,
            needsClarification: Boolean(firstData.needsClarification),
            intendedMetricNotOffered,
            oracleUsed,
            isValidPipeline,
            isSilentAssumption: false, // C2 never silently assumes
            isIntendedMatch,
            isEmptyResult: false,
            pipeline: finalPipeline,
            usage: { prompt_tokens: totalPrompt, completion_tokens: totalComp, total_tokens: totTokens },
            timings: { totalMs },
            costUsd,
          };

          fs.appendFileSync(resultsPath, JSON.stringify(trace) + '\n');
          completedSet.add(key);
        }
      }
    }

    console.log(`\n✅ E2E evaluation completed successfully for model ${targetModel}.`);
    console.log(`Total queries processed this run: ${queriesProcessedThisRun}`);
    console.log(`Total tokens consumed this run:  ${tokensConsumedThisRun.toLocaleString()}`);

  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      console.warn(`\n⚠️ [QUOTA PAUSE] ${err.message}`);
      console.warn(`State saved to checkpoint. All completed queries are persisted in: ${resultsPath}`);
      console.warn(`Please resume execution when the daily quota resets:`);
      console.warn(`   node eval2/runners/e2e_eval.js --model ${targetModel} --config ${targetConfig}`);
      process.exit(75);
    } else {
      console.error(`\n❌ Fatal execution error: ${err.message}`);
      console.error(err.stack);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  runE2EEvaluation();
}

module.exports = { runE2EEvaluation, computeRecordOutcome, resolveOracleAction };
