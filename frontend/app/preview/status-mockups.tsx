/**
 * Presence & Status + Button Outline Mock-up Preview
 *
 * Purely a UX prototype for Garry to review on his iPhone (TestFlight)
 * BEFORE any production screens, backend endpoints, or theme tokens are
 * touched. Everything on this page is HARDCODED FAKE DATA — no API
 * calls, no navigation into real screens, no writes to storage.
 *
 * When approved, the corresponding real components will be lifted OUT
 * of this file into `src/components/status/*` and `src/components/ui/*`
 * and this preview route can be deleted.
 *
 * Route: /preview/status-mockups
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

// ─────────────────────────────────────────────────────────────────────
// Palettes — LOCAL to this file so global theme.tsx is untouched.
// The "dark" palette here is a proposal for Garry to react to; it will
// only ship if he approves and asks for a real dark-mode rollout.
// ─────────────────────────────────────────────────────────────────────
const PAL_LIGHT = {
  bg: '#F8FAFC',           // page background
  surface: '#FFFFFF',      // card background
  onSurface: '#0D2A57',    // primary text
  muted: '#64748B',        // secondary text
  border: '#CBD5E1',       // subtle border
  outline: '#1E3A7F',      // NEW proposed clearer button outline
  brand: '#1E3A7F',        // primary brand
  brandTint: '#E0F2FE',    // brand background tint
  accent: '#2DD4BF',       // butterfly / accent teal
  success: '#16A34A',
  warning: '#B45309',
  offlineChip: '#F1F5F9',
};
const PAL_DARK = {
  bg: '#0B1220',
  surface: '#111C2E',
  onSurface: '#E2E8F0',
  muted: '#94A3B8',
  border: '#2A3F5F',
  outline: '#7AB8FF',      // brighter outline for dark bg
  brand: '#4B7DD6',
  brandTint: '#1E2E4B',
  accent: '#2DD4BF',
  success: '#4ADE80',
  warning: '#F59E0B',
  offlineChip: '#1F2A3F',
};
type Pal = typeof PAL_LIGHT;

// ─────────────────────────────────────────────────────────────────────
// Status vocabulary (matches design doc §2).
// ─────────────────────────────────────────────────────────────────────
type Status = 'online' | 'looking' | 'in_cafe' | 'happy' | 'busy' | 'offline';

const STATUS_META: Record<Status, { glyph: string; label: string }> = {
  online:  { glyph: '🟢', label: 'Online' },
  looking: { glyph: '🦋', label: 'Looking for a chat' },
  in_cafe: { glyph: '☕', label: 'In the FP Café' },
  happy:   { glyph: '😊', label: 'Happy to connect' },
  busy:    { glyph: '🟡', label: 'Busy' },
  offline: { glyph: '⚫', label: 'Offline' },
};

// ─────────────────────────────────────────────────────────────────────
// Fake data — a handful of members in various states so Garry can see
// every glyph in place.
// ─────────────────────────────────────────────────────────────────────
type Member = { id: string; name: string; avatar: string; status: Status };
const MEMBERS: Member[] = [
  { id: 'u1', name: 'Kaya',   avatar: '👨🏼', status: 'in_cafe' },
  { id: 'u2', name: 'Susan',  avatar: '👩🏻', status: 'looking' },
  { id: 'u3', name: 'Bill',   avatar: '🧑🏽', status: 'looking' },
  { id: 'u4', name: 'Diana',  avatar: '👩🏽', status: 'happy' },
  { id: 'u5', name: 'Tom',    avatar: '👨🏾', status: 'busy' },
  { id: 'u6', name: 'Priya',  avatar: '👩🏾', status: 'online' },
  { id: 'u7', name: 'Marc',   avatar: '🧔🏻', status: 'offline' },
];

// ─────────────────────────────────────────────────────────────────────
// <AvatarWithBadge> — the ONE component used to show status beside a
// member's name everywhere in the app (per Garry's refinement Feb 2026).
// A tiny glyph is anchored to the bottom-right corner of the avatar
// bubble. The name shown beside it is JUST the name — no icon repeat,
// no status label. Members recognise the status at a glance.
// ─────────────────────────────────────────────────────────────────────
function AvatarWithBadge({
  avatar,
  status,
  pal,
  diameter = 56,
}: { avatar: string; status: Status; pal: Pal; diameter?: number }) {
  const { glyph, label } = STATUS_META[status];
  return (
    <View style={{ width: diameter, height: diameter }}>
      <View style={{
        width: diameter, height: diameter, borderRadius: diameter / 2,
        backgroundColor: pal.surface, borderWidth: 2, borderColor: pal.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: diameter * 0.55 }}>{avatar}</Text>
      </View>
      <View
        accessibilityLabel={label}
        style={{
          position: 'absolute', right: -2, bottom: -2,
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: pal.surface, borderWidth: 2, borderColor: pal.border,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 12 }}>{glyph}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Buttons — NEW proposed style + comparison to CURRENT style.
// ─────────────────────────────────────────────────────────────────────

/** CURRENT (before) — matches how buttons look in Settings today. Thin
 *  hairline border on white, easy to miss at a glance. */
function ButtonOld({ label, kind = 'secondary', pal, onPress, selected }: {
  label: string;
  kind?: 'primary' | 'secondary' | 'pill';
  pal: Pal;
  onPress?: () => void;
  selected?: boolean;
}) {
  const bg =
    kind === 'primary' || selected ? pal.brand :
    kind === 'pill' ? pal.surface :
    pal.surface;
  const color =
    kind === 'primary' || selected ? '#FFFFFF' :
    pal.onSurface;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{
      paddingHorizontal: 18, paddingVertical: 10,
      borderRadius: kind === 'pill' ? 999 : 12,
      backgroundColor: bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: pal.border,
      opacity: pressed ? 0.85 : 1,
      alignItems: 'center',
    }]}>
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** NEW (after) — clearer outline, obvious pressed state, works in both
 *  light and dark palettes. */
function ButtonNew({
  label,
  kind = 'secondary',
  pal,
  onPress,
  selected,
  disabled,
  icon,
}: {
  label: string;
  kind?: 'primary' | 'secondary' | 'pill';
  pal: Pal;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  icon?: string;
}) {
  const isFilled = kind === 'primary' || selected;
  const bg = isFilled ? pal.brand : pal.surface;
  const color = isFilled ? '#FFFFFF' : pal.onSurface;
  const borderColor = isFilled ? pal.brand : pal.outline;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [{
        paddingHorizontal: 20, paddingVertical: 12,
        borderRadius: kind === 'pill' ? 999 : 14,
        backgroundColor: pressed && !isFilled ? pal.brandTint : bg,
        borderWidth: 2,
        borderColor: pressed ? pal.brand : borderColor,
        opacity: disabled ? 0.45 : 1,
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      }]}
    >
      {icon && <Text style={{ fontSize: 16 }}>{icon}</Text>}
      <Text style={{ color, fontWeight: '800', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PIECE: Home screen — "My Status" card
// ─────────────────────────────────────────────────────────────────────
function MyStatusCard({ pal, current, setCurrent }: {
  pal: Pal;
  current: Status;
  setCurrent: (s: Status) => void;
}) {
  const isLooking = current === 'looking';
  return (
    <View style={[styles.card, { backgroundColor: pal.surface, borderColor: pal.border }]}>
      <Text style={[styles.cardTitle, { color: pal.onSurface }]}>My Status</Text>

      {/* PRIMARY 🦋 toggle — full-width, obvious tap target.
          Refinement (Garry Feb 2026): removed the "🟢 Online" header
          line since Online is the automatic default — no need to state
          it explicitly. */}
      <ButtonNew
        pal={pal}
        kind="primary"
        selected={isLooking}
        onPress={() => setCurrent(isLooking ? 'online' : 'looking')}
        icon="🦋"
        label={isLooking ? '✓ Looking for a chat — tap to stop' : 'Looking for a chat'}
      />

      {/* Secondary status chips. Refinement: "Busy" → "Busy right now"
          (friendlier, less permanent). */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <ButtonNew pal={pal} kind="pill" selected={current === 'happy'}
                   onPress={() => setCurrent(current === 'happy' ? 'online' : 'happy')}
                   icon="😊" label="Happy to connect" />
        <ButtonNew pal={pal} kind="pill" selected={current === 'busy'}
                   onPress={() => setCurrent(current === 'busy' ? 'online' : 'busy')}
                   icon="🟡" label="Busy right now" />
        {current !== 'online' && (
          <ButtonNew pal={pal} kind="pill"
                     onPress={() => setCurrent('online')}
                     label="✕ Clear" />
        )}
      </View>

      <Text style={{ color: pal.muted, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
        {'\u2615 In the FP Café and \u26AB Offline are set automatically.'}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PIECE: FP Café banner (single + multi)
// ─────────────────────────────────────────────────────────────────────
function CafeBannerSingle({ pal }: { pal: Pal }) {
  return (
    <View style={[styles.banner, { backgroundColor: pal.brandTint, borderColor: pal.outline }]}>
      <View style={{ flex: 1 }}>
        {/* Refinement (Garry Feb 2026): warmer, more conversational
            wording — "would love a chat" vs the clinical "is looking
            for a chat". Fits FriendPlace's personality. */}
        <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 15 }}>
          🦋 Susan would love a chat
        </Text>
        <Text style={{ color: pal.muted, fontSize: 13, marginTop: 2 }}>
          Tap to say hello.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={pal.outline} />
    </View>
  );
}

function CafeBannerMulti({ pal }: { pal: Pal }) {
  const lookers = MEMBERS.filter((m) => m.status === 'looking');
  return (
    <View style={[styles.banner, { flexDirection: 'column', alignItems: 'stretch', backgroundColor: pal.brandTint, borderColor: pal.outline }]}>
      {/* Refinement (Garry Feb 2026): heading changed from "Looking for
          a chat" to "People looking for a chat" and each row gets its
          own 🦋 prefix, reinforcing why each person is in the list and
          making the group easier to scan. */}
      <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 15, marginBottom: 6 }}>
        People looking for a chat
      </Text>
      {lookers.map((m, i) => (
        <Pressable
          key={m.id}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingVertical: 8, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: pal.border,
          }}
        >
          <Text style={{ fontSize: 16 }}>🦋</Text>
          <Text style={{ color: pal.onSurface, fontWeight: '700', fontSize: 15, flex: 1 }}>{m.name}</Text>
          <Ionicons name="chevron-forward" size={20} color={pal.outline} />
        </Pressable>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PIECE: Tap-a-name action sheet mock — Join table + PM (or PM only).
// ─────────────────────────────────────────────────────────────────────
function TapSheet({ pal, memberInCafe }: { pal: Pal; memberInCafe: boolean }) {
  return (
    <View style={[styles.card, { backgroundColor: pal.surface, borderColor: pal.border }]}>
      <Text style={{ color: pal.muted, fontSize: 12, marginBottom: 6 }}>
        (Action sheet — appears when tapping a name on the banner)
      </Text>
      <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
        Say hello to Susan 🦋
      </Text>
      {memberInCafe ? (
        <View style={{ gap: 8 }}>
          <ButtonNew pal={pal} kind="primary" icon="☕" label="Join their table" />
          <ButtonNew pal={pal} kind="secondary" icon="✉️" label="Send a private message" />
        </View>
      ) : (
        <ButtonNew pal={pal} kind="primary" icon="✉️" label="Send a private message" />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PIECE: Avatar + status badge in every list context.
// Refinement (Garry Feb 2026): avatar-corner badge is used EVERYWHERE
// an avatar is visible. The name beside it is JUST the name — no icon
// repeat, no status label. Status is recognised at a glance via the
// glyph on the avatar corner. This keeps every list scannable.
// ─────────────────────────────────────────────────────────────────────
function BadgeContexts({ pal }: { pal: Pal }) {
  return (
    <View style={{ gap: 12 }}>
      {/* Find Friends card */}
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AvatarWithBadge avatar="👩🏻" status="looking" pal={pal} diameter={54} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 16 }}>Susan</Text>
          <Text style={{ color: pal.muted, fontSize: 13, marginTop: 2 }}>Ballarat · 2 friends in common</Text>
        </View>
      </View>

      {/* Café seat */}
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, alignItems: 'center', gap: 6 }}>
        <AvatarWithBadge avatar="👨🏼" status="in_cafe" pal={pal} diameter={64} />
        <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 14 }}>Kaya</Text>
        <Text style={{ color: pal.muted, fontSize: 12 }}>at the table</Text>
      </View>

      {/* DM header — badge on the avatar, no icon after the name. */}
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AvatarWithBadge avatar="👩🏽" status="happy" pal={pal} diameter={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 17 }}>Diana</Text>
          <Text style={{ color: pal.muted, fontSize: 12, marginTop: 2 }}>Direct message</Text>
        </View>
      </View>

      {/* Group members row — every member gets a small avatar with a
          corner badge; just the name beside it. */}
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 10 }}>
        <Text style={{ color: pal.muted, fontSize: 12 }}>Ballarat Walkers · members</Text>
        {[MEMBERS[0], MEMBERS[3], MEMBERS[4], MEMBERS[6]].map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <AvatarWithBadge avatar={m.avatar} status={m.status} pal={pal} diameter={36} />
            <Text style={{ color: pal.onSurface, fontWeight: '700', fontSize: 15 }}>{m.name}</Text>
          </View>
        ))}
      </View>

      {/* Event attendees — grid of avatars with corner badges + name below. */}
      <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 10 }}>
        <Text style={{ color: pal.muted, fontSize: 12 }}>Sunday Brunch · attendees</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {MEMBERS.slice(0, 5).map((m) => (
            <View key={m.id} style={{ alignItems: 'center', gap: 4 }}>
              <AvatarWithBadge avatar={m.avatar} status={m.status} pal={pal} diameter={42} />
              <Text style={{ color: pal.onSurface, fontSize: 12, fontWeight: '600' }}>{m.name}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PIECE: Button before/after comparison
// ─────────────────────────────────────────────────────────────────────
function ButtonComparison({ pal }: { pal: Pal }) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: pal.muted, fontSize: 12, fontWeight: '700' }}>BEFORE — current style</Text>
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <ButtonOld pal={pal} kind="pill" label="Small" />
            <ButtonOld pal={pal} kind="pill" label="Default" selected />
            <ButtonOld pal={pal} kind="pill" label="Large" />
            <ButtonOld pal={pal} kind="pill" label="Extra" />
          </View>
          <ButtonOld pal={pal} kind="primary" label="Save changes" />
          <ButtonOld pal={pal} kind="secondary" label="Cancel" />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ color: pal.brand, fontSize: 12, fontWeight: '800' }}>AFTER — proposed style</Text>
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <ButtonNew pal={pal} kind="pill" label="Small" />
            <ButtonNew pal={pal} kind="pill" label="Default" selected />
            <ButtonNew pal={pal} kind="pill" label="Large" />
            <ButtonNew pal={pal} kind="pill" label="Extra" />
          </View>
          <ButtonNew pal={pal} kind="primary" label="Save changes" />
          <ButtonNew pal={pal} kind="secondary" label="Cancel" />
          <ButtonNew pal={pal} kind="primary" label="Disabled example" disabled />
        </View>
        <Text style={{ color: pal.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
          Change: 2 pt outline in brand colour · pressed state dims + tints + shrinks · disabled at 45% opacity · works over both light and dark backgrounds.
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// The full mock-up page
// ─────────────────────────────────────────────────────────────────────
export default function StatusMockupsPreview() {
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  const [current, setCurrent] = useState<Status>('online');
  const pal = themeMode === 'light' ? PAL_LIGHT : PAL_DARK;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ gap: 10, marginTop: 22 }}>
      <Text style={{ color: pal.onSurface, fontWeight: '900', fontSize: 20 }}>{title}</Text>
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      {/* Top bar */}
      <View style={{
        paddingTop: Platform.OS === 'ios' ? 54 : 24,
        paddingHorizontal: 16, paddingBottom: 10,
        backgroundColor: pal.surface, borderBottomWidth: 1, borderBottomColor: pal.border,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={8}
                   style={{ padding: 8, borderRadius: 10, borderWidth: 2, borderColor: pal.outline }}>
          <Ionicons name="chevron-back" size={18} color={pal.brand} />
        </Pressable>
        <Text style={{ color: pal.onSurface, fontWeight: '900', fontSize: 17, flex: 1 }}>
          Status & buttons — mock-up
        </Text>
        {/* Theme toggle */}
        <Pressable
          onPress={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
          style={{
            paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
            borderWidth: 2, borderColor: pal.outline, flexDirection: 'row', gap: 4,
          }}
        >
          <Text style={{ fontSize: 14 }}>{themeMode === 'light' ? '☀️' : '🌙'}</Text>
          <Text style={{ color: pal.onSurface, fontWeight: '800', fontSize: 13 }}>
            {themeMode === 'light' ? 'Light' : 'Dark'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: pal.brandTint, borderWidth: 2, borderColor: pal.outline }}>
          <Text style={{ color: pal.onSurface, fontSize: 13, lineHeight: 19 }}>
            🦋 Everything on this page is a UI mock-up with fake data. Nothing here writes to the backend or affects your real status. Toggle the theme at the top-right to compare light and dark.
          </Text>
        </View>

        {/* HOME screen — My Status card */}
        <Section title="1 · Home screen · My Status">
          <MyStatusCard pal={pal} current={current} setCurrent={setCurrent} />
        </Section>

        {/* Looking-for-a-chat button variants */}
        <Section title="2 · Looking for a chat — button states">
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 10 }}>
            <ButtonNew pal={pal} kind="primary" icon="🦋" label="Looking for a chat" />
            <ButtonNew pal={pal} kind="primary" icon="🦋" label="✓ Looking for a chat — tap to stop" selected />
            <ButtonNew pal={pal} kind="primary" icon="🦋" label="Looking for a chat" disabled />
            <Text style={{ color: pal.muted, fontSize: 12 }}>
              Inactive · active (filled + check) · disabled (offline / no network)
            </Text>
          </View>
        </Section>

        {/* FP Café banner */}
        <Section title="3 · FP Café · one person looking">
          <CafeBannerSingle pal={pal} />
        </Section>
        <Section title="4 · FP Café · multiple people looking">
          <CafeBannerMulti pal={pal} />
        </Section>
        <Section title="5 · Tap a name — the action sheet">
          <TapSheet pal={pal} memberInCafe={true} />
          <View style={{ height: 8 }} />
          <TapSheet pal={pal} memberInCafe={false} />
        </Section>

        {/* Member badges everywhere */}
        <Section title="6 · Status glyph beside member avatars">
          <Text style={{ color: pal.muted, fontSize: 13 }}>
            The badge sits on the avatar corner in Find Friends, café seats, DM headers, group members and event attendees. Names stay clean — the glyph tells the story.
          </Text>
          <BadgeContexts pal={pal} />
        </Section>

        {/* Button outline comparison */}
        <Section title="7 · Button outlines — before / after">
          <ButtonComparison pal={pal} />
        </Section>

        {/* Precedence reference */}
        <Section title="8 · Reference · status glyphs">
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: pal.surface, borderWidth: 1, borderColor: pal.border, gap: 8 }}>
            {(Object.keys(STATUS_META) as Status[]).map((s) => (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 22 }}>{STATUS_META[s].glyph}</Text>
                <Text style={{ color: pal.onSurface, fontWeight: '700', fontSize: 15 }}>{STATUS_META[s].label}</Text>
              </View>
            ))}
            <Text style={{ color: pal.muted, fontSize: 12, marginTop: 4 }}>
              Precedence: Offline &gt; Looking &gt; In FP Café &gt; Busy right now &gt; Happy to connect &gt; Online
            </Text>
          </View>
        </Section>

        <View style={{ height: 40 }} />
        <Text style={{ color: pal.muted, fontSize: 12, textAlign: 'center' }}>
          End of preview · nothing here is wired to real data
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    opacity: 0.7,
  },
  banner: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
