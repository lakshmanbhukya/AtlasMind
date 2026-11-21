// @ts-check
const express = require('express');
const dashboardStore = require('../stores/dashboardStore');
const { forRequest } = require('../utils/logger');

const router = express.Router();

function notFound(res) {
    return res.status(404).json({
        success: false,
        error: { code: 'not_found', message: 'Shared dashboard widget not found' },
    });
}

/**
 * GET /api/dashboard/shared/:token
 *
 * Public endpoint (no auth) for a shared dashboard widget. Only pins shared
 * explicitly (POST /api/dashboard/:id/share) are reachable, by their secret
 * token. A malformed token is a plain 404, so the route does not reveal which
 * tokens are well-formed. The store projects display fields only.
 */
router.get('/:token', async (req, res) => {
    try {
        if (!dashboardStore.SHARE_TOKEN_PATTERN.test(req.params.token)) return notFound(res);

        const pin = await dashboardStore.getShared(req.params.token);
        if (!pin) return notFound(res);

        return res.json({ success: true, data: pin });
    } catch (error) {
        forRequest(req).error({ err: error }, 'Shared dashboard fetch error');
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: 'Failed to load shared dashboard widget' },
        });
    }
});

module.exports = router;
