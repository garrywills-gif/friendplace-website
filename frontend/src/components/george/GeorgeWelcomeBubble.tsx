/**
 * GeorgeWelcomeBubble — the single Welcome Back UI.
 *
 * Consolidates the two Welcome Back rendering paths that used to
 * live in `GeorgeButterfly.tsx` as forked JSX branches:
 *   • First-meeting variant (Eileen): full card with [Chat to George]
 *     + [Dismiss] actions.
 *   • Returning-member variant (Frank): plain speech bubble, tap-
 *     anywhere-to-dismiss, no buttons.
 *
 * TestFlight iter144 (Garry, 8 Aug 2026): the two variants produced
 * a visibly different experience — Eileen saw the full card, Frank
 * saw only a bubble. That inconsistency broke the promise that
 * every member should get the same Welcome Back UI unless it's an
 * intentional variation.
 *
 * Single source of truth for:
 *   • bubble text
 *   • [Chat to George] button
 *   • [Dismiss / Not now] button
 *   • the card's visual layout (bubble body + action row + tail)
 *
 * Animation and persistence behaviour live on the parent
 * (`GeorgeButterfly.tsx`) so the same fade-in / mount-gate logic
 * applies to every consumer. Callers pass in the pressable handlers
 * (`onChat`, `onDismiss`) so the parent can decide what those actions
 * mean in context (e.g. only the first-meeting `onDismiss` retires
 * the intro flag server-side).
 *
 * There should never be another Welcome Back card in the app. If a
 * new George surface needs a different arrival UI, it should render
 * this component with different `chatLabel`/`dismissLabel` props —
 * or if it's a genuinely different concept (not "welcome back"),
 * name it something else so it's clear it's not the same thing.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export type GeorgeWelcomeBubbleProps = {
  /** The greeting line. Kept as a single string so the parent can
   *  choose the variant (first-meeting, returning member, warm
   *  welcome after long absence, etc.). */
  greeting: string;
  /** Fires when the member taps [Chat to George]. The parent decides
   *  where that leads (event creation, onboarding, general chat). */
  onChat: () => void;
  /** Fires when the member taps [Dismiss / Not now]. The parent
   *  decides whether to fade the bubble, retire the intro flag, etc. */
  onDismiss: () => void;
  /** Copy override for the primary button. Defaults to the app-wide
   *  standard "💬  Chat to George". */
  chatLabel?: string;
  /** Copy override for the secondary button. Defaults to "Dismiss".
   *  If you want "Not now" instead, pass it explicitly. */
  dismissLabel?: string;
};

export function GeorgeWelcomeBubble({
  greeting,
  onChat,
  onDismiss,
  chatLabel,
  dismissLabel,
}: GeorgeWelcomeBubbleProps): React.ReactElement {
  return (
    <View>
      <View style={styles.bubble}>
        <Text style={styles.bubbleText} numberOfLines={4}>
          {greeting}
        </Text>
        <View style={styles.bubbleActions}>
          <Pressable
            testID="george-welcome-chat"
            onPress={onChat}
            accessibilityRole="button"
            accessibilityLabel="Chat to George"
            style={({ pressed }) => [
              styles.bubbleBtnPrimary,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.bubbleBtnPrimaryText} numberOfLines={1}>
              {chatLabel || '💬  Chat to George'}
            </Text>
          </Pressable>
          <Pressable
            testID="george-welcome-dismiss"
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={dismissLabel || 'Dismiss'}
            style={({ pressed }) => [
              styles.bubbleBtnSecondary,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={styles.bubbleBtnSecondaryText} numberOfLines={1}>
              {dismissLabel || 'Dismiss'}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.bubbleTail} />
    </View>
  );
}

// Style tokens mirror `GeorgeButterfly.tsx` exactly (Locked with
// Garry 1 Aug 2026 — George's signature voice: soft FriendPlace
// blue, navy text). This is a pixel-for-pixel move, not a re-skin.
// If either stylesheet is edited, keep them in sync (or better yet,
// promote the tokens to a shared file in a follow-up).
const styles = StyleSheet.create({
  bubble: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 16,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#1E40AF',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 4 },
    }),
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0A2540',
    fontWeight: '500',
  },
  bubbleTail: {
    position: 'absolute',
    right: 12,
    bottom: -6,
    width: 12,
    height: 12,
    backgroundColor: '#DBEAFE',
    borderBottomWidth: 1,
    borderBottomColor: '#93C5FD',
    borderRightWidth: 1,
    borderRightColor: '#93C5FD',
    transform: [{ rotate: '45deg' }],
  },
  bubbleActions: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  bubbleBtnPrimary: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
  },
  bubbleBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  bubbleBtnSecondary: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#93C5FD',
    minHeight: 36,
    justifyContent: 'center',
  },
  bubbleBtnSecondaryText: {
    color: '#1E3A8A',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
});
