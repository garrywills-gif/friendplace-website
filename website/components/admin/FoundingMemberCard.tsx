'use client';

import type { FoundingMember } from '@/lib/cms-api';

/**
 * Canonical Founding Member card. Used by the CMS Preview modal and
 * (optionally) as a richer public rendering. The compact `avatar-only`
 * variant matches the tile grid on the homepage's Founding Members
 * section.
 */
export function FoundingMemberCard({
  member,
  variant = 'full',
}: {
  member: FoundingMember;
  variant?: 'full' | 'grid';
}) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://friendplace-v1.preview.emergentagent.com';
  const avatarUrl = member.avatar_url
    ? (member.avatar_url.startsWith('http') ? member.avatar_url : `${BASE}${member.avatar_url}`)
    : null;

  const initial = (member.name || '?').trim().charAt(0).toUpperCase() || '?';
  const isGrid = variant === 'grid';

  if (isGrid) {
    return (
      <div style={{
        background: '#FFFFFF',
        padding: 20,
        borderRadius: 16,
        border: '1px solid #E2E8F0',
        textAlign: 'center',
        fontFamily: 'Public Sans, system-ui, sans-serif',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: avatarUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#FFFFFF', fontWeight: 900, fontSize: 22,
          margin: '0 auto 12px', overflow: 'hidden',
        }}>
          {avatarUrl ? (
             
            <img src={avatarUrl} alt={member.name || 'Founding member'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : initial}
        </div>
        <div style={{ fontWeight: 800, color: '#0A2540', marginBottom: 4 }}>
          {member.name || <span style={{ color: '#94A3B8', fontStyle: 'italic', fontWeight: 700 }}>Unnamed</span>}
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>#{member.number}</div>
      </div>
    );
  }

  return (
    <article style={{
      background: '#FFFFFF',
      borderRadius: 20,
      border: '1px solid #E2E8F0',
      padding: 32,
      boxShadow: '0 4px 16px rgba(10,37,64,0.05)',
      fontFamily: 'Public Sans, system-ui, sans-serif',
      color: '#0A2540',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          background: avatarUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #38BDF8)',
          color: '#FFFFFF', fontSize: 40, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {avatarUrl ? (
             
            <img src={avatarUrl} alt={member.name || 'Founding member'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 999,
            background: '#0A2540', color: '#5EEAD4', fontSize: 11,
            fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Founding Member #{member.number}</div>
          <h2 style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2, margin: '10px 0 4px', color: '#0A2540', letterSpacing: '-0.01em' }}>
            {member.name || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Unnamed founder</span>}
          </h2>
          <div style={{ fontSize: 14, color: '#64748B' }}>
            {[member.role, member.location].filter(Boolean).join(' • ') || <span style={{ opacity: 0.6 }}>&nbsp;</span>}
          </div>
        </div>
      </div>

      {member.bio_html ? (
        <div
          className="fp-founder-bio"
          style={{ fontSize: 16, lineHeight: 1.75, color: '#334155' }}
          dangerouslySetInnerHTML={{ __html: member.bio_html }}
        />
      ) : (
        <p style={{ color: '#94A3B8', fontStyle: 'italic', margin: 0 }}>
          No bio yet…
        </p>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .fp-founder-bio p { margin: 0 0 12px; }
        .fp-founder-bio h2 { font-size: 20px; font-weight: 800; color: #0A2540; margin: 20px 0 10px; }
        .fp-founder-bio h3 { font-size: 17px; font-weight: 800; color: #0A2540; margin: 16px 0 8px; }
        .fp-founder-bio a { color: #14B8A6; text-decoration: underline; }
        .fp-founder-bio ul, .fp-founder-bio ol { margin: 8px 0 16px; padding-left: 22px; }
        .fp-founder-bio li { margin-bottom: 6px; }
        .fp-founder-bio blockquote {
          border-left: 3px solid #14B8A6;
          padding: 4px 16px; margin: 16px 0; color: #475569; font-style: italic;
          background: #F0FDFA; border-radius: 0 12px 12px 0;
        }
        .fp-founder-bio img { max-width: 100%; border-radius: 12px; margin: 12px 0; }
      ` }} />
    </article>
  );
}
