const express = require('express');
const { QueryExecutionEngine } = require('../services/queryExecutionEngine');
const { getDb } = require('../db/connection');
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
            evalOptions,
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
            evalOptions,
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
 * Fetch recent query history for this connection (from central DB).
 * Returns fully projected pipelines and result snapshots for frontend session replay.
 */
router.get('/history', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const db = getDb();

        const query = connectionId ? { connectionId } : {};

        const history = await db
            .collection('query_history')
            .find(query)
            .sort({ timestamp: -1 })
            .limit(20)
            .project({
                _id: 1,
                naturalLanguage: 1,
                timestamp: 1,
                collection: 1,
                resultCount: 1,
                schemaContext: 1,
                generatedPipeline: 1,
                chartType: 1,
                results: 1,
            })
            .toArray();

        const now = Date.now();
        const formatted = history.map((item) => {
            const diff = now - new Date(item.timestamp).getTime();
            const minutes = Math.floor(diff / 60000);
            const hours   = Math.floor(diff / 3600000);
            const days    = Math.floor(diff / 86400000);

            let timeLabel;
            if (minutes < 1)     timeLabel = 'Just now';
            else if (minutes < 60) timeLabel = `${minutes} min ago`;
            else if (hours < 24)   timeLabel = `${hours} hour${hours > 1 ? 's' : ''} ago`;
            else if (days === 1)   timeLabel = 'Yesterday';
            else                   timeLabel = `${days} days ago`;

            return {
                id: item._id.toString(),
                query: item.naturalLanguage,
                time: timeLabel,
                collection: item.collection || '',
                resultCount: item.resultCount || 0,
                schemaContext: item.schemaContext || '',
                pipeline: item.generatedPipeline || [],
                chartType: item.chartType || 'table',
                results: item.results || [],
                active: false,
            };
        });

        if (formatted.length > 0) formatted[0].active = true;

        return res.json({
            success: true,
            data: formatted,
            meta: { count: formatted.length },
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
 * Rename a specific query history item (update its naturalLanguage display label).
 * Multi-tenant safe: verifies item belongs to the active connectionId.
 */
router.patch('/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const connectionId = req.connectionId;
        const { ObjectId } = require('mongodb');

        if (!id) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'History ID is required' },
            });
        }

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: '"name" string is required in request body' },
            });
        }

        const db = getDb();
        const filter = {
            _id: new ObjectId(id),
            ...(connectionId ? { connectionId } : {}),
        };

        const result = await db.collection('query_history').updateOne(filter, {
            $set: { naturalLanguage: name.trim(), renamedAt: new Date() },
        });

        if (result.matchedCount === 0) {
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
 * Delete a specific query history log from database.
 * Multi-tenant safe: checks that the item belongs to the active connectionId.
 */
router.delete('/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const connectionId = req.connectionId;
        const { ObjectId } = require('mongodb');

        if (!id) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'History ID is required' },
            });
        }

        const db = getDb();
        const filter = {
            _id: new ObjectId(id),
            ...(connectionId ? { connectionId } : {}),
        };

        const result = await db.collection('query_history').deleteOne(filter);

        if (result.deletedCount === 0) {
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
