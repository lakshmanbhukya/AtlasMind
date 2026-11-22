import { apiErrorMessage } from './apiError';

/**
 * Conversation: server response (or failed request) in, chat turn out, plus the
 * state transitions of the thread. Pure: ids and timestamps arrive in actions.
 *
 * This is the only place that reads the server's response field names
 * (`aiMessage`, `pipeline`/`mql`, `results`/`result`, `safetyStatus`, `meta.*`).
 *
 * A turn is `{ id, role: 'user' | 'assistant', timestamp, content, ... }`. Assistant
 * turns carry `kind`, which picks the card that draws them:
 * 'answer' | 'clarification' | 'scope' | 'approval' | 'blocked' | 'error'.
 *
 * An error turn for a Groq provider failure (`managed_allowance_exhausted`,
 * `provider_key_invalid`, …) also carries `errorCode`, `payer`, a `title`, and what it
 * offers: `actions` ('enterKey' | 'updateKey' | 'useManaged'), `resetAt`, `retryAt`
 * (epoch ms before which Retry waits) and `retryLabel`.
 */

/** @typedef {'text' | 'voice'} Source */
/**
 * `pendingStage` is the server stage of the pending text question (stream progress).
 * It is only present while progress arrives: every transition that settles or starts a
 * request builds a new state without it.
 * @typedef {{ turns: object[], pending: null | Source, pendingStage?: string }} ConversationState
 */

export const initialConversation = Object.freeze({ turns: [], pending: null });

const ERROR_FALLBACK = {
    text: 'Failed to process your query. Please try again.',
    voice: 'Failed to process the voice query. Try speaking again.',
};
const APPROVAL_ERROR_FALLBACK = 'Failed to authorize transaction.';
const CLARIFY_DEFAULT = 'Please clarify a few details before executing this query:';
const SCOPE_DEFAULT = 'This query requires collections outside your current scope.';

// ─── Response → turn ─────────────────────────────────────────────────────────

const isScopeInsufficient = (body) => Boolean(body.scopeInsufficient || body.safetyStatus === 'scope-insufficient');
const isBlocked = (body) => Boolean(body.safetyBlocked || body.safetyStatus === 'blocked');

/** Which card draws a server body. */
export function kindOf(body) {
    if (body.needsClarification) return 'clarification';
    if (isScopeInsufficient(body)) return 'scope';
    if (isBlocked(body)) return 'blocked';
    if (body.safetyStatus === 'approval-required' && (body.approvalToken || body.approval)) return 'approval';
    return 'answer';
}

/** The fields the turn cards read, with defaults, from a server body. */
function turnFields(body) {
    const scopeInsufficient = isScopeInsufficient(body);
    const blocked = isBlocked(body);

    let fallback = '';
    if (body.needsClarification) fallback = CLARIFY_DEFAULT;
    else if (scopeInsufficient) fallback = body.aiMessage || body.explanation || SCOPE_DEFAULT;

    return {
        content: body.content || body.aiMessage || body.explanation || fallback || body.naturalLanguage || '',
        naturalLanguage: body.naturalLanguage || '',
        explanation: body.explanation || '',
        pipeline: body.pipeline || body.mql || [],
        collection: body.collection || '',
        chartType: body.chartType || 'table',
        results: body.results || body.result || [],
        safetyStatus: blocked ? 'blocked' : (body.safetyStatus || (scopeInsufficient ? 'scope-insufficient' : 'read-only')),
        safetyBlock: body.safetyBlock || null,
        errorCode: body.error?.code || null,
        errorMessage: body.error?.message || null,
        approvalToken: body.approvalToken || null,
        approval: body.approval || null,
        questions: body.questions || [],
        suggestedCollections: body.suggestedCollections || [],
        scope: body.scope || body.meta?.scope || [],
    };
}

/** An assistant turn from a server body. */
export function responseToTurn(body, { id, timestamp }) {
    return { id, role: 'assistant', timestamp, kind: kindOf(body), ...turnFields(body) };
}

/** A user turn. */
export function userTurn(content, { id, timestamp, isVoice = false }) {
    return { id, role: 'user', timestamp, content, ...(isVoice ? { isVoice: true } : {}) };
}

// ─── Failed request → turn ───────────────────────────────────────────────────

/**
 * A 422 `safety_violation` from /query or /voice carries the full blocked outcome
 * in its body: return that body so it draws as a "Query blocked" turn.
 */
export function blockedBodyFromError(err) {
    const body = err?.response?.data;
    if (err?.response?.status === 422 && body && body.error?.code === 'safety_violation') {
        return { ...body, safetyBlocked: true, safetyStatus: 'blocked' };
    }
    return null;
}

/**
 * An error turn. A text error keeps its question and retry options so it can be
 * retried; a voice error has no question, so it shows no Retry, except a voice
 * `settings_changed`, which gets `resendAudio` (useChat keeps that recording and
 * sends it again).
 */
export function errorTurn(err, { id, timestamp, source = 'text', question = '', retryOptions = {} }) {
    const base = {
        id,
        role: 'assistant',
        timestamp,
        kind: 'error',
        content: apiErrorMessage(err, ERROR_FALLBACK[source]),
        ...providerErrorFields(err, { now: timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp) || 0 }),
    };
    if (source === 'voice') {
        return { ...base, isVoice: true, ...(base.errorCode === 'settings_changed' ? { resendAudio: true } : {}) };
    }
    return { ...base, naturalLanguage: question, retryOptions: { ...retryOptions, skipUserMessage: true } };
}

// ─── Provider (Groq) failures ────────────────────────────────────────────────

/**
 * Error codes about who pays for Groq calls (server `ProviderError` and the provider
 * settings routes). Each gets a title and the actions its card offers; the message
 * is the server's own (these are written for users), with a fallback here.
 */
const PROVIDER_ERRORS = {
    managed_allowance_exhausted: {
        title: 'AtlasMind allowance used up',
        fallback: 'The AtlasMind allowance for today is used up. Use your own Groq key, or try again after the reset.',
    },
    provider_key_invalid: {
        title: 'Groq key rejected',
        fallback: 'Groq rejected the API key.',
    },
    provider_rate_limited: {
        title: 'Groq rate limit reached',
        fallback: 'The language model is rate limited. Please try again shortly.',
    },
    settings_changed: {
        title: 'Groq settings changed',
        fallback: 'Your Groq settings changed in another tab. Review them and send again.',
    },
    provider_model_unavailable: {
        title: 'Model unavailable',
        fallback: 'That model is not available right now. Pick another model.',
    },
    provider_unavailable: {
        title: 'Language model unavailable',
        fallback: 'The language model is unavailable right now. Please try again.',
    },
    managed_accounting_unavailable: {
        title: 'Allowance check unavailable',
        fallback: 'The AtlasMind allowance cannot be checked right now. Please try again, or use your own Groq key.',
    },
    reconnect_required: {
        title: 'Sign in again',
        fallback: 'Sign in to your database again to use your own Groq key.',
    },
    origin_not_allowed: {
        title: 'Request refused',
        fallback: 'This page is not allowed to call the AtlasMind server.',
    },
};

/** The server's error object (`{ code, message, payer?, retryAfterSeconds?, resetAt? }`) of a failed request. */
const errorBodyOf = (err) => {
    const e = err?.response?.data?.error;
    return e && typeof e === 'object' ? e : null;
};

/**
 * The extra fields of an error turn for a provider failure; `{}` for any other error.
 * `now` (epoch ms) turns `retryAfterSeconds` into `retryAt`.
 */
export function providerErrorFields(err, { now = 0 } = {}) {
    const e = errorBodyOf(err);
    const known = e && Object.hasOwn(PROVIDER_ERRORS, e.code) ? PROVIDER_ERRORS[e.code] : null;
    if (!known) return {};
    const fields = {
        errorCode: e.code,
        title: known.title,
        content: e.message || known.fallback,
        ...(e.payer === 'managed' || e.payer === 'personal' ? { payer: e.payer } : {}),
    };
    switch (e.code) {
        case 'managed_allowance_exhausted':
            fields.actions = ['enterKey'];
            if (typeof e.resetAt === 'string') fields.resetAt = e.resetAt;
            break;
        case 'provider_key_invalid':
            // Only the user's own key can be fixed here; a rejected managed key is the operator's.
            if (e.payer === 'personal') fields.actions = ['updateKey', 'useManaged'];
            break;
        case 'provider_rate_limited':
            if (typeof e.retryAfterSeconds === 'number' && e.retryAfterSeconds > 0) {
                fields.retryAt = now + e.retryAfterSeconds * 1000;
            }
            break;
        case 'settings_changed':
            // useChat refetches the settings after every response, so a resend uses the new payer.
            fields.retryLabel = 'Resend';
            break;
        default:
            break;
    }
    return fields;
}

// ─── History item → turns ────────────────────────────────────────────────────

/**
 * A history item replays as one question and its answer. The ids are
 * `user-<historyId>` and `assistant-<historyId>`: the thread finds
 * `msg-assistant-<historyId>` to highlight the replayed answer.
 */
export function historyToTurns(item, { now }) {
    const timestamp = new Date(item.timestamp || now);
    const answer = turnFields({
        naturalLanguage: item.query,
        aiMessage: item.explanation || `Generated query against collection "${item.collection}".`,
        explanation: item.explanation,
        pipeline: item.pipeline,
        collection: item.collection,
        chartType: item.chartType,
        results: item.results,
        scope: item.scope,
    });
    return [
        { ...userTurn(item.query, { id: `user-${item.id}`, timestamp }), historyId: item.id },
        { id: `assistant-${item.id}`, role: 'assistant', timestamp, kind: 'answer', historyId: item.id, ...answer },
    ];
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

/** Replace one turn by id, keeping its id (so in-place updates never look like a new turn). */
const updateTurn = (turns, id, update) => turns.map((t) => (t.id === id ? { ...t, ...update(t), id: t.id } : t));

/**
 * Conversation transitions.
 *
 * Actions (ids and `now` are supplied by the caller):
 * - `cleared`
 * - `replayStarted` / `replayed { item, now }` / `replayFailed`
 * - `asked { source, userTurn? }`
 * - `progressed { stage }`: a stream progress event for the pending question
 * - `answered { body, source, ids: { assistant, user? }, now }`
 * - `failed { error, source, question?, retryOptions?, ids: { assistant, user? }, now }`
 * - `approveStarted` / `approved { turnId, body }` / `approveFailed { turnId, error }`
 * - `discarded { turnId }`
 * - `actionsResolved { turnId }`: an error turn's provider action was carried out
 *
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
export function conversationReducer(state, action) {
    switch (action.type) {
        case 'cleared':
            return initialConversation;

        case 'replayStarted':
        case 'approveStarted':
            return { ...state, pending: 'text' };

        case 'replayed':
            // An item that no longer exists leaves the thread as it was.
            return {
                turns: action.item ? historyToTurns(action.item, { now: action.now }) : state.turns,
                pending: null,
            };

        case 'replayFailed':
            return { ...state, pending: null };

        case 'asked':
            return {
                turns: action.userTurn ? [...state.turns, action.userTurn] : state.turns,
                pending: action.source,
            };

        case 'progressed':
            // Late progress after the answer (or with nothing pending) is ignored.
            return state.pending ? { ...state, pendingStage: action.stage } : state;

        case 'answered': {
            const { body, source, ids, now } = action;
            const timestamp = new Date(now);
            const transcript = source === 'voice' ? body.transcript || body.text || '' : '';
            const added = [];
            if (transcript) added.push(userTurn(transcript, { id: ids.user, timestamp, isVoice: true }));
            added.push(responseToTurn(body, { id: ids.assistant, timestamp }));
            return { turns: [...state.turns, ...added], pending: null };
        }

        case 'failed': {
            const { error, source, question = '', retryOptions, ids, now } = action;
            const timestamp = new Date(now);
            const blocked = blockedBodyFromError(error);
            const added = [];
            if (blocked) {
                if (source === 'voice' && blocked.transcript) {
                    added.push(userTurn(blocked.transcript, { id: ids.user, timestamp, isVoice: true }));
                }
                const asked = source === 'voice' ? blocked.transcript || '' : question;
                added.push(responseToTurn({ naturalLanguage: asked, ...blocked }, { id: ids.assistant, timestamp }));
            } else {
                added.push(errorTurn(error, { id: ids.assistant, timestamp, source, question, retryOptions }));
            }
            return { turns: [...state.turns, ...added], pending: null };
        }

        case 'approved':
            // The staged write becomes an executed answer, in place; the approval details stay.
            return {
                turns: updateTurn(state.turns, action.turnId, (t) => ({
                    ...turnFields(action.body),
                    kind: 'answer',
                    safetyStatus: 'write-executed',
                    approvalToken: null,
                    approval: t.approval,
                })),
                pending: null,
            };

        case 'approveFailed':
            // The approval card stays and says why it failed.
            return {
                turns: updateTurn(state.turns, action.turnId, () => ({
                    approvalError: apiErrorMessage(action.error, APPROVAL_ERROR_FALLBACK),
                })),
                pending: null,
            };

        case 'discarded':
            return {
                ...state,
                turns: updateTurn(state.turns, action.turnId, () => ({ approvalToken: null, approvalDiscarded: true })),
            };

        case 'actionsResolved':
            return {
                ...state,
                turns: updateTurn(state.turns, action.turnId, (t) => (t.kind === 'error' ? { actionsResolved: true } : {})),
            };

        default:
            return state;
    }
}

// ─── Selectors ───────────────────────────────────────────────────────────────

const STAGE_LABELS = {
    scope: 'Checking collections…',
    schema: 'Reading your schema…',
    ambiguity: 'Checking the question…',
    generating: 'Generating pipeline…',
    safety: 'Running safety checks…',
    executing: 'Running the query…',
};

/** The pending indicator's label: the current stream stage, or the default for the source. */
export function pendingLabel({ pending, pendingStage }) {
    if (pending === 'voice') return 'Transcribing and generating pipeline…';
    return STAGE_LABELS[pendingStage] || 'Generating pipeline…';
}

/** The question a turn answers, for re-asking it. */
export const questionOf = (turn) => turn.naturalLanguage || turn.content;

/** Only the newest turn, if it is a clarification, can still be answered. */
export function answerableClarificationId(turns) {
    const last = turns[turns.length - 1];
    return last?.kind === 'clarification' ? last.id : null;
}
