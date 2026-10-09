const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db/connection');

const router = express.Router();
const COLLECTION = 'dashboards';

/**
 * GET /api/dashboard/shared/:id
 *
 * Public endpoint to fetch a shared dashboard widget without requiring authentication.
 * Safely projects only display fields to prevent leaking connectionId or internal credentials.
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Invalid pin ID' },
            });
        }

        const db = getDb();
        const pin = await db
            .collection(COLLECTION)
            .findOne(
                { _id: new ObjectId(id) },
                {
                    projection: {
                        _id: 1,
                        name: 1,
                        query: 1,
                        pipeline: 1,
                        collection: 1,
                        results: 1,
                        chartType: 1,
                        pinnedAt: 1,
                        lastRefreshedAt: 1,
                    },
                }
            );

        if (!pin) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Shared dashboard widget not found' },
            });
        }

        return res.json({
            success: true,
            data: pin,
        });
    } catch (error) {
        console.error('❌ Shared dashboard fetch error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

module.exports = router;
