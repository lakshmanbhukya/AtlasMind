import { useCallback, useMemo, useReducer, useRef } from 'react';
import { streamQuery, sendVoice, approveWriteQuery } from '../services/api';
import { modelsFor, pickModel } from '../lib/providerSettings';
import { conversationReducer, initialConversation, historyToTurns, userTurn } from '../lib/conversation';
import { useProviderSettings } from './useProviderSettings';

/**
 * Chat state: the Conversation module's reducer plus the requests that feed it.
 * Turn mapping and state transitions live in lib/conversation.js.
 *
 * Text questions stream stage progress (`pendingStage`); voice uses the plain request.
 *
 * `selectedHistoryItem` replays a history item; `onQuerySuccess` fires after a successful
 * text query, voice query and approved write (the history list refreshes on it).
 *
 * Who pays comes from the provider settings of `connectionId`: each question sends the
 * payer the user sees as `expectedPayer`, the model list is limited to `allowedModels`,
 * and the settings are refetched after every query or voice response (success or not),
 * so the allowance counter moves and a `settings_changed` reply picks up the new mode.
 */
export function useChat(selectedHistoryItem, onQuerySuccess, connectionId, chosenModel) {
    const [{ turns, pending, pendingStage }, dispatch] = useReducer(
        conversationReducer, selectedHistoryItem,
        (item) => item ? { turns: historyToTurns(item, { now: Date.now() }), pending: null } : initialConversation
    );
    const provider = useProviderSettings(connectionId);
    const { expectedPayer, refresh: refreshProvider } = provider;
    const allowedModels = provider.settings?.allowedModels;
    const models = useMemo(() => modelsFor(allowedModels), [allowedModels]);
    const selectedModel = pickModel(chosenModel, models);

    const counter = useRef(0);
    // The last failed recording, for Resend after a voice `settings_changed`. Kept out of
    // reducer state (a Blob is not chat data) and gone after a reload.
    const failedRecording = useRef(null);
    const newId = useCallback(() => `t${Date.now()}-${(counter.current += 1)}`, []);

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
                const body = await streamQuery(
                    {
                        text: question,
                        model: options.model || selectedModel,
                        ...(options.collections !== undefined ? { collections: options.collections } : {}),
                        ...(options.bypassAmbiguity !== undefined ? { bypassAmbiguity: options.bypassAmbiguity } : {}),
                        ...(options.clarifications !== undefined ? { clarifications: options.clarifications } : {}),
                        ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
                        ...(expectedPayer ? { expectedPayer } : {}),
                    },
                    (stage) => dispatch({ type: 'progressed', stage })
                );
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
            } finally {
                refreshProvider();
            }
        },
        [pending, newId, selectedModel, expectedPayer, refreshProvider, onQuerySuccess]
    );

    /** Transcribe a recording and run it, with the same request scope as a text question. */
    const sendVoiceMessage = useCallback(
        async (audioBlob, scopeOptions = {}) => {
            if (!audioBlob || pending) return;
            dispatch({ type: 'asked', source: 'voice' });
            const ids = { user: newId(), assistant: newId() };
            try {
                const body = await sendVoice(audioBlob, selectedModel, { ...scopeOptions, ...(expectedPayer ? { expectedPayer } : {}) });
                failedRecording.current = null;
                dispatch({ type: 'answered', source: 'voice', body, ids, now: Date.now() });
                onQuerySuccess?.();
            } catch (error) {
                failedRecording.current = { turnId: ids.assistant, blob: audioBlob, scopeOptions };
                dispatch({ type: 'failed', source: 'voice', error, ids, now: Date.now() });
            } finally {
                refreshProvider();
            }
        },
        [pending, newId, selectedModel, expectedPayer, refreshProvider, onQuerySuccess]
    );

    /** Whether the recording behind error turn `turnId` can still be sent again. */
    const canResendVoice = useCallback((turnId) => failedRecording.current?.turnId === turnId, []);

    /** Send the recording behind error turn `turnId` again (Resend after `settings_changed`). */
    const resendVoice = useCallback(
        (turnId) => {
            const rec = failedRecording.current;
            if (!rec || rec.turnId !== turnId) return undefined;
            return sendVoiceMessage(rec.blob, rec.scopeOptions);
        },
        [sendVoiceMessage]
    );

    /** An error turn's provider action (switch payer, save a key) was carried out: hide its actions. */
    const resolveTurnActions = useCallback((turnId) => dispatch({ type: 'actionsResolved', turnId }), []);

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
        pendingStage,
        selectedModel,
        models,
        provider,
        sendMessage,
        sendVoiceMessage,
        canResendVoice,
        resendVoice,
        resolveTurnActions,
        approveWrite,
        discardApproval,
    };
}
