import { cms } from '@/lib/api';
import { TourNext } from '@/components/TourNav';
import TapMeButterfly from '@/components/TapMeButterfly';

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
            From download to genuine friendship in less than a week.
          </h1>
        </div>
      </section>

      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 900 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '80px 1fr',
              gap: 32, marginBottom: 64,
              alignItems: 'start',
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: 24,
                background: 'linear-gradient(135deg, #14B8A6, #38BDF8)',
                color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 900,
              }}>{i + 1}</div>
              <div>
                <h2 style={{ fontSize: 26, marginBottom: 12 }}>{s.title}</h2>
                <p style={{ fontSize: 17, lineHeight: 1.7, color: '#334155' }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tour continues \u2014 last stop is /features, which ends with
          George's voice returning to close the journey. See
          /app/website/PUBLIC_EXPERIENCE_PRINCIPLES.md \u2192 "The
          Quiet Host". */}
      <TourNext href="/features" label="See what makes it feel like belonging" />

      <TapMeButterfly />
    </>
  );
}

void cms; // Keep import for future CMS-driven content.

const STEPS = [
  {
    title: 'Download the app',
    body: "FriendPlace is free forever for members. Grab it on the App Store or Google Play. Sign up with Apple, Google, or email — whichever feels easiest.",
  },
  {
    title: 'Set up your warm welcome',
    body: "Add a photo, a first name, and a few interests. We ask a couple of gentle questions so we can suggest people you'd genuinely enjoy meeting. No personality quizzes, no oversharing.",
  },
  {
    title: 'Say hello in the Lounge',
    body: 'Your Coffee Lounge is a soft place to think out loud. Read what other members are sharing today, reply to a thought that resonates, or share your own. The Lounge is our version of the local café counter.',
  },
  {
    title: 'Meet people nearby',
    body: "Find Friends shows you people in your suburb who share your interests. Send a warm hello — never a swipe. If they say hello back, you're on your way.",
  },
  {
    title: 'Come to an event',
    body: 'Every week there are Local Events — coffee catch-ups, hobby groups, walks. RSVP with one tap, see who’s coming, and turn up. Every event is welcoming to newcomers.',
  },
  {
    title: 'Belong, in real life',
    body: 'Real friendships happen. FriendPlace stays quietly in the background, gently celebrating your kindness with Butterfly Points as you go.',
  },
];
