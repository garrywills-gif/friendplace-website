/**
 * FlutterOverlay — celebratory butterfly animation shown whenever
 * `emitFlutter()` is called. Mounted once at the root layout so it
 * renders on top of any screen.
 *
 * Design:
 *   - N butterflies (default 4) drift up-and-right from the lower-left
 *     quadrant to the upper-right, each with a slight arc, rotation
 *     wobble and gentle sinusoidal drift so it feels alive.
 *   - Each butterfly runs for ~1.6s then fades. Stagger of ~120ms
 *     between spawns gives a natural "flutter" feel.
 *   - `pointerEvents="none"` so the overlay never intercepts taps.
 *   - No dependency on Reanimated — uses the RN core `Animated` API so
 *     it works everywhere the app runs.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { _subscribeFlutter } from "@/src/lib/flutter-fx";

type Butterfly = {
  id: number;
  startX: number;    // absolute px
  startY: number;
  endX: number;
  endY: number;
  rotStart: number;  // degrees
  rotEnd: number;
  scale: number;
  emoji: string;
  delay: number;
};

let nextId = 0;

export default function FlutterOverlay() {
  const { width: winW, height: winH } = useWindowDimensions();
  const [butterflies, setButterflies] = useState<Butterfly[]>([]);

  useEffect(() => {
    const unsub = _subscribeFlutter((count) => {
      // Spawn `count` butterflies from the lower-left area, each with
      // slightly different trajectories. All are cleaned up after the
      // animation completes so the overlay never accumulates state.
      const spawned: Butterfly[] = [];
      for (let i = 0; i < count; i++) {
        const startX = winW * (0.05 + Math.random() * 0.2);
        const startY = winH * (0.75 + Math.random() * 0.15);
        const endX = winW * (0.65 + Math.random() * 0.3);
        const endY = winH * (0.05 + Math.random() * 0.2);
        spawned.push({
          id: nextId++,
          startX,
          startY,
          endX,
          endY,
          rotStart: (Math.random() - 0.5) * 30,
          rotEnd: (Math.random() - 0.5) * 60,
          scale: 0.85 + Math.random() * 0.5,
          emoji: "🦋",
          delay: i * 120,
        });
      }
      setButterflies((prev) => [...prev, ...spawned]);
      // Clean up after the longest possible animation duration.
      const totalMs = 1600 + spawned.length * 120 + 400;
      setTimeout(() => {
        setButterflies((prev) => prev.filter((b) => !spawned.some((s) => s.id === b.id)));
      }, totalMs);
    });
    return unsub;
  }, [winW, winH]);

  if (butterflies.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {butterflies.map((b) => (
        <FlutterButterfly key={b.id} b={b} />
      ))}
    </View>
  );
}

function FlutterButterfly({ b }: { b: Butterfly }) {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // Vertical wobble — sinusoidal up/down drift so the butterfly doesn't
  // travel in a boring straight line. Independent from `progress` so the
  // wobble is layered over the main flight path.
  const wobble = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(b.delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(progress, {
          toValue: 1,
          duration: 1600,
          easing: Easing.bezier(0.25, 0.1, 0.35, 1.0),
          useNativeDriver: true,
        }),
        // Wobble loops a couple of times over the flight.
        Animated.loop(
          Animated.sequence([
            Animated.timing(wobble, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(wobble, { toValue: -1, duration: 420, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          { iterations: 3 }
        ),
      ]),
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [b, progress, opacity, wobble]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [b.startX, b.endX],
  });
  const translateYRaw = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [b.startY, b.endY],
  });
  const wobbleY = wobble.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] });
  const translateY = Animated.add(translateYRaw, wobbleY);
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [`${b.rotStart}deg`, `${b.rotEnd}deg`],
  });

  return (
    <Animated.View
      style={[
        styles.butterfly,
        {
          opacity,
          transform: [{ translateX }, { translateY }, { rotate }, { scale: b.scale }],
        },
      ]}
    >
      <Text style={styles.emoji}>{b.emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  butterfly: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  emoji: {
    fontSize: 48,
    // Slight text-shadow gives depth so the butterfly reads on any
    // background it happens to fly past.
    textShadowColor: "rgba(15,118,110,0.28)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
