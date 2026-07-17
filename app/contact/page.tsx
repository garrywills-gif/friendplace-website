import ContactForm from '@/components/ContactForm';
import { site } from '@/lib/brand';

export const metadata = { title: 'Contact Us' };

export default function ContactPage() {
  return (
    <>
      <section style={{ background: '#0A2540', color: '#FFFFFF', padding: '80px 0 72px', textAlign: 'center' }}>
        <div className="container">
          <div style={{
            textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: 12,
            fontWeight: 800, color: '#5EEAD4', marginBottom: 12,
          }}>Contact us</div>
          <h1 style={{ color: '#FFFFFF', maxWidth: 720, margin: '0 auto' }}>
            Say hello. We’d love to hear from you.
          </h1>
        </div>
      </section>

      <section style={{ padding: '80px 0', background: '#FEFCF8' }}>
        <div className="container" style={{ maxWidth: 900 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr', gap: 48,
          }} className="contact-grid">
            <div>
              <h2 style={{ fontSize: 24, marginBottom: 16 }}>We reply to every message.</h2>
              <p style={{ fontSize: 17, color: '#475569', lineHeight: 1.7, marginBottom: 24 }}>
                Questions, feedback, press, partnership ideas, or just a hello — you’re very welcome. We aim to reply within one or two business days.
              </p>
              <div style={{ background: '#FFFFFF', padding: 24, borderRadius: 16, border: '1px solid #E2E8F0' }}>
                <h3 style={{ fontSize: 15, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#14B8A6' }}>Direct contact</h3>
                <p style={{ fontSize: 15, color: '#475569', marginBottom: 8 }}>📧 <a href={`mailto:${site.emailContact}`} style={{ color: '#0A2540', fontWeight: 700 }}>{site.emailContact}</a></p>
                <p style={{ fontSize: 15, color: '#475569' }}>🇦🇺 Based in New South Wales, Australia</p>
              </div>
            </div>
            <div>
              <ContactForm />
            </div>
          </div>
        </div>
        <style>{`
          @media (min-width: 900px) {
            .contact-grid { grid-template-columns: 1fr 1.3fr !important; }
          }
        `}</style>
      </section>
    </>
  );
}
