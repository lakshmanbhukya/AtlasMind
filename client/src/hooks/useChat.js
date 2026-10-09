import { useState, useCallback, useRef, useEffect } from 'react';
import { sendQuery, approveWriteQuery, fetchQueryHistory } from '../services/api';

/**
 * Chat state management hook.
 * Maps backend response fields to the UI message structure.
 * Supports deep state persistence, model switching, and HITL approvals.
 */
export function useChat(selectedQueryId, onQuerySuccess) {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedModel, setSelectedModel] = useState('openai/gpt-oss-120b');
    const messagesEndRef = useRef(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
     * Preserves needsClarification, questions, and scopeInsufficient for UI cards.
     */
    const normalizeResponse = useCallback((response) => {
        const isScopeInsufficient = Boolean(
            response.scopeInsufficient ||
            response.safetyStatus === 'scope-insufficient'
        );
        const needsClarification = Boolean(response.needsClarification);

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
            safetyStatus: response.safetyStatus || (response.safetyBlocked ? 'approval-required' : isScopeInsufficient ? 'scope-insufficient' : 'read-only'),
            safetyBlocked: response.safetyBlocked || response.safetyStatus === 'approval-required' || false,
            approvalToken: response.approvalToken || null,
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
                    setMessages([
                        {
                            id: `user-${item.id}`,
                            role: 'user',
                            content: item.query,
                            timestamp: new Date(item.timestamp || Date.now()),
                        },
                        {
                            id: `assistant-${item.id}`,
                            role: 'assistant',
                            content: item.explanation || `Generated query against collection "${item.collection}".`,
                            pipeline: item.pipeline || [],
                            collection: item.collection || '',
                            chartType: item.chartType || 'table',
                            results: item.results || [],
                            safetyStatus: 'read-only',
                            safetyBlocked: false,
                            executionTimeMs: item.executionTimeMs || null,
                            confidenceScore: item.confidenceScore || 100,
                            similarQueriesCount: item.similarQueriesCount || 0,
                            naturalLanguage: item.query,
                            schemaContext: item.schemaContext || '',
                        }
                    ]);
                }
            } catch (err) {
                console.warn('⚠️ Failed to restore query history item:', err.message);
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

            setError(null);
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
                const normalized = normalizeResponse(response);
                addMessage('assistant', normalized.content, normalized);
                if (onQuerySuccess) {
                    onQuerySuccess();
                }
                return normalized;
            } catch (err) {
                const errorMessage = err.response?.data?.error?.message || err.message || 'Failed to process your query. Please try again.';
                setError(errorMessage);
                addMessage('assistant', errorMessage, { isError: true });
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, addMessage, normalizeResponse, selectedModel, onQuerySuccess]
    );

    // Human-in-the-Loop Write Approval Executor
    const approveWrite = useCallback(
        async (messageId, approvalToken) => {
            if (isLoading) return;

            setError(null);
            setIsLoading(true);

            try {
                const response = await approveWriteQuery(approvalToken);
                const normalized = normalizeResponse(response);

                // Update the original staged message in-place in state
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === messageId
                            ? {
                                  ...msg,
                                  content: normalized.content,
                                  ...normalized,
                                  safetyStatus: 'write-executed',
                                  approvalToken: null,
                              }
                            : msg
                    )
                );
                if (onQuerySuccess) {
                    onQuerySuccess();
                }
            } catch (err) {
                const errorMessage = err.response?.data?.error?.message || err.message || 'Failed to authorize transaction.';
                setError(errorMessage);
                addMessage('assistant', `❌ Authorization Failed: ${errorMessage}`, { isError: true });
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, addMessage, normalizeResponse, onQuerySuccess]
    );

    const addVoiceResult = useCallback(
        (response) => {
            const transcript = response.transcript || response.text || '';
            if (transcript) {
                addMessage('user', transcript, { isVoice: true });
            }

            const normalized = normalizeResponse(response);
            addMessage('assistant', normalized.content, normalized);
            if (onQuerySuccess) {
                onQuerySuccess();
            }
        },
        [addMessage, normalizeResponse, onQuerySuccess]
    );

    const clearChat = useCallback(() => {
        setMessages([]);
        setError(null);
    }, []);

    // Clarification & Scope Action Helpers
    const submitClarifications = useCallback(
        (clarifications, originalQuery, options = {}) => {
            return sendMessage(originalQuery, {
                ...options,
                clarifications,
                skipUserMessage: options.skipUserMessage ?? false,
            });
        },
        [sendMessage]
    );

    const bypassAmbiguity = useCallback(
        (originalQuery, options = {}) => {
            return sendMessage(originalQuery, {
                ...options,
                bypassAmbiguity: true,
                skipUserMessage: options.skipUserMessage ?? false,
            });
        },
        [sendMessage]
    );

    const rerunWithScope = useCallback(
        (collections, originalQuery, options = {}) => {
            return sendMessage(originalQuery, {
                ...options,
                collections,
                skipUserMessage: options.skipUserMessage ?? false,
            });
        },
        [sendMessage]
    );

    return {
        messages,
        isLoading,
        error,
        selectedModel,
        setSelectedModel,
        sendMessage,
        approveWrite,
        addVoiceResult,
        clearChat,
        setMessages,
        messagesEndRef,
        // Clarification & Scope Action Helpers
        submitClarifications,
        bypassAmbiguity,
        rerunWithScope,
    };
}
