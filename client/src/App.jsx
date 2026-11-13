import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSchema } from './hooks/useSchema';
import { useWorkspaces } from './hooks/useWorkspaces';
import AppShell from './components/app/AppShell';
import LandingPage from './components/landing/LandingPage';
import { LogoMark } from './components/ui/vg/primitives';
import {
  fetchDashboard,
  removeDashboardPin,
  fetchQueryHistory,
  renameQueryHistoryItem,
  setQueryHistoryPinned,
  deleteQueryHistoryItem,
} from './services/api';

/**
 * App — Root component.
 *
 * Auth flow:
 *   1. useAuth() pings GET /api/auth/me on mount
 *   2. first check → loading screen
 *   3. isAuthenticated=true  → AppShell (sidebar + chat / dashboards / schema)
 *   4. isAuthenticated=false → LandingPage; on connect → refetch() → AppShell
 */
export default function App() {
  const { isAuthenticated, connectionMeta, isLoading, logout, refetch } = useAuth();
  const connectionId = isAuthenticated ? connectionMeta?.connectionId : undefined;
  const { workspaces, createWorkspace, updateWorkspace, deleteWorkspace } = useWorkspaces(connectionId);
  const schemaState = useSchema(connectionId);

  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [scopeMode, setScopeMode] = useState('all');
  const [selectedCollections, setSelectedCollections] = useState([]);

  const handleSelectWorkspace = useCallback((id, collections) => {
    setActiveWorkspaceId(id);
    if (id) {
      setScopeMode('selected');
      setSelectedCollections(collections || []);
    } else {
      setScopeMode('all');
      setSelectedCollections([]);
    }
  }, []);

  const [chatKey, setChatKey] = useState(0);
  const [pins, setPins] = useState([]);
  const [activeView, setActiveView] = useState('chat'); // 'chat' | 'dashboard' | 'schema'
  const [pinsLoading, setPinsLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  const loadPins = useCallback(async () => {
    setPinsLoading(true);
    try {
      const data = await fetchDashboard();
      setPins(data.data || []);
    } catch (err) {
      console.error('Failed to load pins:', err);
    } finally {
      setPinsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const hist = await fetchQueryHistory();
      setHistory(hist || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadPins();
      loadHistory();
    }
  }, [isAuthenticated, loadPins, loadHistory]);

  const handleRemovePin = useCallback(async (pinId) => {
    try {
      await removeDashboardPin(pinId);
      setPins((prev) => prev.filter((p) => (p._id || p.id) !== pinId));
    } catch (err) {
      console.error('Failed to remove pin:', err);
    }
  }, []);

  const handleNewQuery = useCallback(() => {
    setActiveView('chat');
    setHighlightedMessageId(null);
    setChatKey((k) => k + 1);
  }, []);

  const handleSelectHistory = useCallback((id) => {
    setActiveView('chat');
    setHighlightedMessageId(id);
  }, []);

  // History row actions: optimistic, reverted by a reload on failure.
  const handleRenameHistory = useCallback(async (id, name) => {
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, query: name } : h)));
    try {
      await renameQueryHistoryItem(id, name);
    } catch (err) {
      console.error('Failed to rename history item:', err);
      loadHistory();
    }
  }, [loadHistory]);

  const handleTogglePin = useCallback(async (id, pinned) => {
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, pinned } : h)));
    try {
      await setQueryHistoryPinned(id, pinned);
    } catch (err) {
      console.error('Failed to pin history item:', err);
      loadHistory();
    }
  }, [loadHistory]);

  const handleDeleteHistory = useCallback(async (id) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
    if (highlightedMessageId === id) {
      setHighlightedMessageId(null);
      setChatKey((k) => k + 1);
    }
    try {
      await deleteQueryHistoryItem(id);
    } catch (err) {
      console.error('Failed to delete history item:', err);
      loadHistory();
    }
  }, [highlightedMessageId, loadHistory]);

  // Keep the first loading screen until the initial auth check finishes, so
  // later refetches never unmount the landing page or the app.
  const [initialLoading, setInitialLoading] = useState(true);
  useEffect(() => {
    if (!isLoading) setInitialLoading(false);
  }, [isLoading]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-vg-bg font-ui">
        <div role="status" className="flex flex-col items-center gap-4">
          <span className="animate-pulse motion-reduce:animate-none">
            <LogoMark />
          </span>
          <p className="text-[13.5px] text-vg-text-3">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage onConnected={refetch} />;
  }

  return (
    <AppShell
      connectionMeta={connectionMeta}
      onLogout={logout}
      schemaState={schemaState}
      activeView={activeView}
      onViewChange={setActiveView}
      chatKey={chatKey}
      onNewQuery={handleNewQuery}
      history={history}
      historyLoading={historyLoading}
      highlightedMessageId={highlightedMessageId}
      onSelectHistory={handleSelectHistory}
      onRenameHistory={handleRenameHistory}
      onTogglePin={handleTogglePin}
      onDeleteHistory={handleDeleteHistory}
      onQuerySuccess={loadHistory}
      pins={pins}
      pinsLoading={pinsLoading}
      onPinAdded={loadPins}
      onRemovePin={handleRemovePin}
      scope={{
        workspaces,
        activeWorkspaceId,
        onSelectWorkspace: handleSelectWorkspace,
        scopeMode,
        onChangeScopeMode: setScopeMode,
        selectedCollections,
        onSetCollections: setSelectedCollections,
      }}
      workspaceActions={{
        onCreateWorkspace: createWorkspace,
        onUpdateWorkspace: updateWorkspace,
        onDeleteWorkspace: deleteWorkspace,
      }}
    />
  );
}
