'use client';

import { useMemo, useState } from 'react';
import type { MemberModerationLogEntry, MemberReport } from '@/lib/cms-api';
import type { ModAction } from '@/components/admin/ConfirmIdentityAction';

type UnifiedItem =
  | { kind: 'log';    ts: string; entry: MemberModerationLogEntry }
  | { kind: 'report'; ts: string; entry: MemberReport };

/**
 * ModerationTimeline — reverse-chronological interleaving of the
 * member's reports and moderation_log entries. Each row shows the
 * acting admin, reason, outcome and cross-links.
 *
 * A "Density" toggle lets desktop admins swap between Compact rows
 * (dense scanning) and Comfortable rows (full context visible).
 *
 * When a row is a report, the trailing quick-action bar lets the admin
 * launch a Warn/Suspend/Ban dialog *seeded with the report* — that's
 * how "Report ↔ Profile stays sticky" is honoured in the UI.
 */
export function ModerationTimeline({
  log,
  reports,
  onActFromReport,
}: {
  log: MemberModerationLogEntry[];
  reports: MemberReport[];
  onActFromReport: (report: MemberReport, action: ModAction) => void;
}) {
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [filter, setFilter] = useState<'' | 'log' | 'report'>('');

  const items: UnifiedItem[] = useMemo(() => {
    const combined: UnifiedItem[] = [];
    for (const e of log) {
      if (!e?.created_at) continue;
      combined.push({ kind: 'log', ts: e.created_at, entry: e });
    }
    for (const r of reports) {
      if (!r?.created_at) continue;
      combined.push({ kind: 'report', ts: r.created_at, entry: r });
    }
    combined.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    return filter ? combined.filter((i) => i.kind === filter) : combined;
  }, [log, reports, filter]);

  return (
    <>
      <div style={controls}>
        <div style={{ display: 'flex', gap: 6 }}>
          <FilterPill active={filter === ''}       onClick={() => setFilter('')}>All</FilterPill>
          <FilterPill active={filter === 'log'}    onClick={() => setFilter('log')}>Actions</FilterPill>
          <FilterPill active={filter === 'report'} onClick={() => setFilter('report')}>Reports</FilterPill>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <FilterPill active={density === 'compact'}     onClick={() => setDensity('compact')}>Compact</FilterPill>
          <FilterPill active={density === 'comfortable'} onClick={() => setDensity('comfortable')}>Comfortable</FilterPill>
        </div>
      </div>

      {items.length === 0 && (
        <div style={emptyBox}>
          <strong>Clean record.</strong>
          <span style={{ display: 'block', marginTop: 4, color: '#64748B', fontSize: 13 }}>
            No reports and no moderation actions for this member.
          </span>
        </div>
      )}

      <ol style={{ ...list, gap: density === 'compact' ? 6 : 10 }}>
        {items.map((item, i) => (
          <li key={`${item.kind}:${'id' in item.entry ? item.entry.id : i}:${item.ts}`}>
            {item.kind === 'log' ? (
              <ActionRow entry={item.entry} density={density} />
            ) : (
              <ReportRow entry={item.entry} density={density} onAct={onActFromReport} />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? '#0F172A' : '#CBD5E1'}`,
        background: active ? '#0F172A' : '#FFFFFF',
        color: active ? '#FFFFFF' : '#0F172A',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function ActionRow({ entry, density }: { entry: MemberModerationLogEntry; density: 'compact' | 'comfortable' }) {
  const meta = ACTION_STYLE[entry.action] || DEFAULT_STYLE;
  const compact = density === 'compact';
  const actor = actorNameFor(entry);
  return (
    <div style={{ ...row, borderLeftColor: meta.border, background: '#FFFFFF' }}>
      <div style={{ ...pill, background: meta.bg, color: meta.fg }}>{meta.icon} {meta.label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={rowTitle}>
          <span>
            <strong>{actor}</strong> {meta.verb}
            {entry.duration_hours ? <> for <strong>{entry.duration_hours}h</strong></> : null}
          </span>
          <span style={rowTime}>{formatWhen(entry.created_at)}</span>
        </div>
        {!compact && entry.reason && (
          <div style={reasonBox}>{entry.reason}</div>
        )}
        {!compact && entry.report_id && (
          <div style={crossLink}>Linked to <code style={code}>{entry.report_id}</code></div>
        )}
        {!compact && entry.until && entry.action === 'suspend' && (
          <div style={crossLink}>Lifts at <strong>{formatWhen(entry.until)}</strong></div>
        )}
      </div>
    </div>
  );
}

function ReportRow({ entry, density, onAct }: { entry: MemberReport; density: 'compact' | 'comfortable'; onAct: (r: MemberReport, a: ModAction) => void }) {
  const isOpen = entry.status === 'new' || entry.status === 'reviewing';
  const compact = density === 'compact';
  const borderColor = isOpen ? '#FBBF24' : '#CBD5E1';
  return (
    <div style={{ ...row, borderLeftColor: borderColor, background: isOpen ? '#FFFBEB' : '#FFFFFF' }}>
      <div style={{ ...pill, background: '#EEF2FF', color: '#3730A3' }}>📩 Report</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={rowTitle}>
          <span>
            {isOpen ? <strong>Awaiting review</strong> : (entry.outcome ? <>Resolved · <strong>{entry.outcome}</strong></> : 'Closed')}
            {entry.urgent && <span style={urgentTag}>URGENT</span>}
          </span>
          <span style={rowTime}>{formatWhen(entry.created_at)}</span>
        </div>
        {!compact && entry.reason && <div style={reasonBox}>{entry.reason}</div>}
        {!compact && entry.admin_note && (
          <div style={{ ...reasonBox, background: '#F1F5F9', color: '#334155' }}>
            <strong style={{ fontSize: 11, color: '#64748B' }}>Admin note: </strong>{entry.admin_note}
          </div>
        )}
        {!compact && entry.id && (
          <div style={crossLink}>Report id <code style={code}>{entry.id}</code></div>
        )}
        {!compact && isOpen && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onAct(entry, 'warn')}    style={{ ...miniBtn, background: '#F59E0B', color: '#FFFFFF' }}>⚠️ Warn from this</button>
            <button type="button" onClick={() => onAct(entry, 'suspend')} style={{ ...miniBtn, background: '#DC2626', color: '#FFFFFF' }}>⏸ Suspend</button>
            <button type="button" onClick={() => onAct(entry, 'ban')}     style={{ ...miniBtn, background: '#7F1D1D', color: '#FFFFFF' }}>🚫 Ban</button>
          </div>
        )}
      </div>
    </div>
  );
}

function actorNameFor(e: MemberModerationLogEntry): string {
  if (e.by === 'system') return 'System';
  const u = e.by_user;
  return (
    u?.display_name?.trim()
    || u?.first_name?.trim()
    || u?.email?.trim()
    || (u?.username ? `@${u.username}` : '')
    || (e.by || 'Someone')
  );
}

const DEFAULT_STYLE = { label: 'Action', icon: '•', verb: 'acted', bg: '#F1F5F9', fg: '#0F172A', border: '#CBD5E1' };

const ACTION_STYLE: Record<string, { label: string; icon: string; verb: string; bg: string; fg: string; border: string }> = {
  warn:     { label: 'Warning',   icon: '⚠️', verb: 'issued a warning',     bg: '#FEF3C7', fg: '#78350F', border: '#FBBF24' },
  suspend:  { label: 'Suspension',icon: '⏸',  verb: 'suspended this member', bg: '#FEE2E2', fg: '#991B1B', border: '#F87171' },
  ban:      { label: 'Ban',       icon: '🚫', verb: 'banned this member',    bg: '#FEE2E2', fg: '#7F1D1D', border: '#DC2626' },
  restore:  { label: 'Restore',   icon: '↩️', verb: 'restored this member',  bg: '#ECFDF5', fg: '#065F46', border: '#10B981' },
  delete:   { label: 'Delete',    icon: '🗑️', verb: 'deleted this member',   bg: '#F1F5F9', fg: '#334155', border: '#94A3B8' },
  note:     { label: 'Note',      icon: '📝', verb: 'added a note',          bg: '#EEF2FF', fg: '#3730A3', border: '#818CF8' },
  clear_restriction:
             { label: 'Cleared',   icon: '✅', verb: 'cleared a restriction', bg: '#ECFDF5', fg: '#065F46', border: '#10B981' },
};

function formatWhen(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch { return iso; }
}

// ─── styles ────────────────────────────────────────────────────────────
const controls: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' };
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' };
const row: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #E2E8F0', borderLeftWidth: 4, borderRadius: 10 };
const pill: React.CSSProperties = { padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0 };
const rowTitle: React.CSSProperties = { display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14, color: '#0F172A', flexWrap: 'wrap' };
const rowTime: React.CSSProperties = { fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' };
const reasonBox: React.CSSProperties = { marginTop: 6, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155', borderRadius: 6, padding: '6px 10px', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 };
const crossLink: React.CSSProperties = { marginTop: 6, fontSize: 12, color: '#64748B' };
const code: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, fontWeight: 600 };
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '1px dashed #A7F3D0', borderRadius: 12, padding: '24px 20px', textAlign: 'center', color: '#065F46' };
const urgentTag: React.CSSProperties = { marginLeft: 6, background: '#DC2626', color: '#FFFFFF', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' };
const miniBtn: React.CSSProperties = { padding: '5px 10px', border: 0, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
