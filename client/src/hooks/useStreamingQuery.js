import { useState, useCallback, useRef } from 'react';

/**
 * useStreamingQuery — SSE-ready hook for real-time AI thinking steps.
 *
 * When the backend supports streaming (via Server-Sent Events on POST /api/query/stream),
 * this hook will show each processing step in real time:
 *   - Schema profiling
 *   - Retrieving similar examples
 *   - Generating MQL pipeline
 *   - Executing query
 *   - Formatting response
 *
 * Until the backend SSE endpoint exists, the hook provides a simulated
 * stage progression that can be dropped into the existing LoadingIndicator.
 *
 * Usage:
 *   const { steps, isStreaming, startStream, reset } = useStreamingQuery();
 */
export function useStreamingQuery() {
  const [steps, setSteps] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const sourceRef = useRef(null);

  /**
   * Start streaming from the SSE endpoint.
   * Falls back to simulated stages if SSE isn't available.
   */
  const startStream = useCallback(async (queryText) => {
    setIsStreaming(true);
    setSteps([]);

    try {
      // Attempt SSE connection
      const eventSource = new EventSource(`/api/query/stream?text=${encodeURIComponent(queryText)}`);
      sourceRef.current = eventSource;

      eventSource.addEventListener('step', (e) => {
        try {
          const data = JSON.parse(e.data);
          setSteps((prev) => [
            ...prev,
            {
              id: data.id || Date.now(),
              label: data.label || data.step,
              status: data.status || 'completed', // 'in-progress' | 'completed' | 'error'
              timestamp: Date.now(),
            },
          ]);
        } catch {
          // Ignore malformed events
        }
      });

      eventSource.addEventListener('result', (e) => {
        try {
          const result = JSON.parse(e.data);
          eventSource.close();
          sourceRef.current = null;
          setIsStreaming(false);
          return result;
        } catch {
          eventSource.close();
          sourceRef.current = null;
          setIsStreaming(false);
        }
      });

      eventSource.addEventListener('error', () => {
        eventSource.close();
        sourceRef.current = null;
        // Fall back to simulated stages
        simulateStages();
      });
    } catch {
      // SSE not available — use simulated stages
      simulateStages();
    }
  }, []);

  /**
   * Simulated stage progression (graceful fallback).
   */
  const simulateStages = useCallback(() => {
    const stages = [
      { label: 'Profiling schema…', delay: 0 },
      { label: 'Retrieving contextual examples…', delay: 1200 },
      { label: 'Generating MQL pipeline…', delay: 2400 },
      { label: 'Executing query…', delay: 3600 },
      { label: 'Formatting results…', delay: 4500 },
    ];

    stages.forEach(({ label, delay }) => {
      setTimeout(() => {
        setSteps((prev) => [
          ...prev,
          { id: Date.now(), label, status: 'completed', timestamp: Date.now() },
        ]);
      }, delay);
    });

    setTimeout(() => {
      setIsStreaming(false);
    }, 5000);
  }, []);

  const reset = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setSteps([]);
    setIsStreaming(false);
  }, []);

  return {
    steps,
    isStreaming,
    startStream,
    reset,
  };
}
