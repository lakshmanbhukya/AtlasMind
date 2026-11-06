'use strict';

const fs = require('fs');
const path = require('path');
require(path.resolve(__dirname, '../../server/node_modules/dotenv')).config({
  path: path.resolve(__dirname, '../../server/.env'),
});

const { processNaturalLanguageQuery } = require('../../server/src/services/queryPipelineService');
const { simulateClarificationResponse } = require('./clarificationSimulator');
const { verifyInterpretationCompliance } = require('../../server/src/services/interpretationComplianceVerifier');
const { checkPipelineFilterCriteria, queryRequiresOrdering, compareResults } = require('./referencePipelines');

// Ensure EVAL_MODE is active
process.env.EVAL_MODE = '1';
process.env.STRICT_MODEL = '1';
process.env.EVAL_SCHEMA_SNAPSHOT = path.resolve(__dirname, '../schemas/schemas_snapshot.json');

/**
 * Single-key validation (no rotation, strictly 1 key).
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
 * Execute a single query under a specific configuration (C0a, C0b, C2)
 * following the uniform clarification simulator protocol.
 *
 * @param {object} params
 * @param {object} params.item - Benchmark query item
 * @param {string} params.config - 'C0a' | 'C0b' | 'C2'
 * @param {string} params.model - Target model id
 * @param {object} params.intended - Hidden intended interpretation for ambiguous query
 * @param {number} [params.maxTurns=1] - Turn budget
 * @returns {Promise<object>} Standardized execution record
 */
async function executeQueryUnderProtocol({ item, config, model, intended, maxTurns = 1 }) {
  const t0 = Date.now();
  const mockDb = {
    databaseName: item.dataset,
    listCollections: () => ({ toArray: async () => item.scope.map((n) => ({ name: n })) }),
    collection: () => ({
      estimatedDocumentCount: async () => 10,
      aggregate: () => ({ toArray: async () => [] }),
    }),
  };

  let totalPromptTokens = 0;
  let totalCompTokens = 0;
  let modelCalls = 0;
  let clarificationTurns = 0;
  let askedClarification = false;
  let clarificationSource = null;
  let wasUnresolved = false;
  let wasUnnecessaryClarification = false;
  let isSilentAssumption = false;
  let isIntendedMatch = false;
  let complianceResult = null;
  let finalPipeline = [];
  let outcome = 'pipeline_returned';

  const isClearQuery = !item.humanAmbiguous;

  if (config === 'C0a') {
    // -------------------------------------------------------------------------
    // C0a: Zero-ARL (Clarification Disabled, Single Pass)
    // -------------------------------------------------------------------------
    const res = await processNaturalLanguageQuery({
      text: item.text,
      query: item.text,
      connectionId: 'eval-session',
      collections: item.scope,
      db: mockDb,
      evalOptions: {
        disableGate: true,
        forceFinalQueryMode: true,
        disableClarificationMode: true,
        disableMemoryWrite: true,
        model,
        temperature: 0.1,
        db: mockDb,
      },
    });

    modelCalls = 1;
    const resData = res.data || res.response || {};
    const diag = resData.diagnostics || {};
    const usage = diag.usage || { prompt_tokens: 0, completion_tokens: 0 };
    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompTokens += usage.completion_tokens || 0;

    finalPipeline = resData.pipeline || [];
    const isValidPipeline = Array.isArray(finalPipeline) && finalPipeline.length > 0;

    // Silent assumption: on ambiguous query, C0a always guesses silently
    isSilentAssumption = item.humanAmbiguous && isValidPipeline;
    clarificationTurns = 0;
    askedClarification = false;

    // Correctness check
    if (isClearQuery) {
      isIntendedMatch = checkPipelineFilterCriteria(item.id, finalPipeline);
    } else {
      // Ambiguous query: did the silent guess happen to hit the intended metric?
      const targetMetric = intended?.intendedMetric || item.goldCandidate || '';
      const compRes = verifyInterpretationCompliance(finalPipeline, targetMetric, item.text);
      isIntendedMatch = isValidPipeline && compRes.compliant;
      complianceResult = compRes;
    }

    outcome = isValidPipeline ? 'pipeline_returned' : 'empty_result';

  } else if (config === 'C0b') {
    // -------------------------------------------------------------------------
    // C0b: LLM-Only Baseline (Conversational Clarification + Fair Simulator)
    // -------------------------------------------------------------------------
    // Pass 1: Initial query with clarification mode allowed in LLM
    const res1 = await processNaturalLanguageQuery({
      text: item.text,
      query: item.text,
      connectionId: 'eval-session',
      collections: item.scope,
      db: mockDb,
      evalOptions: {
        disableGate: true,
        forceFinalQueryMode: false,
        disableClarificationMode: false,
        disableMemoryWrite: true,
        model,
        temperature: 0.1,
        db: mockDb,
      },
    });

    modelCalls = 1;
    const resData1 = res1.data || res1.response || {};
    const diag1 = resData1.diagnostics || {};
    const usage1 = diag1.usage || { prompt_tokens: 0, completion_tokens: 0 };
    totalPromptTokens += usage1.prompt_tokens || 0;
    totalCompTokens += usage1.completion_tokens || 0;

    if (resData1.needsClarification === true) {
      // LLM asked for clarification!
      askedClarification = true;
      clarificationSource = 'llm';
      clarificationTurns = 1;

      if (isClearQuery) {
        wasUnnecessaryClarification = true;
      }

      // Query simulator with fair uniform response policy
      const questionPayload = (Array.isArray(resData1.questions) && resData1.questions[0])
        ? resData1.questions[0]
        : { id: 'clarification', question: resData1.aiMessage || resData1.explanation || 'Please clarify' };

      const simRes = simulateClarificationResponse({
        question: questionPayload,
        intended,
        isClearQuery,
        turnIndex: 0,
        maxTurns,
      });

      if (simRes.unresolved) {
        wasUnresolved = true;
        outcome = 'asked_unresolved';
      } else {
        // Pass 2: Provide simulator response to LLM
        let userFollowUp = item.text;
        let pass2Clarifications = null;

        if (simRes.bypass) {
          userFollowUp = `${item.text}\n\nUser instruction: Please proceed with the query as originally specified.`;
        } else if (simRes.response) {
          pass2Clarifications = [simRes.response];
          userFollowUp = `${item.text}\n\nClarification: ${simRes.clarificationText || simRes.response.value}`;
        }

        const res2 = await processNaturalLanguageQuery({
          text: userFollowUp,
          query: userFollowUp,
          connectionId: 'eval-session',
          collections: item.scope,
          clarifications: pass2Clarifications,
          bypassAmbiguity: simRes.bypass,
          db: mockDb,
          evalOptions: {
            disableGate: true,
            forceFinalQueryMode: true,
            disableClarificationMode: true,
            disableMemoryWrite: true,
            model,
            temperature: 0.1,
            db: mockDb,
          },
        });

        modelCalls = 2;
        const resData2 = res2.data || res2.response || {};
        const diag2 = resData2.diagnostics || {};
        const usage2 = diag2.usage || { prompt_tokens: 0, completion_tokens: 0 };
        totalPromptTokens += usage2.prompt_tokens || 0;
        totalCompTokens += usage2.completion_tokens || 0;

        finalPipeline = resData2.pipeline || [];
        const isValid = Array.isArray(finalPipeline) && finalPipeline.length > 0;
        outcome = isValid ? 'asked_resolved' : 'asked_unresolved';
        wasUnresolved = !isValid;

        if (isClearQuery) {
          isIntendedMatch = checkPipelineFilterCriteria(item.id, finalPipeline);
        } else {
          const targetMetric = intended?.intendedMetric || item.goldCandidate || '';
          const compRes = verifyInterpretationCompliance(finalPipeline, targetMetric, item.text);
          isIntendedMatch = isValid && compRes.compliant;
          complianceResult = compRes;
        }
      }
    } else {
      // LLM synthesized directly without asking
      finalPipeline = resData1.pipeline || [];
      const isValid = Array.isArray(finalPipeline) && finalPipeline.length > 0;
      isSilentAssumption = item.humanAmbiguous && isValid;
      clarificationTurns = 0;
      askedClarification = false;
      outcome = isValid ? 'pipeline_returned' : 'empty_result';

      if (isClearQuery) {
        isIntendedMatch = checkPipelineFilterCriteria(item.id, finalPipeline);
      } else {
        const targetMetric = intended?.intendedMetric || item.goldCandidate || '';
        const compRes = verifyInterpretationCompliance(finalPipeline, targetMetric, item.text);
        isIntendedMatch = isValid && compRes.compliant;
        complianceResult = compRes;
      }
    }

  } else if (config === 'C2') {
    // -------------------------------------------------------------------------
    // C2: AtlasMind Dual-Tier System (Deterministic Gate + Allowlist + Fallback)
    // -------------------------------------------------------------------------
    // Pass 1: Evaluation through AtlasMind pipeline (Gate active)
    const res1 = await processNaturalLanguageQuery({
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

    const resData1 = res1.data || res1.response || {};
    const diag1 = resData1.diagnostics || {};
    const usage1 = diag1.usage || { prompt_tokens: 0, completion_tokens: 0 };
    totalPromptTokens += usage1.prompt_tokens || 0;
    totalCompTokens += usage1.completion_tokens || 0;

    // Check if gate or LLM requested clarification
    if (resData1.needsClarification === true) {
      askedClarification = true;
      clarificationSource = resData1.clarificationSource || (diag1.gate?.reason === 'asked' ? 'gate' : 'llm');
      clarificationTurns = 1;

      if (isClearQuery) {
        wasUnnecessaryClarification = true;
      }

      // Gate clarification question
      const questionPayload = (Array.isArray(resData1.questions) && resData1.questions[0])
        ? resData1.questions[0]
        : { id: 'metric', question: resData1.aiMessage || 'Select metric' };

      const simRes = simulateClarificationResponse({
        question: questionPayload,
        intended,
        isClearQuery,
        turnIndex: 0,
        maxTurns,
      });

      if (simRes.unresolved) {
        wasUnresolved = true;
        outcome = 'asked_unresolved';
      } else {
        // Pass 2: Re-submit with validated clarification or bypass
        const pass2Clarifications = simRes.response ? [simRes.response] : null;

        const res2 = await processNaturalLanguageQuery({
          text: item.text,
          query: item.text,
          connectionId: 'eval-session',
          collections: item.scope,
          clarifications: pass2Clarifications,
          bypassAmbiguity: simRes.bypass,
          db: mockDb,
          evalOptions: {
            disableGate: false,
            disableMemoryWrite: true,
            model,
            temperature: 0.1,
            db: mockDb,
          },
        });

        modelCalls = (clarificationSource === 'gate') ? 1 : 2; // Gate is deterministic 0 LLM calls; Pass 2 is 1 LLM call
        const resData2 = res2.data || res2.response || {};
        const diag2 = resData2.diagnostics || {};
        const usage2 = diag2.usage || { prompt_tokens: 0, completion_tokens: 0 };
        totalPromptTokens += usage2.prompt_tokens || 0;
        totalCompTokens += usage2.completion_tokens || 0;

        finalPipeline = resData2.pipeline || [];
        const isValid = Array.isArray(finalPipeline) && finalPipeline.length > 0;
        outcome = isValid ? 'asked_resolved' : 'asked_unresolved';
        wasUnresolved = !isValid;

        // Verify interpretation compliance
        if (isClearQuery) {
          isIntendedMatch = checkPipelineFilterCriteria(item.id, finalPipeline);
        } else {
          const targetMetric = intended?.intendedMetric || item.goldCandidate || '';
          const compRes = verifyInterpretationCompliance(finalPipeline, targetMetric, item.text);
          isIntendedMatch = isValid && compRes.compliant;
          complianceResult = compRes;
        }
      }
    } else {
      // Gate was silent and LLM generated directly
      modelCalls = 1;
      finalPipeline = resData1.pipeline || [];
      const isValid = Array.isArray(finalPipeline) && finalPipeline.length > 0;
      isSilentAssumption = item.humanAmbiguous && isValid;
      clarificationTurns = 0;
      askedClarification = false;
      outcome = isValid ? 'pipeline_returned' : 'empty_result';

      if (isClearQuery) {
        isIntendedMatch = checkPipelineFilterCriteria(item.id, finalPipeline);
      } else {
        const targetMetric = intended?.intendedMetric || item.goldCandidate || '';
        const compRes = verifyInterpretationCompliance(finalPipeline, targetMetric, item.text);
        isIntendedMatch = isValid && compRes.compliant;
        complianceResult = compRes;
      }
    }
  }

  const durationMs = Date.now() - t0;

  return {
    queryId: item.id,
    config,
    model,
    dataset: item.dataset,
    category: item.category,
    humanAmbiguous: item.humanAmbiguous,
    askedClarification,
    clarificationSource,
    clarificationTurns,
    wasUnnecessaryClarification,
    isSilentAssumption,
    wasUnresolved,
    isIntendedMatch,
    complianceResult,
    modelCalls,
    tokens: {
      prompt: totalPromptTokens,
      completion: totalCompTokens,
      total: totalPromptTokens + totalCompTokens,
    },
    durationMs,
    outcome,
    pipeline: finalPipeline,
  };
}

module.exports = {
  executeQueryUnderProtocol,
  validateSingleApiKey,
};
