import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

/**
 * useAuth — manages sessionstate via the httpOnly JWT cookie.
 *
 * On mount, pings GET /api/auth/me to determine if a valid session exists.
 * - isAuthenticated: true if the JWT cookie is present and valid
 * - connectionMeta: { connectionId, dbName, label, lastConnectedAt }
 * - isLoading: true during the initial auth check
 * - logout(): POSTs to /api/auth/logout, clears state
 * - refetch(): re-runs the auth check (call after successful connect)
 */
export function useAuth() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [connectionMeta, setConnectionMeta] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const checkSession = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data } = await api.get('auth/me');
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
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
    }, [checkSession]);

    const logout = useCallback(async () => {
        try {
            await api.post('auth/logout');
        } catch {
            // Ignore logout errors — clear state regardless
        }
        setIsAuthenticated(false);
        setConnectionMeta(null);
    }, []);

    return {
        isAuthenticated,
        connectionMeta,
        isLoading,
        logout,
        refetch: checkSession,
    };
}
