export const metadata = {
  title: 'Delete Your Account | FriendPlace',
  description: 'How to request deletion of your FriendPlace account and associated data.',
};

export default function DeleteAccountPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '64px 0 48px' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12, fontWeight: 800, color: '#5EEAD4', marginBottom: 12 }}>
            Your privacy, your choice
          </div>
          <h1 style={{ color: '#FFFFFF' }}>Delete your FriendPlace account</h1>
          <p style={{ color: '#CBD5E1', marginTop: 12, fontSize: 17 }}>
            You can request deletion of your account and associated personal data at any time.
          </p>
        </div>
      </section>

      <section style={{ padding: '56px 0 80px', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <article style={{ background: '#FFFFFF', padding: '40px 32px', borderRadius: 20, border: '1px solid #E2E8F0', color: '#334155', fontSize: 16, lineHeight: 1.75 }}>
            <h2 style={{ color: '#0A2540', marginBottom: 12 }}>Delete your account in the app</h2>
            <p>Sign in to FriendPlace and go to <strong>Profile → Settings → Delete account</strong>. Follow the on-screen confirmation steps.</p>

            <h2 style={{ color: '#0A2540', marginTop: 32, marginBottom: 12 }}>Request deletion without the app</h2>
            <p>If you can’t access the app, email <a href="mailto:privacy@friendplace.com.au?subject=FriendPlace%20account%20deletion%20request" style={{ color: '#0F766E', fontWeight: 700 }}>privacy@friendplace.com.au</a> with the subject <strong>FriendPlace account deletion request</strong>.</p>
            <p>Please include the email address linked to your FriendPlace account so we can locate it. We may need to verify that the account belongs to you before acting on your request. <strong>Do not send your password.</strong></p>
            <p><a href="mailto:privacy@friendplace.com.au?subject=FriendPlace%20account%20deletion%20request" style={{ display: 'inline-block', marginTop: 8, padding: '12px 20px', borderRadius: 10, background: '#0A2540', color: '#FFFFFF', fontWeight: 700, textDecoration: 'none' }}>Email a deletion request</a></p>

            <h2 style={{ color: '#0A2540', marginTop: 32, marginBottom: 12 }}>What happens to your information?</h2>
            <p>Account deletion is intended to remove your member profile and associated personal data held by FriendPlace, including account details and content associated with your account, such as posts, uploaded photos and messages, subject to any necessary retention exceptions.</p>
            <p>Some information may need to be retained for legal compliance, security, fraud prevention or resolving disputes. We’ll explain any applicable exceptions when handling your request. Content already received or saved by other members may not be removable from their devices or records.</p>
            <p>Requests received by email are reviewed and processed after account ownership is verified. If you have questions about what will be deleted or retained, contact us using the same address.</p>

            <h2 style={{ color: '#0A2540', marginTop: 32, marginBottom: 12 }}>More information</h2>
            <p>Read our <a href="/privacy" style={{ color: '#0F766E', fontWeight: 700 }}>Privacy Policy</a> or email <a href="mailto:privacy@friendplace.com.au" style={{ color: '#0F766E', fontWeight: 700 }}>privacy@friendplace.com.au</a>.</p>
          </article>
        </div>
      </section>
    </>
  );
}
