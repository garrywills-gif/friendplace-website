import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Where Can I Meet People Near Me in Australia?',
  description: 'Find practical places to meet people near you in Australia, from walking groups and libraries to clubs, volunteering, community activities and local events.',
  alternates: { canonical: '/guides/where-can-i-meet-people-near-me' },
  openGraph: {
    title: 'Where Can I Meet People Near Me in Australia?',
    description: 'Practical places and low-pressure ways to meet people locally in Australia.',
    url: '/guides/where-can-i-meet-people-near-me',
    type: 'article',
  },
};

const faq = [
  { q: 'Where should I start if I want to meet people near me?', a: 'Start with your suburb or local council area and look for recurring activities at libraries, community centres, clubs, walking groups, volunteer organisations and local events.' },
  { q: 'What if I do not like organised social groups?', a: 'Choose an activity you would enjoy anyway, such as walking, gardening, books, pets, crafts, cars, volunteering or a regular café. Shared activity makes conversation less forced.' },
  { q: 'Is it better to attend one-off events or regular groups?', a: 'One-off events can be useful, but recurring activities usually give friendships a better chance to develop because you see the same people more than once.' },
];

export default function Guide() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Where can I meet people near me in Australia?',
    description: metadata.description,
    author: { '@type': 'Organization', name: 'FriendPlace' },
    publisher: { '@type': 'Organization', name: 'FriendPlace', url: 'https://friendplace.com.au' },
    mainEntityOfPage: 'https://friendplace.com.au/guides/where-can-i-meet-people-near-me',
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
      <h1 style={{ color: '#FFFFFF', fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>Where can I meet people near me in Australia?</h1>
      <p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>Look close to home, choose something you genuinely enjoy, and favour places where you can become a familiar face.</p>
    </div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <p><strong>The short answer:</strong> the best places to meet people nearby are usually recurring local activities rather than one-off “friendship” events. Search your suburb or council area for places where people naturally gather around a shared interest.</p>
      <h2 style={h2}>Libraries and community centres</h2><p>Libraries and neighbourhood centres often run book clubs, talks, classes, craft sessions, technology help, community lunches and other activities. They are usually low-pressure and designed to be welcoming.</p>
      <h2 style={h2}>Walking groups and outdoor activities</h2><p>Walking groups, bushwalking clubs, community gardens and local park activities make conversation easier because you are doing something together rather than sitting across from a stranger trying to think of what to say.</p>
      <h2 style={h2}>Clubs, hobbies and volunteering</h2><p>RSL and community clubs, sporting clubs, Men’s Sheds, U3A, Probus, hobby groups and volunteering organisations can create regular contact with people who already share one of your interests.</p>
      <h2 style={h2}>Local events and everyday community activity</h2><p>Markets, fetes, garage sales, workshops, community notices, coffee catch-ups and local events can all be useful ways to discover what is happening around you and where people with similar interests spend their time.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>Keep the radius small at first.</strong><br/>A friendship is easier to maintain when meeting for a coffee or walk does not require travelling across an entire city. Starting local makes spontaneous connection much easier.</aside>
      <h2 style={h2}>Frequently asked questions</h2>
      {faq.map(item => <section key={item.q}><h3 style={h3}>{item.q}</h3><p>{item.a}</p></section>)}
      <p><Link href="/guides/making-friends-as-an-adult-australia" style={link}>More: Making friends as an adult in Australia →</Link></p>
    </div>
  </article>;
}

const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const h3 = { color: '#0A2540', fontSize: 21, lineHeight: 1.35, marginTop: 28 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
