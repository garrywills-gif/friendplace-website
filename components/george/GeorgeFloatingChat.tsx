'use client';

/**
 * George's floating chat window.
 *
 * Opens when someone taps the resting butterfly in the corner. Feels
 * like a professional desktop assistant panel:
 *
 *   • Draggable by its header — grab-cursor with a small drag hint.
 *   • Remembers position for the session (sessionStorage) so it
 *     comes back where you left it during the same visit.
 *   • Clamped inside the viewport — never opens off-screen and
 *     re-clamps on window resize.
 *   • Minimise/restore is preserved: closing the window remembers
 *     position; tapping the resting butterfly re-opens it there.
 *   • Escape still closes.
 *   • Backdrop click still closes — but the backdrop is only shown on
 *     narrow (≤ 720 px) viewports where the window is effectively a
 *     bottom sheet. On desktops the window floats without dimming the
 *     surface underneath so admins can still see The Bridge while
 *     they chat.
 *
 * "Open my Workspace →" still hops to the full canvas for deeper
 * work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GeorgeConversation, type GeorgeConversationChrome } from './GeorgeConversation';

interface Props {
  onClose: () => void;
  onOpenWorkspace: () => void;
  seedMessage?: string;
}

const SIZE = { width: 560, height: 620 } as const;
const MARGIN = 12; // don't allow the window to touch the viewport edge
const STORAGE_KEY = 'friendplace.george.floatingChat.position';

type Position = { x: number; y: number };

/** Read the last remembered position for this session. */
function readStoredPosition(): Position | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch { /* ignore malformed session data */ }
  return null;
}

/** Save the current position (best-effort — silent failure is fine). */
function saveStoredPosition(pos: Position) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* silent */ }
}

/** Clamp a position into the current viewport, leaving MARGIN of breathing room. */
function clampToViewport(pos: Position, width: number, height: number): Position {
  if (typeof window === 'undefined') return pos;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(MARGIN, vw - width - MARGIN);
  const maxY = Math.max(MARGIN, vh - height - MARGIN);
  return {
    x: Math.min(Math.max(pos.x, MARGIN), maxX),
    y: Math.min(Math.max(pos.y, MARGIN), maxY),
  };
}

/**
 * Default position (bottom-right, above the resting butterfly slot).
 * Kept close to the corner so the window's "home" feels near where
 * you tapped to open it.
 */
function defaultPosition(width: number, height: number): Position {
  if (typeof window === 'undefined') return { x: 100, y: 100 };
  return {
    x: Math.max(MARGIN, window.innerWidth  - width  - 24),
    y: Math.max(MARGIN, window.innerHeight - height - 96),
  };
}

export function GeorgeFloatingChat({ onClose, onOpenWorkspace, seedMessage }: Props) {
  // Sheet size adapts to the viewport so we don't overflow on
  // small windows. Recomputed on resize.
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: SIZE.width, height: SIZE.height };
    return {
      width:  Math.min(SIZE.width,  window.innerWidth  - MARGIN * 2),
      height: Math.min(SIZE.height, window.innerHeight - MARGIN * 2),
    };
  });

  const [pos, setPos] = useState<Position>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    const stored = readStoredPosition();
    const start = stored ?? defaultPosition(size.width, size.height);
    return clampToViewport(start, size.width, size.height);
  });

  const isNarrow = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 720;
  }, []);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Re-clamp whenever the viewport resizes so the panel is never
  // stranded off-screen after Garry resizes his browser.
  useEffect(() => {
    const onResize = () => {
      const nextSize = {
        width:  Math.min(SIZE.width,  window.innerWidth  - MARGIN * 2),
        height: Math.min(SIZE.height, window.innerHeight - MARGIN * 2),
      };
      setSize(nextSize);
      setPos((p) => clampToViewport(p, nextSize.width, nextSize.height));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Drag state — pointer events give us mouse + touch + pen for free.
  const dragRef = useRef<{ dx: number; dy: number; active: boolean } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left button / primary touch.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragRef.current = {
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      active: true,
    };
    // Capture so we keep getting move events even if the pointer
    // leaves the header (e.g. moves quickly off the edge).
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !d.active) return;
    e.preventDefault();
    const raw = { x: e.clientX - d.dx, y: e.clientY - d.dy };
    setPos(clampToViewport(raw, size.width, size.height));
  }, [size.width, size.height]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    d.active = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
    // Persist the final resting position for this session.
    setPos((p) => {
      const clamped = clampToViewport(p, size.width, size.height);
      saveStoredPosition(clamped);
      return clamped;
    });
  }, [size.width, size.height]);

  const chrome: GeorgeConversationChrome = {
    onLeave: onClose,
    leaveLabel: 'Close',
    successActions: [
      { label: 'Back', onSelect: onClose },
    ],
  };

  return (
    <>
      {/* On narrow viewports the window behaves like a bottom sheet
          and needs a backdrop for tap-outside-to-close. On desktops
          we skip the backdrop so admins can still see The Bridge. */}
      {isNarrow && <div style={backdrop} onClick={onClose} aria-hidden />}
      <div
        style={{
          ...sheet,
          left:   pos.x,
          top:    pos.y,
          width:  size.width,
          height: size.height,
          // No animation on subsequent drags — only bloom in on first mount.
        }}
        role="dialog"
        aria-label="Talk to George"
      >
        <div
          style={sheetHeader}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'none' }}>
            {/* Six-dot drag handle affordance */}
            <span aria-hidden style={dragHandle}>
              <span style={dragDot} /><span style={dragDot} />
              <span style={dragDot} /><span style={dragDot} />
              <span style={dragDot} /><span style={dragDot} />
            </span>
            <div style={dot} aria-hidden />
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Talking with George</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', pointerEvents: 'auto' }}
               onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={onOpenWorkspace} style={openWorkspaceBtn}>
              Open my Workspace →
            </button>
            <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">×</button>
          </div>
        </div>
        <div style={sheetBody}>
          <GeorgeConversation seedMessage={seedMessage} chrome={chrome} />
        </div>
      </div>
      <style>{sheetKeyframes}</style>
    </>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(15,23,42,0.14)',
  zIndex: 950,
  animation: 'fp-fade-in 200ms ease-out',
};
const sheet: React.CSSProperties = {
  position: 'fixed',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 20,
  boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
  zIndex: 951,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  animation: 'fp-sheet-bloom 260ms cubic-bezier(0.2, 0.9, 0.3, 1)',
  // Keep the sheet slightly translucent-white so its shadow reads
  // as a floating panel rather than a wall.
  backdropFilter: 'saturate(140%)',
};
const sheetHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 14px', borderBottom: '1px solid #F1F5F9',
  background: 'linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)',
  cursor: 'grab',
  userSelect: 'none',
  touchAction: 'none',
};
const sheetBody: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: '4px 12px 12px',
};
const dot: React.CSSProperties = {
  width: 8, height: 8, borderRadius: 4,
  background: '#0EA5E9', boxShadow: '0 0 0 4px rgba(14,165,233,0.18)',
};
const dragHandle: React.CSSProperties = {
  display: 'inline-grid',
  gridTemplateColumns: 'repeat(2, 3px)',
  gap: 3,
  padding: 4,
  opacity: 0.5,
};
const dragDot: React.CSSProperties = {
  width: 3, height: 3, borderRadius: 2, background: '#64748B',
};
const openWorkspaceBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 12, color: '#1D4ED8', fontWeight: 700,
  cursor: 'pointer', padding: '4px 6px',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 24, color: '#64748B', cursor: 'pointer',
  padding: 0, lineHeight: 1,
};

const sheetKeyframes = `
@keyframes fp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fp-sheet-bloom {
  0%   { transform: translateY(20px) scale(0.96); opacity: 0; }
  100% { transform: translateY(0)   scale(1);    opacity: 1; }
}
`;
