const express = require('express');
const { getSchema } = require('../services/tenantSchema');
const { getSimilarExamples } = require('../services/fewShotRetriever');
const { suggestCollections } = require('../services/scopeSuggestion');

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
        const [schema, examples] = await Promise.all([
            getSchema(connectionId),
            getSimilarExamples(question, 5, connectionId).catch(() => []),
        ]);

        const suggestions = suggestCollections(question, schema, examples);

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
