/**
 * GeorgeRemembersBanner — B7 MVP UI.
 *
 * A quiet, warm card that surfaces George's pre-event well-wishes
 * and post-event follow-ups on `/home`. It's:
 *
 *   • Persistent — the message stays until the member dismisses it,
 *     even across app restarts.
 *   • Non-blocking — if the inbox is empty, the component renders
 *     nothing (returns null) so the home layout is untouched.
 *   • Cross-platform — pure React Native primitives; the SpeakButton
 *     component handles voice playback for us.
 *
 * Behaviour:
 *   1. On mount and on every re-focus of the home tab, fetch the
 *      inbox from `/api/mcgs/george/remembers/inbox`.
 *   2. Render the newest undismissed message as a butterfly-branded
 *      card with George's message text.
 *   3. If there are more messages queued, show a small "1 of N"
 *      pill and let the member cycle through them.
 *   4. Tapping the dismiss icon calls `/dismiss`, optimistically
 *      removes the card from the list, and reveals the next one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import { useTheme } from '@/src/lib/theme';
import { georgeApi, type RemembersMessage } from '@/src/lib/george-api';
import SpeakButton from '@/src/components/SpeakButton';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';

type Message = RemembersMessage;

export function GeorgeRemembersBanner() {
  const { c, scale } = useTheme();
  const [items, setItems] = useState<Message[]>([]);
  const [cursor, setCursor] = useState(0);   // index of the visible card
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);   // dismiss in flight

  // Fetch every time the home tab regains focus. That way a member
  // returning from another tab (or from George's chat) gets the
  // freshest inbox without a hard refresh.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await georgeApi.remembersInbox();
      const list: Message[] = Array.isArray(res?.items) ? res.items : [];
      // Sort newest first (fresh delivery beats older ones).
      list.sort((a, b) => (b.scheduled_for || '').localeCompare(a.scheduled_for || ''));
      setItems(list);
      setCursor(0);
    } catch {
      // Silent — this is a "quiet extra" surface, not a blocker.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); return () => {}; }, [load]));

  // Beacon: mark the top-most card as seen when we first render it.
  const visible = items[cursor];
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        await georgeApi.remembersSeen(visible.id);
      } catch {
        // Non-fatal.
      }
    })();
  }, [visible?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onDismiss = useCallback(async () => {
    if (!visible || busy) return;
    setBusy(true);
    // Optimistic — drop the item from the queue immediately.
    const remaining = items.filter((_, i) => i !== cursor);
    setItems(remaining);
    setCursor(prev => Math.min(prev, Math.max(0, remaining.length - 1)));
    try {
      await georgeApi.remembersDismiss(visible.id);
    } catch {
      // Revert on failure.
      setItems(items);
    } finally {
      setBusy(false);
    }
  }, [visible, busy, items, cursor]);

  if (loading && items.length === 0) return null;   // stay invisible during first fetch
  if (!visible) return null;

  const s = styles(c, scale);

  return (
    <View style={s.card} testID="george-remembers-banner">
      <View style={s.head}>
        <View style={s.headLeft}>
          <GeorgeButterflyMark size={26} />
          <Text style={s.headTitle}>George remembers</Text>
        </View>
        <View style={s.headRight}>
          {items.length > 1 ? (
            <Text style={s.pill}>{cursor + 1} of {items.length}</Text>
          ) : null}
          <Pressable
            onPress={onDismiss}
            disabled={busy}
            hitSlop={10}
            accessibilityLabel="Dismiss this message"
            style={({ pressed }) => [s.dismissBtn, (pressed || busy) && { opacity: 0.5 }]}
            testID="george-remembers-dismiss"
          >
            <Ionicons name="close" size={20} color={c.muted} />
          </Pressable>
        </View>
      </View>

      <View style={s.body}>
        <Text style={s.text} accessibilityLabel="George says">{visible.content}</Text>
      </View>

      <View style={s.foot}>
        <SpeakButton text={visible.content} color={c.brand} size={20} />
        {items.length > 1 ? (
          <View style={s.navRow}>
            <Pressable
              onPress={() => setCursor(p => Math.max(0, p - 1))}
              disabled={cursor === 0}
              hitSlop={8}
              style={({ pressed }) => [s.navBtn, (pressed || cursor === 0) && { opacity: 0.4 }]}
              accessibilityLabel="Previous message"
            >
              <Ionicons name="chevron-back" size={18} color={c.brand} />
            </Pressable>
            <Pressable
              onPress={() => setCursor(p => Math.min(items.length - 1, p + 1))}
              disabled={cursor === items.length - 1}
              hitSlop={8}
              style={({ pressed }) => [s.navBtn, (pressed || cursor === items.length - 1) && { opacity: 0.4 }]}
              accessibilityLabel="Next message"
            >
              <Ionicons name="chevron-forward" size={18} color={c.brand} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {busy ? <ActivityIndicator style={s.busy} color={c.brand} /> : null}
    </View>
  );
}

const styles = (c: ReturnType<typeof useTheme>['c'], scale: number) => StyleSheet.create({
  card: {
    marginTop: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.brand,
    gap: 10,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  headTitle: {
    fontSize: 12 * scale,
    fontWeight: '900',
    color: c.brand,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  headRight: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  pill: {
    color: c.muted, fontSize: 11 * scale, fontWeight: '700',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    backgroundColor: c.surface,
  },
  dismissBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  body: {
    paddingVertical: 2,
  },
  text: {
    fontSize: 16 * scale,
    lineHeight: 24 * scale,
    color: c.onSurface,
    fontWeight: '600',
  },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  navRow: { flexDirection: 'row', gap: 4 },
  navBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.brand,
  },
  busy: { position: 'absolute', right: 12, bottom: 12 },
});

// Small local re-export helper (GeorgeButterflyMark isn't in the barrel)
// Explicit import above.
