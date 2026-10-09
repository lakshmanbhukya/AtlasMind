const { ObjectId } = require('mongodb');
const { getDb } = require('../db/connection');

const COLLECTION_NAME = 'workspaces';

/**
 * Gets the workspaces collection from the central database.
 * @returns {import('mongodb').Collection}
 */
function getCollection() {
    const db = getDb();
    return db.collection(COLLECTION_NAME);
}

/**
 * Ensures the required indexes exist on the workspaces collection.
 * Unique on (connectionId, name).
 */
async function initializeCollection() {
    try {
        const collection = getCollection();
        await collection.createIndex({ connectionId: 1, name: 1 }, { unique: true });
        console.log(`✅ Initialized indexes for ${COLLECTION_NAME} collection`);
    } catch (err) {
        console.error(`❌ Failed to initialize indexes for ${COLLECTION_NAME}:`, err.message);
    }
}

/**
 * List all workspaces for a given connectionId.
 * @param {string} connectionId
 * @returns {Promise<Array<object>>}
 */
async function listWorkspaces(connectionId) {
    const collection = getCollection();
    return await collection
        .find({ connectionId })
        .sort({ updatedAt: -1 })
        .toArray();
}

/**
 * Find a workspace by ID and connectionId.
 * @param {string} id
 * @param {string} connectionId
 * @returns {Promise<object|null>}
 */
async function getWorkspaceById(id, connectionId) {
    if (!ObjectId.isValid(id)) return null;
    const collection = getCollection();
    return await collection.findOne({ _id: new ObjectId(id), connectionId });
}

/**
 * Create a new workspace.
 * @param {object} param0
 * @param {string} param0.connectionId
 * @param {string} param0.name
 * @param {string[]} param0.collections
 * @returns {Promise<object>}
 */
async function createWorkspace({ connectionId, name, collections }) {
    const collection = getCollection();
    const now = new Date();
    const doc = {
        connectionId,
        name: name.trim(),
        collections: Array.from(new Set(collections)),
        createdAt: now,
        updatedAt: now,
    };
    const result = await collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
}

/**
 * Update an existing workspace.
 * @param {string} id
 * @param {string} connectionId
 * @param {object} param2
 * @param {string} [param2.name]
 * @param {string[]} [param2.collections]
 * @returns {Promise<object|null>}
 */
async function updateWorkspace(id, connectionId, { name, collections }) {
    if (!ObjectId.isValid(id)) return null;
    const collection = getCollection();
    const updates = { updatedAt: new Date() };

    if (name && typeof name === 'string' && name.trim()) {
        updates.name = name.trim();
    }
    if (Array.isArray(collections)) {
        updates.collections = Array.from(new Set(collections));
    }

    const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(id), connectionId },
        { $set: updates },
        { returnDocument: 'after' }
    );
    return result;
}

/**
 * Delete a workspace by ID.
 * @param {string} id
 * @param {string} connectionId
 * @returns {Promise<boolean>}
 */
async function deleteWorkspace(id, connectionId) {
    if (!ObjectId.isValid(id)) return false;
    const collection = getCollection();
    const result = await collection.deleteOne({ _id: new ObjectId(id), connectionId });
    return result.deletedCount > 0;
}

module.exports = {
    getCollection,
    initializeCollection,
    listWorkspaces,
    getWorkspaceById,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
};
