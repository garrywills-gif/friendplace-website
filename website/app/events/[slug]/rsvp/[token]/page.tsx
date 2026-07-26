import Link from 'next/link';
import { notFound } from 'next/navigation';
import CancelRsvpButton from './CancelRsvpButton';

// Never cache RSVP lookup — the status can change from any browser
// (e.g. user cancels on their phone, opens on laptop).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';

type Lookup = {
  event: {
    id: string; slug: string; title: string;
    starts_at?: string; ends_at?: string; timezone?: string;
    venue_name?: string; venue_address?: string;
    is_online?: boolean; meeting_url?: string;
    cover_image_url?: string; cost_display?: string;
  };
  rsvp: {
    id: string; name: string; email: string;
    guests_count: number; note?: string;
    status: 'going' | 'waitlist' | 'cancelled';
    display_ref: string;
  };
};

async function fetchLookup(slug: string, token: string): Promise<Lookup | null> {
  try {
    const res = await fetch(
      `${BASE}/api/public/events/${encodeURIComponent(slug)}/rsvp/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as Lookup;
  } catch { return null; }
}

function formatWhen(iso?: string, tz: string = 'Australia/Sydney'): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  return d.toLocaleString('en-AU', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
  });
}

export default async function ManageRsvpPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const data = await fetchLookup(slug, token);
  if (!data) notFound();
  const { event: ev, rsvp } = data;

  const isCancelled = rsvp.status === 'cancelled';
  const isGoing = rsvp.status === 'going';
  const isWaitlist = rsvp.status === 'waitlist';

  const where = ev.is_online
    ? ev.meeting_url || 'Online'
    : [ev.venue_name, ev.venue_address].filter(Boolean).join(' · ') || 'Venue TBD';

  const statusChip = isGoing
    ? { label: "You're going", bg: '#DCFCE7', color: '#166534' }
    : isWaitlist
    ? { label: "You're on the waitlist", bg: '#FEF3C7', color: '#92400E' }
    : { label: 'RSVP cancelled', bg: '#F1F5F9', color: '#475569' };

  const icsHref = `${BASE || ''}/api/public/events/${encodeURIComponent(ev.slug)}.ics`;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px 96px', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
      <div style={{ marginBottom: 16, fontSize: 14 }}>
        <Link href={`/events/${ev.slug}`} style={{ color: '#0F766E', textDecoration: 'none', fontWeight: 700 }}>
          ← Back to event
        </Link>
      </div>

      <div style={{ padding: 32, borderRadius: 24, background: '#FFFFFF', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(10,37,64,0.05)' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800, color: '#14B8A6', marginBottom: 12 }}>
          Your RSVP
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0A2540', margin: 0, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          {ev.title}
        </h1>

        <div style={{ display: 'inline-block', marginTop: 16, padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, background: statusChip.bg, color: statusChip.color }}>
          {statusChip.label}
        </div>

        <div style={{ marginTop: 24, padding: 20, borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
          <div>
            <span style={{ fontWeight: 800, color: '#0A2540' }}>When:</span> {formatWhen(ev.starts_at, ev.timezone)}
          </div>
          <div>
            <span style={{ fontWeight: 800, color: '#0A2540' }}>Where:</span> {where}
          </div>
          {ev.cost_display && (
            <div>
              <span style={{ fontWeight: 800, color: '#0A2540' }}>Cost:</span> {ev.cost_display}
            </div>
          )}
          <div>
            <span style={{ fontWeight: 800, color: '#0A2540' }}>Booked as:</span> {rsvp.name} ({rsvp.email})
          </div>
          {rsvp.guests_count > 0 && (
            <div>
              <span style={{ fontWeight: 800, color: '#0A2540' }}>Guests:</span> +{rsvp.guests_count}
            </div>
          )}
          {rsvp.note && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontWeight: 800, color: '#0A2540' }}>Your note:</span> <em style={{ color: '#475569' }}>{rsvp.note}</em>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748B' }}>
            Reference: <strong style={{ color: '#0A2540', letterSpacing: '0.4px' }}>{rsvp.display_ref}</strong>
          </div>
        </div>

        {!isCancelled && (
          <a
            href={icsHref}
            style={{ display: 'block', textAlign: 'center', marginTop: 20, padding: '10px 16px', borderRadius: 12, background: '#F0FDFA', color: '#0F766E', textDecoration: 'none', fontWeight: 800, fontSize: 14, border: '1px solid #99F6E4' }}
          >
            📅 Add to calendar (.ics)
          </a>
        )}

        {isCancelled ? (
          <div style={{ marginTop: 24, padding: 16, borderRadius: 12, background: '#F1F5F9', color: '#475569', fontSize: 14, textAlign: 'center' }}>
            This RSVP is no longer active. If you&rsquo;d like to come after all, please RSVP again from the
            <Link href={`/events/${ev.slug}`} style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}> event page</Link>.
          </div>
        ) : (
          <CancelRsvpButton slug={ev.slug} token={token} />
        )}
      </div>
    </main>
  );
}
