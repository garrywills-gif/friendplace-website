/**
 * FlutterOverlay — the signature FriendPlace celebration.
 *
 * When `emitFlutter({ targetX?, targetY? })` fires, a single butterfly
 * drifts from the lower-left thumb region along a naturalistic curved
 * path — pausing, bobbing and gently arcing the way a real Monarch
 * moves through the garden — briefly "lands" near the recipient
 * (either the provided target coordinates or a sensible upper-right
 * default), then fades out. A small "🦋 Flutter sent!" toast appears
 * near the top of the screen for the duration of the flight.
 *
 * Design decisions:
 *   - ONE butterfly (previously 3-5) — feels intimate and personal.
 *   - Timing: fly ~3.0s + land pulse ~320ms + fade ~400ms ≈ 3.7s total.
 *     The extra dwell time lets the flight *breathe*: real butterflies
 *     never zip across a room, so we deliberately give the animation
 *     enough runway to feel like a nature moment, not a UI ping.
 *   - Curved path: quadratic Bezier with the control point lifted well
 *     above the midpoint so the butterfly arcs up-and-over. A gentle
 *     asymmetric sway (slow, larger side-to-side drift) is layered on
 *     top of a faster wing-flap wobble for that "living creature" feel.
 *   - Easing.bezier(0.55, 0.05, 0.45, 0.95) — an ease-in-out that gives
 *     the butterfly a soft launch and a graceful settle at the target.
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
};

let nextId = 0;

export default function FlutterOverlay() {
  const { width: winW, height: winH } = useWindowDimensions();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

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
      setFlight({ id, startX, startY, targetX, targetY, midX, midY });

      // Toast — fades in, holds for the length of the flight, fades
      // out. Total dwell (~3s) matches the butterfly's flight time so
      // both parts of the moment resolve together.
      setToastVisible(true);
      toastOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.delay(2600),
        Animated.timing(toastOpacity, { toValue: 0, duration: 380, useNativeDriver: true }),
      ]).start(() => setToastVisible(false));

      // Full animation window (fly + land + fade) — clean up state a
      // little after so React doesn't drop the animated view mid-fade.
      setTimeout(() => {
        setFlight((cur) => (cur && cur.id === id ? null : cur));
      }, 4000);
    });
    return unsub;
  }, [winW, winH, toastOpacity]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flight && <Butterfly key={flight.id} flight={flight} />}
      {toastVisible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastWrap,
            { top: Math.max(56, winH * 0.12), opacity: toastOpacity },
          ]}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <View style={styles.toast}>
            <Text style={styles.toastText}>🦋 Flutter sent!</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function Butterfly({ flight }: { flight: Flight }) {
  // Progress along the Bezier (0 → 1). Extended to ~3s so the butterfly
  // drifts across the screen at a naturalistic pace rather than zipping.
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Wing wobble — a rapid sinusoidal rotation layered on top of the
  // main path. Runs at real-butterfly wing speed (~5-8Hz) so even
  // though the *body* moves slowly, the wings still look alive.
  const wobble = useRef(new Animated.Value(0)).current;
  // Slow, larger side-to-side sway on top of the Bezier. Real
  // butterflies never fly a clean arc — they drift left/right as they
  // go. This is a separate low-frequency oscillator so it can be much
  // slower (and wider) than the wing flap.
  const sway = useRef(new Animated.Value(0)).current;
  // Landing "settle" pulse — a tiny scale bounce at the target so the
  // butterfly reads as "arrived" instead of just vanishing mid-flight.
  const landScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Fade-in → hold → fade-out driven by absolute timings so it stays
    // in sync with the fly + landing phases (fly 3000 + land 320 + hold
    // briefly + fade 400 = ~3.7s window).
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();

    // Main flight — 3.0s along the Bezier, then a soft landing pulse.
    // Ease-in-out gives the butterfly a soft launch and graceful settle.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 3000,
        easing: Easing.bezier(0.55, 0.05, 0.45, 0.95),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(landScale, {
          toValue: 1.22,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(landScale, {
          toValue: 1.0,
          duration: 180,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Wing wobble — fast flaps that continue for the full flight.
    // Slightly asymmetric duration to avoid a metronomic feel.
    Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: 1,
          duration: 170,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: -1,
          duration: 190,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 18 }
    ).start();

    // Body sway — slow, wide left/right drift so the Bezier path is
    // *disturbed* rather than followed rigidly. ~4 gentle cycles over
    // the flight.
    Animated.loop(
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 1,
          duration: 780,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: -1,
          duration: 780,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 4 }
    ).start();
  }, [progress, opacity, wobble, sway, landScale]);

  // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  // Sampled at 9 points along the path so the trajectory follows a
  // smooth arc even after the animation is slowed to 3s (fewer sample
  // points would make the linear-interp segments visible).
  const samples = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
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
  // "flapping wings" impression.
  const rotate = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-16deg", "16deg"],
  });
  const wingBob = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: [-3, 3],
  });
  // Body sway → horizontal drift that layers over the main flight so
  // the trajectory looks meandering, not scripted. Amplitude tapers
  // toward the end so the landing is precise (butterfly steadies as it
  // approaches its rest spot).
  const swayX = Animated.multiply(
    sway.interpolate({ inputRange: [-1, 1], outputRange: [-28, 28] }),
    progress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] })
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
            { scale: landScale },
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
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    backgroundColor: "rgba(30, 41, 59, 0.94)", // slate-800 @ ~94%
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  toastText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
