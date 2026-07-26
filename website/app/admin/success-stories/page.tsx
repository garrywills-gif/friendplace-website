'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { cmsApi, type SuccessStory } from '@/lib/cms-api';

function SuccessStoriesListInner() {
  const router = useRouter();
  const search = useSearchParams();
  const shouldCreateOnLoad = search.get('new') === '1';
  const [items, setItems] = useState<SuccessStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { const r = await cmsApi.listStories(); setItems(r.items || []); }
    catch (e: any) { setToast(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Deep-link support from the "Add Success Story" Quick Action.
  // ?new=1 creates a blank draft and routes straight to its editor.
  useEffect(() => {
    if (!shouldCreateOnLoad) return;
    let cancelled = false;
    (async () => {
      try {
        const created = await cmsApi.createStory();
        if (!cancelled) router.replace(`/admin/success-stories/${created.id}`);
      } catch (e: any) {
        setToast(e?.message || 'Failed to create draft');
      }
    })();
    return () => { cancelled = true; };
  }, [shouldCreateOnLoad, router]);

  const createNew = async () => {
    setCreating(true);
    try {
      const created = await cmsApi.createStory();
      router.push(`/admin/success-stories/${created.id}`);
    } catch (e: any) {
      setToast(e?.message || 'Failed to create');
      setTimeout(() => setToast(null), 2500);
    } finally { setCreating(false); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const reordered = [...items];
    const [row] = reordered.splice(idx, 1);
    reordered.splice(j, 0, row);
    setItems(reordered); // optimistic
    try { await cmsApi.reorderStories(reordered.map(i => i.id)); }
    catch { load(); /* restore server truth on failure */ }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete “${title || 'Untitled story'}”? This can’t be undone.`)) return;
    try {
      await cmsApi.deleteStory(id);
      setItems(prev => prev.filter(i => i.id !== id));
      setToast('Story deleted');
      setTimeout(() => setToast(null), 1800);
    } catch (e: any) {
      setToast(e?.message || 'Delete failed');
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <AdminShell title="Success Stories">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -12, marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 620, margin: 0 }}>
          Real stories from real people help visitors picture themselves at FriendPlace. Write, save as a draft, preview, and publish when it&apos;s ready.
        </p>
        <button className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: creating ? 0.65 : 1 }} disabled={creating} onClick={createNew}>
          {creating ? 'Creating…' : '+ New story'}
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', padding: 64, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📖</div>
          <p style={{ color: '#475569', fontSize: 16 }}>No stories yet. Write your first above.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {items.map((story, idx) => (
            <StoryListRow
              key={story.id}
              story={story}
              isFirst={idx === 0}
              isLast={idx === items.length - 1}
              onMoveUp={() => move(idx, -1)}
              onMoveDown={() => move(idx, +1)}
              onDelete={() => remove(story.id, story.title)}
            />
          ))}
        </div>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

export default function SuccessStoriesListPage() {
  return (
    <Suspense fallback={<AdminShell title="Success Stories"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>}>
      <SuccessStoriesListInner />
    </Suspense>
  );
}

function StoryListRow({
  story, isFirst, isLast, onMoveUp, onMoveDown, onDelete,
}: {
  story: SuccessStory;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';
  const avatarUrl = story.author_avatar_url
    ? (story.author_avatar_url.startsWith('http') ? story.author_avatar_url : `${BASE}${story.author_avatar_url}`)
    : null;

  const isDraft = story.status !== 'published';
  const isHidden = !!story.hidden;

  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: 18,
      border: '1px solid #E2E8F0',
      padding: 20,
      display: 'grid',
      gridTemplateColumns: '56px 1fr auto',
      gap: 16,
      alignItems: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: avatarUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #0EA5A0)',
        color: '#FFFFFF', fontSize: 22, fontWeight: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
      }}>
        {avatarUrl ? (
           
          <img src={avatarUrl} alt={story.author_name || 'Author'}
               style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : ((story.author_name || '?').slice(0, 1).toUpperCase())}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link
            href={`/admin/success-stories/${story.id}`}
            style={{
              fontSize: 17, fontWeight: 800, color: '#0A2540', textDecoration: 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
            }}
          >
            {story.title || 'Untitled story'}
          </Link>
          <StatusPill draft={isDraft} hidden={isHidden} />
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
          {(story.author_name || 'No author').trim()}
          {story.author_role && <>&nbsp;•&nbsp;{story.author_role}</>}
          {story.author_location && <>&nbsp;•&nbsp;{story.author_location}</>}
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, letterSpacing: '0.03em' }}>
          Updated {relTime(story.updated_at)} · Created {relTime(story.created_at)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 12px' }} onClick={onMoveUp} disabled={isFirst} type="button">↑</button>
        <button className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 12px' }} onClick={onMoveDown} disabled={isLast} type="button">↓</button>
        <Link href={`/admin/success-stories/${story.id}`} className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 14px', textDecoration: 'none' }}>Edit</Link>
        <button className="cms-btn-danger" style={{ ...s.dangerBtn, padding: '8px 12px' }} onClick={onDelete} type="button">Delete</button>
      </div>
    </div>
  );
}

function StatusPill({ draft, hidden }: { draft: boolean; hidden: boolean }) {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  };
  if (draft) return <span style={{ ...base, background: '#FEF3C7', color: '#92400E' }}>Draft</span>;
  if (hidden) return <span style={{ ...base, background: '#F1F5F9', color: '#475569' }}>Hidden</span>;
  return <span style={{ ...base, background: '#DCFCE7', color: '#166534' }}>Published</span>;
}

function relTime(iso?: string): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.round(diff / 1000);
  if (s < 30) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
