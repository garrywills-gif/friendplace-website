'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { outreachApi, type OutreachOrgIn } from '@/lib/cms-api';

export default function NewOutreachPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<string[]>([]);
  const [form, setForm] = useState<OutreachOrgIn>({
    organisation_name: '', email: '', contact_name: '', phone: '',
    category: '', suburb: '', state: '', notes: '',
  });
  const [tagsInput, setTagsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { outreachApi.meta().then((m) => setCategories(m.categories)); }, []);

  const canSave = form.organisation_name.trim() && form.email.includes('@') && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr(null);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const org = await outreachApi.create({ ...form, tags });
      router.push(`/admin/outreach/${org.id}`);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setBusy(false); }
  };

  return (
    <AdminShell title="Add Organisation">
      <p style={crumbs}>
        <Link href="/admin/crm" style={crumbLink}>CRM</Link>{' › '}
        <Link href="/admin/outreach" style={crumbLink}>Outreach</Link>{' › '}Add
        — organisation name + email is all you need. Fill in the rest whenever suits.
      </p>

      <div style={card}>
        <label style={label}>Organisation name <span style={required}>*</span></label>
        <input style={input} value={form.organisation_name}
          onChange={(e) => setForm({ ...form, organisation_name: e.target.value })}
          placeholder="Hillside Retirement Village" autoFocus />

        <label style={label}>Email <span style={required}>*</span></label>
        <input style={input} type="email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="reception@hillside.example.com" />

        <div style={row}>
          <div style={{ flex: 1 }}>
            <label style={label}>Contact name</label>
            <input style={input} value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              placeholder="Sarah Jones" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Phone</label>
            <input style={input} value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="(02) 9000 0000" />
          </div>
        </div>

        <div style={row}>
          <div style={{ flex: 1 }}>
            <label style={label}>Category</label>
            <select style={input} value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">— choose —</option>
              {categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Suburb</label>
            <input style={input} value={form.suburb}
              onChange={(e) => setForm({ ...form, suburb: e.target.value })}
              placeholder="Kellyville" />
          </div>
          <div style={{ width: 100 }}>
            <label style={label}>State</label>
            <input style={input} value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              placeholder="NSW" />
          </div>
        </div>

        <label style={label}>Tags <span style={muted}>(comma-separated)</span></label>
        <input style={input} value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="e.g. hills-district, priority" />

        <label style={label}>Notes</label>
        <textarea style={{ ...input, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Anything worth remembering about them…" />

        <div style={{ display: 'flex', gap: 12, marginTop: 20, alignItems: 'center' }}>
          <button onClick={save} disabled={!canSave}
            style={{ ...sendBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
            data-testid="save-outreach-org">
            {busy ? 'Saving…' : 'Save organisation'}
          </button>
          <Link href="/admin/outreach" style={muted}>Cancel</Link>
          {err && <span style={{ color: '#991B1B', fontSize: 13, fontWeight: 600 }}>{err}</span>}
        </div>
      </div>
    </AdminShell>
  );
}

const crumbs: React.CSSProperties = { margin: '4px 0 20px', color: '#475569', fontSize: 13, lineHeight: 1.5 };
const crumbLink: React.CSSProperties = { color: '#0F766E', textDecoration: 'none', fontWeight: 700 };
const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24, maxWidth: 720 };
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 12, marginBottom: 4 };
const input: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F172A', background: '#FFFFFF' };
const row: React.CSSProperties = { display: 'flex', gap: 12 };
const sendBtn: React.CSSProperties = { background: '#0D9488', color: '#FFFFFF', border: 'none', borderRadius: 12, padding: '10px 22px', fontSize: 14, fontWeight: 800 };
const muted: React.CSSProperties = { color: '#94A3B8', fontWeight: 500, fontSize: 11, textDecoration: 'none' };
const required: React.CSSProperties = { color: '#DC2626' };
