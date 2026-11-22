import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    expectedPayerOf,
    formatTokens,
    formatAudioSeconds,
    formatClock,
    payerSummary,
    modelsFor,
    pickModel,
} from './providerSettings';
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from './models';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

describe('expectedPayerOf', () => {
    it('is the stored mode once settings have loaded', () => {
        expect(expectedPayerOf(fixture('provider-settings-managed'))).toBe('managed');
        expect(expectedPayerOf(fixture('provider-settings-personal'))).toBe('personal');
        expect(expectedPayerOf(null)).toBeUndefined();
        expect(expectedPayerOf({ mode: 'other' })).toBeUndefined();
    });
});

describe('formatting', () => {
    it('tokens and voice seconds', () => {
        expect(formatTokens(18400)).toBe('18K');
        expect(formatTokens(950)).toBe('950');
        expect(formatTokens(1_250_000)).toBe('1.3M');
        expect(formatTokens(0)).toBe('0');
        expect(formatTokens(null)).toBe('');
        expect(formatAudioSeconds(540)).toBe('9 min');
        expect(formatAudioSeconds(45)).toBe('45 s');
    });

    it('a reset time is a 24-hour local clock time', () => {
        expect(formatClock('2026-11-14T00:00:00.000Z', 'en-GB')).toMatch(/^\d{2}:\d{2}$/);
        expect(formatClock('not a date')).toBe('');
        expect(formatClock(null)).toBe('');
    });
});

describe('payerSummary', () => {
    it('managed: tokens and voice left, and the reset time', () => {
        const s = payerSummary(fixture('provider-settings-managed'), 'en-GB');
        expect(s).toMatchObject({ payer: 'managed', title: 'AtlasMind allowance', exhausted: false });
        expect(s.detail).toMatch(/^18K tokens \/ 9 min voice left, resets \d{2}:\d{2}$/);
    });

    it('managed with no tokens left is exhausted', () => {
        expect(payerSummary(fixture('provider-settings-exhausted')).exhausted).toBe(true);
    });

    it('managed when the ledger could not be read, or metering is off', () => {
        const base = fixture('provider-settings-managed');
        const unread = { ...base, managedAllowance: { ...base.managedAllowance, tokensRemaining: null, audioSecondsRemaining: null } };
        expect(payerSummary(unread).detail).toBe('Usage unavailable right now');
        const off = { ...base, managedAllowance: { ...unread.managedAllowance, mode: 'off' } };
        expect(payerSummary(off).detail).toBe('Shared AtlasMind key');
    });

    it('personal: the key suffix and until when it is active', () => {
        const s = payerSummary(fixture('provider-settings-personal'), 'en-US');
        expect(s).toMatchObject({ payer: 'personal', title: 'Your Groq key (…CRET)' });
        expect(s.detail).toMatch(/^Active until Nov \d{1,2}$/);
    });

    it('nothing before settings load', () => {
        expect(payerSummary(null)).toBeNull();
    });
});

describe('models', () => {
    it('only the allowed models, in the client order', () => {
        const managed = modelsFor(fixture('provider-settings-managed').allowedModels);
        expect(managed.map((m) => m.id)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
        expect(modelsFor(fixture('provider-settings-personal').allowedModels)).toEqual(AVAILABLE_MODELS);
    });

    it('every model before settings load; an unknown allowed id is shown by its id', () => {
        expect(modelsFor(undefined)).toBe(AVAILABLE_MODELS);
        expect(modelsFor(['acme/new-model'])).toEqual([{ id: 'acme/new-model', name: 'acme/new-model', vendor: '', speed: '' }]);
    });

    it('a picked model that is no longer allowed falls back to the default, then the first offered', () => {
        const managed = modelsFor(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
        expect(pickModel('openai/gpt-oss-20b', managed)).toBe('openai/gpt-oss-20b');
        expect(pickModel('groq/compound', managed)).toBe(DEFAULT_MODEL_ID);
        expect(pickModel('groq/compound', modelsFor(['openai/gpt-oss-20b']))).toBe('openai/gpt-oss-20b');
    });
});
