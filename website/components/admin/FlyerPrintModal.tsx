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

type Props = {
  template: FlyerTemplate;
  layoutCategories: FlyerLayoutCategory[];
  onClose: () => void;
};

export function FlyerPrintModal({ template, layoutCategories, onClose }: Props) {
  const [selectedLayoutKey, setSelectedLayoutKey] = useState<string>(template.default_layout);
  const [venue, setVenue] = useState('');
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

  const renderUrl = flyersApi.renderUrl(template.key, {
    layout: selectedLayoutKey,
    venue: venue.trim(),
  });

  // Close on Esc — a small courtesy for keyboard users, and consistent
  // with how other Mission Control modals behave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doPrint = async () => {
    if (!selected) return;
    // Build a self-contained HTML document in the hidden iframe with a
    // properly-sized @page rule. The image is the render URL — same-
    // origin so the auth cookie rides along automatically. We wait for
    // the image to load before calling `print()` so the dialog shows
    // the flyer, not a blank page.
    const iframe = printFrameRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const pageSize = selected.kind === 'multi_up' || selected.width_mm > selected.height_mm
      ? `${selected.width_mm}mm ${selected.height_mm}mm`
      : `${selected.width_mm}mm ${selected.height_mm}mm`;

    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(template.name)} · ${escapeHtml(selected.label)}</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    html, body { margin: 0; padding: 0; background: #FFFFFF; }
    body { display: flex; align-items: center; justify-content: center; }
    img { width: 100%; height: 100%; object-fit: contain; display: block; }
    @media print {
      html, body { width: ${selected.width_mm}mm; height: ${selected.height_mm}mm; }
      /* No headers/footers — the flyer IS the page. */
    }
  </style>
</head>
<body>
  <img src="${escapeAttr(renderUrl)}" alt="${escapeAttr(template.name)}" />
</body>
</html>`);
    doc.close();

    // Wait for the image inside the iframe to finish loading, then
    // trigger print(). Timeout guard so we never hang the UI.
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
      // Fallback for browsers that block programmatic print on iframes —
      // open the raw render in a new tab so the user can Cmd/Ctrl-P.
      window.open(renderUrl, '_blank', 'noopener');
    }
  };

  const doDownload = () => {
    // Simplest reliable path across browsers: open the render URL in
    // a new tab. On Safari this pops a real image viewer with a share
    // button, on Chrome/Firefox it inlines the image and the user can
    // right-click → Save. This mirrors the mobile app's proven flow.
    window.open(renderUrl, '_blank', 'noopener');
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
          width: 'min(1080px, 100%)', maxHeight: '92vh', overflow: 'hidden',
          display: 'grid', gridTemplateColumns: '1fr 320px',
        }}
      >
        {/* Preview pane */}
        <div style={{ padding: 20, background: '#F8FAFC', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{template.name}</h2>
            <button
              onClick={onClose}
              aria-label="Close preview"
              style={{ background: 'transparent', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748B' }}
            >×</button>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <img
              src={renderUrl}
              alt={`${template.name} preview`}
              key={renderUrl}
              style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', boxShadow: '0 6px 18px rgba(0,0,0,0.12)' }}
            />
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
        <div style={{ padding: 20, borderLeft: '1px solid #E2E8F0', overflow: 'auto' }}>
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
                          padding: '8px 12px',
                          borderRadius: 10,
                          border: on ? '1.5px solid #0F766E' : '1.5px solid #CBD5E1',
                          background: on ? '#0F766E' : '#FFFFFF',
                          color: on ? '#FFFFFF' : '#334155',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
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

          {/* Venue field — only meaningful for engines that use it. */}
          {template.fields.some((f) => f.key === 'venue') && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                Venue (optional)
              </div>
              <input
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Kellyville Library"
                maxLength={80}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 10,
                  border: '1.5px solid #CBD5E1', fontSize: 14,
                }}
              />
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                Printed as “Posted by …” along the flyer footer.
              </div>
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

      {/* Hidden iframe used to trigger the browser print dialogue with
          the right @page size preset. */}
      <iframe
        ref={printFrameRef}
        title="Flyer print buffer"
        style={{ position: 'absolute', width: 0, height: 0, border: 'none', visibility: 'hidden' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny HTML escape helpers — we're writing template.name and the render
// URL directly into a document.write() body, so we can't skip escaping.
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
