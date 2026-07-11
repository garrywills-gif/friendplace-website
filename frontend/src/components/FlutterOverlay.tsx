/**
 * FlutterOverlay — the signature FriendPlace celebration.
 *
 * When `emitFlutter({ targetX?, targetY? })` fires, a single butterfly
 * gently glides from the lower-left thumb region along a soft curved
 * (quadratic Bezier) path, briefly "lands" near the recipient (either
 * the provided target coordinates or a sensible upper-right default),
 * then fades out. A small "🦋 Flutter sent!" toast appears near the
 * top of the screen in parallel for ~1s.
 *
 * Design decisions:
 *   - ONE butterfly (previously 3-5) — feels intimate and personal.
 *   - Timing: fly ~1.15s + land pulse ~260ms + fade ~260ms ≈ 1.4s total.
 *     Fly is intentionally 10-20% slower than the previous multi-fly
 *     version so it reads as a graceful glide, not a zip.
 *   - Curved path: quadratic Bezier with the control point lifted well
 *     above the midpoint so the butterfly arcs up-and-over. A gentle
 *     sinusoidal wobble is layered on top for that fluttery wing feel.
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

      setFlight({ id: ++nextId, startX, startY, targetX, targetY, midX, midY });

      // Toast — fades in, holds, fades out. ~1s of visible dwell time.
      setToastVisible(true);
      toastOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(780),
        Animated.timing(toastOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => setToastVisible(false));

      // Full animation window (fly + land + fade) — clean up state a
      // little after so React doesn't drop the animated view mid-fade.
      setTimeout(() => {
        setFlight((cur) => (cur && cur.id === nextId ? null : cur));
      }, 1700);
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
  // Progress along the Bezier (0 → 1). Slower than the old flight so
  // the arc reads as a graceful glide.
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Wing wobble — a gentle sinusoidal rotation layered on top of the
  // main path. Runs faster than the flight so the wings look alive.
  const wobble = useRef(new Animated.Value(0)).current;
  // Landing "settle" pulse — a tiny scale bounce at the target so the
  // butterfly reads as "arrived" instead of just vanishing mid-flight.
  const landScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Fade-in → hold → fade-out driven by absolute timings so it stays
    // in sync with the fly + landing phases.
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1000),
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();

    // Main flight — 1.15s along the Bezier, then a soft landing pulse.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 1150,
        // easeInOutQuad-ish — starts gently, glides, settles into the
        // landing spot rather than snapping to the endpoint.
        easing: Easing.bezier(0.34, 0.05, 0.24, 1),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(landScale, {
            toValue: 1.18,
            duration: 140,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(landScale, {
            toValue: 1.0,
            duration: 160,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    // Wing wobble loops the whole flight (well past the landing so the
    // wings keep beating during the settle pulse). Slightly asymmetric
    // duration to avoid a metronomic feel.
    Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: 1,
          duration: 190,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: -1,
          duration: 210,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 6 }
    ).start();
  }, [progress, opacity, wobble, landScale]);

  // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  // We approximate B(t) via interpolation with sample points at
  // t = 0, 0.25, 0.5, 0.75, 1.0 so the trajectory follows a real arc
  // instead of a straight line between endpoints.
  const bezier = (a: number, b: number, c: number) => {
    return [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const inv = 1 - t;
      return inv * inv * a + 2 * inv * t * b + t * t * c;
    });
  };
  const xs = bezier(flight.startX, flight.midX, flight.targetX);
  const ys = bezier(flight.startY, flight.midY, flight.targetY);

  const translateX = progress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: xs,
  });
  const translateY = progress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ys,
  });

  // Wing wobble maps to a small rotation + tiny vertical bob for a
  // convincing "flapping wings" impression.
  const rotate = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-14deg", "14deg"],
  });
  const wobbleY = wobble.interpolate({
    inputRange: [-1, 1],
    outputRange: [-3, 3],
  });

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
            { translateY: wobbleY },
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
