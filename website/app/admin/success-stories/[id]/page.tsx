'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { StoryCard } from '@/components/admin/StoryCard';
import { cmsApi, type SuccessStory } from '@/lib/cms-api';

export default function SuccessStoryEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [story, setStory] = useState<SuccessStory | null>(null);
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
        const s = await cmsApi.getStory(id);
        setStory(s);
      } catch (e: any) {
        if (e?.message?.includes('not found')) setNotFound(true);
        else setToast(e?.message || 'Failed to load story');
      } finally { setLoading(false); }
    })();
  }, [id]);

  const update = (patch: Partial<SuccessStory>) => {
    setStory(prev => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const save = async (extraPatch?: Partial<SuccessStory>): Promise<SuccessStory | null> => {
    if (!story) return null;
    setSaving(true);
    try {
      const patch = {
        title: story.title,
        body_html: story.body_html,
        author_name: story.author_name,
        author_role: story.author_role,
        author_location: story.author_location,
        author_avatar_url: story.author_avatar_url,
        status: story.status,
        hidden: story.hidden,
        ...(extraPatch || {}),
      };
      const updated = await cmsApi.updateStory(story.id, patch);
      setStory(updated);
      setDirty(false);
      flash('Story saved');
      return updated;
    } catch (e: any) {
      flash(`Save failed: ${e?.message || ''}`, 3200);
      return null;
    } finally { setSaving(false); }
  };

  const flash = (msg: string, ms = 2200) => { setToast(msg); setTimeout(() => setToast(null), ms); };

  const publish = async () => {
    if (!story) return;
    if (!story.title.trim() || !story.author_name.trim()) {
      flash('Add a title and an author before publishing', 3200);
      return;
    }
    await save({ status: 'published', hidden: false });
    flash('Published — visible on the website');
  };

  const unpublish = async () => {
    await save({ status: 'draft' });
    flash('Moved back to draft');
  };

  const toggleHidden = async () => {
    if (!story) return;
    await save({ hidden: !story.hidden });
  };

  if (loading) return <AdminShell title="Success story"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;
  if (notFound || !story) return (
    <AdminShell title="Story not found">
      <p style={{ color: '#475569' }}>That story doesn&apos;t exist. It may have been deleted.</p>
      <Link href="/admin/success-stories" className="cms-btn-primary" style={{ ...s.primaryBtn, textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>
        ← Back to all stories
      </Link>
    </AdminShell>
  );

  const isPublished = story.status === 'published';

  return (
    <AdminShell>
      {/* Custom header — replaces the default title so we can show
          status chips + action buttons on the same row */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Link href="/admin/success-stories" style={{ color: '#14B8A6', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>
            ← All stories
          </Link>
          <h1 style={{ fontSize: 28, color: '#0A2540', fontWeight: 900, margin: '6px 0 0' }}>
            {story.title || 'Untitled story'}
          </h1>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill status={story.status} hidden={!!story.hidden} />
            <span style={{ fontSize: 12, color: '#94A3B8', letterSpacing: '0.03em' }}>
              Created {formatDate(story.created_at)} · Last updated {formatDate(story.updated_at)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={() => setPreviewOpen(true)}>
            👁️ Preview
          </button>
          <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, opacity: saving ? 0.65 : 1 }} disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : dirty ? 'Save draft' : 'Saved ✓'}
          </button>
          {isPublished ? (
            <button type="button" className="cms-btn-ghost" style={s.ghostBtn} onClick={unpublish}>
              Move to draft
            </button>
          ) : (
            <button type="button" className="cms-btn-primary" style={s.primaryBtn} onClick={publish}>
              🚀 Publish
            </button>
          )}
        </div>
      </div>

      {/* Two-column body — form on the left, tools on the right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'flex-start' }}>
        {/* LEFT: main editor */}
        <div>
          <div style={s.card}>
            <label style={s.label}>Story title</label>
            <input
              className="cms-input"
              style={{ ...s.input, fontSize: 17, fontWeight: 700 }}
              value={story.title}
              onChange={e => update({ title: e.target.value })}
              placeholder="How Margaret found her people at the Coffee Lounge"
            />
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Story body</h2>
            <RichTextEditor
              value={story.body_html || ''}
              onChange={html => update({ body_html: html })}
              placeholder="Tell the story…"
              minHeight={320}
            />
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Author</h2>
            <label style={s.label}>Name</label>
            <input
              className="cms-input"
              style={s.input}
              value={story.author_name}
              onChange={e => update({ author_name: e.target.value })}
              placeholder="Margaret"
            />
            <div style={{ height: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>Role (optional)</label>
                <input
                  className="cms-input"
                  style={s.input}
                  value={story.author_role || ''}
                  onChange={e => update({ author_role: e.target.value })}
                  placeholder="Founding Member"
                />
              </div>
              <div>
                <label style={s.label}>Location (optional)</label>
                <input
                  className="cms-input"
                  style={s.input}
                  value={story.author_location || ''}
                  onChange={e => update({ author_location: e.target.value })}
                  placeholder="Newcastle, NSW"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: sidebar tools */}
        <div>
          {/* Avatar picker */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Profile image</h2>
            <AvatarWell url={story.author_avatar_url || ''} authorName={story.author_name} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="cms-btn-primary" style={{ ...s.primaryBtn, padding: '10px 16px', fontSize: 13, flex: 1 }} onClick={() => setPickerOpen(true)}>
                {story.author_avatar_url ? 'Change image' : 'Pick from library'}
              </button>
              {story.author_avatar_url && (
                <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '10px 12px', fontSize: 13 }} onClick={() => update({ author_avatar_url: '' })}>
                  Remove
                </button>
              )}
            </div>
            <div style={s.helper}>Choose from the Media Library. Square images work best.</div>
          </div>

          {/* Visibility */}
          <div style={s.card}>
            <h2 style={s.cardTitle}>Visibility</h2>
            <ToggleRow
              label="Draft / Published"
              hint={story.status === 'published' ? 'Live on the website' : 'Not yet published'}
              checked={story.status === 'published'}
              onChange={next => update({ status: next ? 'published' : 'draft' })}
            />
            <div style={{ height: 12 }} />
            <ToggleRow
              label="Hidden"
              hint={story.hidden ? 'Temporarily hidden even if published' : 'Visible when published'}
              checked={!!story.hidden}
              onChange={next => update({ hidden: next })}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="button" className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 12px', fontSize: 13, flex: 1 }} onClick={toggleHidden}>
                {story.hidden ? 'Unhide' : 'Hide'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(url) => { update({ author_avatar_url: url }); setPickerOpen(false); }}
      />
      {previewOpen && (
        <PreviewModal story={story} onClose={() => setPreviewOpen(false)} />
      )}
      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

/* ---------- Sub-components ---------- */

function AvatarWell({ url, authorName }: { url: string; authorName: string }) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';
  const absUrl = url ? (url.startsWith('http') ? url : `${BASE}${url}`) : '';
  return (
    <div style={{
      width: 96, height: 96, borderRadius: '50%',
      background: absUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #0EA5A0)',
      color: '#FFFFFF', fontSize: 36, fontWeight: 900,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', margin: '0 auto',
    }}>
      {absUrl ? (
         
        <img src={absUrl} alt={authorName || 'Author'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : ((authorName || '?').slice(0, 1).toUpperCase() || '?')}
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
          position: 'absolute',
          top: 3, left: checked ? 19 : 3,
          width: 18, height: 18, borderRadius: '50%',
          background: '#FFFFFF',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
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

function PreviewModal({ story, onClose }: { story: SuccessStory; onClose: () => void }) {
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
        <StoryCard story={story} variant="full" />
      </div>
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
