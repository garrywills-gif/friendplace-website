/**
 * FlutterOverlay — the signature FriendPlace celebration.
 *
 * When `emitFlutter({ targetRef?, targetX?, targetY?, onLand? })`
 * fires, a single butterfly drifts from the lower-left thumb region
 * along a naturalistic curved path — briefly resting mid-flight the
 * way a real Monarch touches down on a flower, then gliding on and
 * landing on the recipient's avatar. A small golden sparkle blooms
 * at the landing spot for a warm finishing beat.
 *
 * Design decisions:
 *   - ONE butterfly (previously 3-5) — feels intimate and personal.
 *   - If a `targetRef` is provided, we `measureInWindow()` it and
 *     land on the element's centre. This lets callers point the
 *     butterfly at the recipient's *avatar* rather than the tap
 *     coordinate (which is usually a nearby button).
 *   - Timing:
 *       fly-out ~1.3s → mid-flight rest ~700ms → glide-in ~1.5s →
 *       landing pulse ~340ms + sparkle bloom ~700ms → fade ~460ms
 *       ≈ 4.4s total.
 *   - Curvier path: a slow vertical bob (±14px, ~2.2s period) is
 *     layered on top of the quadratic Bezier so the trajectory
 *     undulates gently instead of following a clean arc. Combined
 *     with the horizontal sway, the butterfly meanders through the
 *     scene the way a real Monarch does.
 *   - Sparkle: a soft radial glow (radial-gradient in native, plain
 *     circle on web) that fades in as the butterfly touches down and
 *     fades out with the butterfly.
 *   - `pointerEvents="none"` on the root — never intercepts taps.
 *   - Uses core RN `Animated` (not Reanimated) so it works on iOS,
 *     Android, and the Expo web preview identically.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { _subscribeFlutter } from "@/src/lib/flutter-fx";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

type Flight = {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  // Mid-point of the quadratic Bezier — controls the arc shape.
  midX: number;
  midY: number;
  onLand?: () => void;
};

let nextId = 0;

/** Measure a native ref's window position. Resolves to null on any
 * failure (unmounted node, non-native View, etc.) so the caller can
 * fall back to explicit coords or the default landing. */
function measureRef(
  ref: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null | undefined
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!ref || typeof ref.measureInWindow !== "function") {
      resolve(null);
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 120);
    try {
      ref.measureInWindow((x, y, w, h) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          resolve(null);
        } else {
          resolve({ x, y, w: w || 0, h: h || 0 });
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      }
    }
  });
}

export default function FlutterOverlay() {
  const { width: winW, height: winH } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);

  useEffect(() => {
    const unsub = _subscribeFlutter(async (opts) => {
      // Clamp the target inside the visible viewport with a small
      // margin so the butterfly never lands off-screen (which happens
      // when a caller measures a partially-scrolled element).
      const margin = 40;

      // Preferred order for the landing coords:
      //   1. Measured targetRef (usually the recipient's avatar)
      //   2. Explicit targetX/Y (usually a tap coord)
      //   3. Default upper-right glide.
      let tx: number | undefined;
      let ty: number | undefined;
      if (opts.targetRef) {
        const rect = await measureRef(opts.targetRef);
        if (rect) {
          tx = rect.x + rect.w / 2;
          ty = rect.y + rect.h / 2;
        }
      }
      if (tx === undefined && typeof opts.targetX === "number") tx = opts.targetX;
      if (ty === undefined && typeof opts.targetY === "number") ty = opts.targetY;

      const targetX =
        typeof tx === "number"
          ? Math.max(margin, Math.min(winW - margin, tx))
          : winW * 0.78;
      const targetY =
        typeof ty === "number"
          ? Math.max(margin, Math.min(winH - margin, ty))
          : winH * 0.22;

      // Start position: lower-left thumb region by default (feels like
      // a "send"). Callers can override with explicit start coords —
      // e.g. Home passes coords near the top edge so an incoming
      // flutter looks like it *arrived* rather than launched. Slight
      // random jitter keeps consecutive flutters from feeling robotic.
      const startX =
        typeof opts.startX === "number"
          ? Math.max(margin, Math.min(winW - margin, opts.startX))
          : winW * (0.12 + Math.random() * 0.08);
      const startY =
        typeof opts.startY === "number"
          ? Math.max(margin, Math.min(winH - margin, opts.startY))
          : winH * (0.82 + Math.random() * 0.06);

      // Bezier mid-point picks its bulge direction based on whether
      // the butterfly is flying UP (a "send" — swoops up above both
      // endpoints so it arcs like a launch) or DOWN (a "receive" —
      // curls laterally so it enters the screen from above rather
      // than looping off the top edge).
      const goingDown = targetY > startY + 40;
      let midX: number;
      let midY: number;
      if (goingDown) {
        // Lateral arc: nudge midX to one side (biased away from the
        // nearer screen edge) and keep midY roughly between the
        // endpoints — the butterfly enters and curls on its way down.
        const straightMidX = (startX + targetX) / 2;
        const bias = straightMidX < winW / 2 ? 1 : -1; // curl toward the roomy side
        midX = straightMidX + bias * 90;
        midY = (startY + targetY) / 2 - 20;
      } else {
        // Send-style upward arc: control point sits above the direct
        // line so the butterfly rises then descends to the target.
        midX = startX + (targetX - startX) * 0.45;
        const arcHeight = Math.min(200, Math.max(90, Math.abs(startY - targetY) * 0.55));
        midY = Math.min(startY, targetY) - arcHeight;
      }

      const id = ++nextId;
      setFlight({ id, startX, startY, targetX, targetY, midX, midY, onLand: opts.onLand });

      // Full animation window — clean up a bit after the fade so
      // React doesn't drop the animated view mid-transition.
      setTimeout(() => {
        setFlight((cur) => (cur && cur.id === id ? null : cur));
      }, 4700);
    });
    return unsub;
  }, [winW, winH]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flight && <Butterfly key={flight.id} flight={flight} />}
    </View>
  );
}

function Butterfly({ flight }: { flight: Flight }) {
  // Progress along the Bezier (0 → 1). Split into two Animated.timing
  // steps (fly-out and glide-in) with a mid-flight rest in between.
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Wing wobble — fast rotational flap that reads as "wings beating".
  const wobble = useRef(new Animated.Value(0)).current;
  // Horizontal body sway — slow left/right meander so the trajectory
  // isn't rigidly on the Bezier line.
  const sway = useRef(new Animated.Value(0)).current;
  // Vertical bob — slow up/down undulation that gives the flight a
  // curvier, more butterfly-like feel (real Monarchs bob as they fly).
  const bob = useRef(new Animated.Value(0)).current;
  // Scale — driven by mid-flight "settle" pulse + landing pulse.
  const scaleV = useRef(new Animated.Value(1)).current;
  // Sparkle at the landing spot.
  const sparkleOpacity = useRef(new Animated.Value(0)).current;
  const sparkleScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Fade-in → hold → fade-out. Held across all three flight phases
    // (fly-out ~1300ms + rest ~700ms + glide-in ~1500ms + landing
    // ~340ms ≈ 3.84s) then a 460ms fade-out.
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(3540),
      Animated.timing(opacity, { toValue: 0, duration: 460, useNativeDriver: true }),
    ]).start();

    // Flight sequence:
    //   PHASE 1 (fly-out, 1300ms): progress 0 → 0.42 with symmetric
    //     ease-in-out — soft launch, glides into the rest with zero
    //     velocity so there's no visible "stop".
    //   REST (700ms): progress holds at 0.42. Wing wobble, sway, and
    //     bob keep going (separate loops), so the butterfly visibly
    //     "flexes" on its imaginary flower. A tiny scale bump
    //     (1.0 → 1.08 → 1.0) reinforces the settle.
    //   PHASE 2 (glide-in, 1500ms): progress 0.42 → 1 with matching
    //     ease-in-out — resumes from zero velocity, decelerates to
    //     zero at the target for a graceful arrival.
    //   LANDING (340ms): scale pulse at the target.
    //   SPARKLE (700ms) fires in parallel with the landing pulse; see
    //     the separate Animated.sequence below.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 0.42,
        duration: 1300,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleV, {
            toValue: 1.08,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(260),
          Animated.timing(scaleV, {
            toValue: 1.0,
            duration: 220,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(progress, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        // Landing pulse — butterfly scale bounce.
        Animated.sequence([
          Animated.timing(scaleV, {
            toValue: 1.22,
            duration: 160,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scaleV, {
            toValue: 1.0,
            duration: 180,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        // Sparkle bloom — soft radial glow that fades in with the
        // touchdown and out with the butterfly. Runs 700ms total,
        // slightly overlapping the fade-out so the landing feels
        // celebratory but never lingers.
        Animated.sequence([
          Animated.parallel([
            Animated.timing(sparkleOpacity, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(sparkleScale, {
              toValue: 1.35,
              duration: 260,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(sparkleOpacity, {
              toValue: 0,
              duration: 440,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(sparkleScale, {
              toValue: 1.5,
              duration: 440,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
    ]).start(({ finished }) => {
      if (finished && flight.onLand) {
        try {
          flight.onLand();
        } catch {
          /* never let a bad callback break the animation */
        }
      }
    });

    // Wing wobble — moderate flap, asymmetric to avoid metronomic feel.
    Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: 1,
          duration: 220,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: -1,
          duration: 240,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 18 }
    ).start();

    // Horizontal sway — slow left/right drift.
    Animated.loop(
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: -1,
          duration: 950,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 5 }
    ).start();

    // Vertical bob — separate low-frequency oscillator so the flight
    // path visibly undulates up-and-down on top of the Bezier arc.
    // Offset phase relative to sway so the two axes don't sync into
    // a diagonal drift.
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: -1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 4 }
    ).start();
  }, [progress, opacity, wobble, sway, bob, scaleV, sparkleOpacity, sparkleScale, flight]);

  // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  // Sampled at 17 evenly-spaced points along the path so the
  // trajectory reads as a continuous smooth arc even during the long
  // ~1.5s glide-in phase.
  const samples = Array.from({ length: 17 }, (_, i) => i / 16);
  const bezierAt = (a: number, b: number, c: number) =>
    samples.map((t) => {
      const inv = 1 - t;
      return inv * inv * a + 2 * inv * t * b + t * t * c;
    });
  const xs = bezierAt(flight.startX, flight.midX, flight.targetX);
  const ys = bezierAt(flight.startY, flight.midY, flight.targetY);

  const translateX = progress.interpolate({ inputRange: samples, outputRange: xs });
  const translateY = progress.interpolate({ inputRange: samples, outputRange: ys });

  // Wing wobble → rotation + tiny vertical wing-bob. Gentle amplitudes
  // so the flap reads as *alive*, not *manic*.
  const rotate = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-12deg", "12deg"],
  });
  const wingBob = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: [-2, 2],
  });
  // Body sway → horizontal drift on top of the Bezier. Amplitude
  // tapers to 0 as we approach the target so the landing is precise.
  const trajTaper = progress.interpolate({
    inputRange: [0, 0.9, 1],
    outputRange: [1, 1, 0],
  });
  const swayX = Animated.multiply(
    sway.interpolate({ inputRange: [-1, 1], outputRange: [-22, 22] }),
    trajTaper
  );
  // Vertical bob → slow up/down undulation. Same taper as swayX so
  // the butterfly steadies as it approaches the avatar.
  const bobY = Animated.multiply(
    bob.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }),
    trajTaper
  );

  return (
    <>
      {/* Sparkle at the landing spot — soft golden radial glow.
          Rendered *behind* the butterfly (mounted first) so the
          butterfly appears to sit on top of the glow. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.sparkle,
          {
            left: flight.targetX - SPARKLE_SIZE / 2,
            top: flight.targetY - SPARKLE_SIZE / 2,
            opacity: sparkleOpacity,
            transform: [{ scale: sparkleScale }],
          },
        ]}
      >
        <View style={styles.sparkleInner} />
        <View style={styles.sparkleRing} />
      </Animated.View>
      {/* The butterfly itself. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.butterfly,
          {
            opacity,
            transform: [
              { translateX },
              { translateY },
              { translateX: swayX },
              { translateY: bobY },
              { translateY: wingBob },
              { rotate },
              { scale: scaleV },
            ],
          },
        ]}
      >
        <GeorgeButterflyMark size={44} />
      </Animated.View>
    </>
  );
}

const SPARKLE_SIZE = 92;

const styles = StyleSheet.create({
  butterfly: {
    position: "absolute",
    left: -22, // center the 44px emoji on its (x, y) coordinate
    top: -22,
  },
  emoji: {
    fontSize: 44,
    textShadowColor: "rgba(139,92,246,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  sparkle: {
    position: "absolute",
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  // Warm golden core — soft gradient look via a filled circle with
  // heavy blur/shadow. Approximates a radial glow on both native and
  // web without needing an SVG.
  sparkleInner: {
    position: "absolute",
    width: SPARKLE_SIZE * 0.55,
    height: SPARKLE_SIZE * 0.55,
    borderRadius: SPARKLE_SIZE,
    backgroundColor: "rgba(253, 224, 71, 0.55)", // amber-300 @ 55%
    shadowColor: "#FDE047",
    shadowOpacity: 0.9,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  // Outer amber ring — very subtle, softens the glow's edge.
  sparkleRing: {
    position: "absolute",
    width: SPARKLE_SIZE,
    height: SPARKLE_SIZE,
    borderRadius: SPARKLE_SIZE,
    borderWidth: 1.5,
    borderColor: "rgba(251, 191, 36, 0.35)", // amber-400 @ 35%
  },
});
