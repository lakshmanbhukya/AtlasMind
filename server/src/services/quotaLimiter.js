'use strict';

const fs = require('fs');
const path = require('path');

class QuotaExhaustedError extends Error {
    constructor(message, modelId) {
        super(message);
        this.name = 'QuotaExhaustedError';
        this.code = 'QUOTA_EXHAUSTED';
        this.modelId = modelId;
    }
}

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Per-model in-memory token buckets for RPM and TPM
const modelBuckets = new Map();

function getBucket(modelId) {
    if (!modelBuckets.has(modelId)) {
        modelBuckets.set(modelId, {
            rpmCount: 0,
            rpmWindowStart: Date.now(),
            tpmTokens: 0,
            tpmWindowStart: Date.now(),
        });
    }
    return modelBuckets.get(modelId);
}

function resolveModelsFilePath() {
    const candidatePaths = [
        path.resolve(process.cwd(), 'eval2/models.json'),
        path.resolve(__dirname, '../../../eval2/models.json'),
        path.resolve(__dirname, '../../eval2/models.json'),
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) return p;
    }
    return candidatePaths[0];
}

function resolveStateFilePath() {
    const candidateDirs = [
        path.resolve(process.cwd(), 'eval2/state'),
        path.resolve(__dirname, '../../../eval2/state'),
        path.resolve(__dirname, '../../eval2/state'),
    ];
    for (const d of candidateDirs) {
        if (fs.existsSync(d)) return path.join(d, 'usage.json');
    }
    return path.join(candidateDirs[0], 'usage.json');
}

function loadModelsConfig() {
    const filePath = resolveModelsFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.warn(`[quotaLimiter] Could not parse models.json:`, err.message);
        return null;
    }
}

function getModelLimits(modelId) {
    const config = loadModelsConfig();
    if (!config || !config[modelId]) return null;
    return config[modelId];
}

function loadUsageState() {
    const filePath = resolveStateFilePath();
    if (!fs.existsSync(filePath)) return {};
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveUsageState(state) {
    const filePath = resolveStateFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function getRollingTpdUsed(modelId) {
    const state = loadUsageState();
    const entry = state[modelId];
    if (!entry) return 0;
    const now = Date.now();
    // Prune entries older than rolling 24h
    if (entry.windowStart && (now - entry.windowStart > ROLLING_WINDOW_MS)) {
        return 0;
    }
    return entry.tokensUsed || 0;
}

function estimatePromptTokens(messages, maxTokens = 2048) {
    let totalChars = 0;
    if (Array.isArray(messages)) {
        for (const m of messages) {
            totalChars += (m.content || '').length;
        }
    }
    return Math.ceil(totalChars / 3.5) + maxTokens;
}

/**
 * Separate rate limit wait loop (not counted as retries).
 */
async function waitForWindowReset(windowStart, durationMs) {
    const now = Date.now();
    const remainingMs = durationMs - (now - windowStart) + 50; // buffer 50ms
    if (remainingMs > 0) {
        await new Promise((r) => setTimeout(r, remainingMs));
    }
}

/**
 * Consume quota before calling LLM.
 * Returns consumed tokens amount for potential refund on failure.
 */
async function consumeQuota(modelId, estimatedTokens, limits) {
    if (!limits) return 0;

    // Fail-fast if one request alone exceeds TPM
    if (limits.tpm && estimatedTokens > limits.tpm) {
        throw new Error(`Request estimated tokens (${estimatedTokens}) exceeds model TPM limit (${limits.tpm}) for "${modelId}"`);
    }

    const bucket = getBucket(modelId);
    let now = Date.now();

    // Reset minute windows if elapsed
    if (now - bucket.rpmWindowStart >= 60000) {
        bucket.rpmCount = 0;
        bucket.rpmWindowStart = now;
    }
    if (now - bucket.tpmWindowStart >= 60000) {
        bucket.tpmTokens = 0;
        bucket.tpmWindowStart = now;
    }

    // Separate RPM wait loop
    while (limits.rpm && bucket.rpmCount >= limits.rpm) {
        await waitForWindowReset(bucket.rpmWindowStart, 60000);
        now = Date.now();
        if (now - bucket.rpmWindowStart >= 60000) {
            bucket.rpmCount = 0;
            bucket.rpmWindowStart = now;
        }
    }

    // Separate TPM wait loop
    while (limits.tpm && (bucket.tpmTokens + estimatedTokens > limits.tpm)) {
        await waitForWindowReset(bucket.tpmWindowStart, 60000);
        now = Date.now();
        if (now - bucket.tpmWindowStart >= 60000) {
            bucket.tpmTokens = 0;
            bucket.tpmWindowStart = now;
        }
    }

    // Check rolling 24h TPD limit (at 95% threshold)
    if (limits.tpd) {
        const currentTpd = getRollingTpdUsed(modelId);
        if (currentTpd + estimatedTokens >= limits.tpd * 0.95) {
            const state = loadUsageState();
            const entry = state[modelId];
            const remainingMinutes = entry?.windowStart
                ? Math.ceil((ROLLING_WINDOW_MS - (Date.now() - entry.windowStart)) / 60000)
                : 1440;
            throw new QuotaExhaustedError(
                `TPD threshold 95% reached for model "${modelId}" (${currentTpd}/${limits.tpd} tokens). Resume in ~${remainingMinutes} minutes.`,
                modelId
            );
        }
    }

    bucket.rpmCount += 1;
    bucket.tpmTokens += estimatedTokens;

    return estimatedTokens;
}

function refundQuota(modelId, consumedTokens) {
    if (!consumedTokens) return;
    const bucket = getBucket(modelId);
    bucket.rpmCount = Math.max(0, bucket.rpmCount - 1);
    bucket.tpmTokens = Math.max(0, bucket.tpmTokens - consumedTokens);
}

function recordActualUsage(modelId, estimatedTokens, actualTokens, limits) {
    const bucket = getBucket(modelId);
    // Correct token bucket with actual token count
    bucket.tpmTokens = Math.max(0, bucket.tpmTokens - estimatedTokens + actualTokens);

    // Persist per-model rolling 24h usage in eval2/state/usage.json
    const state = loadUsageState();
    const now = Date.now();
    let entry = state[modelId];

    if (!entry || (now - entry.windowStart > ROLLING_WINDOW_MS)) {
        entry = { windowStart: now, tokensUsed: 0 };
    }
    entry.tokensUsed = (entry.tokensUsed || 0) + actualTokens;
    state[modelId] = entry;
    saveUsageState(state);

    if (limits?.tpd && entry.tokensUsed >= limits.tpd * 0.95) {
        const remainingMinutes = Math.ceil((ROLLING_WINDOW_MS - (now - entry.windowStart)) / 60000);
        throw new QuotaExhaustedError(
            `TPD reached 95% limit for model "${modelId}" (${entry.tokensUsed}/${limits.tpd} tokens). Resume in ~${remainingMinutes} minutes.`,
            modelId
        );
    }
}

// ── JSON-mode Support Cache ──────────────────────────────────────────────────
const jsonModeCache = new Map();

/**
 * Probe JSON-mode support once per model; cache.
 * Only marks unsupported on HTTP 400 that mentions response_format.
 */
async function probeJsonModeSupport(client, modelId) {
    if (jsonModeCache.has(modelId)) {
        return jsonModeCache.get(modelId);
    }

    try {
        await client.chat.completions.create({
            messages: [{ role: 'user', content: '{"ping":1}' }],
            model: modelId,
            max_tokens: 10,
            response_format: { type: 'json_object' },
        });
        jsonModeCache.set(modelId, true);
        return true;
    } catch (err) {
        const is400 = err.status === 400 || err.statusCode === 400;
        const msg = String(err.message || '');
        const mentionsResponseFormat = /response_format|json_object/i.test(msg);

        if (is400 && mentionsResponseFormat) {
            jsonModeCache.set(modelId, false);
            return false;
        }

        // 429, 5xx, network error: do not mark unsupported, re-throw or default to true
        throw err;
    }
}

module.exports = {
    QuotaExhaustedError,
    getModelLimits,
    estimatePromptTokens,
    consumeQuota,
    refundQuota,
    recordActualUsage,
    probeJsonModeSupport,
    jsonModeCache,
    getBucket,
    resolveModelsFilePath,
    resolveStateFilePath,
};
