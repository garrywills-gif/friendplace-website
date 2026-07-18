'use client';

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; ref: string }
  | { kind: 'error'; message: string };

/**
 * The `/list-your-event` submission form.
 *
 * Sections (top→bottom):
 *   1. Organisation & contact register
 *   2. Event details (title, when, where, description)
 *   3. Attendance & inclusion (capacity, cost, accessibility)
 *   4. Cover image (optional, base64 in JSON — capped so we don't blow
 *      up the server-side payload limit on 20 MB phone photos)
 *   5. Review agreement + submit
 *
 * Post-submit the form is replaced with a warm confirmation card that
 * echoes the submission reference (`FP-SUB-XXXXXX`).
 */
export default function ListYourEventForm() {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [eventTitle, setEventTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');   // "YYYY-MM-DDTHH:mm"
  const [endsAt, setEndsAt] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [description, setDescription] = useState('');

  const [capacity, setCapacity] = useState('');
  const [costType, setCostType] = useState<'free' | 'paid'>('free');
  const [costDisplay, setCostDisplay] = useState('');
  const [accessibility, setAccessibility] = useState('');

  const [coverB64, setCoverB64] = useState<string>('');
  const [coverError, setCoverError] = useState<string>('');

  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const canSubmit =
    orgName.trim().length >= 2 &&
    contactName.trim().length >= 2 &&
    emailValid &&
    eventTitle.trim().length >= 2 &&
    startsAt.length > 0 &&
    agreed &&
    state.kind !== 'submitting';

  const onCoverPicked = (file: File | null) => {
    setCoverError('');
    if (!file) { setCoverB64(''); return; }
    // 4 MB cap — plenty for a hero image, and stops phone-sized JPEGs
    // from choking the JSON payload / MongoDB doc size limit.
    if (file.size > 4 * 1024 * 1024) {
      setCoverError('Please choose an image under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCoverB64(String(reader.result || ''));
    reader.onerror = () => setCoverError('Could not read that image — please try another.');
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ kind: 'submitting' });
    try {
      // Convert `datetime-local` to an ISO string that FastAPI will
      // happily accept.  We intentionally don't append a timezone —
      // Mission Control will confirm timezone at approval time.
      const asIso = (s: string) => (s ? new Date(s).toISOString() : '');
      const payload = {
        organisation_name: orgName.trim(),
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim().toLowerCase(),
        contact_phone: contactPhone.trim() || undefined,
        event_title: eventTitle.trim(),
        event_starts_at: asIso(startsAt),
        event_ends_at: endsAt ? asIso(endsAt) : undefined,
        venue_name: venueName.trim() || undefined,
        venue_address: venueAddress.trim() || undefined,
        description: description.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
        cost_type: costType,
        cost_display: costDisplay.trim() || undefined,
        accessibility_info: accessibility.trim() || undefined,
        cover_image_base64: coverB64 || undefined,
        agreed_to_review: true,
      };
      const res = await fetch(`${BASE}/api/public/events/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: 'error', message: data?.detail || `Something went wrong (${res.status}).` });
        return;
      }
      setState({ kind: 'success', ref: data.submission_ref });
    } catch (err) {
      setState({ kind: 'error', message: 'Network error. Please try again.' });
    }
  };

  if (state.kind === 'success') {
    return (
      <div
        role="status"
        style={{
          padding: 32,
          borderRadius: 20,
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(10,37,64,0.06)',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>💜</div>
        <h2 style={{ fontSize: 24, color: '#0A2540', fontWeight: 900, margin: 0 }}>
          Thanks — your event has been submitted for review.
        </h2>
        <p style={{ marginTop: 12, color: '#475569', fontSize: 15, lineHeight: 1.6, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
          The FriendPlace team will check the details and contact you if
          anything further is needed. We&rsquo;ll let you know once it has been
          approved and published.
        </p>
        <div
          style={{
            display: 'inline-block',
            marginTop: 24,
            padding: '14px 22px',
            borderRadius: 14,
            background: '#F0FDFA',
            border: '1px solid #99F6E4',
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#0F766E', fontWeight: 800 }}>
            YOUR REFERENCE
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#0A2540', letterSpacing: '2px', marginTop: 4 }}>
            {state.ref}
          </div>
        </div>
        <p style={{ marginTop: 20, fontSize: 13, color: '#64748B' }}>
          A confirmation email is on its way to <strong>{contactEmail}</strong>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <SectionTitle title="Organisation & contact" subtitle="Who are we speaking with?" />
      <Row>
        <Field label="Organisation or host name" required>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. North Ryde RSL" required style={inputStyle} />
        </Field>
      </Row>
      <Row two>
        <Field label="Contact person" required>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Wilson" required style={inputStyle} />
        </Field>
        <Field label="Contact email" required>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="events@northryderslclub.org.au" required style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Phone (optional)">
          <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="02 9888 1234" style={inputStyle} />
        </Field>
      </Row>

      <SectionTitle title="Event details" subtitle="Give people the story." />
      <Row>
        <Field label="Event title" required>
          <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="Community Trivia Night" required style={inputStyle} />
        </Field>
      </Row>
      <Row two>
        <Field label="Starts" required>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required style={inputStyle} />
        </Field>
        <Field label="Ends (optional)">
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} />
        </Field>
      </Row>
      <Row two>
        <Field label="Venue name">
          <input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="North Ryde RSL Club" style={inputStyle} />
        </Field>
        <Field label="Venue address">
          <input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} placeholder="55 Magdala Rd, North Ryde NSW 2113" style={inputStyle} />
        </Field>
      </Row>
      <Row>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell people what to expect — the vibe, what to bring, who&rsquo;s welcome." rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Row>

      <SectionTitle title="Attendance & inclusion" subtitle="Help members decide if it&rsquo;s a fit." />
      <Row two>
        <Field label="Capacity (optional)">
          <input type="number" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="80" min={1} style={inputStyle} />
        </Field>
        <Field label="Free or paid">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['free', 'paid'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCostType(k)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${costType === k ? '#0F766E' : '#CBD5E1'}`,
                  background: costType === k ? '#F0FDFA' : '#FFFFFF',
                  color: costType === k ? '#0F766E' : '#475569',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {k === 'free' ? 'Free' : 'Paid'}
              </button>
            ))}
          </div>
        </Field>
      </Row>
      {costType === 'paid' && (
        <Row>
          <Field label="Cost (as you&rsquo;d like it displayed)">
            <input value={costDisplay} onChange={(e) => setCostDisplay(e.target.value)} placeholder="$15 per person" style={inputStyle} />
          </Field>
        </Row>
      )}
      <Row>
        <Field label="Accessibility information">
          <textarea value={accessibility} onChange={(e) => setAccessibility(e.target.value)} placeholder="Wheelchair accessible. Hearing loop available." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Row>

      <SectionTitle title="Cover image" subtitle="A great photo helps your event stand out." />
      <Row>
        <div>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 16, borderRadius: 12, border: '1px dashed #94A3B8',
              background: '#F8FAFC', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 22 }}>🖼️</span>
            <span style={{ flex: 1, color: '#475569', fontSize: 14 }}>
              {coverB64 ? 'Cover image ready ✓ — tap to change' : 'Upload cover image (JPEG / PNG, up to 4 MB)'}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onCoverPicked(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
          </label>
          {coverB64 && (
             
            <img src={coverB64} alt="Cover preview" style={{ display: 'block', maxWidth: '100%', maxHeight: 260, borderRadius: 12, marginTop: 12, border: '1px solid #E2E8F0' }} />
          )}
          {coverError && <div style={{ marginTop: 6, color: '#B91C1C', fontSize: 13 }}>{coverError}</div>}
        </div>
      </Row>

      {/* Review-agreement checkbox. This lives above the submit button
          so users see it as part of the tap intent — an unchecked box
          keeps the button disabled. */}
      <Row>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 14, color: '#334155', lineHeight: 1.5 }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            I understand this event is subject to <strong>FriendPlace approval</strong>{' '}
            and will only appear publicly after review. I confirm I&rsquo;m
            authorised to submit this event on behalf of the organisation named
            above.
          </span>
        </label>
      </Row>

      {state.kind === 'error' && (
        <div style={{ padding: 12, background: '#FEE2E2', color: '#991B1B', borderRadius: 10, marginBottom: 12, fontSize: 14 }}>
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          width: '100%',
          padding: '16px 22px',
          borderRadius: 14,
          border: 'none',
          background: canSubmit ? '#0A2540' : '#94A3B8',
          color: '#FFFFFF',
          fontWeight: 900,
          fontSize: 16,
          cursor: canSubmit ? 'pointer' : 'default',
          letterSpacing: '0.02em',
        }}
      >
        {state.kind === 'submitting' ? 'Submitting…' : 'Submit event for review 🎁'}
      </button>
      <p style={{ marginTop: 12, textAlign: 'center', color: '#64748B', fontSize: 12 }}>
        We&rsquo;ll email a confirmation with your submission reference to{' '}
        <strong style={{ color: '#334155' }}>{contactEmail || 'your contact address'}</strong>.
      </p>
    </form>
  );
}

/* ── tiny local UI helpers ─────────────────────────────────────── */

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginTop: 32, marginBottom: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: '#0F766E', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      {subtitle && <div style={{ color: '#64748B', fontSize: 14 }}>{subtitle}</div>}
    </div>
  );
}

function Row({ children, two }: { children: React.ReactNode; two?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: two ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 6, letterSpacing: '0.02em' }}>
        {label} {required && <span style={{ color: '#DC2626' }}>*</span>}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 12,
  border: '1px solid #CBD5E1',
  fontSize: 15,
  fontFamily: 'inherit',
  color: '#0A2540',
  background: '#FFFFFF',
  outline: 'none',
  boxSizing: 'border-box',
};
