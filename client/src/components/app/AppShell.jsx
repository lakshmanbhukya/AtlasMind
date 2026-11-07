import { useCallback, useState } from 'react';
import { cn } from '../../lib/utils';
import ErrorBoundary from '../ErrorBoundary';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useDismiss } from '../../hooks/useDismiss';
import DashboardPage from '../../pages/DashboardPage';
import Sidebar from './Sidebar';
import ThreadHeader from './ThreadHeader';
import ChatThread from './ChatThread';
import SchemaView from './SchemaView';
import WorkspacesDialog from './WorkspacesDialog';

/**
 * Authenticated app frame: collapsible sidebar (an overlay drawer below `md`)
 * and the main panel showing the chat thread, dashboards or the schema explorer.
 */
export default function AppShell({
  connectionMeta,
  onLogout,
  schemaState,
  activeView,
  onViewChange,
  chatKey,
  onNewQuery,
  history,
  historyLoading,
  highlightedMessageId,
  onSelectHistory,
  onRenameHistory,
  onTogglePin,
  onDeleteHistory,
  onQuerySuccess,
  pins,
  pinsLoading,
  onPinAdded,
  onRemovePin,
  scope,
  workspaceActions,
}) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);

  const sidebarVisible = isMobile ? drawerOpen : desktopOpen;
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSidebar = () => (isMobile ? setDrawerOpen((o) => !o) : setDesktopOpen((o) => !o));

  useDismiss(isMobile && drawerOpen, closeDrawer, { outside: false });

  // On phones, any sidebar navigation closes the drawer.
  const afterNav = (fn) => (...args) => {
    fn(...args);
    if (isMobile) closeDrawer();
  };

  const { schema, isLoading: schemaLoading, error: schemaError, refreshSchema } = schemaState;
  const collectionCount = Array.isArray(schema?.collections) ? schema.collections.length : undefined;
  const scopeWithDialog = { ...scope, collections: schema?.collections || [], onManageWorkspaces: () => setWorkspacesOpen(true) };

  return (
    <div className="vg-app flex h-[100dvh] w-full bg-vg-bg text-vg-text font-ui antialiased overflow-hidden">
      {isMobile && drawerOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={closeDrawer} />
      )}

      <div
        className={cn(
          'shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none',
          isMobile ? 'fixed inset-y-0 left-0 z-50 shadow-[0_0_48px_rgba(0,0,0,0.6)]' : 'relative',
          sidebarVisible ? 'w-[272px]' : 'w-0'
        )}
        inert={!sidebarVisible ? true : undefined}
      >
        <ErrorBoundary label="Sidebar">
          <Sidebar
            onCollapse={toggleSidebar}
            onNewQuery={afterNav(onNewQuery)}
            activeView={activeView}
            onViewChange={afterNav(onViewChange)}
            onOpenWorkspaces={afterNav(() => setWorkspacesOpen(true))}
            history={history}
            historyLoading={historyLoading}
            activeHistoryId={activeView === 'chat' ? highlightedMessageId : null}
            onSelectHistory={afterNav(onSelectHistory)}
            onRenameHistory={onRenameHistory}
            onTogglePin={onTogglePin}
            onDeleteHistory={onDeleteHistory}
            connectionMeta={connectionMeta}
            onLogout={onLogout}
          />
        </ErrorBoundary>
      </div>

      <main className="flex-1 min-w-0 flex flex-col bg-vg-bg">
        <ThreadHeader
          dbName={connectionMeta?.dbName}
          collectionCount={collectionCount}
          onLogout={onLogout}
          showSidebarToggle={!sidebarVisible}
          onToggleSidebar={toggleSidebar}
        />
        {activeView === 'dashboard' ? (
          <ErrorBoundary label="Dashboard">
            <DashboardPage pins={pins} onRemovePin={onRemovePin} isLoading={pinsLoading} />
          </ErrorBoundary>
        ) : activeView === 'schema' ? (
          <ErrorBoundary label="Schema explorer">
            <SchemaView schema={schema} isLoading={schemaLoading} error={schemaError} onRefresh={refreshSchema} dbName={connectionMeta?.dbName} />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary label="Chat">
            <ChatThread
              key={chatKey}
              connectionMeta={connectionMeta}
              schema={schema}
              highlightedMessageId={highlightedMessageId}
              onQuerySuccess={onQuerySuccess}
              onPinAdded={onPinAdded}
              scope={scopeWithDialog}
            />
          </ErrorBoundary>
        )}
      </main>

      <WorkspacesDialog
        open={workspacesOpen}
        onClose={() => setWorkspacesOpen(false)}
        workspaces={scope.workspaces}
        collections={schema?.collections || []}
        activeWorkspaceId={scope.activeWorkspaceId}
        onSelectWorkspace={scope.onSelectWorkspace}
        {...workspaceActions}
      />
    </div>
  );
}
