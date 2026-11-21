// @ts-check
/** Safety Guard: shared JSDoc types (no runtime code). */

/** @typedef {Record<string, any>} Stage One aggregation stage, e.g. `{ $match: {...} }`. */

/**
 * Scope options for pipeline validation.
 * @typedef {object} ScopeOptions
 * @property {string[]|Set<string>|null} [allowedCollections] - null/undefined means unrestricted
 * @property {string|null} [targetCollection]
 * @property {string} [targetDatabase] - the connected database
 * @property {string[]} [allowedDatabases]
 * @property {boolean} [requireTargetDatabase] - an explicit db must equal targetDatabase
 */

/**
 * Result of the collection-reference walk. `database` marks a database-level violation.
 * @typedef {{ safe: boolean, reason?: string, code?: string, violatingCollections?: string[], database?: string, referenced?: string[] }} ReferenceCheck
 */

/**
 * Result of the recursive stage check. `reference` is the offending stage or operator.
 * @typedef {{ safe: boolean, reason?: string, isWrite?: boolean, code?: string, reference?: string }} StageCheck
 */

/**
 * Structured description of a block, for the client's "Query blocked" card.
 * @typedef {{ code: string, rule: string, stage: string|null, stageIndex: number|null, referenceType: string, reference: string|null }} BlockInfo
 */

/**
 * Result of pipeline validation. `pipeline` is the (possibly $limit-capped)
 * pipeline; `block` is set by validatePipeline on an unsafe result.
 * @typedef {object} PipelineCheck
 * @property {boolean} safe
 * @property {Stage[]} pipeline
 * @property {string} [reason]
 * @property {string} [code]
 * @property {string[]} [violatingCollections]
 * @property {boolean} [isWrite]
 * @property {string} [reference]
 * @property {string} [database]
 * @property {BlockInfo} [block]
 */

module.exports = {};
