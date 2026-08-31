import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How Do I Make Friends After Retirement?',
  description: 'Practical ideas for making new friends after retirement in Australia, rebuilding your social circle and finding local groups, activities and connection.',
  alternates: { canonical: '/guides/how-to-make-friends-after-retirement' },
  openGraph: {
    title: 'How Do I Make Friends After Retirement?',
    description: 'Low-pressure ways to rebuild your social circle and meet new people after retirement.',
    url: '/guides/how-to-make-friends-after-retirement',
    type: 'article',
  },
};

const faq = [
  { q: 'Why can retirement feel socially different?', a: 'Work provides routine and repeated contact with other people. When that disappears, many people realise how much of their social life was built into the working week.' },
  { q: 'What are good ways to meet people after retirement?', a: 'Recurring local activities are often best: walking groups, volunteering, U3A, hobby clubs, community centres, libraries, Men’s Sheds, gardening groups and social clubs.' },
  { q: 'How long does it take to make a new friend?', a: 'There is no fixed timeline. Friendship usually develops through repeated contact, small conversations and shared experiences rather than one big meeting.' },
];

export default function Guide() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How do I make friends after retirement?',
    description: metadata.description,
    author: { '@type': 'Organization', name: 'FriendPlace' },
    publisher: { '@type': 'Organization', name: 'FriendPlace', url: 'https://friendplace.com.au' },
    mainEntityOfPage: 'https://friendplace.com.au/guides/how-to-make-friends-after-retirement',
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
      <h1 style={{ color: '#FFFFFF', fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>How do I make friends after retirement?</h1>
      <p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>Retirement changes your routine. Building a new social rhythm can make it easier to meet people and create genuine friendships.</p>
    </div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <p><strong>The short answer:</strong> replace some of the regular contact that work used to provide. Pick one or two local activities you can attend consistently, choose things you actually enjoy, and let familiarity do some of the work.</p>
      <h2 style={h2}>Build a new weekly rhythm</h2><p>Retirement can remove the automatic structure of a working week. A regular walk, class, volunteer shift, club meeting or coffee catch-up creates places where the same people can get to know each other over time.</p>
      <h2 style={h2}>Use interests as the starting point</h2><p>Conversation is easier when there is already something in common. Gardening, books, travel, classic cars, cooking, crafts, golf, walking, community projects and volunteering can all make introductions feel natural.</p>
      <h2 style={h2}>Try local organisations</h2><p>Libraries, councils, neighbourhood centres, RSL and community clubs, U3A, Probus, Men’s Sheds, volunteering organisations and hobby groups often have recurring activities designed around shared interests.</p>
      <h2 style={h2}>Do not judge the first visit too quickly</h2><p>A group can feel unfamiliar the first time. If it seems reasonably comfortable, try it again. Recognition often starts on the second or third visit, and that is when conversation becomes easier.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>One good connection is enough to start.</strong><br/>You do not need a huge new social circle. One person you enjoy seeing can lead to another invitation, another activity and a much wider sense of connection.</aside>
      <h2 style={h2}>Frequently asked questions</h2>
      {faq.map(item => <section key={item.q}><h3 style={h3}>{item.q}</h3><p>{item.a}</p></section>)}
      <p><Link href="/guides/where-can-i-meet-people-near-me" style={link}>Next: Where can I meet people near me? →</Link></p>
    </div>
  </article>;
}

const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const h3 = { color: '#0A2540', fontSize: 21, lineHeight: 1.35, marginTop: 28 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
