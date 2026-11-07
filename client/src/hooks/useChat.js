import { useState, useCallback, useEffect } from 'react';
import { sendQuery, approveWriteQuery, fetchQueryHistory, apiErrorMessage } from '../services/api';
import { DEFAULT_MODEL_ID } from '../lib/models';

/**
 * Which turn card renders a message:
 * 'clarification' | 'scope' | 'approval' | 'blocked' | 'error' | 'answer'.
 */
function deriveKind(m) {
    if (m.isError) return 'error';
    if (m.needsClarification) return 'clarification';
    if (m.scopeInsufficient) return 'scope';
    if (m.safetyBlocked || m.safetyStatus === 'blocked') return 'blocked';
    if (m.safetyStatus === 'approval-required' && (m.approvalToken || m.approval)) return 'approval';
    return 'answer';
}

/**
 * A 422 `safety_violation` from /query or /voice carries the full blocked
 * outcome in its body; return it so it renders as a "Query blocked" turn.
 */
function blockedResponseFromError(err) {
    const body = err?.response?.data;
    if (err?.response?.status === 422 && body && body.error?.code === 'safety_violation') {
        return { ...body, safetyBlocked: true, safetyStatus: 'blocked' };
    }
    return null;
}

/**
 * Chat state management hook.
 * Maps backend response fields to the UI message structure. Every assistant
 * message carries a derived `kind` that picks its turn card.
 * Supports history replay, model switching, and HITL write approvals.
 */
export function useChat(selectedQueryId, onQuerySuccess) {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);

    const addMessage = useCallback((role, content, metadata = {}) => {
        const message = {
            id: Date.now() + Math.random(),
            role,
            content,
            timestamp: new Date(),
            ...metadata,
        };
        setMessages((prev) => [...prev, message]);
        return message;
    }, []);

    /**
     * Normalize a backend query response into the standard message metadata shape.
     */
    const normalizeResponse = useCallback((response) => {
        const isScopeInsufficient = Boolean(
            response.scopeInsufficient ||
            response.safetyStatus === 'scope-insufficient'
        );
        const needsClarification = Boolean(response.needsClarification);
        const isBlocked = Boolean(response.safetyBlocked || response.safetyStatus === 'blocked');

        let defaultContent = '';
        if (needsClarification) {
            defaultContent = 'Please clarify a few details before executing this query:';
        } else if (isScopeInsufficient) {
            defaultContent = response.aiMessage || response.explanation || 'This query requires collections outside your current scope.';
        }

        return {
            content: response.content || response.aiMessage || response.explanation || defaultContent || response.naturalLanguage || '',
            pipeline: response.pipeline || response.mql || [],
            collection: response.collection || '',
            chartType: response.chartType || 'table',
            results: response.results || response.result || [],
            safetyStatus: isBlocked ? 'blocked' : (response.safetyStatus || (isScopeInsufficient ? 'scope-insufficient' : 'read-only')),
            safetyBlocked: isBlocked,
            safetyBlock: response.safetyBlock || null,
            errorCode: response.error?.code || null,
            errorMessage: response.error?.message || null,
            approvalToken: response.approvalToken || null,
            approval: response.approval || null,
            explanation: response.explanation || '',
            executionTimeMs: response.executionTimeMs || response.meta?.executionTimeMs || null,
            confidenceScore: response.confidenceScore || response.meta?.confidenceScore || null,
            similarQueriesCount: response.similarQueriesCount || response.meta?.similarQueriesCount || null,
            transcript: response.transcript || response.text || null,
            naturalLanguage: response.naturalLanguage || '',
            schemaContext: response.schemaContext || '',
            // Scope & Ambiguity Fields
            needsClarification,
            questions: response.questions || [],
            scopeInsufficient: isScopeInsufficient,
            suggestedCollections: response.suggestedCollections || [],
            scope: response.scope || response.meta?.scope || [],
            scopeMode: response.scopeMode || null,
            clarifications: response.clarifications || [],
        };
    }, []);

    const toMessage = useCallback((response) => {
        const normalized = normalizeResponse(response);
        return { ...normalized, kind: deriveKind(normalized) };
    }, [normalizeResponse]);

    // Session-based conversational state reconstruction
    useEffect(() => {
        const restoreSelectedQuery = async () => {
            if (!selectedQueryId) {
                setMessages([]);
                return;
            }
            setIsLoading(true);
            try {
                const history = await fetchQueryHistory();
                const item = history.find((h) => h.id === selectedQueryId);
                if (item) {
                    const at = new Date(item.timestamp || Date.now());
                    setMessages([
                        {
                            id: `user-${item.id}`,
                            role: 'user',
                            content: item.query,
                            timestamp: at,
                            historyId: item.id,
                        },
                        {
                            id: `assistant-${item.id}`,
                            role: 'assistant',
                            kind: 'answer',
                            historyId: item.id,
                            timestamp: at,
                            content: item.explanation || `Generated query against collection "${item.collection}".`,
                            explanation: item.explanation || '',
                            pipeline: item.pipeline || [],
                            collection: item.collection || '',
                            chartType: item.chartType || 'table',
                            results: item.results || [],
                            safetyStatus: 'read-only',
                            safetyBlocked: false,
                            executionTimeMs: item.executionTimeMs ?? null,
                            confidenceScore: item.confidenceScore ?? null,
                            similarQueriesCount: item.similarQueriesCount || 0,
                            naturalLanguage: item.query,
                            schemaContext: item.schemaContext || '',
                            scope: item.scope || [],
                        },
                    ]);
                }
            } catch (err) {
                if (import.meta.env.DEV) console.warn('Failed to restore query history item:', err.message);
            } finally {
                setIsLoading(false);
            }
        };
        restoreSelectedQuery();
    }, [selectedQueryId]);

    const sendMessage = useCallback(
        async (text, options = {}) => {
            if (!text || (typeof text === 'string' && !text.trim()) || isLoading) return;

            const queryText = typeof text === 'string' ? text.trim() : (text.text || '');
            const mergedOptions = typeof text === 'object' && text !== null ? { ...text, ...options } : options;

            if (!mergedOptions.skipUserMessage && queryText) {
                addMessage('user', queryText);
            }
            setIsLoading(true);

            try {
                const queryPayload = {
                    text: queryText,
                    model: mergedOptions.model || selectedModel,
                    ...(mergedOptions.collections !== undefined ? { collections: mergedOptions.collections } : {}),
                    ...(mergedOptions.scopeMode !== undefined ? { scopeMode: mergedOptions.scopeMode } : {}),
                    ...(mergedOptions.bypassAmbiguity !== undefined ? { bypassAmbiguity: mergedOptions.bypassAmbiguity } : {}),
                    ...(mergedOptions.clarifications !== undefined ? { clarifications: mergedOptions.clarifications } : {}),
                    ...(mergedOptions.workspaceId !== undefined ? { workspaceId: mergedOptions.workspaceId } : {}),
                    ...(mergedOptions.dropMissing !== undefined ? { dropMissing: mergedOptions.dropMissing } : {}),
                    ...(mergedOptions.isEdit !== undefined ? { isEdit: mergedOptions.isEdit } : {}),
                };

                const response = await sendQuery(queryPayload);
                const message = toMessage(response);
                addMessage('assistant', message.content, message);
                if (onQuerySuccess) {
                    onQuerySuccess();
                }
                return message;
            } catch (err) {
                const blocked = blockedResponseFromError(err);
                if (blocked) {
                    const message = toMessage({ naturalLanguage: queryText, ...blocked });
                    addMessage('assistant', message.content, message);
                    return message;
                }
                const errorMessage = apiErrorMessage(err, 'Failed to process your query. Please try again.');
                addMessage('assistant', errorMessage, {
                    isError: true,
                    kind: 'error',
                    naturalLanguage: queryText,
                    retryOptions: { ...mergedOptions, skipUserMessage: true },
                });
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, addMessage, toMessage, selectedModel, onQuerySuccess]
    );

    // Human-in-the-Loop Write Approval Executor
    const approveWrite = useCallback(
        async (messageId, approvalToken) => {
            if (isLoading) return;

            setIsLoading(true);

            try {
                const response = await approveWriteQuery(approvalToken);
                const normalized = normalizeResponse(response);

                // Turn the staged write into an executed answer, in place.
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === messageId
                            ? {
                                  ...msg,
                                  ...normalized,
                                  content: normalized.content,
                                  kind: 'answer',
                                  safetyStatus: 'write-executed',
                                  safetyBlocked: false,
                                  approvalToken: null,
                                  approval: msg.approval,
                              }
                            : msg
                    )
                );
                if (onQuerySuccess) {
                    onQuerySuccess();
                }
            } catch (err) {
                const errorMessage = apiErrorMessage(err, 'Failed to authorize transaction.');
                // Keep the approval card and show why it failed.
                setMessages((prev) =>
                    prev.map((msg) => (msg.id === messageId ? { ...msg, approvalError: errorMessage } : msg))
                );
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, normalizeResponse, onQuerySuccess]
    );

    /** Drop a staged write without running it. */
    const discardApproval = useCallback((messageId) => {
        setMessages((prev) =>
            prev.map((msg) => (msg.id === messageId ? { ...msg, approvalToken: null, approvalDiscarded: true } : msg))
        );
    }, []);

    const addVoiceResult = useCallback(
        (response) => {
            const transcript = response.transcript || response.text || '';
            if (transcript) {
                addMessage('user', transcript, { isVoice: true });
            }

            const message = toMessage(response);
            addMessage('assistant', message.content, message);
            if (onQuerySuccess) {
                onQuerySuccess();
            }
        },
        [addMessage, toMessage, onQuerySuccess]
    );

    /** Voice failures: a 422 becomes a blocked turn (with its transcript), anything else an error turn. */
    const addVoiceError = useCallback(
        (err) => {
            const blocked = blockedResponseFromError(err);
            if (blocked) {
                if (blocked.transcript) addMessage('user', blocked.transcript, { isVoice: true });
                const message = toMessage({ naturalLanguage: blocked.transcript || '', ...blocked });
                addMessage('assistant', message.content, message);
                return;
            }
            const errorMessage = apiErrorMessage(err, 'Failed to process the voice query. Try speaking again.');
            addMessage('assistant', errorMessage, { isError: true, kind: 'error', isVoice: true });
        },
        [addMessage, toMessage]
    );

    return {
        messages,
        isLoading,
        selectedModel,
        setSelectedModel,
        sendMessage,
        approveWrite,
        discardApproval,
        addVoiceResult,
        addVoiceError,
    };
}
