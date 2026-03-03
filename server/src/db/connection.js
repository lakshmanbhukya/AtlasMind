const { MongoClient } = require('mongodb');

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

    console.log(`✅ Connected to MongoDB — database: ${DB_NAME}`);
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
 * Get the raw MongoClient instance.
 * @returns {MongoClient}
 */
function getClient() {
    if (!client) {
        throw new Error('Client not initialized. Call connectToDatabase() first.');
    }
    return client;
}

/**
 * Close the MongoDB connection gracefully.
 */
async function closeConnection() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('🔌 MongoDB connection closed');
    }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    await closeConnection();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeConnection();
    process.exit(0);
});

module.exports = { connectToDatabase, getDb, getClient, closeConnection };
