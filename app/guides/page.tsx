import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FriendPlace Guides | Friendship & Community in Australia',
  description: 'Practical Australian guides for making friends as an adult, meeting people after moving, and finding local social groups and activities near you.',
  alternates: { canonical: '/guides' },
  openGraph: {
    title: 'FriendPlace Guides | Friendship & Community in Australia',
    description: 'Friendly, practical guides to help adults build real local connections in Australia.',
    url: '/guides',
    type: 'website',
  },
};

const guides = [
  {
    href: '/guides/how-to-make-friends-over-50-australia',
    title: 'How do I make friends over 50 in Australia?',
    description: 'Practical, low-pressure ways to meet new people, build genuine friendships and find local connection after 50.',
  },
  {
    href: '/guides/how-to-make-friends-after-retirement',
    title: 'How do I make friends after retirement?',
    description: 'Ways to rebuild your social rhythm, meet people locally and create new friendships after leaving work.',
  },
  {
    href: '/guides/where-can-i-meet-people-near-me',
    title: 'Where can I meet people near me in Australia?',
    description: 'Where to find walking groups, clubs, volunteering, community activities and other low-pressure ways to meet people nearby.',
  },
  {
    href: '/guides/making-friends-as-an-adult-australia',
    title: 'Making friends as an adult in Australia',
    description: 'Why adult friendship can feel harder — and practical, low-pressure ways to meet people and build genuine connections.',
  },
  {
    href: '/guides/meet-new-people-after-moving',
    title: 'How to meet new people when you’ve moved to a new area',
    description: 'Simple ways to turn an unfamiliar suburb or town into somewhere that starts to feel like home.',
  },
  {
    href: '/guides/find-local-social-groups-activities',
    title: 'How to find local social groups and activities near you',
    description: 'Where to look, what to try and how to choose activities that make meeting local people feel natural.',
  },
];

export default function GuidesPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: 'white', padding: '72px 24px 64px', textAlign: 'center' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ color: '#5EEAD4', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 13, marginBottom: 14 }}>FriendPlace Guides</div>
          <h1 style={{ fontSize: 'clamp(36px, 6vw, 58px)', lineHeight: 1.05, margin: '0 0 20px', letterSpacing: '-.035em' }}>A little help finding your people</h1>
          <p style={{ fontSize: 19, lineHeight: 1.65, color: '#D7E2EC', maxWidth: 680, margin: '0 auto' }}>Friendly, practical ideas for making new connections, finding local activities and feeling more at home in your community.</p>
        </div>
      </section>

      <section style={{ padding: '64px 24px 88px', background: '#FEFCF8' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {guides.map((guide) => (
              <Link key={guide.href} href={guide.href} style={{ display: 'flex', flexDirection: 'column', padding: 28, borderRadius: 20, background: '#fff', border: '1px solid #E5E9EF', boxShadow: '0 8px 28px rgba(15, 23, 42, .06)', textDecoration: 'none', color: '#0A2540' }}>
                <span style={{ color: '#0F766E', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Guide</span>
                <h2 style={{ fontSize: 23, lineHeight: 1.25, margin: '0 0 12px', letterSpacing: '-.02em' }}>{guide.title}</h2>
                <p style={{ color: '#526170', lineHeight: 1.65, margin: '0 0 22px', flex: 1 }}>{guide.description}</p>
                <span style={{ color: '#0F766E', fontWeight: 800 }}>Read guide →</span>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: 48, textAlign: 'center', color: '#526170', lineHeight: 1.7 }}>
            <p>FriendPlace is about making local connection feel easier — without pressure, awkwardness or pretending to be someone you’re not.</p>
            <Link href="/how-it-works" style={{ color: '#0F766E', fontWeight: 800 }}>See how FriendPlace works →</Link>
          </div>
        </div>
      </section>
    </>
  );
}
