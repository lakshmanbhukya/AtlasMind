// @ts-check
/** Safety Guard: collection references across top-level and nested stages. */

const { IDENTIFIER_RE, isProtectedDatabaseName, validateCollectionName } = require('./names');

/** @typedef {import('./types').Stage} Stage */
/** @typedef {import('./types').ScopeOptions} ScopeOptions */
/** @typedef {import('./types').ReferenceCheck} ReferenceCheck */

/**
 * Recursively find and validate all collections referenced across top-level and nested stages.
 * Supports string and document-form $lookup.from ({ coll, [db] }), $unionWith, $graphLookup, and $facet.
 *
 * @param {Stage[]} stages
 * @param {ScopeOptions} [options={}]
 * @returns {ReferenceCheck}
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
                        if (isProtectedDatabaseName(from.db)) {
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

module.exports = {
    extractAndValidateCollectionReferences,
};
