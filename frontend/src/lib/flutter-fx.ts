/**
 * flutter-fx — tiny global event bus for the signature "butterfly
 * gliding across the screen" moment. Any screen can trigger the
 * animation without wiring refs through props.
 *
 * v4 API:
 *   emitFlutter({
 *     targetX, targetY,   // optional absolute-window landing coords
 *     targetRef,          // optional native ref — overlay will
 *                         //   measureInWindow() and land on its centre.
 *                         //   Takes precedence over targetX/Y.
 *     onLand,             // fires when the butterfly touches down.
 *   });
 *
 * The <FlutterOverlay /> component (mounted once at the root layout)
 * subscribes and renders the animation over the entire app.
 */

/**
 * Minimal shape of a React Native measurable element.
 * (Both React refs and NativeMethods components implement this.)
 */
export type Measurable = {
  measureInWindow: (
    cb: (x: number, y: number, w: number, h: number) => void
  ) => void;
};

export type FlutterOptions = {
  /** Absolute-window X (px) where the butterfly should land. */
  targetX?: number;
  /** Absolute-window Y (px) where the butterfly should land. */
  targetY?: number;
  /**
   * Ref to a native element (usually the recipient's avatar). If
   * provided, the overlay will `measureInWindow()` it and land the
   * butterfly on the element's centre. Falls back to targetX/Y if
   * the measurement fails or the ref is null.
   */
  targetRef?: Measurable | null;
  /**
   * Fires the moment the butterfly finishes its landing pulse at the
   * target. Use this to show a "Flutter sent to X" toast so it
   * appears when the butterfly *arrives*, not when the tap starts.
   */
  onLand?: () => void;
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
