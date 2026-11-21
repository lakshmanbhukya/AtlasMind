// @ts-check
const queryHistoryStore = require('../stores/queryHistoryStore');
const log = require('../utils/logger').logger.child({ module: 'cleanup' });

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cleanupTimer = null;

/**
 * Initializes indexes for efficient cleanup queries.
 */
async function initializeCleanupIndexes() {
    try {
        await queryHistoryStore.ensureIndexes();
        log.info({ collection: 'query_history' }, 'Initialized indexes');
    } catch (err) {
        log.warn({ err, collection: 'query_history' }, 'Failed to initialize indexes');
    }
}

/**
 * Auto-clean function that deletes playground chats / query history older than `retentionDays` for all users.
 *
 * @param {object} [options]
 * @param {number} [options.retentionDays=30] - Number of days to retain playground chat history
 * @returns {Promise<{ success: boolean, deletedCount: number, cutoffDate: Date, retentionDays: number, error?: string }>}
 */
async function cleanOldPlaygroundChats(options = {}) {
    const retentionDays = Number(options.retentionDays || process.env.PLAYGROUND_CHAT_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

    try {
        const deletedCount = await queryHistoryStore.purgeOlderThan(cutoffDate);

        if (deletedCount > 0) {
            log.info({ deletedCount, retentionDays, cutoff: cutoffDate.toISOString() }, 'Deleted old playground chats');
        } else {
            log.debug({ retentionDays }, 'No old playground chats to clean');
        }

        return {
            success: true,
            deletedCount,
            cutoffDate,
            retentionDays,
        };
    } catch (error) {
        log.error({ err: error }, 'Error cleaning old playground chats');
        return {
            success: false,
            error: error.message,
            deletedCount: 0,
            cutoffDate,
            retentionDays,
        };
    }
}

/**
 * Starts a recurring background cron job to automatically clean old playground chats.
 *
 * @param {object} [options]
 * @param {number} [options.intervalMs] - Interval in milliseconds between cleanups (default: 24h)
 * @param {number} [options.retentionDays] - Retention window in days (default: 30)
 * @param {boolean} [options.runImmediately=true] - Whether to trigger an immediate run on start
 * @returns {{ stop: Function, runNow: Function }}
 */
function startCleanupCron(options = {}) {
    const intervalMs = options.intervalMs || (Number(process.env.CLEANUP_INTERVAL_HOURS || 24) * 60 * 60 * 1000) || DEFAULT_INTERVAL_MS;
    const retentionDays = options.retentionDays || Number(process.env.PLAYGROUND_CHAT_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    const runImmediately = options.runImmediately !== false;

    // Clear existing timer if any
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }

    log.info({ intervalHours: Math.round(intervalMs / 3600000), retentionDays }, 'Started scheduled cleanup job');

    // Run initial cleanup after a short delay (e.g. 5 seconds after server boot) to let server initialize
    if (runImmediately) {
        setTimeout(() => {
            cleanOldPlaygroundChats({ retentionDays });
        }, 5000);
    }

    // Schedule recurring cleanup
    cleanupTimer = setInterval(() => {
        cleanOldPlaygroundChats({ retentionDays });
    }, intervalMs);

    // Unref timer so it doesn't prevent Node process from gracefully shutting down
    if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
    }

    return {
        stop: stopCleanupCron,
        runNow: () => cleanOldPlaygroundChats({ retentionDays }),
    };
}

/**
 * Stops the scheduled cleanup job.
 */
function stopCleanupCron() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
        log.info('Stopped scheduled cleanup job');
    }
}

module.exports = {
    startCleanupCron,
    initializeCleanupIndexes,
};
