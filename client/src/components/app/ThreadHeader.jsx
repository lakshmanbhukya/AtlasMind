import { Database, LogOut, PanelLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';

/** Top bar of the main panel: sidebar toggle (when collapsed), connected database, disconnect. */
export default function ThreadHeader({ dbName, collectionCount, onLogout, showSidebarToggle, onToggleSidebar }) {
  return (
    <header className="h-14 shrink-0 px-3 sm:px-5 flex items-center gap-1">
      {showSidebarToggle && (
        <button
          type="button"
          aria-label="Open sidebar"
          onClick={onToggleSidebar}
          className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </button>
      )}
      <div className="ml-auto h-9 px-3 rounded-lg flex items-center gap-2 text-[13px] text-vg-text-2 min-w-0">
        <Database size={15} className="shrink-0 text-vg-accent" aria-hidden="true" />
        <span className="font-code text-[12.5px] truncate">{dbName || 'database'}</span>
        {typeof collectionCount === 'number' && (
          <span className="text-vg-text-3 whitespace-nowrap hidden sm:inline">
            {collectionCount} {collectionCount === 1 ? 'collection' : 'collections'}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Disconnect database"
        title="Disconnect"
        onClick={onLogout}
        className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </header>
  );
}
