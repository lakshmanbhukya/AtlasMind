const express = require('express');
const Workspace = require('../models/Workspace');
const { getUserCollections } = require('../services/tenantSchema');
const { requireKnownCollections } = require('../services/effectiveScope');
const { QueryEngineError } = require('../services/engineErrors');

const router = express.Router();

/**
 * Check workspace collections against the tenant's real collections.
 * Returns the sent 400 response on failure, or null when every name is known.
 */
async function validateWorkspaceCollections(res, connectionId, collections) {
    try {
        await requireKnownCollections(connectionId, collections);
        return null;
    } catch (error) {
        if (!(error instanceof QueryEngineError)) throw error;
        return res.status(error.statusCode).json({
            success: false,
            error: { code: error.code, message: error.message },
        });
    }
}

/** Available user collections for this tenant, as a Set. */
async function getUserCollectionSet(connectionId) {
    return new Set(await getUserCollections(connectionId));
}

/**
 * GET /api/workspaces
 *
 * List all saved workspaces for the active connection.
 * Flags collections that no longer exist in the user's DB.
 */
router.get('/', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const [workspaces, availableSet] = await Promise.all([
            Workspace.listWorkspaces(connectionId),
            getUserCollectionSet(connectionId).catch(() => new Set()),
        ]);

        const data = workspaces.map((w) => {
            const missing = (w.collections || []).filter((c) => !availableSet.has(c));
            const available = (w.collections || []).filter((c) => availableSet.has(c));
            return {
                id: w._id.toString(),
                name: w.name,
                collections: w.collections || [],
                availableCollections: available,
                missingCollections: missing,
                hasMissingCollections: missing.length > 0,
                createdAt: w.createdAt,
                updatedAt: w.updatedAt,
            };
        });

        return res.json({
            success: true,
            data,
            meta: { count: data.length },
        });
    } catch (error) {
        console.error('❌ List workspaces error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'workspaces_error', message: error.message },
        });
    }
});

/**
 * POST /api/workspaces
 *
 * Create a new saved workspace.
 * Validates collections exist in user DB.
 */
router.post('/', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const { name, collections } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Workspace name is required' },
            });
        }

        const trimmedName = name.trim();
        if (trimmedName.length > 60) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Workspace name must be under 60 characters' },
            });
        }

        if (!Array.isArray(collections) || collections.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'validation_error', message: 'Workspace must include at least one collection' },
            });
        }

        const scopeError = await validateWorkspaceCollections(res, connectionId, collections);
        if (scopeError) return scopeError;

        const workspace = await Workspace.createWorkspace({
            connectionId,
            name: trimmedName,
            collections,
        });

        return res.status(201).json({
            success: true,
            data: {
                id: workspace._id.toString(),
                name: workspace.name,
                collections: workspace.collections,
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt,
            },
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'duplicate_workspace_name',
                    message: 'A workspace with this name already exists',
                },
            });
        }
        console.error('❌ Create workspace error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'workspace_create_error', message: error.message },
        });
    }
});

/**
 * PATCH /api/workspaces/:id
 *
 * Update an existing workspace.
 */
router.patch('/:id', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const { id } = req.params;
        const { name, collections } = req.body;

        const existing = await Workspace.getWorkspaceById(id, connectionId);
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Workspace not found' },
            });
        }

        const updates = {};
        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'validation_error', message: 'Workspace name must be non-empty' },
                });
            }
            if (name.trim().length > 60) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'validation_error', message: 'Workspace name must be under 60 characters' },
                });
            }
            updates.name = name.trim();
        }

        if (collections !== undefined) {
            if (!Array.isArray(collections) || collections.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'validation_error', message: 'Collections must be a non-empty array' },
                });
            }

            const scopeError = await validateWorkspaceCollections(res, connectionId, collections);
            if (scopeError) return scopeError;
            updates.collections = collections;
        }

        const updated = await Workspace.updateWorkspace(id, connectionId, updates);
        if (!updated) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Workspace not found' },
            });
        }
        return res.json({
            success: true,
            data: {
                id: updated._id.toString(),
                name: updated.name,
                collections: updated.collections,
                updatedAt: updated.updatedAt,
            },
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                error: {
                    code: 'duplicate_workspace_name',
                    message: 'A workspace with this name already exists',
                },
            });
        }
        console.error('❌ Update workspace error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'workspace_update_error', message: error.message },
        });
    }
});

/**
 * DELETE /api/workspaces/:id
 *
 * Delete a workspace.
 */
router.delete('/:id', async (req, res) => {
    try {
        const connectionId = req.connectionId;
        const { id } = req.params;

        const deleted = await Workspace.deleteWorkspace(id, connectionId);
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: { code: 'not_found', message: 'Workspace not found' },
            });
        }

        return res.json({
            success: true,
            message: 'Workspace deleted successfully',
        });
    } catch (error) {
        console.error('❌ Delete workspace error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'workspace_delete_error', message: error.message },
        });
    }
});

module.exports = router;
