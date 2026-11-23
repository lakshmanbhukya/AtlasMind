import { useState } from 'react';
import { BotAvatar } from 'bot-avatars';

const avatarTypes = ['flower', 'clover', 'circle', 'star'];

/** Placeholder while the server profiles the schema, generates and validates the pipeline. */
export default function PendingTurn({ label = 'Generating pipeline…' }) {
  const [avatarType] = useState(() => avatarTypes[Math.floor(Math.random() * avatarTypes.length)]);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <div className="h-8 flex items-center gap-2.5 text-[15px] text-vg-text-2">
        <BotAvatar type={avatarType} state="working" size={32} interactive={false} aria-hidden="true" />
        {label}
      </div>
      <div aria-hidden="true" className="rounded-xl border border-vg-line-soft bg-vg-surface/60 p-4 flex flex-col gap-2.5">
        {[78, 64, 52].map((w) => (
          <span
            key={w}
            className="h-3 rounded bg-vg-surface-2 vg-shimmer"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}
