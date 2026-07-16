import { cms } from '@/lib/api';

export const metadata = { title: 'Features' };

const DEFAULT_FEATURES = [
  { icon: '☕', title: 'Coffee Lounge', body: 'A soft place to think out loud. Reply to a thought, share your own, or just read — no pressure, no likes.' },
  { icon: '🗓️', title: 'Local Events', body: 'Coffee catch-ups, hobby nights and community meets. RSVP with one tap and see who’s coming.' },
  { icon: '👥', title: 'Find Friends', body: 'Discover people nearby who share your interests. Send a warm hello — never a swipe.' },
  { icon: '🎯', title: 'Games & Groups', body: 'Solitaire, Word of the Day, book clubs, walking groups. Something for every kind of connection.' },
  { icon: '🦋', title: 'Butterfly Points', body: 'A gentle way to celebrate kindness. Earn points for warm messages, RSVPs and helping others feel welcome.' },
  { icon: '🔒', title: 'Safe & Verified', body: 'Every member is verified. Report tools, one-tap blocking, and human moderators keep it warm.' },
  { icon: '🌟', title: 'Founding Members', body: 'Join us in our first 250 and wear a permanent Founding Member badge forever.' },
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
                <div style={{ fontSize: 40, marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontSize: 20, marginBottom: 10 }}>{f.title}</h3>
                <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.65 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
