import React from 'react';
import { Image } from 'react-native';

/**
 * The FriendPlace butterfly mark — React Native mirror of the web
 * mark at `/app/website/components/george/GeorgeButterflyMark.tsx`.
 *
 * Renders the master marketing butterfly asset — the single source of
 * truth for the FriendPlace butterfly. If the master artwork ever
 * changes, replace `/app/frontend/assets/brand/friendplace-butterfly.png`
 * (and its web mirror at `/app/website/public/brand-assets/butterfly.png`)
 * and every surface picks it up automatically.
 *
 * Animation lives in the parent (`GeorgeButterfly.tsx`) via Reanimated
 * transforms so this component stays a pure image renderer.
 */
interface Props {
  size?: number;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BUTTERFLY = require('../../../assets/brand/friendplace-butterfly.png');

export function GeorgeButterflyMark({ size = 48 }: Props) {
  return (
    <Image
      source={BUTTERFLY}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
