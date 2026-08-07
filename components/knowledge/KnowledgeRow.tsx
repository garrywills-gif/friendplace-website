'use client';

import { useState } from 'react';
import { type KnowledgeEntry } from '@/lib/cms-api';
import { VisibilityBadge, TypeBadge, StatusBadge, formatRelative } from './KnowledgeBadges';

/**
 * KnowledgeRow — one library row. Collapsed by default (title + badges
 * + one-line preview); expands inline to show the full body, admin
 * context, related entries, and edit/supersede/discard controls.
 *
 * The row is designed to make evolution obvious: every entry that has
 * been superseded shows the arrow to its replacement inline, and
 * evolution notes surface right in the header.
 */
export function KnowledgeRow({
  entry, busy, onEdit, onSupersede, onDiscard,
}: {
  entry: KnowledgeEntry;
  busy?: boolean;
  onEdit: () => void;
  onSupersede: () => void;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isSuperseded = entry.status === 'superseded';
  const hasAdminContext = !!entry.admin_context;

  return (
    <article style={row}>
      <div
        style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <TypeBadge type={entry.type} />
            <VisibilityBadge visibility={entry.visibility} />
            {entry.status !== 'active' && <StatusBadge status={entry.status} />}
            {hasAdminContext && <span style={layerBadge}>+ admin layer</span>}
            <code style={idChip}>{entry.id}</code>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8' }}>
              {entry.updated_at ? formatRelative(entry.updated_at) : ''}
            </span>
          </div>

          <h3 style={{ margin: '2px 0 4px', fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
            {entry.title}
          </h3>

          {!open && (
            <p style={{ margin: 0, fontSize: 13, color: '#64748B', lineHeight: 1.45 }}>
              {firstLine(entry.body_md)}
            </p>
          )}

          {isSuperseded && entry.superseded_by && (
            <div style={supersedeArrow}>
              → superseded by <code style={idChip}>{entry.superseded_by}</code>
            </div>
          )}

          {entry.evolution_note && (
            <div style={evolutionLine}>
              <span style={{ fontWeight: 700 }}>Evolution: </span>
              {entry.evolution_note}
            </div>
          )}
        </div>
        <button type="button" aria-label="Toggle" style={chevron}>{open ? '▴' : '▾'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={bodyBox}>{entry.body_md}</div>

          {hasAdminContext && (
            <div style={adminBox}>
              <div style={adminLabel}>🔒 Admin-only context</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, color: '#78350F' }}>
                {entry.admin_context}
              </div>
            </div>
          )}

          {entry.tags && entry.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {entry.tags.map((t) => (
                <span key={t} style={tagChip}>#{t}</span>
              ))}
            </div>
          )}

          {entry.sources && entry.sources.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748B' }}>
              <strong>Sources: </strong>
              {entry.sources.map((s, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {s.label || s.url || s.path || '—'}
                </span>
              ))}
            </div>
          )}

          <div style={actionsRow}>
            <button type="button" onClick={onEdit} disabled={busy} style={editBtn}>✏️ Edit</button>
            {entry.status === 'active' && (
              <button type="button" onClick={onSupersede} disabled={busy} style={supersedeBtn}>🔁 Supersede</button>
            )}
            <button type="button" onClick={onDiscard} disabled={busy} style={discardBtn}>
              🗑️ {entry.status === 'draft' ? 'Delete draft' : 'Discard'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function firstLine(s: string): string {
  if (!s) return '';
  const line = s.split('\n')[0].trim();
  return line.length > 180 ? line.slice(0, 180).trimEnd() + '…' : line;
}

// ─── styles ────────────────────────────────────────────────────────────
const row: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  padding: '14px 16px',
  transition: 'border-color 100ms ease',
};
const idChip: React.CSSProperties = { background: '#F1F5F9', color: '#0F172A', padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, fontWeight: 600 };
const layerBadge: React.CSSProperties = { background: '#FEF3C7', color: '#78350F', fontSize: 11, padding: '2px 7px', borderRadius: 999, fontWeight: 700 };
const supersedeArrow: React.CSSProperties = { marginTop: 6, fontSize: 12, color: '#64748B', display: 'flex', gap: 6, alignItems: 'center' };
const evolutionLine: React.CSSProperties = { marginTop: 6, fontSize: 12, color: '#334155', background: '#F8FAFC', padding: '6px 10px', borderRadius: 6, border: '1px solid #E2E8F0', lineHeight: 1.45 };
const chevron: React.CSSProperties = { background: 'transparent', border: 0, fontSize: 18, color: '#64748B', cursor: 'pointer', padding: 4 };
const bodyBox: React.CSSProperties = { whiteSpace: 'pre-wrap', fontSize: 14, color: '#0F172A', lineHeight: 1.6, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px' };
const adminBox: React.CSSProperties = { marginTop: 10, background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 13 };
const adminLabel: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: '#78350F', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
const tagChip: React.CSSProperties = { background: '#F1F5F9', color: '#334155', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600 };
const actionsRow: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 14 };
const editBtn: React.CSSProperties = { padding: '7px 12px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const supersedeBtn: React.CSSProperties = { padding: '7px 12px', background: '#0F172A', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const discardBtn: React.CSSProperties = { padding: '7px 12px', background: '#FFFFFF', color: '#B91C1C', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
