'use strict';

/**
 * Managed allowance: the day ledger (stores/allowanceStore.js) and the meter
 * (services/allowance.js) that reserves before and settles after each call.
 */

const { createFakeCollection } = require('../../test-support/fakeMongo');

let mockLedger;
jest.mock('../db/connection', () => ({ getDb: () => ({ collection: () => mockLedger }) }));

const store = require('../stores/allowanceStore');
const allowance = require('../services/allowance');
const { ProviderError } = require('../services/engineErrors');

const ENV_KEYS = [
    'GROQ_ALLOWANCE_MODE',
    'GROQ_GLOBAL_DAILY_TOKENS',
    'GROQ_CONNECTION_DAILY_TOKENS',
    'GROQ_GLOBAL_DAILY_AUDIO_SECONDS',
    'GROQ_CONNECTION_DAILY_AUDIO_SECONDS',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/** 300 chars and no output budget → an estimate of exactly 100 tokens. */
const TEXT_100 = { promptChars: 300, maxTokens: 0, model: 'openai/gpt-oss-120b' };

beforeEach(() => {
    mockLedger = createFakeCollection({ unique: [['_id']] });
    ENV_KEYS.forEach((k) => delete process.env[k]);
});

afterEach(() => {
    ENV_KEYS.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
});

const today = () => mockLedger.docs.find((d) => d._id === store.dayKey());

describe('estimates', () => {
    test('text is ceil(promptChars / 3) + max_tokens', () => {
        expect(allowance.estimateTokens(301, 2048)).toBe(101 + 2048);
    });

    test('only a 4xx from the provider counts as rejected', () => {
        expect(allowance.outcomeOf({ status: 401 })).toBe('rejected');
        expect(allowance.outcomeOf({ status: 429 })).toBe('rejected');
        expect(allowance.outcomeOf({ status: 503 })).toBe('unknown');
        expect(allowance.outcomeOf(new Error('timeout'))).toBe('unknown');
    });
});

describe('reserve (enforce)', () => {
    test('50 parallel reservations on one connection never exceed its cap', async () => {
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '1000';
        const meter = allowance.createMeter('conn-a');
        const results = await Promise.allSettled(Array.from({ length: 50 }, () => meter.reserveText(TEXT_100)));
        const ok = results.filter((r) => r.status === 'fulfilled');
        expect(ok).toHaveLength(10);
        expect(today().conn['conn-a'].tokens).toBe(1000);
        const refused = results.find((r) => r.status === 'rejected');
        expect(refused.reason).toBeInstanceOf(ProviderError);
        expect(refused.reason).toMatchObject({ code: 'managed_allowance_exhausted', statusCode: 429, payer: 'managed' });
        expect(refused.reason.resetAt).toBe(store.dayEnd(store.dayKey()).toISOString());
    });

    test('50 parallel reservations across connections never exceed the global cap', async () => {
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '1000';
        process.env.GROQ_GLOBAL_DAILY_TOKENS = '3000';
        const meters = Array.from({ length: 10 }, (_, i) => allowance.createMeter(`conn-${i}`));
        const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => meters[i % 10].reserveText(TEXT_100)));
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30);
        const doc = today();
        expect(doc.tokens).toBe(3000);
        Object.values(doc.conn).forEach((c) => expect(c.tokens).toBeLessThanOrEqual(1000));
    });

    test('a single estimate larger than the cap is refused for a connection with no usage yet', async () => {
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '50';
        await expect(allowance.createMeter('conn-fresh').reserveText(TEXT_100)).rejects.toMatchObject({ code: 'managed_allowance_exhausted' });
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '1000';
        process.env.GROQ_GLOBAL_DAILY_TOKENS = '50';
        await expect(allowance.createMeter('conn-fresh').reserveText(TEXT_100)).rejects.toMatchObject({ code: 'managed_allowance_exhausted' });
        expect(mockLedger.docs).toHaveLength(0);
    });

    test('audio reserves 60 s against its own caps', async () => {
        process.env.GROQ_CONNECTION_DAILY_AUDIO_SECONDS = '120';
        const meter = allowance.createMeter('conn-a');
        await meter.reserveAudio();
        await meter.reserveAudio();
        await expect(meter.reserveAudio()).rejects.toMatchObject({ code: 'managed_allowance_exhausted' });
        expect(today()).toMatchObject({ audioSeconds: 120, tokens: 0 });
    });

    test('ledger failure gives 503 managed_accounting_unavailable', async () => {
        mockLedger.updateOne = jest.fn().mockRejectedValue(new Error('not primary'));
        const err = await allowance.createMeter('conn-a').reserveText(TEXT_100).catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ code: 'managed_accounting_unavailable', statusCode: 503, payer: 'managed' });
        expect(err.message).not.toContain('not primary');
    });
});

describe('settle', () => {
    test('a finished call refunds the difference to the actual usage', async () => {
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        await meter.settle(ticket, { outcome: 'ok', actual: 40 });
        expect(today()).toMatchObject({ tokens: 40, conn: { 'conn-a': { tokens: 40 } } });
    });

    test('a timeout keeps the estimate', async () => {
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        await meter.settle(ticket, { outcome: 'unknown' });
        expect(today().tokens).toBe(100);
    });

    test('a call that succeeded without usage keeps the estimate', async () => {
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        await meter.settle(ticket, { outcome: 'ok', actual: undefined });
        expect(today().tokens).toBe(100);
    });

    test('a rejection releases the whole estimate', async () => {
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        await meter.settle(ticket, { outcome: 'rejected', actual: 999 });
        expect(today()).toMatchObject({ tokens: 0, conn: { 'conn-a': { tokens: 0 } } });
    });

    test('audio is charged by duration, with a 10 s floor', async () => {
        const meter = allowance.createMeter('conn-a');
        await meter.settle(await meter.reserveAudio(), { outcome: 'ok', actual: 3.2 });
        expect(today().audioSeconds).toBe(10);
        await meter.settle(await meter.reserveAudio(), { outcome: 'ok', actual: 21.4 });
        expect(today().audioSeconds).toBe(32);
    });

    test('never throws when the ledger fails', async () => {
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        mockLedger.updateOne = jest.fn().mockRejectedValue(new Error('down'));
        await expect(meter.settle(ticket, { outcome: 'ok', actual: 1 })).resolves.toBeUndefined();
    });

    test('UTC rollover: a new day gets a new document, and settle hits the original day', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'], now: new Date('2026-11-22T23:59:59.000Z') });
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        expect(ticket.day).toBe('2026-11-22');

        jest.setSystemTime(new Date('2026-11-23T00:00:01.000Z'));
        const next = await meter.reserveText(TEXT_100);
        expect(next.day).toBe('2026-11-23');
        await meter.settle(ticket, { outcome: 'ok', actual: 30 });

        const byDay = Object.fromEntries(mockLedger.docs.map((d) => [d._id, d.tokens]));
        expect(byDay).toEqual({ '2026-11-22': 30, '2026-11-23': 100 });
        expect(mockLedger.docs.find((d) => d._id === '2026-11-22').expiresAt.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });
});

describe('modes', () => {
    test('observe records usage but never rejects', async () => {
        process.env.GROQ_ALLOWANCE_MODE = 'observe';
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '150';
        const meter = allowance.createMeter('conn-a');
        await meter.reserveText(TEXT_100);
        await meter.reserveText(TEXT_100);
        await meter.reserveText(TEXT_100);
        expect(today().tokens).toBe(300);
    });

    test('observe tolerates a ledger outage', async () => {
        process.env.GROQ_ALLOWANCE_MODE = 'observe';
        mockLedger.updateOne = jest.fn().mockRejectedValue(new Error('down'));
        const meter = allowance.createMeter('conn-a');
        const ticket = await meter.reserveText(TEXT_100);
        expect(ticket.recorded).toBe(false);
        await expect(meter.settle(ticket, { outcome: 'ok', actual: 5 })).resolves.toBeUndefined();
        expect(mockLedger.updateOne).toHaveBeenCalledTimes(1);
    });

    test('off creates no meter', () => {
        process.env.GROQ_ALLOWANCE_MODE = 'off';
        expect(allowance.createMeter('conn-a')).toBeNull();
    });
});

describe('getRemaining', () => {
    test('the smaller of the global and connection remainders, per unit', async () => {
        process.env.GROQ_GLOBAL_DAILY_TOKENS = '1000';
        process.env.GROQ_CONNECTION_DAILY_TOKENS = '800';
        await allowance.createMeter('conn-a').reserveText(TEXT_100);
        await allowance.createMeter('conn-b').reserveText({ ...TEXT_100, promptChars: 1500 });

        const read = jest.spyOn(mockLedger, 'findOne');
        await expect(allowance.getRemaining('conn-a')).resolves.toEqual({
            tokensRemaining: 400, // global 1000 − 600 beats connection 800 − 100
            audioSecondsRemaining: 600,
            resetAt: store.dayEnd(store.dayKey()).toISOString(),
            mode: 'enforce',
        });
        expect(read).toHaveBeenCalledWith({ _id: store.dayKey() }, {
            projection: { _id: 0, tokens: 1, audioSeconds: 1, 'conn.conn-a': 1 },
        });
        await expect(allowance.getRemaining('conn-new')).resolves.toMatchObject({ tokensRemaining: 400 });
    });

    test('null values when the ledger cannot be read', async () => {
        mockLedger.findOne = jest.fn().mockRejectedValue(new Error('down'));
        await expect(allowance.getRemaining('conn-a')).resolves.toMatchObject({ tokensRemaining: null, audioSecondsRemaining: null, mode: 'enforce' });
    });
});

describe('store scope', () => {
    test.each(['conn.evil', '$where', 'a b', ''])('an unsafe connectionId %p throws and writes nothing', async (id) => {
        await expect(store.reserve({ day: store.dayKey(), connectionId: id, unit: 'tokens', amount: 1, limits: null })).rejects.toThrow();
        await expect(store.adjust({ day: store.dayKey(), connectionId: id, unit: 'tokens', delta: 1 })).rejects.toThrow();
        await expect(store.usage({ day: store.dayKey(), connectionId: id })).rejects.toThrow();
        expect(mockLedger.docs).toHaveLength(0);
    });

    test('an unknown unit throws', async () => {
        await expect(store.reserve({ day: store.dayKey(), connectionId: 'c', unit: /** @type {any} */ ('dollars'), amount: 1, limits: null })).rejects.toThrow(/unit/);
    });
});
