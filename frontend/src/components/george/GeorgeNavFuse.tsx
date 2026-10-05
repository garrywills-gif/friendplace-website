/**
 * GeorgeNavFuse — a brief "Opening …" transition shown when George/Georgia
 * navigates the member to a destination.
 *
 * iter211 (Garry, Oct 2026 — RED/POLISH #7): earlier revisions used a
 * centered modal overlay with a dim backdrop. On real iPhones the dim
 * made the final companion message hard to read, and the quick timing
 * still felt rushed. New behaviour:
 *   • Hold for ~8s so there's plenty of time to read the message AND the
 *     "Opening [destination]…" line before the screen changes.
 *   • NO full-screen dim — the chat behind stays fully legible.
 *   • Small non-blocking banner anchored to the bottom of the screen with
 *     the butterfly, label, and a visible progress fuse bar.
 *   • `pointerEvents="none"` on the overlay so taps still reach the chat
 *     underneath (gentle handoff, not a modal takeover).
 *
 * Usage:
 *   const [navTo, setNavTo] = useState<{label; run: () => void} | null>(null);
 *   {navTo && <GeorgeNavFuse label={navTo.label} onDone={navTo.run} />}
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Platform } from 'react-native';
import { GeorgeButterflyMark } from '@/src/components/george/GeorgeButterflyMark';
import { useTheme } from '@/src/lib/theme';

// iter233 (Neo, Oct 2026 — final polish #1): user asked for a
// generous read window on "Take me to…" handoffs. 7.5s leaves
// comfortable time to finish reading George's final message AND
// the "Opening [destination]… 🦋" banner before the screen changes.
// The screen behind stays bright (no dim backdrop) and the fuse
// is non-blocking. ``GeorgeCompanionChat`` fires the pending nav
// from its Close button so an early tap never cancels the handoff.
const DURATION_MS = 7500;

export default function GeorgeNavFuse({
  label,
  onDone,
}: {
  label: string;
  onDone: () => void;
}) {
  const { c, scale } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const doneRef = useRef(false);

  useEffect(() => {
    // Fade/slide the banner in from the bottom edge so the appearance is
    // felt as a gentle "something is about to happen", not a popup.
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 70 }),
    ]).start();
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
    // pointerEvents="none" lets taps fall through to the chat behind so
    // this really is a non-blocking handoff. The underlying screen stays
    // fully readable and interactive right up to the moment of navigation.
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border, opacity, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.row}>
          <GeorgeButterflyMark size={34} />
          <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.title, { color: c.text, fontSize: 15 * scale }]}>
              Opening {label}…
            </Text>
            <View style={[styles.track, { backgroundColor: c.border }]}>
              <Animated.View style={[styles.fill, { width, backgroundColor: c.primary }]} />
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // iter211: NO dim backdrop. We only occupy the bottom slice of the
    // screen; everything above remains fully visible.
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 32,
    zIndex: 10000,
    ...Platform.select({ web: { position: 'fixed' as any }, default: {} }),
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#0D2A57',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontWeight: '800' },
  track: { width: '100%', height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 8 },
  fill: { height: '100%', borderRadius: 999 },
});
