'use client';

import { useEffect, useRef, useState } from 'react';
import { askGeorge, speakText, type GeorgeStreamEvent } from '@/lib/mcgs-api';
import { ActionPreview, type ActionPreviewPayload } from './ActionPreview';

/**
 * The Ask George bottom-sheet. Streaming grounded chat with George.
 * Voice-ready: mic button and TTS play button are already in the
 * layout, disabled until Milestone E ships. The bar and sheet share
 * the same input model so voice will slot in without a redesign.
 */
interface AskGeorgeSheetProps {
  open: boolean;
  initialMessage?: string;
  onClose: () => void;
}

interface Turn {
  role: 'user' | 'george';
  content: string;
  streaming?: boolean;
  plan?: unknown;
  results?: unknown;
  previews?: ActionPreviewPayload[];
}

export function AskGeorgeSheet({ open, initialMessage, onClose }: AskGeorgeSheetProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const chatIdRef = useRef<string | null>(null);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Ref guard so React 18 StrictMode's double-invocation of effects
  // doesn't dispatch the initial-message chat twice.
  const initialSentRef = useRef<string | null>(null);

  // Send an initial message when the sheet opens with a preloaded prompt.
  useEffect(() => {
    if (open && initialMessage && initialSentRef.current !== initialMessage) {
      initialSentRef.current = initialMessage;
      send(initialMessage);
    }
    if (!open) initialSentRef.current = null;
     
  }, [open, initialMessage]);

  // Focus input when opened.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // Scroll to bottom on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput('');

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
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, content: t.content + chunk }
              : t,
          ));
        } else if (ev.kind === 'done') {
          setTurns(prev => prev.map((t, i) =>
            i === prev.length - 1 && t.role === 'george'
              ? { ...t, streaming: false }
              : t,
          ));
          setBusy(false);
        }
      },
      chatIdRef.current,
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends. Shift+Enter for a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  if (!open) return null;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={sheetHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={butterflyBig}>🦋</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>George</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>Chief of staff · grounded in live data</div>
            </div>
          </div>
          <button style={closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

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
            <ChatBubble key={i} turn={t} />
          ))}
        </div>

        <div style={sheetFooter}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type or ask a follow-up…"
            style={inputStyle}
            rows={1}
            disabled={busy}
          />
          {/* Voice-ready controls — disabled until Milestone E ships. */}
          <button
            type="button"
            disabled
            title="Voice input coming in the next milestone"
            style={{ ...micBtn, opacity: 0.35, cursor: 'not-allowed' }}
            aria-label="Voice input (coming soon)"
          >🎙️</button>
          <button
            type="button"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            style={{ ...sendBtn, opacity: busy || !input.trim() ? 0.5 : 1 }}
          >Send</button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user';
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function play() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      let url = audioUrl;
      if (!url) {
        const blob = await speakText(turn.content, 'nova', 0.95);
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
      const el = audioRef.current || new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => setPlaying(false);
      el.onpause = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch (err) {
      console.error(err);
      setPlaying(false);
      // Graceful voice-playback fallback \u2014 the reply text is still fully
      // readable, so we just note quietly and let the user try again.
      alert("I couldn\u2019t play that just now \u2014 the reply is still on screen if you\u2019d like to read it.");
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
        {!isUser && !turn.streaming && (
          <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: '#64748B' }}>
            <button
              type="button"
              onClick={play}
              disabled={!turn.content}
              title={playing ? 'Stop' : 'Play with George\u2019s voice'}
              style={{ ...playBtn, opacity: turn.content ? 1 : 0.35, cursor: turn.content ? 'pointer' : 'not-allowed' }}
              aria-label={playing ? 'Stop audio' : 'Play with George\u2019s voice'}
            >{playing ? '⏸ Stop' : '▶︎ Play'}</button>
            {Array.isArray(turn.results) && turn.results.length > 0 && (
              <span title={JSON.stringify(turn.results, null, 2)}>
                Grounded in {turn.results.length} tool result{turn.results.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- styles ----
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
};
const sheetHeader: React.CSSProperties = {
  padding: '16px 24px', borderBottom: '1px solid #F1F5F9',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const sheetBody: React.CSSProperties = {
  flex: 1, overflowY: 'auto', paddingBottom: 8,
};
const sheetFooter: React.CSSProperties = {
  padding: '14px 20px', borderTop: '1px solid #F1F5F9',
  display: 'flex', gap: 8, alignItems: 'flex-end',
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
  flex: 1, resize: 'none', minHeight: 40, maxHeight: 120,
  border: '1px solid #E2E8F0', borderRadius: 12, padding: '10px 14px',
  fontSize: 15, fontFamily: 'inherit', outline: 'none', background: '#F8FAFC',
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
