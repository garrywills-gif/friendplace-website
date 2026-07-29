'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cmsApi } from '@/lib/cms-api';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';

type MediaItem = {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size_bytes: number;
  alt?: string;
  created_at: string;
  provider?: string;
};

function MediaLibraryInner() {
  const search = useSearchParams();
  const shouldAutoOpen = search.get('upload') === '1';
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingAlt, setEditingAlt] = useState<Record<string, string>>({});

  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://belong-together.emergent.host';
  const absUrl = (u: string) => (u.startsWith('http') ? u : `${BASE}${u}`);

  const load = async () => {
    setLoading(true);
    try {
      const r = await cmsApi.listMedia();
      setItems(r.items || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load media');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Deep-link support: /admin/media?upload=1 auto-opens the native
  // file picker once the page has mounted. Powered by the "Upload
  // Image" Quick Action on the Mission Control dashboard.
  useEffect(() => {
    if (shouldAutoOpen && uploadInputRef.current) {
      // Defer to next tick so the input is definitely in the DOM.
      const t = setTimeout(() => uploadInputRef.current?.click(), 120);
      return () => clearTimeout(t);
    }
  }, [shouldAutoOpen]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const item = await cmsApi.uploadMedia(files[i]);
        setItems(prev => [item, ...prev]);
      }
      flashToast('Uploaded');
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally { setUploading(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    try {
      await cmsApi.deleteMedia(id);
      setItems(prev => prev.filter(m => m.id !== id));
      flashToast('Deleted');
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  };

  const saveAlt = async (id: string) => {
    const alt = editingAlt[id];
    if (alt === undefined) return;
    try {
      await cmsApi.updateMedia(id, { alt });
      setItems(prev => prev.map(m => (m.id === id ? { ...m, alt } : m)));
      setEditingAlt(prev => { const c = { ...prev }; delete c[id]; return c; });
      flashToast('Alt text saved');
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      flashToast('URL copied');
    } catch {
      window.prompt('Copy this URL:', url);
    }
  };

  const flashToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1800); };

  return (
    <AdminShell title="Media library">
      <p style={{ color: '#475569', fontSize: 16, marginTop: -12, marginBottom: 24, maxWidth: 720 }}>
        Upload reusable images once, then reference them anywhere on the site. When we&apos;re ready to move to Cloudinary, existing URLs stay valid — nothing on your pages will break.
      </p>

      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label className="cms-btn-primary" style={{ ...s.primaryBtn, display: 'inline-block', textAlign: 'center' }}>
          <input ref={uploadInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                 onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }} />
          {uploading ? 'Uploading…' : '+ Upload images'}
        </label>
        <div style={{ color: '#64748B', fontSize: 13 }}>
          Up to 10 MB per image • JPEG, PNG, WebP, GIF, SVG
        </div>
        {error && <div style={{ color: '#B91C1C', fontSize: 14 }}>{error}</div>}
      </div>

      {loading ? (
        <p style={{ color: '#64748B' }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', padding: 64, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
          <p style={{ color: '#475569', fontSize: 16 }}>No images yet. Upload your first above.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {items.map(m => {
            const url = absUrl(m.url);
            const currentAlt = editingAlt[m.id] !== undefined ? editingAlt[m.id] : (m.alt || '');
            return (
              <div key={m.id} style={{ ...s.card, marginBottom: 0, padding: 0, overflow: 'hidden' }}>
                <img src={url} alt={m.alt || m.filename} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', background: '#F1F5F9' }} />
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{m.filename}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 12 }}>
                    {(m.size_bytes / 1024).toFixed(0)} KB • {m.mime}
                  </div>
                  <label style={{ ...s.label, fontSize: 11 }}>Alt text (for accessibility)</label>
                  <input
                    className="cms-input" style={{ ...s.input, padding: '8px 10px', fontSize: 13 }}
                    value={currentAlt}
                    onChange={e => setEditingAlt(prev => ({ ...prev, [m.id]: e.target.value }))}
                    onBlur={() => { if (editingAlt[m.id] !== undefined) saveAlt(m.id); }}
                    placeholder="e.g. Two women laughing over coffee"
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="cms-btn-ghost" style={{ ...s.ghostBtn, padding: '8px 12px', fontSize: 12, flex: 1 }} onClick={() => copyUrl(url)}>Copy URL</button>
                    <button className="cms-btn-danger" style={{ ...s.dangerBtn, padding: '8px 12px', fontSize: 12 }} onClick={() => remove(m.id)}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div style={s.toast}>{toast}</div>}
    </AdminShell>
  );
}

/**
 * `useSearchParams` requires a Suspense boundary in the Next.js App
 * Router so static rendering doesn't bail out. This wrapper keeps the
 * page prerenderable and only defers reading the query string.
 */
export default function MediaLibraryPage() {
  return (
    <Suspense fallback={<AdminShell title="Media library"><p style={{ color: '#64748B' }}>Loading…</p></AdminShell>}>
      <MediaLibraryInner />
    </Suspense>
  );
}
