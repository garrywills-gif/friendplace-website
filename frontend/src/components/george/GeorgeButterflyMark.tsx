import React from 'react';
import Svg, { Defs, LinearGradient, Stop, RadialGradient, Path, Ellipse, Circle, G } from 'react-native-svg';

/**
 * The FriendPlace butterfly mark — native SVG version of the web mark
 * at `/app/website/components/george/GeorgeButterflyMark.tsx`. Same
 * shape, same brand palette (teal → cyan with a deeper teal body).
 *
 * Kept dependency-free so animation lives entirely in the parent
 * (`GeorgeButterfly.tsx`) via Reanimated. The two wings are separate
 * `<G>` groups so future work can animate them independently if
 * needed (e.g. an asymmetric wave when the butterfly greets someone).
 */
interface Props {
  size?: number;
}

export function GeorgeButterflyMark({ size = 48 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="fp-wing-a" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#5EEAD4" />
          <Stop offset="55%" stopColor="#14B8A6" />
          <Stop offset="100%" stopColor="#0EA5E9" />
        </LinearGradient>
        <LinearGradient id="fp-wing-b" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#5EEAD4" />
          <Stop offset="55%" stopColor="#14B8A6" />
          <Stop offset="100%" stopColor="#0EA5E9" />
        </LinearGradient>
        <RadialGradient id="fp-wing-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.75" />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      <G>
        <Path
          d="M31 32 C 22 12, 8 10, 3 22 C 0 30, 6 40, 14 46 C 22 50, 28 46, 31 40 Z"
          fill="url(#fp-wing-a)"
        />
        <Ellipse cx="18" cy="26" rx="6" ry="5" fill="url(#fp-wing-glow)" />
      </G>

      <G>
        <Path
          d="M33 32 C 42 12, 56 10, 61 22 C 64 30, 58 40, 50 46 C 42 50, 36 46, 33 40 Z"
          fill="url(#fp-wing-b)"
        />
        <Ellipse cx="46" cy="26" rx="6" ry="5" fill="url(#fp-wing-glow)" />
      </G>

      <Ellipse cx="32" cy="33" rx="2" ry="12" fill="#0F766E" />
      <Circle cx="32" cy="22" r="3" fill="#0F766E" />
      <Path d="M32 20 C 30 15, 28 14, 27 12" stroke="#0F766E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <Path d="M32 20 C 34 15, 36 14, 37 12" stroke="#0F766E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <Circle cx="27" cy="12" r="1.2" fill="#0F766E" />
      <Circle cx="37" cy="12" r="1.2" fill="#0F766E" />
    </Svg>
  );
}
