import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    initialConversation,
    conversationReducer,
    responseToTurn,
    historyToTurns,
    errorTurn,
    blockedBodyFromError,
    questionOf,
    answerableClarificationId,
} from './conversation';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));

const NOW = Date.parse('2026-11-13T10:00:00.000Z');
const at = { id: 'a1', timestamp: new Date(NOW) };

/** An axios-shaped error. */
const httpError = (status, data) => ({ message: `Request failed with status code ${status}`, response: { status, data } });

const run = (actions, state = initialConversation) => actions.reduce(conversationReducer, state);

const ask = (text, n) => ({
    type: 'asked',
    source: 'text',
    userTurn: { id: `u${n}`, role: 'user', timestamp: new Date(NOW), content: text },
});
const answer = (body, n) => ({ type: 'answered', source: 'text', body, ids: { assistant: `a${n}` }, now: NOW });

describe('response → turn', () => {
    it('answer: kind and the fields AnswerTurn reads', () => {
        const turn = responseToTurn(fixture('answer'), at);
        expect(turn).toMatchObject({
            id: 'a1',
            role: 'assistant',
            kind: 'answer',
            content: 'Revenue summed per region, highest first.',
            naturalLanguage: 'Total revenue by region',
            collection: 'sample_sales',
            chartType: 'bar',
            safetyStatus: 'read-only',
        });
        expect(turn.results).toHaveLength(2);
        expect(turn.pipeline[0]).toHaveProperty('$group');
    });

    it('clarification: questions and the default content', () => {
        const turn = responseToTurn(fixture('clarification'), at);
        expect(turn.kind).toBe('clarification');
        expect(turn.questions[0].id).toBe('metric');
        expect(turn.content).toBe('Please clarify a few details before executing this query:');
        expect(turn.naturalLanguage).toBe('Show the top products');
    });

    it('scope-insufficient: suggested collections and current scope', () => {
        const turn = responseToTurn(fixture('scope-insufficient'), at);
        expect(turn).toMatchObject({ kind: 'scope', suggestedCollections: ['customers'], scope: ['sample_sales'] });
    });

    it('approval: token and write description', () => {
        const turn = responseToTurn(fixture('approval-required'), at);
        expect(turn).toMatchObject({ kind: 'approval', approvalToken: 'test-approval-token', collection: 'orders' });
        expect(turn.approval).toMatchObject({ writeStage: '$merge', targetCollection: 'orders_archive' });
    });

    it('approval-required without a token or description is not an approval card', () => {
        const body = { ...fixture('approval-required'), approvalToken: null, approval: null };
        expect(responseToTurn(body, at).kind).toBe('answer');
    });

    it('a no-pipeline fallback is an answer', () => {
        const turn = responseToTurn({ success: true, naturalLanguage: 'q', aiMessage: "I couldn't generate a query for that request.", pipeline: [], safetyStatus: 'read-only' }, at);
        expect(turn).toMatchObject({ kind: 'answer', content: "I couldn't generate a query for that request.", pipeline: [] });
    });

    it('scope falls back to meta.scope', () => {
        expect(responseToTurn({ meta: { scope: ['x'] } }, at).scope).toEqual(['x']);
    });
});

describe('failed request → turn', () => {
    it('a 422 safety_violation is a blocked turn with its block details', () => {
        const err = httpError(422, fixture('blocked-422'));
        expect(blockedBodyFromError(err)).not.toBeNull();
        const state = run([ask('Join users with system users', 1), { type: 'failed', error: err, source: 'text', question: 'Join users with system users', ids: { assistant: 'a1' }, now: NOW }]);
        const turn = state.turns[1];
        expect(turn).toMatchObject({
            kind: 'blocked',
            safetyStatus: 'blocked',
            errorCode: 'safety_violation',
            naturalLanguage: 'Join users with system users',
            collection: 'users',
        });
        expect(turn.safetyBlock).toMatchObject({ code: 'protected_collection', reference: 'system_users' });
        expect(state.pending).toBeNull();
    });

    it('a 422 with another code is an error, not a block', () => {
        expect(blockedBodyFromError(httpError(422, { success: false, error: { code: 'validation_error', message: 'x' } }))).toBeNull();
    });

    it('any other error is an error turn with retry options', () => {
        const err = httpError(500, fixture('error-500'));
        const turn = errorTurn(err, { ...at, question: 'q', retryOptions: { clarifications: [{ id: 'metric', value: 'amount' }] } });
        expect(turn).toMatchObject({
            kind: 'error',
            content: 'Failed to execute pipeline',
            naturalLanguage: 'q',
            retryOptions: { clarifications: [{ id: 'metric', value: 'amount' }], skipUserMessage: true },
        });
    });

    it('a network failure uses the transport message', () => {
        expect(errorTurn({ message: 'Network Error' }, at).content).toBe('Network Error');
        expect(errorTurn({}, at).content).toBe('Failed to process your query. Please try again.');
    });
});

describe('voice', () => {
    it('success: a voice user turn from the transcript, then the answer', () => {
        const state = run([
            { type: 'asked', source: 'voice' },
            { type: 'answered', source: 'voice', body: fixture('voice-answer'), ids: { user: 'u1', assistant: 'a1' }, now: NOW },
        ]);
        expect(state.turns).toHaveLength(2);
        expect(state.turns[0]).toMatchObject({ id: 'u1', role: 'user', content: 'Total revenue by region', isVoice: true });
        expect(state.turns[1]).toMatchObject({ id: 'a1', kind: 'answer' });
        expect(state.pending).toBeNull();
    });

    it('a 422 with a transcript: voice user turn, then the blocked turn', () => {
        const err = httpError(422, fixture('voice-blocked-422'));
        const state = run([
            { type: 'asked', source: 'voice' },
            { type: 'failed', error: err, source: 'voice', ids: { user: 'u1', assistant: 'a1' }, now: NOW },
        ]);
        expect(state.turns.map((t) => t.kind || t.role)).toEqual(['user', 'blocked']);
        expect(state.turns[0]).toMatchObject({ isVoice: true, content: 'Join users with system users' });
        expect(state.turns[1].naturalLanguage).toBe('Join users with system users');
    });

    it('an error turn has no question, so it shows no Retry', () => {
        const state = run([
            { type: 'asked', source: 'voice' },
            { type: 'failed', error: { message: 'timeout of 45000ms exceeded' }, source: 'voice', ids: { user: 'u1', assistant: 'a1' }, now: NOW },
        ]);
        expect(state.turns).toHaveLength(1);
        expect(state.turns[0]).toMatchObject({ kind: 'error', isVoice: true });
        expect(state.turns[0].naturalLanguage).toBeUndefined();
    });
});

describe('history replay', () => {
    const item = fixture('history').data[0];

    it('produces user-<id> and assistant-<id> turns, the answer read-only', () => {
        const [user, assistant] = historyToTurns(item, { now: NOW });
        expect(user).toMatchObject({ id: `user-${item.id}`, role: 'user', content: item.query, historyId: item.id });
        expect(assistant).toMatchObject({
            id: `assistant-${item.id}`,
            kind: 'answer',
            content: 'Revenue summed per region.',
            naturalLanguage: item.query,
            collection: 'sample_sales',
            chartType: 'bar',
            safetyStatus: 'read-only',
            scope: [],
        });
        expect(assistant.timestamp.toISOString()).toBe(item.timestamp);
    });

    it('without an explanation the content names the collection', () => {
        const [, assistant] = historyToTurns({ ...item, explanation: '' }, { now: NOW });
        expect(assistant.content).toBe('Generated query against collection "sample_sales".');
    });

    it('replayed replaces the thread; a missing item leaves it as it was', () => {
        const before = run([ask('q', 1), answer(fixture('answer'), 1)]);
        const replayed = run([{ type: 'replayStarted' }, { type: 'replayed', item, now: NOW }], before);
        expect(replayed.turns.map((t) => t.id)).toEqual([`user-${item.id}`, `assistant-${item.id}`]);
        expect(replayed.pending).toBeNull();
        const missing = run([{ type: 'replayStarted' }, { type: 'replayed', item: undefined, now: NOW }], before);
        expect(missing.turns).toBe(before.turns);
    });
});

describe('reducer', () => {
    it('ask → pending → answer', () => {
        const asked = run([ask('Total revenue by region', 1)]);
        expect(asked.pending).toBe('text');
        expect(asked.turns).toEqual([expect.objectContaining({ id: 'u1', role: 'user', content: 'Total revenue by region' })]);
        const answered = run([answer(fixture('answer'), 1)], asked);
        expect(answered.pending).toBeNull();
        expect(answered.turns.map((t) => t.id)).toEqual(['u1', 'a1']);
    });

    it('a re-ask without a user turn only sets pending', () => {
        const state = run([{ type: 'asked', source: 'text' }]);
        expect(state).toEqual({ turns: [], pending: 'text' });
    });

    describe('approval', () => {
        const staged = () => run([ask('Copy paid orders', 1), answer(fixture('approval-required'), 1)]);

        it('approve replaces the approval turn in place, keeping its id and approval details', () => {
            const before = staged();
            const after = run([{ type: 'approveStarted' }, { type: 'approved', turnId: 'a1', body: fixture('approve-success') }], before);
            const turn = after.turns[1];
            expect(after.turns).toHaveLength(2);
            expect(turn).toMatchObject({ id: 'a1', kind: 'answer', safetyStatus: 'write-executed', approvalToken: null });
            expect(turn.approval).toEqual(before.turns[1].approval);
            expect(turn.content).toMatch(/Transaction Authorized/);
            expect(after.pending).toBeNull();
        });

        it('approval failure sets approvalError and keeps the card', () => {
            const err = httpError(401, { success: false, error: { code: 'invalid_approval_token', message: 'Approval token expired' } });
            const after = run([{ type: 'approveStarted' }, { type: 'approveFailed', turnId: 'a1', error: err }], staged());
            expect(after.turns[1]).toMatchObject({ id: 'a1', kind: 'approval', approvalToken: 'test-approval-token', approvalError: 'Approval token expired' });
            expect(after.pending).toBeNull();
        });

        it('discard clears the token and keeps the card', () => {
            const after = run([{ type: 'discarded', turnId: 'a1' }], staged());
            expect(after.turns[1]).toMatchObject({ id: 'a1', kind: 'approval', approvalToken: null, approvalDiscarded: true });
        });

        it('in-place updates keep the last turn id (the scroll effect keys on it)', () => {
            const before = staged();
            const lastId = (s) => s.turns[s.turns.length - 1].id;
            expect(lastId(run([{ type: 'discarded', turnId: 'a1' }], before))).toBe(lastId(before));
            expect(lastId(run([{ type: 'approveFailed', turnId: 'a1', error: {} }], before))).toBe(lastId(before));
            expect(lastId(run([{ type: 'approved', turnId: 'a1', body: fixture('approve-success') }], before))).toBe(lastId(before));
        });
    });

    it('cleared empties the thread', () => {
        expect(run([ask('q', 1), { type: 'cleared' }])).toEqual(initialConversation);
    });
});

describe('selectors', () => {
    it('questionOf prefers the question over the content', () => {
        expect(questionOf({ naturalLanguage: 'q', content: 'c' })).toBe('q');
        expect(questionOf({ content: 'c' })).toBe('c');
    });

    it('only the newest clarification is answerable, and not once a later turn exists', () => {
        const first = run([ask('Show the top products', 1), answer(fixture('clarification'), 1)]);
        expect(answerableClarificationId(first.turns)).toBe('a1');

        const second = run([answer(fixture('clarification'), 2)], first);
        expect(answerableClarificationId(second.turns)).toBe('a2');

        const later = run([ask('something else', 3), answer(fixture('answer'), 3)], second);
        expect(answerableClarificationId(later.turns)).toBeNull();
        expect(answerableClarificationId([])).toBeNull();
    });
});
