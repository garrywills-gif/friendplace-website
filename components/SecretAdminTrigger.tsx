'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SecretAdminTrigger — an invisible long-press gesture wrapper.
 *
 * Wrapping the public-site footer butterfly with this component turns
 * the existing brand mark into a hidden entrance to Mission Control:
 *
 *   • A normal tap/click does nothing.
 *   • Press-and-hold for LONG_PRESS_MS (~2 s) → navigates to /admin.
 *   • Scrolling away, pointer-up, pointer-leave, or pointer-cancel
 *     cancels the timer without navigating.
 *   • Native long-press image menus on iOS (Save Image, Copy…) are
 *     suppressed while the user is touching the mark.
 *   • Right-click context menu is suppressed.
 *
 * IMPORTANT
 * ─────────
 * This wrapper only *navigates* to /admin. It does not authenticate
 * anyone, does not read/write cookies, does not exchange tokens, and
 * does not bake any credentials, identifiers, or endpoints into the
 * client bundle. Once the visitor arrives at /admin, the existing
 * Mission Control auth pipeline (setup-required check → login gate →
 * JWT) applies unchanged. Anyone who guesses the gesture is still met
 * with the standard sign-in screen.
 *
 * The children are rendered inside a single <span> that carries the
 * gesture handlers. The span itself is invisible in terms of layout —
 * it declares `display: inline-flex` matching the butterfly's natural
 * inline behaviour, and applies no visual styling of its own. The
 * only user-visible side effects on interaction are pointer-cursor
 * suppression and iOS long-press callout suppression, both of which
 * are perception-only (no bounding box, colour, badge, or hover
 * treatment is added).
 */

const LONG_PRESS_MS = 2000;
// Cancel the long-press if the pointer drifts more than this many CSS
// pixels from its initial position. Prevents accidental triggers when
// a visitor is scrolling near the footer on iPhone/iPad.
const MOVE_CANCEL_THRESHOLD = 10;

interface SecretAdminTriggerProps {
  children: React.ReactNode;
  /**
   * The route to navigate to when the long-press completes. Defaults
   * to '/admin' — the existing Mission Control entry point that
   * already implements the setup / login / redirect flow.
   */
  target?: string;
}

export default function SecretAdminTrigger({
  children,
  target = '/admin',
}: SecretAdminTriggerProps) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  // Safety net: if the component unmounts mid-press, tear down cleanly.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only respond to primary button (mouse left, touch, pen tip).
      if (e.button !== undefined && e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        router.push(target);
      }, LONG_PRESS_MS);
    },
    [router, target]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start || !timerRef.current) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > MOVE_CANCEL_THRESHOLD * MOVE_CANCEL_THRESHOLD) {
        cancel();
      }
    },
    [cancel]
  );

  const onPointerEnd = useCallback(() => {
    cancel();
  }, [cancel]);

  // If the long-press fired, suppress the trailing click so the
  // browser doesn't try to follow any parent <a> or do anything else.
  // If the long-press did NOT fire, this ensures a normal tap on the
  // butterfly is a no-op (as required — no visible affordance).
  const onClick = useCallback((e: React.MouseEvent) => {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
      return;
    }
    // A plain tap intentionally does nothing.
  }, []);

  return (
    <span
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerLeave={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      // Layout: match the natural inline-flex the surrounding footer
      // block already uses so nothing shifts visually.
      style={{
        display: 'inline-flex',
        // Keep the same pointer/hover feel visitors already see — no
        // added ring, halo, colour, badge, or hover state.
        cursor: 'default',
        // Suppress iOS "save image / copy" long-press callout.
        WebkitTouchCallout: 'none',
        // Prevent the button from being selectable during the hold.
        WebkitUserSelect: 'none',
        userSelect: 'none',
        // Let taps go through cleanly without triggering scroll-jank
        // heuristics — only vertical panning is initiated elsewhere.
        touchAction: 'manipulation',
      }}
    >
      {children}
    </span>
  );
}
