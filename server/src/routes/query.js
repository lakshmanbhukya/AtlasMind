const express = require('express');
const { getMinifiedSchema } = require('../services/schemaProfiler');
const { getSimilarExamples, addExample } = require('../services/fewShotRetriever');
const { generateMQL } = require('../services/groqService');
const { validatePipeline, validateCollectionName } = require('../services/safetyGuard');
const { executePipeline, saveQueryHistory } = require('../services/queryExecutor');
const { getUserDb } = require('../services/userDbPool');
const { getDb } = require('../db/connection');

const router = express.Router();

// Note: requireAuth middleware is applied at index.js level for all /api/query routes.
// req.connectionId is guaranteed to be set and valid here.

/**
 * POST /api/query
 *
 * Full NL → MQL → Execute pipeline.
 * Authentication: JWT cookie (set by requireAuth middleware in index.js)
 * req.connectionId is populated by the auth middleware.
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        // 1. Validate request body
        const { text, model } = req.body;
        const connectionId = req.connectionId; // Set by requireAuth middleware

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'validation_error',
                    message: 'Request body must include a non-empty "text" field',
                },
            });
        }

        const query = text.trim();

        if (query.length > 2000) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Query text must be under 2000 characters' },
            });
        }

        // 2. Get User DB (pooled connection — reused across requests)
        const userDb = await getUserDb(connectionId);

        // 4. Profile schema + retrieve few-shot examples (in parallel)
        // forceRefresh: true avoids stale schema cache from a different DB connection
        const [schemaContext, fewShotExamples] = await Promise.all([
            getMinifiedSchema(userDb, { forceRefresh: true }),
            getSimilarExamples(query, 3),
        ]);

        // Debug: verify what the LLM receives
        console.log(`📋 Schema context for LLM (${userDb.databaseName}):\n${schemaContext.slice(0, 600)}...`);

        const similarQueriesCount = fewShotExamples.length;

        // 5. Generate MQL via Groq LLM with optional model parameter
        const llmResult = await generateMQL(query, schemaContext, fewShotExamples, model);

        // 6. Handle AI fallback (no pipeline generated)
        if (llmResult.pipeline.length === 0) {
            return res.json({
                success: true,
                naturalLanguage: query,
                aiMessage: llmResult.explanation || "I couldn't generate a query for that request.",
                pipeline: [],
                mql: [],
                collection: '',
                chartType: 'table',
                explanation: llmResult.explanation || "I couldn't generate a query for that request.",
                safetyStatus: 'read-only',
                results: [],
                result: [],
                meta: {
                    resultCount: 0,
                    executionTimeMs: 0,
                    totalTimeMs: Date.now() - startTime,
                    examplesUsed: similarQueriesCount,
                    similarQueriesCount,
                    confidenceScore: 0,
                },
                schemaContext,
                executionTimeMs: 0,
                confidenceScore: 0,
                similarQueriesCount,
            });
        }

        // 7. Safety validation
        const collectionCheck = validateCollectionName(llmResult.collection);
        if (!collectionCheck.safe) {
            return res.status(422).json({
                success: false,
                error: { code: 'safety_violation', message: collectionCheck.reason },
                naturalLanguage: query,
                aiMessage: collectionCheck.reason,
                explanation: llmResult.explanation,
                safetyStatus: 'approval-required',
                safetyBlocked: true,
                similarQueriesCount,
                schemaContext,
            });
        }

        const pipelineCheck = validatePipeline(llmResult.pipeline);
        if (!pipelineCheck.safe) {
            // Check if this is a mutating write action that can be staged for Human-in-the-Loop approval
            if (pipelineCheck.isWrite) {
                const jwt = require('jsonwebtoken');
                // Generate secure 10-minute token with draft operation payload
                const approvalToken = jwt.sign(
                    {
                        connectionId,
                        collection: llmResult.collection,
                        pipeline: llmResult.pipeline,
                        query,
                        type: 'write-approval',
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: '10m' }
                );

                return res.json({
                    success: true,
                    naturalLanguage: query,
                    aiMessage: `⚠️ Database Write Intercepted: This action will modify your collection "${llmResult.collection}". To execute this change, review and approve it.`,
                    pipeline: llmResult.pipeline,
                    mql: llmResult.pipeline,
                    collection: llmResult.collection,
                    chartType: llmResult.chartType || 'table',
                    explanation: llmResult.explanation,
                    safetyStatus: 'approval-required',
                    safetyBlocked: false,
                    approvalToken,
                    results: [],
                    result: [],
                    meta: {
                        resultCount: 0,
                        executionTimeMs: 0,
                        totalTimeMs: Date.now() - startTime,
                        similarQueriesCount,
                        confidenceScore: 100,
                    },
                });
            }

            return res.status(422).json({
                success: false,
                error: { code: 'safety_violation', message: pipelineCheck.reason },
                naturalLanguage: query,
                aiMessage: pipelineCheck.reason,
                pipeline: llmResult.pipeline,
                mql: llmResult.pipeline,
                explanation: llmResult.explanation,
                safetyStatus: 'approval-required',
                safetyBlocked: true,
                similarQueriesCount,
                schemaContext,
            });
        }

        // 8. Execute aggregation against USER DB
        const { results, executionTimeMs } = await executePipeline(
            userDb,
            llmResult.collection,
            pipelineCheck.pipeline
        );

        // 9. Compute confidence score
        const CONFIDENCE_MAP = { 0: 60, 1: 75, 2: 85, 3: 92 };
        const confidenceScore = CONFIDENCE_MAP[Math.min(similarQueriesCount, 3)] || 92;

        // 10. Save to query_history and few-shot examples (fire-and-forget memory)
        saveQueryHistory({
            connectionId,
            naturalLanguage: query,
            generatedPipeline: pipelineCheck.pipeline,
            collection: llmResult.collection,
            chartType: llmResult.chartType,
            resultCount: results.length,
            confidenceScore,
            similarQueriesCount,
            schemaContext,
            results, // Include results snapshot array for state reconstruction
        });

        // Add to few-shot memory for future AI context learning
        addExample({
            naturalLanguage: query,
            mqlPipeline: pipelineCheck.pipeline,
            collection: llmResult.collection,
        });

        const totalTimeMs = Date.now() - startTime;

        return res.json({
            success: true,
            naturalLanguage: query,
            aiMessage: llmResult.explanation || `Generated pipeline for "${llmResult.collection}" collection.`,
            explanation: llmResult.explanation,
            pipeline: pipelineCheck.pipeline,
            mql: pipelineCheck.pipeline,
            collection: llmResult.collection,
            chartType: llmResult.chartType,
            safetyStatus: 'read-only',
            safetyBlocked: false,
            results,
            result: results,
            executionTimeMs,
            confidenceScore,
            similarQueriesCount,
            schemaContext,
            meta: {
                resultCount: results.length,
                executionTimeMs,
                totalTimeMs,
                examplesUsed: similarQueriesCount,
                similarQueriesCount,
                confidenceScore,
            },
        });
    } catch (error) {
        console.error('❌ Query pipeline error:', error);
        const statusCode = error.status || error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            error: {
                code: 'query_error',
                message: error.message || 'Failed to process query',
            },
        });
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
 * Decrypts JWT approval token and executes transactions against USER DB.
 */
router.post('/approve', async (req, res) => {
    const startTime = Date.now();

    try {
        const { approvalToken } = req.body;
        if (!approvalToken) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Missing "approvalToken" field in request body' },
            });
        }

        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.verify(approvalToken, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                error: { code: 'expired_token', message: 'Approval draft has expired or is invalid. Please resend query.' },
            });
        }

        if (decoded.type !== 'write-approval') {
            return res.status(400).json({
                success: false,
                error: { code: 'invalid_token', message: 'Invalid token signature type' },
            });
        }

        const { connectionId, collection, pipeline, query } = decoded;

        // Get User DB (pooled connection — reused across requests)
        const userDb = await getUserDb(connectionId);

        // Run mutating aggregation pipeline directly on database collection
        const { results, executionTimeMs } = await executePipeline(
            userDb,
            collection,
            pipeline
        );

        // Log transaction to central query history
        saveQueryHistory({
            connectionId,
            naturalLanguage: query,
            generatedPipeline: pipeline,
            collection,
            chartType: 'table',
            resultCount: results.length,
            confidenceScore: 100,
            similarQueriesCount: 0,
            schemaContext: 'Transaction Authorized (Human-in-the-Loop Approved Write)',
            results,
        });

        return res.json({
            success: true,
            naturalLanguage: query,
            aiMessage: `✅ Transaction Authorized: Successfully executed approved write/update operation on database collection "${collection}".`,
            pipeline,
            mql: pipeline,
            collection,
            chartType: 'table',
            results,
            executionTimeMs,
            safetyStatus: 'write-executed',
            meta: {
                resultCount: results.length,
                executionTimeMs,
                totalTimeMs: Date.now() - startTime,
                similarQueriesCount: 0,
                confidenceScore: 100,
            },
        });
    } catch (error) {
        console.error('❌ Approved write execution error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'execution_error', message: error.message || 'Failed to apply approved write transaction' },
        });
    }
});

module.exports = router;
