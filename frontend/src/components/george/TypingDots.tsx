/**
 * TypingDots — three warm dots pulsing while George is thinking.
 *
 * Batch B fix (Garry, TestFlight 1027 — "restore animated thinking
 * bubbles"). Replaces the platform ActivityIndicator that read as
 * cold and mechanical in the George Onboarding and Event Creation
 * surfaces with a stagger-animated three-dot indicator that matches
 * the George bubble palette.
 *
 * Renders inside the same bubble shell the George turns use, so the
 * indicator visually feels like a real "in-progress reply" rather
 * than a generic spinner.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

interface Props {
  /** Dot colour — defaults to a warm teal that reads as George's voice. */
  color?: string;
  /** Individual dot size in px. */
  size?: number;
  /** Test id for automation. */
  testID?: string;
}

export function TypingDots({ color = '#0F766E', size = 8, testID }: Props) {
  const a = useSharedValue(0.3);
  const b = useSharedValue(0.3);
  const c = useSharedValue(0.3);

  useEffect(() => {
    const animate = (sv: Animated.SharedValue<number>, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) }),
            withTiming(0.3, { duration: 350, easing: Easing.in(Easing.quad) }),
          ),
          -1,
        ),
      );
    };
    animate(a, 0);
    animate(b, 160);
    animate(c, 320);
    return () => {
      a.value = 0.3;
      b.value = 0.3;
      c.value = 0.3;
    };
  }, [a, b, c]);

  const styleA = useAnimatedStyle(() => ({ opacity: a.value, transform: [{ scale: 0.85 + a.value * 0.3 }] }));
  const styleB = useAnimatedStyle(() => ({ opacity: b.value, transform: [{ scale: 0.85 + b.value * 0.3 }] }));
  const styleC = useAnimatedStyle(() => ({ opacity: c.value, transform: [{ scale: 0.85 + c.value * 0.3 }] }));

  const dotStyle = {
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: color, marginHorizontal: size * 0.35,
  };

  return (
    <View
      style={styles.row}
      accessibilityLabel="George is thinking"
      accessibilityRole="progressbar"
      testID={testID ?? 'george-typing-dots'}
    >
      <Animated.View style={[dotStyle, styleA]} />
      <Animated.View style={[dotStyle, styleB]} />
      <Animated.View style={[dotStyle, styleC]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
});

export default TypingDots;
