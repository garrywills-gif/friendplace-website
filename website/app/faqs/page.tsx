import { cms } from '@/lib/api';
import FAQAccordion from '@/components/FAQAccordion';

export const metadata = { title: 'Frequently Asked Questions' };

const DEFAULT_FAQS = [
  { q: 'What is FriendPlace?', a: 'FriendPlace is a warm community app for making real, everyday friendships — local coffee catch-ups, hobby groups and community events. It is not a dating app.' },
  { q: 'Is it really free?', a: 'Yes. FriendPlace is free forever for members. We do not sell your data, and we do not run ads.' },
  { q: 'How is FriendPlace different from Facebook or Meetup?', a: "We're smaller, warmer and focused on real life. There are no likes, no infinite scroll, no algorithm optimising your engagement. Just gentle nudges toward genuine belonging." },
  { q: 'Is FriendPlace safe?', a: 'Every member is verified, and we have a real human moderation team. You can report or block anyone with one tap. Community guidelines are enforced firmly but kindly.' },
  { q: 'Who runs FriendPlace?', a: 'A small Australian team based in Melbourne, backed by Founding Members like you. We are member-supported, not investor-owned.' },
  { q: 'When will it be on the App Store?', a: 'Very soon. We are welcoming a first wave of Founding Members through TestFlight and Google Play early access while we finish the final polish.' },
  { q: 'What data do you collect?', a: 'The minimum to run the app safely: name, email, suburb, and what you post yourself. Full details in our Privacy Policy.' },
  { q: 'How do I become a Founding Member?', a: 'Sign up in the first weeks of launch. The first 250 members are recognised forever with a Founding Member badge.' },
];

export default async function FAQsPage() {
  const data = await cms.faqs();
  const items = data?.faqs && data.faqs.length > 0 ? data.faqs : DEFAULT_FAQS;

  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>FAQs</div>
          <h1 style={{ color: '#FFFFFF', maxWidth: 720, margin: '0 auto' }}>Answers to the questions we get most.</h1>
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
