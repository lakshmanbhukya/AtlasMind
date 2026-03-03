const express = require('express');
const { MongoClient } = require('mongodb');
const router = express.Router();
const { encrypt, hashString } = require('../utils/encryption');
const { upsertConnection } = require('../models/UserConnection');
const { signToken } = require('../utils/jwt');

const COOKIE_NAME = 'am_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * POST /api/connections/connect
 *
 * Validates the MongoDB connection string, verifies the database exists
 * and has collections, encrypts + stores it, then issues a JWT cookie.
 *
 * If the database doesn't exist or is empty, returns a list of available
 * databases so the user can pick the correct one.
 */
router.post('/connect', async (req, res) => {
    let client = null;

    try {
        let { connectionString, dbName, label } = req.body;

        if (connectionString) connectionString = connectionString.trim();
        if (dbName) dbName = dbName.trim();

        if (!connectionString || !connectionString.startsWith('mongodb')) {
            return res.status(400).json({
                success: false,
                error: { message: 'Invalid MongoDB connection string format' },
            });
        }

        if (!dbName) {
            return res.status(400).json({
                success: false,
                error: { message: 'dbName is required' },
            });
        }

        // ── Validate the connection + database BEFORE storing ──
        client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000, maxPoolSize: 2 });
        await client.connect();

        const userDb = client.db(dbName);
        const collections = await userDb.listCollections().toArray();
        const userCollections = collections
            .map(c => c.name)
            .filter(name => !name.startsWith('system.'));

        if (userCollections.length === 0) {
            // Database might not exist or is empty — list available ones for the user
            const adminDb = client.db().admin();
            let availableDbs = [];
            try {
                const { databases } = await adminDb.listDatabases();
                // Filter out internal DBs and empty ones
                const internalNames = new Set(['admin', 'local', 'config']);
                for (const d of databases) {
                    if (internalNames.has(d.name)) continue;
                    const cols = await client.db(d.name).listCollections().toArray();
                    const userCols = cols.filter(c => !c.name.startsWith('system.'));
                    if (userCols.length > 0) {
                        availableDbs.push({
                            name: d.name,
                            collections: userCols.map(c => c.name),
                            collectionCount: userCols.length,
                        });
                    }
                }
            } catch {
                // listDatabases might fail due to permissions — that's okay
            }

            return res.status(400).json({
                success: false,
                error: {
                    code: 'empty_database',
                    message: `Database "${dbName}" has no collections. Please check the database name.`,
                },
                availableDatabases: availableDbs,
            });
        }

        // ── Database is valid — proceed with storing ──
        const connectionId = hashString(connectionString);
        const encryptedUri = encrypt(connectionString);

        await upsertConnection({
            connectionId,
            encryptedUri,
            dbName,
            label: label || 'My Database',
        });

        // Issue JWT cookie
        const token = signToken(connectionId);
        
        // Cookie options for production vs local
        const isProd = process.env.NODE_ENV === 'production';
        const cookieOpts = {
            httpOnly: true,
            secure: isProd, // Must be true on Render (HTTPS)
            sameSite: isProd ? 'none' : 'lax', // 'none' for cross-site (Render), 'lax' for local
            maxAge: COOKIE_MAX_AGE,
            path: '/',
        };

        res.cookie(COOKIE_NAME, token, cookieOpts);

        return res.json({
            success: true,
            dbName,
            label: label || 'My Database',
            collectionCount: userCollections.length,
            collections: userCollections,
            message: `Connected! Found ${userCollections.length} collections in "${dbName}".`,
        });

    } catch (err) {
        console.error('❌ [CONNECT_ERROR]', err);

        // Distinguish connection errors from other errors
        if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError') {
            return res.status(400).json({
                success: false,
                error: { message: 'Could not connect to MongoDB. Please check your connection string.' },
            });
        }

        return res.status(500).json({
            success: false,
            error: { message: 'Failed to securely save connection' },
        });
    } finally {
        if (client) await client.close();
    }
});

/**
 * GET /api/connections/:connectionId
 */
router.get('/:connectionId', async (req, res) => {
    try {
        const { getConnectionById } = require('../models/UserConnection');
        const conn = await getConnectionById(req.params.connectionId);

        if (!conn) {
            return res.status(404).json({ success: false, error: { message: 'Connection not found' } });
        }

        return res.json({
            success: true,
            connection: {
                connectionId: conn.connectionId,
                dbName: conn.dbName,
                label: conn.label,
                lastConnectedAt: conn.lastConnectedAt,
                createdAt: conn.createdAt,
            },
        });
    } catch (err) {
        console.error('❌ [GET_CONNECTION_ERROR]', err);
        return res.status(500).json({ success: false, error: { message: 'Failed to fetch connection details' } });
    }
});

module.exports = router;
