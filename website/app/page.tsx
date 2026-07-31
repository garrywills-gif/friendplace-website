import Link from 'next/link';
import { site } from '@/lib/brand';
import { cms } from '@/lib/api';
import { brandAssets } from '@/lib/brand-assets';
import BrandMasthead from '@/components/BrandMasthead';
import { LaunchCountdownRibbon, type LaunchStatus } from '@/components/site/LaunchCountdownRibbon';
import HeroInvitation from '@/components/site/HeroInvitation';

async function getLaunchStatus(): Promise<LaunchStatus | null> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || '';
    const r = await fetch(`${base}/api/public/launch-status`, { next: { revalidate: 30 } });
    if (!r.ok) return null;
    return (await r.json()) as LaunchStatus;
  } catch {
    return null;
  }
}

/**
 * FriendPlace Home page.
 *
 * Sections (top → bottom):
 *   1. Hero              — "Find your people." emotional headline +
 *                          large butterfly with soft float animation
 *   2. Why FriendPlace?  — 4 negative-space differentiators
 *   3. Who is it for?    — persona pill grid ("New to the area",
 *                          "Empty nesters", ...)
 *   4. Three Simple Steps — compact numbered strip
 *   5. Features          — CMS-driven feature cards
 *   6. Life at FriendPlace — warm lifestyle photo strip
 *   7. Founding Members  — live count + first-250 wall
 *   8. Success Stories   — placeholder (auto-shows when admin adds)
 *   9. Download          — App Store / Play + QR
 *  10. Closing CTA       — final "Because you belong too."
 *
 * ALL content fetched server-side from `/api/public/*` → CMS-ready.
 * Falls back gracefully if the backend is unreachable.
 */
export default async function HomePage() {
  const [features, founders, stories, launchStatus] = await Promise.all([
    cms.features(),
    cms.founders(),
    cms.stories(),
    getLaunchStatus(),
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
      {/* ---------- 0a. LAUNCH COUNTDOWN RIBBON ---------- */}
      {/* Sits above everything else. Renders nothing when disabled. */}
      <LaunchCountdownRibbon initial={launchStatus} />

      {/* ---------- 0. NAVY BRANDING STRIP ---------- */}
      {/* Real HTML/CSS masthead, NOT the flyer image. Slim 80 px band
          that scales gracefully on mobile — contact rail hides below
          900 px, tagline hides below 520 px. All copy is CMS-ready. */}
      <BrandMasthead />

      {/* ---------- 1. HERO ---------- */}
      <section style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(180deg, #0A2540 0%, #12365B 100%)',
        color: '#FFFFFF', paddingTop: 96, paddingBottom: 120,
      }}>
        {/* soft teal glow behind the butterfly */}
        <div aria-hidden style={{
          position: 'absolute', right: '-10%', top: '-20%',
          width: 720, height: 720, borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(94,234,212,0.22), transparent)',
          pointerEvents: 'none',
        }} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 48, alignItems: 'center' }} className="hero-grid">
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.35)',
                color: '#5EEAD4', fontSize: 13, fontWeight: 700, marginBottom: 32,
              }}>
                🦋 Now welcoming Founding Members
              </div>
              <h1 style={{ color: '#FFFFFF', marginBottom: 32, lineHeight: 1.05 }}>
                Find your <span style={{ color: '#5EEAD4' }}>people</span>.
              </h1>
              <p style={{ fontSize: 22, color: '#FFFFFF', lineHeight: 1.5, marginBottom: 24, maxWidth: 560, fontWeight: 600 }}>
                Real friendships. Real communities.<br />
                Right where you live.
              </p>
              <p style={{ fontSize: 18, color: '#CBD5E1', lineHeight: 1.65, marginBottom: 40, maxWidth: 560 }}>
                FriendPlace is where genuine friendships begin. Meet local people, discover welcoming communities and enjoy real conversations — without swiping, followers or popularity contests.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Link href="#download" className="btn btn-primary" style={{ fontSize: 16, padding: '16px 30px' }}>
                  Get the App →
                </Link>
                <Link href="/how-it-works" className="btn btn-ghost">
                  See how it works
                </Link>
              </div>

              {/* Hero-level invitation to meet George / Georgia. Sits ONE
                  visual level below the primary CTAs and fades in ~1.3s
                  after paint, so visitors get a moment to read the hero
                  before George politely steps forward. Not another
                  navigation item — an intentional invitation. */}
              <HeroInvitation />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="butterfly-float" style={{ position: 'relative' }}>
                <div aria-hidden className="butterfly-glow" />
                {/* OFFICIAL butterfly (transparent background) from the
                    master brand-assets folder. Aspect ratio 512:503 is
                    preserved by only setting WIDTH — the height auto-
                    derives via `height: auto`. NEVER scale width/height
                    independently.

                    Reserved for HERO + brand-presentation contexts only.
                    The app-icon squircle is kept for the /#download
                    section where we're showing "what the icon looks
                    like on your phone". */}
                <img
                  src={brandAssets.butterfly.src}
                  alt={brandAssets.butterfly.alt}
                  width={brandAssets.butterfly.width}
                  height={brandAssets.butterfly.height}
                  className="hero-butterfly"
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 420,       // proportional — height auto
                    height: 'auto',   // preserves 512:503 exactly
                    display: 'block',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <style>{`
          @media (min-width: 900px) {
            .hero-grid { grid-template-columns: 1.2fr 1fr !important; }
          }
          @media (max-width: 899px) {
            .hero-butterfly { width: 260px !important; }
          }

          /* Gentle floating animation. The butterfly hovers like it is
             thinking about landing on your finger. 6s cycle keeps it
             calming rather than distracting. Respects reduced-motion. */
          @keyframes float {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-14px) rotate(-1.5deg); }
          }
          @keyframes pulseGlow {
            0%, 100% { opacity: 0.55; transform: scale(1); }
            50% { opacity: 0.85; transform: scale(1.08); }
          }
          .butterfly-float {
            animation: float 6s ease-in-out infinite;
          }
          .butterfly-glow {
            position: absolute; inset: -25%;
            background: radial-gradient(closest-side, rgba(20,184,166,0.55), rgba(94,234,212,0.15) 45%, transparent 70%);
            filter: blur(28px);
            animation: pulseGlow 5s ease-in-out infinite;
            pointer-events: none;
          }
          @media (prefers-reduced-motion: reduce) {
            .butterfly-float, .butterfly-glow { animation: none !important; }
          }
        `}</style>
      </section>

      {/* ---------- 2. WHY FRIENDPLACE ---------- */}
      <section style={{ padding: '96px 0', background: '#FEFCF8' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <SectionEyebrow>Why FriendPlace?</SectionEyebrow>
            <h2 style={{ margin: '0 auto 12px', maxWidth: 640 }}>❤️ Not what you're used to. In the best way.</h2>
            <p style={{ color: '#475569', fontSize: 18, maxWidth: 620, margin: '0 auto' }}>
              Just genuine friendships and community — the way it used to feel.
            </p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20, maxWidth: 1000, margin: '0 auto',
          }}>
            {WHY.map((w, i) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: 28, borderRadius: 20,
                border: '1px solid #E2E8F0', textAlign: 'center',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 999,
                  background: 'rgba(239,68,68,0.1)',
                  color: '#EF4444', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, fontWeight: 900, margin: '0 auto 16px',
                }}>✕</div>
                <div style={{ color: '#94A3B8', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Not here
                </div>
                <div style={{ color: '#0A2540', fontSize: 18, fontWeight: 800 }}>{w}</div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 32, textAlign: 'center',
            padding: '24px 32px', borderRadius: 999,
            background: 'linear-gradient(135deg, #14B8A6, #38BDF8)',
            color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', gap: 12,
            fontSize: 17, fontWeight: 800, boxShadow: '0 12px 40px rgba(20,184,166,0.35)',
            width: 'auto', margin: '32px auto 0',
          }} className="why-cta-wrap">
            <span>✨ Just genuine friendships and community.</span>
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }} />
        </div>
      </section>

      {/* ---------- 3. WHO IS IT FOR ---------- */}
      <section style={{
        padding: '96px 0',
        background: 'linear-gradient(180deg, #F0FDFA 0%, #FEFCF8 100%)',
      }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <SectionEyebrow>Who is FriendPlace for?</SectionEyebrow>
            <h2 style={{ margin: '0 auto 12px', maxWidth: 640 }}>👥 Anyone wanting more connection.</h2>
            <p style={{ color: '#475569', fontSize: 18, maxWidth: 620, margin: '0 auto' }}>
              We built FriendPlace with real Australians in mind.
            </p>
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 16,
            maxWidth: 900, margin: '0 auto', justifyContent: 'center',
          }}>
            {WHO.map((w, i) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: '18px 26px', borderRadius: 999,
                border: '1.5px solid #14B8A6',
                display: 'inline-flex', alignItems: 'center', gap: 10,
                fontSize: 17, fontWeight: 700, color: '#0A2540',
                boxShadow: '0 4px 12px rgba(20,184,166,0.1)',
              }}>
                <span style={{ fontSize: 22 }}>{w.emoji}</span>
                <span>{w.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 4. THREE SIMPLE STEPS ---------- */}
      <section style={{ padding: '96px 0', background: '#0A2540', color: '#FFFFFF' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <SectionEyebrow color="#5EEAD4">Three simple steps</SectionEyebrow>
            <h2 style={{ color: '#FFFFFF', margin: '0 auto 12px', maxWidth: 640 }}>⭐ It's as easy as this.</h2>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 24, maxWidth: 900, margin: '0 auto',
          }}>
            {STEPS_COMPACT.map((s, i) => (
              <div key={i} style={{
                textAlign: 'center',
                padding: '28px 20px', borderRadius: 24,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(94,234,212,0.2)',
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #14B8A6, #5EEAD4)',
                  color: '#0A2540', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, fontWeight: 900, margin: '0 auto 16px',
                }}>{i + 1}</div>
                <h3 style={{ color: '#FFFFFF', fontSize: 20, marginBottom: 8 }}>{s.title}</h3>
                <p style={{ color: '#CBD5E1', fontSize: 15, lineHeight: 1.6 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 4.5. SHARE A MOMENT ----------
          Locked with Garry, 31 July 2026. Share a Moment has become
          the defining feature of FriendPlace — this dedicated section
          sits immediately after "Three Simple Steps" so prospective
          members SEE the product, not just read about it. Uses real
          photographic mock cards over illustrations. The guardrail
          line is a hard rule from the "No guilt. Ever." principle
          (`/app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md`).
          Hero stays untouched — "Find your people." carries that job. */}
      <section style={{
        padding: '96px 0',
        background: 'linear-gradient(180deg, #FEF9E4 0%, #FFFCF2 100%)',
      }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
              fontWeight: 800, color: '#B45309', marginBottom: 12,
            }}>✨ Share a Moment</div>
            <h2 style={{ margin: '0 auto 16px', maxWidth: 720, color: '#78350F' }}>
              What&apos;s your moment today?
            </h2>
            <p style={{ color: '#7C5300', fontSize: 19, maxWidth: 640, margin: '0 auto', lineHeight: 1.55 }}>
              FriendPlace is built around the little moments of everyday life. A coffee.
              A walk. The grandkids visiting. An orchid finally flowering. Share a
              photo and a warm word — or simply enjoy what your community is sharing.
            </p>
          </div>

          {/* Three mock Moment cards — real photos, first-person captions,
              gentle likes/comments counts. This is deliberately laid out
              to mirror the actual app so a prospective member sees
              exactly what Share a Moment looks like on their phone. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            maxWidth: 1080, margin: '0 auto',
          }}>
            {MOCK_MOMENTS.map((m, i) => (
              <div key={i} style={{
                background: '#FFFFFF',
                borderRadius: 20,
                border: '1px solid #FDE68A',
                boxShadow: '0 8px 24px rgba(180,83,9,0.10)',
                padding: 18,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    fontSize: 28,
                  }}>{m.avatar}</div>
                  <div>
                    <div style={{ color: '#0A2540', fontWeight: 800, fontSize: 15 }}>{m.name}</div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>{m.when}</div>
                  </div>
                </div>
                <p style={{ color: '#0A2540', fontSize: 15, lineHeight: 1.55, margin: '0 0 12px' }}>
                  {m.caption}
                </p>
                <div style={{
                  aspectRatio: '4 / 3', borderRadius: 12, overflow: 'hidden',
                  backgroundImage: `url(${m.photo})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  marginBottom: 12,
                }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#64748B', fontSize: 13, fontWeight: 700 }}>
                  <span>❤️ {m.likes}</span>
                  <span>💬 {m.comments}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Guardrail line — locked wording from Garry, 31 July 2026.
              The public expression of the "No guilt. Ever." principle. */}
          <p style={{
            marginTop: 40, textAlign: 'center',
            color: '#78350F', fontSize: 16, fontStyle: 'italic',
            fontWeight: 600,
          }}>
            No pressure. No expectations. Just everyday moments worth sharing.
          </p>
        </div>
      </section>

      {/* ---------- 5. FEATURES ---------- */}
      <section style={{ padding: '96px 0', background: '#F8FAFC' }}>
        <div className="container">
          <SectionEyebrow>What's inside</SectionEyebrow>
          <h2 style={{ textAlign: 'center', marginBottom: 64 }}>Warm little touches, everywhere</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
          }}>
            {featureCards.slice(0, 6).map((f: any, i: number) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: 28, borderRadius: 20,
                border: '1px solid #E2E8F0',
              }} className="lift-card">
                <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 6. LIFE AT FRIENDPLACE (photo strip) ---------- */}
      <section style={{ padding: '96px 0', background: '#FEFCF8' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionEyebrow>Life at FriendPlace</SectionEyebrow>
            <h2 style={{ margin: '0 auto 12px', maxWidth: 640 }}>What&apos;s your moment today?</h2>
            <p style={{ color: '#475569', fontSize: 18, maxWidth: 640, margin: '0 auto', lineHeight: 1.55 }}>
              Little moments, big belonging. Coffee catch-ups, community walks, backyard BBQs, gardening groups — this is what FriendPlace looks like.
            </p>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}>
            {LIFE_PHOTOS.map((p, i) => (
              <div
                key={i}
                style={{
                  aspectRatio: '4/3',
                  borderRadius: 20, overflow: 'hidden',
                  backgroundImage: `linear-gradient(180deg, rgba(10,37,64,0) 40%, rgba(10,37,64,0.65) 100%), url(${p.src})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  position: 'relative',
                  boxShadow: '0 12px 32px rgba(10,37,64,0.12)',
                }}
              >
                <div style={{
                  position: 'absolute', bottom: 16, left: 16, right: 16,
                  color: '#FFFFFF', fontWeight: 800, fontSize: 16,
                  textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                }}>
                  {p.caption}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 7. FOUNDING MEMBERS ---------- */}
      <section id="founders" style={{ padding: '96px 0', background: '#F8FAFC' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <SectionEyebrow>Our first 250</SectionEyebrow>
            <h2 style={{ marginBottom: 16 }}>Founding Members</h2>
            <p style={{ color: '#475569', fontSize: 18, maxWidth: 560, margin: '0 auto 24px' }}>
              A permanent thank-you badge, on the app forever. The first 250 people help shape what FriendPlace becomes.
            </p>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '12px 24px', borderRadius: 999,
              background: '#0A2540', color: '#FFFFFF',
              fontWeight: 800, fontSize: 15,
            }}>
              <span style={{ color: '#5EEAD4' }}>🦋</span>
              {/* Show a warm invitation while we're pre-launch. Once
                  people start joining the count flips to a live "N of
                  250 welcomed" pill. */}
              <span>
                {founderCount > 0
                  ? `${founderCount} of ${founderCap} welcomed`
                  : `Be one of our first ${founderCap} Founding Members`}
              </span>
            </div>
          </div>
          {founderMembers.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16, maxWidth: 900, margin: '0 auto',
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
                    color: '#FFFFFF', fontWeight: 900, fontSize: 22, margin: '0 auto 12px',
                  }}>{m.avatar || m.name.charAt(0).toUpperCase()}</div>
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

      {/* ---------- 8. SUCCESS STORIES ---------- */}
      <section id="stories" style={{ padding: '96px 0', background: '#FEFCF8' }}>
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

      {/* ---------- 9. DOWNLOAD ---------- */}
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
                <div style={{
                  width: 200, height: 200,
                  background: 'repeating-linear-gradient(45deg, #0A2540 0 8px, #FFFFFF 8px 16px)',
                  borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {/* This IS the app-icon-showing-on-phone context, so the
                      squircle-framed full app icon is intentional here.
                      Preserves the 1:1 aspect ratio. */}
                  <img
                    src={brandAssets.appIcon.src}
                    alt={brandAssets.appIcon.alt}
                    width={brandAssets.appIcon.width}
                    height={brandAssets.appIcon.height}
                    style={{
                      width: 72, height: 72, // 1:1
                      borderRadius: 16, background: '#FFFFFF',
                      padding: 4,
                    }}
                  />
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

      {/* ---------- 10. CLOSING CTA ---------- */}
      <section style={{ padding: '96px 0 32px', background: '#FEFCF8', textAlign: 'center' }}>
        <div className="container">
          {/* Official transparent butterfly — brand presentation context,
              so no squircle. Proportional sizing via width-only. */}
          <img
            src={brandAssets.butterfly.src}
            alt=""
            width={brandAssets.butterfly.width}
            height={brandAssets.butterfly.height}
            style={{ width: 80, height: 'auto', display: 'inline-block' }}
          />
          <h2 style={{ marginTop: 24, marginBottom: 12 }}>{site.tagline}</h2>
          <p style={{ color: '#475569', fontSize: 18, maxWidth: 560, margin: '0 auto 32px' }}>
            Somewhere near you, someone is looking for exactly what you'd love to talk about too.
          </p>
          <Link href="/contact" className="btn btn-primary" style={{ fontSize: 16, padding: '16px 30px' }}>
            Say hello →
          </Link>
        </div>
      </section>

      <style>{`
        .lift-card { transition: transform 220ms, box-shadow 220ms; }
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
      fontWeight: 700, fontSize: 14, textDecoration: 'none',
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

const WHY = [
  'No swiping',
  'No followers',
  'No popularity contests',
  'No fake connections',
];

const WHO = [
  { emoji: '🏡', label: 'New to the area' },
  { emoji: '🪺', label: 'Empty nesters' },
  { emoji: '👴', label: 'Retirees' },
  { emoji: '🌙', label: 'Shift workers' },
  { emoji: '💫', label: 'Anyone wanting more connection' },
];

const STEPS_COMPACT = [
  { title: 'Join FriendPlace', body: 'Sign up in minutes with Apple, Google or email. Free forever for members.' },
  { title: 'Meet local people', body: 'Discover neighbours who share your interests. Send a warm hello — never a swipe.' },
  { title: 'Find your community', body: 'Coffee catch-ups, hobby nights, local events. Belonging in real life.' },
];

const LIFE_PHOTOS = [
  { src: 'https://images.unsplash.com/photo-1773504356091-222ee58cfd23?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Coffee catch-ups' },
  { src: 'https://images.unsplash.com/photo-1604852483450-f88e9f046a8a?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Backyard BBQs' },
  { src: 'https://images.unsplash.com/photo-1689783553640-e8b76148fb22?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Dog walking' },
  { src: 'https://images.unsplash.com/photo-1781785273371-a959f34bfab0?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Community gardens' },
  { src: 'https://images.unsplash.com/photo-1544928147-79a2dbc1f389?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Craft workshops' },
  { src: 'https://images.unsplash.com/photo-1549057446-9f5c6ac91a04?crop=entropy&cs=srgb&fm=jpg&w=800&q=80', caption: 'Walking groups' },
];

// Three real-feeling Share a Moment mock cards for the dedicated
// section on Home. First-person captions in the voice a member would
// actually use. Photos reuse the site's warm Life-at-FriendPlace
// palette so the story reads as one continuous look-and-feel.
// Locked wording with Garry, 31 July 2026.
const MOCK_MOMENTS = [
  {
    name: 'Margaret',
    when: '2 hours ago',
    avatar: '🌺',
    caption: 'Had a lovely coffee with my neighbour this morning. Turns out we both grew up on the same street in Ballarat.',
    photo: 'https://images.unsplash.com/photo-1773504356091-222ee58cfd23?crop=entropy&cs=srgb&fm=jpg&w=800&q=80',
    likes: 12,
    comments: 4,
  },
  {
    name: 'David',
    when: 'this morning',
    avatar: '🐶',
    caption: "Charlie discovered the beach today. I don't think he'll ever want to leave.",
    photo: 'https://images.unsplash.com/photo-1689783553640-e8b76148fb22?crop=entropy&cs=srgb&fm=jpg&w=800&q=80',
    likes: 27,
    comments: 8,
  },
  {
    name: 'Joyce',
    when: 'yesterday',
    avatar: '🌼',
    caption: 'My orchid has finally flowered. Two years of patience, worth every day.',
    photo: 'https://images.unsplash.com/photo-1781785273371-a959f34bfab0?crop=entropy&cs=srgb&fm=jpg&w=800&q=80',
    likes: 41,
    comments: 11,
  },
];

const DEFAULT_FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: '✨', title: 'Share a Moment', body: "The little moments of your day — a coffee, a walk, the grandkids visiting, an orchid finally flowering. Share a photo and a warm word. Or just enjoy what your community is sharing." },
  { icon: '☕', title: 'FP Café', body: 'Our virtual café — a soft place to drop in, read what others are sharing, or share your own thought. No pressure.' },
  { icon: '🗓️', title: 'Local Events', body: 'Coffee catch-ups, hobby nights and community meets. RSVP with one tap and see who\'s coming.' },
  { icon: '👥', title: 'Find Friends', body: 'Discover people nearby who share your interests. Send a warm hello — never a swipe.' },
  { icon: '🦋', title: 'Butterfly Points', body: 'A gentle way to celebrate kindness. Earn points for warm messages, RSVPs, and helping others feel welcome.' },
  { icon: '🔒', title: 'Safe & Verified', body: 'Every member is verified. Report tools, blocking, and a real human moderating team keep it warm.' },
  { icon: '🎯', title: 'Games & Groups', body: 'Solitaire, Word of the Day, book clubs, walking groups. Something for every kind of connection.' },
];
