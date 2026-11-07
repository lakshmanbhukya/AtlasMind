import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, Mic, ArrowUp, Search, Check, LoaderCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { Menu, MenuItem, MenuLabel } from './Menu';
import { ScopePicker, ModelPicker } from './ComposerPickers';

const WAVE = [6, 10, 16, 9, 20, 13, 7, 18, 24, 12, 8, 15, 22, 10, 6, 14, 19, 9, 12, 7, 17, 11, 6, 13];

function useElapsed(active) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 500);
    return () => {
      clearInterval(t);
      setSecs(0);
    };
  }, [active]);
  return secs;
}

/** "+" menu: add or remove collections from the query scope. */
function CollectionMenu({ collections, selected, onToggle, placement }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? collections.filter((c) => c.name.toLowerCase().includes(s)) : collections;
  }, [collections, q]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Add collections to the scope"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
          setQ('');
        }}
        anchorRef={btnRef}
        label="Collections in scope"
        focusChecked={false}
        className={cn('left-0 w-[280px]', placement === 'top' ? 'bottom-11' : 'top-11')}
      >
        <div className="px-1 pt-1 pb-1.5">
          <label className="h-8 px-2.5 rounded-lg bg-vg-bg border border-vg-line flex items-center gap-2 focus-within:border-vg-accent-deep">
            <Search size={13} className="text-vg-text-3" aria-hidden="true" />
            <span className="sr-only">Filter collections</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.currentTarget.closest('[role="menu"]')?.querySelector('[role="menuitemcheckbox"]')?.focus();
                }
              }}
              placeholder="Filter collections"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-vg-text placeholder:text-vg-text-3"
            />
          </label>
        </div>
        <MenuLabel>Collections in scope</MenuLabel>
        <div className="max-h-[260px] overflow-y-auto">
          {filtered.length === 0 && <p className="px-2.5 py-2 text-[13px] text-vg-text-3">No collections match.</p>}
          {filtered.map((c) => {
            const on = selected.includes(c.name);
            return (
              <MenuItem
                key={c.name}
                role="menuitemcheckbox"
                checked={on}
                onSelect={() => onToggle(c.name)}
                hint={c.documentCount != null ? <span className="font-code text-[11.5px] text-vg-text-3">{c.documentCount.toLocaleString()}</span> : null}
              >
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={cn('w-4 h-4 shrink-0 rounded-[4px] flex items-center justify-center', on ? 'bg-vg-accent text-vg-ink' : 'border border-vg-text-3')}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="font-code text-[13px] truncate">{c.name}</span>
                </span>
              </MenuItem>
            );
          })}
        </div>
      </Menu>
    </div>
  );
}

/**
 * Query composer: auto-growing textarea, collection "+" menu, voice recording
 * (waveform with Cancel / Send) and the scope + model pickers underneath.
 */
export default function Composer({
  variant = 'dock',
  placeholder,
  onSubmit,
  busy = false,
  draft,
  onDraftConsumed,
  voice,
  scope,
  model,
}) {
  const [value, setValue] = useState('');
  const taRef = useRef(null);
  const placement = variant === 'hero' ? 'bottom' : 'top';
  const recording = Boolean(voice?.isRecording);
  const elapsed = useElapsed(recording);

  // External drafts ("Edit question") land in the textarea: adopt during render, focus after commit.
  const [adoptedDraft, setAdoptedDraft] = useState(null);
  if (draft != null && draft !== adoptedDraft) {
    setAdoptedDraft(draft);
    setValue(draft);
  } else if (draft == null && adoptedDraft != null) {
    setAdoptedDraft(null);
  }
  useEffect(() => {
    if (draft == null) return;
    onDraftConsumed?.();
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, [draft, onDraftConsumed]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 208)}px`;
  }, [value, recording]);

  const canSend = value.trim().length > 0 && !busy;
  const submit = () => {
    if (!canSend) return;
    onSubmit(value.trim());
    setValue('');
  };

  const selected = scope?.selectedCollections || [];
  const toggleCollection = (name) => {
    const next = selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name];
    scope.onSetCollections(next);
    scope.onChangeScopeMode(next.length ? 'selected' : 'all');
  };

  return (
    <div className="w-full max-w-[760px]">
      <div
        className={cn(
          'rounded-[20px] border border-vg-line bg-vg-surface shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-colors',
          'focus-within:border-vg-accent-deep'
        )}
      >
        {recording ? (
          <div className="px-5 pt-4 min-h-[60px] flex items-center gap-3" role="status" aria-live="polite">
            <span className="w-2 h-2 rounded-full bg-vg-red animate-pulse motion-reduce:animate-none" aria-hidden="true" />
            <span className="text-[14px] text-vg-text">Listening</span>
            <span className="font-code text-[12.5px] text-vg-text-3 tabular-nums">
              {String(Math.floor(elapsed / 60)).padStart(1, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <div aria-hidden="true" className="flex-1 h-8 flex items-center gap-[3px] overflow-hidden">
              {WAVE.map((h, i) => (
                <span
                  key={i}
                  className="vg-wave w-[3px] rounded-full bg-vg-accent/80"
                  style={{ height: `${h}px`, animationDelay: `${(i % 8) * 90}ms` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <label className="block px-5 pt-4">
            <span className="sr-only">Question</span>
            <textarea
              ref={taRef}
              rows={variant === 'hero' ? 2 : 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={placeholder}
              className="w-full resize-none bg-transparent outline-none text-[16px] leading-[26px] text-vg-text placeholder:text-vg-text-3"
            />
          </label>
        )}

        <div className="h-14 px-3 flex items-center justify-between">
          {scope && !recording ? (
            <CollectionMenu collections={scope.collections || []} selected={selected} onToggle={toggleCollection} placement={placement} />
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            {recording ? (
              <>
                <button
                  type="button"
                  onClick={voice.onCancel}
                  className={cn('h-9 px-3 rounded-lg flex items-center gap-1.5 text-[13.5px] text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text', focusRing)}
                >
                  <X size={15} aria-hidden="true" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={voice.onSend}
                  className={cn('h-9 px-3 rounded-lg bg-vg-accent text-vg-ink flex items-center gap-1.5 text-[13.5px] font-semibold hover:bg-[#62D3AA]', focusRing)}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                  Send
                </button>
              </>
            ) : (
              <>
                {voice && (
                  <button
                    type="button"
                    aria-label={voice.isProcessing ? 'Transcribing voice question' : 'Start voice question'}
                    onClick={voice.onStart}
                    disabled={busy || voice.isProcessing}
                    className={cn('w-9 h-9 rounded-lg flex items-center justify-center text-vg-text-2 hover:bg-vg-surface-2 hover:text-vg-text disabled:opacity-50 disabled:hover:bg-transparent', focusRing)}
                  >
                    {voice.isProcessing ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Send question"
                  onClick={submit}
                  disabled={!canSend}
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
                    canSend ? 'bg-vg-accent text-vg-ink hover:bg-[#62D3AA]' : 'bg-vg-accent text-vg-ink opacity-40 cursor-not-allowed',
                    focusRing
                  )}
                >
                  {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {voice?.error && (
        <p role="alert" className="mt-2 px-5 text-[13px] text-vg-red">{voice.error}</p>
      )}

      {(scope || model) && (
        <div className="mt-3 px-4 flex items-center justify-between gap-4">
          {scope ? (
            <ScopePicker
              workspaces={scope.workspaces}
              activeWorkspaceId={scope.activeWorkspaceId}
              onSelectWorkspace={scope.onSelectWorkspace}
              scopeMode={scope.scopeMode}
              selectedCollections={selected}
              totalCollections={(scope.collections || []).length}
              onManageWorkspaces={scope.onManageWorkspaces}
              placement={placement}
            />
          ) : (
            <span />
          )}
          {model && <ModelPicker value={model.value} onChange={model.onChange} placement={placement} />}
        </div>
      )}
    </div>
  );
}
