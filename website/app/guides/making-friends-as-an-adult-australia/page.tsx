import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Making Friends as an Adult in Australia',
  description: 'Practical, low-pressure ways to make friends as an adult in Australia, meet new people locally and build genuine friendships over time.',
  alternates: { canonical: '/guides/making-friends-as-an-adult-australia' },
  openGraph: { title: 'Making Friends as an Adult in Australia', description: 'Practical ways to meet people and build genuine adult friendships in Australia.', url: '/guides/making-friends-as-an-adult-australia', type: 'article' },
};

export default function Guide() {
  return <Article title="Making friends as an adult in Australia" intro="Making friends as an adult can be surprisingly difficult. Work changes, families get busy, people move and the easy social circles we once had can become smaller. The good news is that friendship still grows the same way it always has: regular contact, shared experiences and small moments of trust." />;
}

function Article({ title, intro }: { title: string; intro: string }) {
  return <article style={{ background: '#FEFCF8', minHeight: '70vh' }}>
    <header style={{ background: '#0A2540', color: 'white', padding: '64px 24px' }}><div style={{ maxWidth: 800, margin: '0 auto' }}><Link href="/guides" style={{ color: '#5EEAD4', fontWeight: 800, textDecoration: 'none' }}>← FriendPlace Guides</Link><h1 style={{ color: '#FFFFFF', fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.08, letterSpacing: '-.035em', margin: '20px 0 16px' }}>{title}</h1><p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', margin: 0 }}>{intro}</p></div></header>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '52px 24px 80px', color: '#263746', fontSize: 18, lineHeight: 1.8 }}>
      <h2 style={h2}>Start with repeated, low-pressure contact</h2><p>You do not need to walk into a room and instantly find a best friend. Friendship is much more likely to grow when you see the same people regularly. A walking group, community class, local club, volunteering, social sport or a regular coffee catch-up gives conversation a chance to become familiarity.</p>
      <h2 style={h2}>Choose something you actually enjoy</h2><p>Shared interests remove much of the pressure from meeting someone new. Instead of wondering what to talk about, you already have something in common. Gardening, books, cooking, pets, cars, crafts, bushwalking and community events can all create natural reasons to start talking.</p>
      <h2 style={h2}>Make the small move</h2><p>Often both people are waiting for the other person to take the next step. Try something simple: suggest another coffee, ask whether they are coming next week, or say you enjoyed the conversation. Friendship usually grows through small invitations rather than grand gestures.</p>
      <h2 style={h2}>Give it time</h2><p>Not every conversation will become a friendship, and that is completely normal. The aim is not to collect dozens of friends. A few people you enjoy seeing — and who are pleased to see you — can make an enormous difference to how connected life feels.</p>
      <aside style={callout}><strong style={{ color: '#0A2540' }}>The FriendPlace idea</strong><br/>FriendPlace is being built to make these first steps easier: helping adults discover people, groups, events and everyday community activity nearby, with friendship rather than dating at the centre.</aside>
      <p><Link href="/guides/meet-new-people-after-moving" style={link}>Next: Meeting people after moving to a new area →</Link></p>
    </div>
  </article>;
}
const h2 = { color: '#0A2540', fontSize: 28, lineHeight: 1.25, marginTop: 40 } as const;
const callout = { background: '#ECFDF9', border: '1px solid #99E6D9', borderRadius: 18, padding: 24, margin: '40px 0' } as const;
const link = { color: '#0F766E', fontWeight: 800, textDecoration: 'none' } as const;
