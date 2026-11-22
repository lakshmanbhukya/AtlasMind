// @ts-check
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getConnectionById } = require('../models/UserConnection');
const { clearSession, readSessionClaims } = require('../auth/session');
const providerSettings = require('../services/providerSettings');
const { forRequest } = require('../utils/logger');

/**
 * GET /api/auth/me
 *
 * Validates the `am_token` cookie and returns connection metadata.
 * The frontend calls this on every app load to determine if the user is
 * already authenticated (has a valid session) without re-entering credentials.
 *
 * Returns:
 *   200 → { connectionId, dbName, label, lastConnectedAt }
 *   401 → session missing or expired
 */
router.get('/me', requireAuth, async (req, res) => {
    try {
        const conn = await getConnectionById(req.connectionId);

        if (!conn) {
            // Connection was deleted from DB but cookie still valid — clear it
            clearSession(res);
            return res.status(401).json({
                success: false,
                error: { code: 'connection_not_found', message: 'Session is invalid. Please reconnect.' },
            });
        }

        return res.json({
            success: true,
            connectionId: conn.connectionId,
            dbName: conn.dbName,
            label: conn.label || 'My Database',
            lastConnectedAt: conn.lastConnectedAt,
        });
    } catch (err) {
        forRequest(req).error({ err }, 'Auth check failed');
        return res.status(500).json({ success: false, error: { message: 'Auth check failed' } });
    }
});

/**
 * POST /api/auth/logout
 *
 * Clears the `am_token` cookie, effectively logging the user out. When the
 * cookie still verifies, this sign-in's personal Groq key is revoked first.
 * A missing or expired cookie still answers 200.
 * The frontend will redirect to the landing page after this call.
 */
router.post('/logout', async (req, res) => {
    let claims = null;
    try {
        claims = readSessionClaims(req);
    } catch {
        // No valid session: nothing to revoke.
    }
    if (claims) {
        try {
            await providerSettings.revokeSession(claims);
        } catch (err) {
            // The cookie is still cleared; the credential expires with the session.
            forRequest(req).error({ err }, 'Failed to revoke provider credential on logout');
        }
    }
    clearSession(res);
    return res.json({ success: true, message: 'Logged out' });
});

module.exports = router;
