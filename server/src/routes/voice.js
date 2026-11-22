// @ts-check
const express = require('express');
const multer = require('multer');
const { transcribeAudio, resolveProvider } = require('../services/groqService');
const { QueryExecutionEngine } = require('../services/queryExecutionEngine');
const { sendOutcome, sendError, logPipelineError } = require('./engineHttp');
const { forRequest } = require('../utils/logger');

const router = express.Router();

/** Largest upload the managed allowance accepts; personal keys keep multer's 25 MB limit. */
const MANAGED_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
            // multer's typings declare (error) or (null, accept); it accepts (error, false) at runtime.
            cb(/** @type {any} */ (new Error(`Unsupported audio format: ${file.mimetype}`)), false);
        }
    },
});

/**
 * Multipart fields arrive as strings, so "collections" is sent as a JSON array.
 * An empty string means no explicit scope; anything that is not an array is rejected.
 * (Effective Scope itself validates the names.)
 */
function parseMultipartCollections(raw) {
    if (raw === undefined || raw === null) return { ok: true, collections: undefined };
    if (Array.isArray(raw)) return { ok: true, collections: raw };
    if (typeof raw !== 'string') return { ok: false };
    if (!raw.trim()) return { ok: true, collections: undefined };
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? { ok: true, collections: value } : { ok: false };
    } catch {
        return { ok: false };
    }
}

/**
 * POST /api/voice
 *
 * Speech-to-Query adapter:
 * 1. Transcribes uploaded audio using Groq Whisper at the intake seam
 * 2. Delegates normalized transcript to QueryExecutionEngine with source: 'voice'
 * 3. Enriches outcome with voice transcription metadata for client backwards-compatibility
 */
router.post('/', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'No audio file uploaded. Send a file in the "audio" field.' },
            });
        }

        const { buffer, originalname, size } = req.file;
        const connectionId = req.connectionId;
        const model = req.body?.model;
        const workspaceId = req.body?.workspaceId || undefined;

        const parsed = parseMultipartCollections(req.body?.collections);
        if (!parsed.ok) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: '"collections" must be a JSON array of collection names' },
            });
        }
        const { collections } = parsed;

        // One payer for both Whisper and the text stage; 409 settings_changed before any Groq call.
        const provider = await resolveProvider({
            connectionId,
            sessionId: req.sessionId,
            expectedPayer: req.body?.expectedPayer,
        });

        // The managed allowance budgets 60 s of audio per call; longer uploads need a personal key.
        if (provider.payer === 'managed' && size > MANAGED_MAX_UPLOAD_BYTES) {
            return res.status(400).json({
                success: false,
                error: { code: 'upload_error', message: 'Recordings over 5 MB need your own Groq key.' },
            });
        }

        forRequest(req).info({ sizeBytes: size, payer: provider.payer }, 'Transcribing audio');

        // Step 1: Transcribe audio → text
        const transcription = await transcribeAudio(buffer, originalname, provider);
        const queryText = transcription.text?.trim();

        if (!queryText) {
            return res.status(400).json({
                success: false,
                error: { code: 'transcription_empty', message: 'Could not extract text from audio. Please try again.' },
                transcript: '',
                text: '',
            });
        }

        forRequest(req).debug({ model: model || 'default', chars: queryText.length }, 'Transcribed voice query');

        // Step 2: Delegate to deep QueryExecutionEngine with source: 'voice'
        const outcome = await QueryExecutionEngine.executeNaturalLanguageQuery({
            connectionId,
            text: queryText,
            model,
            collections,
            workspaceId,
            source: 'voice',
            provider,
        });

        // Step 3: Attach voice transcription metadata for client compatibility
        const voiceData = {
            ...outcome.data,
            transcript: queryText,
            text: queryText,
            ...(transcription.language ? { language: transcription.language } : {}),
            ...(transcription.duration !== undefined ? { duration: transcription.duration } : {}),
            meta: {
                ...(outcome.data.meta || {}),
                transcriptionMeta: {
                    filename: originalname,
                    sizeBytes: size,
                    language: transcription.language,
                    duration: transcription.duration,
                },
            },
        };

        return sendOutcome(res, outcome, voiceData);
    } catch (error) {
        logPipelineError(forRequest(req), error, 'Voice pipeline error');
        if (error instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'upload_error',
                    message: error.code === 'LIMIT_FILE_SIZE' ? 'Audio file too large (max 25 MB)' : error.message,
                },
            });
        }
        return sendError(res, error, 'voice_pipeline_error', 'Failed to process voice query');
    }
});

module.exports = router;
