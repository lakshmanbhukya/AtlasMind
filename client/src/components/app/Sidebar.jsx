import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Search, LayoutDashboard, Database, Folder, ChevronDown, Settings, PanelLeft, LogOut, X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing, LogoMark } from '../ui/vg/primitives';
import { initials } from '../../lib/turnFormat';
import ChartTypeIcon from './ChartTypeIcon';
import RowMenu from './RowMenu';
import { Menu, MenuItem, MenuSeparator } from './Menu';

function NavItem({ icon: Icon, label, active, onClick, ...props }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      {...props}
      className={cn(
        'w-full h-10 px-3 rounded-lg flex items-center gap-3 text-[14.5px] transition-colors',
        active ? 'bg-vg-surface-2 text-vg-text' : 'text-vg-text-2 hover:bg-vg-surface hover:text-vg-text',
        focusRing
      )}
    >
      <Icon size={17} aria-hidden="true" />
      {label}
    </button>
  );
}

function SectionToggle({ label, open, onToggle, controls }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn('h-7 px-3 rounded-md flex items-center gap-1 text-[12.5px] text-vg-text-3 hover:text-vg-text-2', focusRing)}
    >
      {label}
      <ChevronDown size={12} className={cn('transition-transform', !open && '-rotate-90')} aria-hidden="true" />
    </button>
  );
}

function HistoryRow({ item, active, onSelect, onRename, onTogglePin, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(item.query);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== item.query) onRename(item.id, name);
    else setDraft(item.query);
  };

  if (editing) {
    return (
      <li className="h-9 px-1.5 flex items-center">
        <label className="sr-only" htmlFor={`rename-${item.id}`}>Rename query</label>
        <input
          id={`rename-${item.id}`}
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(item.query);
              setEditing(false);
            }
          }}
          className="w-full h-8 px-2.5 rounded-md bg-vg-bg border border-vg-accent-deep outline-none text-[14px] text-vg-text"
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group relative h-9 rounded-lg flex items-center text-[14px]',
        active || menuOpen ? 'bg-vg-surface text-vg-text' : 'text-vg-text-2 hover:bg-vg-surface hover:text-vg-text'
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={active ? 'true' : undefined}
        title={item.query}
        className={cn('h-full flex-1 min-w-0 pl-3 pr-9 rounded-lg text-left truncate', focusRing)}
      >
        {item.query}
      </button>
      {!menuOpen && (
        <ChartTypeIcon chartType={item.chartType} size={14} aria-hidden="true" className="absolute right-3 text-vg-text-3 pointer-events-none group-hover:hidden group-focus-within:hidden" />
      )}
      <RowMenu
        title={item.query}
        pinned={item.pinned}
        onOpenChange={setMenuOpen}
        onRename={() => {
          setDraft(item.query);
          setEditing(true);
        }}
        onTogglePin={() => onTogglePin(item.id, !item.pinned)}
        onDelete={() => onDelete(item.id)}
      />
    </li>
  );
}

/**
 * Left column: product mark + collapse, primary nav, Pinned and Recents
 * (single queries from history) with row menus, and the connection footer.
 */
export default function Sidebar({
  onCollapse,
  onNewQuery,
  activeView,
  onViewChange,
  onOpenWorkspaces,
  history = [],
  historyLoading,
  activeHistoryId,
  onSelectHistory,
  onRenameHistory,
  onTogglePin,
  onDeleteHistory,
  connectionMeta,
  onLogout,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    return s ? history.filter((h) => (h.query || '').toLowerCase().includes(s)) : history;
  }, [history, query]);
  const pinned = filtered.filter((h) => h.pinned);
  const recents = filtered.filter((h) => !h.pinned);

  const rowProps = {
    onSelect: onSelectHistory,
    onRename: onRenameHistory,
    onTogglePin,
    onDelete: onDeleteHistory,
  };

  const label = connectionMeta?.label || connectionMeta?.dbName || 'Connected';

  return (
    <nav aria-label="AtlasMind" className="h-full w-[272px] bg-vg-sidebar border-r border-vg-line-soft flex flex-col font-ui text-vg-text">
      <div className="h-14 shrink-0 px-3 flex items-center justify-between">
        <div className="flex items-center gap-2 pl-1">
          <LogoMark size="sm" />
          <span className="text-[15px] font-semibold tracking-tight">AtlasMind</span>
        </div>
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={onCollapse}
          className={cn('w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}
        >
          <PanelLeft size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="px-2 flex flex-col gap-0.5">
        <NavItem icon={Plus} label="New query" active={activeView === 'chat' && !activeHistoryId} onClick={onNewQuery} />
        {searchOpen ? (
          <div className="h-10 px-3 rounded-lg bg-vg-surface flex items-center gap-3">
            <Search size={17} className="text-vg-text-3 shrink-0" aria-hidden="true" />
            <label className="sr-only" htmlFor="history-search">Search queries</label>
            <input
              id="history-search"
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  setSearchOpen(false);
                }
              }}
              placeholder="Search queries"
              className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px] text-vg-text placeholder:text-vg-text-3"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
              className={cn('w-6 h-6 rounded flex items-center justify-center text-vg-text-3 hover:text-vg-text', focusRing)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <NavItem icon={Search} label="Search" onClick={() => setSearchOpen(true)} />
        )}
        <NavItem icon={LayoutDashboard} label="Dashboards" active={activeView === 'dashboard'} onClick={() => onViewChange('dashboard')} />
        <NavItem icon={Database} label="Schema explorer" active={activeView === 'schema'} onClick={() => onViewChange('schema')} />
        <NavItem icon={Folder} label="Workspaces" onClick={onOpenWorkspaces} aria-haspopup="dialog" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        {pinned.length > 0 && (
          <section className="mt-6 px-2" aria-label="Pinned queries">
            <SectionToggle label="Pinned" open={pinnedOpen} onToggle={() => setPinnedOpen((o) => !o)} controls="pinned-list" />
            {pinnedOpen && (
              <ul id="pinned-list" className="mt-0.5 flex flex-col gap-0.5">
                {pinned.map((item) => (
                  <HistoryRow key={item.id} item={item} active={item.id === activeHistoryId} {...rowProps} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section className={cn('px-2', pinned.length > 0 ? 'mt-5' : 'mt-6')} aria-label="Recent queries">
          <SectionToggle label="Recents" open={recentsOpen} onToggle={() => setRecentsOpen((o) => !o)} controls="recents-list" />
          {recentsOpen && (
            <ul id="recents-list" className="mt-0.5 flex flex-col gap-0.5">
              {historyLoading && history.length === 0 &&
                [70, 55, 82, 64].map((w) => (
                  <li key={w} aria-hidden="true" className="h-9 px-3 flex items-center">
                    <span className="h-3 rounded bg-vg-surface vg-shimmer" style={{ width: `${w}%` }} />
                  </li>
                ))}
              {!historyLoading && recents.length === 0 && (
                <li className="px-3 py-2 text-[13px] text-vg-text-3">
                  {query ? 'No queries match.' : 'Questions you ask appear here.'}
                </li>
              )}
              {recents.map((item) => (
                <HistoryRow key={item.id} item={item} active={item.id === activeHistoryId} {...rowProps} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="relative h-16 shrink-0 px-3 border-t border-vg-line-soft flex items-center gap-3">
        <span aria-hidden="true" className="w-8 h-8 shrink-0 rounded-full bg-[var(--vg-avatar)] flex items-center justify-center text-[12px] font-semibold">
          {initials(label)}
        </span>
        <span className="flex-1 min-w-0 text-[14px] text-vg-text truncate" title={label}>{label}</span>
        <button
          ref={accountRef}
          type="button"
          aria-label="Settings"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((o) => !o)}
          className={cn('w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        <Menu open={accountOpen} onClose={() => setAccountOpen(false)} anchorRef={accountRef} label="Settings" className="right-2 bottom-14 w-[208px]">
          <MenuItem
            icon={Folder}
            onSelect={() => {
              setAccountOpen(false);
              onOpenWorkspaces();
            }}
          >
            Manage workspaces
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={LogOut}
            danger
            onSelect={() => {
              setAccountOpen(false);
              onLogout();
            }}
          >
            Disconnect
          </MenuItem>
        </Menu>
      </div>
    </nav>
  );
}
