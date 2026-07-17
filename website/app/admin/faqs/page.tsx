'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cmsApi } from '@/lib/cms-api';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';

type FAQ = { q: string; a: string };

function FaqsEditorInner() {
  const search = useSearchParams();
  const shouldAddOnLoad = search.get('new') === '1';
  const newRowRef = useRef<HTMLInputElement | null>(null);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const doc = await cmsApi.getContent();
        const initial = (doc.faqs || []) as FAQ[];
        if (shouldAddOnLoad) {
          const withNew = [...initial, { q: '', a: '' }];
          setFaqs(withNew);
          // Focus the newly-added question input once it's in the DOM.
          setFocusIndex(withNew.length - 1);
        } else {
          setFaqs(initial);
        }
      } finally { setLoading(false); }
    })();
  }, [shouldAddOnLoad]);

  // Scroll to & focus the freshly added question input.
  useEffect(() => {
    if (focusIndex !== null && newRowRef.current) {
      newRowRef.current.focus({ preventScroll: false });
      newRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusIndex(null);
    }
  }, [faqs, focusIndex]);

  const update = (i: number, patch: Partial<FAQ>) => setFaqs(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const add = () => {
    setFaqs(prev => {
      const next = [...prev, { q: '', a: '' }];
      setFocusIndex(next.length - 1);
      return next;
    });
  };
  const remove = (i: number) => setFaqs(prev => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setFaqs(prev => {
    const j = i + dir; if (j < 0 || j >= prev.length) return prev;
    const next = [...prev]; const [it] = next.splice(i, 1); next.splice(j, 0, it); return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await cmsApi.patchContent({ faqs });
      setToast('FAQs saved');
      setTimeout(() => setToast(null), 2200);
    } catch (e: any) {
      setToast(`Save failed: ${e?.message || ''}`);
      setTimeout(() => setToast(null), 3200);
    } finally { setSaving(false); }
  };

  if (loading) return <AdminShell title="FAQs"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>;

  return (
    <AdminShell title="FAQs">
      <p style={{ color: '#475569', fontSize: 16, marginTop: -12, marginBottom: 24, maxWidth: 720 }}>
        Frequently asked questions shown on the /faqs page. Keep answers short and warm.
      </p>

      <div style={s.card}>
        {faqs.length === 0 ? (
          <p style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>No FAQs yet. Add your first below.</p>
        ) : faqs.map((f, i) => (
          <div key={i} style={{ padding: '16px 0', borderTop: i > 0 ? '1px solid #F1F5F9' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Question {i + 1}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="cms-btn-ghost" style={s.ghostBtn} onClick={() => move(i, -1)} disabled={i === 0} type="button">↑</button>
                <button className="cms-btn-ghost" style={s.ghostBtn} onClick={() => move(i, +1)} disabled={i === faqs.length - 1} type="button">↓</button>
                <button className="cms-btn-danger" style={s.dangerBtn} onClick={() => remove(i)} type="button">Delete</button>
              </div>
            </div>
            <label style={s.label}>Question</label>
            <input
              className="cms-input"
              style={s.input}
              value={f.q}
              onChange={e => update(i, { q: e.target.value })}
              placeholder="Is FriendPlace free?"
              ref={i === faqs.length - 1 ? newRowRef : undefined}
            />
            <div style={{ height: 10 }} />
            <label style={s.label}>Answer</label>
            <textarea className="cms-textarea" style={s.textarea} value={f.a} onChange={e => update(i, { a: e.target.value })} placeholder="Yes. Founding members…" />
          </div>
        ))}
        <div style={{ marginTop: 20 }}>
          <button type="button" onClick={add} className="cms-btn-ghost" style={s.ghostBtn}>+ Add FAQ</button>
        </div>
      </div>

      <button onClick={save} className="cms-btn-primary" style={{ ...s.primaryBtn, opacity: saving ? 0.65 : 1 }} disabled={saving}>
        {saving ? 'Saving…' : 'Save FAQs'}
      </button>

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

export default function FaqsEditorPage() {
  return (
    <Suspense fallback={<AdminShell title="FAQs"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>}>
      <FaqsEditorInner />
    </Suspense>
  );
}
