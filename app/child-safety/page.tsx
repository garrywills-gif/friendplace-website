export const metadata = {
  title: 'Child Safety Standards | FriendPlace',
  description: 'FriendPlace standards prohibiting child sexual abuse and exploitation, and information on reporting safety concerns.',
};

export default function ChildSafetyPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '52px 0 40px' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 12, fontWeight: 700, color: '#5EEAD4', marginBottom: 10 }}>Policies</div>
          <h1 style={{ color: '#FFFFFF' }}>Child Safety Standards</h1>
          <p style={{ color: '#CBD5E1', marginTop: 12 }}>FriendPlace · Because you belong too.</p>
        </div>
      </section>

      <section style={{ background: '#FEFCF8', padding: '48px 0 72px' }}>
        <div className="container" style={{ maxWidth: 820 }}>
          <article style={{ color: '#334155', fontSize: 16, lineHeight: 1.75 }}>
            <p>FriendPlace is an Australian friendship and community platform for adults aged 18 and over. Protecting people from abuse and exploitation is part of our community standards.</p>

            <h2 style={{ color: '#0A2540', marginTop: 28 }}>Our standards</h2>
            <p>FriendPlace prohibits child sexual abuse and exploitation (CSAE), including child sexual abuse material (CSAM), grooming, sexual solicitation of minors, and any content or conduct that facilitates or promotes harm to children. Such behaviour is not permitted on FriendPlace, regardless of whether an account claims to belong to an adult.</p>
            <p>FriendPlace is for adults aged 18 and over. People under 18 must not register for or use the service.</p>

            <h2 style={{ color: '#0A2540', marginTop: 28 }}>Report a concern</h2>
            <p>Members can use the reporting tools available in FriendPlace to flag concerning content or behaviour. Anyone, including someone who cannot access the app, can report a child safety concern by emailing <a href="mailto:privacy@friendplace.com.au?subject=Child%20safety%20report" style={{ color: '#0F766E', fontWeight: 700 }}>privacy@friendplace.com.au</a>.</p>
            <p>When reporting, provide the relevant account or content details and a description of the concern. Do not send or forward suspected child sexual abuse material as an email attachment.</p>

            <h2 style={{ color: '#0A2540', marginTop: 28 }}>How concerns are handled</h2>
            <p>FriendPlace reviews reports of suspected CSAE and may remove content, restrict or terminate accounts, preserve information where legally required, and escalate matters to relevant law enforcement or child protection authorities as appropriate. Reports involving immediate danger should be made directly to emergency services.</p>
            <p>In Australia, call <strong>000</strong> if a child is in immediate danger. Suspected online child exploitation can also be reported to the <a href="https://www.accce.gov.au/report" style={{ color: '#0F766E' }}>Australian Centre to Counter Child Exploitation (ACCCE)</a>.</p>

            <h2 style={{ color: '#0A2540', marginTop: 28 }}>Contact</h2>
            <p>For questions about FriendPlace's child safety standards or to report a concern, contact <a href="mailto:privacy@friendplace.com.au" style={{ color: '#0F766E' }}>privacy@friendplace.com.au</a>.</p>
            <p>For more information, please also see our <a href="/terms" style={{ color: '#0F766E' }}>Terms of Service</a> and <a href="/privacy" style={{ color: '#0F766E' }}>Privacy Policy</a>.</p>
          </article>
        </div>
      </section>
    </>
  );
}
