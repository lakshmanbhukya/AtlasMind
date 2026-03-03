import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSchema } from './hooks/useSchema';
import AtlasTopNav from './components/AtlasTopNav';
import AtlasLeftSidebar from './components/AtlasLeftSidebar';
import AtlasChatPanel from './components/AtlasChatPanel';
import AtlasAnalyticsInspector from './components/AtlasAnalyticsInspector';
import DashboardPage from './pages/DashboardPage';
import LandingPage from './components/LandingPage';
import ErrorBoundary from './components/ErrorBoundary';
import { cn } from './lib/utils';
import { fetchDashboard, removeDashboardPin } from './services/api';

/** Simple responsive hook */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/**
 * App — Root component.
 *
 * Auth flow:
 *   1. useAuth() pings GET /api/auth/me on mount
 *   2. isLoading=true → full-screen loading spinner
 *   3. isAuthenticated=true  → Playground (3-panel layout)
 *   4. isAuthenticated=false → LandingPage
 *      └─ On connect → refetch() → Playground
 */
export default function App() {
  const { isAuthenticated, connectionMeta, isLoading, logout, refetch } = useAuth();

  const [lastMessage,  setLastMessage]  = useState(null);
  const [chatKey,      setChatKey]      = useState(0);
  const [pins,         setPins]         = useState([]);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [activeView,   setActiveView]   = useState('chat'); // 'chat' or 'dashboard'
  const [pinsLoading,  setPinsLoading]  = useState(false);

  const isMobile  = useMediaQuery('(max-width: 767px)');
  const isTablet  = useMediaQuery('(max-width: 1023px)');

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

  useEffect(() => {
    if (isAuthenticated) {
      loadPins();
    }
  }, [isAuthenticated, loadPins]);

  const handleRemovePin = useCallback(async (pinId) => {
    try {
      await removeDashboardPin(pinId);
      setPins((prev) => prev.filter((p) => (p._id || p.id) !== pinId));
    } catch (err) {
      console.error('Failed to remove pin:', err);
    }
  }, []);

  const handleNewQuery = useCallback(() => {
    setLastMessage(null);
    setActiveView('chat');
    setChatKey((k) => k + 1);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  // ── Loading state (initial auth check only) ──────────────────────────────
  // We use a separate state to handle the first load vs. subsequent refetches
  // to avoid unmounting the entire app UI (like LandingPage) during re-auth.
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (!isLoading) {
       setInitialLoading(false);
    }
  }, [isLoading]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#00ED64] flex items-center justify-center animate-pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
          </div>
          <p className="text-sm text-muted-foreground font-mono">Connecting to session...</p>
        </div>
      </div>
    );
  }

  // ── Landing Page (unauthenticated) ────────────────────────────────────────
  if (!isAuthenticated) {
    return <LandingPage onConnected={refetch} />;
  }

  // ── Playground (authenticated) ────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-primary/20 selection:text-primary">
      <AtlasTopNav
        connectionMeta={connectionMeta}
        onMenuToggle={toggleSidebar}
        showMenu={true}
        onLogout={logout}
      />

      <div className="flex flex-1 overflow-hidden relative grid-bg-dashboard">
        {/* Mobile sidebar backdrop */}
        {isMobile && sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40 animate-atlas-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div 
          className={cn(
            "transition-all duration-300 ease-in-out overflow-hidden z-50",
            isMobile ? "absolute left-0 top-0 bottom-0 shadow-2xl" : "relative",
            sidebarOpen ? (isMobile ? "w-64" : "w-64 border-r border-white/5") : "w-0"
          )}
        >
          <ErrorBoundary label="Sidebar">
            <AtlasLeftSidebar 
              onNewQuery={handleNewQuery} 
              activeView={activeView}
              onViewChange={setActiveView}
              pins={pins}
            />
          </ErrorBoundary>
        </div>

        {/* Main Panel — Chat or Dashboard */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeView === 'chat' ? (
            <ErrorBoundary label="Chat">
              <AtlasChatPanel
                key={chatKey}
                onLastMessage={setLastMessage}
                onNewQuery={handleNewQuery}
                onPinAdded={loadPins}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="Dashboard">
              <DashboardPage 
                pins={pins} 
                onRemovePin={handleRemovePin} 
                isLoading={pinsLoading}
              />
            </ErrorBoundary>
          )}
        </div>

        {/* Right Inspector */}
        {!isTablet && (
          <ErrorBoundary label="Inspector">
            <AtlasAnalyticsInspector lastMessage={lastMessage} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
