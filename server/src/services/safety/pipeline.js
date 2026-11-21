// @ts-check
/** Safety Guard: recursive stage checks, pipeline validation and block descriptions. */

const { ALLOWED_STAGES, BLOCKED_STAGES, findBlockedOperator, findHardDenyOperator } = require('./operators');
const { extractAndValidateCollectionReferences } = require('./references');
const { PROTECTED_RULE, isProtectedCollectionName, isProtectedDatabaseName, validateCollectionName } = require('./names');

/** @typedef {import('./types').Stage} Stage */
/** @typedef {import('./types').ScopeOptions} ScopeOptions */
/** @typedef {import('./types').StageCheck} StageCheck */
/** @typedef {import('./types').BlockInfo} BlockInfo */
/** @typedef {import('./types').PipelineCheck} PipelineCheck */

const MAX_RESULT_LIMIT = 1000;

/**
 * Recursively validate that all stages (top-level and nested inside $facet, $lookup.pipeline, $unionWith.pipeline)
 * belong to ALLOWED_STAGES and do not contain BLOCKED_STAGES or BLOCKED_OPERATORS.
 *
 * @param {Stage[]} stages
 * @param {string} [context='']
 * @returns {StageCheck}
 */
function validateStagesRecursively(stages, context = '') {
    if (!Array.isArray(stages)) {
        return { safe: false, reason: `Pipeline ${context ? `at ${context} ` : ''}must be an array` };
    }

    for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const stageLoc = context ? `${context}[${i}]` : `stage ${i}`;

        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
            return { safe: false, reason: `Invalid stage at ${stageLoc}: must be an object` };
        }

        const stageKeys = Object.keys(stage);
        if (stageKeys.length === 0) {
            return { safe: false, reason: `Empty stage object at ${stageLoc}` };
        }

        for (const key of stageKeys) {
            if (BLOCKED_STAGES.has(key)) {
                return {
                    safe: false,
                    reason: `Blocked stage "${key}" found at ${stageLoc}. Write operations are not permitted.`,
                    isWrite: true,
                    reference: key,
                };
            }
            if (!ALLOWED_STAGES.has(key)) {
                return {
                    safe: false,
                    reason: `Unrecognized or restricted pipeline stage "${key}" at ${stageLoc}. Only standard analytical stages are permitted.`,
                    reference: key,
                };
            }
        }

        // Deep-check for blocked mutating operators inside stage
        const blockedOp = findBlockedOperator(stage);
        if (blockedOp) {
            return {
                safe: false,
                reason: `Blocked operator "${blockedOp}" found at ${stageLoc}. Mutating operations are not permitted.`,
                isWrite: true,
                reference: blockedOp,
            };
        }

        // Recurse into nested subpipelines
        if (stage.$lookup && Array.isArray(stage.$lookup.pipeline)) {
            const nestedRes = validateStagesRecursively(stage.$lookup.pipeline, `${stageLoc}.$lookup.pipeline`);
            if (!nestedRes.safe) return nestedRes;
        }

        if (stage.$unionWith && typeof stage.$unionWith === 'object' && Array.isArray(stage.$unionWith.pipeline)) {
            const nestedRes = validateStagesRecursively(stage.$unionWith.pipeline, `${stageLoc}.$unionWith.pipeline`);
            if (!nestedRes.safe) return nestedRes;
        }

        if (stage.$facet && typeof stage.$facet === 'object' && !Array.isArray(stage.$facet)) {
            for (const [branchName, branchPipeline] of Object.entries(stage.$facet)) {
                if (Array.isArray(branchPipeline)) {
                    const nestedRes = validateStagesRecursively(branchPipeline, `${stageLoc}.$facet.${branchName}`);
                    if (!nestedRes.safe) return nestedRes;
                }
            }
        }
    }

    return { safe: true };
}

/**
 * Validate an aggregation pipeline for safety.
 *
 * @param {Stage[]} pipeline - The MongoDB aggregation pipeline
 * @param {ScopeOptions} [options={}] - Validation options (allowedCollections, targetCollection, targetDatabase)
 * @returns {PipelineCheck}
 *   Returns the (potentially modified) pipeline with a $limit injected if needed.
 */
function validatePipelineCore(pipeline, options = {}) {
    if (!Array.isArray(pipeline)) {
        return { safe: false, reason: 'Pipeline must be an array', pipeline: [] };
    }

    if (pipeline.length === 0) {
        return { safe: false, reason: 'Pipeline is empty', pipeline: [] };
    }

    if (pipeline.length > 20) {
        return { safe: false, reason: 'Pipeline has too many stages (max 20)', pipeline };
    }

    // Check for hard-denied code execution operators ($function, $accumulator, $where) anywhere in pipeline
    const hardDenyOp = findHardDenyOperator(pipeline);
    if (hardDenyOp) {
        return {
            safe: false,
            code: 'hard_blocked_operator',
            reason: `Arbitrary code execution operator "${hardDenyOp}" is strictly forbidden.`,
            reference: hardDenyOp,
            pipeline,
        };
    }

    // Recursive stage allowlist & blocked stage validation (top-level and nested)
    const stageCheck = validateStagesRecursively(pipeline);
    if (!stageCheck.safe) {
        return {
            safe: false,
            reason: stageCheck.reason,
            isWrite: stageCheck.isWrite,
            code: stageCheck.code,
            reference: stageCheck.reference,
            pipeline,
        };
    }

    // Target collection and referenced collections scope validation
    const { allowedCollections, targetCollection, targetDatabase, requireTargetDatabase } = options;
    if (allowedCollections !== undefined && allowedCollections !== null) {
        const allowedSet = allowedCollections instanceof Set ? allowedCollections : new Set(allowedCollections);

        if (targetCollection && !allowedSet.has(targetCollection)) {
            return {
                safe: false,
                code: 'scope_violation',
                violatingCollections: [targetCollection],
                reason: `Target collection "${targetCollection}" is outside the allowed scope`,
                pipeline,
            };
        }

        const collResult = extractAndValidateCollectionReferences(pipeline, { targetDatabase, requireTargetDatabase, allowedCollections });
        if (!collResult.safe) {
            return {
                safe: false,
                code: collResult.code || 'scope_violation',
                violatingCollections: collResult.violatingCollections || [],
                reason: collResult.reason,
                ...(collResult.database !== undefined ? { database: collResult.database } : {}),
                pipeline,
            };
        }

        const violating = collResult.referenced.filter((c) => !allowedSet.has(c));
        if (violating.length > 0) {
            const firstViolator = violating[0];
            return {
                safe: false,
                code: 'scope_violation',
                violatingCollections: Array.from(new Set(violating)),
                reason: `Collection "${firstViolator}" is outside the allowed scope`,
                pipeline,
            };
        }
    } else {
        // Even if allowedCollections not specified, validate collection name integrity and malformed document forms
        const collResult = extractAndValidateCollectionReferences(pipeline, { targetDatabase, requireTargetDatabase });
        if (!collResult.safe) {
            return {
                safe: false,
                code: collResult.code || 'scope_violation',
                violatingCollections: collResult.violatingCollections || [],
                reason: collResult.reason,
                ...(collResult.database !== undefined ? { database: collResult.database } : {}),
                pipeline,
            };
        }
    }

    // Always cap the result size. Only a final top-level `$limit` within the
    // cap leaves the pipeline as-is: an earlier `$limit` can be multiplied by
    // a later `$unwind`/`$lookup`, and a huge one is no cap at all.
    const last = pipeline[pipeline.length - 1];
    const lastLimit = last && typeof last === 'object' ? last.$limit : undefined;
    const alreadyCapped = Number.isInteger(lastLimit) && lastLimit >= 1 && lastLimit <= MAX_RESULT_LIMIT;

    const safePipeline = alreadyCapped
        ? pipeline
        : [...pipeline, { $limit: MAX_RESULT_LIMIT }];

    return { safe: true, pipeline: safePipeline };
}

const COLLECTION_REFERENCE_STAGES = ['$lookup', '$unionWith', '$graphLookup'];

const WRITE_SCOPE_RULE = 'An approved write may only target a collection inside the active workspace scope.';

const DATABASE_RULE = 'Pipelines may only read and write the connected database.';

/** Index of the first top-level stage whose JSON contains `"reference"`, or -1. */
function locateReference(pipeline, reference) {
    if (!Array.isArray(pipeline) || !reference) return -1;
    const needle = JSON.stringify(String(reference));
    return pipeline.findIndex((stage) => {
        try {
            return JSON.stringify(stage).includes(needle);
        } catch {
            return false;
        }
    });
}

function firstKey(stage) {
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? Object.keys(stage)[0] || null : null;
}

/**
 * Structured description of why a pipeline was rejected, for the "Query blocked" UI.
 * @returns {BlockInfo}
 */
function describeBlock(result, pipeline, options = {}) {
    const stages = Array.isArray(pipeline) ? pipeline : [];
    const at = (reference) => {
        const idx = locateReference(stages, reference);
        return idx >= 0 ? { stage: firstKey(stages[idx]), stageIndex: idx } : { stage: null, stageIndex: null };
    };

    if (result.code === 'hard_blocked_operator') {
        return {
            code: 'hard_blocked_operator',
            rule: 'Code execution operators ($function, $accumulator, $where) are never allowed.',
            referenceType: 'Operator',
            reference: result.reference || null,
            ...at(result.reference),
        };
    }

    // Write target of an approvable $out/$merge (set by classifyExecution); located at the write stage itself.
    if (result.writeTarget) {
        const { name, database, stageIndex } = result.writeTarget;
        const loc = { stage: firstKey(stages[stageIndex]), stageIndex };
        if (result.whenMatchedPipeline) {
            return {
                code: 'restricted_stage',
                rule: 'A $merge may not run a whenMatched pipeline; use replace, keepExisting, merge or fail.',
                referenceType: 'Write stage',
                reference: 'whenMatched',
                ...loc,
            };
        }
        if (database !== undefined) {
            return {
                code: isProtectedDatabaseName(database) ? 'protected_collection' : 'out_of_scope_collection',
                rule: isProtectedDatabaseName(database) ? PROTECTED_RULE : DATABASE_RULE,
                referenceType: 'Write target database',
                reference: database,
                ...loc,
            };
        }
        const nameCheck = validateCollectionName(name);
        const isProtected = typeof name === 'string' && isProtectedCollectionName(name);
        let code = 'out_of_scope_collection';
        let rule = WRITE_SCOPE_RULE;
        if (isProtected) {
            code = 'protected_collection';
            rule = PROTECTED_RULE;
        } else if (!nameCheck.safe) {
            code = 'invalid_collection';
            rule = 'Collection names must be simple identifiers.';
        }
        return {
            code,
            rule,
            referenceType: 'Write target collection',
            reference: typeof name === 'string' ? name : null,
            ...loc,
        };
    }

    if (result.isWrite) {
        const isStage = BLOCKED_STAGES.has(result.reference);
        return {
            code: isStage ? 'blocked_write_stage' : 'blocked_write_operator',
            rule: isStage
                ? 'Write stages need a Write Approval Token before they run.'
                : 'Mutating operators are not permitted inside an aggregation pipeline.',
            referenceType: isStage ? 'Write stage' : 'Operator',
            reference: result.reference || null,
            ...at(result.reference),
        };
    }

    // Database-level violation in a $lookup.from: never resolvable by widening the collection scope.
    if (result.database !== undefined) {
        const isProtected = isProtectedDatabaseName(result.database);
        const loc = at(result.database);
        return {
            code: isProtected ? 'protected_collection' : 'out_of_scope_collection',
            rule: isProtected ? PROTECTED_RULE : DATABASE_RULE,
            referenceType: '$lookup database',
            reference: result.database,
            ...loc,
        };
    }

    const violating = Array.isArray(result.violatingCollections) ? result.violatingCollections : [];
    if (violating.length > 0) {
        const reference = violating[0];
        const inPipeline = locateReference(stages, reference) >= 0;
        const isProtected = isProtectedCollectionName(reference)
            || !validateCollectionName(reference).safe;
        const loc = inPipeline ? at(reference) : { stage: null, stageIndex: null };
        const refStage = COLLECTION_REFERENCE_STAGES.includes(loc.stage) ? loc.stage : null;
        return {
            code: isProtected ? 'protected_collection' : 'out_of_scope_collection',
            rule: isProtected ? PROTECTED_RULE : 'Pipelines may only read collections inside the active workspace scope.',
            referenceType: refStage ? `${refStage} collection` : (options.targetCollection === reference ? 'Target collection' : 'Collection'),
            reference,
            ...loc,
        };
    }

    if (result.reference) {
        return {
            code: 'restricted_stage',
            rule: 'Only standard analytical aggregation stages are permitted.',
            referenceType: 'Stage',
            reference: result.reference,
            ...at(result.reference),
        };
    }

    const posMatch = /position (\d+)|stage (\d+)/.exec(result.reason || '');
    const stageIndex = posMatch ? Number(posMatch[1] ?? posMatch[2]) : null;
    return {
        code: 'malformed_pipeline',
        rule: 'Pipelines must be a non-empty array of at most 20 well-formed stage objects.',
        referenceType: 'Pipeline',
        reference: null,
        stage: stageIndex !== null ? firstKey(stages[stageIndex]) : null,
        stageIndex,
    };
}

/**
 * Validate an aggregation pipeline for safety.
 * Unsafe results also carry `block` (see describeBlock) for the client's "Query blocked" card.
 *
 * @param {Stage[]} pipeline - The MongoDB aggregation pipeline
 * @param {ScopeOptions} [options={}] - Validation options (allowedCollections, targetCollection, targetDatabase)
 * @returns {PipelineCheck}
 */
function validatePipeline(pipeline, options = {}) {
    const result = validatePipelineCore(pipeline, options);
    if (!result.safe) {
        result.block = describeBlock(result, pipeline, options);
    }
    return result;
}

module.exports = {
    describeBlock,
    firstKey,
    validatePipeline,
    validatePipelineCore,
};
