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
    // requireTargetDatabase: an explicit db must equal targetDatabase; with no targetDatabase, any explicit db fails.
    const { targetDatabase, allowedDatabases, requireTargetDatabase = false } = options;

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
                        // `database` marks a database-level violation: never fixable by widening the collection scope.
                        const database = String(from.db);
                        if (typeof from.db !== 'string' || !IDENTIFIER_RE.test(from.db)) {
                            return { safe: false, reason: `Invalid database name "${from.db}" in $lookup.from`, code: 'scope_violation', violatingCollections: [from.coll || 'unknown'], database };
                        }
                        if (isProtectedName(from.db)) {
                            return { safe: false, reason: `Access to database "${from.db}" in $lookup.from is not allowed`, code: 'scope_violation', violatingCollections: [from.coll || 'unknown'], database };
                        }
                        if ((targetDatabase || requireTargetDatabase) && from.db !== targetDatabase) {
                            return {
                                safe: false,
                                reason: targetDatabase
                                    ? `Cross-database access to "${from.db}" in $lookup.from is outside authorized scope (authorized: "${targetDatabase}")`
                                    : `Cross-database access to "${from.db}" in $lookup.from is outside authorized scope (connected database unknown)`,
                                code: 'scope_violation',
                                violatingCollections: [from.coll || 'unknown'],
                                database,
                            };
                        }
                        if (allowedDatabases && !allowedDatabases.includes(from.db)) {
                            return {
                                safe: false,
                                reason: `Database "${from.db}" in $lookup.from is not among allowed databases`,
                                code: 'scope_violation',
                                violatingCollections: [from.coll || 'unknown'],
                                database,
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

    // Check if a $limit stage exists — inject one if not
    const hasLimit = pipeline.some((stage) => '$limit' in stage);

    const safePipeline = hasLimit
        ? pipeline
        : [...pipeline, { $limit: MAX_RESULT_LIMIT }];

    return { safe: true, pipeline: safePipeline };
}

const COLLECTION_REFERENCE_STAGES = ['$lookup', '$unionWith', '$graphLookup'];
const PROTECTED_RULE = 'System and internal collections (system, admin, local, config) cannot be read or written.';
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
                code: isProtectedName(database) ? 'protected_collection' : 'out_of_scope_collection',
                rule: isProtectedName(database) ? PROTECTED_RULE : DATABASE_RULE,
                referenceType: 'Write target database',
                reference: database,
                ...loc,
            };
        }
        const nameCheck = validateCollectionName(name);
        const isProtected = typeof name === 'string' && isProtectedName(name);
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
        const isProtected = isProtectedName(result.database);
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
        const target = parseWriteTarget(writeStage, stageObj[writeStage]);
        if (typeof target.name === 'string') targetCollection = target.name;
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

// ---------------------------------------------------------------------------
// Safe Execution verdict
// ---------------------------------------------------------------------------

const APPROVABLE_WRITE_STAGES = new Set(['$out', '$merge']);
const OUT_SPEC_KEYS = new Set(['db', 'coll']);
const MERGE_SPEC_KEYS = new Set(['into', 'on', 'let', 'whenMatched', 'whenNotMatched']);
const INTO_SPEC_KEYS = new Set(['db', 'coll']);

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse the destination of a `$out` / `$merge` stage.
 * `database` is present only when the stage names a db explicitly.
 * @returns {{ name: *, database?: *, whenMatchedPipeline: boolean, malformed: string|null }}
 */
function parseWriteTarget(stageName, spec) {
    const result = { name: null, whenMatchedPipeline: false, malformed: null };
    const fromDocument = (doc, allowedKeys, label) => {
        const extra = Object.keys(doc).filter((k) => !allowedKeys.has(k));
        if (extra.length > 0) {
            result.malformed = `Malformed ${label}: unexpected keys [${extra.join(', ')}]`;
            return;
        }
        result.name = doc.coll;
        if (Object.prototype.hasOwnProperty.call(doc, 'db')) result.database = doc.db;
    };

    if (typeof spec === 'string') {
        result.name = spec;
    } else if (stageName === '$out' && isPlainObject(spec)) {
        fromDocument(spec, OUT_SPEC_KEYS, '$out');
    } else if (stageName === '$merge' && isPlainObject(spec)) {
        const extra = Object.keys(spec).filter((k) => !MERGE_SPEC_KEYS.has(k));
        if (extra.length > 0) {
            result.malformed = `Malformed $merge: unexpected keys [${extra.join(', ')}]`;
        } else if (typeof spec.into === 'string') {
            result.name = spec.into;
        } else if (isPlainObject(spec.into)) {
            fromDocument(spec.into, INTO_SPEC_KEYS, '$merge.into');
        } else {
            result.malformed = 'Malformed $merge.into: must be a collection name or { db, coll } document';
        }
        result.whenMatchedPipeline = Array.isArray(spec.whenMatched);
    } else {
        result.malformed = `Malformed ${stageName} stage: must be a collection name or a specification document`;
    }

    if (!result.malformed && typeof result.name !== 'string') {
        result.malformed = `Malformed ${stageName} stage: the target collection must be a string`;
    }
    return result;
}

/** The single approvable write: exactly one $out/$merge key, in the last top-level stage. */
function splitFinalWrite(pipeline) {
    const index = pipeline.length - 1;
    const last = pipeline[index];
    if (!isPlainObject(last)) return null;
    const keys = Object.keys(last);
    if (keys.length !== 1 || !APPROVABLE_WRITE_STAGES.has(keys[0])) return null;
    return { stage: keys[0], stageIndex: index, spec: last[keys[0]], readPart: pipeline.slice(0, index) };
}

/** Read-part checks. An empty read part is legal next to a write; only the target collection's scope applies. */
function checkReadPart(readPart, options) {
    if (readPart.length > 0) return validatePipelineCore(readPart, options);
    const { allowedCollections, targetCollection } = options;
    if (allowedCollections && !allowedCollections.includes(targetCollection)) {
        return {
            safe: false,
            code: 'scope_violation',
            violatingCollections: [targetCollection],
            reason: `Target collection "${targetCollection}" is outside the allowed scope`,
            pipeline: readPart,
        };
    }
    return { safe: true, pipeline: readPart };
}

const MISPLACED_WRITE_RULE = 'A write is only approvable as a single $out or $merge in the final top-level stage.';

function blockedVerdict(result, pipeline, options) {
    const block = describeBlock(result, pipeline, options);
    if (result.isWrite && block.code === 'blocked_write_stage') block.rule = MISPLACED_WRITE_RULE;
    return {
        kind: 'blocked',
        reason: result.reason,
        code: result.code || 'safety_violation',
        isWrite: Boolean(result.isWrite),
        block,
    };
}

/**
 * Safe Execution's one classification of (collection, pipeline, Effective Scope).
 *
 * Scope convention: a non-empty array is restricted; null, undefined or [] is unrestricted.
 * `tenantDatabase` is the connected database's name; when it is unknown, any explicit `db` is blocked.
 *
 * @param {{ collection: string, pipeline: object[], scope?: string[]|null, tenantDatabase?: string|null }} input
 * @returns {{ kind: 'runnable', pipeline: object[] }
 *   | { kind: 'needs_approval', pipeline: object[], write: { stage: string, stageIndex: number, targetCollection: string } }
 *   | { kind: 'scope_insufficient', reason: string, code: string, violatingCollections: string[], block: object }
 *   | { kind: 'blocked', reason: string, code: string, isWrite: boolean, block: object }}
 */
function classifyExecution({ collection, pipeline, scope = null, tenantDatabase = null } = {}) {
    // 1. Target collection
    const collectionCheck = validateCollectionName(collection);
    if (!collectionCheck.safe) {
        return {
            kind: 'blocked',
            reason: collectionCheck.reason,
            code: 'safety_violation',
            isWrite: false,
            block: describeCollectionBlock(collection),
        };
    }

    const restricted = Array.isArray(scope) && scope.length > 0;
    const options = {
        allowedCollections: restricted ? scope : null,
        targetCollection: collection,
        targetDatabase: tenantDatabase || undefined,
        requireTargetDatabase: true,
    };

    // 2. Whole-pipeline checks: shape, length, code-execution operators
    if (!Array.isArray(pipeline) || pipeline.length === 0 || pipeline.length > 20 || findHardDenyOperator(pipeline)) {
        return blockedVerdict(validatePipelineCore(pipeline, options), pipeline, options);
    }

    // 3. Split off the one approvable write stage
    const write = splitFinalWrite(pipeline);

    // 4. The read part gets the full read checks
    const readResult = checkReadPart(write ? write.readPart : pipeline, options);
    let scopeInsufficient = null;
    if (!readResult.safe) {
        const block = describeBlock(readResult, pipeline, options);
        const fixableByScope = !readResult.isWrite
            && readResult.database === undefined
            && block.code === 'out_of_scope_collection';
        if (!fixableByScope) return blockedVerdict(readResult, pipeline, options);
        scopeInsufficient = {
            kind: 'scope_insufficient',
            reason: readResult.reason,
            code: readResult.code || 'scope_violation',
            violatingCollections: readResult.violatingCollections || [],
            block,
        };
    }

    if (write) {
        // 5-6. The write stage itself: shape, mutating operators, whenMatched, target db and collection
        const target = parseWriteTarget(write.stage, write.spec);
        const writeTarget = { name: target.name, stageIndex: write.stageIndex };
        const blockWrite = (reason, code, extra = {}) => blockedVerdict(
            { reason, code, writeTarget: { ...writeTarget, ...extra.target }, ...extra.result },
            pipeline,
            options
        );

        if (target.malformed) {
            return blockedVerdict({ reason: `${target.malformed} (stage ${write.stageIndex})`, code: 'safety_violation' }, pipeline, options);
        }
        const blockedOp = findBlockedOperator(pipeline[write.stageIndex]);
        if (blockedOp) {
            return blockedVerdict({
                reason: `Blocked operator "${blockedOp}" found at stage ${write.stageIndex}. Mutating operations are not permitted.`,
                isWrite: true,
                reference: blockedOp,
            }, pipeline, options);
        }
        if (target.whenMatchedPipeline) {
            return blockWrite(
                '$merge.whenMatched may not be a pipeline; use replace, keepExisting, merge or fail.',
                'safety_violation',
                { result: { whenMatchedPipeline: true } }
            );
        }
        if (target.database !== undefined) {
            const db = target.database;
            const validDb = typeof db === 'string' && IDENTIFIER_RE.test(db) && !isProtectedName(db);
            if (!validDb || !tenantDatabase || db !== tenantDatabase) {
                return blockWrite(
                    `Write target database "${db}" is not the connected database`,
                    'scope_violation',
                    { target: { database: String(db) } }
                );
            }
        }
        const nameCheck = validateCollectionName(target.name);
        if (!nameCheck.safe) {
            return blockWrite(nameCheck.reason, 'safety_violation');
        }
        if (restricted && !scope.includes(target.name)) {
            return blockWrite(`Write target "${target.name}" is outside the allowed scope`, 'scope_violation');
        }

        if (scopeInsufficient) return scopeInsufficient;
        return {
            kind: 'needs_approval',
            pipeline,
            write: { stage: write.stage, stageIndex: write.stageIndex, targetCollection: target.name },
        };
    }

    if (scopeInsufficient) return scopeInsufficient;
    return { kind: 'runnable', pipeline: readResult.pipeline };
}

module.exports = {
    classifyExecution,
    describeCollectionBlock,
    describeWrite,
    validatePipeline,
    validateCollectionName,
};
