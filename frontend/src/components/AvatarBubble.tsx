/**
 * AvatarBubble — renders either an emoji avatar (text) or a profile photo
 * (image) depending on whether the stored `value` is a URL.
 *
 * Why this exists:
 *   Native FriendPlace accounts pick an emoji avatar (🙂 🌸 🎨 …). Google
 *   sign-in users instead get a Google photo URL stored in `user.avatar`.
 *   Without this helper, those URLs render as raw text inside the avatar
 *   circle (👀 ugly bug). This component transparently switches between
 *   <Text> and <Image> so callers can stay simple.
 *
 * Glasses overlay:
 *   The PeopleAvatarPicker can opt-in to a glasses accessory. We store this
 *   by appending the marker `::g` to the avatar string (e.g. "👨🏽‍🦰::g"
 *   or "https://…/photo.jpg::g"). At render time we strip the marker and
 *   overlay a small 👓 badge in the top-right corner of the bubble.
 *   The marker is intentionally URL-safe (no special chars) and unlikely to
 *   collide with any emoji sequence or photo URL.
 *
 * Usage:
 *   <AvatarBubble value={user.avatar} size={40} />
 *   <AvatarBubble value={user.avatar} size={60} fallback="🙂" />
 */
import React from "react";
import { View, Image, Text, StyleProp, TextStyle, ImageStyle, ViewStyle } from "react-native";

type Props = {
  value?: string | null;
  /** Visual size in points (square). Defaults to 32. Used for Image sizing
   * and — unless `textSize` is provided — also drives the emoji font size. */
  size?: number;
  /** Optional separate emoji glyph size. Useful when the container is a
   * larger circle (e.g. a coffee-table chair) and we want the image to
   * fill it while keeping the emoji visually proportional. */
  textSize?: number;
  /** Emoji to show if `value` is empty. */
  fallback?: string;
  /** Optional style overrides applied to the rendered element. */
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Optional wrapper style — only used when an accessory overlay is rendered. */
  containerStyle?: StyleProp<ViewStyle>;
};

const URL_RE = /^https?:\/\//i;
const GLASSES_MARK = "::g";

/** Strip the trailing `::g` marker (if any) and return the bare avatar
 * value plus a boolean indicating whether glasses should be overlaid. */
export function parseAvatar(value?: string | null): { base: string | null; glasses: boolean } {
  if (!value) return { base: null, glasses: false };
  if (value.endsWith(GLASSES_MARK)) {
    return { base: value.slice(0, -GLASSES_MARK.length), glasses: true };
  }
  return { base: value, glasses: false };
}

/** Append the `::g` marker to an avatar value. Idempotent — won't double up. */
export function withGlasses(value: string, glasses: boolean): string {
  const { base } = parseAvatar(value);
  return glasses ? `${base ?? ""}${GLASSES_MARK}` : (base ?? "");
}

export default function AvatarBubble({
  value,
  size = 32,
  textSize,
  fallback = "🙂",
  textStyle,
  imageStyle,
  containerStyle,
}: Props) {
  const { base, glasses } = parseAvatar(value);

  // Treat http(s) URLs as photos; everything else (emoji or empty) as text.
  const isUrl = !!(base && URL_RE.test(base));
  const fs = textSize ?? Math.round(size * 0.7);

  const inner = isUrl ? (
    <Image
      source={{ uri: base as string }}
      // resizeMode="cover" ensures the photo fills the circular frame
      // without distortion; combined with overflow:"hidden" it produces
      // a clean circular crop centred on the source. Users who dislike
      // the crop can re-upload with the built-in square editor from
      // expo-image-picker (allowsEditing:true, aspect:[1,1]).
      resizeMode="cover"
      style={[
        { width: size, height: size, borderRadius: size / 2, overflow: "hidden" },
        imageStyle,
      ]}
      accessibilityIgnoresInvertColors
    />
  ) : (
    // Emoji avatar — wrap the Text in a fixed-size flex container so the
    // glyph sits perfectly centred (both axes) regardless of the emoji's
    // natural baseline. Without this wrapper the previous flat Text
    // rendered slightly bottom-left, giving the "crooked" look users
    // reported on Profile / New Members / member list surfaces.
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        // Emoji uses its own coloured glyph; the wrapper doesn't need
        // a background of its own — the parent surface (chair, tile,
        // avatar row) provides the disc.
      }}
    >
      <Text
        style={[
          { fontSize: fs, lineHeight: fs + 2, textAlign: "center", includeFontPadding: false },
          textStyle,
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {base || fallback}
      </Text>
    </View>
  );

  if (!glasses) {
    return inner;
  }

  // Wrap in a sizing container so we can absolutely-position the glasses
  // badge in the top-right corner. We *don't* clip — the glasses should
  // poke slightly outside the circle for a confident, readable accent.
  const badgeSize = Math.max(Math.round(size * 0.55), 18);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        },
        containerStyle,
      ]}
    >
      {inner}
      <Text
        // Anchored to the upper portion of the face — most emoji "head"
        // glyphs centre their eyes around ~30–35% from the top, so a slight
        // top-bias makes the glasses sit naturally over the eyes. We nudge
        // a touch right so the badge doesn't crowd the left ear.
        style={{
          position: "absolute",
          top: Math.round(size * 0.18),
          fontSize: badgeSize,
          lineHeight: badgeSize + 2,
          // Cast shadow so the glasses stay visible on busy/colourful
          // emoji faces (e.g. when the hair colour matches the frame).
          textShadowColor: "rgba(0,0,0,0.35)",
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 2,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        👓
      </Text>
    </View>
  );
}
