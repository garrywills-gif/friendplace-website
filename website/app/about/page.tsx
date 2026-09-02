import type { Metadata } from 'next';
import { cms } from '@/lib/api';
import { brandAssets } from '@/lib/brand-assets';
import { site } from '@/lib/brand';
import { TourNext } from '@/components/TourNav';
import TapMeButterfly from '@/components/TapMeButterfly';

export const metadata: Metadata = {
  title: 'About FriendPlace | Friendship & Community in Australia',
  description: 'Learn why FriendPlace is building a safer, welcoming Australian community where adults can meet local people and build genuine friendships.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About FriendPlace | Friendship & Community in Australia',
    description: 'A welcoming Australian community built around genuine friendship, local connection and belonging.',
    url: '/about',
    type: 'website',
  },
};

export default async function AboutPage() {
  const data = await cms.about();
  const heading = data?.heading || 'Everyone deserves a place to belong.';
  // Body copy is stored as an array of paragraphs so future CMS edits
  // can add/reorder paragraphs without breaking the layout.
  const paragraphs: string[] = (data as any)?.paragraphs || DEFAULT_PARAGRAPHS;
  const mission = data?.mission || 'To make everyday belonging effortless — one gentle hello at a time.';

  return (
    <>
      <PageHero eyebrow="About us" title={heading} />
      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 780 }}>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              style={{
                fontSize: 19, lineHeight: 1.7, color: '#334155',
                marginBottom: i === paragraphs.length - 1 ? 40 : 24,
              }}
            >
              {p}
            </p>
          ))}

          {/* Tagline flourish — same treatment used on the Home closing
              CTA so the brand voice stays consistent. */}
          <div style={{
            textAlign: 'center',
            padding: '32px 24px',
            background: 'linear-gradient(135deg, rgba(20,184,166,0.08), rgba(56,189,248,0.06))',
            borderRadius: 20,
            border: '1px solid rgba(20,184,166,0.18)',
            marginBottom: 48,
          }}>
            <p style={{
              fontSize: 26,
              fontWeight: 800,
              color: '#0A2540',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}>
              {site.tagline}
            </p>
          </div>

          <div style={{
            background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 24,
            padding: 40, textAlign: 'center', marginTop: 48,
          }}>
            <img
              src={brandAssets.butterfly.src}
              alt=""
              width={brandAssets.butterfly.width}
              height={brandAssets.butterfly.height}
              style={{ width: 60, height: 'auto', display: 'inline-block' }}
            />
            <div style={{
              textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
              fontWeight: 800, color: '#14B8A6', margin: '16px 0 8px',
            }}>Our mission</div>
            <h2 style={{ fontSize: 24, marginBottom: 0 }}>{mission}</h2>
          </div>

          <div style={{ marginTop: 64 }}>
            <h2 style={{ marginBottom: 24 }}>What makes FriendPlace different</h2>
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 20 }}>
              {DIFFERENTIATORS.map((d) => (
                <li key={d.title} style={{ display: 'flex', gap: 16 }}>
                  <div style={{ fontSize: 28 }}>{d.icon}</div>
                  <div>
                    <h3 style={{ fontSize: 18, marginBottom: 4 }}>{d.title}</h3>
                    <p style={{ color: '#475569', fontSize: 16, lineHeight: 1.6 }}>{d.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Tour continues — page-owned voice, not George's. He has
          quietly stepped back through the tour so the story lands
          on its own. See /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md
          → "The Quiet Host". */}
      <TourNext href="/how-it-works" label="See how it works" />

      {/* The one mark of George during the tour — quiet, corner,
          "here if you want me". Never on /meet (he's fully present)
          or /register-interest (his voice returns to close). */}
      <TapMeButterfly />
    </>
  );
}

function PageHero({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
      <div className="container">
        <div style={{
          textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
          fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
        }}>{eyebrow}</div>
        <h1 style={{ color: '#FFFFFF', maxWidth: 780, margin: '0 auto' }}>{title}</h1>
      </div>
    </section>
  );
}

const DIFFERENTIATORS = [
  { icon: '💐', title: 'Not a dating app', body: 'No swiping, no ranking. Just gentle introductions with people who share your interests and neighbourhood.' },
  { icon: '☕', title: 'Real-world first', body: 'Every feature nudges you toward meeting up in person — a coffee, a walk, a shared hobby.' },
  { icon: '🛡️', title: 'Safe by design', body: 'Verified members, on-call moderators, and one-tap blocking. Warmth without the worry.' },
  { icon: '🇳🇿🇦🇺', title: 'Community-owned tone', body: 'No investors demanding endless engagement. Just members shaping a place they love.' },
];

// Default About paragraphs — these are the fallback copy when the
// Mini-CMS hasn't yet overridden the About page content.
const DEFAULT_PARAGRAPHS: string[] = [
  'FriendPlace was created with one simple belief: meaningful friendships make life richer.',
  "Whether you're new to the area, looking to expand your circle, or simply hoping to meet like-minded people, FriendPlace helps you discover genuine friendships, welcoming communities, and local connections that can make everyday life more enjoyable.",
  "We're building more than an app — we're creating a place where people feel welcome, valued and connected.",
];
