'use client';

/**
 * George's Institutional Knowledge Library — MCGS
 *
 * A single knowledge repository with permission-gated retrieval. Every
 * entry declares:
 *   • type        (story · principle · decision · feature · roadmap · philosophy)
 *   • visibility  (public | admin)  ← who can see it at all
 *   • admin_context (optional)      ← extra layer shown ONLY to admins
 *     on a public entry, so we don't split into two.
 *
 * The page has three sections:
 *   1. Drafts awaiting confirmation  ← surfaces George's chat-proposed
 *                                      entries first.
 *   2. Library                       ← search + filter across everything.
 *   3. Author flow                   ← add a new entry (Slice-2 will add
 *                                      supersede + edit in place).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { AskGeorgeAboutThis } from '@/components/mcgs/AskGeorgeAboutThis';
import { cmsApi, type KnowledgeEntry } from '@/lib/cms-api';
import { KnowledgeAuthorModal } from '@/components/knowledge/KnowledgeAuthorModal';
import { KnowledgeDraftCard } from '@/components/knowledge/KnowledgeDraftCard';
import { KnowledgeRow } from '@/components/knowledge/KnowledgeRow';

const TYPES: KnowledgeEntry['type'][] = [
  'story', 'principle', 'philosophy', 'decision', 'feature', 'roadmap',
];

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  superseded: 'Superseded',
  draft: 'Draft',
  discarded: 'Discarded',
};

export default function KnowledgeLibraryPage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [drafts, setDrafts] = useState<KnowledgeEntry[]>([]);
  const [stats, setStats] = useState<{
    total: number; drafts: number; public: number; admin_only: number; superseded: number;
    by_type: Record<string, number>;
  } | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [supersedingFrom, setSupersedingFrom] = useState<KnowledgeEntry | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [reseeding, setReseeding] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, draftsRes, statsRes] = await Promise.all([
        cmsApi.listKnowledge({
          type: typeFilter || undefined,
          status: statusFilter || undefined,
          visibility: visibilityFilter || undefined,
          q: query.trim() || undefined,
          limit: 200,
        }),
        cmsApi.knowledgeDrafts(),
        cmsApi.knowledgeStats(),
      ]);
      setEntries(listRes.items);
      setDrafts(draftsRes.items);
      setStats(statsRes);
    } catch (e: any) {
      setError(e?.message || 'Failed to load knowledge library');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, visibilityFilter, query]);

  useEffect(() => { reload(); }, [reload]);

  // Auto-dismiss status banner after a beat so it doesn't linger.
  useEffect(() => {
    if (!statusBanner) return;
    const t = setTimeout(() => setStatusBanner(null), 3500);
    return () => clearTimeout(t);
  }, [statusBanner]);

  const filteredCounts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const e of entries) byType.set(e.type, (byType.get(e.type) || 0) + 1);
    return byType;
  }, [entries]);

  async function handleConfirm(entry: KnowledgeEntry) {
    setBusyEntryId(entry.id);
    try {
      await cmsApi.confirmKnowledgeDraft(entry.id);
      setStatusBanner({ tone: 'ok', text: `✅ Confirmed “${entry.title}” — now in George's memory.` });
      await reload();
    } catch (e: any) {
      setStatusBanner({ tone: 'err', text: e?.message || 'Failed to confirm entry' });
    } finally {
      setBusyEntryId(null);
    }
  }

  async function handleDiscard(entry: KnowledgeEntry) {
    if (!confirm(`Discard “${entry.title}”? ${entry.status === 'draft' ? 'This draft will be permanently removed.' : 'This entry will be marked as discarded but kept for the history trail.'}`)) return;
    setBusyEntryId(entry.id);
    try {
      await cmsApi.discardKnowledge(entry.id);
      setStatusBanner({ tone: 'ok', text: `🗑️ Discarded “${entry.title}”.` });
      await reload();
    } catch (e: any) {
      setStatusBanner({ tone: 'err', text: e?.message || 'Failed to discard entry' });
    } finally {
      setBusyEntryId(null);
    }
  }

  async function handleReseed() {
    if (!confirm('Refresh the knowledge base from FriendPlace\'s canonical documentation? Existing entries will be updated in place; drafts are not touched.')) return;
    setReseeding(true);
    try {
      const r = await cmsApi.reseedKnowledge();
      setStatusBanner({
        tone: 'ok',
        text: `🌿 Refreshed. ${r.created} created · ${r.updated} updated · ${r.total} total.`,
      });
      await reload();
    } catch (e: any) {
      setStatusBanner({ tone: 'err', text: e?.message || 'Refresh failed' });
    } finally {
      setReseeding(false);
    }
  }

  return (
    <AdminShell title="Knowledge">
      <p style={lede}>
        George&apos;s institutional memory. One repository — every entry has a
        visibility flag so members and admins each see the right slice.
        Nothing enters here without your confirmation.
      </p>

      {/* Stats strip */}
      {stats && (
        <div style={statsStrip}>
          <StatChip label="Total"       value={stats.total} tone="neutral" />
          <StatChip label="Public"      value={stats.public} tone="ok" />
          <StatChip label="Admin-only"  value={stats.admin_only} tone="warn" />
          <StatChip label="Drafts"      value={stats.drafts} tone={stats.drafts > 0 ? 'accent' : 'neutral'} />
          <StatChip label="Superseded"  value={stats.superseded} tone="neutral" />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button style={secondaryBtn} onClick={handleReseed} disabled={reseeding}>
              {reseeding ? 'Refreshing…' : '🌿 Refresh from docs'}
            </button>
            <button style={primaryBtn} onClick={() => { setEditing(null); setSupersedingFrom(null); setAuthorOpen(true); }}>
              + Add entry
            </button>
          </div>
        </div>
      )}

      {statusBanner && (
        <div style={statusBanner.tone === 'ok' ? okBanner : errBanner}>
          {statusBanner.text}
        </div>
      )}

      {/* Drafts strip — always at the top so admin sees them first */}
      {drafts.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div style={sectionHeader}>
            <h2 style={sectionTitle}>Awaiting your confirmation</h2>
            <span style={sectionSubtitle}>
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} George has proposed.
              Nothing here influences answers until you confirm it.
            </span>
          </div>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {drafts.map((d) => (
              <KnowledgeDraftCard
                key={d.id}
                entry={d}
                busy={busyEntryId === d.id}
                onConfirm={() => handleConfirm(d)}
                onEdit={() => { setEditing(d); setSupersedingFrom(null); setAuthorOpen(true); }}
                onDiscard={() => handleDiscard(d)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Library controls */}
      <section style={{ marginTop: 32 }}>
        <div style={sectionHeader}>
          <h2 style={sectionTitle}>Library</h2>
          <span style={sectionSubtitle}>Search, filter, and edit.</span>
        </div>

        <div style={filterRow}>
          <input
            type="text"
            placeholder="Search titles, bodies, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...inputStyle, minWidth: 260 }}
          />

          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {filteredCounts.get(t) ? ` (${filteredCounts.get(t)})` : ''}
              </option>
            ))}
          </select>

          <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} style={selectStyle}>
            <option value="">All visibility</option>
            <option value="public">🌐 Public only</option>
            <option value="admin">🔒 Admin only</option>
          </select>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            <option value="active">{STATUS_LABELS.active}</option>
            <option value="superseded">{STATUS_LABELS.superseded}</option>
            <option value="draft">{STATUS_LABELS.draft}</option>
            <option value="discarded">{STATUS_LABELS.discarded}</option>
          </select>

          <div style={{ marginLeft: 'auto' }}>
            <AskGeorgeAboutThis
              label="Ask George"
              prompts={[
                'Summarise our current institutional knowledge — what topics are we thin on?',
                'Which decisions are older than 90 days and should be reviewed?',
                'Show me connections between our story entries and moderation philosophy.',
              ]}
            />
          </div>
        </div>

        {loading && <div style={helperText}>Loading…</div>}
        {error && <div style={errBanner}>{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <div style={emptyBox}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Nothing matches.</strong>
            <span style={{ color: '#64748B', fontSize: 13 }}>
              Try clearing the filters or adjusting your search.
            </span>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {entries.map((e) => (
              <KnowledgeRow
                key={e.id}
                entry={e}
                busy={busyEntryId === e.id}
                onEdit={() => { setEditing(e); setSupersedingFrom(null); setAuthorOpen(true); }}
                onSupersede={() => { setEditing(null); setSupersedingFrom(e); setAuthorOpen(true); }}
                onDiscard={() => handleDiscard(e)}
              />
            ))}
          </div>
        )}
      </section>

      <KnowledgeAuthorModal
        open={authorOpen}
        editing={editing}
        supersedingFrom={supersedingFrom}
        onClose={() => { setAuthorOpen(false); setEditing(null); setSupersedingFrom(null); }}
        onSaved={async (msg) => {
          setStatusBanner({ tone: 'ok', text: msg });
          setAuthorOpen(false);
          setEditing(null);
          setSupersedingFrom(null);
          await reload();
        }}
      />
    </AdminShell>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'ok' | 'warn' | 'accent' }) {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: '#F1F5F9', fg: '#0F172A', border: '#E2E8F0' },
    ok:      { bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' },
    warn:    { bg: '#FFFBEB', fg: '#78350F', border: '#FCD34D' },
    accent:  { bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' },
  };
  const p = palette[tone];
  return (
    <div style={{
      background: p.bg, color: p.fg, border: `1px solid ${p.border}`,
      padding: '10px 14px', borderRadius: 10, minWidth: 92,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.75 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const lede: React.CSSProperties = { color: '#475569', marginTop: -8, marginBottom: 20, maxWidth: 780, lineHeight: 1.55 };
const statsStrip: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 };
const sectionHeader: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' };
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 };
const sectionSubtitle: React.CSSProperties = { fontSize: 13, color: '#64748B' };
const filterRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' };
const inputStyle: React.CSSProperties = { padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, background: '#FFFFFF' };
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 160, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '9px 16px', background: '#0F172A', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '9px 14px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const okBanner: React.CSSProperties = { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 16 };
const errBanner: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginTop: 16 };
const helperText: React.CSSProperties = { color: '#64748B', fontSize: 13, marginTop: 16 };
const emptyBox: React.CSSProperties = { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '32px 20px', textAlign: 'center', marginTop: 16 };
