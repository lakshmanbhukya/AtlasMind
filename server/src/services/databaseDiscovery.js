const { MongoClient } = require('mongodb');

const { isUserCollection } = require('../db/systemCollections');

const INTERNAL_DATABASES = new Set(['admin', 'local', 'config']);

/** Opens a short-lived, small-pool client for a connection string the user has not stored yet. */
async function openTemporaryClient(connectionString) {
    const client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000, maxPoolSize: 2 });
    try {
        await client.connect();
    } catch (err) {
        await client.close().catch(() => {});
        throw err;
    }
    return client;
}

/**
 * Lists the non-internal, non-empty databases visible to a connected client.
 * Returns [] when the user lacks the listDatabases privilege.
 *
 * @param {import('mongodb').MongoClient} client - an already connected client
 * @returns {Promise<Array<{ name: string, collections: string[], collectionCount: number }>>}
 */
async function listUserDatabases(client) {
    let databases;
    try {
        ({ databases } = await client.db().admin().listDatabases({ nameOnly: true }));
    } catch {
        return [];
    }

    const result = [];
    for (const d of databases) {
        if (INTERNAL_DATABASES.has(d.name)) continue;
        try {
            const cols = await client.db(d.name).listCollections({}, { nameOnly: true }).toArray();
            const names = cols.map((c) => c.name).filter(isUserCollection);
            if (names.length > 0) {
                result.push({ name: d.name, collections: names, collectionCount: names.length });
            }
        } catch {
            // No access to this database — skip it
        }
    }
    return result;
}

/**
 * Opens a short-lived client for `connectionString`, lists its databases
 * and always closes the client.
 */
async function discoverDatabases(connectionString) {
    let client = null;
    try {
        client = await openTemporaryClient(connectionString);
        return await listUserDatabases(client);
    } finally {
        if (client) await client.close().catch(() => {});
    }
}

module.exports = { listUserDatabases, discoverDatabases, openTemporaryClient };
