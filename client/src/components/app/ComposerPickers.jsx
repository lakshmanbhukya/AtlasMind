import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Folder, Layers, Settings2 } from 'lucide-react';
import { cn, workspaceId } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { AVAILABLE_MODELS } from '../../lib/models';
import { Menu, MenuItem, MenuSeparator, MenuLabel } from './Menu';

/** "Sales workspace  orders, customers, products ⌄" — picks All collections or a saved workspace. */
export function ScopePicker({
  workspaces = [],
  activeWorkspaceId,
  onSelectWorkspace,
  scopeMode,
  selectedCollections = [],
  totalCollections = 0,
  onManageWorkspaces,
  placement = 'top',
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const active = useMemo(() => workspaces.find((w) => workspaceId(w) === activeWorkspaceId) || null, [workspaces, activeWorkspaceId]);

  let name = 'All collections';
  let detail = totalCollections ? `${totalCollections} collections` : '';
  if (active) {
    name = active.name;
    detail = (scopeMode === 'selected' && selectedCollections.length ? selectedCollections : active.collections || []).join(', ');
  } else if (scopeMode === 'selected' && selectedCollections.length) {
    name = 'Selected collections';
    detail = selectedCollections.join(', ');
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('max-w-full min-h-8 px-1 rounded-md flex items-center gap-2 text-[14px] text-vg-text hover:text-white', focusRing)}
      >
        <span className="sr-only">Query scope:</span>
        <span className="shrink-0">{name}</span>
        {detail && <span className="min-w-0 truncate text-vg-text-3">{detail}</span>}
        <ChevronDown size={13} className="shrink-0 text-vg-text-3" aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        label="Query scope"
        className={cn('left-0 w-[300px] max-h-[360px] overflow-y-auto', placement === 'top' ? 'bottom-10' : 'top-10')}
      >
        <MenuItem
          role="menuitemradio"
          checked={!activeWorkspaceId && scopeMode !== 'selected'}
          icon={Layers}
          onSelect={() => {
            onSelectWorkspace(null, []);
            setOpen(false);
          }}
          hint={!activeWorkspaceId && scopeMode !== 'selected' ? <Check size={14} className="text-vg-accent" aria-hidden="true" /> : null}
        >
          All collections
          {totalCollections > 0 && <span className="ml-2 text-[12px] text-vg-text-3">{totalCollections}</span>}
        </MenuItem>
        {workspaces.length > 0 && <MenuLabel>Workspaces</MenuLabel>}
        {workspaces.map((w) => {
          const on = workspaceId(w) === activeWorkspaceId;
          return (
            <MenuItem
              key={workspaceId(w)}
              role="menuitemradio"
              checked={on}
              icon={Folder}
              onSelect={() => {
                onSelectWorkspace(workspaceId(w), w.collections || []);
                setOpen(false);
              }}
              hint={on ? <Check size={14} className="text-vg-accent" aria-hidden="true" /> : null}
            >
              <span className="block truncate">{w.name}</span>
              <span className="block truncate text-[12px] text-vg-text-3">{(w.collections || []).join(', ')}</span>
            </MenuItem>
          );
        })}
        <MenuSeparator />
        <MenuItem
          icon={Settings2}
          onSelect={() => {
            setOpen(false);
            onManageWorkspaces?.();
          }}
        >
          Manage workspaces
        </MenuItem>
      </Menu>
    </div>
  );
}

/** "GPT OSS 120B ⌄" */
export function ModelPicker({ value, onChange, placement = 'top' }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const current = AVAILABLE_MODELS.find((m) => m.id === value) || AVAILABLE_MODELS[0];

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('min-h-8 px-1 rounded-md flex items-center gap-1.5 text-[14px] text-vg-text hover:text-white', focusRing)}
      >
        <span className="sr-only">Model:</span>
        {current.name}
        <ChevronDown size={13} className="text-vg-text-3" aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        label="Model"
        className={cn('right-0 w-[280px]', placement === 'top' ? 'bottom-10' : 'top-10')}
      >
        {AVAILABLE_MODELS.map((m) => {
          const on = m.id === current.id;
          return (
            <MenuItem
              key={m.id}
              role="menuitemradio"
              checked={on}
              onSelect={() => {
                onChange(m.id);
                setOpen(false);
              }}
              hint={on ? <Check size={14} className="text-vg-accent" aria-hidden="true" /> : null}
            >
              <span className="block">{m.name}</span>
              <span className="flex gap-2 text-[12px] text-vg-text-3">
                <span>{m.vendor}</span>
                <span className="text-vg-text-2">{m.speed}</span>
              </span>
            </MenuItem>
          );
        })}
      </Menu>
    </div>
  );
}
