/**
 * GeorgeNavFuse — a brief "Opening …" transition shown when George/Georgia
 * navigates the member to a destination.
 *
 * Why (Garry, Sep 2026): the jump to Find Friends used to fire so fast the
 * member couldn't read George's final message. This paints a calm overlay
 * with the butterfly, an "Opening {label}…" line and a ~1.2 s fuse bar, THEN
 * calls `onDone()` to perform the actual route change. Give the member a
 * beat to register where they're being taken.
 *
 * Usage:
 *   const [navTo, setNavTo] = useState<{label; run: () => void} | null>(null);
 *   {navTo && <GeorgeNavFuse label={navTo.label} onDone={navTo.run} />}
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { GeorgeButterflyMark } from '@/src/components/george/GeorgeButterflyMark';
import { useTheme } from '@/src/lib/theme';

const DURATION_MS = 1200;

export default function GeorgeNavFuse({
  label,
  onDone,
}: {
  label: string;
  onDone: () => void;
}) {
  const { c, scale } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(false);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
    const t = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    }, DURATION_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] });

  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <GeorgeButterflyMark size={44} />
        <Text style={[styles.title, { color: c.text, fontSize: 17 * scale }]}>
          Opening {label}…
        </Text>
        <View style={[styles.track, { backgroundColor: c.border }]}>
          <Animated.View style={[styles.fill, { width, backgroundColor: c.primary }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,37,87,0.35)',
    zIndex: 10000,
  },
  card: {
    width: 260,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 14,
    shadowColor: '#0D2A57',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  title: { fontWeight: '800', textAlign: 'center' },
  track: { width: '100%', height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
