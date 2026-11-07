import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSchema } from '../services/api';

/**
 * Schema fetching and caching hook, powered by React Query: shared cache across
 * components, background refetching when stale (5-min staleTime from the QueryClient defaults).
 */
export function useSchema() {
    const queryClient = useQueryClient();

    const { data: schema, isLoading, error } = useQuery({
        queryKey: ['schema'],
        // Wrapped so React Query's context object is not passed as `forceRefresh`.
        queryFn: () => fetchSchema(),
    });

    const refreshSchema = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['schema'] });
    }, [queryClient]);

    return {
        schema: schema ?? null,
        isLoading,
        error: error?.message || null,
        refreshSchema,
    };
}
