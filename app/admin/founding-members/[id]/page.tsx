'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { FoundingMemberCard } from '@/components/admin/FoundingMemberCard';
import { cmsApi, type FoundingMember } from '@/lib/cms-api';

export default function FoundingMemberEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [member, setMember] = useState<FoundingMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const m = await cmsApi.getFoundingMember(id);
        setMember(m);
      } catch (e: any) {
        if (e?.message?.includes('not found')) setNotFound(true);
        else setToast(e?.message || 'Failed to load');
      } finally { setLoading(false); }
    })();
  }, [id]);

  const update = (patch: Partial<FoundingMember>) => {
    setMember(prev => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const save = async (extra?: Partial<FoundingMember>): Promise<FoundingMember | null> => {
    if (!member) return null;
    setSaving(true);
    try {
      const patch = {
        name: member.name,
        number: member.number,
        bio_html: member.bio_html,
        role: member.role,
        location: member.location,
        avatar_url: member.avatar_url,
        status: member.status,
        hidden: member.hidden,
        ...(extra || {}),
      };
      const updated = await cmsApi.updateFoundingMember(member.id, patch);
      setMember(updated);
      setDirty(false);
      flash('Saved');
      return updated;
    } catch (e: any) {
      flash(`Save failed: ${e?.message || ''}`, 3200);
      return null;
    } finally { setSaving(false); }
  };

  const flash = (msg: string, ms = 2000) => { setToast(msg); setTimeout(() => setToast(null), ms); };

  const publish = async () => {
    if (!member) return;
    if (!member.name?.trim()) { flash('Add a name before publishing', 2600); return; }
    if (!Number.isFinite(member.number) || member.number < 1) {
      flash('Add a member number of 1 or higher before publishing', 2800);
      return;
    }
    await save({ status: 'published', hidden: false });
    flash('Published — visible on the website');
  };

  const unpublish = async () => {
    await save({ status: 'draft' });
    flash('Moved back to draft');
  };

  if (loading) return <AdminShell title="Founding member"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;
  if (notFound || !member) return (
    <AdminShell title="Not found">
      <p style={{ color: '#475569' }}>That founding member doesn&apos;t exist. It may have been deleted.</p>
      <Link href="/admin/founding-members" className="cms-btn-primary" style={{ ...s.primaryBtn, textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>
        ← Back to all founding members
      </Link>
    </AdminShell>
  );

  const isPublished = member.status === 'published';

  return (
    <AdminShell>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Link href="/admin/founding-members" style={{ color: '#14B8A6', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>
            ← All founding members
          </Link>
          <h1 style={{ fontSize: 28, color: '#0A2540', fontWeight: 900, margin: '6px 0 0' }}>
            #{member.number} · {member.name || 'Unnamed founder'}
          </h1>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill status={member.status} hidden={!!member.hidden} />
            <span style={{ fontSize: 12, color: '#94A3B8', letterSpacing: '0.03em' }}>
              Created {formatDate(member.created_at)} · Last updated {formatDate(member.updated_at)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={() => setPreviewOpen(true)}>👁️ Preview</button>
          <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, opacity: saving ? 0.65 : 1 }} disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : dirty ? 'Save draft' : 'Saved ✓'}
          </button>
          {isPublished ? (
            <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={unpublish}>Move to draft</button>
          ) : (
            <button type="button" className="cms-btn-primary" style={s.primaryBtn} onClick={publish}>🚀 Publish</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'flex-start' }}>
        {/* LEFT: fields */}
        <div>
          <div style={s.card}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
              <div>
                <label style={s.label}>Name</label>
                <input
                  className="cms-input"
                  style={{ ...s.input, fontSize: 17, fontWeight: 700 }}
                  value={member.name}
                  onChange={e => update({ name: e.target.value })}
                  placeholder="Margaret"
                />
              </div>
              <div>
                <label style={s.label}>Member #</label>
                <input
                  className="cms-input"
                  style={{ ...s.input, fontSize: 17, fontWeight: 700, textAlign: 'center' }}
                  type="number"
                  min={1}
                  value={member.number ?? ''}
                  onChange={e => update({ number: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div style={{ height: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>Role (optional)</label>
                <input
                  className="cms-input"
                  style={s.input}
                  value={member.role || ''}
                  onChange={e => update({ role: e.target.value })}
                  placeholder="Coffee Lounge Regular"
                />
              </div>
              <div>
                <label style={s.label}>Location (optional)</label>
                <input
                  className="cms-input"
                  style={s.input}
                  value={member.location || ''}
                  onChange={e => update({ location: e.target.value })}
                  placeholder="Newcastle, NSW"
                />
              </div>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Short bio</h2>
            <RichTextEditor
              value={member.bio_html || ''}
              onChange={html => update({ bio_html: html })}
              placeholder="A sentence or two about this founder…"
              minHeight={200}
            />
            <div style={s.helper}>Keep it warm and short — think two or three sentences.</div>
          </div>
        </div>

        {/* RIGHT: sidebar tools */}
        <div>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Avatar</h2>
            <AvatarWell url={member.avatar_url || ''} name={member.name} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="cms-btn-primary" style={{ ...s.primaryBtn, padding: '10px 16px', fontSize: 13, flex: 1 }} onClick={() => setPickerOpen(true)}>
                {member.avatar_url ? 'Change image' : 'Pick from library'}
              </button>
              {member.avatar_url && (
                <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '10px 12px', fontSize: 13 }} onClick={() => update({ avatar_url: '' })}>Remove</button>
              )}
            </div>
            <div style={s.helper}>Square images work best. When empty we show the person&apos;s initial.</div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Visibility</h2>
            <ToggleRow
              label="Draft / Published"
              hint={member.status === 'published' ? 'Live on the website' : 'Not yet published'}
              checked={member.status === 'published'}
              onChange={next => update({ status: next ? 'published' : 'draft' })}
            />
            <div style={{ height: 12 }} />
            <ToggleRow
              label="Hidden"
              hint={member.hidden ? 'Temporarily hidden even if published' : 'Visible when published'}
              checked={!!member.hidden}
              onChange={next => update({ hidden: next })}
            />
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(url) => { update({ avatar_url: url }); setPickerOpen(false); }}
      />
      {previewOpen && (
        <PreviewModal member={member} onClose={() => setPreviewOpen(false)} />
      )}
      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

/* ---------- Sub-components ---------- */

function AvatarWell({ url, name }: { url: string; name: string }) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';
  const absUrl = url ? (url.startsWith('http') ? url : `${BASE}${url}`) : '';
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div style={{
      width: 96, height: 96, borderRadius: '50%',
      background: absUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
      color: '#FFFFFF', fontSize: 40, fontWeight: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', margin: '0 auto',
    }}>
      {absUrl ? (
         
        <img src={absUrl} alt={name || 'Founding member'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initial}
    </div>
  );
}

function StatusPill({ status, hidden }: { status: string; hidden: boolean }) {
  const base: React.CSSProperties = {
    display: 'inline-block', padding: '3px 10px', borderRadius: 999,
    fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
  };
  if (status !== 'published') return <span style={{ ...base, background: '#FEF3C7', color: '#92400E' }}>Draft</span>;
  if (hidden) return <span style={{ ...base, background: '#F1F5F9', color: '#475569' }}>Hidden</span>;
  return <span style={{ ...base, background: '#DCFCE7', color: '#166534' }}>Published</span>;
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      <span style={{
        width: 40, height: 24, borderRadius: 999,
        background: checked ? '#14B8A6' : '#CBD5E1',
        position: 'relative', flexShrink: 0,
        transition: 'background-color 180ms ease',
      }}>
        <span style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3,
          width: 18, height: 18, borderRadius: '50%',
          background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          transition: 'left 180ms ease',
        }} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: '#0A2540' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#64748B', marginTop: 2 }}>{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
    </label>
  );
}

function PreviewModal({ member, onClose }: { member: FoundingMember; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 24, overflow: 'auto',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{
          background: 'rgba(255,255,255,0.94)', padding: '10px 16px', borderRadius: 12,
          marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0A2540',
        }}>
          <span>👁️ Preview — how visitors will see this</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#0A2540', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <FoundingMemberCard member={member} variant="full" />
      </div>
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}
