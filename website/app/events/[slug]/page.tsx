import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { EventRow } from '@/lib/cms-api';
import RsvpForm from './RsvpForm';

// Detail pages are ISR'd so admins can publish + see changes live
// within a minute without hammering the API. RSVP submissions bypass
// this cache and hit the backend directly.
export const revalidate = 60;

const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host';

async function fetchEvent(slug: string): Promise<EventRow | null> {
  try {
    const res = await fetch(`${BASE}/api/public/events/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as EventRow;
  } catch { return null; }
}

// Australia-flavoured date formatter. Server-side so shared with SEO
// crawlers. Uses the event's own timezone for accuracy.
function formatEventWhen(iso: string | undefined, tz: string = 'Australia/Sydney'): string {
  if (!iso) return 'Date TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date TBD';
  try {
    return d.toLocaleString('en-AU', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
    });
  } catch { return d.toLocaleString('en-AU'); }
}

function formatDayRange(startIso?: string, endIso?: string, tz: string = 'Australia/Sydney'): string {
  if (!startIso) return 'Date TBD';
  try {
    const s = new Date(startIso);
    const e = endIso ? new Date(endIso) : null;
    const day = s.toLocaleString('en-AU', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: tz,
    });
    const startTime = s.toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    if (!e || Number.isNaN(e.getTime())) return `${day} · ${startTime}`;
    const endTime = e.toLocaleString('en-AU', {
      hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
    });
    return `${day} · ${startTime}–${endTime}`;
  } catch { return formatEventWhen(startIso, tz); }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await fetchEvent(slug);
  if (!ev) return { title: 'Event — FriendPlace' };
  return {
    title: `${ev.title} — FriendPlace Events`,
    description: ev.description || 'Come along to a FriendPlace event.',
  };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await fetchEvent(slug);
  if (!ev) notFound();

  const cover = ev.cover_image_url
    ? (ev.cover_image_url.startsWith('http') ? ev.cover_image_url : `${BASE}${ev.cover_image_url}`)
    : null;

  const isCancelled = ev.status === 'cancelled';
  const going = ev.rsvp_counts?.going ?? 0;
  const waitlist = ev.rsvp_counts?.waitlist ?? 0;
  const remaining = ev.capacity ? Math.max(0, ev.capacity - going) : null;
  const isFull = ev.capacity != null && remaining === 0;

  // Public API path for the ICS "Add to Calendar" button.
  const icsHref = `${BASE || ''}/api/public/events/${encodeURIComponent(ev.slug)}.ics`;

  const dayRange = formatDayRange(ev.starts_at, ev.ends_at, ev.timezone);
  const whereLine = ev.is_online
    ? '💻 Online event'
    : [ev.venue_name, ev.venue_address].filter(Boolean).join(' · ') || 'Venue TBD';

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 96px', fontFamily: 'Public Sans, system-ui, sans-serif' }}>
      {/* Breadcrumb / back-link */}
      <div style={{ marginBottom: 24, fontSize: 14 }}>
        <Link href="/events" style={{ color: '#0F766E', textDecoration: 'none', fontWeight: 700 }}>
          ← All events
        </Link>
      </div>

      {/* Cancelled banner — sits ABOVE the cover so it's the first thing
          a visitor sees. Uses a muted red so it feels serious but not
          alarming, and always shows the reason if we have one. */}
      {isCancelled && (
        <div style={{ marginBottom: 24, padding: 20, borderRadius: 16, background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#991B1B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>
            This event has been cancelled
          </div>
          <div style={{ fontSize: 14, color: '#7F1D1D', lineHeight: 1.6 }}>
            {ev.cancellation_reason
              ? ev.cancellation_reason
              : "Sorry to be the bearer of not-great news — this event won't be going ahead. Everyone who RSVP'd has been emailed."}
          </div>
        </div>
      )}

      {/* Cover */}
      <div style={{
        aspectRatio: '21 / 9', borderRadius: 24, overflow: 'hidden',
        background: cover ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFFFFF', fontSize: 72, marginBottom: 32,
        boxShadow: '0 12px 40px rgba(10, 37, 64, 0.08)',
      }}>
        {cover ? <img src={cover} alt={ev.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📅'}
      </div>

      {/* Two-column layout: content left, sticky RSVP card right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 48, alignItems: 'start' }}>
        {/* LEFT: title, description, body_html, sponsors, accessibility */}
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 800, color: '#14B8A6', marginBottom: 12 }}>
            {ev.is_online ? 'Online event' : 'In person'}
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 900, color: '#0A2540', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {ev.title}
          </h1>
          {ev.description && (
            <p style={{ fontSize: 18, color: '#475569', lineHeight: 1.7, marginTop: 16 }}>
              {ev.description}
            </p>
          )}

          {/* Body HTML from TipTap */}
          {ev.body_html && (
            <div
              style={{ marginTop: 32, fontSize: 16, color: '#334155', lineHeight: 1.8 }}
              dangerouslySetInnerHTML={{ __html: ev.body_html }}
            />
          )}

          {/* Accessibility & host block */}
          {(ev.organiser_name || ev.accessibility_info) && (
            <div style={{ marginTop: 32, padding: 20, borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              {ev.organiser_name && (
                <div style={{ marginBottom: ev.accessibility_info ? 12 : 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>Hosted by</div>
                  <div style={{ color: '#0A2540', fontWeight: 700 }}>{ev.organiser_name}</div>
                </div>
              )}
              {ev.accessibility_info && (
                <div>
                  <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>Accessibility</div>
                  <div style={{ color: '#334155', fontSize: 14, lineHeight: 1.6 }}>{ev.accessibility_info}</div>
                </div>
              )}
            </div>
          )}

          {/* Sponsors */}
          {ev.sponsors && ev.sponsors.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 12 }}>Sponsors</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                {ev.sponsors.map((s, i) => (
                  <a key={i} href={s.website_url || '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0A2540', textDecoration: 'none', fontWeight: 700 }}>
                    {s.logo_url && <img src={s.logo_url.startsWith('http') ? s.logo_url : `${BASE}${s.logo_url}`} alt={s.name} style={{ width: 24, height: 24, objectFit: 'contain' }} />}
                    <span>{s.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: sticky details card + RSVP form */}
        <aside style={{ position: 'sticky', top: 24 }}>
          <div style={{ padding: 24, borderRadius: 20, background: '#FFFFFF', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(10,37,64,0.06)' }}>
            {/* Capacity chip */}
            {ev.capacity && (
              <div style={{ marginBottom: 16, textAlign: 'center' }}>
                <span style={{
                  display: 'inline-block', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800,
                  background: isFull ? '#FEF3C7' : '#DCFCE7',
                  color: isFull ? '#92400E' : '#166534',
                }}>
                  {isFull ? `Fully booked · waitlist open` : `${remaining} spot${remaining === 1 ? '' : 's'} left`}
                </span>
              </div>
            )}

            {/* When / Where / Cost */}
            <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>When</div>
                <div style={{ color: '#0A2540', fontWeight: 600 }}>{dayRange}</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>Where</div>
                <div style={{ color: '#0A2540', fontWeight: 600 }}>{whereLine}</div>
                {ev.venue_url && !ev.is_online && (
                  <a href={ev.venue_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 4, color: '#0F766E', fontSize: 13, textDecoration: 'none', fontWeight: 700 }}>
                    Open in maps ↗
                  </a>
                )}
              </div>
              {ev.cost_display && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>Cost</div>
                  <div style={{ color: '#0A2540', fontWeight: 600 }}>{ev.cost_display}</div>
                </div>
              )}
            </div>

            <div style={{ height: 1, background: '#E2E8F0', margin: '20px 0' }} />

            {/* Add-to-Calendar */}
            <a
              href={icsHref}
              style={{ display: 'block', textAlign: 'center', padding: '10px 16px', borderRadius: 12, background: '#F0FDFA', color: '#0F766E', textDecoration: 'none', fontWeight: 800, fontSize: 14, border: '1px solid #99F6E4', marginBottom: 20 }}
            >
              📅 Add to calendar
            </a>

            {/* RSVP form (client component) — hidden when the event is
                cancelled. We keep the Add-to-Calendar link above so
                users can still pull the CANCEL update into their
                calendar if they missed the email. */}
            {isCancelled ? (
              <div style={{ padding: 16, borderRadius: 12, background: '#F1F5F9', color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
                RSVPs are closed for this event.<br />
                Watch our <Link href="/events" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>events page</Link> for what&rsquo;s next.
              </div>
            ) : (
              <>
                <RsvpForm slug={ev.slug} isFull={isFull} />
                <div style={{ marginTop: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
                  {going} going{waitlist > 0 ? ` · ${waitlist} on waitlist` : ''}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
