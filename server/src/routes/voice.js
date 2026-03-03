const express = require('express');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { transcribeAudio } = require('../services/groqService');
const { getMinifiedSchema } = require('../services/schemaProfiler');
const { getSimilarExamples } = require('../services/fewShotRetriever');
const { generateMQL } = require('../services/groqService');
const { validatePipeline, validateCollectionName } = require('../services/safetyGuard');
const { executePipeline, saveQueryHistory } = require('../services/queryExecutor');
const { getConnectionById } = require('../models/UserConnection');
const { decrypt } = require('../utils/encryption');

const router = express.Router();

// Note: requireAuth middleware is applied at index.js level.
// req.connectionId is guaranteed to be set here.

// Configure multer for audio file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
            'audio/webm', 'audio/ogg', 'audio/flac', 'audio/mp4',
            'audio/m4a', 'audio/x-m4a',
        ];
        if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|webm|ogg|flac|m4a|mp4)$/i)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported audio format: ${file.mimetype}`), false);
        }
    },
});

/**
 * POST /api/voice
 *
 * Speech-to-Query pipeline:
 * 1. Transcribes uploaded audio using Groq Whisper
 * 2. Connects to USER's database via JWT cookie connectionId
 * 3. Profiles schema, generates MQL, executes pipeline
 * 4. Returns same structured response as POST /api/query
 */
router.post('/', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    let client = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'No audio file uploaded. Send a file in the "audio" field.' },
            });
        }

        const { buffer, originalname, size } = req.file;
        const connectionId = req.connectionId;

        console.log(`🎙️ Transcribing audio: ${originalname} (${(size / 1024).toFixed(1)} KB)`);

        // Step 1: Transcribe audio → text
        const transcription = await transcribeAudio(buffer, originalname);
        const queryText = transcription.text?.trim();

        if (!queryText) {
            return res.status(400).json({
                success: false,
                error: { code: 'transcription_empty', message: 'Could not extract text from audio. Please try again.' },
                transcript: '', text: '',
            });
        }

        console.log(`📝 Transcribed: "${queryText}"`);

        // Step 2: Connect to USER DB
        const userConn = await getConnectionById(connectionId);
        if (!userConn) {
            return res.status(404).json({ success: false, error: { message: 'Connection not found' } });
        }
        const uri = decrypt(userConn.encryptedUri);
        client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
        await client.connect();
        const userDb = client.db(userConn.dbName);

        // Step 3: Profile schema + retrieve examples (in parallel)
        const [schemaContext, fewShotExamples] = await Promise.all([
            getMinifiedSchema(userDb, { forceRefresh: true }),
            getSimilarExamples(queryText, 3),
        ]);

        const similarQueriesCount = fewShotExamples.length;
        const llmResult = await generateMQL(queryText, schemaContext, fewShotExamples);

        // Empty pipeline fallback
        if (llmResult.pipeline.length === 0) {
            return res.json({
                success: true,
                transcript: queryText, text: queryText, naturalLanguage: queryText,
                aiMessage: llmResult.explanation || "I couldn't generate a query for that request.",
                pipeline: [], mql: [], collection: '', chartType: 'table',
                safetyStatus: 'read-only', safetyBlocked: false,
                results: [], result: [],
                executionTimeMs: 0, confidenceScore: 0, similarQueriesCount,
                schemaContext,
                meta: {
                    resultCount: 0, executionTimeMs: 0,
                    totalTimeMs: Date.now() - startTime, similarQueriesCount, confidenceScore: 0,
                    transcriptionMeta: { filename: originalname, sizeBytes: size, language: transcription.language },
                },
            });
        }

        // Safety validation
        const collectionCheck = validateCollectionName(llmResult.collection);
        if (!collectionCheck.safe) {
            return res.status(422).json({
                success: false,
                error: { code: 'safety_violation', message: collectionCheck.reason },
                transcript: queryText, text: queryText, naturalLanguage: queryText,
                aiMessage: collectionCheck.reason,
                safetyStatus: 'approval-required', safetyBlocked: true, similarQueriesCount,
            });
        }

        const pipelineCheck = validatePipeline(llmResult.pipeline);
        if (!pipelineCheck.safe) {
            return res.status(422).json({
                success: false,
                error: { code: 'safety_violation', message: pipelineCheck.reason },
                transcript: queryText, text: queryText, naturalLanguage: queryText,
                aiMessage: pipelineCheck.reason,
                pipeline: llmResult.pipeline, mql: llmResult.pipeline,
                safetyStatus: 'approval-required', safetyBlocked: true, similarQueriesCount,
            });
        }

        // Execute pipeline against USER DB
        const { results, executionTimeMs } = await executePipeline(
            userDb,
            llmResult.collection,
            pipelineCheck.pipeline
        );

        const CONFIDENCE_MAP = { 0: 60, 1: 75, 2: 85, 3: 92 };
        const confidenceScore = CONFIDENCE_MAP[Math.min(similarQueriesCount, 3)] || 92;

        // Save history
        saveQueryHistory({
            connectionId,
            naturalLanguage: queryText,
            generatedPipeline: pipelineCheck.pipeline,
            collection: llmResult.collection,
            chartType: llmResult.chartType,
            resultCount: results.length,
            executionTimeMs, confidenceScore, similarQueriesCount,
            schemaContext,
            source: 'voice',
        });

        return res.json({
            success: true,
            transcript: queryText, text: queryText, language: transcription.language,
            duration: transcription.duration, naturalLanguage: queryText,
            aiMessage: llmResult.explanation || `Generated pipeline for "${llmResult.collection}" from your voice query.`,
            explanation: llmResult.explanation,
            pipeline: pipelineCheck.pipeline, mql: pipelineCheck.pipeline,
            collection: llmResult.collection, chartType: llmResult.chartType,
            safetyStatus: 'read-only', safetyBlocked: false,
            results, result: results,
            executionTimeMs, confidenceScore, similarQueriesCount,
            schemaContext,
            meta: {
                resultCount: results.length, executionTimeMs,
                totalTimeMs: Date.now() - startTime, similarQueriesCount, confidenceScore,
                transcriptionMeta: { filename: originalname, sizeBytes: size, language: transcription.language, duration: transcription.duration },
            },
        });
    } catch (error) {
        console.error('❌ Voice pipeline error:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'upload_error',
                    message: error.code === 'LIMIT_FILE_SIZE' ? 'Audio file too large (max 25 MB)' : error.message,
                },
            });
        }
        return res.status(500).json({
            success: false,
            error: { code: 'voice_pipeline_error', message: error.message || 'Failed to process voice query' },
        });
    } finally {
        if (client) await client.close();
    }
});

module.exports = router;
