import { useRef, useState } from 'react';
import { EllipsisVertical, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { focusRing } from '../ui/vg/primitives';
import { Menu, MenuItem, MenuSeparator } from './Menu';

/** ⋮ button + menu for a history row: Rename, Pin/Unpin, Delete. */
export default function RowMenu({ title, pinned, onRename, onTogglePin, onDelete, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  const set = (v) => {
    setOpen(v);
    onOpenChange?.(v);
  };
  const choose = (fn) => () => {
    set(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Options for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          set(!open);
        }}
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md items-center justify-center',
          open
            ? 'flex text-vg-text bg-vg-surface-2'
            : 'hidden group-hover:flex group-focus-within:flex text-vg-text-2 hover:bg-vg-surface-2',
          focusRing
        )}
      >
        <EllipsisVertical size={16} aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => set(false)}
        anchorRef={btnRef}
        label={`Options for ${title}`}
        className="right-1 top-[40px] w-[176px]"
      >
        <MenuItem icon={Pencil} onSelect={choose(onRename)}>Rename</MenuItem>
        <MenuItem icon={pinned ? PinOff : Pin} onSelect={choose(onTogglePin)}>{pinned ? 'Unpin' : 'Pin'}</MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onSelect={choose(onDelete)}>Delete</MenuItem>
      </Menu>
    </>
  );
}
