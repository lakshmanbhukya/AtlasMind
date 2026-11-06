const express = require('express');
const { QueryExecutionEngine } = require('../services/queryExecutionEngine');
const queryHistoryStore = require('../stores/queryHistoryStore');
const { sendOutcome, sendError } = require('./engineHttp');

const router = express.Router();

// Note: requireAuth middleware is applied at index.js level for all /api/query routes.
// req.connectionId is guaranteed to be set and valid here.

/**
 * POST /api/query
 *
 * Full NL → MQL → Execute pipeline via QueryExecutionEngine.
 * Authentication: JWT cookie (set by requireAuth middleware in index.js)
 * req.connectionId is populated by the auth middleware.
 */
router.post('/', async (req, res) => {
    try {
        const {
            text,
            model,
            collections,
            workspaceId,
            dropMissing,
            clarifications,
            bypassAmbiguity,
            isEdit,
        } = req.body;
        const connectionId = req.connectionId;

        const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
            connectionId,
            text,
            model,
            collections,
            workspaceId,
            dropMissing,
            clarifications,
            bypassAmbiguity,
            isEdit,
            // Never forward an ExperimentConfig from a request body.
            source: 'query',
        });

        return sendOutcome(res, outcome);
    } catch (error) {
        console.error('❌ Query pipeline error:', error);
        return sendError(res, error, 'query_error', 'Failed to process query');
    }
});

/**
 * POST /api/query/export
 */
router.post('/export', async (req, res) => {
    try {
        const { query, pipeline, collection, results } = req.body;

        if (!results || !Array.isArray(results)) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'results array is required' },
            });
        }

        const exportPayload = {
            exportedAt: new Date().toISOString(),
            query: query || '',
            collection: collection || '',
            pipeline: pipeline || [],
            resultCount: results.length,
            results,
        };

        const filename = `atlasmind-export-${Date.now()}.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');
        return res.json(exportPayload);
    } catch (error) {
        console.error('❌ Export error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'export_error', message: error.message },
        });
    }
});

/**
 * GET /api/query/history
 *
 * Recent query history for this connection, with pipelines and result
 * snapshots for client-side session replay.
 */
router.get('/history', async (req, res) => {
    try {
        const items = await queryHistoryStore.listRecent(req.connectionId);
        return res.json({
            success: true,
            data: items,
            meta: { count: items.length },
        });
    } catch (error) {
        console.error('❌ Chat history error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'history_error', message: error.message },
        });
    }
});

/**
 * PATCH /api/query/history/:id
 *
 * Rename a history item (its naturalLanguage display label) for this connection.
 */
router.patch('/history/:id', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: '"name" string is required in request body' },
            });
        }

        const renamed = await queryHistoryStore.rename(req.connectionId, req.params.id, name.trim());
        if (!renamed) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'History item not found or unauthorized' },
            });
        }

        return res.json({ success: true, message: 'History item renamed successfully' });
    } catch (error) {
        console.error('❌ Rename history error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'rename_error', message: error.message },
        });
    }
});

/**
 * DELETE /api/query/history/:id
 *
 * Delete a history item belonging to this connection.
 */
router.delete('/history/:id', async (req, res) => {
    try {
        const removed = await queryHistoryStore.remove(req.connectionId, req.params.id);
        if (!removed) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'History item not found or unauthorized' },
            });
        }

        return res.json({
            success: true,
            message: 'History item deleted successfully',
        });
    } catch (error) {
        console.error('❌ Delete history error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'delete_error', message: error.message },
        });
    }
});

/**
 * POST /api/query/approve
 *
 * Secure execution of mutating write/update aggregation pipelines.
 * Delegates to QueryExecutionEngine.executeApprovedWrite.
 */
router.post('/approve', async (req, res) => {
    try {
        const { approvalToken } = req.body;
        const connectionId = req.connectionId;

        const outcome = await QueryExecutionEngine.executeApprovedWrite({
            approvalToken,
            connectionId,
        });

        return sendOutcome(res, outcome);
    } catch (error) {
        console.error('❌ Approved write execution error:', error);
        return sendError(res, error, 'execution_error', 'Failed to apply approved write transaction');
    }
});

module.exports = router;
