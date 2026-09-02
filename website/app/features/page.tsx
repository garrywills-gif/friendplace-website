/* ─────────────────────────────────────────────────────────────
 * 🔒 APPROVED BASELINE — iter152, June 2026
 *   /features is the LAST tour page. The grid MUST NOT contain
 *   a "Founding Members" tile — the reveal is post-registration
 *   only. TourEnding at the bottom is George's only spoken beat
 *   between /meet and /register-interest. Both are LOCKED.
 *   See /app/website/APPROVED_ONBOARDING_JOURNEY.md.
 * ─────────────────────────────────────────────────────────── */

import type { Metadata } from 'next';
import { cms } from '@/lib/api';
import { TourEnding } from '@/components/TourNav';
import TapMeButterfly from '@/components/TapMeButterfly';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

export const metadata: Metadata = {
  title: 'FriendPlace Features | Meet People, Groups, Events & FP Café',
  description: 'Explore FriendPlace features for meeting local people, joining groups and events, sharing moments, chatting in FP Café and building genuine friendships in Australia.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'FriendPlace Features | Meet People, Groups, Events & FP Café',
    description: 'See how FriendPlace helps adults connect locally through people, groups, events, FP Café and everyday community moments.',
    url: '/features',
    type: 'website',
  },
};

const DEFAULT_FEATURES = [
  { icon: '✨', title: 'Share a Moment', body: 'A photo, a story or something that made you smile today. Share everyday moments with your community and enjoy theirs.' },
  { icon: '☕', title: 'FP Café', body: 'Our virtual café — a soft place to drop in, read what others are sharing, or share your own thought. No pressure, no likes.' },
  { icon: '🗓️', title: 'Local Events', body: 'Coffee catch-ups, hobby nights and community meets. RSVP with one tap and see who’s coming.' },
  { icon: '👥', title: 'Find Friends', body: 'Discover people nearby who share your interests. Send a warm hello — never a swipe.' },
  { icon: '🎯', title: 'Games & Groups', body: 'Solitaire, Word of the Day, book clubs, walking groups. Something for every kind of connection.' },
  { icon: '🦋', title: 'Butterfly Points', body: 'A gentle way to celebrate kindness. Earn points for warm messages, RSVPs and helping others feel welcome.' },
  { icon: '🔒', title: 'Safe & Verified', body: 'Every member is verified. Report tools, one-tap blocking, and human moderators keep it warm.' },
  { icon: '🌐', title: 'Made in Australia', body: 'Built by Australians, for Australians. Data stays in Australia, and support speaks your accent.' },
  { icon: '💬', title: 'Voice & Text Chat', body: 'Tap the mic to dictate a message, pinch to zoom on photos, and hear replies read aloud if you prefer.' },
];

export default async function FeaturesPage() {
  const data = await cms.features();
  const items = data?.features && data.features.length > 0 ? data.features : DEFAULT_FEATURES;

  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>Features</div>
          <h1 style={{ color: '#FFFFFF', maxWidth: 720, margin: '0 auto' }}>
            Little touches that add up to belonging.
          </h1>
        </div>
      </section>

      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
          }}>
            {items.map((f: any, i: number) => (
              <div key={i} style={{
                background: '#FFFFFF', padding: 32, borderRadius: 20,
                border: '1px solid #E2E8F0',
                transition: 'transform 220ms, box-shadow 220ms',
              }} className="lift-card">
                <div style={{ fontSize: 40, marginBottom: 16, display: 'flex', alignItems: 'center' }}>
                  {f.icon === '🦋' ? <GeorgeButterflyMark size={40} /> : f.icon}
                </div>
                <h3 style={{ fontSize: 20, marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.65 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* George returns — one line, one button. This is the ONLY
          moment his voice reappears during the tour. His silence
          through /about → /how-it-works → the rest of this page
          is what makes this land. Do not add a second paragraph
          or a supporting line. See /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md
          → "The Quiet Host". */}
      <TourEnding />

      <TapMeButterfly />
    </>
  );
}
