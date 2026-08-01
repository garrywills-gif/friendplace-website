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
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/lib/theme';
import { georgeApi } from '@/src/lib/george-api';

type Payload = Awaited<ReturnType<typeof georgeApi.dailyWelcome>>;

export function DailyWelcomeCard() {
  const { c, scale } = useTheme();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await georgeApi.dailyWelcome();
        if (!cancelled) setPayload(p);
      } catch {
        // Silent fail — a missing greeting is invisible, not an error.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!payload?.shown || dismissed) return null;

  return (
    <View
      testID="daily-welcome-card"
      style={[
        styles.card,
        { backgroundColor: c.brandTertiary, borderColor: c.brand },
      ]}
      accessibilityRole="text"
      accessibilityLabel={[
        payload.opener,
        payload.warm_thought,
        payload.invitation,
      ].filter(Boolean).join(' ')}
    >
      <View style={styles.headerRow}>
        <Text style={{ fontSize: 26 }}>🦋</Text>
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
          <Ionicons name="close" size={18} color={c.muted} />
        </Pressable>
      </View>

      <Text
        testID="daily-welcome-opener"
        style={{
          color: c.onSurface,
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
            color: c.onSurface,
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
            color: c.onSurface,
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
            color: c.brand,
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
