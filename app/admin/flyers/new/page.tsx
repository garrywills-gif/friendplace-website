'use client';

/**
 * New Flyer — template picker.
 *
 * At launch (Garry, 3 Aug 2026) this presents only the seeded templates.
 * Once George gains flyer-authoring tools, we can layer a "Start from
 * scratch with George's help" option here without changing the current
 * flow.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { flyersApi, type FlyerTemplate } from '@/lib/cms-api';
import { AuthedFlyerImage } from '@/components/admin/AuthedFlyerImage';
export default function NewFlyerPage() {
  const [templates, setTemplates] = useState<FlyerTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await flyersApi.list({ status: 'published' });
        setTemplates(r.templates);
      } catch (e: any) {
        setErr(e?.message || 'Could not load templates');
      }
    })();
  }, []);

  return (
    <AdminShell title="New Flyer">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0A2540', margin: 0 }}>✨ New Flyer</h1>
          <p style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Choose a starting template. Every flyer above is data-driven — adding new ones later is one document in the flyer library.</p>
        </div>
        <Link href="/admin/flyers" style={{ ...s.ghostBtn, textDecoration: 'none' }}>← Back to library</Link>
      </div>

      {err && (
        <div role="alert" style={{ ...s.card, borderColor: '#DC2626', background: '#FEF2F2', color: '#7F1D1D', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!templates ? (
        <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Loading templates…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {templates.map((tpl) => (
            <Link
              key={tpl.key}
              href={`/admin/flyers/${tpl.key}`}
              style={{ ...s.card, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 12, padding: 0, overflow: 'hidden' }}
            >
              <div style={{ aspectRatio: '210 / 297', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #E2E8F0' }}>
               {tpl.preview_image ? (
  <img
    src={tpl.preview_image}
    alt={tpl.name}
    loading="lazy"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
) : (
  <AuthedFlyerImage
  templateKey={tpl.key}
  layout={tpl.default_layout}
  alt={tpl.name}
  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
/>
)}
              </div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <strong style={{ fontSize: 16 }}>{tpl.name}</strong>
                <div style={{ color: '#64748B', fontSize: 13, minHeight: 36 }}>
                  {tpl.description}
                </div>
                <div style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>
                  Supports: {tpl.supported_layouts.length} layout{tpl.supported_layouts.length === 1 ? '' : 's'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
