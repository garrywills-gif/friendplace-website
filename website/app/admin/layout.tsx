import type { Metadata } from 'next';

// The admin section MUST never be indexed regardless of the
// site-wide FRIENDPLACE_INDEXABLE flag — override the parent metadata
// with a hard noindex here.
export const metadata: Metadata = {
  title: 'Admin — FriendPlace',
  robots: { index: false, follow: false, nocache: true },
};

// Global CSS for the admin section. Kept here (rather than in each
// page) so hover/focus transitions work identically across the auth
// pages, the sidebar shell and every editor.
const ADMIN_GLOBAL_CSS = `
  /* Sidebar navigation ---------------------------------------------- */
  .cms-nav-link {
    color: #CBD5E1;
    background: transparent;
    border-left: 3px solid transparent;
    transition: color 180ms ease, background-color 220ms ease,
                border-left-color 220ms ease, padding-left 220ms ease,
                transform 180ms ease;
  }
  .cms-nav-link:hover {
    color: #FFFFFF;
    background: rgba(255,255,255,0.06);
    padding-left: 24px;
  }
  .cms-nav-link:hover > span:first-child { transform: scale(1.1); }
  .cms-nav-link > span:first-child {
    display: inline-block;
    transition: transform 180ms ease;
  }
  .cms-nav-link:active { background: rgba(94,234,212,0.20); }
  .cms-nav-link-active,
  .cms-nav-link-active:hover {
    color: #5EEAD4;
    background: rgba(94,234,212,0.15);
    border-left-color: #5EEAD4;
    padding-left: 20px;
  }
  .cms-sign-out {
    transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
  }
  .cms-sign-out:hover {
    background: rgba(255,255,255,0.10);
    border-color: rgba(255,255,255,0.35);
  }

  /* Editor buttons — shared polish across every admin page. */
  .cms-btn-primary, .cms-btn-ghost, .cms-btn-danger {
    transition: transform 160ms ease, box-shadow 220ms ease,
                background-color 200ms ease, border-color 200ms ease,
                color 200ms ease, opacity 160ms ease;
  }
  .cms-btn-primary:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 28px rgba(20,184,166,0.38);
  }
  .cms-btn-primary:not(:disabled):active {
    transform: translateY(0);
    box-shadow: 0 6px 14px rgba(20,184,166,0.28);
  }
  .cms-btn-ghost:not(:disabled):hover {
    background: #F1F5F9;
    border-color: #94A3B8;
  }
  .cms-btn-ghost:not(:disabled):active { background: #E2E8F0; }
  .cms-btn-danger:not(:disabled):hover {
    background: rgba(239,68,68,0.08);
    border-color: rgba(239,68,68,0.55);
  }

  /* Text inputs — subtle focus ring in FriendPlace teal. */
  .cms-input, .cms-textarea {
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }
  .cms-input:focus, .cms-textarea:focus {
    border-color: #14B8A6;
    box-shadow: 0 0 0 4px rgba(20,184,166,0.15);
  }

  /* Dashboard tiles ------------------------------------------------- */
  .cms-dash-card {
    transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
  }
  .cms-dash-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 16px 32px rgba(10,37,64,0.10);
    border-color: rgba(20,184,166,0.45);
  }
  .cms-dash-card-icon { transition: transform 240ms ease; }
  .cms-dash-card:hover .cms-dash-card-icon { transform: scale(1.15) rotate(-4deg); }

  /* Summary tiles at the top of Mission Control --------------------- */
  .cms-summary-card {
    transition: transform 220ms ease, box-shadow 220ms ease;
  }
  .cms-summary-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 22px rgba(10,37,64,0.06);
  }

  /* Toolbar buttons inside the TipTap editor ------------------------ */
  .cms-tt-btn { transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease; }
  .cms-tt-btn:hover { background: #F1F5F9; border-color: #94A3B8; }
`;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_GLOBAL_CSS }} />
      {children}
    </>
  );
}
