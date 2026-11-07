import { Mic } from 'lucide-react';
import { timeLabel } from '../../lib/turnFormat';

/** The user's question: right-aligned bubble with its time. Voice questions get a mic glyph. */
export default function UserTurn({ message }) {
  const time = timeLabel(message.timestamp);
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(600px,85%)] flex flex-col items-end gap-1.5">
        <p className="px-4 py-3 rounded-2xl rounded-br-md bg-vg-surface-2 text-[15px] leading-[22px] text-vg-text break-words">
          {message.isVoice && (
            <Mic size={14} className="inline-block mr-2 -mt-0.5 text-vg-text-3" aria-label="Voice question" />
          )}
          {message.content}
        </p>
        {time && (
          <time className="text-[12px] text-vg-text-3 pr-1" dateTime={new Date(message.timestamp).toISOString()}>
            {time}
          </time>
        )}
      </div>
    </div>
  );
}
