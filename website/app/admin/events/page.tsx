'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { cmsApi, type EventRow } from '@/lib/cms-api';

function EventsListInner() {
  const router = useRouter();
  const search = useSearchParams();
  const shouldCreate = search.get('new') === '1';
  const [items, setItems] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { const r = await cmsApi.listEvents(); setItems(r.items || []); }
    catch (e: any) { setToast(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!shouldCreate) return;
    let cancelled = false;
    (async () => {
      try {
        const created = await cmsApi.createEvent();
        if (!cancelled) router.replace(`/admin/events/${created.id}`);
      } catch (e: any) { setToast(e?.message || 'Create failed'); }
    })();
    return () => { cancelled = true; };
  }, [shouldCreate, router]);

  const createNew = async () => {
    setCreating(true);
    try { const c = await cmsApi.createEvent(); router.push(`/admin/events/${c.id}`); }
    catch (e: any) { setToast(e?.message || 'Failed'); setTimeout(() => setToast(null), 2500); }
    finally { setCreating(false); }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete “${title || 'this event'}” and all its RSVPs? This can’t be undone.`)) return;
    try {
      await cmsApi.deleteEvent(id);
      setItems(prev => prev.filter(i => i.id !== id));
      setToast('Deleted');
      setTimeout(() => setToast(null), 1800);
    } catch (e: any) { setToast(e?.message || 'Delete failed'); setTimeout(() => setToast(null), 2500); }
  };

  return (
    <AdminShell title="Events">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -12, marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <p style={{ color: '#475569', fontSize: 16, maxWidth: 640, margin: 0 }}>
          Coffee lounges, walking groups, workshops — the moments where friendship happens. Draft, preview, publish, and manage RSVPs from one place.
        </p>
        <button className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: creating ? 0.65 : 1 }} disabled={creating} onClick={createNew}>
          {creating ? 'Creating…' : '+ New event'}
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', padding: 64, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
          <p style={{ color: '#475569', fontSize: 16 }}>No events yet. Create your first above.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {items.map(ev => <EventRowCard key={ev.id} event={ev} onDelete={() => remove(ev.id, ev.title)} />)}
        </div>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

function EventRowCard({ event, onDelete }: { event: EventRow; onDelete: () => void }) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host';
  const cover = event.cover_image_url
    ? (event.cover_image_url.startsWith('http') ? event.cover_image_url : `${BASE}${event.cover_image_url}`)
    : null;

  const isDraft = event.status !== 'published';
  const isHidden = !!event.hidden;
  const going = event.rsvp_counts?.going ?? 0;
  const waitlist = event.rsvp_counts?.waitlist ?? 0;
  const capacityLabel = event.capacity ? `${going}/${event.capacity}` : `${going}`;

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: 18, border: '1px solid #E2E8F0',
      padding: 20, display: 'grid', gridTemplateColumns: '96px 1fr auto',
      gap: 20, alignItems: 'center',
    }}>
      <div style={{
        width: 96, height: 72, borderRadius: 12, overflow: 'hidden',
        background: cover ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFFFFF', fontSize: 28, flexShrink: 0,
      }}>
        {cover ? (
           
          <img src={cover} alt={event.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : '📅'}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/admin/events/${event.id}`} style={{
            fontSize: 17, fontWeight: 800, color: '#0A2540', textDecoration: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }}>{event.title || 'Untitled event'}</Link>
          <StatusPill draft={isDraft} hidden={isHidden} />
          {waitlist > 0 && <span style={{
            fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase',
            background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999,
          }}>+{waitlist} on waitlist</span>}
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
          {formatEventWhen(event.starts_at, event.timezone)}
          {event.venue_name && <>&nbsp;•&nbsp;{event.venue_name}</>}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>👥 {capacityLabel} RSVPs</span>
          <span>{event.cost_display || (event.cost_type === 'paid' ? 'Paid' : 'Free')}</span>
          {event.is_online && <span>💻 Online</span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Link href={`/admin/events/${event.id}`} className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 14px', textDecoration: 'none' }}>Edit</Link>
        <button className="cms-btn-danger" style={{ ...s.dangerBtn, padding: '8px 12px' }} onClick={onDelete} type="button">Delete</button>
      </div>
    </div>
  );
}

function StatusPill({ draft, hidden }: { draft: boolean; hidden: boolean }) {
  const base: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' };
  if (draft) return <span style={{ ...base, background: '#FEF3C7', color: '#92400E' }}>Draft</span>;
  if (hidden) return <span style={{ ...base, background: '#F1F5F9', color: '#475569' }}>Hidden</span>;
  return <span style={{ ...base, background: '#DCFCE7', color: '#166534' }}>Published</span>;
}

function formatEventWhen(iso: string | undefined, tz: string = 'Australia/Sydney'): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  try {
    return d.toLocaleString('en-AU', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: tz,
    });
  } catch { return d.toLocaleString('en-AU'); }
}

export default function EventsListPage() {
  return (
    <Suspense fallback={<AdminShell title="Events"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>}>
      <EventsListInner />
    </Suspense>
  );
}
