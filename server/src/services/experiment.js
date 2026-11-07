'use strict';

/**
 * ExperimentConfig: the research seam.
 *
 * Production code never reads EVAL_* environment variables. Instead, an
 * in-process caller (the evaluation harness on the research branch) passes an
 * `experiment` object to QueryExecutionEngine.executeNaturalLanguageQuery.
 * HTTP routes never forward one, so none of these switches are reachable from
 * a request body.
 *
 * Two adapters justify the seam: PRODUCTION (below, every switch off) and the
 * research harness's adapter, which builds an ExperimentConfig per run.
 *
 * @typedef {object} LlmHooks
 * @property {boolean} [strictModel]       Throw instead of falling back to the default model.
 * @property {number}  [maxTokens]         Completion token limit override.
 * @property {object}  [extraParams]       Extra chat.completions.create params.
 * @property {(client: object, model: string) => Promise<boolean>} [resolveJsonMode]
 *           Decide whether to request response_format=json_object for this model.
 * @property {(call: { model: string, messages: object[], maxTokens: number }) => Promise<any>} [beforeCall]
 *           Runs before the LLM call (e.g. quota reservation). Its return value is the ticket.
 * @property {(ticket: any, usage: object) => void} [afterCall]   Runs after a successful call.
 * @property {(ticket: any, error: Error) => void} [onFailure]     Runs when the call fails.
 *
 * @typedef {object} ExperimentConfig
 * @property {import('mongodb').Db} [db]   Use this user DB instead of the pooled tenant DB.
 * @property {boolean} [disableScope]      Ignore requested collection scope.
 * @property {number}  [fewShotLimit]      Number of few-shot examples (default 3).
 * @property {boolean} [disableSchemaContext]  Send field names only (no types/samples/hints).
 * @property {object}  [schemaSnapshot]    `{ [databaseName]: schema }` used instead of live profiling.
 * @property {boolean} [disableGate]       Skip the ambiguity gate.
 * @property {'hybrid'|'deterministic'|'llm'|'off'} [ambiguityMode]
 * @property {Iterable<string>} [vagueTerms]  Override the gate's vague-term list.
 * @property {boolean} [disableBindFix]    Disable the gate's explicit-binding fix.
 * @property {string}  [model]             LLM model override.
 * @property {number}  [temperature]       LLM temperature override.
 * @property {boolean} [disableClarificationMode]
 * @property {boolean} [forceFinalQueryMode]
 * @property {boolean} [disableSafetyGuard]  Skip the safety guard. Never set outside offline evaluation.
 * @property {boolean} [disableMemoryWrite]  Do not add successful runs to Few-Shot Memory.
 * @property {LlmHooks} [llm]
 * @property {boolean} [diagnostics]       Attach timing/usage diagnostics (default true for experiments).
 */

/** @type {Readonly<ExperimentConfig>} */
const PRODUCTION = Object.freeze({ diagnostics: false });

/**
 * Normalize an optional ExperimentConfig. `undefined`/`null` means production.
 * @param {ExperimentConfig|null|undefined} experiment
 * @returns {Readonly<ExperimentConfig>}
 */
function resolveExperiment(experiment) {
    if (!experiment || typeof experiment !== 'object') return PRODUCTION;
    return Object.freeze({ diagnostics: true, ...experiment });
}

module.exports = { resolveExperiment };
