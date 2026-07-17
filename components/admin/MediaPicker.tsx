'use client';

import { useEffect, useState } from 'react';
import { cmsApi } from '@/lib/cms-api';

/**
 * Small modal that lets the user pick from the media library or upload
 * a new image right inline. Returns the absolute or relative URL of
 * the chosen media via the onPick callback.
 */
export function MediaPicker({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (url: string, alt?: string) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await cmsApi.listMedia();
      setItems(r.items || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load media');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) { setError(null); load(); } }, [open]);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const item = await cmsApi.uploadMedia(file);
      setItems(prev => [item, ...prev]);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally { setUploading(false); }
  };

  if (!open) return null;

  const BASE = process.env.NEXT_PUBLIC_API_URL || '';
  const absUrl = (u: string) => (u.startsWith('http') ? u : `${BASE}${u}`);

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <h3 style={{ margin: 0, fontSize: 18, color: '#0A2540', fontWeight: 800 }}>Media library</h3>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={uploadRow}>
          <label style={uploadBtn}>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />
            {uploading ? 'Uploading…' : '+ Upload image'}
          </label>
          {error && <div style={{ color: '#B91C1C', fontSize: 13, marginLeft: 12 }}>{error}</div>}
        </div>

        <div style={grid}>
          {loading ? <p style={{ color: '#64748B' }}>Loading…</p> : items.length === 0 ? (
            <p style={{ color: '#64748B', gridColumn: '1 / -1', textAlign: 'center', padding: 40 }}>
              No images yet. Upload your first above.
            </p>
          ) : items.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onPick(absUrl(m.url), m.alt); onClose(); }}
              style={tile}
            >
              <img src={absUrl(m.url)} alt={m.alt || m.filename} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: 6, fontSize: 11, color: '#475569', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.filename}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24,
};
const modal: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 20, maxWidth: 900, width: '100%',
  maxHeight: '85vh', display: 'flex', flexDirection: 'column',
};
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 24px', borderBottom: '1px solid #E2E8F0',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#64748B', fontSize: 20, cursor: 'pointer', padding: 4,
};
const uploadRow: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #F1F5F9' };
const uploadBtn: React.CSSProperties = {
  display: 'inline-block', padding: '10px 18px', borderRadius: 12,
  background: 'linear-gradient(135deg, #14B8A6, #0EA5A0)', color: '#FFFFFF',
  fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const grid: React.CSSProperties = {
  padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 12, overflowY: 'auto',
};
const tile: React.CSSProperties = {
  border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden',
  background: '#FFFFFF', cursor: 'pointer', padding: 0, textAlign: 'left',
};
