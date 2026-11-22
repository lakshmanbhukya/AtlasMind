// @ts-check
const express = require('express');
const providerSettings = require('../services/providerSettings');
const { keyValidationLimiter } = require('../middleware/rateLimiter');
const { sendError } = require('./engineHttp');
const { forRequest } = require('../utils/logger');

const router = express.Router();

// requireAuth is applied in index.js: req.connectionId, req.sessionId and
// req.sessionExpiresAt are set here. The key is never returned or logged.

router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

/** @param {import('express').Request} req */
function scopeOf(req) {
    return {
        connectionId: /** @type {string} */ (req.connectionId),
        sessionId: req.sessionId,
        sessionExpiresAt: req.sessionExpiresAt,
    };
}

/**
 * Wrap a handler: success → `{ success: true, ...settings }`; errors map like
 * the engine's. The request body is never logged (it can hold the key).
 * @param {string} label
 * @param {(req: import('express').Request) => Promise<Record<string, any>>} fn
 */
function handle(label, fn) {
    return async (req, res) => {
        try {
            const settings = await fn(req);
            return res.json({ success: true, ...settings });
        } catch (error) {
            const status = error && typeof error.statusCode === 'number' ? error.statusCode : 500;
            if (status >= 500) forRequest(req).error({ err: error }, label);
            return sendError(res, error, 'provider_settings_error', 'Failed to update provider settings');
        }
    };
}

/** GET /api/provider-settings */
router.get('/', handle('Read provider settings failed', (req) => providerSettings.getSettings(scopeOf(req))));

/** PUT /api/provider-settings/key  body: { apiKey } */
router.put('/key', keyValidationLimiter, handle('Save provider key failed', (req) =>
    providerSettings.saveKey(scopeOf(req), req.body && req.body.apiKey)));

/** PATCH /api/provider-settings  body: { mode } */
router.patch('/', handle('Change provider mode failed', (req) =>
    providerSettings.setMode(scopeOf(req), req.body && req.body.mode)));

/** DELETE /api/provider-settings/key */
router.delete('/key', handle('Delete provider key failed', (req) => providerSettings.deleteKey(scopeOf(req))));

module.exports = router;
