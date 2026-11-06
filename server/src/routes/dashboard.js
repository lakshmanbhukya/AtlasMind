const express = require('express');
const { ObjectId } = require('mongodb');
const dashboardStore = require('../stores/dashboardStore');
const { UnsafePipelineError } = require('../services/queryExecutor');

const router = express.Router();

// requireAuth is applied in index.js, so req.connectionId is always set here.

function invalidId(res) {
    return res.status(400).json({
        success: false,
        error: { code: 'validation_error', message: 'Invalid pin ID' },
    });
}

function notFound(res) {
    return res.status(404).json({
        success: false,
        error: { code: 'not_found', message: 'Pin not found' },
    });
}

function sendDashboardError(res, error, label) {
    if (error instanceof UnsafePipelineError) {
        return res.status(422).json({
            success: false,
            error: { code: error.code, message: error.message },
        });
    }
    console.error(`❌ Dashboard ${label} error:`, error);
    return res.status(500).json({
        success: false,
        error: { code: 'dashboard_error', message: error.message },
    });
}

/**
 * GET /api/dashboard
 *
 * List this connection's pinned dashboard queries.
 */
router.get('/', async (req, res) => {
    try {
        const pins = await dashboardStore.list(req.connectionId);
        return res.json({
            success: true,
            data: pins,
            meta: { count: pins.length },
        });
    } catch (error) {
        return sendDashboardError(res, error, 'list');
    }
});

/**
 * POST /api/dashboard/pin
 *
 * Pin a query as a dashboard widget. Unsafe pipelines are rejected with 422.
 *
 * Body: { query, pipeline, collection, chartType?, name?, results?, scope? }
 */
router.post('/pin', async (req, res) => {
    try {
        const { query, pipeline, collection, chartType, name, results, scope } = req.body;

        if (!query || !pipeline || !collection) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'validation_error',
                    message: 'Required fields: query, pipeline, collection',
                },
            });
        }

        const pin = await dashboardStore.pin(req.connectionId, {
            query, pipeline, collection, chartType, name, results, scope,
        });

        return res.status(201).json({ success: true, data: pin });
    } catch (error) {
        return sendDashboardError(res, error, 'pin');
    }
});

/**
 * DELETE /api/dashboard/:id
 *
 * Remove a pinned dashboard widget.
 */
router.delete('/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return invalidId(res);

        const removed = await dashboardStore.remove(req.connectionId, req.params.id);
        if (!removed) return notFound(res);

        return res.json({ success: true, message: 'Pin removed' });
    } catch (error) {
        return sendDashboardError(res, error, 'delete');
    }
});

/**
 * POST /api/dashboard/:id/refresh
 *
 * Re-execute a pinned query and return fresh results.
 */
router.post('/:id/refresh', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return invalidId(res);

        const pin = await dashboardStore.refresh(req.connectionId, req.params.id);
        if (!pin) return notFound(res);

        return res.json({ success: true, data: pin });
    } catch (error) {
        return sendDashboardError(res, error, 'refresh');
    }
});

module.exports = router;
