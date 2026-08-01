'use client';

/**
 * GeorgeConversation — the shared conversational surface.
 *
 * George is a platform, not a feature. This is the one component that
 * renders George's conversation. Mission Control, the FriendPlace
 * website, and (soon) the mobile app all mount THIS component. The
 * *surrounding* application decides:
 *   - who the user is
 *   - what permissions they have
 *   - what defaults are available (via the backend)
 *   - where the completed action is routed
 *   - what happens after confirmation (via `chrome`).
 *
 * George does NOT decide who can publish. He asks FriendPlace — the
 * backend's `outcome` field on the approve response tells the UI
 * whether the event went live (`published`) or off for a review by
 * the FriendPlace team (`submitted_for_review`), and the success
 * screen reads the correct warm line accordingly.
 *
 * Locked with Garry, 19 July 2026:
 *   - Warm colleague voice. Never a form. Never a checklist.
 *   - Rule 1: start with excitement.
 *   - Rule 2: show George working.
 *   - Rule 3: celebrate completion BEFORE the Action Preview.
 *   - Rule 4: explain his thinking naturally.
 *   - Rule 5: forgive mind changes gracefully.
 *   - Editing is conversational; the field-level `Advanced edit` panel is a quiet escape hatch.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  eventCreationApi,
  type EventSession,
  type EventTurn,
  type EventDraft,
  type EventApprovalResult,
} from '@/lib/george-api';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';

// ---- Surface chrome ------------------------------------------------------

/**
 * Everything a hosting surface can customise WITHOUT touching the
 * conversation engine itself. Nothing here changes George's voice or
 * behaviour — only the room he's sitting in.
 */
export interface GeorgeConversationChrome {
  /** Where the small "leave" link at the bottom of the chat sends you. */
  onLeave: () => void;
  /**
   * What to do after a successful create. Each entry becomes a button
   * on the success screen. Pass `null` to hide the success screen and
   * navigate immediately (used by embedded surfaces).
   */
  successActions?: Array<{ label: string; onSelect: () => void }>;
  /** Text shown next to the "leave" link. Defaults to a generic phrase. */
  leaveLabel?: string;
  /**
   * Optional override of the success line. Rarely needed — the outcome
   * already selects the right role-aware phrasing. Provide this only if
   * the surface wants to say something specific (e.g. mobile toast).
   */
  successLine?: (result: EventApprovalResult) => string;
}

export interface GeorgeConversationProps {
  /** Optional seed text (e.g. from a query param). */
  seedMessage?: string;
  /** Surface-specific bits. */
  chrome: GeorgeConversationChrome;
}

// ---- Component -----------------------------------------------------------

export function GeorgeConversation({ seedMessage, chrome }: GeorgeConversationProps) {
  const [session, setSession] = useState<EventSession | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [workingLabel, setWorkingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [advancedEdits, setAdvancedEdits] = useState<Partial<EventDraft>>({});
  const [approving, setApproving] = useState(false);
  const [approvedResult, setApprovedResult] = useState<EventApprovalResult | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [input]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session?.turns.length, workingLabel]);

  useEffect(() => {
    if (seedMessage && seededRef.current !== seedMessage) {
      seededRef.current = seedMessage;
      void start(seedMessage);
    }
  }, [seedMessage]);

  async function start(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true); setError(null);
    setWorkingLabel(pickThinkingLine(true));
    try {
      const s = await eventCreationApi.start(trimmed);
      setSession(s); setInput('');
    } catch (e) {
      setError((e as Error).message || 'Could not start the conversation.');
    } finally {
      setBusy(false); setWorkingLabel(null);
    }
  }

  async function reply(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !session) return;
    const optimistic: EventTurn = { role: 'user', content: trimmed, at: new Date().toISOString() };
    const previous = session;
    setSession({ ...previous, turns: [...previous.turns, optimistic] });
    setInput(''); setBusy(true); setError(null);
    setWorkingLabel(pickThinkingLine());
    try {
      const s = await eventCreationApi.turn(previous.session_id, trimmed);
      setSession(s);
    } catch (e) {
      setSession(previous);
      setError((e as Error).message || "George couldn't reply just then. Try again in a moment.");
    } finally {
      setBusy(false); setWorkingLabel(null);
    }
  }

  async function confirmCreate() {
    if (!session) return;
    setApproving(true); setError(null);
    try {
      const cleanEdits = advanced
        ? Object.fromEntries(
            Object.entries(advancedEdits).filter(([, v]) => v !== undefined && v !== ''),
          )
        : undefined;
      const result = await eventCreationApi.approve(
        session.session_id,
        cleanEdits && Object.keys(cleanEdits).length ? cleanEdits : undefined,
      );
      setApprovedResult(result);
    } catch (e) {
      setError((e as Error).message || "I couldn't create the event just then. Try again.");
    } finally {
      setApproving(false);
    }
  }

  async function leave() {
    if (session && session.status !== 'approved') {
      try { await eventCreationApi.cancel(session.session_id); } catch { /* ignore */ }
    }
    chrome.onLeave();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!session) void start(input);
      else void reply(input);
    }
  }

  const draft = session?.draft || null;
  const ready = session?.status === 'drafted' && !!draft;

  // ---- success ----
  if (approvedResult) {
    return (
      <SuccessScreen
        result={approvedResult}
        overrideLine={chrome.successLine?.(approvedResult)}
        actions={chrome.successActions}
        onCreateAnother={() => {
          setSession(null); setInput(''); setApprovedResult(null);
          setAdvanced(false); setAdvancedEdits({});
          seededRef.current = null;
        }}
      />
    );
  }

  return (
    <div style={pageWrap}>
      <div style={chatCol}>
        <div ref={scrollRef} style={scrollArea}>
          {!session && (
            <EmptyState onPick={(t) => start(t)} />
          )}
          {session && session.turns.map((t, i) => (
            <ChatTurn key={i} turn={t} />
          ))}
          {busy && workingLabel && <WorkingRow label={workingLabel} />}
          {ready && draft && (
            <ActionPreviewCard
              draft={draft}
              advanced={advanced}
              advancedEdits={advancedEdits}
              onAdvancedChange={setAdvancedEdits}
              onToggleAdvanced={() => setAdvanced(v => !v)}
              approving={approving}
              onConfirm={confirmCreate}
              onMakeChanges={() => inputRef.current?.focus()}
            />
          )}
          {error && <div style={errorBanner}>{error}</div>}
        </div>

        <div style={composerBar}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={session
              ? (ready ? 'Say something like: "Actually, move it to Saturday."' : 'Reply to George…')
              : 'Try: I’d like to run a bowls evening on 5 December at 10am at the community hall.'}
            style={textInput}
            rows={1}
            disabled={busy || approving}
            aria-label="Message to George"
          />
          <button
            type="button"
            onClick={() => (session ? reply(input) : start(input))}
            disabled={busy || approving || !input.trim()}
            style={{ ...sendBtn, opacity: busy || approving || !input.trim() ? 0.55 : 1 }}
            className="cms-btn-primary"
          >
            {session ? 'Send' : 'Start with George'}
          </button>
        </div>

        <div style={quitRow}>
          <button type="button" onClick={leave} style={quitBtn} aria-label="Leave this conversation">
            {chrome.leaveLabel || 'Leave this conversation'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- sub-components ------------------------------------------------------

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div style={emptyState}>
      <div style={butterflyBig}><GeorgeButterflyMark size={64} /></div>
      <h2 style={{ fontSize: 22, letterSpacing: '-0.01em', color: '#0F172A', margin: '10px 0 6px' }}>
        Let&rsquo;s create something.
      </h2>
      <p style={{ fontSize: 15, color: '#475569', margin: 0, lineHeight: 1.6, maxWidth: 520 }}>
        Tell me about the event you&rsquo;d like to put together &mdash;
        a name, a date, roughly when, where it is. I&rsquo;ll gather
        the rest as we go.
      </p>
      <div style={promptChips}>
        {SUGGESTED_STARTS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            style={chipBtn}
            className="cms-btn-ghost"
          >{s}</button>
        ))}
      </div>
    </div>
  );
}

function ChatTurn({ turn }: { turn: EventTurn }) {
  const isUser = turn.role === 'user';
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 4px',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 18, flexShrink: 0,
        background: isUser ? '#E2E8F0' : '#FFFFFF',
        border: isUser ? 'none' : '1px solid #E2E8F0',
        color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17,
      }}>{isUser ? '👤' : <GeorgeButterflyMark size={26} />}</div>
      <div style={{
        maxWidth: '80%',
        background: isUser ? '#FFFFFF' : '#CCFBF1',
        border: isUser ? '1px solid #E2E8F0' : '1px solid #5EEAD4',
        borderRadius: 16, padding: '12px 16px',
        fontSize: 15, lineHeight: 1.55, color: '#0F172A',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {!isUser && turn.excitement_line && (
          <div style={{ fontSize: 13, color: '#0F766E', fontWeight: 700, marginBottom: 6 }}>
            {turn.excitement_line}
          </div>
        )}
        {turn.content || <em style={{ color: '#64748B' }}>&hellip;</em>}
      </div>
    </div>
  );
}

function WorkingRow({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 4px', alignItems: 'center' }}>
      <div style={{
        width: 34, height: 34, borderRadius: 18,
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 17,
      }}><GeorgeButterflyMark size={26} /></div>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center',
        background: '#CCFBF1', border: '1px solid #5EEAD4',
        borderRadius: 16, padding: '10px 14px',
        fontSize: 14, color: '#0F766E', fontStyle: 'italic',
      }}>
        <TypingDots />
        <span>{label}</span>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 3 }}>
      <span style={dot(0)} /><span style={dot(0.15)} /><span style={dot(0.3)} />
      <style>{`@keyframes fp-bounce { 0%,80%,100%{ transform: translateY(0); opacity: .4;} 40%{ transform: translateY(-4px); opacity: 1;} }`}</style>
    </span>
  );
}
function dot(delay: number): React.CSSProperties {
  return {
    width: 6, height: 6, borderRadius: 3, background: '#14B8A6',
    display: 'inline-block',
    animation: `fp-bounce 1.2s ${delay}s infinite ease-in-out`,
  };
}

function ActionPreviewCard({
  draft, advanced, advancedEdits, onAdvancedChange, onToggleAdvanced,
  approving, onConfirm, onMakeChanges,
}: {
  draft: EventDraft;
  advanced: boolean;
  advancedEdits: Partial<EventDraft>;
  onAdvancedChange: (e: Partial<EventDraft>) => void;
  onToggleAdvanced: () => void;
  approving: boolean;
  onConfirm: () => void;
  onMakeChanges: () => void;
}) {
  const dateStr = useMemo(() => formatFriendlyDate(draft.date, draft.time), [draft.date, draft.time]);
  return (
    <div style={previewWrap}>
      <div style={previewHeader}>
        <span style={{ fontSize: 20 }}>{draft.emoji || '🎉'}</span>
        <span>George&rsquo;s draft &mdash; have a look</span>
      </div>
      <div style={previewBody}>
        <div style={previewTitle}>{draft.title || 'Untitled event'}</div>
        {dateStr && <div style={previewDate}>{dateStr}</div>}
        {draft.location && <div style={previewLoc}>{draft.location}</div>}
        {(draft.capacity || draft.audience) && (
          <div style={previewMeta}>
            {draft.capacity ? <span>{draft.capacity} people</span> : null}
            {draft.capacity && draft.audience ? <span style={sep}>·</span> : null}
            {draft.audience ? <span>{draft.audience}</span> : null}
          </div>
        )}
        {draft.price && <div style={previewPrice}>{draft.price}</div>}
        {draft.description && (
          <div style={previewDesc}>&ldquo;{draft.description}&rdquo;</div>
        )}
        {draft.sources && draft.sources.length > 0 && (
          <details style={sourcesWrap}>
            <summary style={sourcesSummary}>Why George chose these details</summary>
            <ul style={sourcesList}>
              {draft.sources.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: '#334155' }}>{s.field}</span> &mdash; {s.source}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div style={previewActions}>
        <button
          type="button"
          className="cms-btn-primary"
          onClick={onConfirm}
          disabled={approving}
          style={{ ...primaryBtn, opacity: approving ? 0.7 : 1 }}
          aria-label="Confirm and create the event"
        >
          {approving ? 'Creating…' : '✓ Confirm & Create'}
        </button>
        <button
          type="button"
          className="cms-btn-ghost"
          onClick={onMakeChanges}
          disabled={approving}
          style={ghostBtn}
          aria-label="Continue the conversation to make changes"
        >
          ✏️ Make Changes
        </button>
      </div>
      <div style={{ textAlign: 'center', marginTop: 6 }}>
        <button type="button" onClick={onToggleAdvanced} style={advancedLink}>
          {advanced ? 'Hide advanced edit' : 'Advanced edit'}
        </button>
      </div>

      {advanced && (
        <div style={advancedPanel}>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
            Only use this if there&rsquo;s something you&rsquo;d rather change by hand. Chatting with George is usually easier.
          </div>
          <AdvField label="Title" value={advancedEdits.title ?? draft.title ?? ''}
            onChange={v => onAdvancedChange({ ...advancedEdits, title: v })} />
          <AdvField label="Location" value={advancedEdits.location ?? draft.location ?? ''}
            onChange={v => onAdvancedChange({ ...advancedEdits, location: v })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <AdvField label="Date (YYYY-MM-DD)" value={advancedEdits.date ?? draft.date ?? ''}
              onChange={v => onAdvancedChange({ ...advancedEdits, date: v })} />
            <AdvField label="Time (HH:MM)" value={advancedEdits.time ?? draft.time ?? ''}
              onChange={v => onAdvancedChange({ ...advancedEdits, time: v })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <AdvField
              label="Capacity"
              value={String(advancedEdits.capacity ?? draft.capacity ?? '')}
              onChange={v => onAdvancedChange({ ...advancedEdits, capacity: v ? Number(v) : undefined })}
            />
            <AdvField label="Audience" value={advancedEdits.audience ?? draft.audience ?? ''}
              onChange={v => onAdvancedChange({ ...advancedEdits, audience: v })} />
          </div>
          <AdvField label="Description" value={advancedEdits.description ?? draft.description ?? ''}
            onChange={v => onAdvancedChange({ ...advancedEdits, description: v })} textarea />
        </div>
      )}
    </div>
  );
}

function AdvField({ label, value, onChange, textarea }: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>{label}</div>
      {textarea ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className="cms-textarea" style={advInput} />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} className="cms-input" style={advInput} />
      )}
    </label>
  );
}

function SuccessScreen({
  result, overrideLine, actions, onCreateAnother,
}: {
  result: EventApprovalResult;
  overrideLine?: string;
  actions?: Array<{ label: string; onSelect: () => void }>;
  onCreateAnother: () => void;
}) {
  const title = result.target?.title || 'Your event';
  const published = result.outcome === 'published';

  // Role-aware, permission-driven wording. George doesn't decide who can
  // publish — he reflects the outcome the backend returned.
  const headline = published
    ? 'Your event is live.'
    : 'Off to the FriendPlace team.';

  const line = overrideLine
    ?? (published
      ? `I've added ${title} to today's activity. Have a lovely time with it.`
      : `I've sent ${title} to the FriendPlace team for a quick look. I'll let you know as soon as it's live.`);

  return (
    <div style={successWrap}>
      <div style={successCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><GeorgeButterflyMark size={44} /></div>
        <h2 style={{ fontSize: 22, margin: '10px 0 6px', color: '#0F172A', letterSpacing: '-0.01em' }}>
          {headline}
        </h2>
        <p style={{ fontSize: 15, color: '#334155', margin: 0, lineHeight: 1.55 }}>
          {line}
        </p>
        <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 22px' }}>&mdash; George</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {(actions || []).map(a => (
            <button key={a.label} className="cms-btn-primary" style={a.label.toLowerCase().startsWith('back') ? primaryBtn : ghostBtn} onClick={a.onSelect}>
              {a.label}
            </button>
          ))}
          <button className="cms-btn-ghost" style={ghostBtn} onClick={onCreateAnother}>
            Create another
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- helpers -------------------------------------------------------------

const SUGGESTED_STARTS = [
  "I\u2019d like to run a Christmas bowls evening on 5 December.",
  "Help me plan a coffee morning next Wednesday.",
  "Let\u2019s organise a beginners\u2019 walking group for over-60s.",
];

const WORKING_LINES = [
  "Just noting the details you\u2019ve given me…",
  "Checking your usual times and venues…",
  "Putting the pieces together…",
  "Having a think about what fits best…",
];
const FIRST_WORKING = [
  "Lovely \u2014 let me take that in…",
  "Ah, that sounds like fun. Give me a second…",
  "I love this. Let me sketch it out…",
];
function pickThinkingLine(first = false) {
  const pool = first ? FIRST_WORKING : WORKING_LINES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function formatFriendlyDate(date?: string, time?: string): string | null {
  if (!date) return time ? `at ${time}` : null;
  try {
    const d = new Date(date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return `${date}${time ? ' \u00b7 ' + time : ''}`;
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const s = d.toLocaleDateString('en-AU', opts);
    return time ? `${s} \u00b7 ${time}` : s;
  } catch {
    return `${date}${time ? ' \u00b7 ' + time : ''}`;
  }
}

// ---- styles --------------------------------------------------------------

const pageWrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto', padding: '10px 0 60px' };
const chatCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const scrollArea: React.CSSProperties = {
  minHeight: '55vh', maxHeight: 'calc(100vh - 300px)',
  overflowY: 'auto', padding: '10px 4px',
};
const emptyState: React.CSSProperties = {
  padding: '30px 12px 18px', textAlign: 'center',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
};
const butterflyBig: React.CSSProperties = {
  fontSize: 48, lineHeight: 1,
  filter: 'drop-shadow(0 4px 10px rgba(20,184,166,0.35))',
};
const promptChips: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18,
};
const chipBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 999,
  fontSize: 13, fontWeight: 600,
  background: '#FFFFFF', border: '1px solid #CBD5E1',
  color: '#0F172A', cursor: 'pointer',
};
const composerBar: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-end', padding: '12px 14px',
  background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16,
  boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
};
const textInput: React.CSSProperties = {
  flex: 1, resize: 'none', minHeight: 42, maxHeight: 140,
  border: 'none', outline: 'none',
  fontSize: 15, fontFamily: 'inherit', background: 'transparent',
  color: '#0F172A', padding: '6px 4px',
};
const sendBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', border: 'none', fontWeight: 800,
  fontSize: 14, cursor: 'pointer',
};
const quitRow: React.CSSProperties = { textAlign: 'center', marginTop: 8 };
const quitBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 12, color: '#94A3B8', cursor: 'pointer', textDecoration: 'underline',
};
const previewWrap: React.CSSProperties = {
  marginTop: 12, marginBottom: 16,
  background: 'linear-gradient(180deg,#F0FDFA 0%,#FFFFFF 100%)',
  border: '1px solid #14B8A6', borderRadius: 18, padding: 20,
  boxShadow: '0 8px 24px rgba(20,184,166,0.12)',
};
const previewHeader: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: '#0F766E',
  display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12,
};
const previewBody: React.CSSProperties = { paddingBottom: 10 };
const previewTitle: React.CSSProperties = {
  fontSize: 24, fontWeight: 800, color: '#0F172A',
  letterSpacing: '-0.01em', lineHeight: 1.15,
};
const previewDate: React.CSSProperties = { fontSize: 15, color: '#0F766E', fontWeight: 700, marginTop: 6 };
const previewLoc: React.CSSProperties = { fontSize: 14, color: '#334155', marginTop: 4 };
const previewMeta: React.CSSProperties = {
  fontSize: 13, color: '#475569', marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap',
};
const sep: React.CSSProperties = { color: '#CBD5E1' };
const previewPrice: React.CSSProperties = { fontSize: 13, color: '#475569', marginTop: 4, fontStyle: 'italic' };
const previewDesc: React.CSSProperties = {
  fontSize: 14, color: '#334155', marginTop: 10, lineHeight: 1.55,
  padding: '10px 12px', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10,
};
const sourcesWrap: React.CSSProperties = { marginTop: 12 };
const sourcesSummary: React.CSSProperties = { fontSize: 12, color: '#64748B', cursor: 'pointer' };
const sourcesList: React.CSSProperties = {
  fontSize: 12, color: '#475569', marginTop: 8, paddingLeft: 18, lineHeight: 1.5,
};
const previewActions: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const primaryBtn: React.CSSProperties = {
  padding: '12px 22px', borderRadius: 12,
  background: 'linear-gradient(135deg,#14B8A6,#0F766E)',
  color: '#FFFFFF', border: 'none', fontWeight: 800,
  fontSize: 15, cursor: 'pointer', flex: '1 1 220px',
  boxShadow: '0 6px 16px rgba(20,184,166,0.25)',
};
const ghostBtn: React.CSSProperties = {
  padding: '12px 22px', borderRadius: 12,
  background: '#FFFFFF', border: '1px solid #CBD5E1',
  color: '#0F172A', fontWeight: 700, fontSize: 15,
  cursor: 'pointer', flex: '1 1 180px',
};
const advancedLink: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 12, color: '#94A3B8', textDecoration: 'underline', cursor: 'pointer',
};
const advancedPanel: React.CSSProperties = {
  marginTop: 14, padding: 14,
  background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 12,
};
const advInput: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid #E2E8F0', borderRadius: 8,
  fontSize: 14, background: '#FFFFFF', color: '#0F172A',
  fontFamily: 'inherit', outline: 'none',
};
const errorBanner: React.CSSProperties = {
  margin: '10px 4px', padding: '10px 14px',
  background: '#FEF2F2', border: '1px solid #FECACA',
  borderRadius: 10, color: '#991B1B', fontSize: 13,
};
const successWrap: React.CSSProperties = { maxWidth: 640, margin: '80px auto 0', padding: '0 20px' };
const successCard: React.CSSProperties = {
  padding: '32px 28px', textAlign: 'center',
  background: 'linear-gradient(180deg,#F0FDFA 0%,#FFFFFF 100%)',
  border: '1px solid #14B8A6', borderRadius: 20,
  boxShadow: '0 16px 40px rgba(20,184,166,0.15)',
};
