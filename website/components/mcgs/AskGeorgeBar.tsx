'use client';

import { useEffect, useRef, useState } from 'react';
import { AskGeorgeSheet } from './AskGeorgeSheet';

/**
 * The Ask George bar — persistent at the top of every MCGS screen.
 * Built voice-ready from day one: the microphone button and
 * transcription indicator are already laid out; they'll wire up in
 * Milestone E without any layout changes.
 *
 * Keyboard: ⌘K / Ctrl+K focuses the bar from anywhere.
 */
export function AskGeorgeBar() {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
  const [voiceHint, setVoiceHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Any surface in MCGS can open George by dispatching a custom event.
  // Keeps George available system-wide without prop-drilling.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      submit(detail?.message);
    };
    window.addEventListener('mcgs:ask-george', onAsk as EventListener);
    return () => window.removeEventListener('mcgs:ask-george', onAsk as EventListener);
     
  }, []);

  function submit(msg?: string) {
    const message = (msg ?? input).trim();
    if (!message) return;
    setInitialMessage(message);
    setInput('');
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <div style={barWrap}>
        <div style={bar}>
          {/* Butterfly — George's leading glyph, consistent with mobile app. */}
          <span style={butterfly} aria-hidden>🦋</span>

          {/* Recording-state slot (empty until voice ships).
              Kept in the layout so voice adds no visual shift. */}
          <div style={recordingSlot} aria-hidden />

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => { if (!input) setInput(''); }}
            placeholder="Ask George anything…"
            style={input_}
            aria-label="Ask George"
          />

          {/* Live-transcription slot: appears while voice input is streaming. */}
          <div style={transcriptionSlot} aria-hidden />

          {/* Timer slot: shows recording seconds during voice input. */}
          <div style={timerSlot} aria-hidden />

          {/* Microphone — tap-to-toggle in Milestone E. Layout-ready today. */}
          <button
            type="button"
            onClick={() => setVoiceHint(true)}
            onBlur={() => setVoiceHint(false)}
            title="Voice input coming in the next milestone"
            style={micBtn}
            aria-label="Voice input (coming soon)"
          >🎙️</button>

          {/* Keyboard hint. Hidden on narrow screens by CSS below. */}
          <span style={cmdHint} aria-hidden>⌘K</span>

          <button
            type="button"
            onClick={() => submit()}
            disabled={!input.trim()}
            style={{ ...askBtn, opacity: input.trim() ? 1 : 0.5 }}
          >Ask</button>
        </div>

        {voiceHint && (
          <div style={hintPop} role="tooltip">
            Voice arrives in the next milestone — microphone, live transcription, playback and all.
          </div>
        )}
      </div>

      <AskGeorgeSheet
        open={open}
        initialMessage={initialMessage}
        onClose={() => { setOpen(false); setInitialMessage(undefined); }}
      />
    </>
  );
}

// ---- styles ----
const barWrap: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 40,
  padding: '12px 32px', background: 'linear-gradient(180deg,#FEFCF8,#FEFCF8 70%,rgba(254,252,248,0.85))',
  borderBottom: '1px solid #F1F5F9',
};
const bar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  background: '#FFFFFF', borderRadius: 14,
  border: '1px solid #E2E8F0',
  padding: '8px 12px',
  boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
};
const butterfly: React.CSSProperties = {
  fontSize: 20, lineHeight: 1,
  filter: 'drop-shadow(0 2px 3px rgba(20,184,166,0.35))',
};
const input_: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', fontSize: 15,
  padding: '6px 4px', background: 'transparent',
  fontFamily: 'inherit',
};
const recordingSlot: React.CSSProperties = {
  width: 0, height: 20, borderRadius: 10, background: 'transparent',
  transition: 'width 0.2s',
};
const transcriptionSlot: React.CSSProperties = {
  width: 0, height: 20, borderRadius: 10, background: 'transparent',
  transition: 'width 0.2s',
};
const timerSlot: React.CSSProperties = {
  width: 0, minWidth: 0, fontVariantNumeric: 'tabular-nums',
  fontSize: 12, color: '#64748B', textAlign: 'right',
  transition: 'width 0.2s',
};
const micBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, border: '1px solid #E2E8F0',
  background: '#F8FAFC', color: '#64748B', fontSize: 15, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const cmdHint: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#94A3B8',
  border: '1px solid #E2E8F0', borderRadius: 6, padding: '2px 6px',
};
const askBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 10,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF', border: 'none', fontWeight: 800, fontSize: 14,
  cursor: 'pointer',
};
const hintPop: React.CSSProperties = {
  position: 'absolute', top: 60, right: 32,
  background: '#0F172A', color: '#F8FAFC',
  padding: '8px 12px', borderRadius: 10, fontSize: 12,
  boxShadow: '0 8px 24px rgba(15,23,42,0.24)',
  maxWidth: 320,
};
