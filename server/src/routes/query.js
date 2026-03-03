const express = require('express');
const { MongoClient } = require('mongodb');
const { getMinifiedSchema } = require('../services/schemaProfiler');
const { getSimilarExamples, addExample } = require('../services/fewShotRetriever');
const { generateMQL } = require('../services/groqService');
const { validatePipeline, validateCollectionName } = require('../services/safetyGuard');
const { executePipeline, saveQueryHistory } = require('../services/queryExecutor');
const { getConnectionById } = require('../models/UserConnection');
const { decrypt } = require('../utils/encryption');
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
    let client = null;

    try {
        // 1. Validate request body
        const { text } = req.body;
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

        // 2. Fetch User Connection & Decrypt
        const userConn = await getConnectionById(connectionId);
        if (!userConn) {
            return res.status(404).json({ success: false, error: { message: 'Connection not found or inactive' } });
        }

        const uri = decrypt(userConn.encryptedUri);

        // 3. Connect to User DB
        client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
        await client.connect();
        const userDb = client.db(userConn.dbName);

        // 4. Profile schema + retrieve few-shot examples (in parallel)
        // forceRefresh: true avoids stale schema cache from a different DB connection
        const [schemaContext, fewShotExamples] = await Promise.all([
            getMinifiedSchema(userDb, { forceRefresh: true }),
            getSimilarExamples(query, 3),
        ]);

        // Debug: verify what the LLM receives
        console.log(`📋 Schema context for LLM (${userDb.databaseName}):\n${schemaContext.slice(0, 600)}...`);

        const similarQueriesCount = fewShotExamples.length;

        // 5. Generate MQL via Groq LLM
        const llmResult = await generateMQL(query, schemaContext, fewShotExamples);

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
    } finally {
        if (client) await client.close();
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

module.exports = router;
