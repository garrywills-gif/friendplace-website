import Link from 'next/link';
import { brandAssets } from '@/lib/brand-assets';

/**
 * The old registration-interest URL remains available for past emails,
 * bookmarks and tour links. Now that FriendPlace is live, visitors are
 * invited to download the app rather than create another CRM registration.
 * Original CRM member records and number-claiming workflows are untouched.
 */
export default function RegisterInterestPage() {
  const button: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '14px 24px', borderRadius: 14, background: '#0F766E',
    color: '#FFFFFF', fontSize: 16, fontWeight: 800, textDecoration: 'none',
    minWidth: 196,
  };
  return (
    <main style={{ background: '#FEFCF8', minHeight: '70vh', padding: '76px 22px 110px' }}>
      <section style={{
        maxWidth: 620, margin: '0 auto', background: '#FFFFFF',
        border: '1px solid #E7E2DA', borderRadius: 26,
        padding: '48px 32px', textAlign: 'center',
        boxShadow: '0 16px 50px rgba(10,37,64,0.05)',
      }}>
        <img src={brandAssets.butterfly.src} alt="" aria-hidden
          style={{ width: 68, height: 'auto', display: 'block', margin: '0 auto 22px' }} />
        <h1 style={{ color: '#0A2540', fontSize: 36, lineHeight: 1.2, margin: '0 0 14px', fontWeight: 900 }}>
          Your people are waiting.
        </h1>
        <p style={{ color: '#0A2540', fontSize: 21, fontWeight: 700, lineHeight: 1.5, margin: '0 0 12px' }}>
          FriendPlace is officially open!
        </p>
        <p style={{ color: '#475569', fontSize: 17, lineHeight: 1.7, margin: '0 auto 28px', maxWidth: 490 }}>
          Meet new people, share everyday Moments and discover a friendly community
          where you belong. It&rsquo;s free to join.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href="https://apps.apple.com/au/app/id6796969555"
            target="_blank" rel="noopener noreferrer" style={button}>
            Download for iPhone ↗
          </a>
          <a href="https://play.google.com/store/apps/details?id=au.com.friendplace.app"
            target="_blank" rel="noopener noreferrer" style={button}>
            Download for Android ↗
          </a>
        </div>
        <p style={{ color: '#64748B', margin: '28px auto 0', fontSize: 14, lineHeight: 1.65 }}>
          Already received your Founding Member or M-number?
          Keep it — use the email you originally registered with when joining the app.
        </p>
        <Link href="/meet" style={{ display: 'inline-block', marginTop: 20, color: '#0F766E', fontWeight: 700, fontSize: 14 }}>
          Want a look around first? Take George&rsquo;s tour →
        </Link>
      </section>
    </main>
  );
}
