import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const APPLE_STORE = 'https://apps.apple.com/au/app/id6796969555';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=au.com.friendplace.app';

type Props = { params: { code: string } };

export function generateMetadata({ params }: Props): Metadata {
  return {
    title: 'Your FriendPlace invitation',
    description: 'Someone has invited you to join FriendPlace. Download the free app to get started.',
    robots: { index: false, follow: false },
  };
}

export default function InviteDownloadPage({ params }: Props) {
  const code = decodeURIComponent(params.code || '').trim();
  // Referrals use opaque invitation identifiers; never interpret them as
  // paths, inject them into store URLs, or expose them to external sites.
  if (!code || code.length > 128 || !/^[A-Za-z0-9_-]+$/.test(code)) notFound();

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
        <p style={{ fontSize: 18, lineHeight: 1.6, color: '#485D75', margin: '0 0 28px' }}>
          A friendly community to meet people, share conversations and make new friends.
          Because you belong, too.
        </p>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Get the free FriendPlace app</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <a href={APPLE_STORE} rel="noopener noreferrer" style={buttonStyle}>Download for iPhone or iPad</a>
          <a href={GOOGLE_PLAY} rel="noopener noreferrer" style={buttonStyle}>Get it on Google Play</a>
        </div>
        <div style={{ background: '#EDF6FF', borderRadius: 16, padding: 18, marginTop: 32, textAlign: 'left' }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Your invitation reference</p>
          <p style={{ margin: 0, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: 14 }}>{code}</p>
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: '#50637A' }}>
            Keep this invitation link handy. Your reference stays in the link so it can be checked
            when referral linking is confirmed. Installing from an app store alone does not
            automatically transfer the reference into the app.
          </p>
        </div>
        <p style={{ margin: '28px 0 0', fontSize: 14 }}>
          Want to learn more first? <Link href="/" style={{ color: '#116E87', fontWeight: 700 }}>Explore FriendPlace</Link>
        </p>
      </section>
    </main>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-block', padding: '15px 20px', borderRadius: 12,
  background: '#122F65', color: '#FFF', fontWeight: 700,
  fontSize: 15, textDecoration: 'none',
};
