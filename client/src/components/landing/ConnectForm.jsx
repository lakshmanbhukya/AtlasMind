import { useId, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, Database, Eye, EyeOff,
  LoaderCircle, Lock, Pencil, Plug,
} from 'lucide-react';
import { apiErrorMessage, connect, listDatabases } from '../../services/api';
import { cn } from '../../lib/utils';
import { useDismiss } from '../../hooks/useDismiss';
import { LINKS } from './demoData';
import { focusRing } from '../ui/vg/primitives';

const isMongoUri = (s) => /^mongodb(\+srv)?:\/\/\S+/.test(s.trim());

/** "mongodb+srv://u:p@cluster0.abc.mongodb.net/x" → "cluster0" */
function clusterName(uri) {
  const host = uri.split('@').pop().replace(/^mongodb(\+srv)?:\/\//, '').split(/[/?,:]/)[0];
  return host.split('.')[0] || 'cluster';
}

/**
 * Connection bar. Posts to /api/connections/connect and calls onConnected()
 * once the server has set the session cookie.
 */
export default function ConnectForm({ onConnected }) {
  const [connStr, setConnStr] = useState('');
  const [showConn, setShowConn] = useState(false);
  const [dbName, setDbName] = useState('');
  const [databases, setDatabases] = useState([]);
  const [dbState, setDbState] = useState('idle'); // idle | loading | loaded | error
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState({});

  const listedFor = useRef('');
  const dropRef = useRef(null);
  const dbInputRef = useRef(null);
  const listId = useId();
  const errorId = useId();

  const loadDatabases = async () => {
    const uri = connStr.trim();
    if (!isMongoUri(uri) || listedFor.current === uri) return;
    listedFor.current = uri;
    setDbState('loading');
    try {
      const list = await listDatabases(uri);
      if (listedFor.current !== uri) return;
      setDatabases(list);
      setDbState('loaded');
    } catch {
      if (listedFor.current !== uri) return;
      setDatabases([]);
      setDbState('error');
      listedFor.current = '';
    }
  };

  useDismiss(menuOpen, () => setMenuOpen(false), { insideRefs: [dropRef] });

  const toggleMenu = () => {
    if (!menuOpen) loadDatabases();
    setMenuOpen((o) => !o);
  };

  const pickDb = (name) => {
    setDbName(name);
    setFieldError((f) => ({ ...f, db: null }));
    setMenuOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const uri = connStr.trim();
    const db = dbName.trim();
    const errs = {
      conn: !uri ? 'Enter a connection string.' : !isMongoUri(uri) ? 'Use a mongodb:// or mongodb+srv:// string.' : null,
      db: !db ? 'Choose or type a database.' : null,
    };
    setFieldError(errs);
    if (errs.conn || errs.db) {
      setError(errs.conn || errs.db);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await connect({ connectionString: uri, dbName: db, label: db });
      onConnected();
    } catch (err) {
      const available = err?.response?.data?.availableDatabases;
      if (available?.length) {
        setDatabases(available.map(({ name, collectionCount }) => ({ name, collectionCount })));
        setDbState('loaded');
        listedFor.current = uri;
        setMenuOpen(true);
      }
      setError(apiErrorMessage(err, 'Could not connect. Check the connection string and database.'));
    } finally {
      setSubmitting(false);
    }
  };

  const selected = databases.find((d) => d.name === dbName);
  const cluster = isMongoUri(connStr) ? clusterName(connStr) : null;

  return (
    <div className="hero-form-wrap mx-auto w-full max-w-[1040px] mt-10">
      <form
        id="connect"
        noValidate
        onSubmit={handleSubmit}
        aria-describedby={error ? errorId : undefined}
        className="hero-form rounded-[14px] border border-vg-line bg-vg-char flex flex-col md:flex-row md:items-center md:h-16 p-1 md:pl-0"
      >
        {/* Connection string */}
        <label
          className={cn(
            'md:flex-[1.55] h-14 md:h-full flex items-center gap-3 px-4 md:px-5 border-b md:border-b-0 md:border-r border-vg-line rounded-t-[13px] md:rounded-tr-none md:rounded-l-[13px] focus-within:bg-vg-surface-2 transition-colors min-w-0',
            fieldError.conn && 'bg-vg-red/5'
          )}
        >
          <Plug size={17} className="shrink-0 text-vg-text-3" aria-hidden="true" />
          <span className="flex flex-col flex-1 min-w-0">
            <input
              id="connection-string"
              aria-label="Connection string"
              type={showConn ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={connStr}
              aria-invalid={!!fieldError.conn}
              onChange={(e) => {
                setConnStr(e.target.value);
                setFieldError((f) => ({ ...f, conn: null }));
              }}
              onBlur={loadDatabases}
              placeholder="mongodb+srv://user:password@cluster0.mongodb.net"
              className="bg-transparent outline-none font-code text-[14px] text-vg-text placeholder:text-vg-text-2 truncate"
            />
          </span>
          <button
            type="button"
            onClick={() => setShowConn((s) => !s)}
            aria-label={showConn ? 'Hide connection string' : 'Show connection string'}
            aria-pressed={showConn}
            className={cn('w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface-3', focusRing)}
          >
            {showConn ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </label>

        {/* Database combobox */}
        <div ref={dropRef} className="relative md:flex-[0.7] h-14 md:h-full min-w-0">
          <div
            className={cn(
              'w-full h-full flex items-center gap-3 px-4 md:px-5 focus-within:bg-vg-surface-2 hover:bg-vg-surface-2 transition-colors',
              menuOpen && 'bg-vg-surface-2',
              fieldError.db && 'bg-vg-red/5'
            )}
          >
            <Database size={16} className="shrink-0 text-vg-text-3" aria-hidden="true" />
            <label className="flex flex-col flex-1 min-w-0">
              <span className="flex items-baseline gap-2 min-w-0">
                <input
                  ref={dbInputRef}
                  aria-label="Database"
                  role="combobox"
                  aria-expanded={menuOpen}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-invalid={!!fieldError.db}
                  autoComplete="off"
                  spellCheck={false}
                  value={dbName}
                  onChange={(e) => {
                    setDbName(e.target.value);
                    setFieldError((f) => ({ ...f, db: null }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (!menuOpen) toggleMenu();
                      requestAnimationFrame(() => dropRef.current?.querySelector('[role="option"]')?.focus());
                    }
                  }}
                  placeholder="your_database"
                  className="w-full min-w-0 bg-transparent outline-none font-code text-[14px] text-vg-text placeholder:text-vg-text-3 truncate"
                />
                {selected && (
                  <span className="shrink-0 text-[12px] text-vg-text-3 tabular-nums">
                    {selected.collectionCount} collections
                  </span>
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={toggleMenu}
              aria-label="Show databases"
              aria-expanded={menuOpen}
              aria-controls={listId}
              className={cn('w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-vg-text-2 hover:bg-vg-surface-3', focusRing)}
            >
              <ChevronDown size={15} className={cn('transition-transform', menuOpen && 'rotate-180')} />
            </button>
          </div>

          {menuOpen && (
            <div className="absolute left-0 right-0 md:right-auto top-[calc(100%+10px)] z-40 md:w-[340px] p-1.5 rounded-xl border border-vg-line bg-vg-char-2 shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
              <div className="h-8 px-3 flex items-center justify-between text-[12px] text-vg-text-3">
                <span>{cluster ? `Databases on ${cluster}` : 'Databases'}</span>
                {dbState === 'loaded' && <span className="tabular-nums">{databases.length}</span>}
              </div>

              {dbState === 'loading' && (
                <p className="h-10 px-3 flex items-center gap-2 text-[13px] text-vg-text-2">
                  <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                  Listing databases…
                </p>
              )}
              {dbState === 'idle' && !cluster && (
                <p className="px-3 py-2 text-[13px] leading-5 text-vg-text-2">
                  Enter a connection string to list its databases.
                </p>
              )}
              {dbState === 'error' && (
                <p className="px-3 py-2 text-[13px] leading-5 text-vg-text-2">
                  Could not list databases. Check the connection string, or type the name.
                </p>
              )}
              {dbState === 'loaded' && databases.length === 0 && (
                <p className="px-3 py-2 text-[13px] leading-5 text-vg-text-2">
                  No databases visible to this user. Type the name instead.
                </p>
              )}

              <ul id={listId} role="listbox" aria-label="Databases" className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto">
                {databases.map((d) => {
                  const on = d.name === dbName;
                  return (
                    <li key={d.name}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => pickDb(d.name)}
                        onKeyDown={(e) => {
                          const el = e.currentTarget.closest('li');
                          if (e.key === 'ArrowDown') { e.preventDefault(); el.nextElementSibling?.querySelector('button')?.focus(); }
                          if (e.key === 'ArrowUp') { e.preventDefault(); (el.previousElementSibling?.querySelector('button') || dbInputRef.current)?.focus(); }
                        }}
                        className={cn(
                          'w-full h-10 px-3 rounded-lg flex items-center gap-3 text-left hover:bg-vg-surface-2 focus-visible:outline-none focus-visible:bg-vg-surface-2',
                          on && 'bg-vg-surface-2'
                        )}
                      >
                        <Database size={15} className={on ? 'text-vg-accent' : 'text-vg-text-3'} aria-hidden="true" />
                        <span className={cn('flex-1 font-code text-[13px] truncate', on ? 'text-vg-text' : 'text-vg-text-2')}>{d.name}</span>
                        <span className="text-[12px] tabular-nums text-vg-text-3">{d.collectionCount} collections</span>
                        <Check size={14} className={cn('w-4 text-vg-accent', !on && 'invisible')} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="my-1.5 h-px bg-vg-line" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  dbInputRef.current?.focus();
                }}
                className="w-full h-10 px-3 rounded-lg flex items-center gap-3 text-[13.5px] text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text focus-visible:outline-none focus-visible:bg-vg-surface-2"
              >
                <Pencil size={15} aria-hidden="true" />
                Enter a database name
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={cn(
            'hero-cta mt-1 md:mt-0 h-12 px-6 shrink-0 rounded-[10px] bg-vg-accent text-vg-ink text-[15px] font-semibold flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-70 disabled:cursor-wait',
            focusRing
          )}
        >
          {submitting ? (
            <>
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              Connecting…
            </>
          ) : (
            <>
              Connect a cluster
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      {error && (
        <p id={errorId} role="alert" className="mt-3 flex items-start gap-1.5 text-[13px] text-vg-red">
          <CircleAlert size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[13px] text-vg-text-3">
        <span className="flex items-center gap-1.5">
          <Lock size={13} aria-hidden="true" />
          httpOnly session cookie. Writes are staged until you approve them.
        </span>
        <a
          href={LINKS.liveDemo}
          target="_blank"
          rel="noreferrer"
          className={cn('flex items-center gap-1 text-vg-text-2 hover:text-vg-text rounded', focusRing)}
        >
          Open the live demo
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
