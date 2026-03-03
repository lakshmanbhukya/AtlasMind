const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getConnectionById } = require('../models/UserConnection');

const COOKIE_NAME = 'am_token';

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
            const isProd = process.env.NODE_ENV === 'production';
            res.clearCookie(COOKIE_NAME, { 
                httpOnly: true, 
                secure: isProd,
                sameSite: isProd ? 'none' : 'lax',
                path: '/' 
            });
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
        console.error('❌ [AUTH_ME_ERROR]', err);
        return res.status(500).json({ success: false, error: { message: 'Auth check failed' } });
    }
});

/**
 * POST /api/auth/logout
 *
 * Clears the `am_token` cookie, effectively logging the user out.
 * The frontend will redirect to the landing page after this call.
 */
router.post('/logout', (_req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(COOKIE_NAME, { 
        httpOnly: true, 
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/' 
    });
    return res.json({ success: true, message: 'Logged out' });
});

module.exports = router;
