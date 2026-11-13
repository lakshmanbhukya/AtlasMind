import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { useVoice } from '../../hooks/useVoice';
import { pinToDashboard } from '../../services/api';
import { questionOf, answerableClarificationId } from '../../lib/conversation';
import { cn } from '../../lib/utils';
import Composer from './Composer';
import EmptyState from './EmptyState';
import UserTurn from './UserTurn';
import AnswerTurn from './AnswerTurn';
import ClarificationTurn from './ClarificationTurn';
import ApprovalTurn from './ApprovalTurn';
import BlockedTurn from './BlockedTurn';
import ScopeTurn from './ScopeTurn';
import ErrorTurn from './ErrorTurn';
import PendingTurn from './PendingTurn';

const HIGHLIGHT = ['ring-2', 'ring-vg-accent', 'ring-offset-8', 'ring-offset-vg-bg', 'rounded-2xl'];

/**
 * The conversation: empty-state home, or the turn list with a docked composer.
 * Follow-ups stack in the current session thread; a history item replays as one turn.
 */
export default function ChatThread({
  connectionMeta,
  schema,
  highlightedMessageId,
  onQuerySuccess,
  onPinAdded,
  scope,
}) {
  const {
    messages,
    pending,
    selectedModel,
    setSelectedModel,
    sendMessage,
    sendVoiceMessage,
    approveWrite,
    discardApproval,
  } = useChat(highlightedMessageId, onQuerySuccess);
  const { isRecording, startRecording, stopRecording, cancelRecording, error: voiceError } = useVoice();
  const [draft, setDraft] = useState(null);
  const endRef = useRef(null);

  const busy = pending !== null;
  const voicePending = pending === 'voice';
  const dbName = connectionMeta?.dbName || 'your database';

  // Keep the newest turn in view. A finished response is aligned by its top, so a tall answer
  // reads from its title instead of being scrolled past to its end; while waiting, follow the bottom.
  // Keyed on the last message's identity so in-place updates (discard, approval error) don't scroll.
  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id;
  const lastIsAssistant = lastMessage?.role === 'assistant';
  useEffect(() => {
    if (highlightedMessageId) return;
    const answerEl = !busy && lastIsAssistant ? document.getElementById(`msg-${lastId}`) : null;
    if (answerEl) answerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lastId, lastIsAssistant, busy, highlightedMessageId]);

  // A history item was opened: briefly ring its answer.
  useEffect(() => {
    if (!highlightedMessageId) return undefined;
    const el = document.getElementById(`msg-assistant-${highlightedMessageId}`);
    if (!el) return undefined;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add(...HIGHLIGHT);
    const t = setTimeout(() => el.classList.remove(...HIGHLIGHT), 2200);
    return () => clearTimeout(t);
  }, [highlightedMessageId, messages]);

  // Request scope for the current selection; the server resolves the Effective Scope from it.
  const buildScopeOptions = useCallback(() => {
    const opts = {};
    if (scope.scopeMode === 'selected' && scope.selectedCollections?.length > 0) opts.collections = scope.selectedCollections;
    if (scope.activeWorkspaceId) opts.workspaceId = scope.activeWorkspaceId;
    return opts;
  }, [scope.scopeMode, scope.selectedCollections, scope.activeWorkspaceId]);

  const ask = useCallback((text) => sendMessage(text, buildScopeOptions()), [sendMessage, buildScopeOptions]);

  const handleClarify = (msg) => (clarifications) =>
    sendMessage(questionOf(msg), { ...buildScopeOptions(), clarifications, skipUserMessage: true });
  const handleBypass = (msg) => () =>
    sendMessage(questionOf(msg), { ...buildScopeOptions(), bypassAmbiguity: true, skipUserMessage: true });

  const handleScopeAdd = (msg) => async (cols) => {
    const updated = Array.from(new Set([...(scope.selectedCollections || []), ...(msg.scope || []), ...cols]));
    scope.onSetCollections(updated);
    scope.onChangeScopeMode('selected');
    await sendMessage(questionOf(msg), { collections: updated, skipUserMessage: true });
  };
  const handleScopeAll = (msg) => async () => {
    scope.onSelectWorkspace(null, []);
    await sendMessage(questionOf(msg), { collections: [], skipUserMessage: true });
  };

  const handlePin = useCallback(async (pin) => {
    await pinToDashboard(pin);
    onPinAdded?.();
  }, [onPinAdded]);

  // Voice: Send transcribes and runs; Cancel discards the recording.
  const voiceSend = async () => {
    const blob = await stopRecording();
    if (!blob) return;
    await sendVoiceMessage(blob, buildScopeOptions());
  };

  // The newest clarification is the only one still answerable.
  const answerableId = answerableClarificationId(messages);

  const composer = (
    <Composer
      variant={messages.length === 0 ? 'hero' : 'dock'}
      placeholder={
        messages.length === 0
          ? `Ask a question about ${dbName}`
          : messages[messages.length - 1]?.kind === 'clarification'
            ? `Ask something else about ${dbName}`
            : `Ask a follow-up about ${dbName}`
      }
      onSubmit={ask}
      busy={busy}
      draft={draft}
      onDraftConsumed={() => setDraft(null)}
      voice={{
        isRecording,
        isProcessing: voicePending,
        error: voiceError,
        onStart: startRecording,
        onCancel: cancelRecording,
        onSend: voiceSend,
      }}
      scope={scope}
      model={{ value: selectedModel, onChange: setSelectedModel }}
    />
  );

  if (messages.length === 0 && !busy) {
    return (
      <EmptyState
        name={connectionMeta?.label}
        schema={schema}
        composer={composer}
        onSuggestion={ask}
      />
    );
  }

  const renderAssistant = (msg) => {
    switch (msg.kind) {
      case 'clarification':
        return (
          <ClarificationTurn
            message={msg}
            onSubmit={handleClarify(msg)}
            onBypass={handleBypass(msg)}
            isLoading={busy}
            answered={msg.id !== answerableId}
          />
        );
      case 'scope':
        return <ScopeTurn message={msg} onAddAndRerun={handleScopeAdd(msg)} onRunAll={handleScopeAll(msg)} isLoading={busy} />;
      case 'approval':
        return (
          <ApprovalTurn
            message={msg}
            dbName={connectionMeta?.dbName}
            isLoading={busy}
            onApprove={() => approveWrite(msg.id, msg.approvalToken)}
            onDiscard={() => discardApproval(msg.id)}
            onAskAgain={() => ask(questionOf(msg))}
          />
        );
      case 'blocked':
        return <BlockedTurn message={msg} onEditQuestion={setDraft} />;
      case 'error':
        return (
          <ErrorTurn
            message={msg}
            disabled={busy}
            onRetry={msg.naturalLanguage ? () => sendMessage(msg.naturalLanguage, { ...buildScopeOptions(), ...(msg.retryOptions || {}), skipUserMessage: true }) : undefined}
          />
        );
      default:
        return <AnswerTurn message={msg} onPin={handlePin} />;
    }
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <section
        aria-label="Conversation"
        className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--vg-line)_transparent]"
      >
        <div className="w-full max-w-[920px] mx-auto px-4 sm:px-6 pt-5 pb-6 flex flex-col">
          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            const gap = i === 0 ? '' : msg.role === 'assistant' && prev?.role === 'user' ? 'mt-6' : 'mt-10';
            return (
              <div key={msg.id} id={`msg-${msg.id}`} className={cn(gap, 'scroll-mt-5 transition-shadow duration-500')}>
                {msg.role === 'user' ? <UserTurn message={msg} /> : renderAssistant(msg)}
              </div>
            );
          })}
          {busy && (
            <div className={messages.length ? 'mt-6' : ''}>
              <PendingTurn label={voicePending ? 'Transcribing and generating pipeline…' : 'Generating pipeline…'} />
            </div>
          )}
          {/* Clearance for the floating composer; also the scroll anchor, so the newest turn lands above it. */}
          <div ref={endRef} aria-hidden="true" className="h-[200px] shrink-0" />
        </div>
      </section>
      {/* Composer floats over the thread; the fade keeps content readable behind it without a hard edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 pt-16 pb-6 px-4 flex flex-col items-center"
        style={{
          background:
            'linear-gradient(to top, var(--vg-bg) 45%, color-mix(in srgb, var(--vg-bg) 85%, transparent) 70%, transparent)',
        }}
      >
        <div className="pointer-events-auto w-full flex flex-col items-center">{composer}</div>
      </div>
    </div>
  );
}
