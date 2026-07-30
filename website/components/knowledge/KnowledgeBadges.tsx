/**
 * Small shared visual atoms used across the Knowledge Library rows,
 * draft cards, and detail views. Extracted so tone/colour lands in
 * exactly one place.
 */

export function TypeBadge({ type }: { type: string }) {
  const palette: Record<string, { bg: string; fg: string; border: string; icon: string }> = {
    story:      { bg: '#EFF6FF', fg: '#1E3A8A', border: '#BFDBFE', icon: '📖' },
    principle:  { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', icon: '⚖️' },
    philosophy: { bg: '#FDF4FF', fg: '#701A75', border: '#F5D0FE', icon: '💭' },
    decision:   { bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA', icon: '📌' },
    feature:    { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A', icon: '🔧' },
    roadmap:    { bg: '#F1F5F9', fg: '#0F172A', border: '#CBD5E1', icon: '🗺️' },
  };
  const p = palette[type] || palette.decision;
  return (
    <span style={{
      background: p.bg, color: p.fg, border: `1px solid ${p.border}`,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.04em',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span aria-hidden>{p.icon}</span>
      {type}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility?: string }) {
  const isPublic = visibility === 'public';
  return (
    <span style={{
      background: isPublic ? '#ECFDF5' : '#F1F5F9',
      color: isPublic ? '#065F46' : '#0F172A',
      border: `1px solid ${isPublic ? '#A7F3D0' : '#CBD5E1'}`,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
    }}>
      {isPublic ? '🌐 Public' : '🔒 Admin'}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string; border: string }> = {
    draft:      { bg: '#FEF3C7', fg: '#78350F', border: '#FBBF24' },
    superseded: { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1' },
    discarded:  { bg: '#FEE2E2', fg: '#B91C1C', border: '#FCA5A5' },
    active:     { bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' },
  };
  const p = palette[status] || palette.active;
  return (
    <span style={{
      background: p.bg, color: p.fg, border: `1px solid ${p.border}`,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {status}
    </span>
  );
}

export function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return iso;
  }
}
