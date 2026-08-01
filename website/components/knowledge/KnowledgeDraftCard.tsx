'use client';

import { type KnowledgeEntry } from '@/lib/cms-api';
import { VisibilityBadge, TypeBadge, formatRelative } from './KnowledgeBadges';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

/**
 * KnowledgeDraftCard — the prominent card George shows above the
 * library when he's proposed a new entry from chat. Three actions:
 * Confirm · Edit · Discard. Nothing else.
 */
export function KnowledgeDraftCard({
  entry, busy, onConfirm, onEdit, onDiscard,
}: {
  entry: KnowledgeEntry;
  busy?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={draftBadge}><span style={{ display: 'inline-flex', width: 14, height: 14, marginRight: 4, verticalAlign: 'middle' }}><GeorgeButterflyMark size={14} /></span>George proposed</span>
        <TypeBadge type={entry.type} />
        <VisibilityBadge visibility={entry.visibility} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#78350F' }}>
          {entry.created_at ? formatRelative(entry.created_at) : ''}
        </span>
      </div>

      <h3 style={{ margin: '4px 0 6px', fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
        {entry.title}
      </h3>

      <p style={{ margin: 0, fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {truncate(entry.body_md, 380)}
      </p>

      {entry.tags && entry.tags.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {entry.tags.slice(0, 8).map((t) => (
            <span key={t} style={tagChip}>#{t}</span>
          ))}
        </div>
      )}

      <div style={actionsRow}>
        <button type="button" onClick={onConfirm} disabled={busy} style={confirmBtn}>
          {busy ? '…' : '✅ Confirm'}
        </button>
        <button type="button" onClick={onEdit} disabled={busy} style={editBtn}>
          ✏️ Edit
        </button>
        <button type="button" onClick={onDiscard} disabled={busy} style={discardBtn}>
          ❌ Discard
        </button>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

// ─── styles ────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'linear-gradient(180deg, #FEFCE8 0%, #FEF3C7 100%)',
  border: '1px solid #FBBF24',
  borderRadius: 12,
  padding: '14px 16px',
  boxShadow: '0 4px 12px rgba(217,119,6,0.08)',
};
const draftBadge: React.CSSProperties = { background: '#0F172A', color: '#FEF3C7', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.06em' };
const tagChip: React.CSSProperties = { background: 'rgba(15,23,42,0.06)', color: '#78350F', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600 };
const actionsRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 14 };
const confirmBtn: React.CSSProperties = { padding: '8px 14px', background: '#059669', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const editBtn: React.CSSProperties = { padding: '8px 14px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const discardBtn: React.CSSProperties = { padding: '8px 14px', background: '#FFFFFF', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
