import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProviderSettings, saveProviderKey, setProviderMode, deleteProviderKey } from '../services/api';
import { expectedPayerOf } from '../lib/providerSettings';

/** Query key prefix; useAuth removes it on logout and reconnect. */
export const PROVIDER_SETTINGS_KEY = 'providerSettings';

/**
 * Who pays for this sign-in's Groq calls (TanStack Query, like useSchema).
 * Shared by the sidebar's key panel and useChat: both read one cache entry.
 *
 * `refresh()` invalidates it; useChat calls it after every query or voice response,
 * so the allowance counter moves and a `settings_changed` reply picks up the new mode.
 * The mutations write the settings the server returns straight into the cache.
 */
export function useProviderSettings(connectionId) {
    const queryClient = useQueryClient();
    const { data, isLoading, error } = useQuery({
        queryKey: [PROVIDER_SETTINGS_KEY, connectionId],
        queryFn: getProviderSettings,
        enabled: Boolean(connectionId),
        // The allowance moves with every question; useChat invalidates after each response.
        staleTime: 30_000,
    });

    const store = useCallback(
        (settings) => queryClient.setQueryData([PROVIDER_SETTINGS_KEY, connectionId], settings),
        [queryClient, connectionId]
    );
    const refresh = useCallback(
        () => queryClient.invalidateQueries({ queryKey: [PROVIDER_SETTINGS_KEY] }),
        [queryClient]
    );

    const saveMutation = useMutation({ mutationFn: saveProviderKey, onSuccess: store });
    const modeMutation = useMutation({ mutationFn: setProviderMode, onSuccess: store });
    const deleteMutation = useMutation({ mutationFn: deleteProviderKey, onSuccess: store });

    return {
        settings: data ?? null,
        isLoading,
        error: error || null,
        expectedPayer: expectedPayerOf(data),
        refresh,
        saveKey: saveMutation.mutateAsync,
        setMode: modeMutation.mutateAsync,
        deleteKey: deleteMutation.mutateAsync,
        isSaving: saveMutation.isPending || modeMutation.isPending || deleteMutation.isPending,
    };
}
