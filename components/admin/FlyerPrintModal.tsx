'use client';

/**
 * Flyer preview + print modal.
 *
 * Launch requirement (Garry, 3 Aug 2026): printing must open the
 * browser print dialogue DIRECTLY from Mission Control — no download
 * step. We achieve that with a hidden <iframe> whose src is the flyer
 * render URL. The `@page { size: … }` CSS in the iframe tells the
 * printer the physical paper size (A3 vs A4 vs A5) so the same PNG
 * prints crisply at any supported size.
 *
 * Every layout button provides the trio Garry asked for:
 *   🖨 Print   →  opens the browser print dialogue for THIS layout
 *   ⬇ Download →  saves the PNG (or PDF) to disk
 *   🔎 Preview  →  swaps the on-screen preview to this layout
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { flyersApi, type FlyerLayout, type FlyerLayoutCategory, type FlyerTemplate } from '@/lib/cms-api';
import { AuthedFlyerImage } from '@/components/admin/AuthedFlyerImage';

type Props = {
  template: FlyerTemplate;
  layoutCategories: FlyerLayoutCategory[];
initialLayout?: string;
initialFields?: Record<string, string>;  
  onClose: () => void;
};

export function FlyerPrintModal({ template, layoutCategories, onClose, initialLayout, initialFields }: Props) {
 const [selectedLayoutKey, setSelectedLayoutKey] = useState<string>(initialLayout || template.default_layout);
  // Field values keyed by field.key. Auto-initialised from any
  // defaults on the template so the preview reflects the current
  // saved wording the moment the modal opens.
const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => ({
  ...(initialFields || {}),
  ...(template.engine === 'founding_flyer_v1' && initialFields?.show_founding_member === undefined
    ? { show_founding_member: 'false' }
    : {}),
}));
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  // Only show layouts THIS template actually supports.
  const availableLayouts = useMemo(() => {
    const supported = new Set(template.supported_layouts);
    const cats: Array<{ label: string; layouts: FlyerLayout[] }> = [];
    for (const cat of layoutCategories) {
      const laysHere = cat.layouts.filter((l) => supported.has(l.key));
      if (laysHere.length) cats.push({ label: cat.label, layouts: laysHere });
    }
    return cats;
  }, [template, layoutCategories]);

  const selected = useMemo(
    () => layoutCategories.flatMap((c) => c.layouts).find((l) => l.key === selectedLayoutKey) || null,
    [selectedLayoutKey, layoutCategories],
  );

  // Fields the admin can edit inline (skip hidden — those are passed
  // through by the backend without a form control).
  const editableFields = useMemo(
    () => (template.fields || []).filter((f) => f.type !== 'hidden'),
    [template],
  );

  // `renderUrl` was previously baked into <img> and iframe srcs, but
  // the browser doesn't send Bearer headers on those, causing 401s.
  // We now fetch the render as an authenticated blob inside doPrint /
  // doDownload (and inside <AuthedFlyerImage/>) so no naked renderUrl
  // is exposed to the browser.

  // Close on Esc — a small courtesy for keyboard users, and consistent
  // with how other Mission Control modals behave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doPrint = async () => {
    if (!selected) return;
    let blobUrl: string;
    try {
      const { url } = await flyersApi.renderBlob(template.key, {
        layout: selectedLayoutKey,
        fields: fieldValues,
      });
      blobUrl = url;
    } catch (e: any) {
      alert(e?.message || 'Could not prepare flyer for printing.');
      return;
    }

    const iframe = printFrameRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    const wMm = selected.width_mm;
    const hMm = selected.height_mm;
    doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(template.name)} · ${escapeHtml(selected.label)}</title>
  <style>
    @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      width: ${wMm}mm; height: ${hMm}mm;
      background: #FFFFFF;
      overflow: hidden;
    }
    body { display: block; }
    img {
      display: block;
      width: ${wMm}mm; height: ${hMm}mm;
      max-width: ${wMm}mm; max-height: ${hMm}mm;
      object-fit: contain;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    @media print {
      html, body {
        width: ${wMm}mm; height: ${hMm}mm;
        overflow: hidden;
      }
    }
  </style>
</head>
<body>
  <img src="${escapeAttr(blobUrl)}" alt="${escapeAttr(template.name)}" />
</body>
</html>`);
    doc.close();

    await new Promise<void>((resolve) => {
      const img = doc.querySelector('img');
      const t = setTimeout(() => resolve(), 6000);
      if (img && !img.complete) {
        img.addEventListener('load', () => { clearTimeout(t); resolve(); });
        img.addEventListener('error', () => { clearTimeout(t); resolve(); });
      } else {
        clearTimeout(t);
        resolve();
      }
    });
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(blobUrl, '_blank', 'noopener');
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ } }, 30_000);
    }
  };

  const doDownload = async () => {
    try {
      const { url, contentType } = await flyersApi.renderBlob(template.key, {
        layout: selectedLayoutKey,
        fields: fieldValues,
      });
      const ext = contentType.includes('pdf') ? 'pdf' : (contentType.includes('png') ? 'png' : 'bin');
      const safeName = template.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'flyer';
      const safeLayout = selectedLayoutKey.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'layout';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}-${safeLayout}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* noop */ } }, 30_000);
    } catch (e: any) {
      alert(e?.message || 'Could not download the flyer.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${template.name}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          width: 'min(1080px, 100%)', height: 'min(920px, 92vh)', overflow: 'hidden',
          display: 'grid', gridTemplateColumns: '1fr 320px', minHeight: 0, minWidth: 0,
        }}
      >
        {/* Preview pane */}
        <div style={{ padding: 20, background: '#F8FAFC', overflow: 'auto', minHeight: 0, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{template.name}</h2>
            <button
              onClick={onClose}
              aria-label="Close preview"
              style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748B' }}
            >×</button>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <div style={{ display: 'inline-block', maxWidth: '100%', maxHeight: '70vh' }}>
              <AuthedFlyerImage
                templateKey={template.key}
                layout={selectedLayoutKey}
                fields={fieldValues}
                alt={`${template.name} preview`}
                style={{ maxWidth: '100%', maxHeight: '70vh', boxShadow: '0 6px 18px rgba(0,0,0,0.12)' }}
              />
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>
              {selected ? (
                <>
                  {selected.label} · {selected.width_mm}×{selected.height_mm}mm
                  {selected.crop_marks ? ' · with crop marks' : ''}
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Controls pane */}
        <div style={{ padding: 20, borderLeft: '1px solid #E2E8F0', overflow: 'auto', minHeight: 0, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Layout
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {availableLayouts.map((cat) => (
              <div key={cat.label}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>{cat.label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cat.layouts.map((lay) => {
                    const on = selectedLayoutKey === lay.key;
                    return (
                      <button
                        key={lay.key}
                        onClick={() => setSelectedLayoutKey(lay.key)}
                        style={{
                          padding: '8px 12px', borderRadius: 10,
                          border: on ? '1.5px solid #0F766E' : '1.5px solid #CBD5E1',
                          background: on ? '#0F766E' : '#FFFFFF', color: on ? '#FFFFFF' : '#334155',
                          fontWeight: 700, fontSize: 13, cursor: 'pointer',
                        }}
                        title={lay.description}
                      >
                        {lay.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {editableFields.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Content
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {editableFields.map((f) => {
                  const v = fieldValues[f.key] ?? '';
                  const set = (nv: string) => setFieldValues((prev) => ({ ...prev, [f.key]: nv }));
                  const inputStyle: React.CSSProperties = {
                    width: '100%', padding: '9px 12px', borderRadius: 10,
                    border: '1.5px solid #CBD5E1', fontSize: 14, boxSizing: 'border-box',
                  };
                  return (
                    <div key={f.key}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea value={v} onChange={(e) => set(e.target.value)} rows={2}
                                  style={{ ...inputStyle, resize: 'vertical' }} />
                      ) : f.type === 'select' ? (
                        <select value={v} onChange={(e) => set(e.target.value)} style={inputStyle}>
                          <option value="">—</option>
                          {(f.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : f.type === 'date' ? (
                        <input type="date" value={v} onChange={(e) => set(e.target.value)} style={inputStyle} />
                      ) : f.type === 'time' ? (
                        <input type="time" value={v} onChange={(e) => set(e.target.value)} style={inputStyle} />
                      ) : f.type === 'url' ? (
                        <input type="url" value={v} onChange={(e) => set(e.target.value)} placeholder="https://…" style={inputStyle} />
                      ) : (
                        <input type="text" value={v} onChange={(e) => set(e.target.value)} maxLength={200} style={inputStyle} />
                      )}
                      {f.help && (
                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>{f.help}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {template.engine === 'founding_flyer_v1' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Options
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={fieldValues.show_founding_member === 'true'}
                  onChange={(e) => setFieldValues((prev) => ({
                    ...prev,
                    show_founding_member: e.target.checked ? 'true' : 'false',
                  }))}
                />
                <span>Show Founding Member section</span>
              </label>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={doPrint}
              style={{
                padding: '12px 16px', borderRadius: 12, border: 'none',
                background: '#0F766E', color: '#FFFFFF', fontWeight: 800, fontSize: 15, cursor: 'pointer',
              }}
            >
              🖨 Print
            </button>
            <button
              onClick={doDownload}
              style={{
                padding: '12px 16px', borderRadius: 12,
                border: '1.5px solid #0F766E', background: '#FFFFFF',
                color: '#0F766E', fontWeight: 800, fontSize: 15, cursor: 'pointer',
              }}
            >
              ⬇ Download
            </button>
          </div>

          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 16, lineHeight: 1.5 }}>
            Print opens your browser’s print dialogue with the correct paper size preset.
            Set your printer to print at <strong>Actual size</strong> for crisp QR codes and clean guillotine cuts on multi-up sheets.
          </div>
        </div>
      </div>

      <iframe
        ref={printFrameRef}
        title="Flyer print buffer"
        style={{ position: 'absolute', width: 0, height: 0, border: 'none', visibility: 'hidden' }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}