/**
 * George's Daily Welcome card.
 *
 * A quiet, once-per-day greeting at the top of the Home tab. Reads
 * data-driven from `/api/mcgs/george/daily-welcome` — the backend
 * decides the SHAPE of today's greeting (opener only / +warm thought
 * /+invitation / all three) and the client renders whichever pieces
 * came back.
 *
 * Design notes locked with Garry, 1 Aug 2026:
 *   - No animation. No confetti. No counters.
 *   - Renders only when the backend says `shown: true` — subsequent
 *     opens the same calendar day get `shown: false` and this
 *     component returns null.
 *   - Feels like walking into your favourite café, not a splash
 *     screen.
 *   - "I'm glad you're here."
 *   - CONTEXT AWARE — the parent screen passes `activeContexts` so
 *     George doesn't echo copy the UI is already showing. E.g. Home
 *     mounts this with `["home:share_a_moment_hero"]` and George
 *     naturally picks a different close instead of the ✨ What's your
 *     moment today? invitation. See PRINCIPLES.md → "George is
 *     context-aware".
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/lib/theme';
import { georgeApi } from '@/src/lib/george-api';
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

type Payload = Awaited<ReturnType<typeof georgeApi.dailyWelcome>>;

export function DailyWelcomeCard({ activeContexts }: { activeContexts?: string[] } = {}) {
  const { scale } = useTheme();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Serialise the context list into a stable dep so an inline
  // `["home:..."]` on the parent doesn't re-trigger fetches on every
  // render. Keep the order stable — the backend treats it as a set.
  const ctxKey = (activeContexts || []).slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tags = ctxKey ? ctxKey.split(',') : undefined;
        const p = await georgeApi.dailyWelcome(tags);
        if (!cancelled) setPayload(p);
      } catch {
        // Silent fail — a missing greeting is invisible, not an error.
      }
    })();
    return () => { cancelled = true; };
  }, [ctxKey]);

  if (!payload?.shown || dismissed) return null;

  // Locked with Garry 1 Aug 2026: George's welcome uses the FriendPlace
  // soft-blue speech bubble so members instantly recognise "George is
  // speaking." White backgrounds blended into the surface too much.
  // Palette: #DBEAFE (soft brand blue) with navy #0A2540 text — matches
  // the master butterfly's palette so George's voice reads visually
  // consistent with his mark.
  const GEORGE_BUBBLE_BG = '#DBEAFE';
  const GEORGE_BUBBLE_BORDER = '#93C5FD';
  const GEORGE_TEXT = '#0A2540';
  const GEORGE_INVITE = '#1D4ED8';

  return (
    <View
      testID="daily-welcome-card"
      style={[
        styles.card,
        { backgroundColor: GEORGE_BUBBLE_BG, borderColor: GEORGE_BUBBLE_BORDER },
      ]}
      accessibilityRole="text"
      accessibilityLabel={[
        payload.opener,
        payload.warm_thought,
        payload.invitation,
      ].filter(Boolean).join(' ')}
    >
      <View style={styles.headerRow}>
        <GeorgeButterflyMark size={26} />
        <Pressable
          onPress={() => setDismissed(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss welcome"
          testID="daily-welcome-dismiss"
          style={({ pressed }) => [
            styles.close,
            { opacity: pressed ? 0.4 : 0.6 },
          ]}
        >
          <Ionicons name="close" size={18} color={GEORGE_TEXT} />
        </Pressable>
      </View>

      <Text
        testID="daily-welcome-opener"
        style={{
          color: GEORGE_TEXT,
          fontSize: 22 * scale,
          fontWeight: '800',
          lineHeight: 30 * scale,
          marginTop: 2,
        }}
      >
        {payload.opener}
      </Text>

      {payload.warm_thought ? (
        <Text
          testID="daily-welcome-thought"
          style={{
            color: GEORGE_TEXT,
            fontSize: 16 * scale,
            lineHeight: 24 * scale,
            marginTop: 8,
          }}
        >
          {payload.warm_thought}
        </Text>
      ) : null}

      {payload.callback ? (
        <Text
          testID="daily-welcome-callback"
          style={{
            color: GEORGE_TEXT,
            fontSize: 16 * scale,
            lineHeight: 24 * scale,
            marginTop: 8,
            fontStyle: 'italic',
          }}
        >
          {payload.callback}
        </Text>
      ) : null}

      {payload.invitation ? (
        <Text
          testID="daily-welcome-invitation"
          style={{
            color: GEORGE_INVITE,
            fontSize: 16 * scale,
            lineHeight: 24 * scale,
            marginTop: 10,
            fontWeight: '700',
          }}
        >
          {payload.invitation}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
