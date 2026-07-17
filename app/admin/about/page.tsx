'use client';

import { useEffect, useState } from 'react';
import { cmsApi } from '@/lib/cms-api';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { RichTextEditor } from '@/components/admin/RichTextEditor';

export default function AboutEditorPage() {
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const doc = await cmsApi.getContent();
        const about = doc.about || {};
        setTitle(about.title || '');
        setLead(about.lead || '');
        setBodyHtml(about.body || '');
      } finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await cmsApi.patchContent({ about: { title, lead, body: bodyHtml } });
      setToast('About page saved');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(`Save failed: ${e?.message || ''}`);
      setTimeout(() => setToast(null), 3200);
    } finally { setSaving(false); }
  };

  if (loading) return <AdminShell title="About page"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;

  return (
    <AdminShell title="About page">
      <p style={{ color: '#475569', fontSize: 16, marginTop: -12, marginBottom: 24, maxWidth: 720 }}>
        The About page tells the FriendPlace story. Use the rich-text editor for the body — you can add headings, links, bullet lists and images from the Media Library.
      </p>

      <div style={s.card}>
        <label style={s.label}>Page heading</label>
        <input className="cms-input" style={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="About FriendPlace" />
        <div style={{ height: 16 }} />
        <label style={s.label}>Lead / mission (short)</label>
        <textarea className="cms-textarea" style={s.textarea} value={lead} onChange={e => setLead(e.target.value)} placeholder="A warm, safe community for grown-ups who want to make new friends." />
        <div style={s.helper}>Shown as the tagline directly under the heading.</div>
      </div>

      <div style={s.card}>
        <h2 style={s.cardTitle}>Body</h2>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} placeholder="Tell the FriendPlace story…" minHeight={300} />
        <div style={s.helper}>Tip: use images sparingly — the About page reads best as a personal letter, not a brochure.</div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={save} className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: saving ? 0.65 : 1 }} disabled={saving}>
          {saving ? 'Saving…' : 'Save about page'}
        </button>
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}
