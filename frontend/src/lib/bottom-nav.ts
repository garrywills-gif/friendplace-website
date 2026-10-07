import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * bottom-nav — a tiny cross-tree store (no Provider needed) that both the
 * native tab bar and the GlobalBottomNav subscribe to, so the 5-tab bar can
 * auto-hide while the user scrolls DOWN and reappear when they scroll back
 * UP, reach the top, or deliberately tap the screen.
 *
 * TestFlight feedback (Neo, Feb 2026 — Local Events): a 1.8 s safety-net
 * timer used to resurrect the bar automatically after any pause in
 * scrolling. On a short event card the member would scroll past the hero
 * image, pause to read, and the bar would snap back and cover the
 * "Add to calendar" pill. Fix: drop the idle timer entirely. The bar
 * now ONLY comes back on an explicit upward scroll, when the scroll
 * reaches the top, or when a screen remounts — exactly matching the
 * stated contract. Any screen that uses `useNavHideScroll` also pads
 * its content ABOVE the bar height so no interactive control is
 * trapped behind a visible bar.
 */
let visible = true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
function getSnapshot() {
  return visible;
}

export function showBottomNav() {
  if (!visible) { visible = true; emit(); }
}

function hideBottomNav() {
  if (visible) { visible = false; emit(); }
  // Deliberate — no idle timer. The bar stays hidden until the member
  // scrolls back up, reaches the top of the list, or remounts the
  // screen. This prevents the bar from covering last-row controls
  // (TestFlight Neo, Feb 2026).
}

export function useBottomNavVisible() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Spread the returned props onto any vertical ScrollView / FlatList to enable
 * hide-on-scroll for the bottom bar. Mounting a wired screen always shows the
 * bar first (so a fresh screen never starts hidden). On a tap/press the
 * caller can also call `showBottomNav()` directly if deliberate reveal is
 * needed (handled by GlobalBottomNav itself on top-level route change).
 */
export function useNavHideScroll() {
  const lastY = useRef(0);

  useEffect(() => {
    showBottomNav();
    return () => { showBottomNav(); };
  }, []);

  const onScroll = useCallback((e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y <= 8) { showBottomNav(); return; }   // at/near top → always show
    if (dy > 6) hideBottomNav();                 // scrolling down → hide
    else if (dy < -6) showBottomNav();           // scrolling back up → show
  }, []);

  return { onScroll, scrollEventThrottle: 16 };
}

/**
 * Standard bottom-inset for screens that use `useNavHideScroll`. Combines
 * the GlobalBottomNav height (~72 px above the home-indicator safe area)
 * with a 24 px cushion so the LAST row of controls — "Add to calendar"
 * on Local Events, "Save changes" on edit forms, etc. — can always
 * scroll fully clear of a visible bar. Callers add this to their
 * `contentContainerStyle.paddingBottom`.
 *
 * The actual home-indicator safe-area is covered by GlobalBottomNav's
 * own `paddingBottom`, so the number below only needs to clear the
 * icons + labels + top padding of the bar itself.
 */
export const BOTTOM_NAV_CONTENT_INSET = 96;
