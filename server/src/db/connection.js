// @ts-check
require('../utils/dnsConfig');
const { MongoClient } = require('mongodb');
const log = require('../utils/logger').logger.child({ module: 'db' });

/** @type {MongoClient|null} */
let client = null;

/** @type {import('mongodb').Db|null} */
let db = null;

const DB_NAME = 'aggregatorflow_db';

/**
 * Connect to MongoDB and return the database instance.
 * Reuses existing connection if already connected.
 * @returns {Promise<import('mongodb').Db>}
 */
async function connectToDatabase() {
    if (db) return db;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI environment variable is not set');
    }

    client = new MongoClient(uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
    });

    await client.connect();
    db = client.db(DB_NAME);

    log.info({ db: DB_NAME }, 'Connected to MongoDB');
    return db;
}

/**
 * Get the database instance (must call connectToDatabase first).
 * @returns {import('mongodb').Db}
 */
function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call connectToDatabase() first.');
    }
    return db;
}

/**
 * Close the MongoDB connection gracefully.
 */
async function closeConnection() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        log.info('MongoDB connection closed');
    }
}

// Shutdown is owned by index.js, which closes the user DB pool first and then
// calls closeConnection(); registering exit handlers here raced that sequence.

module.exports = { connectToDatabase, getDb, closeConnection };
