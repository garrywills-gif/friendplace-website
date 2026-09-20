import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * bottom-nav — a tiny cross-tree store (no Provider needed) that both the
 * native tab bar and the GlobalBottomNav subscribe to, so the 5-tab bar can
 * auto-hide while the user scrolls DOWN and reappear when they scroll back
 * up, reach the top, or simply pause. It must NEVER leave the user stranded,
 * so an idle safety timer always brings the bar back if scrolling stops.
 */
let visible = true;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
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

function clearIdle() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

export function showBottomNav() {
  clearIdle();
  if (!visible) { visible = true; emit(); }
}

function hideBottomNav() {
  if (visible) { visible = false; emit(); }
  // Safety net: if the user stops scrolling while the bar is hidden, bring it
  // back so they are never stranded on a screen with no visible navigation.
  clearIdle();
  idleTimer = setTimeout(() => { idleTimer = null; visible = true; emit(); }, 1800);
}

export function useBottomNavVisible() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Spread the returned props onto any vertical ScrollView / FlatList to enable
 * hide-on-scroll for the bottom bar. Mounting a wired screen always shows the
 * bar first (so a fresh screen never starts hidden).
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
