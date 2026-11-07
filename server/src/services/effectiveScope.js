'use strict';

/**
 * Effective Scope: the verified subset of a tenant's collections that are
 * admissible for schema introspection and pipeline execution (GLOSSARY.md).
 *
 * This module is the only place that decides it. It fails closed: an unknown
 * or emptied workspace is an error, never a silent widening to every
 * collection.
 */

const Workspace = require('../models/Workspace');
const { listUserCollections, getUserCollections } = require('./tenantSchema');
const { ValidationError, ScopeError } = require('./engineErrors');

function assertNonEmptyStrings(names, message) {
    for (const name of names) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new ValidationError(message);
        }
    }
}

/**
 * Resolve the Effective Scope of a request.
 *
 * Precedence: a non-empty `collections` array, then `workspaceId`, then all
 * of the tenant's user collections.
 *
 * @param {object} params
 * @param {import('mongodb').Db} params.userDb - the tenant's database (passed in, so experiments and tests can supply their own)
 * @param {string} params.connectionId
 * @param {string[]|undefined|null} [params.collections]
 * @param {string} [params.workspaceId]
 * @param {boolean} [params.dropMissing=false] - drop unknown explicit collections instead of rejecting them
 * @returns {Promise<{ collections: string[], restricted: boolean, all: string[], source: 'all'|'collections'|'workspace', dropped: string[] }>}
 * @throws {ValidationError} collections is not an array, or a name is not a non-empty string
 * @throws {ScopeError} unknown collection ('validation_error'), 'workspace_not_found', 'workspace_empty'
 */
async function resolve({ userDb, connectionId, collections, workspaceId, dropMissing = false }) {
    const all = await listUserCollections(userDb);
    const known = new Set(all);

    if (collections !== undefined && collections !== null && !Array.isArray(collections)) {
        throw new ValidationError('"collections" must be an array of collection names');
    }

    if (Array.isArray(collections) && collections.length > 0) {
        assertNonEmptyStrings(collections, 'Each collection in "collections" must be a non-empty string');
        const drop = Boolean(dropMissing || workspaceId);
        const dropped = [];
        for (const name of collections) {
            if (known.has(name)) continue;
            if (!drop) throw new ScopeError(`Unknown collection: "${name}"`);
            dropped.push(name);
        }
        const kept = Array.from(new Set(collections.filter((c) => known.has(c))));
        // Legacy behaviour: an explicit list that loses every entry to dropMissing
        // falls back to all collections (still flagged restricted).
        return {
            collections: kept.length > 0 ? kept : all,
            restricted: true,
            all,
            source: 'collections',
            dropped,
        };
    }

    if (workspaceId) {
        const workspace = await Workspace.getWorkspaceById(workspaceId, connectionId);
        if (!workspace) {
            throw new ScopeError('Workspace not found', 'workspace_not_found');
        }
        const wsCollections = Array.isArray(workspace.collections) ? workspace.collections : [];
        const kept = Array.from(new Set(wsCollections.filter((c) => known.has(c))));
        const dropped = wsCollections.filter((c) => !known.has(c));
        if (kept.length === 0) {
            throw new ScopeError(
                'None of this workspace\'s collections exist in the database any more',
                'workspace_empty'
            );
        }
        return { collections: kept, restricted: true, all, source: 'workspace', dropped };
    }

    return { collections: all, restricted: false, all, source: 'all', dropped: [] };
}

/**
 * Check that every name is an existing user collection of the tenant
 * (used when saving a workspace).
 *
 * @param {string} connectionId
 * @param {string[]} names
 * @returns {Promise<string[]>} the names, unchanged
 * @throws {ValidationError|ScopeError}
 */
async function requireKnownCollections(connectionId, names) {
    assertNonEmptyStrings(names, 'Collection names must be non-empty strings');
    const known = new Set(await getUserCollections(connectionId));
    for (const name of names) {
        if (!known.has(name)) throw new ScopeError(`Unknown collection: "${name}"`);
    }
    return names;
}

module.exports = { resolve, requireKnownCollections };
