'use client';

import type { SuccessStory } from '@/lib/cms-api';

/**
 * Canonical Success Story card component.
 *
 * Used in three places to guarantee "what you see is what visitors
 * see":
 *   1. /admin/success-stories/[id]   — preview modal
 *   2. /admin/success-stories        — list snippet (compact variant)
 *   3. /success-stories              — public grid
 *
 * Keep this component free of admin-only fields (status / hidden).
 * Those belong on the admin list, not the public rendering.
 */
export function StoryCard({
  story,
  variant = 'full',
}: {
  story: SuccessStory;
  variant?: 'full' | 'compact';
}) {
  const BASE = process.env.NEXT_PUBLIC_API_URL || 'https://george-mcgs-cms.preview.emergentagent.com';
  const avatarUrl = story.author_avatar_url
    ? (story.author_avatar_url.startsWith('http')
        ? story.author_avatar_url
        : `${BASE}${story.author_avatar_url}`)
    : null;

  const roleAndLocation = [story.author_role, story.author_location]
    .filter(Boolean)
    .join(' • ');

  const isCompact = variant === 'compact';

  return (
    <article style={{
      background: '#FFFFFF',
      borderRadius: 20,
      border: '1px solid #E2E8F0',
      padding: isCompact ? 22 : 32,
      boxShadow: isCompact ? 'none' : '0 4px 16px rgba(10,37,64,0.05)',
      fontFamily: 'Public Sans, system-ui, sans-serif',
      color: '#0A2540',
    }}>
      <h2 style={{
        fontSize: isCompact ? 20 : 26,
        fontWeight: 900,
        lineHeight: 1.25,
        margin: 0,
        marginBottom: 16,
        color: '#0A2540',
        letterSpacing: '-0.01em',
      }}>
        {story.title || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Untitled story</span>}
      </h2>

      {/* Story body — rendered from TipTap HTML. Trusted input
          (admin-authored). See CMS README for the sanitisation note. */}
      {story.body_html ? (
        <div
          className="fp-story-body"
          style={{
            fontSize: isCompact ? 15 : 16,
            lineHeight: 1.75,
            color: '#334155',
            marginBottom: 24,
          }}
          dangerouslySetInnerHTML={{ __html: story.body_html }}
        />
      ) : (
        <p style={{ color: '#94A3B8', fontStyle: 'italic', marginBottom: 24 }}>
          No story yet…
        </p>
      )}

      {/* Author strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        paddingTop: 16,
        borderTop: '1px solid #F1F5F9',
      }}>
        <div style={{
          width: isCompact ? 44 : 52,
          height: isCompact ? 44 : 52,
          borderRadius: '50%',
          background: avatarUrl ? '#F1F5F9' : 'linear-gradient(135deg, #14B8A6, #0EA5A0)',
          color: '#FFFFFF',
          fontSize: isCompact ? 18 : 22,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {avatarUrl ? (
             
            <img
              src={avatarUrl}
              alt={story.author_name || 'Author'}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            (story.author_name || '?').slice(0, 1).toUpperCase()
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isCompact ? 14 : 16, fontWeight: 800, color: '#0A2540' }}>
            {story.author_name || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Author name</span>}
          </div>
          {roleAndLocation && (
            <div style={{ fontSize: isCompact ? 12 : 13, color: '#64748B', marginTop: 2 }}>
              {roleAndLocation}
            </div>
          )}
        </div>
      </div>

      {/* Inline style block so the TipTap HTML matches the design system
          on both preview and public site. Kept scoped by className. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .fp-story-body p { margin: 0 0 12px; }
        .fp-story-body h2 { font-size: 20px; font-weight: 800; color: #0A2540; margin: 20px 0 10px; }
        .fp-story-body h3 { font-size: 17px; font-weight: 800; color: #0A2540; margin: 16px 0 8px; }
        .fp-story-body a { color: #14B8A6; text-decoration: underline; }
        .fp-story-body ul, .fp-story-body ol { margin: 8px 0 16px; padding-left: 22px; }
        .fp-story-body li { margin-bottom: 6px; }
        .fp-story-body blockquote {
          border-left: 3px solid #14B8A6;
          padding: 4px 16px; margin: 16px 0; color: #475569; font-style: italic;
          background: #F0FDFA; border-radius: 0 12px 12px 0;
        }
        .fp-story-body img { max-width: 100%; border-radius: 12px; margin: 12px 0; }
      ` }} />
    </article>
  );
}
