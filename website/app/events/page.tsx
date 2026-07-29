import Link from 'next/link';
import type { EventRow } from '@/lib/cms-api';

export const revalidate = 60;

async function fetchEvents(): Promise<EventRow[]> {
  const base = process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host';
  try {
    const res = await fetch(`${base}/api/public/events`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.events || []) as EventRow[];
  } catch { return []; }
}

export const metadata = {
  title: 'Events — FriendPlace',
  description: 'Walks, coffee catch-ups, workshops and more. Come along.',
};

export default async function EventsPage() {
  const events = await fetchEvents();
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host';

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px 96px', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ display: 'inline-block', fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800, color: '#14B8A6', marginBottom: 12 }}>Events</div>
        <h1 style={{ fontSize: 40, fontWeight: 900, color: '#0A2540', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Come along</h1>
        <p style={{ fontSize: 17, color: '#475569', maxWidth: 640, margin: '16px auto 0', lineHeight: 1.7 }}>
          Walks by the beach. Morning coffees. Craft afternoons. Real moments where FriendPlace friendships happen.
        </p>
        {/* Organisation entry-point. Kept as a small, quiet chip so it
            never competes with the primary event grid, but is visible
            enough that a council staffer, RSL, community group or
            library scanning this page can find it in one glance. */}
        <div style={{ marginTop: 20 }}>
          <Link
            href="/list-your-event"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 999,
              background: 'rgba(20,184,166,0.08)',
              border: '1px solid rgba(20,184,166,0.25)',
              color: '#0F766E', fontWeight: 700, fontSize: 14,
              textDecoration: 'none',
            }}
          >
            <span aria-hidden>🏛️</span>
            <span>For organisations: List an event →</span>
          </Link>
        </div>
      </div>

      {events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, borderRadius: 20, border: '2px dashed #E2E8F0', background: '#F8FAFC' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <p style={{ color: '#475569', fontSize: 16, margin: 0 }}>The next events are being planned. Come back soon.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          {events.map(ev => {
            const cover = ev.cover_image_url ? (ev.cover_image_url.startsWith('http') ? ev.cover_image_url : `${BASE}${ev.cover_image_url}`) : null;
            const going = ev.rsvp_counts?.going ?? 0;
            const remaining = ev.capacity ? Math.max(0, ev.capacity - going) : null;
            return (
              <Link key={ev.id} href={`/events/${ev.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <article style={{ background: '#FFFFFF', borderRadius: 20, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 4px 16px rgba(10,37,64,0.05)', display: 'flex', flexDirection: 'column', height: '100%', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}>
                <div style={{ aspectRatio: '16 / 9', background: cover ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 40 }}>
                  {cover ? (
                     
                    <img src={cover} alt={ev.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : '📅'}
                </div>
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#14B8A6', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {formatEventWhen(ev.starts_at, ev.timezone)}
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 900, color: '#0A2540', margin: '10px 0 8px', letterSpacing: '-0.01em' }}>{ev.title}</h2>
                  {ev.description && <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: 0, marginBottom: 12 }}>{ev.description}</p>}
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#64748B' }}>
                    <span>{ev.is_online ? '💻 Online' : (ev.venue_name || '📍 Venue TBD')} · {ev.cost_display}</span>
                    {ev.capacity && (
                      <span style={{ padding: '3px 10px', borderRadius: 999, background: remaining && remaining > 0 ? '#DCFCE7' : '#FEF3C7', color: remaining && remaining > 0 ? '#166534' : '#92400E', fontWeight: 800 }}>
                        {remaining && remaining > 0 ? `${remaining} spots left` : 'Waitlist open'}
                      </span>
                    )}
                  </div>
                </div>
                </article>
              </Link>
            );
          })}
        </div>
      )}

      {/* End-of-page organisation CTA. Larger and more explanatory
          than the top chip, aimed at the reader who scrolled through
          the whole list and is now ready to convert. */}
      <div
        style={{
          marginTop: 64, padding: '36px 32px',
          borderRadius: 24, background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 16px rgba(10,37,64,0.05)',
          display: 'flex', flexWrap: 'wrap', gap: 20,
          alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ maxWidth: 620 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800, color: '#14B8A6', marginBottom: 8 }}>
            For organisations
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0A2540', margin: 0, marginBottom: 6, letterSpacing: '-0.01em' }}>
            Run a community group, RSL, library or council program?
          </h2>
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: 0 }}>
            Add your event to FriendPlace. Our team reviews each submission before it goes live, so members always see events that match FriendPlace’s friendship-first values.
          </p>
        </div>
        <Link
          href="/list-your-event"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '14px 24px', borderRadius: 12,
            background: 'linear-gradient(135deg,#14B8A6,#0F766E)',
            color: '#FFFFFF', fontWeight: 800, fontSize: 15,
            textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(20,184,166,0.25)',
          }}
        >
          List an event →
        </Link>
      </div>
    </main>
  );
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
