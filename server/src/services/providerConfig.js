// @ts-check
'use strict';

/**
 * Operator configuration for who pays for Groq calls. Read at call time so a
 * restart is the only thing needed to change it (and tests can set env).
 *
 * These are deployment settings, not research toggles: they never change how
 * a query is generated, only which key pays and how much the managed key may
 * spend.
 */

/** Models the client offers (client/src/lib/models.js). Personal keys may use any of them. */
const SUPPORTED_MODELS = Object.freeze([
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'groq/compound',
    'qwen/qwen3.8-27b',
    'qwen/qwen3.6-27b',
]);

const DEFAULT_MANAGED_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

const DEFAULTS = Object.freeze({
    GROQ_GLOBAL_DAILY_TOKENS: 160000,
    GROQ_CONNECTION_DAILY_TOKENS: 25000,
    GROQ_GLOBAL_DAILY_AUDIO_SECONDS: 3600,
    GROQ_CONNECTION_DAILY_AUDIO_SECONDS: 600,
});

/** @returns {string[]} the models managed (AtlasMind-paid) traffic may use, first is its default */
function managedModels() {
    const raw = process.env.MANAGED_MODELS;
    const list = (raw || '').split(',').map((m) => m.trim()).filter(Boolean);
    return list.length > 0 ? list : [...DEFAULT_MANAGED_MODELS];
}

/** @returns {'enforce'|'observe'|'off'} */
function allowanceMode() {
    const raw = (process.env.GROQ_ALLOWANCE_MODE || '').trim().toLowerCase();
    return raw === 'observe' || raw === 'off' ? raw : 'enforce';
}

/** @param {keyof typeof DEFAULTS} name */
function positiveInt(name) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULTS[name];
}

/** @returns {{ globalTokens: number, connectionTokens: number, globalAudioSeconds: number, connectionAudioSeconds: number }} */
function allowanceLimits() {
    return {
        globalTokens: positiveInt('GROQ_GLOBAL_DAILY_TOKENS'),
        connectionTokens: positiveInt('GROQ_CONNECTION_DAILY_TOKENS'),
        globalAudioSeconds: positiveInt('GROQ_GLOBAL_DAILY_AUDIO_SECONDS'),
        connectionAudioSeconds: positiveInt('GROQ_CONNECTION_DAILY_AUDIO_SECONDS'),
    };
}

module.exports = { SUPPORTED_MODELS, managedModels, allowanceMode, allowanceLimits };
