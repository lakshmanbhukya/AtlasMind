import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSession, logout as apiLogout } from '../services/api';
import { PROVIDER_SETTINGS_KEY } from './useProviderSettings';

/**
 * useAuth — manages sessionstate via the httpOnly JWT cookie.
 *
 * On mount, pings GET /api/auth/me to determine if a valid session exists.
 * - isAuthenticated: true if the JWT cookie is present and valid
 * - connectionMeta: { connectionId, dbName, label, lastConnectedAt }
 * - isLoading: true during the initial auth check
 * - logout(): POSTs to /api/auth/logout, clears state
 * - refetch(): re-runs the auth check (call after successful connect)
 *
 * Logout and reconnect drop the cached provider settings: a personal Groq key
 * belongs to one sign-in, so the next one must not show (or send) its mode.
 */
export function useAuth() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [connectionMeta, setConnectionMeta] = useState(null);
    const [initialLoading, setInitialLoading] = useState(true);
    const queryClient = useQueryClient();
    const clearProviderSettings = useCallback(
        () => queryClient.removeQueries({ queryKey: [PROVIDER_SETTINGS_KEY] }),
        [queryClient]
    );

    const checkSession = useCallback(async () => {
        try {
            const data = await getSession();
            if (data.success) {
                setIsAuthenticated(true);
                setConnectionMeta({
                    connectionId: data.connectionId,
                    dbName: data.dbName,
                    label: data.label,
                    lastConnectedAt: data.lastConnectedAt,
                });
            } else {
                setIsAuthenticated(false);
                setConnectionMeta(null);
            }
        } catch {
            // 401 = no cookie / expired — not an error, just unauthenticated
            setIsAuthenticated(false);
            setConnectionMeta(null);
        } finally {
            setInitialLoading(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    const logout = useCallback(async () => {
        try {
            await apiLogout();
        } catch {
            // Ignore logout errors — clear state regardless
        }
        clearProviderSettings();
        setIsAuthenticated(false);
        setConnectionMeta(null);
    }, [clearProviderSettings]);

    const refetch = useCallback(() => {
        clearProviderSettings();
        return checkSession();
    }, [clearProviderSettings, checkSession]);

    return {
        isAuthenticated,
        connectionMeta,
        initialLoading,
        logout,
        refetch,
    };
}
