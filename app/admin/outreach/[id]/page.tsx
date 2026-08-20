'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  outreachApi,
  type OutreachOrg,
  type OutreachOrgIn,
  type OutreachStatus,
} from '@/lib/cms-api';

const STATUS_OPTIONS: Array<{ value: OutreachStatus; label: string }> = [
  { value: 'not_contacted', label: 'Not contacted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'awaiting_reply', label: 'Awaiting our reply' },
  { value: 'replied', label: 'Replied' },
  { value: 'joined', label: 'Joined' },
  { value: 'declined', label: 'Declined' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
];

export default function OutreachOrganisationDetailPage() {
  const params = useParams();
  const router = useRouter();

  const id = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : String(raw || '');
  }, [params]);

  const [org, setOrg] = useState<OutreachOrg | null>(null);
  const [form, setForm] = useState<OutreachOrgIn | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [logKind, setLogKind] = useState('note');
  const [logBody, setLogBody] = useState('');
  const [logging, setLogging] = useState(false);

  const load = async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const result = await outreachApi.get(id);
      setOrg(result);

      setForm({
        organisation_name: result.organisation_name,
        email: result.email,
        contact_name: result.contact_name || '',
        phone: result.phone || '',
        category: result.category || '',
        tags: result.tags || [],
        suburb: result.suburb || '',
        state: result.state || '',
        notes: result.notes || '',
        status: result.status,
      });
    } catch (e: any) {
      setError(e?.message || 'Could not load organisation.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const update = <K extends keyof OutreachOrgIn>(
    key: K,
    value: OutreachOrgIn[K],
  ) => {
    setForm((current) =>
      current ? { ...current, [key]: value } : current,
    );
  };

  const save = async () => {
    if (!id || !form) return;

    if (!form.organisation_name.trim()) {
      setError('Organisation name is required.');
      return;
    }

    if (!form.email.trim() || !form.email.includes('@')) {
      setError('A valid email address is required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await outreachApi.update(id, {
        ...form,
        organisation_name: form.organisation_name.trim(),
        email: form.email.trim(),
        contact_name: form.contact_name?.trim() || '',
        phone: form.phone?.trim() || '',
        category: form.category?.trim() || '',
        suburb: form.suburb?.trim() || '',
        state: form.state?.trim() || '',
        notes: form.notes?.trim() || '',
      });

      setOrg(updated);
      setToast('Organisation saved.');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setError(e?.message || 'Could not save organisation.');
    } finally {
      setSaving(false);
    }
  };

  const addLog = async () => {
    if (!id || !logBody.trim()) return;

    setLogging(true);
    setError(null);

    try {
      const updated = await outreachApi.log(id, {
        kind: logKind,
        body: logBody.trim(),
      });

      setOrg(updated);
      setLogBody('');
      setToast('Communication logged.');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setError(e?.message || 'Could not log communication.');
    } finally {
      setLogging(false);
    }
  };

  const remove = async () => {
    if (!id || !org) return;

    const ok = window.confirm(
      `Delete ${org.organisation_name}? This cannot be undone.`,
    );

    if (!ok) return;

    setDeleting(true);
    setError(null);

    try {
      await outreachApi.del(id);
      router.push('/admin/outreach');
    } catch (e: any) {
      setError(e?.message || 'Could not delete organisation.');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AdminShell title="Organisation Outreach">
        <p style={{ color: '#64748B' }}>Loading organisation…</p>
      </AdminShell>
    );
  }

  if (!org || !form) {
    return (
      <AdminShell title="Organisation Outreach">
        <div style={errorBox}>
          {error || 'Organisation could not be found.'}
        </div>
        <Link href="/admin/outreach" style={crumbLink}>
          ← Back to Outreach
        </Link>
      </AdminShell>
    );
  }

  return (
    <AdminShell title={org.organisation_name}>
      <p style={crumbs}>
        <Link href="/admin/outreach" style={crumbLink}>
          Organisation Outreach
        </Link>
        {' › '}
        {org.organisation_name}
      </p>

      {error && <div style={errorBox}>{error}</div>}

      <div style={layout}>
        <div>
          <div style={card}>
            <h3 style={sectionTitle}>Organisation details</h3>

            <div style={grid}>
              <Field label="Organisation name">
                <input
                  value={form.organisation_name}
                  onChange={(e) =>
                    update('organisation_name', e.target.value)
                  }
                  style={adminStyles.input}
                />
              </Field>

              <Field label="Contact name">
                <input
                  value={form.contact_name || ''}
                  onChange={(e) => update('contact_name', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>

              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>

              <Field label="Phone">
                <input
                  value={form.phone || ''}
                  onChange={(e) => update('phone', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>

              <Field label="Category">
                <input
                  value={form.category || ''}
                  onChange={(e) => update('category', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>

              <Field label="Status">
                <select
                  value={form.status || 'not_contacted'}
                  onChange={(e) =>
                    update('status', e.target.value as OutreachStatus)
                  }
                  style={adminStyles.input}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Suburb">
                <input
                  value={form.suburb || ''}
                  onChange={(e) => update('suburb', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>

              <Field label="State">
                <input
                  value={form.state || ''}
                  onChange={(e) => update('state', e.target.value)}
                  style={adminStyles.input}
                />
              </Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={adminStyles.label}>Notes</label>
              <textarea
                value={form.notes || ''}
                onChange={(e) => update('notes', e.target.value)}
                style={{ ...adminStyles.textarea, minHeight: 120 }}
              />
            </div>

            <div style={actions}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                style={{
                  ...adminStyles.primaryBtn,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>

              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                style={{
                  ...adminStyles.dangerBtn,
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete organisation'}
              </button>
            </div>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <h3 style={sectionTitle}>Communication history</h3>

            {!org.communications?.length ? (
              <p style={muted}>No communication history yet.</p>
            ) : (
              <div style={timeline}>
                {[...org.communications]
                  .reverse()
                  .map((item, index) => (
                    <div key={`${item.at}-${index}`} style={timelineItem}>
                      <div style={timelineTop}>
                        <strong>{formatKind(item.kind)}</strong>
                        <span style={muted}>
                          {formatDate(item.at)}
                        </span>
                      </div>

                      {item.body && (
                        <div style={timelineBody}>{item.body}</div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <aside style={sideCard}>
          <h3 style={sectionTitle}>Log communication</h3>

          <label style={adminStyles.label}>Type</label>
          <select
            value={logKind}
            onChange={(e) => setLogKind(e.target.value)}
            style={adminStyles.input}
          >
            <option value="note">Note</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
            <option value="sms">SMS</option>
            <option value="follow_up">Follow-up</option>
          </select>

          <label style={adminStyles.label}>Details</label>
          <textarea
            value={logBody}
            onChange={(e) => setLogBody(e.target.value)}
            style={{ ...adminStyles.textarea, minHeight: 130 }}
            placeholder="What happened?"
          />

          <button
            type="button"
            onClick={() => void addLog()}
            disabled={logging || !logBody.trim()}
            style={{
              ...adminStyles.primaryBtn,
              width: '100%',
              opacity: logging || !logBody.trim() ? 0.5 : 1,
            }}
          >
            {logging ? 'Logging…' : 'Add to history'}
          </button>

          <div style={metaBox}>
            <MetaRow
              label="Last contact"
              value={org.last_contact_at ? formatDate(org.last_contact_at) : '—'}
            />
            <MetaRow
              label="Last reply"
              value={org.last_reply_at ? formatDate(org.last_reply_at) : '—'}
            />
            <MetaRow
              label="Created"
              value={org.created_at ? formatDate(org.created_at) : '—'}
            />
          </div>
        </aside>
      </div>

      {toast && <div style={adminStyles.toast}>{toast}</div>}
    </AdminShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={adminStyles.label}>{label}</label>
      {children}
    </div>
  );
}

function MetaRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={metaRow}>
      <span style={muted}>{label}</span>
      <strong style={{ color: '#0A2540' }}>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatKind(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

const crumbs: React.CSSProperties = {
  fontSize: 13,
  color: '#475569',
  marginTop: 0,
  marginBottom: 18,
};

const crumbLink: React.CSSProperties = {
  color: '#0D9488',
  fontWeight: 700,
  textDecoration: 'none',
};

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
  gap: 18,
  alignItems: 'start',
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: 20,
};

const sideCard: React.CSSProperties = {
  ...card,
  position: 'sticky',
  top: 20,
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 17,
  fontWeight: 900,
  color: '#0A2540',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 14,
};

const actions: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 20,
};

const timeline: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const timelineItem: React.CSSProperties = {
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  padding: 12,
  background: '#F8FAFC',
};

const timelineTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  fontSize: 13,
  color: '#0A2540',
};

const timelineBody: React.CSSProperties = {
  marginTop: 7,
  fontSize: 13,
  color: '#475569',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
};

const muted: React.CSSProperties = {
  color: '#94A3B8',
  fontSize: 12,
};

const metaBox: React.CSSProperties = {
  marginTop: 20,
  paddingTop: 14,
  borderTop: '1px solid #E2E8F0',
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  padding: '7px 0',
  fontSize: 12,
};

const errorBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  background: '#FEF2F2',
  color: '#B91C1C',
  fontSize: 13,
};
