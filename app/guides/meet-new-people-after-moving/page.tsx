import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to Meet New People When You Move to a New Area',
  description: 'Moved to a new suburb, town or city? Discover practical ways to meet new people, make local friends and start feeling part of your new community.',
  alternates: { canonical: '/guides/meet-new-people-after-moving' },
  openGraph: { title: 'How to Meet New People When You Move to a New Area', description: 'Practical ways to make local connections after moving.', url: '/guides/meet-new-people-after-moving', type: 'article' },
};

export default function Guide() {
  return <article style={{ background: '#FEFCF8', minHeight: '70vh' }}>
    <header style={{ background: '#0A2540', color: 'white', padding: '64px 24px' }}><div style={{ maxWidth: 800, margin: '0 auto' }}><Link href="/guides" style={{ color: '#5EEAD4', fontWeight: 800, textDecoration: 'none' }}>← FriendPlace Guides</Link><h1 style={{ fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>How to meet new people when you’ve moved to a new area</h1><p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>A new home can be exciting, but it can also leave you without the familiar faces and routines that made your old neighbourhood feel comfortable.</p></div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <h2 style={h2}>Become a regular somewhere</h2><p>Familiarity is one of the easiest starting points for connection. Visit the same café, walking route, dog park, library, market or community centre. A quick hello can become a conversation when people begin recognising each other.</p>
      <h2 style={h2}>Look beyond organised friendship events</h2><p>You can meet people through council activities, libraries, neighbourhood centres, community gardens, volunteering, sporting clubs, hobby groups and local events. The activity gives everyone a reason to be there, so conversation does not have to feel forced.</p>
      <h2 style={h2}>Say yes a little more often</h2><p>When you are new, small invitations matter. A neighbour mentioning a local market or someone suggesting coffee might seem minor, but accepting occasionally creates the repeated contact from which friendships grow.</p>
      <h2 style={h2}>Use your new location as an easy conversation starter</h2><p>Asking someone what they like about the area, where they get good coffee or what happens locally is natural and useful. People often enjoy sharing what they know, and one recommendation can lead to another conversation.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>You do not need to rush it.</strong><br/>Feeling at home in a new area happens gradually. Start by building familiarity with the place. Connections with people often follow.</aside>
      <p><Link href="/guides/find-local-social-groups-activities" style={link}>Next: Finding local groups and activities near you →</Link></p>
    </div>
  </article>;
}
const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
