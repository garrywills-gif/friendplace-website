import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import InviteEmailStep from './InviteEmailStep';

type Props = { params: { code: string } };

export const metadata: Metadata = {
  title: 'Your FriendPlace invitation',
  description: 'Someone has invited you to join FriendPlace. Download the free app to get started.',
  robots: { index: false, follow: false },
};

export default function InviteDownloadPage({ params }: Props) {
  const code = params.code || '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(code)) notFound();

  return (
    <main style={{ minHeight: '100vh', background: '#FEFCF8', color: '#102A4E', padding: '72px 20px' }}>
      <section style={{
        maxWidth: 620, margin: '0 auto', padding: '40px 28px',
        background: '#FFF', borderRadius: 26, border: '1px solid #DFE8EE',
        boxShadow: '0 12px 42px rgba(16,42,78,.07)', textAlign: 'center',
      }}>
        <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 12 }}>🦋</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 40px)', lineHeight: 1.15, margin: '0 0 16px' }}>
          You've been invited to FriendPlace!
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: '#485D75', margin: 0 }}>
          A friendly community to meet people, share conversations and make new friends.
          Because you belong, too.
        </p>
        <InviteEmailStep code={code} />
        <p style={{ margin: '28px 0 0', fontSize: 14 }}>
          Want to learn more first? <Link href="/" style={{ color: '#116E87', fontWeight: 700 }}>Explore FriendPlace</Link>
        </p>
      </section>
    </main>
  );
}
