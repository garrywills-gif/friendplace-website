'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { askGeorge, speakText, transcribeAudio, type GeorgeStreamEvent } from '@/lib/mcgs-api';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { useGeorgeSession, type GeorgeTurn } from '@/lib/george-session';
import { ActionPreview, type ActionPreviewPayload } from './ActionPreview';
import { ChatText } from './ChatText';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';
import {
  claimPlayback,
  releasePlayback,
  stopCurrentPlayback,
} from '@/lib/mcgs-audio-singleton';

/**
 * The Ask George bottom-sheet. Streaming grounded chat with George.
 *
 * Batch-3 conversation continuity: the transcript is now owned by a
 * session-scoped store (see /app/website/lib/george-session.ts) so
 * Close (\u00D7), page navigation and minimise all preserve the working
 * conversation. Only explicit "New conversation" or logout wipes it.
 */
interface AskGeorgeSheetProps {
  open: boolean;
  initialMessage?: string;
  /**
   * Structured surface context to attach to the first turn triggered
   * by ``initialMessage`` — piped through to the backend so George can
   * answer "summarise this member's history" without asking which
   * member. Consumed exactly once; subsequent user-typed turns don't
   * inherit it (fresh context should be supplied by the surface).
   */
  initialContext?: Record<string, unknown>;
  onClose: () => void;
}

// Local Turn is the same shape as GeorgeTurn from the store; aliased so
// call sites stay short.
type Turn = GeorgeTurn & {
  previews?: ActionPreviewPayload[];
};

export function AskGeorgeSheet({ open, initialMessage, initialContext, onClose }: AskGeorgeSheetProps) {
  // Router for auto-navigation when George says "Opening the X now".
  // See the `navigate` SSE event handler below.
  const router = useRouter();
  // Persistent conversation — survives Close / page nav within the
  // current admin session. Cleared on logout or explicit "New chat".
  const {
    turns,
    chatId,
    setTurns: persistTurns,
    setChatId: persistChatId,
    resetConversation,
    hasConversation,
  } = useGeorgeSession();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  // "New conversation" confirm-dialog visibility.
  const [confirmReset, setConfirmReset] = useState(false);
  // Track new content that arrives while the sheet is minimised so the
  // mini-pill can show a small "unread" indicator. Reset when Garry
  // re-opens the sheet.
  const [unreadWhileMin, setUnreadWhileMin] = useState(0);
  // Sheet no longer owns chatId directly \u2014 the store does. This ref
  // is kept as a fast, non-render read for the streaming callbacks.
  const chatIdRef = useRef<string | null>(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  // Alias so existing setTurns(...) call sites don't have to change.
  const setTurns = persistTurns as unknown as React.Dispatch<React.SetStateAction<Turn[]>>;
  const abortRef = useRef<{ abort: () => void } | null>(null);
  // Voice recorder for the composer mic \u2014 parallels the top Ask bar so
  // Garry gets identical behaviour whether he's talking to George from
  // the header or the sheet composer.
  const rec = useVoiceRecorder({ maxSeconds: 60, silenceSeconds: 3 });
  // Last message the user sent — powers the "Try again" action on a
  // failed / timed-out George turn.
  const lastUserRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Draggable position (Garry, 5 Aug 2026 launch polish — "one George"
  // consistency with GeorgeFloatingChat). Persisted per session so the
  // panel returns to where Garry left it after a route change. Null
  // means "use the default anchor" (bottom-right on desktop, centred
  // bottom on smaller viewports). Same DRAG_HANDLE / clamping rules
  // as GeorgeFloatingChat.
  type Position = { x: number; y: number };
  const [pos, setPos] = useState<Position | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem('ask-george-sheet:pos');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
    } catch {
      /* noop */
    }
    return null;
  });
  const dragRef = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false });

  // ── "Speak replies automatically" toggle (Rank 3, 2026-08-16) ──
  // When ON, George auto-plays each finished reply using the existing
  // Read-Aloud pipeline (same tts-1 route, same prefetch, same Play
  // element). Manual Play remains available in both modes. Preference
  // persists across sessions / reloads via localStorage. Safari
  // autoplay policy: if the browser refuses to auto-start (no active
  // user gesture by the time the reply finishes), the Play button
  // stays visible — the user simply presses it, exactly like today.
  const AUTO_SPEAK_KEY = 'fp:mcgs:auto-speak';
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(AUTO_SPEAK_KEY) === '1'; }
    catch { return false; }
  });
  const toggleAutoSpeak = () => {
    setAutoSpeak(v => {
      const next = !v;
      try { window.localStorage.setItem(AUTO_SPEAK_KEY, next ? '1' : '0'); }
      catch { /* noop */ }
      return next;
    });
  };

  const savePos = (p: Position) => {
    try { window.sessionStorage.setItem('ask-george-sheet:pos', JSON.stringify(p)); } catch { /* noop */ }
  };
  const clampPos = (p: Position): Position => {
    if (typeof window === 'undefined') return p;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Approximate panel size — matches sheetFloat below.
    const PANEL_W = 420;
    const PANEL_H = Math.min(560, Math.round(vh * 0.72));
    const M = 8;
    return {
      x: Math.max(M, Math.min(p.x, vw - PANEL_W - M)),
      y: Math.max(M, Math.min(p.y, vh - PANEL_H - M)),
    };
  };
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only left-click on mouse; ignore other buttons. Touch/pen are
    // fine on any button code.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Do not start a drag when the user clicked a button in the header
    // (Minimise / Close / New). We check up-to-3 ancestors — any of
    // them being a <button> means "this is a control, not the handle".
    let node: HTMLElement | null = target;
    for (let i = 0; i < 3 && node; i += 1) {
      if (node.tagName === 'BUTTON') return;
      node = node.parentElement;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      active: true,
    };
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const next = clampPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
    setPos(next);
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (pos) savePos(pos);
  };

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Ref guard so React 18 StrictMode's double-invocation of effects
  // doesn't dispatch the initial-message chat twice.
  const initialSentRef = useRef<string | null>(null);

  // Send an initial message when the sheet opens with a preloaded prompt.
  // When `initialMessage` is undefined the sheet is being reopened via
  // the "Continue with George" pill \u2014 we just show the stored transcript
  // and let Garry type / speak the next turn.
  useEffect(() => {
    // Guard: never send while busy — prevents a rogue duplicate user turn
    // if a new initialMessage arrives while a stream is in flight.
    if (open && initialMessage && !busy && initialSentRef.current !== initialMessage) {
      initialSentRef.current = initialMessage;
      // Attach the one-shot surface_context to this turn only. Subsequent
      // user-typed turns don't inherit it — surfaces re-supply context on
      // re-entry, which keeps George grounded on the *current* page.
      send(initialMessage, initialContext);
    }
    if (!open) initialSentRef.current = null;
     
  }, [open, initialMessage, busy]);

  // Focus input when opened.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Scroll to bottom on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // Count new George content that arrives while minimised — powers the
  // small dot on the mini-pill so Garry knows there's something new.
  useEffect(() => {
    if (!minimised) return;
    setUnreadWhileMin(n => n + 1);
  }, [turns.length, minimised]);

  // Whenever we re-open (leave minimised), clear the unread counter and
  // scroll to the latest message so Garry lands on fresh content.
  useEffect(() => {
    if (!minimised) {
      setUnreadWhileMin(0);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
        inputRef.current?.focus();
      }, 30);
    }
  }, [minimised]);

  // Auto-grow the composer textarea (up to ~4 rows) as Garry types.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 140); // ~4 lines cap
    el.style.height = `${next}px`;
  }, [input]);

  // Esc minimises the sheet (preserves the conversation) — Close (×) discards.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMinimised(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function send(message: string, surfaceContext?: Record<string, unknown> | null) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput('');
    lastUserRef.current = trimmed;
    // iter163 Bug 1: a new turn is starting — silence any George voice
    // that may still be talking from a previous reply, so the next
    // response's auto-speak doesn't stack over the last one.
    stopCurrentPlayback();

    setTurns(prev => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'george', content: '', streaming: true },
    ]);

    abortRef.current = askGeorge(
      trimmed,
      (ev: GeorgeStreamEvent) => {
        if (ev.kind === 'session' && ev.chat_id) {
          chatIdRef.current = ev.chat_id;
          persistChatId(ev.chat_id);
        } else if (ev.kind === 'plan') {
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, plan: ev.plan }
              : t,
          ));
        } else if (ev.kind === 'tools') {
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, results: ev.results }
              : t,
          ));
        } else if (ev.kind === 'navigate' && ev.path) {
          // George announced "Opening the X now" — actually take Garry
          // there. Fires immediately (60ms) so the click feels like the
          // OS just launched the surface, not a slow bounce (Garry,
          // 6 Aug 2026 QA: navigation should feel immediate).
          //
          // Graceful failure (Garry's suggestion): if router.push
          // silently fails to change the pathname within a reasonable
          // grace window — e.g. a bad route, a guarded surface, or a
          // client-side error — inject an assistant note so George
          // isn't left pretending the navigation succeeded.
          // Trustworthy > perfect.
          //
          // Hardened (Garry, 25 Feb 2026 production bug): the previous
          // 800ms window was too tight and used strict pathname
          // equality, so successful navigations that landed on a
          // slightly-canonicalised path (e.g. redirects, trailing
          // slash normalisation, or Next.js's async router) were
          // being reported as failed. Widened to 2500ms and switched
          // to a startsWith match, so any route below the target
          // counts as arrival.
          const nav = String(ev.path);
          const before = typeof window !== 'undefined' ? window.location.pathname : '';
          setTimeout(() => {
            let pushError: unknown = null;
            let pushed = false;
            try {
              (router as any)?.push?.(nav);
              pushed = true;
            } catch (err) {
              pushError = err;
              try { window.location.assign(nav); pushed = true; } catch (err2) { pushError = err2; pushed = false; }
            }
            // Confirmation window: give the new route ~2500ms to
            // become authoritative before we conclude nav failed.
            setTimeout(() => {
              const after = typeof window !== 'undefined' ? window.location.pathname : '';
              const norm = (p: string) => p.replace(/\/+$/, '') || '/';
              const target = norm(nav);
              const arrivedNow = norm(after);
              // Accept exact match OR any child route (redirects to
              // /admin/campaigns/drafts still count as "arrived at
              // Campaigns"). We only treat the navigation as failed
              // when router.push threw AND we didn't leave the
              // original page.
              const arrived =
                arrivedNow === target ||
                arrivedNow.startsWith(target + '/') ||
                arrivedNow !== norm(before);
              if (!pushed || (pushError && !arrived)) {
                const humanPage = nav.replace(/^\/admin\//, '').replace(/-/g, ' ');
                const note =
                  `I couldn't open ${humanPage} automatically, but you can reach it from the left menu.`;
                try {
                  const failMsg = {
                    id: `nav-fail-${Date.now()}`,
                    role: 'george' as const,
                    content: note,
                    streaming: false,
                    failed: false,
                  };
                  setTurns((prev) => [...prev, failMsg]);
                } catch (err) {
                  console.error('[navigate] fallback insertion failed:', err);
                }
                console.warn('[navigate] silent nav failure', { before, target: nav, after, pushError });
              }
            }, 2500);
          }, 60);
        } else if (ev.kind === 'action_preview') {
          // Attach the preview to the current George turn.
          const preview = ev as unknown as ActionPreviewPayload;
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, previews: [...(t.previews || []), preview] }
              : t,
          ));
        } else if (ev.kind === 'delta') {
          const chunk = ev.text || '';
          if (!chunk) return;
          setTurns(prev => {
            const last = prev[prev.length - 1];
            // Defensive: if for any reason the last turn isn't George's
            // (e.g. a stray tool-result frame slipped in), append a new
            // George turn rather than mutate a user bubble. Prevents any
            // possibility of George's text appearing under Garry's name.
            if (!last || last.role !== 'george') {
              return [...prev, { role: 'george', content: chunk, streaming: true }];
            }
            return prev.map((t, i) =>
              i === prev.length - 1
                ? { ...t, content: t.content + chunk }
                : t,
            );
          });
        } else if (ev.kind === 'error') {
          // Timeout / unreachable server / stream failure. Mark the
          // turn failed so a "Try again" chip appears; `done` follows
          // from the stream helper and unlocks the composer.
          const text = ev.text || 'Something went wrong. Please try again.';
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, streaming: false, failed: true, content: t.content ? `${t.content}\n\n${text}` : text }
              : t,
          ));
        } else if (ev.kind === 'done') {
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? {
                  ...t,
                  streaming: false,
                  // User pressed Stop before any text arrived — leave a
                  // friendly note instead of an empty bubble.
                  content: t.content || 'Stopped \u2014 ask me again whenever you\u2019re ready.',
                }
              : t,
          ));
          setBusy(false);
        }
      },
      chatIdRef.current,
      // Always merge the caller-supplied surfaceContext with the CURRENT
      // MCGS route (Garry, 6 Aug 2026 QA fix — George kept saying "you're
      // already here" when Garry wasn't). Sending `pathname` on every
      // turn lets the backend suppress a navigate-to-current AND lets
      // George's response reflect where Garry actually is.
      (() => {
        const merged: Record<string, unknown> = { ...(surfaceContext || {}) };
        try {
          if (typeof window !== 'undefined') {
            merged.pathname = window.location.pathname;
          }
        } catch { /* noop */ }
        return merged;
      })(),
    );
  }

  // Close (\u00D7) now PRESERVES the conversation. Only aborts any
  // in-flight stream and hides the sheet visually. The transcript
  // persists in the store so the next open resumes the conversation.
  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    // iter163 Bug 1: dispose any playing George clip so navigation /
    // minimise / close never leaves an orphaned voice running in the
    // background.
    stopCurrentPlayback();
    // If we were mid-stream, mark the last George turn as settled so it
    // doesn't render as a blinking cursor when the sheet is reopened.
    setTurns(prev => prev.map((t, i) =>
      i === prev.length - 1 && t.role === 'george' && t.streaming
        ? { ...t, streaming: false }
        : t,
    ));
    setInput('');
    setBusy(false);
    setMinimised(false);
    // Do NOT clear turns / chatId / lastUserRef — that's what
    // "New conversation" is for.
    onClose();
  }

  // Explicit reset. Wired to the "\u21BB New conversation" button in the
  // header and to logout via clearAllGeorgeSessions().
  function handleReset() {
    abortRef.current?.abort();
    abortRef.current = null;
    // iter163 Bug 1: new conversation starts silent — no leftover voice.
    stopCurrentPlayback();
    resetConversation();
    chatIdRef.current = null;
    lastUserRef.current = null;
    setInput('');
    setBusy(false);
    setConfirmReset(false);
    // Focus the composer so Garry can immediately type the first
    // message of the new conversation.
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function retryLast() {
    if (lastUserRef.current) send(lastUserRef.current);
  }

  async function toggleComposerMic() {
    setMicError(null);
    if (rec.recording) {
      const blob = await rec.stop();
      if (!blob) {
        // iter164c: null blob = no speech detected (silence-only clip
        // rejected by the recorder). Warm nudge, input stays intact.
        setMicError("I didn\u2019t catch any speech — the input stays as it was. Try again a little closer to the mic.");
        return;
      }
      try {
        setTranscribing(true);
        const transcript = await transcribeAudio(blob);
        if (!transcript || !transcript.trim()) {
          setMicError("I couldn\u2019t quite catch that. Try again in a quieter spot, or type instead.");
          return;
        }
        setInput(prev => (prev ? prev.trim() + ' ' : '') + transcript);
        // Bring focus back to the textarea so Garry can edit or press Enter.
        setTimeout(() => inputRef.current?.focus(), 30);
      } catch (err) {
        console.error('[composer-voice] transcription failed:', err);
        const msg = (err as Error).message || '';
        if (/took a moment too long|network|fetch|failed to fetch/i.test(msg)) {
          setMicError("The connection hiccupped while I was listening \u2014 please try that again.");
        } else if (/permission|denied/i.test(msg)) {
          setMicError("I need microphone access to hear you \u2014 please allow it in your browser.");
        } else {
          setMicError("Something got in the way while I was listening. You can try again or type instead.");
        }
      } finally {
        setTranscribing(false);
      }
    } else {
      await rec.start();
      if (rec.error) {
        setMicError(
          rec.error.toLowerCase().includes('permission')
            ? "I need microphone access to hear you \u2014 please allow it in your browser."
            : "I couldn\u2019t open the microphone just now. You can type instead, or try again in a moment.",
        );
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends. Shift+Enter for a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  if (!open) return null;

  // Minimised — collapse to a bottom-right pill; conversation is preserved.
  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        style={miniPill}
        aria-label={unreadWhileMin ? `Reopen George \u2014 ${unreadWhileMin} new` : 'Reopen George'}
        title="Reopen George (your conversation is saved)"
      >
        <span style={butterflyBig} aria-hidden>{'\uD83E\uDD8B'}</span>
        <span style={{ fontWeight: 800, fontSize: 14 }}>George</span>
        <span style={{ fontSize: 12, color: '#64748B' }}>
          {turns.length ? `\u00B7 ${turns.length} message${turns.length === 1 ? '' : 's'}` : ''}
        </span>
        {unreadWhileMin > 0 && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              minWidth: 8, height: 8, borderRadius: 8,
              background: '#EF4444', marginLeft: 4,
              boxShadow: '0 0 0 2px #FFFFFF',
              animation: 'unreadBlip 1.6s ease-in-out infinite',
            }}
          />
        )}
        <style>{`
          @keyframes unreadBlip {
            0%,100% { transform: scale(1);   opacity: 1;   }
            50%     { transform: scale(1.4); opacity: 0.7; }
          }
        `}</style>
      </button>
    );
  }

  // Compute the floating panel's on-screen position. When `pos` is
  // null we fall back to a bottom-right anchor; otherwise the user's
  // saved / dragged coordinates take over. Clamping is done in the
  // pointer handlers so viewport resizes don't need to touch state.
  const sheetStyle: React.CSSProperties = pos
    ? { ...sheetFloat, left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : { ...sheetFloat };

  return (
    // NON-modal container: pointer-events pass through to the
    // background so admins can keep working underneath George. The
    // panel itself is a floating, draggable rectangle — one George
    // pattern shared with GeorgeFloatingChat.
    <div style={overlay} aria-hidden={false}>
      <div style={sheetStyle} onClick={e => e.stopPropagation()} role="dialog" aria-label="George — Chief of Staff">
        <div
          style={sheetHeader}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'none' }}>
            <span
              style={butterflyBig}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-hidden
            >
              <GeorgeButterflyMark size={48} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>George</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Chief of staff · drag to move</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {hasConversation && (
              <button
                style={{ ...closeBtn, width: 'auto', padding: '0 10px', fontSize: 13, fontWeight: 700 }}
                onClick={() => setConfirmReset(true)}
                aria-label="Start a new conversation"
                title="Start a new conversation (clears the current one)"
              >
                <span style={{ marginRight: 4 }}>&#8635;</span>
                <span>New</span>
              </button>
            )}
            <button
              style={closeBtn}
              onClick={() => setMinimised(true)}
              aria-label="Minimise George"
              title="Minimise (keeps this conversation)"
            >
              <span style={{ display: 'inline-block', transform: 'translateY(-3px)' }}>&#8211;</span>
            </button>
            <button
              style={closeBtn}
              onClick={handleClose}
              aria-label="Close George"
              title="Close (keeps this conversation \u2014 reopen from the Ask bar)"
            >&times;</button>
          </div>
        </div>

        {/* New-conversation confirm dialog. */}
        {confirmReset && (
          <div
            style={confirmBackdrop}
            onClick={() => setConfirmReset(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Start a new conversation"
          >
            <div style={confirmCard} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#0A2540', marginBottom: 6 }}>
                Start a new conversation?
              </div>
              <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
                {'This will clear the current transcript ('}
                {turns.length}
                {' message'}{turns.length === 1 ? '' : 's'}
                {'). George will still remember what he knows about FriendPlace \u2014 you\u2019ll just be starting fresh with him.'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setConfirmReset(false)}
                  style={confirmCancel}
                >Keep this conversation</button>
                <button
                  onClick={handleReset}
                  style={confirmOk}
                  autoFocus
                >Start fresh</button>
              </div>
            </div>
          </div>
        )}

        <div ref={scrollRef} style={sheetBody}>
          {turns.length === 0 && (
            <div style={{ padding: 24, color: '#64748B', fontSize: 14, lineHeight: 1.6 }}>
              Ask me anything about what needs your attention today.
              I&apos;ll only tell you things I can verify from live data.
              <br /><br />
              Try: <em>&ldquo;What needs my attention?&rdquo;</em>, <em>&ldquo;How many events are awaiting review?&rdquo;</em>, <em>&ldquo;Any safety concerns I should know about?&rdquo;</em>
            </div>
          )}
          {turns.map((t, i) => (
            <ChatBubble key={i} turn={t as Turn} onRetry={retryLast} autoSpeak={autoSpeak} />
          ))}
        </div>

        <div style={sheetFooter}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={rec.recording ? 'Listening\u2026 tap the mic again when you\u2019re done.' : (transcribing ? 'Transcribing\u2026' : 'Type or ask a follow-up\u2026')}
            style={inputStyle}
            rows={1}
            disabled={busy || rec.recording || transcribing}
          />
          {/* Composer mic — same behaviour as the header Ask bar mic. */}
          <button
            type="button"
            onClick={toggleComposerMic}
            disabled={busy || transcribing}
            title={rec.recording ? 'Stop recording' : (transcribing ? 'Transcribing\u2026' : 'Talk to George')}
            style={{
              ...micBtn,
              background: rec.recording ? '#FEE2E2' : (transcribing ? '#F0FDFA' : '#FFFFFF'),
              borderColor: rec.recording ? '#FCA5A5' : (transcribing ? '#5EEAD4' : '#E2E8F0'),
              color: rec.recording ? '#DC2626' : (transcribing ? '#0F766E' : '#64748B'),
              animation: rec.recording ? 'micPulse 1.2s ease-in-out infinite' : 'none',
            }}
            aria-label={rec.recording ? 'Stop recording' : 'Talk to George'}
          >{rec.recording ? '\u23F9' : (transcribing ? '\u2026' : '\uD83C\uDF99\uFE0F')}</button>
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              style={stopBtn}
              title="Stop waiting for this reply"
            >Stop</button>
          ) : (
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim() || rec.recording || transcribing}
              style={{ ...sendBtn, opacity: (!input.trim() || rec.recording || transcribing) ? 0.5 : 1 }}
            >Send</button>
          )}
        </div>
        {/* Speak-replies-automatically toggle — persists across sessions.
            Placed under the composer so it doesn't crowd the drag handle
            or the mic. Uses the existing Read-Aloud pipeline; when off,
            behaviour is exactly the same as before (manual Play). */}
        <button
          type="button"
          onClick={toggleAutoSpeak}
          role="switch"
          aria-checked={autoSpeak}
          title={autoSpeak
            ? 'George will read each reply aloud automatically. Click to turn off.'
            : 'George will only read replies when you press Play. Click to turn on.'}
          style={{
            marginTop: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            border: `1px solid ${autoSpeak ? '#5EEAD4' : '#E2E8F0'}`,
            background: autoSpeak ? '#F0FDFA' : '#FFFFFF',
            color: autoSpeak ? '#0F766E' : '#64748B',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 26,
              height: 14,
              borderRadius: 999,
              background: autoSpeak ? '#14B8A6' : '#CBD5E1',
              position: 'relative',
              transition: 'background 0.15s',
            }}
          >
            <span style={{
              position: 'absolute',
              top: 1,
              left: autoSpeak ? 13 : 1,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#FFFFFF',
              boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
              transition: 'left 0.15s',
            }} />
          </span>
          <span>{autoSpeak ? '🔊' : '🔈'} Speak replies automatically</span>
        </button>
        {micError && (
          <div style={micErrorPop} role="alert">{micError}</div>
        )}
        <style>{`
          @keyframes micPulse {
            0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
            50%     { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
          }
          /* Floating-panel entrance — a tiny lift so the panel doesn't
             feel like it teleports in. Matches GeorgeFloatingChat. */
          @keyframes ask-george-bloom {
            0%   { transform: translateY(6px) scale(0.98); opacity: 0; }
            100% { transform: translateY(0)   scale(1);    opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}

// ---- helpers -----------------------------------------------------------
//
// Matches the end of a "complete sentence" — a sentence-final
// punctuation followed by whitespace or end-of-string. Kept intentionally
// simple: covers ., !, ? and their smart-quote / closing-paren companions.
// We only need "did the model finish at least one sentence?" — not a
// perfect NLP tokeniser. Streaming replies from George almost always land
// clean punctuation before continuing (system prompt encourages plain
// prose).
const FIRST_SENTENCE_RE = /[.!?][\s"'\u201D\u2019)\]]*(\s|$)/;

function ChatBubble({ turn, onRetry, autoSpeak = false }: { turn: Turn; onRetry?: () => void; autoSpeak?: boolean }) {
  const isUser = turn.role === 'user';
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track how much of the clip we actually played. Batch-4 QA feedback:
  // one longer response cut off part-way through. We now log the played
  // vs total duration and, if we played < 80%, resurface the button as
  // "Try again" so Garry can recover without hunting for a control.
  const playedDurationRef = useRef<number>(0);
  const totalDurationRef  = useRef<number>(0);

  // ---- TTS PREFETCH STATE (Iter155 latency fix, Rank 1) ------------------
  // Restored 14 Aug 2026 after the 5-minute revert on 7 Aug 2026 that
  // rolled back the mid-stream prefetch design. All Batch 2 / 4 / 6 Safari,
  // truncation and handler-nulling protections below are preserved.
  //
  // Mirror of audioUrl usable inside async callbacks without stale closures.
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  // The currently in-flight prefetch, or null when idle. Carries the text
  // the request was launched for AND its AbortController so we can cancel
  // it if the LLM keeps streaming past that text (multi-sentence replies).
  const inFlightRef = useRef<{ text: string; promise: Promise<string>; controller: AbortController } | null>(null);
  // Text the current audioUrl blob was synthesised from — used to detect
  // when a growing streamed reply has invalidated an earlier prefetch.
  const prefetchedForRef = useRef<string>('');
  // Guards against re-firing the "early during streaming" prefetch on
  // every token that arrives. We fire at most once per bubble while the
  // stream is still open; the stream-end path handles the "content grew
  // after first sentence" case (early request is aborted so the late
  // call replaces it, still satisfying "single in-flight").
  const attemptedEarlyRef = useRef<boolean>(false);

  // Iter155 latency fix (Rank 1) — kick off the TTS prefetch as soon as
  // the FIRST complete sentence is streamed in (not 120 ms after the whole
  // reply finishes). For the 1-sentence replies George typically produces,
  // the early text == final text, so the audio is generated in parallel
  // with the LLM stream and is often ready by the time the Play button
  // appears.
  //
  // For rarer multi-sentence replies the early prefetch is ABORTED the
  // moment we notice the streamed text has grown past what it was fired
  // for, and a fresh call is issued with the full content. This keeps
  // the "single in-flight" invariant AND avoids doing 2× TTS work.
  useEffect(() => {
    if (isUser || turn.failed) return;
    if (!turn.content) return;
    // Fast path: we already have a blob that matches the current text.
    if (audioUrl && prefetchedForRef.current === turn.content) return;

    // If an earlier "early" prefetch is running for a shorter text, and
    // the LLM has now produced more content, cancel it so we can refire
    // with the correct text. This is what stops multi-sentence replies
    // from spending two full TTS budgets serially.
    const cur = inFlightRef.current;
    if (cur && cur.text !== turn.content) {
      // Abort only when the streamed text has grown past what the
      // in-flight was fired for. Length is a cheap heuristic; the full
      // streaming pattern is monotonic-append so length strictly grows.
      if (turn.content.length > cur.text.length) {
        try { cur.controller.abort(); } catch { /* noop */ }
        inFlightRef.current = null;
      }
    }
    // Something is already generating for the exact text we'd request —
    // do not fire a duplicate.
    if (inFlightRef.current && inFlightRef.current.text === turn.content) return;
    // A stale in-flight (shorter text) is still running AND we haven't
    // decided to abort yet (see the guard above). Wait for it to finish
    // before firing a new call.
    if (inFlightRef.current) return;

    // Decide whether to fire, and with what text.
    let candidate: string | null = null;
    if (!turn.streaming) {
      // Stream just ended (or was already ended). Fire with full content.
      candidate = turn.content;
    } else if (!attemptedEarlyRef.current && FIRST_SENTENCE_RE.test(turn.content)) {
      // First complete sentence has arrived — fire early with what we
      // have so far. Mark so subsequent token arrivals don't re-trigger.
      candidate = turn.content;
      attemptedEarlyRef.current = true;
    }
    if (!candidate) return;

    const forText = candidate;
    const controller = new AbortController();
    // Kick off the actual request. speakText uses the same fetchWithRetry
    // path — nothing about the request shape changes (tts-1, ash,
    // speed 1.05, mp3, /api/george/voice/speak).
    const promise = (async () => {
      const blob = await speakText(forText, 'george', 1.05, controller.signal);
      return URL.createObjectURL(blob);
    })();
    inFlightRef.current = { text: forText, promise, controller };

    promise
      .then((url) => {
        // If a fresher blob has been stored while we were in flight
        // (shouldn't happen given the single-in-flight guard, but be
        // defensive), revoke ours to avoid leaking.
        if (audioUrlRef.current && audioUrlRef.current !== url) {
          try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* noop */ }
        }
        setAudioUrl(url);
        prefetchedForRef.current = forText;
      })
      .catch((err) => {
        // Aborted (because the stream extended past our input) — swallow
        // silently, the follow-up prefetch or the play() path will surface
        // any real error. Any other error is also silent by design; play()
        // is the user-visible failure point.
        void err;
      })
      .finally(() => {
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = null;
        }
      });
  }, [isUser, turn.streaming, turn.failed, turn.content, audioUrl]);

  // Free the last blob URL when the bubble unmounts so long conversations
  // don't accumulate object URLs. (Previously we only revoked on truncation
  // recovery; the prefetch rewrite means we can leak more of these.)
  useEffect(() => () => {
    if (audioUrlRef.current) {
      try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* noop */ }
    }
    // iter163 Bug 1: if this bubble was the one currently holding
    // the playback singleton, release it so a re-mount can't leak
    // a stale reference to a detached <audio> element.
    if (audioRef.current) {
      releasePlayback(audioRef.current);
    }
  }, []);

  // ── Auto-speak (Rank 3, 2026-08-16) ─────────────────────────────
  // Fire play() exactly once per bubble when:
  //   • autoSpeak preference is ON
  //   • this bubble is a completed (non-streaming) George reply
  //   • the prefetched audio for the FULL final text is ready
  // The prefetch effect above already synthesises the clip in
  // parallel with streaming, so by the time this condition is true
  // there's normally no perceptible latency between reply-finish
  // and speech-start.
  //
  // Safari autoplay caveat: play() may reject silently if the tab
  // has no active user gesture (i.e. Garry sent a message > ~30s
  // ago). We swallow that — the Play button stays available so he
  // can trigger playback manually, exactly like today. No new UI
  // state, no error toast.
  const autoPlayFiredRef = useRef(false);
  useEffect(() => {
    if (isUser || turn.failed || turn.streaming || !turn.content) return;
    if (!autoSpeak) return;
    if (autoPlayFiredRef.current) return;
    if (!audioUrl || prefetchedForRef.current !== turn.content) return;
    if (playing || preparing) return;
    autoPlayFiredRef.current = true;
    // Fire and forget — play() handles its own error state.
    void play();
  }, [autoSpeak, audioUrl, turn.content, turn.streaming, turn.failed, isUser, playing, preparing]);

  async function play() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    setPlayFailed(false);
    // iter163 Bug 1: BEFORE anything else, stop and dispose any other
    // George clip that may still be talking. Without this, a rapid
    // second reply's auto-speak (or a manual replay on a different
    // bubble) can leave 2-3 voices audible at once. Firing this here
    // and again just before el.play() (after the SILENT_WAV unlock)
    // means auto-speak, manual replay and stream-interrupt all funnel
    // through the same single-owner registry.
    stopCurrentPlayback();
    // Instant visual feedback \u2014 button flips to a spinner + "Preparing audio\u2026"
    // caption before any network work happens. Batch-2 QA feedback: the
    // silent gap after tapping Play made the UI feel broken.
    setPreparing(true);
    // Safari autoplay policy: play() is only allowed while the click's
    // user activation is alive \u2014 which an `await fetch` destroys. So we
    // create the element synchronously inside the gesture and, when we
    // still need to download the audio, "unlock" the element by playing
    // a tiny silent clip within the gesture. After that, playing the
    // real audio post-await is permitted.
    const el = audioRef.current || new Audio();
    // Batch-4 truncation defence: force full preload so a long clip
    // isn't abandoned mid-stream by an over-aggressive browser.
    el.preload = 'auto';
    audioRef.current = el;
    // Batch-6 fix (Garry, 6 Aug 2026 MCGS QA): "Play only speaks the
    // first word or two." Root cause: the SILENT_WAV Safari-unlock
    // clip below fires `onended` on the AUDIO ELEMENT after ~0.5s,
    // and any stale `onended` handler from a previous play cycle was
    // then interpreted as the REAL audio finishing early — the state
    // machine flipped `playing=false` while the actual speech was
    // still loading. Belt-and-braces: null out every event handler on
    // the element before we touch it so nothing stale can fire.
    el.onended = null;
    el.onpause = null;
    el.onerror = null;
    el.onstalled = null;
    el.ontimeupdate = null;
    el.onloadedmetadata = null;
    el.onplaying = null;
    try {
      let url = audioUrl;
      // A cached blob may cover only the first-sentence prefetch text
      // if this bubble is a multi-sentence reply and the late prefetch
      // hasn't landed yet. Treat that as "no blob" so we don't play a
      // truncated clip. prefetchedForRef is the text the current blob
      // was synthesised from.
      if (url && prefetchedForRef.current !== turn.content) {
        url = null;
      }
      if (!url) {
        try {
          el.src = SILENT_WAV;
          await el.play();
          el.pause();
        } catch { /* some browsers reject the silent clip; harmless */ }
        // Rank 1 dedup: if a prefetch is already in flight for the
        // current turn text, join it rather than firing a second
        // request. If it's in flight for a shorter (early) text we do
        // NOT join — that would give Garry a truncated clip. We
        // fire a fresh call in that rare case; the "single in-flight"
        // invariant is preserved on the prefetch side and this Play
        // path may legitimately overlap once, to guarantee full-text
        // playback.
        const inflight = inFlightRef.current;
        if (inflight && inflight.text === turn.content) {
          try {
            url = await inflight.promise;
          } catch {
            url = null;
          }
        }
        if (!url) {
          // Persona key — backend maps "george" → ash (warm male, tts-1).
          // Never send a raw voice id from here; server enforces the map.
          const blob = await speakText(turn.content, 'george', 1.05);
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
          prefetchedForRef.current = turn.content;
        }
      }
      el.src = url;
      // Batch-4: instrument every playback so we can catch truncation.
      const finalise = (reason: string) => {
        const played = playedDurationRef.current;
        const total  = totalDurationRef.current;
        const ratio  = total > 0 ? played / total : 1;
        setPlaying(false);
        setPreparing(false);
        // iter163 Bug 1: playback finished (ended, errored, or was
        // stopped from the outside) — release the singleton so a
        // future claimPlayback from any other bubble starts clean.
        releasePlayback(el);
        // "Truncated" ~= stopped before 80% AND didn't pause on purpose.
        // Manual pause is caught earlier in the `if (playing)` branch,
        // so if we're here it's an unexpected stop.
        if (reason !== 'manual' && total > 2 && ratio < 0.8) {
          console.warn('[read-aloud] audio ended early:', {
            reason, playedSeconds: played.toFixed(2),
            totalSeconds: total.toFixed(2), ratio: ratio.toFixed(2),
            chars: turn.content.length,
          });
          setPlayFailed(true);
          // Discard the (potentially truncated) blob so "Try again"
          // fetches a fresh clip rather than replaying the short one.
          if (audioUrl) {
            try { URL.revokeObjectURL(audioUrl); } catch { /* noop */ }
            setAudioUrl(null);
          }
        }
      };
      el.onended    = () => finalise('ended');
      el.onpause    = () => {
        // A pause with (currentTime === duration) is really an "ended"
        // (already handled by onended). Only treat it as user pause
        // when we haven't reached the end.
        if (el.duration && Math.abs((el.currentTime || 0) - el.duration) < 0.05) return;
        setPlaying(false);
        setPreparing(false);
        // iter163 Bug 1: user paused — release the singleton so a
        // sibling bubble can claim it without our onStopped racing.
        releasePlayback(el);
      };
      el.onerror         = () => finalise('error');
      el.onstalled       = () => console.warn('[read-aloud] audio stalled', el.src);
      el.ontimeupdate    = () => { playedDurationRef.current = el.currentTime || 0; };
      el.onloadedmetadata = () => { totalDurationRef.current = el.duration || 0; };
      el.onplaying       = () => { setPreparing(false); setPlaying(true); };
      playedDurationRef.current = 0;
      totalDurationRef.current  = 0;
      // iter163 Bug 1: register this <audio> as the sole George voice
      // now allowed to be audible. If another bubble was still holding
      // the slot after our earlier stopCurrentPlayback() (e.g. because
      // an in-flight prefetch finished and started auto-speak while we
      // awaited above), this call disposes it and fires its onStopped
      // callback so its "⏸ Stop" button reverts to "▶︎ Play".
      claimPlayback(el, () => {
        setPlaying(false);
        setPreparing(false);
      });
      await el.play();
      // Fallback in case `onplaying` didn't fire (some browsers).
      setPreparing(false);
      setPlaying(true);
    } catch (err) {
      console.error('[read-aloud] failed:', err);
      setPreparing(false);
      setPlaying(false);
      setPlayFailed(true);
      // Bin any partly-loaded blob URL so a Try-Again refetches cleanly
      // rather than replaying whatever half-cached bytes are there.
      if (audioUrl) {
        try { URL.revokeObjectURL(audioUrl); } catch { /* noop */ }
        setAudioUrl(null);
      }
    }
  }
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 24px',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 16, flexShrink: 0,
        background: isUser ? '#E2E8F0' : '#FFFFFF',
        border: isUser ? 'none' : '1px solid #E2E8F0',
        color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16,
      }}>{isUser ? '👤' : <GeorgeButterflyMark size={24} />}</div>
      <div style={{
        maxWidth: '78%',
        background: isUser ? '#F1F5F9' : '#F0FDFA',
        border: isUser ? '1px solid #E2E8F0' : '1px solid #CCFBF1',
        borderRadius: 16, padding: '12px 16px',
        fontSize: 15, lineHeight: 1.55, color: '#0F172A',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {turn.content
          ? (isUser
              ? turn.content
              : <ChatText content={turn.content} />)
          : (turn.streaming ? <em style={{ color: '#64748B' }}>George is thinking\u2026</em> : null)}
        {!isUser && turn.streaming && turn.content && (
          <span style={{ display: 'inline-block', width: 6, height: 14, background: '#14B8A6', marginLeft: 4, verticalAlign: '-2px', animation: 'blink 1s steps(2, start) infinite' }} />
        )}
        {!isUser && turn.previews && turn.previews.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {turn.previews.map((p, i) => (
              <ActionPreview key={i} preview={p} />
            ))}
          </div>
        )}
        {!isUser && turn.failed && !turn.streaming && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={onRetry}
              style={retryBtn}
              aria-label="Try that question again"
            >↻ Try again</button>
          </div>
        )}
        {!isUser && !turn.streaming && !turn.failed && (
          <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: '#64748B' }}>
            <button
              type="button"
              onClick={play}
              disabled={!turn.content || preparing}
              title={
                playFailed ? 'Try playing again'
                : preparing ? 'Preparing audio\u2026'
                : playing ? 'Stop'
                : 'Play with George\u2019s voice'
              }
              style={{
                ...playBtn,
                opacity: turn.content ? 1 : 0.35,
                cursor: turn.content && !preparing ? 'pointer' : 'not-allowed',
                minWidth: 92,
              }}
              aria-label={
                playFailed ? 'Try playing again'
                : preparing ? 'Preparing audio'
                : playing ? 'Stop audio'
                : 'Play with George\u2019s voice'
              }
              aria-busy={preparing ? 'true' : 'false'}
            >
              {playFailed ? '\u21BB Try again'
                : preparing ? (<>
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block', width: 10, height: 10,
                        borderRadius: '50%', border: '2px solid #14B8A6',
                        borderTopColor: 'transparent',
                        marginRight: 6, verticalAlign: '-1px',
                        animation: 'playSpin 0.7s linear infinite',
                      }}
                    />
                    {'Preparing\u2026'}
                  </>)
                : playing ? '\u23F8 Stop'
                : '\u25B6\uFE0E Play'
              }
            </button>
            {playFailed && (
              <span style={{ color: '#B91C1C' }}>
                I couldn&rsquo;t play that just now &mdash; tap Try again.
              </span>
            )}
            {/* "Grounded in N tool results" footer removed (Garry,
                5 Aug 2026 launch polish). Grounding stays internal —
                admins shouldn't see the plumbing. The `results` array
                is still kept in state for future debug affordances,
                but the UI no longer surfaces it. */}
            <style>{`
              @keyframes playSpin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- styles ----

// Minimal silent WAV used to unlock <audio> inside the click gesture
// on Safari (see ChatBubble.play).
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const overlay: React.CSSProperties = {
  // Transparent non-modal container. `pointer-events: none` lets clicks
  // pass through to the background so admins can keep working with the
  // panel open. The panel itself re-enables pointer events. Matches
  // the GeorgeFloatingChat behaviour so both chats feel identical.
  position: 'fixed', inset: 0, background: 'transparent',
  pointerEvents: 'none',
  zIndex: 1100,
};
// Default anchor when the user hasn't dragged. Bottom-right on desktop
// keeps George out of the way of the primary content. Position is
// switched to a free floating rectangle the moment the header is
// dragged (see sheetStyle above).
const sheetFloat: React.CSSProperties = {
  position: 'fixed', right: 24, bottom: 24,
  width: 'min(420px, calc(100vw - 32px))',
  height: 'min(560px, 72vh)',
  background: '#FFFFFF',
  borderRadius: 18,
  border: '1px solid #E2E8F0',
  boxShadow: '0 20px 44px rgba(15,23,42,0.24)',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
  pointerEvents: 'auto',
  animation: 'ask-george-bloom 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
};
const sheet = sheetFloat; // kept for anything still referencing the old name.
const sheetHeader: React.CSSProperties = {
  padding: '14px 20px',
  borderBottom: '1px solid #F1F5F9',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  // Grab-cursor over the whole header — makes the drag affordance
  // discoverable. Buttons inside intercept on their own so this is
  // safe. Touch-action:none lets pointer events on iPad drive the
  // drag instead of scrolling the page beneath.
  cursor: 'grab',
  touchAction: 'none',
  userSelect: 'none',
  background: 'linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)',
};
const sheetBody: React.CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8,
};
const sheetFooter: React.CSSProperties = {
  padding: '14px 20px 16px',
  borderTop: '1px solid #F1F5F9',
  display: 'flex', gap: 8, alignItems: 'flex-end',
  background: '#FFFFFF',
  // Ensure the footer stays anchored even when the textarea grows.
  flexShrink: 0,
};
const butterflyBig: React.CSSProperties = {
  fontSize: 28, lineHeight: 1,
  filter: 'drop-shadow(0 2px 4px rgba(20,184,166,0.35))',
};
const closeBtn: React.CSSProperties = {
  fontSize: 22, background: 'transparent', border: 'none',
  cursor: 'pointer', color: '#64748B', padding: 4, borderRadius: 8,
};
const inputStyle: React.CSSProperties = {
  flex: 1, resize: 'none', minHeight: 44, maxHeight: 140,
  border: '1px solid #E2E8F0', borderRadius: 12, padding: '11px 14px',
  fontSize: 15, lineHeight: 1.4, fontFamily: 'inherit', outline: 'none',
  background: '#F8FAFC',
  // Prevent horizontal scroll jitter on long words.
  wordBreak: 'break-word', overflowY: 'auto',
};
const micBtn: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 12,
  border: '1px solid #E2E8F0', background: '#FFFFFF',
  fontSize: 18, cursor: 'pointer', color: '#64748B',
};
const sendBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', border: 'none', fontWeight: 800,
  fontSize: 14, cursor: 'pointer',
};
const playBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 8,
  background: '#FFFFFF', border: '1px solid #CCFBF1',
  color: '#0F766E', fontWeight: 700, fontSize: 12,
};
const retryBtn: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 8,
  background: '#FFFFFF', border: '1px solid #FECACA',
  color: '#B91C1C', fontWeight: 700, fontSize: 12, cursor: 'pointer',
};
const stopBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12,
  background: '#FFF1F2', border: '1px solid #FECACA',
  color: '#B91C1C', fontWeight: 800, fontSize: 14, cursor: 'pointer',
};
const miniPill: React.CSSProperties = {
  position: 'fixed', bottom: 16, right: 16, zIndex: 1100,
  display: 'inline-flex', alignItems: 'center', gap: 10,
  padding: '10px 16px', borderRadius: 999,
  background: '#FFFFFF', border: '1px solid #CCFBF1',
  boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
  cursor: 'pointer', fontFamily: 'inherit',
};
const micErrorPop: React.CSSProperties = {
  position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
  background: '#7F1D1D', color: '#FEF2F2',
  padding: '10px 14px', borderRadius: 10, fontSize: 13,
  maxWidth: 460, textAlign: 'center',
  boxShadow: '0 8px 24px rgba(15,23,42,0.24)',
};
const confirmBackdrop: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 1200,
  background: 'rgba(15,23,42,0.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20,
};
const confirmCard: React.CSSProperties = {
  width: '100%', maxWidth: 420, background: '#FFFFFF',
  borderRadius: 16, padding: '20px 22px',
  boxShadow: '0 20px 50px rgba(15,23,42,0.28)',
  fontFamily: 'inherit',
};
const confirmCancel: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 10,
  border: '1.5px solid #CBD5E1', background: '#FFFFFF',
  color: '#0A2540', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const confirmOk: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 10,
  border: 'none', background: 'linear-gradient(135deg,#14B8A6,#0EA5A0)',
  color: '#FFFFFF', fontSize: 13, fontWeight: 800,
  cursor: 'pointer', fontFamily: 'inherit',
  boxShadow: '0 6px 16px rgba(20,184,166,0.35)',
};