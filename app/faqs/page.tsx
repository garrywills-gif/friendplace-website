import { cms } from '@/lib/api';
import FAQAccordion from '@/components/FAQAccordion';

export const metadata = {
  title: 'Finding Friends & Making New Friends — FAQs',
  description: 'Questions about finding friends near you, making friends as an adult and joining FriendPlace, an upcoming Australian friendship app. Learn how registration works.',
  alternates: { canonical: '/faqs' },
};

const FINDING_FRIENDS_FAQS = [
  { q: 'How do I make friends near me?', a: 'Start with local activities you enjoy: a walking group, library event, community class, volunteering or a regular coffee catch-up. Seeing the same people again gives conversation a chance to grow. FriendPlace is being built to help adults in Australia discover local people, groups and events. The app is coming soon; you can register your interest on this website.' },
  { q: 'How can I make new friends as an adult?', a: 'Choose an activity you would enjoy even before you know anyone, turn up regularly and start with a small hello. Ask about a shared interest, then suggest another walk or coffee if you both enjoy the conversation. Finding new friends can take time, so there is no need to rush or feel that every introduction must become a close friendship.' },
  { q: 'Where can I find friends after moving to a new area?', a: 'Local libraries, community centres, hobby groups and volunteering are useful places to begin. Pick a recurring activity that fits your routine so you can get to know familiar faces. Our friendship guides include practical ideas for meeting new people after moving, and FriendPlace is coming soon to support everyday local connection.' },
  { q: 'Do I need the FriendPlace app to join groups?', a: 'FriendPlace groups, the FP Café and member conversations will be available through the app once it launches. For now, this website lets you explore FriendPlace and register your interest as a Founding Member. Registration is not app access: we will email registered members when the app is ready with how to get started.' },
];

const DEFAULT_FAQS = [
  { q: 'What is FriendPlace?', a: 'FriendPlace is a warm community app for making real, everyday friendships — local coffee catch-ups, hobby groups and community events. It is not a dating app.' },
  { q: 'Is it really free?', a: 'Yes, FriendPlace is free for members and will always have a free tier. Down the track, local businesses may pay to run community-friendly sponsored events, listings or partnerships (think a café hosting a book club) — but that is separate from the member experience, and we will never sell your personal data or fill the app with ads.' },
  { q: 'How is FriendPlace different from Facebook or Meetup?', a: "We're smaller, warmer and focused on real life. There are no likes, no infinite scroll, no algorithm optimising your engagement. Just gentle nudges toward genuine belonging." },
  { q: 'Is FriendPlace safe?', a: 'Every member is verified, and we have a real human moderation team. You can report or block anyone with one tap. Community guidelines are enforced firmly but kindly.' },
  { q: 'Who runs FriendPlace?', a: 'A small Australian team based in New South Wales, backed by Founding Members like you. We are member-supported, not investor-owned.' },
  { q: 'When will it be on the App Store?', a: 'Very soon. We are welcoming a first wave of Founding Members through TestFlight and Google Play early access while we finish the final polish.' },
  { q: 'What data do you collect?', a: 'The minimum to run the app safely: name, email, suburb, and what you post yourself. Full details in our Privacy Policy.' },
  { q: 'How do I become a Founding Member?', a: 'Sign up in the first weeks of launch. The first 250 members are recognised forever with a Founding Member badge.' },
];

export default async function FAQsPage() {
  const data = await cms.faqs();
  const existing = data?.faqs && data.faqs.length > 0 ? data.faqs : DEFAULT_FAQS;
  const questions = new Set(FINDING_FRIENDS_FAQS.map(item => item.q.toLowerCase()));
  const items = [...FINDING_FRIENDS_FAQS, ...existing.filter(item => !questions.has(item.q.toLowerCase()))];

  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>FAQs</div>
          <h1 style={{ color: '#FFFFFF', maxWidth: 720, margin: '0 auto' }}>Finding friends: your questions answered.</h1>
        </div>
      </section>

      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <FAQAccordion faqs={items} />
          <p style={{ textAlign: 'center', marginTop: 48, color: '#475569', fontSize: 16 }}>
            Something else on your mind? <a href="/contact" style={{ color: '#14B8A6', fontWeight: 700 }}>Get in touch →</a>
          </p>
        </div>
      </section>
    </>
  );
}
