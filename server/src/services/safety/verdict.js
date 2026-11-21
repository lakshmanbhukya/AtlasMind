// @ts-check
/** Safety Guard: write description, the final-write split and classifyExecution (ADR 0004). */

const { BLOCKED_STAGES, findBlockedOperator, findHardDenyOperator } = require('./operators');
const { describeBlock, firstKey, validatePipelineCore } = require('./pipeline');
const { IDENTIFIER_RE, describeCollectionBlock, isProtectedDatabaseName, validateCollectionName } = require('./names');

/** @typedef {import('./types').Stage} Stage */
/** @typedef {import('./types').ScopeOptions} ScopeOptions */
/** @typedef {import('./types').BlockInfo} BlockInfo */
/** @typedef {import('./types').PipelineCheck} PipelineCheck */

/**
 * Describe a staged write for the approval UI: the write stage, its target and the fields it writes.
 * @param {Stage[]} pipeline
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

/**
 * Read-part checks. An empty read part is legal next to a write; only the target collection's scope applies.
 * @param {Stage[]} readPart
 * @param {ScopeOptions} options - from classifyExecution, so allowedCollections is an array or null
 * @returns {PipelineCheck}
 */
function checkReadPart(readPart, options) {
    if (readPart.length > 0) return validatePipelineCore(readPart, options);
    const { targetCollection } = options;
    const allowedCollections = /** @type {string[]|null} */ (options.allowedCollections);
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

/**
 * @param {Record<string, any>} result - a failed check (PipelineCheck-like)
 * @param {Stage[]} pipeline
 * @param {ScopeOptions} options
 * @returns {Extract<ExecutionVerdict, { kind: 'blocked' }>}
 */
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
 * The verdict classifyExecution returns (ADR 0004).
 * @typedef {{ kind: 'runnable', pipeline: Stage[] }
 *   | { kind: 'needs_approval', pipeline: Stage[], write: { stage: string, stageIndex: number, targetCollection: string } }
 *   | { kind: 'scope_insufficient', reason: string, code: string, violatingCollections: string[], block: BlockInfo }
 *   | { kind: 'blocked', reason: string, code: string, isWrite: boolean, block: BlockInfo }} ExecutionVerdict
 */

/**
 * Safe Execution's one classification of (collection, pipeline, Effective Scope).
 *
 * Scope convention: a non-empty array is restricted; null, undefined or [] is unrestricted.
 * `tenantDatabase` is the connected database's name; when it is unknown, any explicit `db` is blocked.
 *
 * @param {{ collection?: string, pipeline?: Stage[], scope?: string[]|null, tenantDatabase?: string|null }} [input]
 * @returns {ExecutionVerdict}
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
            const validDb = typeof db === 'string' && IDENTIFIER_RE.test(db) && !isProtectedDatabaseName(db);
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
    describeWrite,
};
