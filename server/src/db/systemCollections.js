'use strict';

/**
 * Collections AtlasMind treats as internal, never as tenant data: they are
 * hidden from schema profiling, scope selection and Effective Scope checks.
 * (In development the central DB and a user DB can be the same database.)
 *
 * This is the single list; do not copy it into other modules.
 */
const SYSTEM_COLLECTIONS = Object.freeze([
    'few_shot_examples',
    'query_history',
    'dashboards',
    'user_connections',
    'workspaces',
    'approval_tokens',
    'system.views',
]);

const SYSTEM_COLLECTION_SET = new Set(SYSTEM_COLLECTIONS);

/** True for a collection that holds tenant data. */
function isUserCollection(name) {
    return typeof name === 'string'
        && !SYSTEM_COLLECTION_SET.has(name)
        && !name.startsWith('system.');
}

module.exports = { SYSTEM_COLLECTIONS, isUserCollection };
