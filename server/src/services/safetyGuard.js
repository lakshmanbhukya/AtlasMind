/**
 * Safety Guard — validates generated MQL pipelines before execution.
 *
 * Blocks destructive write operations ($out, $merge, $delete, $drop, $set for writes).
 * Recursively enforces the stage allowlist on nested stages ($facet, $lookup.pipeline, $unionWith.pipeline).
 * Validates document-form $lookup.from ({ coll, [db] }) by checking database and collection separately.
 * Rejects malformed or unsupported forms safely (fail-closed).
 * Injects a result limit if none is present.
 *
 * NOTE: $replaceRoot and $replaceWith are intentionally ALLOWED — they are
 * read-only reshaping stages, not write operations.
 */

// Analytical stages permitted for read-only aggregation execution
// Note: $set (alias for $addFields) and $unset (projection exclusion) operate
// as in-memory document reshaping stages in aggregation pipelines and are permitted.
const ALLOWED_STAGES = new Set([
    '$match',
    '$group',
    '$sort',
    '$limit',
    '$skip',
    '$project',
    '$unwind',
    '$addFields',
    '$set',
    '$unset',
    '$count',
    '$lookup',
    '$facet',
    '$bucket',
    '$bucketAuto',
    '$sortByCount',
    '$replaceRoot',
    '$replaceWith',
    '$unionWith',
    '$graphLookup',
]);

// Stages that persistently write or mutate database data on disk
const BLOCKED_STAGES = new Set([
    '$out',
    '$merge',
    '$delete',
    '$drop',
    '$update',
    // NOTE: $set and $unset are read-only reshaping stages in aggregation pipelines and are intentionally permitted
    // NOTE: $replaceRoot and $replaceWith are read-only and are intentionally NOT blocked
]);

// Keys that should never appear anywhere in the pipeline
const BLOCKED_OPERATORS = [
    '$deleteMany',
    '$deleteOne',
    '$updateMany',
    '$updateOne',
    '$insertOne',
    '$insertMany',
    '$dropDatabase',
    '$dropCollection',
];

// Operators that allow arbitrary code execution in MongoDB.
// These are strictly forbidden and NEVER approvable (no isWrite flag).
const HARD_DENY_OPERATORS = new Set([
    '$function',
    '$accumulator',
    '$where',
]);

const MAX_RESULT_LIMIT = 1000;

/**
 * Recursively check for hard-denied code execution operators.
 * @param {*} obj
 * @returns {string|null}
 */
function findHardDenyOperator(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            const found = findHardDenyOperator(obj[i]);
            if (found) return found;
        }
        return null;
    }

    for (const [key, value] of Object.entries(obj)) {
        if (HARD_DENY_OPERATORS.has(key)) return key;
        const nested = findHardDenyOperator(value);
        if (nested) return nested;
    }

    return null;
}

/**
 * Recursively check an object for blocked operators.
 * @param {*} obj
 * @returns {string|null} The blocked operator found, or null
 */
function findBlockedOperator(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return null;

    for (const key of Object.keys(obj)) {
        if (BLOCKED_OPERATORS.includes(key)) return key;

        const nested = findBlockedOperator(obj[key]);
        if (nested) return nested;
    }

    return null;
}

/**
 * Validate a collection name — must be a simple identifier.
 * @param {string} collectionName
 * @returns {{ safe: boolean, reason?: string }}
 */
const PROTECTED_PREFIXES = ['system', 'admin', 'local', 'config'];
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Intentionally prefix-based: names such as "system_users" or "config_backup" are protected too. */
function isProtectedName(name) {
    const n = String(name);
    return PROTECTED_PREFIXES.some((p) => n.startsWith(p));
}

function validateCollectionName(collectionName) {
    if (!collectionName || typeof collectionName !== 'string') {
        return { safe: false, reason: 'Collection name is required and must be a string' };
    }

    // Block system collections
    if (isProtectedName(collectionName)) {
        return { safe: false, reason: `Access to "${collectionName}" is not allowed` };
    }

    // Only allow alphanumeric + underscores
    if (!IDENTIFIER_RE.test(collectionName)) {
        return { safe: false, reason: `Invalid collection name: "${collectionName}"` };
    }

    return { safe: true };
}

/**
 * Recursively find and validate all collections referenced across top-level and nested stages.
 * Supports string and document-form $lookup.from ({ coll, [db] }), $unionWith, $graphLookup, and $facet.
 *
 * @param {Array} stages
 * @param {object} [options={}]
 * @returns {{ safe: boolean, reason?: string, code?: string, violatingCollections?: string[], referenced: string[] }}
 */
function extractAndValidateCollectionReferences(stages, options = {}) {
    if (!Array.isArray(stages)) return { safe: true, referenced: [] };
    const referenced = [];
    const { targetDatabase, allowedDatabases } = options;

    for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
            return { safe: false, reason: `Malformed stage at position ${i}: expected object` };
        }

        // 1. $lookup
        if (stage.$lookup) {
            if (typeof stage.$lookup !== 'object' || stage.$lookup === null || Array.isArray(stage.$lookup)) {
                return { safe: false, reason: 'Malformed $lookup stage: expected object specification', code: 'scope_violation' };
            }

            const from = stage.$lookup.from;
            if (from !== undefined && from !== null) {
                if (typeof from === 'string') {
                    const check = validateCollectionName(from);
                    if (!check.safe) {
                        return { safe: false, reason: check.reason, code: 'scope_violation', violatingCollections: [from] };
                    }
                    referenced.push(from);
                } else if (typeof from === 'object' && !Array.isArray(from)) {
                    // Document-form: { coll: string, [db: string] }
                    const keys = Object.keys(from);
                    const invalidKeys = keys.filter((k) => k !== 'coll' && k !== 'db');
                    if (invalidKeys.length > 0 || !from.coll || typeof from.coll !== 'string') {
                        return {
                            safe: false,
                            reason: `Malformed document-form $lookup.from: unexpected keys [${invalidKeys.join(', ')}] or missing collection string.`,
                            code: 'scope_violation',
                            violatingCollections: [typeof from.coll === 'string' ? from.coll : 'unknown'],
                        };
                    }

                    // Validate database separately first if present
                    if (from.db !== undefined) {
                        if (typeof from.db !== 'string' || !IDENTIFIER_RE.test(from.db)) {
                            return { safe: false, reason: `Invalid database name "${from.db}" in $lookup.from`, code: 'scope_violation', violatingCollections: [from.coll || 'unknown'] };
                        }
                        if (isProtectedName(from.db)) {
                            return { safe: false, reason: `Access to database "${from.db}" in $lookup.from is not allowed`, code: 'scope_violation', violatingCollections: [from.coll || 'unknown'] };
                        }
                        if (targetDatabase && from.db !== targetDatabase) {
                            return {
                                safe: false,
                                reason: `Cross-database access to "${from.db}" in $lookup.from is outside authorized scope (authorized: "${targetDatabase}")`,
                                code: 'scope_violation',
                                violatingCollections: [from.coll || 'unknown'],
                            };
                        }
                        if (allowedDatabases && !allowedDatabases.includes(from.db)) {
                            return {
                                safe: false,
                                reason: `Database "${from.db}" in $lookup.from is not among allowed databases`,
                                code: 'scope_violation',
                                violatingCollections: [from.coll || 'unknown'],
                            };
                        }
                    }

                    // Validate collection name
                    const collCheck = validateCollectionName(from.coll);
                    if (!collCheck.safe) {
                        return { safe: false, reason: collCheck.reason, code: 'scope_violation', violatingCollections: [from.coll] };
                    }
                    referenced.push(from.coll);
                } else {
                    return { safe: false, reason: 'Malformed $lookup.from: must be string or { coll, [db] } document', code: 'scope_violation' };
                }
            }

            if (stage.$lookup.pipeline !== undefined) {
                if (!Array.isArray(stage.$lookup.pipeline)) {
                    return { safe: false, reason: 'Malformed $lookup.pipeline: must be an array of stages', code: 'malformed_lookup' };
                }
                const subRes = extractAndValidateCollectionReferences(stage.$lookup.pipeline, options);
                if (!subRes.safe) return subRes;
                referenced.push(...subRes.referenced);
            }
        }

        // 2. $unionWith
        if (stage.$unionWith) {
            if (typeof stage.$unionWith === 'string') {
                const check = validateCollectionName(stage.$unionWith);
                if (!check.safe) {
                    return { safe: false, reason: check.reason, code: 'scope_violation', violatingCollections: [stage.$unionWith] };
                }
                referenced.push(stage.$unionWith);
            } else if (typeof stage.$unionWith === 'object' && stage.$unionWith !== null && !Array.isArray(stage.$unionWith)) {
                if (stage.$unionWith.coll !== undefined) {
                    if (typeof stage.$unionWith.coll !== 'string') {
                        return { safe: false, reason: 'Malformed $unionWith.coll: must be string collection name', code: 'scope_violation' };
                    }
                    const check = validateCollectionName(stage.$unionWith.coll);
                    if (!check.safe) {
                        return { safe: false, reason: check.reason, code: 'scope_violation', violatingCollections: [stage.$unionWith.coll] };
                    }
                    referenced.push(stage.$unionWith.coll);
                }
                if (stage.$unionWith.pipeline !== undefined) {
                    if (!Array.isArray(stage.$unionWith.pipeline)) {
                        return { safe: false, reason: 'Malformed $unionWith.pipeline: must be an array of stages', code: 'malformed_unionWith' };
                    }
                    const subRes = extractAndValidateCollectionReferences(stage.$unionWith.pipeline, options);
                    if (!subRes.safe) return subRes;
                    referenced.push(...subRes.referenced);
                }
            } else {
                return { safe: false, reason: 'Malformed $unionWith stage: must be string or object', code: 'malformed_unionWith' };
            }
        }

        // 3. $graphLookup
        if (stage.$graphLookup) {
            if (typeof stage.$graphLookup !== 'object' || stage.$graphLookup === null || Array.isArray(stage.$graphLookup)) {
                return { safe: false, reason: 'Malformed $graphLookup stage: expected object specification', code: 'malformed_graphLookup' };
            }
            if (typeof stage.$graphLookup.from !== 'string') {
                return { safe: false, reason: 'Malformed $graphLookup.from: must be string collection name', code: 'malformed_graphLookup' };
            }
            const check = validateCollectionName(stage.$graphLookup.from);
            if (!check.safe) {
                return { safe: false, reason: check.reason, code: 'scope_violation', violatingCollections: [stage.$graphLookup.from] };
            }
            referenced.push(stage.$graphLookup.from);
        }

        // 4. $facet
        if (stage.$facet) {
            if (typeof stage.$facet !== 'object' || stage.$facet === null || Array.isArray(stage.$facet)) {
                return { safe: false, reason: 'Malformed $facet stage: expected object specification', code: 'malformed_facet' };
            }
            for (const [branchName, branchPipeline] of Object.entries(stage.$facet)) {
                if (!Array.isArray(branchPipeline)) {
                    return { safe: false, reason: `Malformed $facet.${branchName}: must be an array of stages`, code: 'malformed_facet' };
                }
                const subRes = extractAndValidateCollectionReferences(branchPipeline, options);
                if (!subRes.safe) return subRes;
                referenced.push(...subRes.referenced);
            }
        }
    }

    return { safe: true, referenced };
}

/**
 * Recursively validate that all stages (top-level and nested inside $facet, $lookup.pipeline, $unionWith.pipeline)
 * belong to ALLOWED_STAGES and do not contain BLOCKED_STAGES or BLOCKED_OPERATORS.
 *
 * @param {Array} stages
 * @param {string} [context='']
 * @returns {{ safe: boolean, reason?: string, isWrite?: boolean, code?: string }}
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
 * @param {object[]} pipeline - The MongoDB aggregation pipeline
 * @param {object} [options={}] - Validation options (allowedCollections, targetCollection, targetDatabase)
 * @returns {{ safe: boolean, reason?: string, pipeline: object[], code?: string, violatingCollections?: string[], isWrite?: boolean }}
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
    const { allowedCollections, targetCollection, targetDatabase } = options;
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

        const collResult = extractAndValidateCollectionReferences(pipeline, { targetDatabase, allowedCollections });
        if (!collResult.safe) {
            return {
                safe: false,
                code: collResult.code || 'scope_violation',
                violatingCollections: collResult.violatingCollections || [],
                reason: collResult.reason,
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
        const collResult = extractAndValidateCollectionReferences(pipeline, { targetDatabase });
        if (!collResult.safe) {
            return {
                safe: false,
                code: collResult.code || 'scope_violation',
                violatingCollections: collResult.violatingCollections || [],
                reason: collResult.reason,
                pipeline,
            };
        }
    }

    // Check if a $limit stage exists — inject one if not
    const hasLimit = pipeline.some((stage) => '$limit' in stage);

    const safePipeline = hasLimit
        ? pipeline
        : [...pipeline, { $limit: MAX_RESULT_LIMIT }];

    return { safe: true, pipeline: safePipeline };
}

const COLLECTION_REFERENCE_STAGES = ['$lookup', '$unionWith', '$graphLookup'];
const PROTECTED_RULE = 'System and internal collections (system, admin, local, config) cannot be read.';

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
 * @returns {{ code: string, rule: string, stage: string|null, stageIndex: number|null, referenceType: string, reference: string|null }}
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

    const violating = Array.isArray(result.violatingCollections) ? result.violatingCollections : [];
    if (violating.length > 0) {
        const reference = violating[0];
        const inPipeline = locateReference(stages, reference) >= 0;
        const isProtected = isProtectedName(reference)
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
 * @param {object[]} pipeline - The MongoDB aggregation pipeline
 * @param {object} [options={}] - Validation options (allowedCollections, targetCollection, targetDatabase)
 */
function validatePipeline(pipeline, options = {}) {
    const result = validatePipelineCore(pipeline, options);
    if (!result.safe) {
        result.block = describeBlock(result, pipeline, options);
    }
    return result;
}

/** Structured block info for a rejected target collection name. */
function describeCollectionBlock(collectionName) {
    const name = typeof collectionName === 'string' ? collectionName : null;
    const isProtected = Boolean(name) && isProtectedName(name);
    return {
        code: isProtected ? 'protected_collection' : 'invalid_collection',
        rule: isProtected ? PROTECTED_RULE : 'Collection names must be simple identifiers.',
        referenceType: 'Target collection',
        reference: name,
        stage: null,
        stageIndex: null,
    };
}

/**
 * Describe a staged write for the approval UI: the write stage, its target and the fields it writes.
 * @param {object[]} pipeline
 * @param {string} [sourceCollection]
 * @returns {{ writeStage: string|null, writeStageIndex: number|null, sourceCollection: string|null, targetCollection: string|null, fieldsWritten: string[] }}
 */
function describeWrite(pipeline, sourceCollection) {
    const stages = Array.isArray(pipeline) ? pipeline : [];
    const isObj = (s) => s && typeof s === 'object' && !Array.isArray(s);
    let idx = stages.findIndex((s) => isObj(s) && (s.$merge !== undefined || s.$out !== undefined));
    if (idx < 0) idx = stages.findIndex((s) => isObj(s) && Object.keys(s).some((k) => BLOCKED_STAGES.has(k)));
    const stageObj = idx >= 0 ? stages[idx] : null;
    const writeStage = stageObj ? (Object.keys(stageObj).find((k) => BLOCKED_STAGES.has(k)) || firstKey(stageObj)) : null;

    let targetCollection = null;
    if (writeStage === '$out' || writeStage === '$merge') {
        const spec = stageObj[writeStage];
        if (typeof spec === 'string') targetCollection = spec;
        else if (isObj(spec)) {
            const into = writeStage === '$merge' ? spec.into : spec.coll;
            if (typeof into === 'string') targetCollection = into;
            else if (isObj(into) && typeof into.coll === 'string') targetCollection = into.coll;
        }
    }

    const fields = new Set();
    const upTo = idx >= 0 ? idx : stages.length;
    for (let i = 0; i < upTo; i++) {
        const st = stages[i];
        if (!isObj(st)) continue;
        for (const key of ['$set', '$addFields']) {
            if (isObj(st[key])) Object.keys(st[key]).forEach((f) => fields.add(f));
        }
        if (st.$unset !== undefined) {
            (Array.isArray(st.$unset) ? st.$unset : [st.$unset]).forEach((f) => typeof f === 'string' && fields.add(f));
        }
    }

    return {
        writeStage,
        writeStageIndex: idx >= 0 ? idx : null,
        sourceCollection: sourceCollection || null,
        targetCollection,
        fieldsWritten: Array.from(fields),
    };
}

module.exports = {
    describeCollectionBlock,
    describeWrite,
    validatePipeline,
    validateCollectionName,
};
