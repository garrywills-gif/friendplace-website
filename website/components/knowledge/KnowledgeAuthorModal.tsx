'use client';

import { useEffect, useMemo, useState } from 'react';
import { cmsApi, type KnowledgeEntry } from '@/lib/cms-api';

/**
 * KnowledgeAuthorModal — the single author flow for creating, editing
 * or superseding an institutional knowledge entry.
 *
 * Three modes:
 *   • Create (default) — new entry. Visibility defaults to `admin`.
 *   • Edit             — patch an existing entry in place (including
 *                        confirming a draft to active as a side-effect
 *                        of editing).
 *   • Supersede        — clone the old entry as a starting point,
 *                        require an `evolution_note` narrating why the
 *                        change happened. The old entry is marked
 *                        `superseded` server-side.
 */

const TYPES: KnowledgeEntry['type'][] = [
  'story', 'principle', 'philosophy', 'decision', 'feature', 'roadmap',
];

const TYPE_HINT: Record<string, string> = {
  story: 'The identity, origin, or emotional truth of FriendPlace.',
  principle: 'A foundational value that shapes decisions.',
  philosophy: 'Higher-order guidance for judgement calls.',
  decision: 'An architectural or product decision + why.',
  feature: 'How something works today.',
  roadmap: 'Planned or in-progress work.',
};

export function KnowledgeAuthorModal({
  open,
  editing,
  supersedingFrom,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: KnowledgeEntry | null;
  supersedingFrom: KnowledgeEntry | null;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const mode: 'create' | 'edit' | 'supersede' = supersedingFrom
    ? 'supersede'
    : editing
    ? 'edit'
    : 'create';

  const [type, setType] = useState<KnowledgeEntry['type']>('decision');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'admin'>('admin');
  const [adminContext, setAdminContext] = useState('');
  const [evolutionNote, setEvolutionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && editing) {
      setType(editing.type);
      setTitle(editing.title || '');
      setBody(editing.body_md || '');
      setTags((editing.tags || []).join(', '));
      setVisibility((editing.visibility || 'admin') as 'public' | 'admin');
      setAdminContext(editing.admin_context || '');
      setEvolutionNote(editing.evolution_note || '');
    } else if (mode === 'supersede' && supersedingFrom) {
      setType(supersedingFrom.type);
      setTitle(supersedingFrom.title || '');
      setBody(supersedingFrom.body_md || '');
      setTags((supersedingFrom.tags || []).join(', '));
      setVisibility((supersedingFrom.visibility || 'admin') as 'public' | 'admin');
      setAdminContext(supersedingFrom.admin_context || '');
      setEvolutionNote('');
    } else {
      setType('decision');
      setTitle('');
      setBody('');
      setTags('');
      setVisibility('admin');
      setAdminContext('');
      setEvolutionNote('');
    }
  }, [open, mode, editing, supersedingFrom]);

  const disabled = useMemo(
    () => !title.trim() || !body.trim() || saving,
    [title, body, saving],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    const tagsArr = tags.split(',').map((s) => s.trim()).filter(Boolean);
    const payload: Partial<KnowledgeEntry> = {
      type,
      title: title.trim(),
      body_md: body.trim(),
      tags: tagsArr,
      visibility,
      admin_context: adminContext.trim() || null,
    };
    try {
      if (mode === 'edit' && editing) {
        await cmsApi.updateKnowledge(editing.id, payload);
        await onSaved(`✏️ Updated “${payload.title}”.`);
      } else if (mode === 'supersede' && supersedingFrom) {
        const supersedePayload: Partial<KnowledgeEntry> = {
          ...payload,
          evolution_note: evolutionNote.trim() || null,
        };
        const created = await cmsApi.supersedeKnowledge(supersedingFrom.id, supersedePayload);
        await onSaved(`🔁 Superseded — new entry ${created.id} is now active.`);
      } else {
        const created = await cmsApi.createKnowledge(payload);
        await onSaved(`✅ Added “${created.title}” to George's memory.`);
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
            {mode === 'edit'
              ? 'Edit entry'
              : mode === 'supersede'
              ? `Supersede ${supersedingFrom?.id}`
              : 'Add knowledge entry'}
          </h2>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        {mode === 'supersede' && supersedingFrom && (
          <div style={supersedeNotice}>
            You&apos;re creating a <strong>new active version</strong> of{' '}
            <em>{supersedingFrom.title}</em>. The old entry will be marked
            <em> superseded</em> and stay linked for history.
          </div>
        )}

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={row}>
            <label style={label}>Type
              <select value={type} onChange={(e) => setType(e.target.value as KnowledgeEntry['type'])} style={input}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <span style={hint}>{TYPE_HINT[type]}</span>
            </label>

            <label style={label}>Visibility
              <div style={{ display: 'flex', gap: 8 }}>
                <VisibilityPill
                  active={visibility === 'admin'}
                  onClick={() => setVisibility('admin')}
                  label="🔒 Admin only"
                  hint="MCGS-only. Default."
                />
                <VisibilityPill
                  active={visibility === 'public'}
                  onClick={() => setVisibility('public')}
                  label="🌐 Public"
                  hint="Members can see it."
                />
              </div>
            </label>
          </div>

          <label style={label}>Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Why Share a Moment (renamed from Post Your Recipe)"
              style={input}
              maxLength={140}
            />
          </label>

          <label style={label}>Body (Markdown supported)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                mode === 'supersede'
                  ? 'Describe the new state — what is true now.'
                  : 'Capture the decision, principle, or feature in your own voice. Aim for 1–3 short paragraphs.'
              }
              style={{ ...input, minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.5 }}
            />
          </label>

          {visibility === 'public' && (
            <label style={label}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Admin-only context <span style={badge}>optional</span>
              </span>
              <textarea
                value={adminContext}
                onChange={(e) => setAdminContext(e.target.value)}
                placeholder="Extra history, decision notes, or design origin George should only mention to admins. Members won't see this."
                style={{ ...input, minHeight: 110, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.5, background: '#FFFBEB' }}
              />
              <span style={hint}>
                Lets a single public entry carry a hidden admin layer — so George stays consistent instead of duplicating the topic.
              </span>
            </label>
          )}

          {mode === 'supersede' && (
            <label style={label}>Evolution note
              <input
                type="text"
                value={evolutionNote}
                onChange={(e) => setEvolutionNote(e.target.value)}
                placeholder="e.g. Renamed to 'Share a Moment' in June 2026 to broaden scope beyond recipes."
                style={input}
                maxLength={220}
              />
              <span style={hint}>
                One sentence narrating <em>why</em> this change happened. George uses this to explain the arc — what it used to be, what it is now, and why.
              </span>
            </label>
          )}

          <label style={label}>Tags
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated, snake_case"
              style={input}
            />
          </label>
        </div>

        {error && <div style={errBanner}>{error}</div>}

        <div style={footer}>
          <button type="button" onClick={onClose} style={cancelBtn} disabled={saving}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={disabled} style={saveBtn}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : mode === 'supersede' ? 'Supersede' : 'Add to knowledge'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VisibilityPill({
  active, onClick, label, hint,
}: { active: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 12px',
        border: `1px solid ${active ? '#0F172A' : '#CBD5E1'}`,
        background: active ? '#0F172A' : '#FFFFFF',
        color: active ? '#FFFFFF' : '#0F172A',
        borderRadius: 8,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
      }}
      aria-pressed={active}
    >
      <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 11, opacity: active ? 0.75 : 0.6 }}>{hint}</span>
    </button>
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' };
const sheet: React.CSSProperties = { background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto', padding: '20px 22px 18px', boxShadow: '0 24px 64px rgba(15,23,42,0.32)' };
const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
const closeBtn: React.CSSProperties = { background: 'transparent', border: 0, fontSize: 20, color: '#64748B', cursor: 'pointer', padding: 4, lineHeight: 1 };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' };
const input: React.CSSProperties = { padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, background: '#FFFFFF', color: '#0F172A', width: '100%', fontFamily: 'inherit', fontWeight: 500, textTransform: 'none', letterSpacing: 0 };
const hint: React.CSSProperties = { fontSize: 11, color: '#64748B', fontWeight: 500, textTransform: 'none', letterSpacing: 0, lineHeight: 1.4 };
const badge: React.CSSProperties = { fontSize: 10, color: '#78350F', background: '#FEF3C7', padding: '2px 6px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase' };
const supersedeNotice: React.CSSProperties = { background: '#FEF3C7', border: '1px solid #FCD34D', padding: '10px 14px', borderRadius: 8, fontSize: 13, color: '#78350F', marginBottom: 14, lineHeight: 1.4 };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 };
const cancelBtn: React.CSSProperties = { padding: '9px 16px', background: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const saveBtn: React.CSSProperties = { padding: '9px 18px', background: '#0F172A', color: '#FFFFFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: 1 };
const errBanner: React.CSSProperties = { background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 12 };
