import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to Find Local Social Groups and Activities Near You',
  description: 'Learn how to find local social groups, community activities, clubs and events near you in Australia and choose the right places to meet people.',
  alternates: { canonical: '/guides/find-local-social-groups-activities' },
  openGraph: { title: 'How to Find Local Social Groups and Activities Near You', description: 'Ways to discover local groups, activities and community events in Australia.', url: '/guides/find-local-social-groups-activities', type: 'article' },
};

export default function Guide() {
  return <article style={{ background: '#FEFCF8', minHeight: '70vh' }}>
    <header style={{ background: '#0A2540', color: 'white', padding: '64px 24px' }}><div style={{ maxWidth: 800, margin: '0 auto' }}><Link href="/guides" style={{ color: '#5EEAD4', fontWeight: 800, textDecoration: 'none' }}>← FriendPlace Guides</Link><h1 style={{ fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>How to find local social groups and activities near you</h1><p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>Finding somewhere to go is often the easiest first step toward finding someone to know.</p></div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <h2 style={h2}>Start close to home</h2><p>Search your suburb or local council area rather than looking across an entire city. Libraries, community centres, councils, neighbourhood houses, RSL and community clubs, sporting organisations and volunteer groups often run activities that are easy to overlook.</p>
      <h2 style={h2}>Search by interest, not just “make friends”</h2><p>If a friendship event sounds uncomfortable, look for something you would enjoy anyway. Try searches for local walking groups, book clubs, gardening groups, cooking classes, craft groups, social sport, classic cars, community gardens or volunteering. Shared interests make introductions much easier.</p>
      <h2 style={h2}>Choose recurring activities</h2><p>A one-off event can be fun, but a weekly or monthly activity gives relationships time to develop. Seeing the same people repeatedly is one of the strongest ingredients in turning strangers into familiar faces.</p>
      <h2 style={h2}>Try more than one thing</h2><p>The first group may not be your group. That does not mean local activities are not for you. Different groups have different personalities, ages and rhythms. Give yourself permission to try another until somewhere feels comfortable.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>What FriendPlace is working toward</strong><br/>FriendPlace brings local people, groups, events and everyday community activity together in one place, so finding something nearby — and someone to enjoy it with — can be simpler.</aside>
      <p><Link href="/guides" style={link}>← Explore all FriendPlace Guides</Link></p>
    </div>
  </article>;
}
const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
