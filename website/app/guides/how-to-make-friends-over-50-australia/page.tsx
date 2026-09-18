import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How Do I Make Friends Over 50 in Australia?',
  description: 'Practical ways to make new friends after 50 in Australia, meet people locally and build genuine friendships without dating apps or awkward pressure.',
  alternates: { canonical: '/guides/how-to-make-friends-over-50-australia' },
  openGraph: {
    title: 'How Do I Make Friends Over 50 in Australia?',
    description: 'Simple, low-pressure ways to meet people and build genuine friendships after 50.',
    url: '/guides/how-to-make-friends-over-50-australia',
    type: 'article',
  },
};

const faq = [
  { q: 'Is it normal to find it harder to make friends after 50?', a: 'Yes. Work, family changes, retirement, moving and changing routines can all reduce the number of new people we naturally meet. Making friends after 50 often works best through repeated, low-pressure contact.' },
  { q: 'Where can I meet new people over 50?', a: 'Try recurring local activities such as walking groups, book clubs, volunteering, community centres, libraries, RSL or community clubs, hobby groups, classes and local events.' },
  { q: 'Do I need to use a dating app to meet people?', a: 'No. If friendship is your goal, look for friendship-focused communities and local activities where shared interests give you a natural reason to talk.' },
];

export default function Guide() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How do I make friends over 50 in Australia?',
    description: metadata.description,
    author: { '@type': 'Organization', name: 'FriendPlace' },
    publisher: { '@type': 'Organization', name: 'FriendPlace', url: 'https://friendplace.com.au' },
    mainEntityOfPage: 'https://friendplace.com.au/guides/how-to-make-friends-over-50-australia',
  };
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  };

  return <article style={{ background: '#FEFCF8', minHeight: '70vh' }}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    <header style={{ background: '#0A2540', color: 'white', padding: '64px 24px' }}><div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Link href="/guides" style={{ color: '#5EEAD4', fontWeight: 800, textDecoration: 'none' }}>← FriendPlace Guides</Link>
      <h1 style={{ color: '#FFFFFF', fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>How do I make friends over 50 in Australia?</h1>
      <p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>Start somewhere you can see the same people regularly, choose activities you genuinely enjoy, and give new connections time to grow.</p>
    </div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <p><strong>The short answer:</strong> making friends after 50 is usually less about meeting lots of strangers and more about creating regular opportunities to see the same people. Familiarity makes conversation easier, and repeated contact gives friendship somewhere to grow.</p>
      <h2 style={h2}>Go where conversation can happen naturally</h2><p>Walking groups, community classes, volunteering, book clubs, gardening groups, social sport, local clubs and regular coffee catch-ups all give you something to talk about before you know each other well.</p>
      <h2 style={h2}>Choose recurring activities</h2><p>A weekly or monthly activity is often better for friendship than a one-off event. Seeing familiar faces removes some of the pressure of starting from scratch every time.</p>
      <h2 style={h2}>Take one small next step</h2><p>If you enjoy talking with someone, suggest another coffee, ask whether they are coming next week, or mention another activity you both might enjoy. Most friendships grow through ordinary little invitations.</p>
      <h2 style={h2}>Look locally</h2><p>Search by suburb, town or council area. Libraries, neighbourhood centres, community clubs, Men’s Sheds, U3A groups, volunteering organisations and local events can all be useful starting points.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>Friendship, not dating.</strong><br/>FriendPlace is being built for adults who want genuine friendship and local connection — without swiping or dating pressure.</aside>
      <h2 style={h2}>Frequently asked questions</h2>
      {faq.map(item => <section key={item.q}><h3 style={h3}>{item.q}</h3><p>{item.a}</p></section>)}
      <p><Link href="/guides/how-to-make-friends-after-retirement" style={link}>Next: How to make friends after retirement →</Link></p>
    </div>
  </article>;
}

const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const h3 = { color: '#0A2540', fontSize: 21, lineHeight: 1.35, marginTop: 28 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
