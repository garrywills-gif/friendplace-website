'use client';

/**
 * Segment builder — new or existing segment.
 *
 * Live audience preview updates 250ms after each filter change. Locked
 * with Garry, 1 Aug 2026: "That feedback makes the builder feel alive."
 *
 * Route: `/admin/segments/[id]` — `id` may be a real segment id or the
 * sentinel `new` for a fresh build.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminShell, adminStyles as s } from '@/components/admin/AdminShell';
import {
  segmentsApi,
  type Segment,
  type SegmentFilter,
  type SegmentPredicateNode,
  type SegmentPreview,
} from '@/lib/cms-api';

type FilterRow = { id: string; value: unknown };

export default function SegmentBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sid = params?.id as string;
  const isNew = sid === 'new';

  const [catalog, setCatalog] = useState<SegmentFilter[] | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [preview, setPreview] = useState<SegmentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load filter catalog + existing segment (if editing).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cat = await segmentsApi.filters();
        if (cancelled) return;
        setCatalog(cat.filters);
        if (!isNew) {
          const seg = await segmentsApi.get(sid);
          if (cancelled) return;
          setName(seg.name);
          setEmoji(seg.emoji || '');
          setDescription(seg.description || '');
          setRows(predicateToRows(seg.predicate as any));
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not load builder');
      }
    })();
    return () => { cancelled = true; };
  }, [sid, isNew]);

  // Build the predicate whenever rows change.
  const predicate = useMemo(() => rowsToPredicate(rows), [rows]);

  // Live preview — debounced 250ms after last change.
  const previewTimer = useRef<any>(null);
  useEffect(() => {
    if (!catalog) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const p = await segmentsApi.preview(predicate);
        setPreview(p);
      } catch (e: any) {
        setPreview(null);
        setErr(e?.message || 'Preview failed');
      } finally {
        setPreviewing(false);
      }
    }, 250);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [predicate, catalog]);

  const addRow = (filterId: string) => {
    if (!catalog) return;
    const f = catalog.find((x) => x.id === filterId);
    if (!f) return;
    setRows((prev) => [...prev, { id: filterId, value: defaultValueFor(f) }]);
  };

  const updateRow = (i: number, value: unknown) => {
    setRows((prev) => prev.map((r, ix) => (ix === i ? { ...r, value } : r)));
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, ix) => ix !== i));
  };

  const onSave = async () => {
    if (!name.trim()) { setErr('Please give the segment a name.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const body: Partial<Segment> = {
        name: name.trim(),
        emoji: emoji.trim() || undefined,
        description: description.trim() || undefined,
        predicate,
      };
      const saved = isNew
        ? await segmentsApi.create(body)
        : await segmentsApi.update(sid, body);
      router.push(`/admin/segments`);
    } catch (e: any) {
      setErr(e?.message || 'Could not save segment');
      setSaving(false);
    }
  };

  return (
    <AdminShell title={isNew ? 'New segment' : 'Edit segment'}>
      <div style={{ marginTop: -8, marginBottom: 20 }}>
        <Link href="/admin/segments" style={{ color: '#0F766E', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          ← All segments
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24, alignItems: 'flex-start' }}>
        {/* LEFT — builder */}
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 60 }}>
              <label style={s.label}>Emoji</label>
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🦋"
                maxLength={4}
                style={{ ...s.input, textAlign: 'center', fontSize: 22 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Segment name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Gardeners"
                style={s.input}
              />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>Description <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="People who have Gardening as an interest."
              style={s.input}
            />
          </div>

          <div style={s.label}>Filters</div>
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 16, padding: 16 }}>
            {rows.length === 0 && (
              <div style={{ color: '#64748B', fontSize: 13, marginBottom: 12 }}>
                No filters yet — this segment will include everyone in FriendPlace.
                Add a filter below to narrow it down.
              </div>
            )}
            {rows.map((r, i) => {
              const f = catalog?.find((x) => x.id === r.id);
              if (!f) return null;
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 20 }}>{f.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0A2540', minWidth: 140 }}>
                    {f.label}
                  </span>
                  <FilterValueControl filter={f} value={r.value} onChange={(v) => updateRow(i, v)} />
                  <button
                    onClick={() => removeRow(i)}
                    style={{
                      cursor: 'pointer', border: 'none', background: 'transparent',
                      color: '#B91C1C', fontSize: 20, fontWeight: 700, marginLeft: 'auto',
                    }}
                    aria-label="Remove filter"
                  >×</button>
                </div>
              );
            })}
            <FilterAdder catalog={catalog} onAdd={addRow} />
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button onClick={onSave} disabled={saving} style={s.primaryBtn}>
              {saving ? 'Saving…' : isNew ? 'Create segment' : 'Save changes'}
            </button>
            <Link href="/admin/segments" style={{ ...s.ghostBtn, textDecoration: 'none' }}>
              Cancel
            </Link>
          </div>
          {err && <p style={{ color: '#B91C1C', marginTop: 12 }}>{err}</p>}
        </div>

        {/* RIGHT — live audience estimate */}
        <div style={{
          position: 'sticky', top: 20,
          background: '#F0FDFA', border: '2px solid #99F6E4', borderRadius: 20, padding: 20,
        }}>
          <div style={{ fontSize: 11, color: '#0F766E', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 800 }}>
            Estimated audience {previewing && <span style={{ marginLeft: 6, color: '#0F766E' }}>·</span>}
          </div>
          <div style={{
            fontSize: 56, fontWeight: 900, color: '#0F766E', lineHeight: 1, marginTop: 8,
            fontVariantNumeric: 'tabular-nums',
            opacity: previewing ? 0.5 : 1, transition: 'opacity 0.15s',
          }}>
            {preview ? preview.count.toLocaleString('en-AU') : '—'}
          </div>
          <div style={{ fontSize: 13, color: '#134E4A', fontWeight: 600, marginTop: 4 }}>
            member{(preview?.count || 0) === 1 ? '' : 's'}
          </div>
          {preview?.summary && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: '#FFFFFF', borderRadius: 10, fontSize: 12, color: '#0F766E', lineHeight: 1.5 }}>
              {preview.summary}
            </div>
          )}
          {preview && preview.sample.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: '#0F766E', fontWeight: 700, marginBottom: 6 }}>Sample</div>
              {preview.sample.slice(0, 4).map((m, i) => (
                <div key={i} style={{ fontSize: 12, color: '#134E4A', padding: '4px 0' }}>
                  {m.avatar || '👤'} {m.first_name || m.username || '(unnamed)'} — <span style={{ color: '#64748B' }}>{m.suburb || 'unknown suburb'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

// ── Predicate ↔ rows helpers ─────────────────────────────────────
function rowsToPredicate(rows: FilterRow[]): SegmentPredicateNode | Record<string, never> {
  const clean = rows
    .filter((r) => r.id && r.value !== '' && r.value !== null && r.value !== undefined)
    .map((r) => ({ op: 'filter' as const, id: r.id, value: r.value }));
  if (clean.length === 0) return {};
  if (clean.length === 1) return clean[0];
  return { op: 'and', children: clean };
}

function predicateToRows(pred: any): FilterRow[] {
  if (!pred || !pred.op) return [];
  if (pred.op === 'filter') return [{ id: pred.id, value: pred.value }];
  if (pred.op === 'and' && Array.isArray(pred.children)) {
    return pred.children
      .filter((c: any) => c && c.op === 'filter')
      .map((c: any) => ({ id: c.id, value: c.value }));
  }
  return [];
}

function defaultValueFor(f: SegmentFilter): unknown {
  switch (f.value_type) {
    case 'boolean':    return true;
    case 'days':       return f.value_hint.default ?? 30;
    case 'number':     return f.value_hint.default ?? 0;
    case 'enum':       return f.value_hint.options?.[0] ?? '';
    case 'multi_enum': return [];
    case 'text':       return '';
    default:           return null;
  }
}

// ── Filter value controls ────────────────────────────────────────
function FilterValueControl({ filter, value, onChange }: {
  filter: SegmentFilter; value: unknown; onChange: (v: unknown) => void;
}) {
  const style: React.CSSProperties = { padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, minWidth: 140 };
  switch (filter.value_type) {
    case 'boolean':
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value === 'true')} style={style}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'days':
    case 'number':
      return (
        <input
          type="number" min={filter.value_hint.min ?? 1} max={filter.value_hint.max ?? 365}
          value={String(value ?? '')} onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...style, minWidth: 90 }}
        />
      );
    case 'enum':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={style}>
          {(filter.value_hint.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'multi_enum': {
      // Comma-separated string input for v1 — a chip picker is a future polish.
      const arr = Array.isArray(value) ? value : [];
      return (
        <input
          value={arr.join(', ')}
          onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="Gardening, Books"
          style={{ ...style, minWidth: 220 }}
        />
      );
    }
    case 'text':
      return (
        <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}
          placeholder={filter.label} style={style} />
      );
    default:
      return null;
  }
}

function FilterAdder({ catalog, onAdd }: { catalog: SegmentFilter[] | null; onAdd: (id: string) => void }) {
  const [pick, setPick] = useState('');
  if (!catalog) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        style={{ flex: 1, padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, background: '#FFFFFF' }}
      >
        <option value="">+ Add a filter…</option>
        {catalog.map((f) => (
          <option key={f.id} value={f.id}>{f.emoji}  {f.label}</option>
        ))}
      </select>
      <button
        onClick={() => { if (pick) { onAdd(pick); setPick(''); } }}
        disabled={!pick}
        style={{
          cursor: pick ? 'pointer' : 'not-allowed',
          padding: '8px 14px', border: '1px solid #0F766E',
          background: pick ? '#0F766E' : '#F1F5F9',
          color: pick ? '#FFFFFF' : '#94A3B8',
          borderRadius: 8, fontSize: 13, fontWeight: 800,
        }}
      >
        Add
      </button>
    </div>
  );
}
