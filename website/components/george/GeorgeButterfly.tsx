'use client';

/**
 * George's Butterfly — the signature interaction.
 *
 * Locked with Garry, 19 July 2026:
 *   "When a member opens FriendPlace, I'd like a small butterfly to
 *    gently flutter onto the screen. It shouldn't feel like a
 *    notification. It should feel like George arriving."
 *
 * Behaviour
 *   - Once per calendar day per actor — or after a 3+ day absence
 *     (which shifts the greeting a touch warmer).
 *   - Enters top-right, drifts diagonally to a resting spot in the
 *     bottom-right. Occasionally does a gentle loop before landing.
 *   - Blooms into a speech bubble with a warm, name-personalised
 *     greeting. If we know of an unfinished conversation, George
 *     mentions it so he feels like he remembers people.
 *   - Bubble auto-fades after ~6.5 s, or on any tap / keypress / scroll.
 *   - The butterfly then rests in the corner forever — he's simply
 *     nearby, keeping quiet company. A tiny wing flutter every 90 s
 *     or so reminds you he's alive.
 *   - Tapping the butterfly gives a small flutter, then opens a
 *     floating chat sheet where a fresh conversation can begin. From
 *     inside, George can offer to open his full Workspace.
 *
 * Long-term this is a FriendPlace brand element. It intentionally
 *   does NOT use the 🦋 emoji — that varies too much across platforms.
 *   The SVG lives in `./GeorgeButterflyMark.tsx` so mobile can ship a
 *   matching native version.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import { GeorgeFloatingChat } from './GeorgeFloatingChat';

type PresenceUnfinished = {
  session_id: string;
  title?: string | null;
  status: string;
  updated_at?: string;
};
type Presence = {
  actor_id: string;
  name?: string;
  unfinished: PresenceUnfinished[];
  last_completed?: { title?: string; approved_at?: string } | null;
};

const STORAGE_KEY = 'george.lastArrival';
const DAYS_ABSENCE_FOR_WARM_WELCOME = 3;
const BUBBLE_LIFETIME_MS = 6500;
const LOOP_ARC_ODDS = 0.28;      // ~1 in 4 arrivals do a gentle loop.
const IDLE_FLUTTER_EVERY_MS = 95_000; // ~90 seconds.

interface Props {
  /** Where to fetch presence from. Defaults to the admin endpoint. */
  presenceUrl?: string;
  /** Bearer token. If omitted, tries `localStorage.getItem('cms_token')`. */
  token?: string | null;
  /** Override the actor id used for the daily-arrival gate. */
  actorId?: string;
  /** Called before the arrival animation starts. Return false to suppress. */
  shouldAllowArrival?: () => boolean;
}

export function GeorgeButterfly({
  presenceUrl = '/api/mcgs/george/presence',
  token,
  actorId,
  shouldAllowArrival,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'arriving' | 'landed' | 'resting' | 'opening'>('idle');
  const [presence, setPresence] = useState<Presence | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [openChat, setOpenChat] = useState(false);
  const [isLoopArc, setIsLoopArc] = useState(false);
  const [flutterKey, setFlutterKey] = useState(0);
  const dismissedRef = useRef(false);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Boot ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Read the auth token if not passed explicitly (admin surface).
      const authToken = token ?? (typeof window !== 'undefined' ? window.localStorage.getItem('fp_cms_token') : null);
      if (!authToken) return; // Anonymous surfaces don't get the butterfly yet.

      // Fetch presence. Never block the surface on failure.
      let pres: Presence | null = null;
      try {
        const r = await fetch(presenceUrl, {
          headers: { Authorization: `Bearer ${authToken}` },
          cache: 'no-store',
        });
        if (r.ok) pres = await r.json();
      } catch { /* swallow — he'll just say a generic hello */ }

      if (cancelled) return;
      setPresence(pres);

      const id = actorId || pres?.actor_id || 'anonymous';
      const gate = shouldArriveToday(id);
      // If we're not allowed to arrive today, rest immediately.
      const surfaceOk = shouldAllowArrival ? shouldAllowArrival() : true;
      if (!gate.allowed || !surfaceOk) {
        setPhase('resting');
        return;
      }

      // Decide the greeting BEFORE the animation, so the bubble bloom
      // feels intentional.
      const line = pickGreeting(pres, gate.warmWelcome);
      setGreeting(line);

      // Should this arrival do a gentle loop?
      setIsLoopArc(Math.random() < LOOP_ARC_ODDS);

      // Start the arrival.
      setPhase('arriving');
      // After ~3.7s, land.
      window.setTimeout(() => {
        if (cancelled) return;
        setPhase('landed');
        // Show the bubble a moment after landing.
        window.setTimeout(() => {
          if (cancelled) return;
          setShowBubble(true);
        }, 320);
      }, 3700);

      markArrivedToday(id);
    }
    void boot();
    return () => { cancelled = true; };
  }, [presenceUrl, token, actorId, shouldAllowArrival]);

  // ---- Bubble auto-fade + skip-on-tap ------------------------------------
  useEffect(() => {
    if (!showBubble) return;
    // Auto-fade timer.
    bubbleTimerRef.current = setTimeout(() => {
      setShowBubble(false);
      setPhase('resting');
    }, BUBBLE_LIFETIME_MS);
    // Any interaction dismisses.
    const dismiss = () => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      setShowBubble(false);
      setPhase('resting');
    };
    window.addEventListener('scroll', dismiss, { passive: true, once: true });
    window.addEventListener('keydown', dismiss, { once: true });
    return () => {
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      window.removeEventListener('scroll', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [showBubble]);

  // ---- Periodic idle flutter --------------------------------------------
  useEffect(() => {
    if (phase !== 'resting') return;
    const t = setInterval(() => setFlutterKey(k => k + 1), IDLE_FLUTTER_EVERY_MS);
    return () => clearInterval(t);
  }, [phase]);

  // ---- Tap the butterfly ------------------------------------------------
  function onTap() {
    // A tiny flutter first, then open the chat.
    setFlutterKey(k => k + 1);
    setPhase('opening');
    window.setTimeout(() => {
      setShowBubble(false);
      setOpenChat(true);
      setPhase('resting');
    }, 340);
  }

  const currentUnfinished = presence?.unfinished?.[0];

  return (
    <>
      {/* the arrival stage lives in a fixed layer so it can drift across the whole viewport */}
      <div style={overlay} aria-hidden={phase === 'idle'}>
        <div
          style={{
            ...butterflyAnchor,
            ...(phase === 'arriving' ? (isLoopArc ? arriveLoopStyle : arriveDirectStyle) : {}),
            ...(phase === 'landed' || phase === 'resting' || phase === 'opening' ? restingStyle : {}),
          }}
        >
          <button
            type="button"
            onClick={phase === 'resting' ? onTap : undefined}
            style={{
              ...butterflyBtn,
              cursor: phase === 'resting' ? 'pointer' : 'default',
              pointerEvents: phase === 'resting' ? 'auto' : 'none',
            }}
            aria-label="Talk to George — tap to open"
            title={phase === 'resting' ? 'Talk to George' : ''}
          >
            <div
              key={flutterKey}
              style={{
                ...butterflyInner,
                animation: phase === 'arriving'
                  ? 'fp-wing 480ms ease-in-out infinite'
                  : phase === 'opening'
                    ? 'fp-flutter 340ms ease-out'
                    : flutterKey > 0
                      ? 'fp-flutter 1200ms ease-out'
                      : 'fp-idle-breathe 4s ease-in-out infinite',
              }}
            >
              <GeorgeButterflyMark size={phase === 'arriving' ? 44 : 52} />
            </div>
          </button>

          {showBubble && greeting && (
            <SpeechBubble
              text={greeting}
              unfinished={currentUnfinished}
              onContinueUnfinished={() => {
                if (currentUnfinished) {
                  setShowBubble(false);
                  router.push(`/admin/george/new-event?resume=${currentUnfinished.session_id}`);
                }
              }}
              onDismiss={() => {
                setShowBubble(false);
                setPhase('resting');
              }}
            />
          )}
        </div>
      </div>

      {openChat && (
        <GeorgeFloatingChat
          onClose={() => setOpenChat(false)}
          onOpenWorkspace={() => {
            setOpenChat(false);
            router.push('/admin/george');
          }}
        />
      )}

      <style>{keyframes}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Speech bubble
// ---------------------------------------------------------------------------

function SpeechBubble({
  text, unfinished, onContinueUnfinished, onDismiss,
}: {
  text: string;
  unfinished?: PresenceUnfinished;
  onContinueUnfinished: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={bubbleWrap}
      role="status"
      aria-live="polite"
      onClick={onDismiss}
    >
      <div style={bubbleTail} aria-hidden />
      <div style={bubbleInner}>
        <div style={bubbleText}>{text}</div>
        {unfinished && unfinished.title && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onContinueUnfinished(); }}
            style={continueBtn}
          >
            Continue with &ldquo;{unfinished.title}&rdquo; →
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Greeting logic
// ---------------------------------------------------------------------------

function pickGreeting(presence: Presence | null, warmWelcome: boolean): string {
  const rawName = presence?.name || '';
  const first = firstName(rawName);
  const hour = new Date().getHours();
  const partOfDay =
    hour < 5 ? 'Hi' :
    hour < 12 ? 'Morning' :
    hour < 17 ? 'Afternoon' :
    hour < 21 ? 'Evening' : 'Hi';

  const unfinished = presence?.unfinished?.[0];
  const lastCompleted = presence?.last_completed;

  // Continuity comes first — remembering people is what makes George warm.
  if (unfinished && unfinished.title) {
    return `Welcome back${first ? ', ' + first : ''}. Your ${unfinished.title.toLowerCase()} draft is still here whenever you'd like to continue.`;
  }
  if (unfinished) {
    return `Welcome back${first ? ', ' + first : ''}. There's a draft we started together waiting whenever you're ready.`;
  }
  if (warmWelcome && lastCompleted?.title) {
    return `${partOfDay}${first ? ', ' + first : ''}. Nice to see you again. Last time we put together ${lastCompleted.title.toLowerCase()} — anything else on your mind today?`;
  }
  if (warmWelcome) {
    return `${partOfDay}${first ? ', ' + first : ''}. It's been a little while — nice to see you. What can I help with today?`;
  }

  // Rotating everyday greetings.
  const rotations = [
    `${partOfDay}${first ? ', ' + first : ''}. Welcome back. What would you like to do today? I'm here to help — or we can just have a chat.`,
    `${partOfDay}${first ? ', ' + first : ''}. Nice to see you. Anything you'd like a hand with?`,
    `Hi${first ? ' ' + first : ''}. I'm around if you need me — no rush.`,
  ];
  return rotations[Math.floor(Math.random() * rotations.length)];
}

function firstName(name: string): string {
  if (!name) return '';
  const clean = name.trim().split(/\s+/)[0];
  // Guard against email-shaped names ('me@example.com').
  return clean.includes('@') ? '' : clean;
}

// ---------------------------------------------------------------------------
// Once-per-day gate
// ---------------------------------------------------------------------------

function shouldArriveToday(actorId: string): { allowed: boolean; warmWelcome: boolean } {
  if (typeof window === 'undefined') return { allowed: false, warmWelcome: false };
  const key = `${STORAGE_KEY}.${actorId}`;
  const now = Date.now();
  const lastStr = window.localStorage.getItem(key);
  const last = lastStr ? Number(lastStr) : 0;
  if (!last) return { allowed: true, warmWelcome: false };
  const daysSince = (now - last) / (1000 * 60 * 60 * 24);
  // Same calendar day — skip.
  const lastDate = new Date(last); const nowDate = new Date(now);
  const sameDay =
    lastDate.getFullYear() === nowDate.getFullYear() &&
    lastDate.getMonth() === nowDate.getMonth() &&
    lastDate.getDate() === nowDate.getDate();
  if (sameDay) return { allowed: false, warmWelcome: false };
  return { allowed: true, warmWelcome: daysSince >= DAYS_ABSENCE_FOR_WARM_WELCOME };
}

function markArrivedToday(actorId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${STORAGE_KEY}.${actorId}`, String(Date.now()));
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 900,
};

const butterflyAnchor: React.CSSProperties = {
  position: 'absolute',
  top: 32,
  right: -80,
  transition: 'opacity 320ms ease',
};

const arriveDirectStyle: React.CSSProperties = {
  animation: 'fp-arrive-direct 3700ms cubic-bezier(0.22, 0.9, 0.28, 1) forwards',
};

const arriveLoopStyle: React.CSSProperties = {
  animation: 'fp-arrive-loop 3800ms cubic-bezier(0.4, 0.1, 0.3, 1) forwards',
};

const restingStyle: React.CSSProperties = {
  top: 'auto',
  bottom: 24,
  right: 24,
  transform: 'none',
};

const butterflyBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  filter: 'drop-shadow(0 6px 12px rgba(20,184,166,0.3))',
};

const butterflyInner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transformOrigin: '50% 50%',
};

const bubbleWrap: React.CSSProperties = {
  position: 'absolute',
  right: 68,
  bottom: 16,
  width: 300,
  maxWidth: '80vw',
  pointerEvents: 'auto',
  animation: 'fp-bubble-bloom 420ms cubic-bezier(0.2, 0.9, 0.3, 1)',
};
const bubbleTail: React.CSSProperties = {
  position: 'absolute',
  bottom: 14,
  right: -6,
  width: 12,
  height: 12,
  background: '#FFFFFF',
  borderTop: '1px solid #CCFBF1',
  borderRight: '1px solid #CCFBF1',
  transform: 'rotate(45deg)',
};
const bubbleInner: React.CSSProperties = {
  position: 'relative',
  background: '#FFFFFF',
  border: '1px solid #CCFBF1',
  borderRadius: 16,
  padding: '14px 16px',
  boxShadow: '0 12px 30px rgba(20,184,166,0.18)',
};
const bubbleText: React.CSSProperties = {
  fontSize: 14,
  color: '#0F172A',
  lineHeight: 1.55,
};
const continueBtn: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 10px',
  borderRadius: 8,
  background: 'linear-gradient(135deg,#14B8A6,#38BDF8)',
  color: '#FFFFFF',
  border: 'none',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
};

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

const keyframes = `
@keyframes fp-arrive-direct {
  0%   { top: -60px;  right: -80px; opacity: 0; transform: rotate(6deg); }
  15%  { opacity: 1; }
  60%  { top: 45vh;   right: 40vw;  transform: rotate(-3deg); }
  85%  { top: 78vh;   right: 8vw;   transform: rotate(1deg); }
  100% { top: auto;   bottom: 24px; right: 24px; transform: rotate(0deg); opacity: 1; }
}
@keyframes fp-arrive-loop {
  0%   { top: -60px;  right: -80px; opacity: 0; transform: rotate(8deg); }
  15%  { opacity: 1; }
  30%  { top: 30vh;   right: 45vw;  transform: rotate(-6deg); }
  45%  { top: 20vh;   right: 60vw;  transform: rotate(-16deg); }
  60%  { top: 40vh;   right: 55vw;  transform: rotate(-4deg); }
  80%  { top: 72vh;   right: 12vw;  transform: rotate(3deg); }
  100% { top: auto;   bottom: 24px; right: 24px; transform: rotate(0deg); opacity: 1; }
}
@keyframes fp-wing {
  0%,100% { transform: scaleX(1); }
  50%     { transform: scaleX(0.72); }
}
@keyframes fp-flutter {
  0%,100% { transform: scaleX(1) rotate(0deg); }
  25%     { transform: scaleX(0.78) rotate(-3deg); }
  50%     { transform: scaleX(1.05) rotate(2deg); }
  75%     { transform: scaleX(0.86) rotate(-1deg); }
}
@keyframes fp-idle-breathe {
  0%,100% { transform: scale(1); }
  50%     { transform: scale(1.03); }
}
@keyframes fp-bubble-bloom {
  0%   { transform: translateY(6px) scale(0.9); opacity: 0; }
  100% { transform: translateY(0)   scale(1);   opacity: 1; }
}
`;
