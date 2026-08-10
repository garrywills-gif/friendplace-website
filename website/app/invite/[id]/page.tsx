/**
 * /invite/[id] — FriendPlace personal invite landing page (marketing).
 *
 * Batch B iter156 (Garry, Aug 2026 — pre-V1 audit): when a member shares
 * an invite from the mobile app, the URL is now
 *   https://friendplace.com.au/invite/<userId>
 * The mobile share URL previously pointed at the Expo preview host,
 * which was fine for TestFlight but embarrassing for a launch. Adding a
 * proper Next.js landing here means invitees see a warm branded page
 * before they ever get to a signup form — same conversion pattern that
 * the mobile app already uses at /app/invite/[id].tsx, ported to the
 * marketing surface.
 *
 * Data:
 *   - Inviter profile hydrated via `GET /api/users/{id}`
 *   - Live Founder counter via `GET /api/founders/status`
 * Both endpoints are already public. Falls back gracefully with a
 * generic welcome if the inviter id is unknown or the API is offline.
 *
 * CTAs:
 *   - "Open in App Store" / "Open in Google Play" (from public launch
 *     status — same source as the home page ribbon)
 *   - "Sign up on the web" → routes to /register-interest with the ref
 *     appended so credit still flows through
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { API_BASE } from '@/lib/api-base';
import { site } from '@/lib/brand';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';
import type { LaunchStatus } from '@/components/site/LaunchCountdownRibbon';

type Inviter = {
  id: string;
  first_name?: string;
  username?: string;
  avatar?: string;
  is_founder?: boolean;
  founder_number?: number | null;
  suburb?: string;
};

type FounderStatus = {
  cap: number;
  taken: number;
  remaining: number;
  open: boolean;
};

async function fetchInviter(id: string): Promise<Inviter | null> {
  try {
    // Uses the public /users/{id}/public-profile endpoint — safe to call
    // anonymously, returns only fields that already show on the Founders
    // Wall + public profile. 404 for demo/test users so we never leak
    // seed identities via a warm invite page.
    const r = await fetch(`${API_BASE}/api/users/${encodeURIComponent(id)}/public-profile`, {
      // Personal invite — always fetch fresh so the inviter's suburb /
      // Founder badge changes propagate immediately without an SSG rebuild.
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const u = (await r.json()) as Inviter;
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

async function fetchFounders(): Promise<FounderStatus | null> {
  try {
    const r = await fetch(`${API_BASE}/api/founders/status`, {
      // Short cache — the counter changes at signup pace, so 30s of
      // stale data on a landing page is fine and cheap.
      next: { revalidate: 30 },
    });
    if (!r.ok) return null;
    return (await r.json()) as FounderStatus;
  } catch {
    return null;
  }
}

async function fetchLaunch(): Promise<LaunchStatus | null> {
  try {
    const r = await fetch(`${API_BASE}/api/public/launch-status`, {
      next: { revalidate: 60 },
    });
    if (!r.ok) return null;
    return (await r.json()) as LaunchStatus;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const inviter = await fetchInviter(id);
  const name = inviter?.first_name?.trim() || inviter?.username || 'A friend';
  const title = inviter
    ? `${name} invited you to join FriendPlace`
    : 'You’re invited to join FriendPlace';
  const description = inviter
    ? `${name} thought you’d love FriendPlace — a warm community for making real friendships in your local area.`
    : site.description;
  return {
    title,
    description,
    // The invite page is a private landing — search engines have no
    // reason to index a specific inviter id. Global `robots.ts` already
    // handles the pre-launch noindex; this is defence in depth.
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      title,
      description,
      url: `${site.urlProduction}/invite/${encodeURIComponent(id)}`,
      siteName: site.name,
    },
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [inviter, founders, launch] = await Promise.all([
    fetchInviter(id),
    fetchFounders(),
    fetchLaunch(),
  ]);

  const displayName =
    inviter?.first_name?.trim() || inviter?.username || 'A friend';
  const headline = inviter
    ? `${displayName} invited you to join FriendPlace`
    : 'Welcome to FriendPlace';
  const tagline = inviter
    ? inviter.is_founder
      ? `${displayName} is one of the first Founding Members shaping FriendPlace — and they thought you’d love it too.`
      : `${displayName} thought you’d love FriendPlace — a warm, friendly place to meet new people and stay connected.`
    : 'A warm, friendly place for friendship, connection and community.';

  const appstoreUrl = launch?.appstore_url || '';
  const playstoreUrl = launch?.playstore_url || '';
  const hasAnyStoreLink = Boolean(appstoreUrl || playstoreUrl);

  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg, #0E1B3D 0%, #14284F 55%, #0E1B3D 100%)',
        color: '#FFFFFF',
        padding: '48px 20px 64px',
      }}
    >
      <div style={{ maxWidth: 540, margin: '0 auto', textAlign: 'center' }}>
        {/* Brand wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 }}>
          <GeorgeButterflyMark size={36} />
          <span style={{ fontWeight: 900, fontSize: 24, letterSpacing: 0.4 }}>{site.name}</span>
        </div>

        {/* Inviter card */}
        {inviter ? (
          <section
            aria-labelledby="inviter-heading"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 20,
              padding: 20,
              marginBottom: 22,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                border: '2px solid #FBBF24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 48,
              }}
              aria-label={`${displayName}'s avatar`}
            >
              {inviter.avatar || '🙂'}
            </div>
            <div
              id="inviter-heading"
              role="heading"
              aria-level={2}
              style={{
                fontSize: 20,
                fontWeight: 800,
                margin: 0,
                color: '#FFFFFF',
              }}
            >
              <span style={{ color: '#FFFFFF' }}>{displayName}</span>
              {inviter.founder_number ? (
                <span
                  style={{
                    display: 'inline-block',
                    marginLeft: 8,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: 'rgba(251,191,36,0.16)',
                    border: '1px solid #FBBF24',
                    color: '#FBBF24',
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: 0.4,
                    verticalAlign: 'middle',
                  }}
                >
                  🦋 Founding Member #{inviter.founder_number}
                </span>
              ) : null}
            </div>
            {inviter.suburb ? (
              <p style={{ color: 'rgba(255,255,255,0.75)', margin: 0, fontSize: 14, fontWeight: 600 }}>
                📍 {inviter.suburb}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Headline + tagline */}
        <h1
          style={{
            fontSize: 32,
            lineHeight: 1.2,
            fontWeight: 900,
            margin: '4px 0 12px',
            letterSpacing: -0.4,
            color: '#FFFFFF',
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.88)',
            margin: '0 0 26px',
          }}
        >
          {tagline}
        </p>

        {/* Founder counter */}
        {founders && founders.open && founders.cap > 0 ? (
          <section
            aria-label="Founding Members"
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1.5px solid #FBBF24',
              borderRadius: 16,
              padding: '18px 20px',
              marginBottom: 26,
              textAlign: 'center',
            }}
          >
            <p
              style={{
                color: '#FBBF24',
                margin: 0,
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: 1.6,
                textTransform: 'uppercase',
              }}
            >
              🦋 Founding Members
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 16, fontWeight: 700, lineHeight: 1.5 }}>
              {founders.taken > 0 ? (
                <>
                  <strong style={{ color: '#FBBF24', fontWeight: 900 }}>
                    {founders.remaining.toLocaleString()}
                  </strong>{' '}
                  Founding Member places remaining.
                </>
              ) : (
                <>
                  You’d join as one of the first{' '}
                  <strong style={{ color: '#FBBF24', fontWeight: 900 }}>
                    {founders.cap.toLocaleString()}
                  </strong>{' '}
                  Founding Members.
                </>
              )}
            </p>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 12,
                fontWeight: 800,
                color: '#FBBF24',
                letterSpacing: 0.4,
              }}
            >
              Join free as a Founding Member.
            </p>
          </section>
        ) : null}

        {/* CTAs — mobile-first: prefer the app store badges when we have
            them, and always offer a web signup fallback. */}
        {hasAnyStoreLink ? (
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            {appstoreUrl ? (
              <a
                href={appstoreUrl}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '14px 22px',
                  background: '#FFFFFF',
                  color: '#1E3A7F',
                  borderRadius: 999,
                  fontWeight: 900,
                  fontSize: 15,
                  textDecoration: 'none',
                  minWidth: 200,
                  justifyContent: 'center',
                }}
              >
                <span aria-hidden="true"></span> Open in App Store
              </a>
            ) : null}
            {playstoreUrl ? (
              <a
                href={playstoreUrl}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '14px 22px',
                  background: '#FFFFFF',
                  color: '#1E3A7F',
                  borderRadius: 999,
                  fontWeight: 900,
                  fontSize: 15,
                  textDecoration: 'none',
                  minWidth: 200,
                  justifyContent: 'center',
                }}
              >
                <span aria-hidden="true">▶</span> Open in Google Play
              </a>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/register-interest?ref=${encodeURIComponent(id)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 24px',
              border: '1.5px solid rgba(255,255,255,0.55)',
              color: '#FFFFFF',
              borderRadius: 999,
              fontWeight: 800,
              fontSize: 15,
              textDecoration: 'none',
            }}
          >
            {inviter
              ? `Continue with ${displayName}’s invite →`
              : 'Register your interest →'}
          </Link>
        </div>

        <p
          style={{
            color: 'rgba(255,255,255,0.62)',
            fontSize: 12,
            lineHeight: 1.5,
            marginTop: 20,
          }}
        >
          By continuing you agree to FriendPlace’s Community Guidelines.
          {inviter ? (
            <>
              {' '}
              Your invite credit will be linked to {displayName} after you
              create your profile.
            </>
          ) : null}
        </p>

        {/* Reassuring wordmark footer */}
        <div style={{ marginTop: 40, opacity: 0.7 }}>
          <span style={{ fontWeight: 900, letterSpacing: 0.4 }}>{site.name}</span>
          <p style={{ fontSize: 12, marginTop: 8 }}>{site.tagline}</p>
        </div>
      </div>
    </main>
  );
}
