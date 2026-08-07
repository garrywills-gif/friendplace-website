'use client';

/**
 * TourEndingVoice — plays George's / Georgia's closing line at the
 * bottom of the tour once the visitor has scrolled into view.
 *
 * "You're all set. FriendPlace is yours to explore now. And
 *  remember… if you ever need me, just tap the butterfly."
 *
 * Reads the chosen companion from the CompanionContext so the same
 * voice that welcomed the visitor at /meet is the voice that closes
 * the journey at /features. Falls back silently if the companion
 * context isn't ready or the visitor arrived without going through
 * /meet — text alone still lands the moment.
 *
 * Autoplay-friendly: only calls play() after a user gesture on the
 * page (any tap/click/scroll). Browsers that block autoplay simply
 * skip the audio — the text is the primary carrier.
 *
 * Locked with Garry (iter147): the closing voice is the mirror of
 * the /meet Welcome moment — it's what makes George feel like he
 * was with the visitor the whole way through.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompanion, type CompanionId } from '@/lib/companion-context';

const DEFAULT_COMPANION: CompanionId = 'george';

export default function TourEndingVoice() {
  const { companion, ready } = useCompanion();
  const effective: CompanionId = (ready && companion) || DEFAULT_COMPANION;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef(false);
  const [gestureUnlocked, setGestureUnlocked] = useState(false);

  // Track whether the visitor has interacted with the page at all —
  // required for browsers that block autoplay without a prior gesture.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (gestureUnlocked) return;
    const unlock = () => setGestureUnlocked(true);
    const opts = { once: true, passive: true } as AddEventListenerOptions;
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('touchstart', unlock, opts);
    window.addEventListener('scroll',      unlock, opts);
    window.addEventListener('keydown',     unlock, opts);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('scroll',     unlock);
      window.removeEventListener('keydown',    unlock);
    };
  }, [gestureUnlocked]);

  // Play when the element scrolls into view (and gesture is unlocked).
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (playedRef.current) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && gestureUnlocked && !playedRef.current) {
          const a = audioRef.current;
          if (!a) return;
          playedRef.current = true;
          const p = a.play();
          if (p && typeof (p as Promise<void>).then === 'function') {
            (p as Promise<void>).catch(() => {
              // Autoplay blocked — expose the "Play" button below.
              playedRef.current = false;
              setBlocked(true);
            });
          }
        }
      }
    }, { threshold: 0.55 });

    io.observe(el);
    return () => io.disconnect();
  }, [gestureUnlocked]);

  const [blocked, setBlocked] = useState(false);
  const manualPlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof (p as Promise<void>).then === 'function') {
      (p as Promise<void>).then(() => setBlocked(false)).catch(() => setBlocked(true));
    }
  }, []);

  return (
    <div ref={containerRef} style={{ display: 'inline-block' }}>
      <audio
        ref={audioRef}
        src={`/audio/ending-${effective}.mp3`}
        preload="auto"
        onError={(e) => { try { e.stopPropagation(); } catch { /* silent */ } }}
      />
      {blocked && (
        <button
          type="button"
          onClick={manualPlay}
          style={{
            marginTop: 20,
            padding: '10px 22px',
            background: 'rgba(20, 184, 166, 0.12)',
            color: '#0F766E',
            border: '1px solid rgba(20, 184, 166, 0.45)',
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          aria-label={`Hear ${effective === 'george' ? 'George' : 'Georgia'} say goodbye`}
        >
          Hear {effective === 'george' ? 'George' : 'Georgia'}
        </button>
      )}
    </div>
  );
}
