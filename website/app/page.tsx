import Link from 'next/link';
import Butterfly from '@/components/Butterfly';
import { site } from '@/lib/brand';
import { cms } from '@/lib/api';

/**
 * FriendPlace Home page.
 *
 * Sections (top → bottom):
 *   1. Hero      — big brand promise + primary CTA + butterfly halo
 *   2. How-Works — 3-step visual explainer
 *   3. Features  — CMS-driven cards (falls back to defaults if API down)
 *   4. Founders  — the "Founding Members" strip with live count
 *   5. Stories   — Success Stories placeholder (empty state now,
 *                  auto-populates when admin adds via CMS later)
 *   6. Download  — App Store / Google Play buttons + QR code
 *   7. Closing   — final soft CTA before the footer
 *
 * ALL content is fetched server-side from `/api/public/*`. Falls back
 * gracefully when the backend is unreachable so the site never
 * white-screens.
 */
export default async function HomePage() {
  const [features, founders, stories] = await Promise.all([
    cms.features(),
    cms.founders(),
    cms.stories(),
  ]);

  const featureCards = features?.features && features.features.length > 0
    ? features.features
    : DEFAULT_FEATURES;

  const founderMembers = founders?.members || [];
  const founderCount = founders?.count ?? founderMembers.length;
  const founderCap = founders?.cap ?? 250;

  const storiesList = stories?.stories || [];

  return (
    <>
      {/* ---------- HERO ---------- */}
      <section style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #0A2540 0%, #12365B 100%)',
        color: '#FFFFFF',
        paddingTop: 72,
        paddingBottom: 96,
      }}>
        {/* soft teal glow behind the butterfly */}
        <div aria-hidden style={{
          position: 'absolute', right: '-10%', top: '-20%',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(94,234,212,0.24), transparent)',
          pointerEvents: 'none',
        }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 48, alignItems: 'center' }} className="hero-grid">
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.35)',
                color: '#5EEAD4', fontSize: 13, fontWeight: 700, marginBottom: 24,
              }}>
                🦋 Now welcoming Founding Members
              </div>
              <h1 style={{ color: '#FFFFFF', marginBottom: 20 }}>
                Real friendships,<br />
                <span style={{ color: '#5EEAD4' }}>close to home.</span>
              </h1>
              <p style={{ fontSize: 20, color: '#CBD5E1', lineHeight: 1.55, marginBottom: 32, maxWidth: 560 }}>
                <strong style={{ color: '#FFFFFF' }}>{site.tagline}</strong> FriendPlace is a warm community app for meeting genuine people in your neighbourhood — coffee catch-ups, hobby groups, local events. No dating, no swiping. Just belonging.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Link href="#download" className="btn btn-primary" style={{ fontSize: 16, padding: '16px 30px' }}>
                  Get the App →
                </Link>
                <Link href="/how-it-works" className="btn btn-ghost">
                  See how it works
                </Link>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ position: 'relative' }}>
                <div aria-hidden style={{
                  position: 'absolute', inset: '-30%',
                  background: 'radial-gradient(closest-side, rgba(20,184,166,0.35), transparent)',
                  filter: 'blur(30px)',
                }} />
                <div style={{ position: 'relative' }}>
                  <Butterfly size={280} color="#5EEAD4" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <style>{`
          @media (min-width: 900px) {
            .hero-grid { grid-template-columns: 1.2fr 1fr !important; }
          }
        `}</style>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section style={{ padding: '96px 0', background: '#FEFCF8' }}>
        <div className="container">
          <SectionEyebrow>Three simple steps</SectionEyebrow>
          <h2 style={{ textAlign: 'center', marginBottom: 12 }}>Belonging, made effortless</h2>
          <p style={{ textAlign: 'center', color: '#475569', fontSize: 18, maxWidth: 640, margin: '0 auto 64px' }}>
            No awkward icebreakers. No pressure. Just a warm nudge from someone nearby who probably makes their coffee the same way you do.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 32,
          }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: 32, borderRadius: 24,
                border: '1px solid #E2E8F0',
                boxShadow: '0 4px 24px rgba(10,37,64,0.04)',
                transition: 'transform 220ms, box-shadow 220ms',
              }} className="lift-card">
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'linear-gradient(135deg, #14B8A6, #38BDF8)',
                  color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, fontWeight: 900, marginBottom: 20,
                }}>{i + 1}</div>
                <h3 style={{ marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: '#475569', fontSize: 16, lineHeight: 1.6 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FEATURES ---------- */}
      <section style={{ padding: '96px 0', background: '#F8FAFC' }}>
        <div className="container">
          <SectionEyebrow>What's inside</SectionEyebrow>
          <h2 style={{ textAlign: 'center', marginBottom: 64 }}>Warm little touches, everywhere</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
          }}>
            {featureCards.map((f, i) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: 28, borderRadius: 20,
                border: '1px solid #E2E8F0',
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FOUNDING MEMBERS ---------- */}
      <section id="founders" style={{ padding: '96px 0', background: '#FEFCF8' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionEyebrow>Our first 250</SectionEyebrow>
            <h2 style={{ marginBottom: 16 }}>Founding Members</h2>
            <p style={{ color: '#475569', fontSize: 18, maxWidth: 560, margin: '0 auto 24px' }}>
              A permanent thank-you badge, on the app forever. The first 250 people help shape what FriendPlace becomes.
            </p>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '10px 20px', borderRadius: 999,
              background: '#0A2540', color: '#FFFFFF',
              fontWeight: 800, fontSize: 15,
            }}>
              <span style={{ color: '#5EEAD4' }}>🦋</span>
              <span>{founderCount} of {founderCap} welcomed</span>
            </div>
          </div>

          {founderMembers.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16,
              maxWidth: 900, margin: '0 auto',
            }}>
              {founderMembers.slice(0, 12).map((m, i) => (
                <div key={i} style={{
                  background: '#FFFFFF', padding: 20, borderRadius: 16,
                  border: '1px solid #E2E8F0', textAlign: 'center',
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #14B8A6, #38BDF8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#FFFFFF', fontWeight: 900, fontSize: 22,
                    margin: '0 auto 12px',
                  }}>
                    {m.avatar || m.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 800, color: '#0A2540', marginBottom: 4 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>#{m.number}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              maxWidth: 500, margin: '0 auto', textAlign: 'center',
              padding: 40, background: '#FFFFFF', borderRadius: 24, border: '1px dashed #CBD5E1',
            }}>
              <p style={{ color: '#475569', fontSize: 16 }}>
                Your name could appear here. Founding Members join us in these early weeks and stay forever recognised.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---------- SUCCESS STORIES (placeholder) ---------- */}
      <section id="stories" style={{ padding: '96px 0', background: '#F8FAFC' }}>
        <div className="container">
          <SectionEyebrow>Real people, real belonging</SectionEyebrow>
          <h2 style={{ textAlign: 'center', marginBottom: 48 }}>Success stories</h2>
          {storiesList.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 24,
            }}>
              {storiesList.map((s, i) => (
                <blockquote key={i} style={{
                  background: '#FFFFFF', padding: 32, borderRadius: 20,
                  border: '1px solid #E2E8F0',
                }}>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#334155', fontStyle: 'italic', marginBottom: 20 }}>
                    "{s.body}"
                  </p>
                  <footer style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: '#14B8A6', color: '#FFFFFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, fontWeight: 900,
                    }}>{s.avatar || s.name.charAt(0)}</div>
                    <div>
                      <div style={{ fontWeight: 800, color: '#0A2540' }}>{s.name}</div>
                      <div style={{ fontSize: 13, color: '#94A3B8' }}>{s.title}</div>
                    </div>
                  </footer>
                </blockquote>
              ))}
            </div>
          ) : (
            <div style={{
              maxWidth: 640, margin: '0 auto',
              padding: 48, textAlign: 'center',
              background: '#FFFFFF', borderRadius: 24, border: '1px dashed #CBD5E1',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>☕</div>
              <p style={{ color: '#475569', fontSize: 17, lineHeight: 1.6 }}>
                Stories are coming soon. As Founding Members meet new friends, we'll share their favourite moments here — with permission, of course.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---------- DOWNLOAD ---------- */}
      <section id="download" style={{ padding: '96px 0', background: '#0A2540', color: '#FFFFFF' }}>
        <div className="container">
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr', gap: 48, alignItems: 'center',
          }} className="download-grid">
            <div>
              <SectionEyebrow color="#5EEAD4">Available on iOS & Android</SectionEyebrow>
              <h2 style={{ color: '#FFFFFF', marginBottom: 16 }}>Download FriendPlace</h2>
              <p style={{ color: '#CBD5E1', fontSize: 18, lineHeight: 1.6, marginBottom: 32 }}>
                Free forever for members. No ads, no data selling — just a place to belong.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <StoreBtn store="Apple" href="#" />
                <StoreBtn store="Google" href="#" />
              </div>
              <p style={{ color: '#64748B', fontSize: 13, marginTop: 20 }}>
                Coming to the App Store & Google Play in weeks — join the Founding Members list to be first.
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                display: 'inline-block', background: '#FFFFFF', padding: 24, borderRadius: 24,
                boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              }}>
                {/* Placeholder QR block — actual QR generated on final deploy */}
                <div style={{
                  width: 200, height: 200,
                  background: 'repeating-linear-gradient(45deg, #0A2540 0 8px, #FFFFFF 8px 16px)',
                  borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ background: '#FFFFFF', padding: 10, borderRadius: 8 }}>
                    <Butterfly size={40} color="#14B8A6" />
                  </div>
                </div>
                <p style={{ color: '#0A2540', fontSize: 13, fontWeight: 700, marginTop: 12 }}>
                  Scan to download
                </p>
              </div>
            </div>
          </div>
        </div>
        <style>{`
          @media (min-width: 900px) {
            .download-grid { grid-template-columns: 1.3fr 1fr !important; }
          }
        `}</style>
      </section>

      {/* ---------- CLOSING CTA ---------- */}
      <section style={{ padding: '96px 0 32px', background: '#FEFCF8', textAlign: 'center' }}>
        <div className="container">
          <Butterfly size={56} color="#14B8A6" />
          <h2 style={{ marginTop: 24, marginBottom: 12 }}>Because you belong too.</h2>
          <p style={{ color: '#475569', fontSize: 18, maxWidth: 560, margin: '0 auto 32px' }}>
            Somewhere near you, someone is looking for exactly what you'd love to talk about too.
          </p>
          <Link href="/contact" className="btn btn-primary" style={{ fontSize: 16, padding: '16px 30px' }}>
            Say hello →
          </Link>
        </div>
      </section>

      <style>{`
        .lift-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 14px 48px rgba(10,37,64,0.10);
        }
      `}</style>
    </>
  );
}

function SectionEyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      textAlign: 'center',
      textTransform: 'uppercase',
      letterSpacing: '0.15em',
      fontSize: 12,
      fontWeight: 800,
      color: color || '#14B8A6',
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function StoreBtn({ store, href }: { store: 'Apple' | 'Google'; href: string }) {
  const isApple = store === 'Apple';
  return (
    <a href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 12,
      background: '#FFFFFF', color: '#0A2540',
      padding: '12px 22px', borderRadius: 16,
      fontWeight: 700, fontSize: 14,
      textDecoration: 'none',
      minWidth: 180,
    }}>
      <span style={{ fontSize: 28 }}>{isApple ? '' : '▶'}</span>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
          {isApple ? 'Download on the' : 'Get it on'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 900 }}>
          {isApple ? 'App Store' : 'Google Play'}
        </div>
      </div>
    </a>
  );
}

const STEPS = [
  {
    title: 'Join with a warm welcome',
    body: 'Sign up in minutes with Apple, Google, or email. Answer a few gentle questions so we can suggest people you\'d genuinely enjoy meeting.',
  },
  {
    title: 'Discover your Lounge',
    body: 'Your Coffee Lounge is a soft place to say hello, share a thought, or reply to someone else\'s. No pressure, no likes — just conversation.',
  },
  {
    title: 'Meet up, in real life',
    body: 'Local events, hobby groups, and one-on-one coffee catch-ups. Everyone is verified, and every event is welcoming to newcomers.',
  },
];

const DEFAULT_FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: '☕', title: 'Coffee Lounge', body: 'A soft place to think out loud. Reply to a thought, share your own, or just read — no pressure.' },
  { icon: '🗓️', title: 'Local Events', body: 'Coffee catch-ups, hobby nights and community meets. RSVP with one tap and see who\'s coming.' },
  { icon: '👥', title: 'Find Friends', body: 'Discover people nearby who share your interests. Send a warm hello — never a swipe.' },
  { icon: '🎯', title: 'Games & Groups', body: 'Solitaire, Word of the Day, book clubs, walking groups. Something for every kind of connection.' },
  { icon: '🦋', title: 'Butterfly Points', body: 'A gentle way to celebrate kindness. Earn points for warm messages, RSVPs, and helping others feel welcome.' },
  { icon: '🔒', title: 'Safe & Verified', body: 'Every member is verified. Report tools, blocking, and a real human moderating team keep it warm.' },
];
