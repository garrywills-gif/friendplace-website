/**
 * flutter-fx — tiny global event bus for the signature "butterfly
 * gliding across the screen" moment. Any screen can trigger the
 * animation without wiring refs through props.
 *
 * v2 design (single-butterfly signature moment):
 *   - Exactly ONE butterfly, gently gliding along a curved path
 *   - Total flight ~1.2s + landing pause + fade ~1.5s end-to-end
 *   - Optional { targetX, targetY } lets callers land the butterfly
 *     near the recipient (usually derived from the tap coords)
 *   - A "🦋 Flutter sent!" toast fades in/out in parallel for ~1s
 *
 * Usage:
 *   import { emitFlutter } from "@/src/lib/flutter-fx";
 *   emitFlutter();                                   // default landing
 *   emitFlutter({ targetX: 300, targetY: 200 });     // land near a tap
 *
 * The <FlutterOverlay /> component (mounted once at the root layout)
 * subscribes and renders the animation over the entire app.
 */

export type FlutterOptions = {
  /** Absolute-window X (px) where the butterfly should land. */
  targetX?: number;
  /** Absolute-window Y (px) where the butterfly should land. */
  targetY?: number;
};

type Listener = (opts: FlutterOptions) => void;

const listeners = new Set<Listener>();

/**
 * Trigger the celebratory flutter animation.
 * Backwards-compat: some legacy call sites pass a `count: number`. We
 * silently accept it and behave as if no options were provided.
 */
export function emitFlutter(opts?: FlutterOptions | number) {
  const options: FlutterOptions = typeof opts === "object" && opts !== null ? opts : {};
  listeners.forEach((fn) => {
    try {
      fn(options);
    } catch {
      /* never let a bad listener break another */
    }
  });
}

/** Internal: subscribe an overlay to the emitter. Returns the unsub. */
export function _subscribeFlutter(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
