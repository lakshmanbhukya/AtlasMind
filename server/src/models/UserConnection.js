const { getDb } = require('../db/connection');

const COLLECTION_NAME = 'user_connections';

/**
 * Gets the UserConnections collection from the central database.
 * We lazily fetch this collection because `connectToDatabase` in `db/connection.js`
 * must be called first during application startup before `getDb()` is available.
 * 
 * @returns {import('mongodb').Collection}
 */
function getCollection() {
    const db = getDb();
    return db.collection(COLLECTION_NAME);
}

/**
 * Ensures the required indexes exist on the user_connections collection.
 * This should be called once on server startup.
 */
async function initializeCollection() {
    try {
        const collection = getCollection();
        await collection.createIndex({ connectionId: 1 }, { unique: true });
        console.log(`✅ Initialized indexes for ${COLLECTION_NAME} collection`);
    } catch (err) {
        console.error(`❌ Failed to initialize indexes for ${COLLECTION_NAME}:`, err);
    }
}

/**
 * Creates or updates a user connection record.
 * 
 * @param {Object} data
 * @param {string} data.connectionId - A deterministic hash of the connection string.
 * @param {string} data.encryptedUri - The AES-Encrypted connection URI.
 * @param {string} data.dbName - The target database name.
 * @param {string} [data.label] - An optional label (e.g. "Prod", "Test")
 * @returns {Promise<Object>}
 */
async function upsertConnection({ connectionId, encryptedUri, dbName, label = 'Default' }) {
    const collection = getCollection();
    const result = await collection.findOneAndUpdate(
        { connectionId },
        {
            $set: {
                encryptedUri,
                dbName,
                label,
                lastConnectedAt: new Date()
            },
            $setOnInsert: {
                createdAt: new Date()
            }
        },
        { upsert: true, returnDocument: 'after' }
    );
    return result;
}

/**
 * Finds a connection by its hashed connectionId.
 * 
 * @param {string} connectionId
 * @returns {Promise<Object|null>}
 */
async function getConnectionById(connectionId) {
    const collection = getCollection();
    return await collection.findOne({ connectionId });
}

module.exports = {
    getCollection,
    initializeCollection,
    upsertConnection,
    getConnectionById
};
