const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db/connection');

const router = express.Router();
const COLLECTION = 'dashboards';

/**
 * GET /api/dashboard
 *
 * List all pinned dashboard queries.
 */
router.get('/', async (_req, res) => {
    try {
        const db = getDb();
        const pins = await db
            .collection(COLLECTION)
            .find({})
            .sort({ pinnedAt: -1 })
            .toArray();

        return res.json({
            success: true,
            data: pins,
            meta: { count: pins.length },
        });
    } catch (error) {
        console.error('❌ Dashboard list error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

/**
 * POST /api/dashboard/pin
 *
 * Pin a query as a dashboard widget.
 *
 * Body: { query, pipeline, collection, chartType, name? }
 */
router.post('/pin', async (req, res) => {
    try {
        const { query, pipeline, collection, chartType, name, results } = req.body;

        if (!query || !pipeline || !collection) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'validation_error',
                    message: 'Required fields: query, pipeline, collection',
                },
            });
        }

        const db = getDb();
        const pin = {
            name: name || query.substring(0, 60),
            query,
            pipeline,
            collection,
            results, // Store snapshot of results
            chartType: chartType || 'table',
            pinnedAt: new Date(),
        };

        const result = await db.collection(COLLECTION).insertOne(pin);

        return res.status(201).json({
            success: true,
            data: { ...pin, _id: result.insertedId },
        });
    } catch (error) {
        console.error('❌ Dashboard pin error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

/**
 * DELETE /api/dashboard/:id
 *
 * Remove a pinned dashboard widget.
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Invalid pin ID' },
            });
        }

        const db = getDb();
        const result = await db
            .collection(COLLECTION)
            .deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Pin not found' },
            });
        }

        return res.json({ success: true, message: 'Pin removed' });
    } catch (error) {
        console.error('❌ Dashboard delete error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

/**
 * POST /api/dashboard/:id/refresh
 *
 * Re-execute a pinned query and return fresh results.
 */
router.post('/:id/refresh', async (req, res) => {
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
            .findOne({ _id: new ObjectId(id) });

        if (!pin) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Pin not found' },
            });
        }

        // Re-execute the stored pipeline
        const { executePipeline } = require('../services/queryExecutor');
        const { results, executionTimeMs } = await executePipeline(
            pin.collection,
            pin.pipeline
        );

        return res.json({
            success: true,
            data: {
                ...pin,
                results,
                meta: { resultCount: results.length, executionTimeMs },
            },
        });
    } catch (error) {
        console.error('❌ Dashboard refresh error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

module.exports = router;
