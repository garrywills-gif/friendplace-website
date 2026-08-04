'use client';

/**
 * Flyer Publishing Centre — library grid.
 *
 * The single place where every FriendPlace flyer is created, previewed,
 * printed, published, and archived. Layouts (A3 / A4 / A5 / 2-up / 4-up)
 * come from the backend registry so future layouts (DL, postcard) appear
 * here automatically without any UI edits.
 *
 * Locked with Garry, 3 Aug 2026:
 *   - Reuse the existing PIL renderer as the SOLE source of truth for
 *     flyer design.
 *   - Print A4, Print A3, and Download PDF all launch requirements.
 *   - Browser print dialogue direct — no download step required.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import { flyersApi, type FlyerTemplate, type FlyerLayoutCategory } from '@/lib/cms-api';
import { FlyerPrintModal } from '@/components/admin/FlyerPrintModal';

export default function FlyersLibraryPage() {
  const [templates, setTemplates] = useState<FlyerTemplate[] | null>(null);
  const [layoutCats, setLayoutCats] = useState<FlyerLayoutCategory[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'archived'>('all');
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);

  useEffect(() => { void load(); }, [statusFilter]);

  const load = async () => {
    setErr(null);
    try {
      const [tpls, cats] = await Promise.all([
        flyersApi.list(statusFilter === 'all' ? undefined : { status: statusFilter }),
        flyersApi.listLayouts(),
      ]);
      setTemplates(tpls.templates);
      setLayoutCats(cats.categories);
    } catch (e: any) {
      setErr(e?.message || 'Could not load flyers');
    }
  };

  // Small O(1) lookup for the "Used N times" badges and preview thumbnails.
  const layoutIndex = useMemo(() => {
    const idx = new Map<string, { label: string; category_label: string }>();
    for (const c of layoutCats) {
      for (const lay of c.layouts) {
        idx.set(lay.key, { label: lay.label, category_label: c.label });
      }
    }
    return idx;
  }, [layoutCats]);

  const runStatus = async (
    key: string,
    fn: (k: string) => Promise<FlyerTemplate>,
  ) => {
    setBusy(key);
    try { await fn(key); await load(); }
    catch (e: any) { setErr(e?.message || 'Update failed'); }
    finally { setBusy(null); }
  };

  const onDuplicate = async (key: string) => {
    setBusy(key);
    try {
      const copy = await flyersApi.duplicate(key);
      window.location.href = `/admin/flyers/${copy.key}`;
    } catch (e: any) { setErr(e?.message || 'Duplicate failed'); setBusy(null); }
  };

  const activePreview = templates?.find((t) => t.key === previewingKey) || null;

  return (
    <AdminShell title="Flyer Publishing Centre">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0A2540', margin: 0 }}>🖨️ Flyer Publishing Centre</h1>
          <p style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
            One place for every FriendPlace flyer. Preview, publish, print, and archive without leaving Mission Control.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/admin/flyers/new" style={{ ...s.primaryBtn, textDecoration: 'none' }}>
            ✨ New Flyer
          </Link>
        </div>
      </div>

      {err && (
        <div role="alert" style={{ ...s.card, borderColor: '#DC2626', background: '#FEF2F2', color: '#7F1D1D', marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'published', 'draft', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: statusFilter === f ? '1.5px solid #0F766E' : '1.5px solid #CBD5E1',
              background: statusFilter === f ? '#0F766E' : '#FFFFFF',
              color: statusFilter === f ? '#FFFFFF' : '#334155',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Library grid */}
      {!templates ? (
        <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Loading flyers…</div>
      ) : templates.length === 0 ? (
        <div style={s.card}>
          <strong>No flyers here yet.</strong>
          <div style={{ marginTop: 6, color: '#64748B' }}>
            Tap <em>New Flyer</em> above to start from a seeded template.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {templates.map((tpl) => {
            const defaultLayoutMeta = layoutIndex.get(tpl.default_layout);
            const statusColour =
              tpl.status === 'published' ? { fg: '#065F46', bg: '#D1FAE5', border: '#10B981' }
              : tpl.status === 'archived'  ? { fg: '#334155', bg: '#F1F5F9', border: '#CBD5E1' }
              : /* draft */                  { fg: '#92400E', bg: '#FEF3C7', border: '#F59E0B' };
            return (
              <div key={tpl.key} style={{ ...s.card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Thumbnail */}
                <div style={{ aspectRatio: '210 / 297', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #E2E8F0' }}>
                  {tpl.preview_image ? (
                    // Static thumbnail (community_notice)
                    <img src={tpl.preview_image} alt={tpl.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    // Live-generated preview via the render endpoint (A4).
                    <img
                      src={flyersApi.renderUrl(tpl.key, { layout: tpl.default_layout })}
                      alt={tpl.name}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  )}
                </div>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{tpl.name}</strong>
                    <span style={{
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                      color: statusColour.fg, background: statusColour.bg,
                      border: `1px solid ${statusColour.border}`, textTransform: 'uppercase',
                    }}>
                      {tpl.status}
                    </span>
                  </div>
                  <div style={{ color: '#64748B', fontSize: 13, minHeight: 36 }}>
                    {tpl.description}
                  </div>
                  <div style={{ color: '#64748B', fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>Default: <strong>{defaultLayoutMeta?.label ?? tpl.default_layout}</strong></span>
                    <span>Used {tpl.used_count ?? 0}×</span>
                  </div>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                    <button
                      onClick={() => setPreviewingKey(tpl.key)}
                      style={{ ...s.primaryBtn, flex: 1, minWidth: 100 }}
                    >
                      👁 Preview
                    </button>
                    <Link href={`/admin/flyers/${tpl.key}`} style={{ ...s.ghostBtn, textDecoration: 'none', flex: 1, minWidth: 90, textAlign: 'center' }}>
                      ✏️ Edit
                    </Link>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {tpl.status === 'published' ? (
                      <button
                        disabled={busy === tpl.key}
                        onClick={() => runStatus(tpl.key, flyersApi.unpublish)}
                        style={{ ...s.ghostBtn, flex: 1, minWidth: 90 }}
                      >
                        📥 Unpublish
                      </button>
                    ) : tpl.status !== 'archived' ? (
                      <button
                        disabled={busy === tpl.key}
                        onClick={() => runStatus(tpl.key, flyersApi.publish)}
                        style={{ ...s.ghostBtn, flex: 1, minWidth: 90 }}
                      >
                        📢 Publish
                      </button>
                    ) : null}
                    <button
                      disabled={busy === tpl.key}
                      onClick={() => onDuplicate(tpl.key)}
                      style={{ ...s.ghostBtn, flex: 1, minWidth: 90 }}
                    >
                      🖨 Duplicate
                    </button>
                    {tpl.status !== 'archived' ? (
                      <button
                        disabled={busy === tpl.key}
                        onClick={() => {
                          if (!confirm(`Archive "${tpl.name}"? You can restore it later from the archived filter.`)) return;
                          void runStatus(tpl.key, flyersApi.archive);
                        }}
                        style={{ ...s.ghostBtn, flex: 1, minWidth: 90 }}
                      >
                        📦 Archive
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview + print modal */}
      {activePreview && (
        <FlyerPrintModal
          template={activePreview}
          layoutCategories={layoutCats}
          onClose={() => setPreviewingKey(null)}
        />
      )}
    </AdminShell>
  );
}
