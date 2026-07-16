import { site } from '@/lib/brand';

export const metadata = { title: 'Terms of Service' };

const EFFECTIVE = 'Effective 1 January 2026';

export default function TermsPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '64px 0 48px' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>Legal</div>
          <h1 style={{ color: '#FFFFFF' }}>Terms of Service</h1>
          <p style={{ color: '#94A3B8', marginTop: 12, fontSize: 14 }}>{EFFECTIVE}</p>
        </div>
      </section>

      <section style={{ padding: '64px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <TermsBody>
            <p><em>Plain English summary:</em> Be kind. Follow the community guidelines. If you break them, you might lose access. We can also close FriendPlace if we ever need to.</p>

            <h2>1. Agreement</h2>
            <p>By creating a FriendPlace account you agree to these Terms and our <a href="/privacy">Privacy Policy</a>. If you don’t agree, please don’t use FriendPlace.</p>

            <h2>2. Eligibility</h2>
            <p>You must be at least 18 years old and legally capable of entering an agreement in your country of residence.</p>

            <h2>3. Your account</h2>
            <p>You are responsible for your account, your posts, and keeping your login details safe. Use your real first name and a photo that’s clearly you.</p>

            <h2>4. Community guidelines</h2>
            <p>FriendPlace is a warm, welcoming community. You agree not to:</p>
            <ul>
              <li>Harass, bully, threaten or intimidate other members.</li>
              <li>Post hateful, discriminatory or explicit content.</li>
              <li>Use FriendPlace for dating or hookups (there are apps for that; this isn’t one).</li>
              <li>Spam, promote scams, or send unsolicited business messages.</li>
              <li>Impersonate anyone, or pretend to be someone you’re not.</li>
              <li>Break Australian law or facilitate anyone else doing so.</li>
            </ul>

            <h2>5. Content ownership</h2>
            <p>You own the content you post. By posting, you grant FriendPlace a non-exclusive, worldwide licence to display and store your content solely for the purpose of running the app. If you delete a post, we’ll remove it (backups may retain it briefly).</p>

            <h2>6. Moderation</h2>
            <p>We may review, remove, or restrict content that breaks our guidelines. We may suspend or terminate accounts that repeatedly break the rules. We try to be firm but fair, and we’ll always explain our reasoning if you appeal.</p>

            <h2>7. Fees</h2>
            <p>FriendPlace is free for members at launch. If we ever introduce paid features, they’ll be clearly optional and communicated in advance.</p>

            <h2>8. Disclaimers</h2>
            <p>FriendPlace is provided “as is”. Meeting anyone in person always carries some risk — please use common sense, meet in public places, and trust your instincts.</p>

            <h2>9. Liability</h2>
            <p>To the maximum extent permitted by Australian law, FriendPlace’s liability for any dispute is limited to (a) resupplying the service, or (b) refunding any fees paid in the previous 12 months. Nothing in these Terms excludes rights you have under the Australian Consumer Law.</p>

            <h2>10. Suspension &amp; deletion</h2>
            <p>You can delete your account any time from Settings. We may suspend accounts to investigate reports, and terminate accounts that break our Guidelines.</p>

            <h2>11. Changes to these Terms</h2>
            <p>We’ll notify existing members via in-app notice or email if we make material changes. Continued use after the effective date means you accept the updated Terms.</p>

            <h2>12. Governing law</h2>
            <p>These Terms are governed by the laws of Victoria, Australia. Any dispute will be handled by the courts of Victoria.</p>

            <h2>13. Contact</h2>
            <p>Questions or feedback: <a href={`mailto:${site.emailContact}`}>{site.emailContact}</a>.</p>
          </TermsBody>
        </div>
      </section>
    </>
  );
}

function TermsBody({ children }: { children: React.ReactNode }) {
  return (
    <article style={{
      background: '#FFFFFF', padding: '48px 40px', borderRadius: 20,
      border: '1px solid #E2E8F0',
      color: '#334155', fontSize: 16, lineHeight: 1.75,
    }}>
      <style>{`
        article h2 { font-size: 20px; margin: 32px 0 12px; color: #0A2540; }
        article h2:first-of-type { margin-top: 24px; }
        article ul { padding-left: 24px; margin: 12px 0; }
        article li { margin-bottom: 8px; }
        article a { color: #14B8A6; font-weight: 700; }
        article p { margin-bottom: 12px; }
      `}</style>
      {children}
    </article>
  );
}
