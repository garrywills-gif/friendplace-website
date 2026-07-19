import React from 'react';
import {
  View, Text, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GeorgeButterflyMark } from './GeorgeButterflyMark';
import type { EventApprovalResult } from '@/src/lib/george-api';

/**
 * George's warm success acknowledgement after an event is created.
 *
 * Two possible outcomes:
 *   - "published"            → the actor had `publish_events` (org / admin).
 *   - "submitted_for_review" → the FriendPlace team will publish it once
 *                              they take a look.
 *
 * Either way we celebrate the intention, not the mechanics. Principle #18
 * — trust is earned one conversation at a time; this is George handing
 * something back that the member has just built with him.
 */

interface Props {
  result: EventApprovalResult;
  onDone: () => void;
}

export function GeorgeEventCelebration({ result, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const title = result?.target?.title || 'your get-together';
  const emoji = result?.target?.emoji || '🎉';
  const published = result?.outcome === 'published';

  const headline = published
    ? "That's lovely — it's live."
    : "Off to the FriendPlace team.";
  const supporting = published
    ? `I've added ${title} to today's activity. Thank you for making space for others to meet.`
    : `I've sent ${title} to the FriendPlace team for a quick look. I'll let you know as soon as it's live — thank you for offering this to the community.`;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 24 }]}>
      <View style={styles.emojiWrap}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <View style={styles.avatarRow}>
        <GeorgeButterflyMark size={36} />
        <Text style={styles.name}>George</Text>
      </View>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.supporting}>{supporting}</Text>

      <View style={{ flex: 1 }} />

      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={onDone}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        >
          <Text style={styles.primaryBtnText}>Wonderful — thank you, George</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1, backgroundColor: '#F0FDFA',
    paddingHorizontal: 24,
    alignItems: 'flex-start',
  },
  emojiWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#CCFBF1',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 12, marginBottom: 20,
  },
  emoji: { fontSize: 46 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  name: { fontSize: 15, fontWeight: '800', color: '#0F766E' },
  headline: {
    fontSize: 26, fontWeight: '800', color: '#0F172A', lineHeight: 32, letterSpacing: -0.4,
  },
  supporting: {
    marginTop: 12, fontSize: 16, color: '#0F172A', lineHeight: 24,
  },
  actions: { width: '100%', paddingTop: 12 },
  primaryBtn: {
    backgroundColor: '#14B8A6', paddingVertical: 16, borderRadius: 16, alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
