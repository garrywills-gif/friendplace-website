'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminShell, adminStyles } from '@/components/admin/AdminShell';
import {
  outreachApi,
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

export default function NewOutreachOrganisationPage() {
  const router = useRouter();

  const [form, setForm] = useState<OutreachOrgIn>({
    organisation_name: '',
    email: '',
    contact_name: '',
    phone: '',
    category: 'retirement_village',
    tags: [],
    suburb: '',
    state: 'NSW',
    notes: '',
    status: 'not_contacted',
  });

  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof OutreachOrgIn>(
    key: K,
    value: OutreachOrgIn[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;

    const currentTags = form.tags || [];
    if (!currentTags.includes(tag)) {
      update('tags', [...currentTags, tag]);
    }

    setTagInput('');
  };

  const removeTag = (tag: string) => {
    update(
      'tags',
      (form.tags || []).filter((t) => t !== tag),
    );
  };

  const save = async () => {
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
      const created = await outreachApi.create({
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

      router.push(`/admin/outreach/${created.id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not create organisation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="New outreach organisation">
      <p style={crumbs}>
        <Link href="/admin/outreach" style={crumbLink}>
          Organisation Outreach
        </Link>
        {' › '}New organisation
      </p>

      <div style={card}>
        <div style={grid}>
          <Field label="Organisation name *">
            <input
              value={form.organisation_name}
              onChange={(e) => update('organisation_name', e.target.value)}
              style={adminStyles.input}
              placeholder="e.g. The Ponds Retirement Village"
            />
          </Field>

          <Field label="Contact name">
            <input
              value={form.contact_name || ''}
              onChange={(e) => update('contact_name', e.target.value)}
              style={adminStyles.input}
              placeholder="e.g. Elizabeth Smith"
            />
          </Field>

          <Field label="Email *">
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              style={adminStyles.input}
              placeholder="reception@example.com.au"
            />
          </Field>

          <Field label="Phone">
            <input
              value={form.phone || ''}
              onChange={(e) => update('phone', e.target.value)}
              style={adminStyles.input}
              placeholder="02 0000 0000"
            />
          </Field>

          <Field label="Category">
            <input
              value={form.category || ''}
              onChange={(e) => update('category', e.target.value)}
              style={adminStyles.input}
              placeholder="retirement_village"
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
              placeholder="The Ponds"
            />
          </Field>

          <Field label="State">
            <input
              value={form.state || ''}
              onChange={(e) => update('state', e.target.value)}
              style={adminStyles.input}
              placeholder="NSW"
            />
          </Field>
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={adminStyles.label}>Tags</label>

          <div style={tagBox}>
            {(form.tags || []).map((tag) => (
              <span key={tag} style={tagPill}>
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  style={tagRemove}
                  aria-label={`Remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}

            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Type a tag and press Enter"
              style={tagInputStyle}
            />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={adminStyles.label}>Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={(e) => update('notes', e.target.value)}
            style={{ ...adminStyles.textarea, minHeight: 130 }}
            placeholder="Anything useful to remember about this organisation or contact."
          />
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={actions}>
          <Link
            href="/admin/outreach"
            style={{ ...adminStyles.ghostBtn, textDecoration: 'none' }}
          >
            Cancel
          </Link>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            style={{
              ...adminStyles.primaryBtn,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Create organisation'}
          </button>
        </div>
      </div>
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

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 16,
  padding: 22,
  maxWidth: 900,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
};

const tagBox: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
  minHeight: 44,
  padding: '7px 9px',
  border: '1.5px solid #CBD5E1',
  borderRadius: 12,
  background: '#FFFFFF',
};

const tagPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 9px',
  borderRadius: 999,
  background: '#F0FDFA',
  color: '#0F766E',
  fontSize: 12,
  fontWeight: 700,
};

const tagRemove: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#0F766E',
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: 0,
};

const tagInputStyle: React.CSSProperties = {
  border: 'none',
  outline: 'none',
  flex: '1 1 180px',
  minWidth: 160,
  fontSize: 13,
  background: 'transparent',
};

const actions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 22,
  flexWrap: 'wrap',
};

const errorBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 10,
  background: '#FEF2F2',
  color: '#B91C1C',
  fontSize: 13,
};
