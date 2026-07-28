'use client';

import { useEffect, useRef, useState } from 'react';
import { askGeorge, speakText, transcribeAudio, type GeorgeStreamEvent } from '@/lib/mcgs-api';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { useGeorgeSession, type GeorgeTurn } from '@/lib/george-session';
import { ActionPreview, type ActionPreviewPayload } from './ActionPreview';

/**
 * The Ask George bottom-sheet. Streaming grounded chat with George.
 *
 * Batch-3 conversation continuity: the transcript is now owned by a
 * session-scoped store (see /app/website/lib/george-session.ts) so
 * Close (\u00D7), page navigation and minimise all preserve the working
 * conversation. Only explicit \"New conversation\" or logout wipes it.
 */
interface AskGeorgeSheetProps {
  open: boolean;
  initialMessage?: string;
  onClose: () => void;
}

// Local Turn is the same shape as GeorgeTurn from the store; aliased so
// call sites stay short.
type Turn = GeorgeTurn & {
  previews?: ActionPreviewPayload[];
};

export function AskGeorgeSheet({ open, initialMessage, onClose }: AskGeorgeSheetProps) {
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
      send(initialMessage);
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

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput('');
    lastUserRef.current = trimmed;

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
    );
  }

  // Close (\u00D7) now PRESERVES the conversation. Only aborts any
  // in-flight stream and hides the sheet visually. The transcript
  // persists in the store so the next open resumes the conversation.
  function handleClose() {
    abortRef.current?.abort();
    abortRef.current = null;
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
        setMicError("Nothing recorded yet \u2014 give it another go when you\u2019re ready.");
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
        <span style={butterflyBig} aria-hidden>\uD83E\uDD8B</span>
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

  return (
    <div style={overlay} onClick={() => setMinimised(true)}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={sheetHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={butterflyBig}>🦋</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>George</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Chief of staff · grounded in live data</div>
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
                This will clear the current transcript ({turns.length} message{turns.length === 1 ? '' : 's'}).
                George will still remember what he knows about FriendPlace \u2014 you\u2019ll just be starting fresh with him.
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
            <ChatBubble key={i} turn={t as Turn} onRetry={retryLast} />
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
        {micError && (
          <div style={micErrorPop} role="alert">{micError}</div>
        )}
        <style>{`
          @keyframes micPulse {
            0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
            50%     { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
          }
        `}</style>
      </div>
    </div>
  );
}

function ChatBubble({ turn, onRetry }: { turn: Turn; onRetry?: () => void }) {
  const isUser = turn.role === 'user';
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Batch-3 responsiveness: quietly prefetch the mp3 as soon as George
  // has finished streaming this bubble. By the time Garry taps Play the
  // clip is almost always already in memory \u2014 tap-to-audio is instant.
  useEffect(() => {
    if (isUser) return;
    if (turn.streaming || turn.failed) return;
    if (!turn.content) return;
    if (audioUrl) return;
    let cancelled = false;
    // Small stagger so we don\u2019t launch the prefetch inside the same
    // microtask that finalises the stream \u2014 gives React a beat to paint.
    const timer = window.setTimeout(async () => {
      try {
        const blob = await speakText(turn.content, 'george', 1.05);
        if (cancelled) return;
        setAudioUrl(URL.createObjectURL(blob));
      } catch {
        // Silent \u2014 the on-demand path in play() will surface the error
        // if Garry actually taps Play.
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isUser, turn.streaming, turn.failed, turn.content, audioUrl]);

  async function play() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    setPlayFailed(false);
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
    audioRef.current = el;
    try {
      let url = audioUrl;
      if (!url) {
        try {
          el.src = SILENT_WAV;
          await el.play();
          el.pause();
        } catch { /* some browsers reject the silent clip; harmless */ }
        // Persona key \u2014 backend maps "george" \u2192 ash (warm male, tts-1-hd).
        // Never send a raw voice id from here; server enforces the map.
        const blob = await speakText(turn.content, 'george', 1.05);
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
      el.src = url;
      el.onended   = () => { setPlaying(false); setPreparing(false); };
      el.onpause   = () => { setPlaying(false); setPreparing(false); };
      el.onplaying = () => { setPreparing(false); setPlaying(true); };
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
        background: isUser ? '#E2E8F0' : 'linear-gradient(135deg,#14B8A6,#38BDF8)',
        color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16,
      }}>{isUser ? '👤' : '🦋'}</div>
      <div style={{
        maxWidth: '78%',
        background: isUser ? '#F1F5F9' : '#F0FDFA',
        border: isUser ? '1px solid #E2E8F0' : '1px solid #CCFBF1',
        borderRadius: 16, padding: '12px 16px',
        fontSize: 15, lineHeight: 1.55, color: '#0F172A',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {turn.content || (turn.streaming ? <em style={{ color: '#64748B' }}>George is thinking…</em> : null)}
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
                    Preparing\u2026
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
            {Array.isArray(turn.results) && turn.results.length > 0 && (
              <span title={JSON.stringify(turn.results, null, 2)}>
                Grounded in {turn.results.length} tool result{turn.results.length === 1 ? '' : 's'}
              </span>
            )}
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
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  zIndex: 1100,
};
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 780, height: '72vh', background: '#FFFFFF',
  borderTopLeftRadius: 20, borderTopRightRadius: 20,
  boxShadow: '0 -12px 40px rgba(15,23,42,0.18)',
  display: 'flex', flexDirection: 'column',
  position: 'relative', // so the mic-error pop and future overlays anchor here
  overflow: 'hidden',
};
const sheetHeader: React.CSSProperties = {
  padding: '16px 24px', borderBottom: '1px solid #F1F5F9',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
