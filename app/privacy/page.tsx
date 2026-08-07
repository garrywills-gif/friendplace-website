import { site } from '@/lib/brand';

export const metadata = { title: 'Privacy Policy' };

// Effective date is updated in the CMS. Falls back to the launch date.
const EFFECTIVE = 'Effective 1 January 2026';

export default function PrivacyPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '64px 0 48px' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>Legal</div>
          <h1 style={{ color: '#FFFFFF' }}>Privacy Policy</h1>
          <p style={{ color: '#94A3B8', marginTop: 12, fontSize: 14 }}>{EFFECTIVE}</p>
        </div>
      </section>

      <section style={{ padding: '64px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <Policy>
            <p><em>Plain English summary:</em> We collect only the minimum we need to run FriendPlace safely. We do not sell your data. You can delete your account and data any time.</p>

            <h2>1. Who we are</h2>
            <p>FriendPlace is operated from New South Wales, Australia. If you have a privacy question you can reach us at <a href={`mailto:${site.emailContact}`}>{site.emailContact}</a>.</p>

            <h2>2. What we collect</h2>
            <ul>
              <li><strong>Account data:</strong> your first name, email address, and (optionally) suburb.</li>
              <li><strong>Profile data:</strong> avatar or emoji you choose, interests, bio you write yourself.</li>
              <li><strong>Content:</strong> messages, thoughts, event RSVPs, and photos you post.</li>
              <li><strong>Technical data:</strong> device type, app version, and error logs — needed to keep the app stable.</li>
              <li><strong>Location:</strong> approximate location (suburb-level only) if you enable Find Friends.</li>
            </ul>

            <h2>3. What we do not collect</h2>
            <ul>
              <li>We do not track you across other apps or websites.</li>
              <li>We do not use behavioural advertising SDKs.</li>
              <li>We do not access your contacts or camera roll unless you upload a photo yourself.</li>
            </ul>

            <h2>4. How we use your data</h2>
            <p>Only for the things you would expect: authenticating you, showing you people and events nearby, sending you app notifications (which you can turn off), and keeping the app safe from abuse.</p>

            <h2>5. Who we share data with</h2>
            <p>Other members see what you post publicly on your profile, in the FP Café, or at events. That is the point. Beyond that:</p>
            <ul>
              <li><strong>Service providers:</strong> our hosting (MongoDB Atlas), email delivery (Resend), and analytics-free error tracking. All operate under strict data-processing agreements.</li>
              <li><strong>Legal:</strong> If we receive a valid Australian legal request, we may disclose data as required by law.</li>
              <li><strong>We never sell your data.</strong></li>
            </ul>

            <h2>6. Where your data is stored</h2>
            <p>Data is stored in Australian data centres where possible. Some processing may occur in other jurisdictions for standard cloud services, always under equivalent protection.</p>

            <h2>7. Your rights</h2>
            <p>You can, at any time:</p>
            <ul>
              <li>See what data we hold about you (in-app: Profile → Settings → Export data).</li>
              <li>Correct anything inaccurate.</li>
              <li>Delete your account and data (in-app: Settings → Delete account).</li>
              <li>Object to any processing.</li>
            </ul>
            <p>Australian users have rights under the Privacy Act 1988 (Cth). You may also complain to the Office of the Australian Information Commissioner (OAIC).</p>

            <h2>8. Children</h2>
            <p>FriendPlace is for adults aged 18 and over. We do not knowingly collect data from anyone under 18.</p>

            <h2>9. Cookies (this website only)</h2>
            <p>This website uses only technical cookies necessary for the site to function. No advertising or third-party tracking cookies.</p>

            <h2>10. Changes to this policy</h2>
            <p>We’ll update this page and let existing members know via in-app notice or email if we make material changes.</p>

            <h2>11. Contact</h2>
            <p>Any questions or requests: <a href={`mailto:${site.emailContact}`}>{site.emailContact}</a>.</p>
          </Policy>
        </div>
      </section>
    </>
  );
}

function Policy({ children }: { children: React.ReactNode }) {
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
