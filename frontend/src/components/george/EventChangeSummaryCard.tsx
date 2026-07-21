/**
 * EventChangeSummaryCard — B6 Session 3 UI.
 *
 * Rendered beneath a George bubble whenever the turn carries an
 * `edit` payload (see `EventEditMeta` in `george-api.ts`). Design
 * choices locked with Garry on 25 Jul 2026:
 *
 *   • Compact chip pair for single-field edits (fastest tap path).
 *   • Full change card for multi-field edits (clearer diff).
 *   • Applied state = card in a muted "done" style with a small
 *     checkmark — confirms the action landed without being loud.
 *   • Undo affordance = a 30-second countdown chip that fires
 *     "undo that" back through the George turn endpoint.
 *
 * The component only knows how to render the state and emit
 * intent callbacks. All API work happens in the parent
 * (GeorgeEventCreation).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/lib/theme';
import type { EventEditMeta } from '@/src/lib/george-api';

// ---- Types & helpers ------------------------------------------------------

type Props = {
  edit: EventEditMeta;
  /**
   * When the member taps a chip. Options:
   *   'confirm'  — apply the pending change
   *   'decline'  — leave the event as it was
   *   'undo'     — revert the just-applied change (30s window)
   */
  onAction: (action: 'confirm' | 'decline' | 'undo') => void;
  /** Once the parent has fired the API call for the action, the card
   * enters a disabled state so double-taps do nothing. */
  busy?: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  emoji: 'Emoji',
  description: 'Description',
  date: 'Date',
  time: 'Time',
  location: 'Location',
  capacity: 'Capacity',
  notes: 'Notes',
  visibility: 'Who can see it',
  price: 'Price',
  audience: 'Audience',
  duration_minutes: 'Duration',
};

function humanFieldLabel(field: string): string {
  return FIELD_LABELS[field] || field;
}

function humaniseDate(v: unknown): string {
  if (!v) return '';
  const s = String(v);
  // YYYY-MM-DD → "Thursday 26 Jul"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.valueOf())) return s;
  return d.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'short',
  });
}

function humaniseTime(v: unknown): string {
  if (!v) return '';
  const s = String(v);
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return s;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = (h % 12) || 12;
  return min === 0 ? `${h12}${suffix}` : `${h12}:${String(min).padStart(2, '0')}${suffix}`;
}

function humanValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'date') return humaniseDate(v);
  if (field === 'time') return humaniseTime(v);
  if (field === 'visibility') return String(v);
  return String(v);
}

// ---- Component ------------------------------------------------------------

export function EventChangeSummaryCard({ edit, onAction, busy = false }: Props) {
  const { c, scale } = useTheme();

  const changes = (edit.pending_changes || edit.applied || edit.proposal?.changes || {}) as Record<string, unknown>;
  const fields = Object.keys(changes);
  const isSingleField = fields.length === 1;
  const isCompact = isSingleField;

  // Which kind of card are we in?
  const kind = edit.kind;
  const action = edit.action;

  // ---- Applied state — muted "done" card + 30-second Undo chip ----
  if (kind === 'edit_applied') {
    return (
      <AppliedCard edit={edit} onUndo={() => onAction('undo')} busy={busy} />
    );
  }

  // ---- Declined ("no worries") — very quiet inline chip -----------
  if (kind === 'edit_declined') {
    return (
      <View style={styles(c, scale).mutedRow}>
        <Ionicons name="close-circle-outline" size={16} color={c.muted} />
        <Text style={styles(c, scale).mutedText}>Left as it was</Text>
      </View>
    );
  }

  // ---- No-change / error / needs-details — no interactive card ----
  if (kind === 'edit_no_change' || kind === 'edit_error'
      || kind === 'edit_needs_details' || kind === 'edit_undo_needs_target') {
    return null;
  }

  // ---- Disambiguation — vertical list of candidates ---------------
  if (kind === 'edit_disambiguate') {
    // For MVP we let the member reply with the title; no chips yet.
    // (Session 3 stretch — clickable candidate chips.)
    return null;
  }

  // ---- awaiting_confirm — the primary flow ------------------------
  const isCancel = action === 'cancel';
  const isRestore = action === 'restore';

  return (
    <View style={[styles(c, scale).card, isCompact && styles(c, scale).cardCompact]}>
      {/* Diff — compact one-liner OR the full grid */}
      {!isCancel && !isRestore ? (
        isCompact ? (
          <CompactDiff
            field={fields[0]}
            oldVal={(edit.event as Record<string, unknown> | undefined)?.[fields[0]]}
            newVal={changes[fields[0]]}
          />
        ) : (
          <FullDiff
            fields={fields}
            changes={changes}
            event={(edit.event as Record<string, unknown> | undefined) || {}}
          />
        )
      ) : (
        <View style={styles(c, scale).cancelRow}>
          <Ionicons
            name={isRestore ? 'refresh-circle' : 'alert-circle'}
            size={20}
            color={isRestore ? c.brand : '#E11D48'}
          />
          <Text style={styles(c, scale).cancelText}>
            {isRestore
              ? `Restore ${edit.event?.title || 'this event'}`
              : `Cancel ${edit.event?.title || 'this event'}`}
          </Text>
        </View>
      )}

      {/* Chip row */}
      <View style={styles(c, scale).chipRow}>
        <Pressable
          onPress={() => onAction('confirm')}
          disabled={busy}
          style={({ pressed }) => [
            styles(c, scale).chipPrimary,
            (pressed || busy) && { opacity: 0.6 },
            isCancel && styles(c, scale).chipDanger,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isCancel ? 'Confirm cancellation' : 'Confirm change'}
        >
          <Ionicons
            name={isCancel ? 'trash-outline' : 'checkmark'}
            size={16}
            color="#fff"
            style={{ marginRight: 6 }}
          />
          <Text style={styles(c, scale).chipPrimaryText}>
            {isCancel ? 'Yes, cancel it' : isRestore ? 'Yes, restore it' : 'Confirm'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onAction('decline')}
          disabled={busy}
          style={({ pressed }) => [
            styles(c, scale).chipSecondary,
            (pressed || busy) && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Keep as is"
        >
          <Text style={styles(c, scale).chipSecondaryText}>Keep as is</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- Sub-components -------------------------------------------------------

function CompactDiff({ field, oldVal, newVal }: {
  field: string; oldVal: unknown; newVal: unknown;
}) {
  const { c, scale } = useTheme();
  return (
    <View style={styles(c, scale).compactDiff}>
      <Text style={styles(c, scale).fieldLabel}>{humanFieldLabel(field)}</Text>
      <View style={styles(c, scale).diffLine}>
        <Text style={styles(c, scale).oldVal} numberOfLines={1}>
          {humanValue(field, oldVal)}
        </Text>
        <Ionicons name="arrow-forward" size={14} color={c.muted} style={{ marginHorizontal: 6 }} />
        <Text style={styles(c, scale).newVal} numberOfLines={1}>
          {humanValue(field, newVal)}
        </Text>
      </View>
    </View>
  );
}

function FullDiff({ fields, changes, event }: {
  fields: string[]; changes: Record<string, unknown>; event: Record<string, unknown>;
}) {
  const { c, scale } = useTheme();
  return (
    <View style={styles(c, scale).fullDiff}>
      {fields.map((f) => (
        <View key={f} style={styles(c, scale).fullDiffRow}>
          <Text style={styles(c, scale).fullDiffLabel}>{humanFieldLabel(f)}</Text>
          <View style={styles(c, scale).fullDiffValues}>
            <Text style={styles(c, scale).oldVal} numberOfLines={2}>
              {humanValue(f, event[f])}
            </Text>
            <Ionicons name="arrow-down" size={14} color={c.muted} style={{ marginVertical: 2 }} />
            <Text style={styles(c, scale).newVal} numberOfLines={2}>
              {humanValue(f, changes[f])}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function AppliedCard({ edit, onUndo, busy }: {
  edit: EventEditMeta; onUndo: () => void; busy: boolean;
}) {
  const { c, scale } = useTheme();
  const changes = (edit.applied || {}) as Record<string, unknown>;
  const before = (edit.before || {}) as Record<string, unknown>;
  const fields = Object.keys(changes);
  const isUndo = edit.action === 'undo';

  // Prefer the explicit `before` snapshot; fall back to the event.
  // (After apply, `edit.event` has been mutated to the NEW values, so
  // we must use `before` for the OLD column to make sense.)
  const getOldVal = (f: string): unknown => {
    if (f in before) return before[f];
    return (edit.event as Record<string, unknown> | undefined)?.[f];
  };

  // 30-second countdown for the Undo chip.
  const UNDO_WINDOW_MS = 30_000;
  const [remaining, setRemaining] = useState(UNDO_WINDOW_MS);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    // Once we're in "undo-applied" mode, we don't offer another undo
    // (that would loop indefinitely). Skip the countdown.
    if (isUndo) return;
    startedAt.current = Date.now();
    const t = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const left = Math.max(0, UNDO_WINDOW_MS - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [isUndo]);

  const undoStillOffered = !isUndo && remaining > 0;

  return (
    <View style={[styles(c, scale).card, styles(c, scale).cardApplied]}>
      <View style={styles(c, scale).appliedHeader}>
        <Ionicons name="checkmark-circle" size={18} color={c.brand} />
        <Text style={styles(c, scale).appliedHeaderText}>
          {isUndo ? 'Reverted' : fields.length === 0 ? 'Applied' : 'Applied'}
        </Text>
      </View>

      {fields.length > 0 && !isUndo ? (
        fields.length === 1 ? (
          <CompactDiff
            field={fields[0]}
            oldVal={getOldVal(fields[0])}
            newVal={changes[fields[0]]}
          />
        ) : (
          <FullDiff
            fields={fields}
            changes={changes}
            event={fields.reduce<Record<string, unknown>>((acc, f) => {
              acc[f] = getOldVal(f);
              return acc;
            }, {})}
          />
        )
      ) : null}

      {undoStillOffered ? (
        <Pressable
          onPress={onUndo}
          disabled={busy}
          style={({ pressed }) => [
            styles(c, scale).undoChip,
            (pressed || busy) && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Undo this change"
        >
          <Ionicons name="arrow-undo" size={14} color={c.brand} style={{ marginRight: 6 }} />
          <Text style={styles(c, scale).undoChipText}>
            Undo · {Math.ceil(remaining / 1000)}s
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Styles ---------------------------------------------------------------

// Styles are theme-aware, so they're generated per-render via a factory.
// Cheap for our small tree; keeps colors consistent with the app theme.
const styles = (c: ReturnType<typeof useTheme>['c'], scale: number) => StyleSheet.create({
  card: {
    marginTop: 8,
    marginLeft: 44,   // align with George bubble body (avatar slot is 32-ish wide)
    marginRight: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
    gap: 10,
  },
  cardCompact: {
    paddingVertical: 10,
  },
  cardApplied: {
    backgroundColor: c.surfaceSecondary,
    opacity: 0.94,
  },
  compactDiff: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 11 * scale,
    fontWeight: '700',
    color: c.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diffLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  oldVal: {
    fontSize: 14 * scale,
    color: c.muted,
    textDecorationLine: 'line-through',
    flexShrink: 1,
  },
  newVal: {
    fontSize: 14 * scale,
    color: c.onSurface,
    fontWeight: '600',
    flexShrink: 1,
  },
  fullDiff: {
    gap: 10,
  },
  fullDiffRow: {
    gap: 4,
  },
  fullDiffLabel: {
    fontSize: 11 * scale,
    fontWeight: '700',
    color: c.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fullDiffValues: {
    paddingLeft: 4,
  },
  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelText: {
    fontSize: 14 * scale,
    fontWeight: '700',
    color: c.onSurface,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chipPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 40,
  },
  chipDanger: {
    backgroundColor: '#DC2626',
  },
  chipPrimaryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13 * scale,
  },
  chipSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 40,
  },
  chipSecondaryText: {
    color: c.onSurface,
    fontWeight: '700',
    fontSize: 13 * scale,
  },
  appliedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  appliedHeaderText: {
    fontSize: 12 * scale,
    fontWeight: '800',
    color: c.brand,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  undoChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  undoChipText: {
    color: c.brand,
    fontWeight: '700',
    fontSize: 12 * scale,
  },
  mutedRow: {
    marginTop: 6,
    marginLeft: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mutedText: {
    fontSize: 12 * scale,
    color: c.muted,
    fontStyle: 'italic',
  },
});
