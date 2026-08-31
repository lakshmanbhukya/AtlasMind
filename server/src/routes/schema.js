const express = require('express');
const { profileSchema } = require('../services/schemaProfiler');
const { getUserDb } = require('../services/userDbPool');

const router = express.Router();

// Note: requireAuth middleware is applied at index.js level.
// req.connectionId is guaranteed to be set here.

/**
 * GET /api/schema
 *
 * Returns the database schema — collections, fields, types, doc counts.
 * Uses req.connectionId (from JWT cookie) to connect to the user's own DB.
 */
router.get('/', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const db = await getUserDb(connectionId);

        const schema = await profileSchema(db);

        return res.json({
            success: true,
            data: schema,
        });
    } catch (error) {
        console.error('❌ Schema profiling error:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'schema_error',
                message: error.message || 'Failed to profile database schema',
            },
        });
    }
});

/**
 * GET /api/schema/refresh
 *
 * Force-refreshes the schema cache for this user's database.
 */
router.get('/refresh', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const db = await getUserDb(connectionId);

        const schema = await profileSchema(db, { forceRefresh: true });

        return res.json({
            success: true,
            data: schema,
            meta: { cacheRefreshed: true },
        });
    } catch (error) {
        console.error('❌ Schema refresh error:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'schema_error',
                message: error.message || 'Failed to refresh schema',
            },
        });
    }
});

module.exports = router;
