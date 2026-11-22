'use strict';

const { createFakeCollection } = require('../../test-support/fakeMongo');

let mockColl;
jest.mock('../db/connection', () => ({ getDb: () => ({ collection: () => mockColl }) }));

const store = require('../stores/providerCredentialStore');

const KEY = 'gsk_test_SECRET';
const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

beforeEach(() => {
    mockColl = createFakeCollection({ unique: [['connectionId', 'sessionId']] });
});

describe('scope is required', () => {
    test.each([
        ['getState', () => store.getState('conn', undefined)],
        ['getActiveKey', () => store.getActiveKey(undefined, 'sid')],
        ['saveKey', () => store.saveKey('', 'sid', { apiKey: KEY, expiresAt: inAWeek() })],
        ['setMode', () => store.setMode('conn', null, 'managed')],
        ['deleteKey', () => store.deleteKey(null, null)],
        ['revoke', () => store.revoke('conn', '', inAWeek())],
    ])('%s throws without both IDs and touches nothing', async (_label, call) => {
        await expect(call()).rejects.toBeInstanceOf(store.CredentialScopeError);
        expect(mockColl.docs).toHaveLength(0);
    });
});

describe('personal keys', () => {
    test('no document means managed', async () => {
        await expect(store.getState('conn', 'sid-a')).resolves.toEqual({
            mode: 'managed', hasKey: false, keyLast4: null, keyExpiresAt: null,
        });
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toBeNull();
    });

    test('a saved key is encrypted at rest and returned only by getActiveKey', async () => {
        const expiresAt = inAWeek();
        await expect(store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt })).resolves.toBe(true);

        expect(JSON.stringify(mockColl.docs)).not.toContain(KEY);
        expect(mockColl.docs[0]).toMatchObject({ connectionId: 'conn', sessionId: 'sid-a', mode: 'personal', keyLast4: 'CRET' });

        const state = await store.getState('conn', 'sid-a');
        expect(state).toEqual({ mode: 'personal', hasKey: true, keyLast4: 'CRET', keyExpiresAt: expiresAt });
        expect(JSON.stringify(state)).not.toContain(KEY);
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toMatchObject({ apiKey: KEY, keyLast4: 'CRET' });
    });

    test('two sessions on one connection are isolated', async () => {
        await store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() });
        await expect(store.getState('conn', 'sid-b')).resolves.toMatchObject({ mode: 'managed', hasKey: false });
        await expect(store.getActiveKey('conn', 'sid-b')).resolves.toBeNull();
    });

    test('managed mode keeps the key but stops using it; personal needs a key', async () => {
        await expect(store.setMode('conn', 'sid-a', 'personal')).resolves.toBe(false);
        await store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() });
        await store.setMode('conn', 'sid-a', 'managed');
        await expect(store.getState('conn', 'sid-a')).resolves.toMatchObject({ mode: 'managed', hasKey: true });
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toBeNull();
        await expect(store.setMode('conn', 'sid-a', 'personal')).resolves.toBe(true);
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toMatchObject({ apiKey: KEY });
    });

    test('deleteKey removes the key and switches to managed', async () => {
        await store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() });
        await store.deleteKey('conn', 'sid-a');
        expect(mockColl.docs[0]).toMatchObject({ mode: 'managed', encryptedKey: null, keyLast4: null });
        await expect(store.getState('conn', 'sid-a')).resolves.toMatchObject({ mode: 'managed', hasKey: false });
    });

    test('an expired document reads as managed even before TTL removes it', async () => {
        await store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: new Date(Date.now() - 1000) });
        await expect(store.getState('conn', 'sid-a')).resolves.toMatchObject({ mode: 'managed', hasKey: false });
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toBeNull();
    });
});

describe('logout tombstone', () => {
    test('revoke clears the key and blocks later saves', async () => {
        await store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() });
        await store.revoke('conn', 'sid-a', inAWeek());

        expect(mockColl.docs).toHaveLength(1);
        expect(mockColl.docs[0]).toMatchObject({ revoked: true, encryptedKey: null, mode: 'managed' });
        await expect(store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() })).resolves.toBe(false);
        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toBeNull();
        expect(JSON.stringify(mockColl.docs)).not.toContain('CRET');
    });

    test('a tombstone written while a save is in flight wins', async () => {
        // The save starts first but the logout's write lands first.
        const save = store.saveKey('conn', 'sid-a', { apiKey: KEY, expiresAt: inAWeek() });
        await store.revoke('conn', 'sid-a', inAWeek());
        const saved = await save;

        await expect(store.getActiveKey('conn', 'sid-a')).resolves.toBeNull();
        expect(mockColl.docs.filter((d) => d.sessionId === 'sid-a')).toHaveLength(1);
        expect(mockColl.docs[0].revoked).toBe(true);
        // Either the save landed before the tombstone (then overwritten) or was refused.
        expect(typeof saved).toBe('boolean');
    });

    test('revoking without a prior document still writes a tombstone', async () => {
        await store.revoke('conn', 'sid-z', inAWeek());
        await expect(store.saveKey('conn', 'sid-z', { apiKey: KEY, expiresAt: inAWeek() })).resolves.toBe(false);
    });
});
