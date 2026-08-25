'use client';

/**
 * Flyer detail / edit page.
 *
 * The template metadata is editable; the flyer's *design* stays in the
 * PIL renderer (for engine=founding_flyer_v1) or static PDF assets
 * (engine=static_pdf), so this page is deliberately light: name,
 * description, supported layouts, and the ever-important preview +
 * print actions in one glance.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { flyersApi, type FlyerLayoutCategory, type FlyerTemplate, type FlyerField } from '@/lib/cms-api';
import { FlyerPrintModal } from '@/components/admin/FlyerPrintModal';

export default function FlyerDetailPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const key = params.key;

  const [template, setTemplate] = useState<FlyerTemplate | null>(null);
  const [layoutCats, setLayoutCats] = useState<FlyerLayoutCategory[]>([]);
  const [fieldLibrary, setFieldLibrary] = useState<FlyerField[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Deep-link support (Garry, iter158): when George drafts a flyer and
  // Garry approves the preview, we open here with ?open=preview and
  // optional ?layout=…&fields=<base64 JSON>. We capture the initial
  // values ONCE at mount into local state — pulling them via useMemo(
  // searchParams) is fragile because history.replaceState (used below
  // to strip the query string) can cause searchParams to re-emit as
  // empty before <FlyerPrintModal /> mounts, blanking the props out.
  const [initialLayout] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('layout') || undefined;
  });
  const [initialFields] = useState<Record<string, string> | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get('fields');
    if (!raw) return undefined;
    try {
      // urlsafe base64 without padding — restore it.
      const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
      const normalised = padded.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = window.atob(normalised);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v == null) continue;
          out[String(k)] = String(v);
        }
        return out;
      }
    } catch {
      // Ignore malformed payloads — fall back to empty defaults.
    }
    return undefined;
  });
  const [shouldAutoOpenPreview] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('open') === 'preview';
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [supported, setSupported] = useState<string[]>([]);
  const [defaultLayout, setDefaultLayout] = useState('poster_a4');
  // Editable field schema — admins pick which placeholders THIS
  // template exposes to the print modal. Any field from the backend
  // FIELD_LIBRARY can be added without a code change (Garry, 3 Aug).
  const [fields, setFields] = useState<FlyerField[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [tpl, cats, lib] = await Promise.all([
          flyersApi.get(key),
          flyersApi.listLayouts(),
          flyersApi.listFieldLibrary(),
        ]);
        setTemplate(tpl);
        setLayoutCats(cats.categories);
        setFieldLibrary(lib.fields);
        setName(tpl.name);
        setDescription(tpl.description);
        setSupported(tpl.supported_layouts || []);
        setDefaultLayout(tpl.default_layout || 'poster_a4');
        setFields(tpl.fields || []);
      } catch (e: any) {
        setErr(e?.message || 'Could not load template');
      }
    })();
  }, [key]);

  // Auto-open the print modal when arriving via George's flyer-draft
  // deep link (?open=preview). Runs once after the template loads so
  // the modal has the layout catalogue ready. We then strip the query
  // params from the URL so page reloads don't re-open the modal on
  // every refresh — the pre-populated state remains in the modal's
  // local component state (initial values were captured at mount).
  useEffect(() => {
    if (!template) return;
    if (!shouldAutoOpenPreview) return;
    setShowPreview(true);
    // Clean up the URL — keep the path, drop the query string.
    try {
      if (typeof window !== 'undefined') {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    } catch {
      // History API blocked (very rare) — modal still opens correctly.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const allLayouts = useMemo(
    () => layoutCats.flatMap((c) => c.layouts.map((l) => ({ ...l, category_label: c.label }))),
    [layoutCats],
  );

  const toggleSupported = (layoutKey: string) => {
    setSupported((prev) => prev.includes(layoutKey) ? prev.filter((k) => k !== layoutKey) : [...prev, layoutKey]);
  };

  const onSave = async () => {
    if (!template) return;
    setBusy(true); setErr(null);
    try {
      const updated = await flyersApi.update(template.key, {
        name, description, supported_layouts: supported,
        default_layout: defaultLayout, fields,
      });
      setTemplate(updated);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setBusy(false); }
  };

  const onPublishToggle = async () => {
    if (!template) return;
    setBusy(true); setErr(null);
    try {
      const updated = template.status === 'published'
        ? await flyersApi.unpublish(template.key)
        : await flyersApi.publish(template.key);
      setTemplate(updated);
    } catch (e: any) {
      setErr(e?.message || 'Update failed');
    } finally { setBusy(false); }
  };

  const onArchive = async () => {
    if (!template) return;
    if (!confirm(`Archive "${template.name}"? It stays in the archived filter and can be restored later.`)) return;
    setBusy(true);
    try {
      await flyersApi.archive(template.key);
      router.push('/admin/flyers');
    } finally { setBusy(false); }
  };

  return (
    <AdminShell title="Flyer Details">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0A2540', margin: 0 }}>🖨️ {template?.name ?? 'Loading…'}</h1>
          <p style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
            {template?.description || 'Adjust the template details, choose which layouts it supports, then publish it to the library.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/admin/flyers" style={{ ...s.ghostBtn, textDecoration: 'none' }}>← Library</Link>
          {template && (
            <button onClick={() => setShowPreview(true)} style={s.primaryBtn}>
              👁 Preview &amp; Edit
            </button>
          )}
        </div>
      </div>

      {err && (
        <div role="alert" style={{ ...s.card, borderColor: '#DC2626', background: '#FEF2F2', color: '#7F1D1D', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!template ? (
        <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
          {/* Editable metadata */}
          <div style={s.card}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B', marginBottom: 6 }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                     style={{ width: '100%', padding: 10, border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 15 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B', marginBottom: 6 }}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                     style={{ width: '100%', padding: 10, border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 14, resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B', marginBottom: 8 }}>Supported layouts</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {layoutCats.map((cat) => (
                  <div key={cat.key}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 6 }}>{cat.label}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {cat.layouts.map((lay) => {
                        const on = supported.includes(lay.key);
                        return (
                          <button
                            key={lay.key}
                            onClick={() => toggleSupported(lay.key)}
                            title={lay.description}
                            style={{
                              padding: '8px 12px', borderRadius: 10,
                              border: on ? '1.5px solid #0F766E' : '1.5px solid #CBD5E1',
                              background: on ? '#0F766E' : '#FFFFFF',
                              color: on ? '#FFFFFF' : '#334155',
                              fontWeight: 700, fontSize: 13, cursor: 'pointer',
                            }}
                          >
                            {on ? '✓ ' : ''}{lay.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B', marginBottom: 8 }}>
                Editable content fields
              </label>
              <div style={{ color: '#64748B', fontSize: 12, marginBottom: 10 }}>
                Any field ticked here appears in the Print &amp; Preview modal so admins can change the wording without rebuilding the template.
                {template?.engine === 'founding_flyer_v1' && (
                  <span style={{ display: 'block', marginTop: 4, color: '#92400E' }}>
                    ⚠️ The Founding Member Invite uses the existing PIL renderer — it honours <code>admin_id</code>, <code>venue</code>, <code>url</code>, <code>headline</code> and <code>supporting_text</code>. Other fields will be surfaced in the editor but won&apos;t change the rendered image until the engine adopts them.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {fieldLibrary.map((f) => {
                  const on = fields.some((existing) => existing.key === f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFields((prev) => on
                        ? prev.filter((x) => x.key !== f.key)
                        : [...prev, f])}
                      title={f.help || f.label}
                      style={{
                        padding: '7px 12px', borderRadius: 10,
                        border: on ? '1.5px solid #0F766E' : '1.5px solid #CBD5E1',
                        background: on ? '#0F766E' : '#FFFFFF',
                        color: on ? '#FFFFFF' : '#334155',
                        fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      {on ? '✓ ' : '+ '}{f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748B', marginBottom: 6 }}>Default layout</label>
              <select value={defaultLayout} onChange={(e) => setDefaultLayout(e.target.value)}
                      style={{ width: '100%', padding: 10, border: '1.5px solid #CBD5E1', borderRadius: 10, fontSize: 14 }}>
                {allLayouts.filter((l) => supported.includes(l.key)).map((lay) => (
                  <option key={lay.key} value={lay.key}>{lay.category_label} · {lay.label}</option>
                ))}
              </select>
            </div>

            <button onClick={onSave} disabled={busy} style={{ ...s.primaryBtn, marginTop: 8 }}>
              {busy ? 'Saving…' : '💾 Save changes'}
            </button>
          </div>

          {/* Side rail — status + quick actions */}
          <div style={{ ...s.card, position: 'sticky', top: 20, alignSelf: 'start' }}>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
              Status
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, textTransform: 'capitalize' }}>
              {template.status}
            </div>
            <div style={{ color: '#64748B', fontSize: 12 }}>
              Used {template.used_count ?? 0}×
              {template.last_used_at ? ` · last on ${new Date(template.last_used_at).toLocaleDateString()}` : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <button onClick={onPublishToggle} disabled={busy || template.status === 'archived'}
                      style={s.ghostBtn}>
                {template.status === 'published' ? '📥 Unpublish' : '📢 Publish'}
              </button>
              <button onClick={onArchive} disabled={busy || template.status === 'archived'}
                      style={s.ghostBtn}>
                📦 Archive
              </button>
            </div>
            {template.george_hint && (
              <div style={{ marginTop: 16, padding: 10, background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 10, fontSize: 12, color: '#0F766E' }}>
                <strong>George hint:</strong> {template.george_hint}
              </div>
            )}
          </div>
        </div>
      )}

      {showPreview && template && (
        <FlyerPrintModal
          template={template}
          layoutCategories={layoutCats}
          onClose={() => setShowPreview(false)}
          initialLayout={initialLayout}
          initialFields={initialFields}
        />
      )}
    </AdminShell>
  );
}
