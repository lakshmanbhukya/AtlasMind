import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSchema } from '../services/api';

/**
 * Schema fetching and caching hook — powered by React Query.
 * 
 * Benefits over the previous manual approach:
 *  - Built-in caching (5-min staleTime from QueryClient defaults)
 *  - Background refetching when stale
 *  - Deduplication — multiple components calling useSchema share the same cache
 *  - Optimistic retry logic
 *
 * Preserves the same external API surface for backward compatibility.
 */
export function useSchema() {
    const queryClient = useQueryClient();
    const [expandedCollections, setExpandedCollections] = useState({});

    const { data: schema, isLoading, error } = useQuery({
        queryKey: ['schema'],
        queryFn: fetchSchema,
    });

    const refreshSchema = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['schema'] });
    }, [queryClient]);

    const toggleCollection = useCallback((collectionName) => {
        setExpandedCollections((prev) => ({
            ...prev,
            [collectionName]: !prev[collectionName],
        }));
    }, []);

    return {
        schema: schema ?? null,
        isLoading,
        error: error?.message || null,
        expandedCollections,
        toggleCollection,
        refreshSchema,
    };
}

