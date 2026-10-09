const express = require('express');
const { profileSchema } = require('../services/schemaProfiler');
const { getSimilarExamples } = require('../services/fewShotRetriever');
const { getUserDb } = require('../services/userDbPool');

const router = express.Router();

/**
 * POST /api/scope/suggest
 *
 * Suggest relevant collections for a natural language question.
 * Returns collections with matching scores and match reasons.
 * Enabled when SCOPE_AUTO_SUGGEST=true or during test/development.
 */
router.post('/suggest', async (req, res) => {
    try {
        const isEnabled = process.env.SCOPE_AUTO_SUGGEST === 'true';
        const { question } = req.body;

        if (!isEnabled) {
            return res.json({
                success: true,
                enabled: false,
                suggestions: [],
            });
        }

        if (!question || typeof question !== 'string' || !question.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'question is required' },
            });
        }

        const connectionId = req.connectionId;
        const userDb = await getUserDb(connectionId);
        const [schema, examples] = await Promise.all([
            profileSchema(userDb, { connectionId }),
            getSimilarExamples(question, 5, connectionId).catch(() => []),
        ]);

        const qLower = question.toLowerCase();
        const words = qLower.split(/[^a-z0-9_]+/).filter((w) => w.length > 2);

        const scores = new Map(); // collectionName -> { score, reasons: Set }

        const initScore = (col) => {
            if (!scores.has(col)) {
                scores.set(col, { collection: col, score: 0, reasons: new Set() });
            }
            return scores.get(col);
        };

        // 1. Collection name matches (singular, plural, exact, substring)
        for (const col of schema.collections || []) {
            const cName = col.name.toLowerCase();
            const entry = initScore(col.name);

            if (qLower.includes(cName)) {
                entry.score += 50;
                entry.reasons.add(`Direct collection name mention ("${col.name}")`);
            } else {
                const singular = cName.replace(/s$/, '');
                if (singular.length > 3 && qLower.includes(singular)) {
                    entry.score += 35;
                    entry.reasons.add(`Collection singular match ("${singular}")`);
                }
            }

            // 2. Field name matches
            for (const field of col.fields || []) {
                const fName = field.name.toLowerCase();
                for (const word of words) {
                    if (fName === word || fName.includes(word)) {
                        entry.score += 15;
                        entry.reasons.add(`Field match ("${field.name}")`);
                        break;
                    }
                }
            }
        }

        // 3. Few-shot history match
        for (const ex of examples) {
            if (ex.collection && scores.has(ex.collection)) {
                const entry = initScore(ex.collection);
                entry.score += 25;
                entry.reasons.add('Used in similar previous queries');
            }
        }

        const suggestions = Array.from(scores.values())
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((s) => ({
                collection: s.collection,
                score: Math.min(s.score, 100),
                reasons: Array.from(s.reasons),
            }));

        return res.json({
            success: true,
            enabled: true,
            suggestions,
        });
    } catch (error) {
        console.error('❌ Scope suggestion error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'suggestion_error', message: error.message },
        });
    }
});

module.exports = router;
