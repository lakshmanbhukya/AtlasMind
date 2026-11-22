// @ts-check
'use strict';

const store = require('../stores/allowanceStore');
const { allowanceMode, allowanceLimits } = require('./providerConfig');
const { ProviderError } = require('./engineErrors');
const log = require('../utils/logger').logger.child({ module: 'allowance' });

/**
 * Managed allowance: how much of the AtlasMind-paid Groq key each connection
 * and the whole installation may spend per UTC day.
 *
 * A meter reserves an estimate before every SDK attempt (retries and model
 * fallbacks included) and settles the difference once the attempt ends, on
 * the day it was reserved. Personal-key traffic never gets a meter.
 *
 * Modes (GROQ_ALLOWANCE_MODE): `enforce` rejects over-limit calls, `observe`
 * records usage but never rejects, `off` creates no meter at all.
 */

/** Whisper's billing floor, in seconds. */
const AUDIO_MIN_SECONDS = 10;
/** The client stops recording at 60 s, so that is the audio reservation. */
const AUDIO_ESTIMATE_SECONDS = 60;

/**
 * @typedef {object} Ticket
 * @property {string} day - the UTC day the reservation was charged to
 * @property {'tokens'|'audioSeconds'} unit
 * @property {number} estimate
 * @property {string|undefined} model
 * @property {boolean} recorded - false when observe mode could not record it
 */

/**
 * @typedef {'ok'|'rejected'|'unknown'} Outcome
 *   ok: the call returned; rejected: the provider refused it before generating
 *   (any 4xx); unknown: timeout, 5xx or network error, so the estimate stays.
 */

/**
 * @typedef {object} Meter
 * @property {(input: { promptChars: number, maxTokens: number, model?: string }) => Promise<Ticket>} reserveText
 * @property {(input?: { model?: string }) => Promise<Ticket>} reserveAudio
 * @property {(ticket: Ticket, result: { outcome: Outcome, actual?: number }) => Promise<void>} settle
 */

/** @param {string} day */
function resetAtFor(day) {
    return store.dayEnd(day).toISOString();
}

/** @param {number} promptChars @param {number} maxTokens */
function estimateTokens(promptChars, maxTokens) {
    return Math.ceil(Math.max(0, promptChars) / 3) + Math.max(0, maxTokens);
}

/**
 * The SDK outcome of one attempt, for settle.
 * @param {any} err
 * @returns {Outcome}
 */
function outcomeOf(err) {
    const status = err && typeof err.status === 'number' ? err.status : null;
    return status !== null && status >= 400 && status < 500 ? 'rejected' : 'unknown';
}

/**
 * A meter for one connection's managed calls, or null when accounting is off.
 * @param {string} connectionId
 * @returns {Meter|null}
 */
function createMeter(connectionId) {
    const mode = allowanceMode();
    if (mode === 'off') return null;

    /**
     * @param {'tokens'|'audioSeconds'} unit
     * @param {number} estimate
     * @param {string|undefined} model
     * @returns {Promise<Ticket>}
     */
    async function reserve(unit, estimate, model) {
        const day = store.dayKey();
        const all = allowanceLimits();
        const limits = mode === 'enforce'
            ? (unit === 'tokens'
                ? { global: all.globalTokens, connection: all.connectionTokens }
                : { global: all.globalAudioSeconds, connection: all.connectionAudioSeconds })
            : null;

        let ok;
        try {
            ok = await store.reserve({ day, connectionId, unit, amount: estimate, limits });
        } catch (err) {
            if (mode === 'observe') {
                log.warn({ err, unit }, 'Could not record managed usage (observe mode)');
                return { day, unit, estimate, model, recorded: false };
            }
            log.error({ err, unit }, 'Managed allowance ledger unavailable');
            throw new ProviderError('managed_accounting_unavailable',
                'The AtlasMind allowance cannot be checked right now. Please try again, or use your own Groq key.',
                503, { payer: 'managed' });
        }
        if (!ok) {
            throw new ProviderError('managed_allowance_exhausted',
                unit === 'tokens'
                    ? 'The AtlasMind allowance for today is used up. Use your own Groq key, or try again after the reset.'
                    : 'The AtlasMind voice allowance for today is used up. Use your own Groq key, or try again after the reset.',
                429, { payer: 'managed', resetAt: resetAtFor(day) });
        }
        return { day, unit, estimate, model, recorded: true };
    }

    return {
        reserveText({ promptChars, maxTokens, model }) {
            return reserve('tokens', estimateTokens(promptChars, maxTokens), model);
        },
        reserveAudio({ model } = {}) {
            return reserve('audioSeconds', AUDIO_ESTIMATE_SECONDS, model);
        },
        async settle(ticket, { outcome, actual }) {
            let charged = ticket.estimate;
            if (outcome === 'rejected') {
                charged = 0;
            } else if (outcome === 'ok' && typeof actual === 'number' && Number.isFinite(actual)) {
                charged = ticket.unit === 'audioSeconds'
                    ? Math.max(AUDIO_MIN_SECONDS, Math.ceil(actual))
                    : Math.max(0, Math.ceil(actual));
            }
            log.info({ payer: 'managed', unit: ticket.unit, estimate: ticket.estimate, actual: charged, model: ticket.model }, 'Managed Groq usage');
            if (!ticket.recorded) return;
            try {
                await store.adjust({ day: ticket.day, connectionId, unit: ticket.unit, delta: charged - ticket.estimate });
            } catch (err) {
                // The estimate stays charged: safe, just conservative.
                log.warn({ err, unit: ticket.unit }, 'Could not settle managed usage');
            }
        },
    };
}

/**
 * What is left today for a connection: the smaller of the global and the
 * connection remainder, per unit. Values are null when the ledger can't be
 * read, or when accounting is off.
 * @param {string} connectionId
 * @returns {Promise<{ tokensRemaining: number|null, audioSecondsRemaining: number|null, resetAt: string, mode: 'enforce'|'observe'|'off' }>}
 */
async function getRemaining(connectionId) {
    const mode = allowanceMode();
    const day = store.dayKey();
    const resetAt = resetAtFor(day);
    if (mode === 'off') return { tokensRemaining: null, audioSecondsRemaining: null, resetAt, mode };
    const limits = allowanceLimits();
    try {
        const used = await store.usage({ day, connectionId });
        return {
            tokensRemaining: Math.max(0, Math.min(limits.globalTokens - used.tokens, limits.connectionTokens - used.connTokens)),
            audioSecondsRemaining: Math.max(0, Math.min(
                limits.globalAudioSeconds - used.audioSeconds,
                limits.connectionAudioSeconds - used.connAudioSeconds)),
            resetAt,
            mode,
        };
    } catch (err) {
        log.warn({ err }, 'Could not read the managed allowance');
        return { tokensRemaining: null, audioSecondsRemaining: null, resetAt, mode };
    }
}

module.exports = { createMeter, getRemaining, outcomeOf, estimateTokens, AUDIO_ESTIMATE_SECONDS, AUDIO_MIN_SECONDS };
