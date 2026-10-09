import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace } from '../services/api';

/**
 * Hook for managing saved workspaces with TanStack Query.
 */
export function useWorkspaces() {
    const queryClient = useQueryClient();

    const {
        data: workspaces = [],
        isLoading,
        error,
        refetch,
    } = useQuery({
        queryKey: ['workspaces'],
        queryFn: fetchWorkspaces,
        staleTime: 60000,
    });

    const createMutation = useMutation({
        mutationFn: createWorkspace,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => updateWorkspace(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: deleteWorkspace,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        },
    });

    return {
        workspaces,
        isLoading,
        error: error?.message || null,
        refetch,
        createWorkspace: createMutation.mutateAsync,
        updateWorkspace: (id, data) => updateMutation.mutateAsync({ id, data }),
        deleteWorkspace: deleteMutation.mutateAsync,
        isCreating: createMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,
    };
}
