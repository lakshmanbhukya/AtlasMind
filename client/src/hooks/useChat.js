import { useState, useCallback, useRef, useEffect } from 'react';
import { sendQuery } from '../services/api';

/**
 * Chat state management hook.
 * Maps backend response fields to the UI message structure.
 *
 * Response fields consumed:
 *   aiMessage, pipeline, mql, collection, chartType, results, result,
 *   safetyStatus, safetyBlocked, executionTimeMs, confidenceScore,
 *   similarQueriesCount, naturalLanguage, explanation
 */
export function useChat() {
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
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
     * Accepts responses from both POST /api/query and POST /api/voice.
     */
    const normalizeResponse = useCallback((response) => ({
        // AI explanation — preferred over raw naturalLanguage as display text
        content: response.aiMessage || response.explanation || response.naturalLanguage || '',
        // MQL pipeline (both field name aliases supported)
        pipeline: response.pipeline || response.mql || [],
        collection: response.collection || '',
        chartType: response.chartType || 'table',
        // Results (both aliases)
        results: response.results || response.result || [],
        // Safety status — new field; fall back to old safetyBlocked for compat
        safetyStatus: response.safetyStatus || (response.safetyBlocked ? 'approval-required' : 'read-only'),
        safetyBlocked: response.safetyBlocked || response.safetyStatus === 'approval-required' || false,
        // UI metadata for the Inspector panel
        executionTimeMs: response.executionTimeMs || response.meta?.executionTimeMs || null,
        confidenceScore: response.confidenceScore || response.meta?.confidenceScore || null,
        similarQueriesCount: response.similarQueriesCount || response.meta?.similarQueriesCount || null,
        // Voice-specific
        transcript: response.transcript || response.text || null,
        naturalLanguage: response.naturalLanguage || '',
        schemaContext: response.schemaContext || '',
    }), []);

    const sendMessage = useCallback(
        async (text) => {
            if (!text.trim() || isLoading) return;

            setError(null);
            addMessage('user', text);
            setIsLoading(true);

            try {
                const response = await sendQuery(text);
                const normalized = normalizeResponse(response);
                addMessage('assistant', normalized.content, normalized);
            } catch (err) {
                const errorMessage = err.message || 'Failed to process your query. Please try again.';
                setError(errorMessage);
                addMessage('assistant', errorMessage, { isError: true });
            } finally {
                setIsLoading(false);
            }
        },
        [isLoading, addMessage, normalizeResponse]
    );

    /**
     * Handle a voice query response.
     * Called by voice input components after sendVoice() resolves.
     * The voice response already contains the full query result.
     */
    const addVoiceResult = useCallback(
        (response) => {
            // Add the user's transcribed text as a user message
            const transcript = response.transcript || response.text || '';
            if (transcript) {
                addMessage('user', transcript, { isVoice: true });
            }

            // Add the assistant's response
            const normalized = normalizeResponse(response);
            addMessage('assistant', normalized.content, normalized);
        },
        [addMessage, normalizeResponse]
    );

    const clearChat = useCallback(() => {
        setMessages([]);
        setError(null);
    }, []);

    return {
        messages,
        isLoading,
        error,
        sendMessage,
        addVoiceResult,
        clearChat,
        messagesEndRef,
    };
}
