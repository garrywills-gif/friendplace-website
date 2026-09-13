/**
 * AvatarWithBadge — the single component used across the app to show
 * a member's status glyph beside their avatar. Wraps `AvatarBubble`
 * with a tiny corner badge (bottom-right by default).
 *
 * Per LOCKED design doc §5.4:
 *   • The name beside the avatar is JUST the name — no icon repeat,
 *     no status label. The glyph tells the story.
 *   • Used on: FP Café seats, Find Friends, DM headers, DM list,
 *     group member roster, event attendees. NOT used on message
 *     bubbles, notifications feed, or notices (kept uncluttered).
 *
 * Behaviour:
 *   • If a `status` prop is supplied → render it directly (zero
 *     network). Used by list rows that already have status embedded
 *     via the backend's additive `status` field.
 *   • If only `userId` is supplied → fetch via the debounced batched
 *     lookup in StatusProvider (cheap; coalesces across the whole
 *     visible list).
 *   • If both are missing (or the user is offline) → render just the
 *     avatar with no badge (design §2: Offline shows ⚫ only when we
 *     know it's offline, not when we don't know at all).
 *
 * Never modifies AvatarBubble's own styling — it wraps it inside a
 * sized container so the badge can be absolutely positioned.
 */
import React from "react";
import { View, Text, StyleProp, TextStyle, ImageStyle, ViewStyle, Platform } from "react-native";
import AvatarBubble from "@/src/components/AvatarBubble";
import { useTheme } from "@/src/lib/theme";
import {
  EffectiveStatus,
  STATUS_META,
  useUserBadgeStatus,
} from "@/src/lib/status-context";

type Props = {
  value?: string | null;
  size?: number;
  fallback?: string;
  /** Explicit status. When omitted AND `userId` is provided, falls
   *  back to the batched lookup. */
  status?: EffectiveStatus | null;
  /** Auto-fetch a status by user id. Ignored if `status` is set. */
  userId?: string | null;
  /** Set true only when this avatar represents the signed-in user
   *  themselves — in that case we don't render a badge (people already
   *  know their own status; they can check the My Status card). */
  isSelf?: boolean;
  /** Optional style overrides for the underlying avatar. */
  textSize?: number;
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** Corner to anchor the badge — defaults to bottom-right. */
  corner?: "br" | "bl" | "tr" | "tl";
  /** When false, forces the plain avatar. Useful for message bubbles
   *  and notification feeds (design §5.4 "surfaces intentionally NOT
   *  receiving the badge"). */
  showBadge?: boolean;
  /** When true AND the avatar is a real photo (preset / uploaded /
   *  Google URL), tapping opens the shared full-screen zoom viewer.
   *  Emoji avatars are never zoomable — nothing to see. Callers on
   *  member-profile hero surfaces should pass this; message-bubble
   *  and notification-feed avatars should leave it off. */
  zoomable?: boolean;
  testID?: string;
};

export default function AvatarWithBadge({
  value,
  size = 40,
  fallback = "🙂",
  status,
  userId,
  isSelf = false,
  textSize,
  textStyle,
  imageStyle,
  containerStyle,
  corner = "br",
  showBadge = true,
  zoomable = false,
  testID,
}: Props) {
  const { c } = useTheme();

  // Only subscribe to the batched fetch when the caller didn't pass a
  // pre-known status. This keeps message-bubble/notification-feed
  // renders (which pass showBadge={false}) free of network chatter.
  const fetchIfNeeded = !status && !!userId && !isSelf && showBadge;
  // Hook must be called unconditionally to satisfy Rules of Hooks —
  // gate the effective fetch by passing `null` when not needed.
  const fetched = useUserBadgeStatus(fetchIfNeeded ? userId : null);

  const effective: EffectiveStatus | null = status ?? (isSelf ? null : fetched);

  // Whether to actually show the badge. Bug fix (Garry, 24 Jun 2026):
  // the earlier "hide offline" heuristic buried the fact that most of
  // Garry's testers were showing NO badge at all — every member who
  // hadn't opened the app since Presence & Status shipped had no
  // `member_status` doc and therefore computed as "offline", which
  // this component then silently hid. Result: Kaya, Xanda, Roy and
  // everyone else appeared badge-less next to Admin's butterfly,
  // making it look as though the whole feature was broken.
  //
  // Per Garry's re-issued precedence spec:
  //   Online   → 🟢 green dot as the default presence indicator
  //   Offline  → ⚫ grey/black dot (visible, not hidden)
  //   Looking  → 🦋
  //   In café  → ☕
  //   Busy     → 🟡
  //   Happy    → 😊
  //   Invisible → no badge (future — the backend doesn't emit this
  //                yet; when it does, `effective` will be null for
  //                those users and we'll continue to hide the badge)
  //
  // So the ONLY reasons to hide the badge now are:
  //   • self avatars (Garry's original ask — members don't need to
  //     see their own badge; the "My Status" card is authoritative);
  //   • callers that opt out via `showBadge={false}` (used on message
  //     bubbles + notifications feed to keep those dense surfaces
  //     visually calm);
  //   • unknown status (`effective` is null — the batched fetch
  //     hasn't resolved yet — showing nothing avoids a flicker).
  const shouldShowBadge = showBadge && !isSelf && !!effective;

  // Badge diameter scales with the avatar but stays legible on tiny
  // avatars (min 16). Cap at 26 so it doesn't dominate big avatars.
  const badgeSize = Math.max(16, Math.min(26, Math.round(size * 0.38)));
  const cornerStyle = {
    br: { right: -2, bottom: -2 },
    bl: { left: -2, bottom: -2 },
    tr: { right: -2, top: -2 },
    tl: { left: -2, top: -2 },
  }[corner];

  const meta = effective ? STATUS_META[effective] : null;

  return (
    <View
      testID={testID}
      style={[{ width: size, height: size }, containerStyle]}
    >
      <AvatarBubble
        value={value}
        size={size}
        textSize={textSize}
        fallback={fallback}
        textStyle={textStyle}
        imageStyle={imageStyle}
        zoomable={zoomable}
      />
      {shouldShowBadge && meta ? (
        <View
          accessibilityLabel={meta.label}
          style={[
            {
              position: "absolute",
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: c.surface,
              borderWidth: 2,
              borderColor: c.surface,
              alignItems: "center",
              justifyContent: "center",
              // Subtle shadow so the badge stays visible on any
              // background colour. Cheap on iOS, no-op on Android web.
              ...Platform.select({
                ios: {
                  shadowColor: "#000",
                  shadowOpacity: 0.15,
                  shadowRadius: 1.5,
                  shadowOffset: { width: 0, height: 1 },
                },
                android: { elevation: 2 },
                default: {},
              }),
            },
            cornerStyle,
          ]}
        >
          <Text style={{ fontSize: Math.round(badgeSize * 0.65), lineHeight: badgeSize }}>
            {meta.glyph}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
