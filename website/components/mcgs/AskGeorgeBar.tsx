'use client';

import { useEffect, useRef, useState } from 'react';
import { AskGeorgeSheet } from './AskGeorgeSheet';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { transcribeAudio } from '@/lib/mcgs-api';

/**
 * The Ask George bar — persistent at the top of every MCGS screen.
 * Voice is first-class: tap-to-toggle mic, live timer + level meter,
 * silence auto-stop, 60s cap, and transcript review before send.
 *
 * Keyboard: ⌘K / Ctrl+K focuses the bar from anywhere.
 */
export function AskGeorgeBar() {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rec = useVoiceRecorder({ maxSeconds: 60, silenceSeconds: 3 });

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

  async function toggleMic() {
    setMicError(null);
    if (rec.recording) {
      // Second tap → stop and transcribe.
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
        inputRef.current?.focus();
      } catch (err) {
        // Log the real error so failures are diagnosable from the
        // console, then show graceful, human wording.
        console.error('[voice] transcription failed:', err);
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
            : "I couldn\u2019t open the microphone just now. You can type instead, or try again in a moment."
        );
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  const showRecordingUI = rec.recording || transcribing;
  const timerLabel = rec.recording
    ? `${String(Math.floor(rec.seconds / 60)).padStart(1, '0')}:${String(rec.seconds % 60).padStart(2, '0')}`
    : transcribing ? 'transcribing…' : '';

  return (
    <>
      <div style={barWrap}>
        <div style={bar}>
          <span style={butterfly} aria-hidden>🦋</span>

          {/* Recording indicator */}
          <div style={{
            ...recordingSlot,
            width: showRecordingUI ? 14 : 0,
            background: rec.recording ? '#EF4444' : (transcribing ? '#14B8A6' : 'transparent'),
            animation: rec.recording ? 'pulseDot 1.2s ease-in-out infinite' : 'none',
          }} aria-hidden />

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={rec.recording ? 'Listening… tap the mic again when you\u2019re done.' : 'Ask George anything…'}
            style={input_}
            aria-label="Ask George"
            disabled={rec.recording}
          />

          {/* Live timer / transcription state */}
          <span style={{
            ...timerSlot,
            width: showRecordingUI ? 90 : 0,
            color: rec.recording ? '#EF4444' : '#0F766E',
            fontWeight: 700,
          }} aria-live="polite">{timerLabel}</span>

          {/* Cancel button while recording */}
          {rec.recording && (
            <button
              type="button"
              onClick={rec.cancel}
              title="Cancel recording"
              style={cancelBtn}
              aria-label="Cancel recording"
            >✕</button>
          )}

          {/* Microphone — tap-to-toggle */}
          <button
            type="button"
            onClick={toggleMic}
            disabled={transcribing}
            title={rec.recording ? 'Stop recording' : 'Talk to George'}
            style={{
              ...micBtn,
              background: rec.recording ? '#FEE2E2' : '#F8FAFC',
              borderColor: rec.recording ? '#FCA5A5' : '#E2E8F0',
              color: rec.recording ? '#DC2626' : '#64748B',
            }}
            aria-label={rec.recording ? 'Stop recording' : 'Talk to George'}
          >{rec.recording ? '⏹' : '🎙️'}</button>

          <span style={cmdHint} aria-hidden>⌘K</span>

          <button
            type="button"
            onClick={() => submit()}
            disabled={!input.trim() || rec.recording}
            style={{ ...askBtn, opacity: input.trim() && !rec.recording ? 1 : 0.5 }}
          >Ask</button>
        </div>

        {micError && (
          <div style={{ ...hintPop, background: '#7F1D1D' }} role="alert">{micError}</div>
        )}
        {rec.recording && (
          <div style={hintPop} role="status">
            George is listening… tap the mic to finish or wait 3s of silence.
          </div>
        )}

        <style>{`
          @keyframes pulseDot {
            0%,100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.8); }
          }
        `}</style>
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
const cancelBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0',
  background: 'transparent', color: '#94A3B8', fontSize: 14, cursor: 'pointer',
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
