import { cms } from '@/lib/api';

export const metadata = { title: 'How It Works' };

export default async function HowPage() {
  // Future CMS hook — for now uses static defaults, editable in Mini-CMS.
  const data = null as any;

  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>How it works</div>
          <h1 style={{ color: '#FFFFFF', maxWidth: 700, margin: '0 auto' }}>
            From download to genuine friendship.
          </h1>
        </div>
      </section>

      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 900 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '96px 1fr',
              gap: 32, marginBottom: 64,
              alignItems: 'start',
            }}>
              <div style={{
                width: 96, height: 96, borderRadius: 28,
                background: 'linear-gradient(135deg, #14B8A6, #38BDF8)',
                color: '#FFFFFF', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 10px 24px rgba(20, 184, 166, 0.25)',
              }}>
                <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>{s.emoji}</div>
                <div style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
                  marginTop: 6, opacity: 0.9, textTransform: 'uppercase',
                }}>Step {i + 1}</div>
              </div>
              <div>
                <h2 style={{ fontSize: 26, marginBottom: 12 }}>{s.title}</h2>
                <p style={{ fontSize: 17, lineHeight: 1.7, color: '#334155' }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

void cms; // Keep import for future CMS-driven content.

const STEPS = [
  {
    emoji: '📲',
    title: 'Download FriendPlace',
    body: "FriendPlace is free forever for members. Grab it on the App Store or Google Play. Sign up with Apple, Google, or email — whichever feels easiest.",
  },
  {
    emoji: '👋',
    title: 'Tell us a little about yourself',
    body: "Add a photo, a first name, and a few interests. We ask a couple of gentle questions so we can suggest people you'd genuinely enjoy meeting. No personality quizzes, no oversharing.",
  },
  {
    emoji: '☕',
    title: 'Start your first conversation',
    body: 'Your Coffee Lounge is a soft place to think out loud. Read what other members are sharing today, reply to a thought that resonates, or share your own. The Lounge is our version of the local café counter.',
  },
  {
    emoji: '🤝',
    title: 'Meet people who share your interests',
    body: "Find Friends shows you people in your suburb who share your interests. Send a warm hello — never a swipe. If they say hello back, you're on your way.",
  },
  {
    emoji: '🎉',
    title: 'Take the next step at a local event',
    body: 'Every week there are Local Events — coffee catch-ups, hobby groups, walks. RSVP with one tap, see who’s coming, and turn up. Every event is welcoming to newcomers.',
  },
  {
    emoji: '💜',
    title: 'Build lasting friendships',
    body: 'Keep meeting, chatting and joining events. FriendPlace is designed to help genuine friendships grow over time.',
  },
];
