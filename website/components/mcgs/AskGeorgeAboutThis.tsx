'use client';

import { useCallback } from 'react';
import { GeorgeButterflyMark } from '@/components/george/GeorgeButterflyMark';

/**
 * "Ask George about this" — the small reusable affordance that lives on
 * every admin list row and detail page from Slice 1 onwards.
 *
 * Design principles (from Garry's brief):
 *
 * • Never gimmicky. Every invocation MUST carry meaningful context
 *   (a member id, a report id, an event id, etc.) plus one or more
 *   suggested prompts that map to the current surface.
 *
 * • Zero prop-drilling. Clicking dispatches the global custom event
 *   `mcgs:ask-george` — the AdminShell listens once and passes the
 *   message straight into the Ask George bar.
 *
 * • Always a plain button — no fancy overlays, no popovers.
 *
 * Usage:
 *
 *   <AskGeorgeAboutThis
 *     label="Ask George about this report"
 *     prompts={[
 *       `Summarise report ${reportId}.`,
 *       `Compare @${username}'s previous reports.`,
 *       `Suggest an appropriate moderation action for report ${reportId}.`,
 *     ]}
 *   />
 *
 * If more than one prompt is supplied a compact menu is shown. If only
 * one prompt is supplied, clicking the button opens George immediately
 * with that prompt.
 */
export interface AskGeorgeAboutThisProps {
  /** Optional label — defaults to "Ask George about this". */
  label?: string;
  /** One or more suggested prompts. First is the default action. */
  prompts: string[];
  /** Compact form (icon only) for use inside list rows. */
  compact?: boolean;
  /** Optional context id used for analytics later. */
  contextId?: string;
  /** Optional context type used for analytics later. */
  contextType?: string;
  /**
   * Structured surface context sent to George on THIS turn only, so
   * prompts like "summarise this member's history" can be answered
   * immediately without George having to ask "which member?".
   *
   * Accepted shape:
   *   {
   *     surface: 'member_profile' | 'report' | ...
   *     member?: { id, display_name, email, username, created_at,
   *                status, restricted_reason }
   *     counts?: { reports_open, warnings, suspensions, bans, ... }
   *     recent_actions?: [{ action, at, by, reason, duration_hours }]
   *     recent_reports?:  [{ id, status, reason, at, urgent }]
   *   }
   */
  context?: Record<string, unknown>;
}

export function AskGeorgeAboutThis({
  label = 'Ask George about this',
  prompts,
  compact = false,
  contextId,
  contextType,
  context,
}: AskGeorgeAboutThisProps) {
  const ask = useCallback(
    (prompt: string) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent('mcgs:ask-george', {
          detail: { message: prompt, contextId, contextType, context },
        }),
      );
    },
    [contextId, contextType, context],
  );

  if (!prompts || prompts.length === 0) return null;

  // Single-prompt: one plain click → open George.
  if (prompts.length === 1) {
    return (
      <button
        type="button"
        onClick={() => ask(prompts[0])}
        title={prompts[0]}
        style={compact ? compactBtn : primaryBtn}
        aria-label={label}
      >
        <span aria-hidden style={{ display: 'inline-flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}><GeorgeButterflyMark size={14} /></span>
        {!compact && <span>{label}</span>}
      </button>
    );
  }

  // Multi-prompt: <details> disclosure gives us a lightweight menu with
  // no JS state, keyboard-accessible by default and closes on outside
  // click via native browser behaviour.
  return (
    <details style={{ position: 'relative', display: 'inline-block' }}>
      <summary
        style={{
          ...(compact ? compactBtn : primaryBtn),
          listStyle: 'none',
          cursor: 'pointer',
        }}
        aria-label={label}
      >
        <span aria-hidden style={{ display: 'inline-flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}><GeorgeButterflyMark size={14} /></span>
        {!compact && <span>{label}</span>}
        {!compact && <span aria-hidden style={{ opacity: 0.6, marginLeft: 2 }}>▾</span>}
      </summary>
      <div style={menu}>
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => ask(p)}
            style={menuItem}
            title={p}
          >
            {p}
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * Small hook for programmatic use — e.g. from a keyboard shortcut or
 * an inline "explain this" link in body copy.
 */
export function useAskGeorge() {
  return useCallback(
    (prompt: string, ctx?: { id?: string; type?: string; context?: Record<string, unknown> }) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent('mcgs:ask-george', {
          detail: {
            message: prompt,
            contextId: ctx?.id,
            contextType: ctx?.type,
            context: ctx?.context,
          },
        }),
      );
    },
    [],
  );
}

// ─── styles ────────────────────────────────────────────────────────────
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 700,
  color: '#0F172A',
  background: 'linear-gradient(180deg, #FEFCE8 0%, #FEF3C7 100%)',
  border: '1px solid #FBBF24',
  borderRadius: 999,
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  transition: 'background 120ms ease, transform 120ms ease',
};

const compactBtn: React.CSSProperties = {
  ...primaryBtn,
  padding: '4px 8px',
  fontSize: 12,
};

const menu: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  minWidth: 260,
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(15,23,42,0.16)',
  padding: 6,
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const menuItem: React.CSSProperties = {
  textAlign: 'left',
  padding: '9px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: '#0F172A',
  background: 'transparent',
  border: 0,
  borderRadius: 8,
  cursor: 'pointer',
  lineHeight: 1.35,
};
