/**
 * GeorgeRemembersBanner — B7 UI (refined per Garry's feedback 25 Jul 2026).
 *
 * Design changes vs the first cut:
 *   • Header is warmer — "🦋 George" with a small subtitle rather
 *     than the loud "GEORGE REMEMBERS".
 *   • Event is pulled OUT of the sentence so the eye finds it fast:
 *     emoji + title with a soft timing chip ("Tomorrow" /
 *     "Earlier today"). The warm one-liner sits below.
 *   • A gentle "View event" button opens the event's edit screen —
 *     one tap away when a member has forgotten the details.
 *   • ONLY ONE reminder at a time on Home. If more are queued they
 *     surface after the current one is dismissed. Keeps the home
 *     screen from getting busy as the app grows.
 *
 * The banner still renders `null` when the inbox is empty.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { useTheme } from '@/src/lib/theme';
import { georgeApi, type RemembersMessage } from '@/src/lib/george-api';
import GeorgeSpeakButton from '@/src/components/george/GeorgeSpeakButton';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';

type Message = RemembersMessage;

export function GeorgeRemembersBanner() {
  const { c, scale } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await georgeApi.remembersInbox();
      const list: Message[] = Array.isArray(res?.items) ? res.items : [];
      // Newest first so a just-arrived nudge wins over stale ones.
      list.sort((a, b) => (b.scheduled_for || '').localeCompare(a.scheduled_for || ''));
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); return () => {}; }, [load]));

  const visible = items[0] || null;

  // Fire a viewport beacon the first time we render each message.
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try { await georgeApi.remembersSeen(visible.id); } catch {}
    })();
  }, [visible?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onDismiss = useCallback(async () => {
    if (!visible || busy) return;
    setBusy(true);
    const remaining = items.slice(1);
    setItems(remaining);
    try {
      await georgeApi.remembersDismiss(visible.id);
    } catch {
      // Revert on failure so the member isn't silently dropped.
      setItems(items);
    } finally {
      setBusy(false);
    }
  }, [visible, busy, items]);

  const onViewEvent = useCallback(() => {
    if (!visible?.event_id) return;
    router.push({ pathname: '/events/edit/[id]', params: { id: visible.event_id } });
  }, [visible?.event_id, router]);

  if (loading && items.length === 0) return null;
  if (!visible) return null;

  const s = styles(c, scale);
  const disp = visible.display || {};
  const snapshot = visible.event_snapshot || {};
  const emoji = disp.emoji || snapshot.emoji || (visible.kind === 'pre_event' ? '📅' : '💛');
  const title = disp.title || snapshot.title || 'Your event';
  const whenLabel = disp.when_label ||
    (visible.kind === 'pre_event' ? 'Tomorrow' : 'Earlier today');
  const bodyText = disp.body ||
    // Legacy fallback: strip the title from the full content if we can,
    // otherwise show the whole thing.
    visible.content;
  const spokenText = visible.content;
  const showViewEvent = disp.cta_kind !== 'none';

  return (
    <View style={s.card} testID="george-remembers-banner">
      {/* Header — warm and personal. */}
      <View style={s.head}>
        <View style={s.headLeft}>
          <GeorgeButterflyMark size={22} />
          <View>
            <Text style={s.headTitle}>George</Text>
            <Text style={s.headSubtitle}>
              {visible.kind === 'pre_event' ? 'Thinking ahead' : 'Just checking in'}
            </Text>
          </View>
        </View>
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

      {/* Highlighted event row — emoji + title + timing chip. */}
      <View style={s.eventRow}>
        <Text style={s.eventEmoji} accessibilityElementsHidden>{emoji}</Text>
        <View style={s.eventTitleCol}>
          <Text style={s.eventTitle} numberOfLines={1} accessibilityLabel={`Event: ${title}`}>
            {title}
          </Text>
        </View>
        <View style={s.whenChip}>
          <Text style={s.whenChipText}>{whenLabel}</Text>
        </View>
      </View>

      {/* The warm one-liner. */}
      <Text style={s.body} accessibilityLabel="George says">{bodyText}</Text>

      {/* Actions row — speaker + View event. */}
      <View style={s.foot}>
        <GeorgeSpeakButton text={spokenText} color={c.brand} size={22} />
        {showViewEvent ? (
          <Pressable
            onPress={onViewEvent}
            hitSlop={6}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={disp.cta_label || 'View event'}
            testID="george-remembers-view-event"
          >
            <Text style={s.ctaText}>{disp.cta_label || 'View event'}</Text>
            <Ionicons name="chevron-forward" size={16} color={c.brand} />
          </Pressable>
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
    borderWidth: 1,
    borderColor: c.brand,
    gap: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headTitle: {
    fontSize: 14 * scale,
    fontWeight: '900',
    color: c.onSurface,
  },
  headSubtitle: {
    fontSize: 11 * scale,
    fontWeight: '600',
    color: c.muted,
    marginTop: 1,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  eventEmoji: {
    fontSize: 22 * scale,
  },
  eventTitleCol: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 15 * scale,
    fontWeight: '800',
    color: c.onSurface,
  },
  whenChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: c.brandTertiary,
  },
  whenChipText: {
    color: c.brand,
    fontSize: 11 * scale,
    fontWeight: '800',
  },

  body: {
    fontSize: 15 * scale,
    lineHeight: 22 * scale,
    color: c.onSurface,
    fontWeight: '500',
  },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.brand,
    backgroundColor: c.surface,
    minHeight: 36,
  },
  ctaText: {
    color: c.brand,
    fontWeight: '800',
    fontSize: 13 * scale,
  },

  busy: {
    position: 'absolute',
    right: 12,
    bottom: 12,
  },
});
