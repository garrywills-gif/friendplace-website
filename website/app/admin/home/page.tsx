'use client';

import { useEffect, useState } from 'react';
import { cmsApi } from '@/lib/cms-api';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { MediaPicker } from '@/components/admin/MediaPicker';

type FeatureCard = { icon: string; title: string; body: string };

export default function HomeEditorPage() {
  const [features, setFeatures] = useState<FeatureCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const doc = await cmsApi.getContent();
        const list: FeatureCard[] = (doc.features || []).map((f: any) => ({
          icon: f.icon || f.emoji || '',
          title: f.title || '',
          body: f.body || f.description || '',
        }));
        setFeatures(list);
      } finally { setLoading(false); }
    })();
  }, []);

  const update = (i: number, patch: Partial<FeatureCard>) =>
    setFeatures(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const addRow = () => setFeatures(prev => [...prev, { icon: '✨', title: '', body: '' }]);
  const removeRow = (i: number) => setFeatures(prev => prev.filter((_, idx) => idx !== i));
  const moveRow = (i: number, dir: -1 | 1) => {
    setFeatures(prev => {
      const j = i + dir; if (j < 0 || j >= prev.length) return prev;
      const next = [...prev]; const [it] = next.splice(i, 1); next.splice(j, 0, it);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await cmsApi.patchContent({ features });
      setToast('Home page saved');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(`Save failed: ${e?.message || ''}`);
      setTimeout(() => setToast(null), 3200);
    } finally { setSaving(false); }
  };

  if (loading) return <AdminShell title="Home page"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;

  return (
    <AdminShell title="Home page">
      <p style={{ color: '#475569', fontSize: 16, marginTop: -12, marginBottom: 24, maxWidth: 720 }}>
        Edit the six feature cards that appear on the landing page. Icon can be an emoji (📅) or a short symbol. Body text is plain text — the About page has the rich text editor.
      </p>

      <div style={s.card}>
        <h2 style={s.cardTitle}>Feature cards</h2>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 12, alignItems: 'start', padding: '16px 0', borderTop: i > 0 ? '1px solid #F1F5F9' : 'none' }}>
            <div>
              <label style={s.label}>Icon</label>
              <input style={s.input} value={f.icon} onChange={e => update(i, { icon: e.target.value })} maxLength={4} />
            </div>
            <div>
              <label style={s.label}>Title</label>
              <input style={s.input} value={f.title} onChange={e => update(i, { title: e.target.value })} placeholder="Coffee Lounge" />
              <div style={{ height: 8 }} />
              <label style={s.label}>Body</label>
              <textarea style={s.textarea} value={f.body} onChange={e => update(i, { body: e.target.value })} placeholder="A soft place to think out loud…" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 24 }}>
              <button style={s.ghostBtn} onClick={() => moveRow(i, -1)} disabled={i === 0} type="button">↑</button>
              <button style={s.ghostBtn} onClick={() => moveRow(i, +1)} disabled={i === features.length - 1} type="button">↓</button>
              <button style={s.dangerBtn} onClick={() => removeRow(i)} type="button">Delete</button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button type="button" onClick={addRow} style={s.ghostBtn}>+ Add feature card</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={save} style={{ ...s.primaryBtn, opacity: saving ? 0.65 : 1 }} disabled={saving}>
          {saving ? 'Saving…' : 'Save home page'}
        </button>
      </div>

      <MediaPicker open={pickerIdx !== null} onClose={() => setPickerIdx(null)} onPick={() => setPickerIdx(null)} />
      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}
