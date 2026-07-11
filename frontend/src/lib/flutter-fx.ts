/**
 * flutter-fx — tiny global event bus for the "butterfly flies across the
 * screen" celebration. Any screen can trigger the animation without
 * having to pass a ref chain through props.
 *
 * Usage:
 *   import { emitFlutter } from "@/src/lib/flutter-fx";
 *   emitFlutter();      // fires 3-butterfly celebration
 *   emitFlutter(5);     // fires 5 butterflies (bigger occasion)
 *
 * The <FlutterOverlay /> component (mounted at the root layout) listens
 * and renders the animation on top of the entire app.
 */

type Listener = (count: number) => void;

const listeners = new Set<Listener>();

/** Fire the celebration. Optionally pass how many butterflies. */
export function emitFlutter(count: number = 4) {
  listeners.forEach((fn) => {
    try { fn(count); } catch { /* no-op — never let a bad listener break another */ }
  });
}

/** Internal: subscribe an overlay to the emitter. Returns the unsub. */
export function _subscribeFlutter(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
