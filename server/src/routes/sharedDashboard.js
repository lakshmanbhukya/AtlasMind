const express = require('express');
const { ObjectId } = require('mongodb');
const dashboardStore = require('../stores/dashboardStore');

const router = express.Router();

/**
 * GET /api/dashboard/shared/:id
 *
 * Public endpoint (no auth) for a shared dashboard widget. The store projects
 * display fields only, so connectionId and other internals never leave.
 */
router.get('/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Invalid pin ID' },
            });
        }

        const pin = await dashboardStore.getShared(req.params.id);
        if (!pin) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Shared dashboard widget not found' },
            });
        }

        return res.json({ success: true, data: pin });
    } catch (error) {
        console.error('❌ Shared dashboard fetch error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'dashboard_error', message: error.message },
        });
    }
});

module.exports = router;
