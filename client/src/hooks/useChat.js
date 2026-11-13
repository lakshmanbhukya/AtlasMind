import { useState, useCallback, useEffect, useReducer, useRef } from 'react';
import { sendQuery, sendVoice, approveWriteQuery, fetchQueryHistory } from '../services/api';
import { DEFAULT_MODEL_ID } from '../lib/models';
import { conversationReducer, initialConversation, userTurn } from '../lib/conversation';

/**
 * Chat state: the Conversation module's reducer plus the requests that feed it.
 * Turn mapping and state transitions live in lib/conversation.js.
 *
 * `selectedQueryId` replays a history item; `onQuerySuccess` fires after a successful
 * text query, voice query and approved write (the history list refreshes on it).
 */
export function useChat(selectedQueryId, onQuerySuccess) {
    const [{ turns, pending }, dispatch] = useReducer(conversationReducer, initialConversation);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);

    const counter = useRef(0);
    const newId = useCallback(() => `t${Date.now()}-${(counter.current += 1)}`, []);

    // A history item was opened: replay it as one question and its answer.
    useEffect(() => {
        if (!selectedQueryId) {
            dispatch({ type: 'cleared' });
            return;
        }
        const replay = async () => {
            dispatch({ type: 'replayStarted' });
            try {
                const history = await fetchQueryHistory();
                dispatch({ type: 'replayed', item: history.find((h) => h.id === selectedQueryId), now: Date.now() });
            } catch (err) {
                if (import.meta.env.DEV) console.warn('Failed to restore query history item:', err.message);
                dispatch({ type: 'replayFailed' });
            }
        };
        replay();
    }, [selectedQueryId]);

    /**
     * Ask a question. Options: request scope (`collections`, `workspaceId`), `clarifications`,
     * `bypassAmbiguity`, `model`, and `skipUserMessage` for a re-ask of the same question.
     */
    const sendMessage = useCallback(
        async (text, options = {}) => {
            const question = typeof text === 'string' ? text.trim() : '';
            if (!question || pending) return;

            dispatch({
                type: 'asked',
                source: 'text',
                userTurn: options.skipUserMessage ? undefined : userTurn(question, { id: newId(), timestamp: new Date() }),
            });

            try {
                const body = await sendQuery({
                    text: question,
                    model: options.model || selectedModel,
                    ...(options.collections !== undefined ? { collections: options.collections } : {}),
                    ...(options.bypassAmbiguity !== undefined ? { bypassAmbiguity: options.bypassAmbiguity } : {}),
                    ...(options.clarifications !== undefined ? { clarifications: options.clarifications } : {}),
                    ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
                });
                dispatch({ type: 'answered', source: 'text', body, ids: { assistant: newId() }, now: Date.now() });
                onQuerySuccess?.();
            } catch (error) {
                dispatch({
                    type: 'failed',
                    source: 'text',
                    error,
                    question,
                    retryOptions: options,
                    ids: { assistant: newId() },
                    now: Date.now(),
                });
            }
        },
        [pending, newId, selectedModel, onQuerySuccess]
    );

    /** Transcribe a recording and run it, with the same request scope as a text question. */
    const sendVoiceMessage = useCallback(
        async (audioBlob, scopeOptions = {}) => {
            if (!audioBlob || pending) return;
            dispatch({ type: 'asked', source: 'voice' });
            const ids = { user: newId(), assistant: newId() };
            try {
                const body = await sendVoice(audioBlob, selectedModel, scopeOptions);
                dispatch({ type: 'answered', source: 'voice', body, ids, now: Date.now() });
                onQuerySuccess?.();
            } catch (error) {
                dispatch({ type: 'failed', source: 'voice', error, ids, now: Date.now() });
            }
        },
        [pending, newId, selectedModel, onQuerySuccess]
    );

    /** Human-in-the-loop: run a staged write with its approval token. */
    const approveWrite = useCallback(
        async (turnId, approvalToken) => {
            if (pending) return;
            dispatch({ type: 'approveStarted' });
            try {
                const body = await approveWriteQuery(approvalToken);
                dispatch({ type: 'approved', turnId, body });
                onQuerySuccess?.();
            } catch (error) {
                dispatch({ type: 'approveFailed', turnId, error });
            }
        },
        [pending, onQuerySuccess]
    );

    /** Drop a staged write without running it. */
    const discardApproval = useCallback((turnId) => dispatch({ type: 'discarded', turnId }), []);

    return {
        messages: turns,
        pending,
        selectedModel,
        setSelectedModel,
        sendMessage,
        sendVoiceMessage,
        approveWrite,
        discardApproval,
    };
}
