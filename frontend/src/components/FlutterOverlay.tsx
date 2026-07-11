/**
 * FlutterOverlay — the signature FriendPlace celebration.
 *
 * When `emitFlutter({ targetX?, targetY?, onLand? })` fires, a single
 * butterfly drifts from the lower-left thumb region along a
 * naturalistic curved path — briefly resting mid-flight the way a
 * real Monarch touches down on a flower, then gliding on to the
 * recipient. The overlay renders ONLY the butterfly; the caller's
 * "Flutter sent to X" toast fires via the `onLand` callback so it
 * lands with the butterfly instead of racing ahead of it.
 *
 * Design decisions:
 *   - ONE butterfly (previously 3-5) — feels intimate and personal.
 *   - Timing:
 *       fly-out ~1.3s → mid-flight rest ~700ms → glide-in ~1.5s →
 *       landing pulse ~340ms → fade ~460ms ≈ 4.3s total.
 *     The rest beat mimics a butterfly touching a flower mid-journey
 *     and gives the whole moment a story arc: launch → pause → arrive.
 *   - Smoother motion: 17-point Bezier sampling (previously 9) so the
 *     curve no longer shows tiny linear-interp seams during the long
 *     glide, gentler wing-flap rotation (±12deg) and a smaller vertical
 *     wing-bob (±2px) so the butterfly no longer looks jittery, and
 *     sway amplitude reduced (±22px) so the drift feels graceful
 *     rather than erratic.
 *   - `pointerEvents="none"` on the root — never intercepts taps.
 *   - Uses core RN `Animated` (not Reanimated) so it works on iOS,
 *     Android, and the Expo web preview identically.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { _subscribeFlutter } from "@/src/lib/flutter-fx";

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

export default function FlutterOverlay() {
  const { width: winW, height: winH } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);

  useEffect(() => {
    const unsub = _subscribeFlutter((opts) => {
      // Clamp the target inside the visible viewport with a small
      // margin so the butterfly never lands off-screen (which happens
      // when a caller measures a partially-scrolled element).
      const margin = 40;
      const targetX =
        typeof opts.targetX === "number"
          ? Math.max(margin, Math.min(winW - margin, opts.targetX))
          : winW * 0.78;
      const targetY =
        typeof opts.targetY === "number"
          ? Math.max(margin, Math.min(winH - margin, opts.targetY))
          : winH * 0.22;

      // Start position: lower-left thumb region. Slight random jitter
      // so consecutive flutters don't look robotic.
      const startX = winW * (0.12 + Math.random() * 0.08);
      const startY = winH * (0.82 + Math.random() * 0.06);

      // Control point of the quadratic Bezier: sits above the straight
      // line between start and target, biased toward the start so the
      // butterfly rises first then descends to the target — a natural
      // arc rather than a straight diagonal.
      const midX = startX + (targetX - startX) * 0.45;
      // Arc height scales with the vertical distance but is capped so
      // shorter flights don't loop absurdly high.
      const arcHeight = Math.min(200, Math.max(90, Math.abs(startY - targetY) * 0.55));
      const midY = Math.min(startY, targetY) - arcHeight;

      const id = ++nextId;
      setFlight({ id, startX, startY, targetX, targetY, midX, midY, onLand: opts.onLand });

      // Full animation window (fly-out + rest + glide-in + landing +
      // fade) — clean up a bit after the fade so React doesn't drop
      // the animated view mid-transition.
      setTimeout(() => {
        setFlight((cur) => (cur && cur.id === id ? null : cur));
      }, 4600);
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
  // Progress along the Bezier (0 → 1). Split into three phases (see
  // the flight sequence below) so the butterfly can pause mid-flight.
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Wing wobble — a rapid sinusoidal rotation layered on top of the
  // main path. Runs at real-butterfly wing speed (~4-5Hz) so even
  // though the *body* moves slowly, the wings still look alive.
  const wobble = useRef(new Animated.Value(0)).current;
  // Slow, larger side-to-side sway on top of the Bezier. Real
  // butterflies never fly a clean arc — they drift left/right as they
  // go. This is a separate low-frequency oscillator so it can be much
  // slower (and wider) than the wing flap.
  const sway = useRef(new Animated.Value(0)).current;
  // Scale is driven by TWO events:
  //   1. A soft "settle" pulse during the mid-flight rest.
  //   2. A final "landing" pulse when the butterfly reaches the
  //      recipient.
  const scaleV = useRef(new Animated.Value(1)).current;

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
    //   PHASE 1 (fly-out, 1300ms): progress 0 → 0.42 with ease-in-out
    //     so the butterfly launches softly and eases into the rest
    //     point (no abrupt stop).
    //   REST (700ms): progress holds at 0.42. Wing wobble and sway
    //     keep going (they're separate loops), so the butterfly
    //     visibly "flexes" on its imaginary flower. A tiny scale bump
    //     (1.0 → 1.08 → 1.0) reinforces the settle.
    //   PHASE 2 (glide-in, 1500ms): progress 0.42 → 1 with ease-in-out
    //     so the butterfly builds momentum out of the rest, then
    //     softly decelerates onto the target — matching the exit
    //     velocity of phase 1 for continuous-looking motion.
    //   LANDING (340ms): a bigger scale pulse (1.0 → 1.22 → 1.0) at
    //     the target so it reads as "arrived". After the pulse we
    //     fire `onLand` — that's when the caller's "Flutter sent to X"
    //     toast appears, so the message arrives *with* the butterfly.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 0.42,
        duration: 1300,
        // Symmetric ease-in-out: zero velocity at both boundaries so
        // the transition into the rest is buttery smooth.
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
        // Ease-in-out again: matches the exit velocity of phase 1
        // (zero) so the resume out of the rest is imperceptible in
        // terms of velocity change, and the arrival at the target is
        // a gentle settle rather than a snap.
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
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
    ]).start(({ finished }) => {
      if (finished && flight.onLand) {
        try {
          flight.onLand();
        } catch {
          /* never let a bad callback break the animation */
        }
      }
    });

    // Wing wobble — moderate flaps that run for the full animation.
    // Slower than before (a rapid flap made the whole thing feel
    // jittery when the body barely moves during the rest beat).
    // Asymmetric durations avoid a metronomic feel.
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

    // Body sway — slow, gentle left/right drift so the Bezier path is
    // *disturbed* rather than followed rigidly. Longer cycles than
    // before (was 820ms) so the drift feels leisurely instead of
    // anxious.
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
  }, [progress, opacity, wobble, sway, scaleV, flight]);

  // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  // Sampled at 17 evenly-spaced points along the path (up from 9) so
  // the trajectory reads as a continuous smooth arc even during the
  // long ~1.5s glide-in phase. Fewer samples showed subtle "seams" at
  // segment boundaries when the eye tracked the butterfly.
  const samples = Array.from({ length: 17 }, (_, i) => i / 16);
  const bezier = (a: number, b: number, c: number) =>
    samples.map((t) => {
      const inv = 1 - t;
      return inv * inv * a + 2 * inv * t * b + t * t * c;
    });
  const xs = bezier(flight.startX, flight.midX, flight.targetX);
  const ys = bezier(flight.startY, flight.midY, flight.targetY);

  const translateX = progress.interpolate({ inputRange: samples, outputRange: xs });
  const translateY = progress.interpolate({ inputRange: samples, outputRange: ys });

  // Wing wobble → rotation + a tiny vertical bob for a convincing
  // "flapping wings" impression. Reduced amplitudes (±12deg / ±2px)
  // so the flap reads as *alive*, not *manic*.
  const rotate = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-12deg", "12deg"],
  });
  const wingBob = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: [-2, 2],
  });
  // Body sway → horizontal drift that layers over the main flight so
  // the trajectory looks meandering, not scripted. Amplitude tapers
  // toward the end so the landing is precise (butterfly steadies as
  // it approaches its rest spot).
  const swayX = Animated.multiply(
    sway.interpolate({ inputRange: [-1, 1], outputRange: [-22, 22] }),
    progress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [1, 1, 0] })
  );

  return (
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
            { translateY: wingBob },
            { rotate },
            { scale: scaleV },
          ],
        },
      ]}
    >
      <Text style={styles.emoji}>🦋</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  butterfly: {
    position: "absolute",
    left: -22, // center the 44px emoji on its (x, y) coordinate
    top: -22,
  },
  emoji: {
    fontSize: 44,
    // Soft violet glow so the butterfly reads on any background it
    // happens to fly past.
    textShadowColor: "rgba(139,92,246,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
