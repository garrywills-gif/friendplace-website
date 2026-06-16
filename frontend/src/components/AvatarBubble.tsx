/**
 * AvatarBubble — renders either an emoji avatar (text) or a profile photo
 * (image) depending on whether the stored `value` is a URL.
 *
 * Why this exists:
 *   Native YouBelong accounts pick an emoji avatar (🙂 🌸 🎨 …). Google
 *   sign-in users instead get a Google photo URL stored in `user.avatar`.
 *   Without this helper, those URLs render as raw text inside the avatar
 *   circle (👀 ugly bug). This component transparently switches between
 *   <Text> and <Image> so callers can stay simple.
 *
 * Usage:
 *   <AvatarBubble value={user.avatar} size={40} />
 *   <AvatarBubble value={user.avatar} size={60} fallback="🙂" />
 */
import React from "react";
import { Image, Text, StyleProp, TextStyle, ImageStyle } from "react-native";

type Props = {
  value?: string | null;
  /** Visual size in points (square). Defaults to 32. */
  size?: number;
  /** Emoji to show if `value` is empty. */
  fallback?: string;
  /** Optional style overrides applied to the rendered element. */
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

const URL_RE = /^https?:\/\//i;

export default function AvatarBubble({
  value,
  size = 32,
  fallback = "🙂",
  textStyle,
  imageStyle,
}: Props) {
  // Treat http(s) URLs as photos; everything else (emoji or empty) as text.
  if (value && URL_RE.test(value)) {
    return (
      <Image
        source={{ uri: value }}
        style={[
          { width: size, height: size, borderRadius: size / 2 },
          imageStyle,
        ]}
        accessibilityIgnoresInvertColors
      />
    );
  }
  // Match the previous in-app convention of ~70% glyph fill inside the circle.
  return (
    <Text style={[{ fontSize: Math.round(size * 0.7), lineHeight: size }, textStyle]}>
      {value || fallback}
    </Text>
  );
}
