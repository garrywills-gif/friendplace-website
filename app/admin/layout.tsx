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

  /* Quick Action pills --------------------------------------------- */
  .cms-quick-action {
    transition: transform 160ms ease, box-shadow 220ms ease,
                border-color 200ms ease, background-color 200ms ease;
  }
  .cms-quick-action:hover {
    transform: translateY(-1px);
    border-color: rgba(20,184,166,0.55);
    background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);
    box-shadow: 0 8px 18px rgba(20,184,166,0.15);
  }
  .cms-quick-action:active { transform: translateY(0); }

  /* Toolbar buttons inside the TipTap editor ------------------------ */
  .cms-tt-btn { transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease; }
  .cms-tt-btn:hover { background: #F1F5F9; border-color: #94A3B8; }

  /* Responsive layout ------------------------------------------------
     Mission Control targets serious admin work, so we optimise for
     comfortable use on 13"–14" laptops (1366×768 and 1440×900) as well
     as standard 1920×1080 desktops. The sidebar stays fixed, but the
     main content column, its padding and any grid child columns all
     breathe as the viewport narrows. min-width: 0 on grid children
     stops long strings from forcing horizontal scroll.               */
  .cms-main-col { flex: 1; min-width: 0; width: 100%; }
  .cms-main-inner { padding: 24px 32px 64px; max-width: 1600px; margin: 0 auto; }
  @media (max-width: 1400px) { .cms-main-inner { padding: 24px 28px 56px; } }
  @media (max-width: 1280px) { .cms-main-inner { padding: 22px 22px 52px; } }
  @media (max-width: 1160px) { .cms-main-inner { padding: 20px 18px 48px; } }
  .cms-grid-child { min-width: 0; }
  .cms-two-col {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
    gap: 24px;
  }
  @media (max-width: 1360px) {
    .cms-two-col { grid-template-columns: minmax(0, 1fr) minmax(0, 300px); gap: 20px; }
  }
  @media (max-width: 1200px) {
    .cms-two-col { grid-template-columns: minmax(0, 1fr) minmax(0, 280px); gap: 18px; }
  }
  @media (max-width: 1080px) {
    /* Right rail moves below main content — no more cramped columns. */
    .cms-two-col { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  }
  /* Any table or preformatted block inside an admin card should scroll
     inside its card rather than force the whole page wider.          */
  .cms-scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
`;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_GLOBAL_CSS }} />
      {children}
    </>
  );
}
