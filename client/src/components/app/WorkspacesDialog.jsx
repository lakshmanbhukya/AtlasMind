import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Folder, Pencil, Trash2, Search, Check, LoaderCircle, ArrowLeft } from 'lucide-react';
import { cn, workspaceId } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { TurnButton } from './turnParts';

/**
 * Manage saved workspaces (named collection scopes): list, create, edit, delete.
 * Uses a native modal <dialog>, so focus is trapped and Esc closes it.
 */
export default function WorkspacesDialog({
  open,
  onClose,
  workspaces = [],
  collections = [],
  activeWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onUpdateWorkspace,
  onDeleteWorkspace,
}) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(null); // null = list, 'new' or a workspace
  const [name, setName] = useState('');
  const [cols, setCols] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setConfirmDelete(null);
      setError(null);
    }
  }, [open]);

  const startEdit = (ws) => {
    setEditing(ws || 'new');
    setName(ws ? ws.name : '');
    setCols(ws ? [...(ws.collections || [])] : []);
    setQ('');
    setError(null);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(s) || (c.fields || []).some((f) => f.name.toLowerCase().includes(s)));
  }, [collections, q]);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name the workspace.');
    if (cols.length === 0) return setError('Select at least one collection.');
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        const created = await onCreateWorkspace({ name: name.trim(), collections: cols });
        if (created && workspaceId(created)) onSelectWorkspace(workspaceId(created), cols);
      } else {
        await onUpdateWorkspace(workspaceId(editing), { name: name.trim(), collections: cols });
        if (workspaceId(editing) === activeWorkspaceId) onSelectWorkspace(workspaceId(editing), cols);
      }
      setEditing(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Could not save the workspace.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ws) => {
    try {
      await onDeleteWorkspace(workspaceId(ws));
      if (workspaceId(ws) === activeWorkspaceId) onSelectWorkspace(null, []);
      setConfirmDelete(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Could not delete the workspace.');
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="ws-dialog-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] max-h-[min(640px,calc(100vh-48px))] p-0 rounded-2xl border border-vg-line bg-vg-char text-vg-text font-ui shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop:bg-black/60"
    >
      <div className="flex flex-col max-h-[min(640px,calc(100vh-48px))]">
        <header className="h-14 shrink-0 pl-5 pr-3 flex items-center justify-between border-b border-vg-line-soft">
          <div className="flex items-center gap-2">
            {editing && (
              <button type="button" aria-label="Back to workspaces" onClick={() => setEditing(null)} className={cn('w-8 h-8 -ml-2 rounded-md flex items-center justify-center text-vg-text-2 hover:bg-vg-surface', focusRing)}>
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            )}
            <h2 id="ws-dialog-title" className="text-[16px] font-semibold">
              {editing === 'new' ? 'New workspace' : editing ? 'Edit workspace' : 'Workspaces'}
            </h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={cn('w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface hover:text-vg-text', focusRing)}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {!editing ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <p className="px-2 pb-3 text-[13.5px] text-vg-text-2">
              A workspace limits questions to a fixed set of collections.
            </p>
            {workspaces.length === 0 && (
              <p className="px-2 py-6 text-center text-[13.5px] text-vg-text-3">No workspaces yet.</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {workspaces.map((w) => (
                <li key={workspaceId(w)} className="group min-h-12 px-2 rounded-lg flex items-center gap-3 hover:bg-vg-surface">
                  <Folder size={16} className="shrink-0 text-vg-text-3" aria-hidden="true" />
                  <div className="min-w-0 flex-1 py-1.5">
                    <p className="text-[14px] text-vg-text truncate">
                      {w.name}
                      {workspaceId(w) === activeWorkspaceId && <span className="ml-2 text-[12px] text-vg-accent">Active</span>}
                    </p>
                    <p className="font-code text-[12px] text-vg-text-3 truncate">{(w.collections || []).join(', ')}</p>
                  </div>
                  {confirmDelete === workspaceId(w) ? (
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => remove(w)} className={cn('h-8 px-2.5 rounded-md text-[13px] text-vg-red hover:bg-vg-red-wash', focusRing)}>Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className={cn('h-8 px-2.5 rounded-md text-[13px] text-vg-text-2 hover:bg-vg-surface-2', focusRing)}>Keep</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5">
                      <button type="button" aria-label={`Edit ${w.name}`} onClick={() => startEdit(w)} className={cn('w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}>
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label={`Delete ${w.name}`} onClick={() => setConfirmDelete(workspaceId(w))} className={cn('w-8 h-8 rounded-md flex items-center justify-center text-vg-text-3 hover:bg-vg-red-wash hover:text-vg-red', focusRing)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {error && <p role="alert" className="px-2 pt-2 text-[13px] text-vg-red">{error}</p>}
            <div className="px-2 pt-3">
              <TurnButton variant="outline" onClick={() => startEdit(null)}>
                <Plus size={15} className="text-vg-text-2" aria-hidden="true" />
                New workspace
              </TurnButton>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="flex-1 min-h-0 flex flex-col">
            <div className="px-5 pt-4">
              <label htmlFor="ws-name" className="block text-[12.5px] text-vg-text-3 mb-1.5">Name</label>
              <input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sales workspace"
                autoFocus
                className="w-full h-10 px-3 rounded-lg bg-vg-bg border border-vg-line outline-none focus:border-vg-accent-deep text-[14px] text-vg-text placeholder:text-vg-text-3"
              />
              <div className="mt-4 flex items-center justify-between">
                <span id="ws-cols-label" className="text-[12.5px] text-vg-text-3">Collections</span>
                <span className="text-[12.5px] text-vg-text-3">{cols.length} selected</span>
              </div>
              <label className="mt-1.5 h-9 px-3 rounded-lg bg-vg-bg border border-vg-line flex items-center gap-2 focus-within:border-vg-accent-deep">
                <Search size={14} className="text-vg-text-3" aria-hidden="true" />
                <span className="sr-only">Filter collections</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by collection or field" className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] placeholder:text-vg-text-3" />
              </label>
            </div>
            <div role="group" aria-labelledby="ws-cols-label" className="flex-1 min-h-[160px] overflow-y-auto px-3 py-2">
              {filtered.map((c) => {
                const on = cols.includes(c.name);
                return (
                  <label key={c.name} className={cn('min-h-10 px-2 rounded-lg flex items-center gap-3 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent', on ? 'bg-vg-surface' : 'hover:bg-vg-surface')}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setCols((p) => (on ? p.filter((x) => x !== c.name) : [...p, c.name]))} />
                    <span aria-hidden="true" className={cn('w-4 h-4 shrink-0 rounded-[4px] flex items-center justify-center', on ? 'bg-vg-accent text-vg-ink' : 'border border-vg-text-3')}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="font-code text-[13px] text-vg-text truncate">{c.name}</span>
                    <span className="ml-auto text-[12px] text-vg-text-3 whitespace-nowrap">
                      {c.documentCount != null ? `${c.documentCount.toLocaleString()} docs` : `${(c.fields || []).length} fields`}
                    </span>
                  </label>
                );
              })}
            </div>
            <footer className="shrink-0 px-5 py-3 border-t border-vg-line-soft flex items-center justify-between gap-3">
              <p role="alert" className="text-[13px] text-vg-red min-w-0">{error}</p>
              <div className="flex items-center gap-2">
                <TurnButton variant="ghost" onClick={() => setEditing(null)}>Cancel</TurnButton>
                <TurnButton type="submit" variant="primary" disabled={saving}>
                  {saving && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                  {editing === 'new' ? 'Create and use' : 'Save'}
                </TurnButton>
              </div>
            </footer>
          </form>
        )}
      </div>
    </dialog>
  );
}
