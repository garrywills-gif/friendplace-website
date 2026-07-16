import { cms } from '@/lib/api';
import { brandAssets } from '@/lib/brand-assets';

export const metadata = { title: 'About Us' };

export default async function AboutPage() {
  const data = await cms.about();
  const heading = data?.heading || 'Everyone deserves a place to belong.';
  const body = data?.body || "FriendPlace was created to help people build genuine friendships, discover local communities and create meaningful connections. We believe belonging shouldn't happen by chance — it should be something everyone can experience. Whether you're new to the area, looking to expand your circle, or simply wanting to meet like-minded people, FriendPlace is here to help you find your people.";
  const mission = data?.mission || 'To make everyday belonging effortless — one gentle hello at a time.';

  return (
    <>
      <PageHero eyebrow="About us" title={heading} />
      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 780 }}>
          <p style={{ fontSize: 19, lineHeight: 1.7, color: '#334155', marginBottom: 32 }}>
            {body}
          </p>
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
