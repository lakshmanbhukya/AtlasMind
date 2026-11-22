// @ts-check
const express = require('express');
const { QueryExecutionEngine } = require('../services/queryExecutionEngine');
const { resolveProvider } = require('../services/groqService');
const queryHistoryStore = require('../stores/queryHistoryStore');
const { sendOutcome, sendError, outcomeStatus, errorResult } = require('./engineHttp');
const { forRequest } = require('../utils/logger');

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
            expectedPayer,
        } = req.body;
        const connectionId = req.connectionId;

        // Resolved once per request; 409 settings_changed before any Groq call.
        const provider = await resolveProvider({ connectionId, sessionId: req.sessionId, expectedPayer });

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
            provider,
        });

        return sendOutcome(res, outcome);
    } catch (error) {
        forRequest(req).error({ err: error }, 'Query pipeline error');
        return sendError(res, error, 'query_error', 'Failed to process query');
    }
});

const SSE_PING_MS = 15000;

/**
 * POST /api/query/stream
 *
 * Same body and engine call as POST /, streamed as Server-Sent Events:
 *   event: progress  data: {"stage":"scope"|"schema"|"ambiguity"|"generating"|"safety"|"executing"}
 *   event: result    data: {"status":<HTTP status POST / would use>,"body":<the response envelope>}
 * Exactly one `result` ends the stream. The HTTP status is always 200 once the
 * stream starts, so `result.status` carries the real one (422 for a safety
 * block, the engine error's status, ...). Errors raised before the stream
 * starts (requireAuth's 401, llmLimiter's 429) are plain JSON responses.
 */
router.post('/stream', async (req, res) => {
    const {
        text,
        model,
        collections,
        workspaceId,
        dropMissing,
        clarifications,
        bypassAmbiguity,
        isEdit,
        expectedPayer,
    } = req.body || {};
    const connectionId = req.connectionId;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // `res` 'close' fires when the client disconnects (or the response ends).
    // `req` 'close' would fire as soon as the request body was read.
    let open = true;
    const ping = setInterval(() => {
        if (open) res.write(': ping\n\n');
    }, SSE_PING_MS);
    res.on('close', () => {
        open = false;
        clearInterval(ping);
    });

    const send = (event, data) => {
        if (!open) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let result;
    try {
        const provider = await resolveProvider({ connectionId, sessionId: req.sessionId, expectedPayer });
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
            provider,
            onProgress: (stage) => send('progress', { stage }),
        });
        result = { status: outcomeStatus(outcome), body: outcome.data };
    } catch (error) {
        forRequest(req).error({ err: error }, 'Query pipeline error');
        result = errorResult(error, 'query_error', 'Failed to process query');
    }

    send('result', result);
    clearInterval(ping);
    if (open) res.end();
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
        forRequest(req).error({ err: error }, 'Export error');
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
        forRequest(req).error({ err: error }, 'Chat history error');
        return res.status(500).json({
            success: false,
            error: { code: 'history_error', message: error.message },
        });
    }
});

/**
 * PATCH /api/query/history/:id
 *
 * Rename and/or pin a history item for this connection. Body: `{ name?, pinned? }`
 * (at least one).
 */
router.patch('/history/:id', async (req, res) => {
    try {
        const { name, pinned } = req.body || {};
        const hasName = name !== undefined;
        const hasPinned = pinned !== undefined;

        if ((!hasName && !hasPinned)
            || (hasName && (typeof name !== 'string' || !name.trim()))
            || (hasPinned && typeof pinned !== 'boolean')) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'validation_error',
                    message: 'Provide a non-empty "name" string and/or a boolean "pinned" in the request body',
                },
            });
        }

        const renamed = await queryHistoryStore.update(req.connectionId, req.params.id, {
            ...(hasName ? { name: name.trim() } : {}),
            ...(hasPinned ? { pinned } : {}),
        });
        if (!renamed) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'History item not found or unauthorized' },
            });
        }

        return res.json({ success: true, message: 'History item updated successfully' });
    } catch (error) {
        forRequest(req).error({ err: error }, 'Rename history error');
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
        forRequest(req).error({ err: error }, 'Delete history error');
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
        forRequest(req).error({ err: error }, 'Approved write execution error');
        return sendError(res, error, 'execution_error', 'Failed to apply approved write transaction');
    }
});

module.exports = router;
