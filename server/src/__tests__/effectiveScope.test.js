'use strict';

const mockGetWorkspaceById = jest.fn();
jest.mock('../models/Workspace', () => ({
    getWorkspaceById: (...args) => mockGetWorkspaceById(...args),
}));

const mockGetUserDb = jest.fn();
jest.mock('../services/userDbPool', () => ({
    getUserDb: (...args) => mockGetUserDb(...args),
}));

const { resolve, requireKnownCollections } = require('../services/effectiveScope');
const { ValidationError, ScopeError } = require('../services/engineErrors');

const CONNECTION_ID = 'tenant-scope-1';
const WORKSPACE_ID = '64b7f0000000000000000001';

function fakeDb(names) {
    return {
        listCollections: () => ({
            toArray: async () => names.map((name) => ({ name })),
        }),
    };
}

// system.* and the central app collections are never user collections
const userDb = fakeDb(['orders', 'customers', 'inventory', 'system.views', 'query_history']);
const ALL = ['orders', 'customers', 'inventory'];

describe('effectiveScope.resolve', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty array', []],
    ])('%s collections → all user collections, unrestricted', async (_label, collections) => {
        const scope = await resolve({ userDb, connectionId: CONNECTION_ID, collections });
        expect(scope).toEqual({ collections: ALL, restricted: false, all: ALL, source: 'all', dropped: [] });
        expect(mockGetWorkspaceById).not.toHaveBeenCalled();
    });

    test('system and internal collections never appear in all', async () => {
        const { all } = await resolve({ userDb, connectionId: CONNECTION_ID });
        expect(all).not.toContain('system.views');
        expect(all).not.toContain('query_history');
    });

    test('an explicit list is restricted to it (deduplicated)', async () => {
        const scope = await resolve({ userDb, connectionId: CONNECTION_ID, collections: ['orders', 'orders'] });
        expect(scope).toMatchObject({ collections: ['orders'], restricted: true, source: 'collections', dropped: [] });
    });

    test.each([
        ['a string', 'orders'],
        ['an object', { name: 'orders' }],
    ])('collections as %s → ValidationError', async (_label, collections) => {
        await expect(resolve({ userDb, connectionId: CONNECTION_ID, collections }))
            .rejects.toBeInstanceOf(ValidationError);
    });

    test.each([[''], ['   '], [42]])('collection name %p → ValidationError', async (name) => {
        await expect(resolve({ userDb, connectionId: CONNECTION_ID, collections: ['orders', name] }))
            .rejects.toBeInstanceOf(ValidationError);
    });

    test('an unknown collection → ScopeError', async () => {
        const err = await resolve({ userDb, connectionId: CONNECTION_ID, collections: ['orders', 'ghost'] })
            .catch((e) => e);
        expect(err).toBeInstanceOf(ScopeError);
        expect(err.code).toBe('validation_error');
        expect(err.message).toBe('Unknown collection: "ghost"');
    });

    test('dropMissing drops unknown collections and reports them', async () => {
        const scope = await resolve({
            userDb, connectionId: CONNECTION_ID, collections: ['orders', 'ghost'], dropMissing: true,
        });
        expect(scope).toMatchObject({ collections: ['orders'], restricted: true, dropped: ['ghost'] });
    });

    test('a workspace restricts the scope to its collections', async () => {
        mockGetWorkspaceById.mockResolvedValueOnce({ collections: ['orders', 'customers'] });
        const scope = await resolve({ userDb, connectionId: CONNECTION_ID, workspaceId: WORKSPACE_ID });
        expect(mockGetWorkspaceById).toHaveBeenCalledWith(WORKSPACE_ID, CONNECTION_ID);
        expect(scope).toEqual({
            collections: ['orders', 'customers'], restricted: true, all: ALL, source: 'workspace', dropped: [],
        });
    });

    test('a workspace with some missing collections drops them', async () => {
        mockGetWorkspaceById.mockResolvedValueOnce({ collections: ['orders', 'deleted_coll'] });
        const scope = await resolve({ userDb, connectionId: CONNECTION_ID, workspaceId: WORKSPACE_ID });
        expect(scope).toMatchObject({ collections: ['orders'], restricted: true, dropped: ['deleted_coll'] });
    });

    test.each([
        ['all collections missing', { collections: ['gone_a', 'gone_b'] }],
        ['no collections field', {}],
    ])('a workspace with %s → workspace_empty', async (_label, workspace) => {
        mockGetWorkspaceById.mockResolvedValueOnce(workspace);
        await expect(resolve({ userDb, connectionId: CONNECTION_ID, workspaceId: WORKSPACE_ID }))
            .rejects.toMatchObject({ name: 'ScopeError', code: 'workspace_empty', statusCode: 400 });
    });

    test.each([
        ['another tenant\'s or unknown id', WORKSPACE_ID],
        ['an invalid ObjectId', 'not-an-id'],
    ])('a workspace that is not found (%s) → workspace_not_found', async (_label, workspaceId) => {
        mockGetWorkspaceById.mockResolvedValueOnce(null); // the model returns null for both
        await expect(resolve({ userDb, connectionId: CONNECTION_ID, workspaceId }))
            .rejects.toMatchObject({ name: 'ScopeError', code: 'workspace_not_found' });
    });

    test('explicit collections take precedence over workspaceId (and imply dropMissing)', async () => {
        const scope = await resolve({
            userDb, connectionId: CONNECTION_ID, collections: ['inventory', 'ghost'], workspaceId: WORKSPACE_ID,
        });
        expect(mockGetWorkspaceById).not.toHaveBeenCalled();
        expect(scope).toMatchObject({ collections: ['inventory'], source: 'collections', dropped: ['ghost'] });
    });
});

describe('effectiveScope.requireKnownCollections', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetUserDb.mockResolvedValue(userDb);
    });

    test('returns the names when all are known', async () => {
        await expect(requireKnownCollections(CONNECTION_ID, ['orders', 'inventory']))
            .resolves.toEqual(['orders', 'inventory']);
        expect(mockGetUserDb).toHaveBeenCalledWith(CONNECTION_ID);
    });

    test('rejects non-string or empty names', async () => {
        await expect(requireKnownCollections(CONNECTION_ID, ['orders', '']))
            .rejects.toMatchObject({ name: 'ValidationError', message: 'Collection names must be non-empty strings' });
    });

    test('rejects unknown and system collections', async () => {
        await expect(requireKnownCollections(CONNECTION_ID, ['ghost']))
            .rejects.toMatchObject({ name: 'ScopeError', message: 'Unknown collection: "ghost"' });
        await expect(requireKnownCollections(CONNECTION_ID, ['system.views']))
            .rejects.toMatchObject({ name: 'ScopeError' });
    });
});
