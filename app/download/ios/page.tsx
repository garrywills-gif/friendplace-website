import Link from 'next/link';

export const metadata = {
  title: 'FriendPlace for iPhone | Download',
  description: 'The official FriendPlace iPhone download link. Because you belong too.',
};

export default function IOSDownloadPage() {
  return (
    <main style={{ minHeight: '70vh', background: '#FEFCF8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' }}>
      <div style={{ maxWidth: 520 }}>
        <img src="/brand-assets/butterfly.png" alt="FriendPlace" width={86} height={84} style={{ width: 86, height: 'auto' }} />
        <h1 style={{ color: '#0A2540', fontSize: 32, marginTop: 20 }}>FriendPlace for iPhone</h1>
        <p style={{ color: '#475569', fontSize: 18, lineHeight: 1.7 }}>
          Apple has approved FriendPlace and its public App Store listing is becoming available.
          This is our permanent iPhone download link — we'll connect it directly to the App Store when the listing is confirmed.
        </p>
        <p style={{ color: '#64748B', fontSize: 15 }}>Because you belong too. 🦋</p>
        <Link href="/" style={{ display: 'inline-block', marginTop: 14, padding: '14px 24px', background: '#0F766E', color: '#FFFFFF', borderRadius: 12, textDecoration: 'none', fontWeight: 800 }}>Back to FriendPlace</Link>
      </div>
    </main>
  );
}
