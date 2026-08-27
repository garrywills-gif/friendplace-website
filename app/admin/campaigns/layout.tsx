import Link from 'next/link';

export default function CampaignsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Link
        href="/admin/campaigns/templates"
        aria-label="Open campaign email templates"
        title="Campaign email templates"
        style={{
          position: 'fixed',
          left: 252,
          bottom: 20,
          zIndex: 120,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 13px',
          borderRadius: 999,
          background: '#FFFFFF',
          color: '#0F766E',
          border: '1px solid #99F6E4',
          boxShadow: '0 8px 24px rgba(15,118,110,0.16)',
          textDecoration: 'none',
          fontSize: 12,
          fontWeight: 900,
          fontFamily: 'Public Sans, system-ui, sans-serif',
        }}
      >
        <span aria-hidden>✉️</span>
        Campaign templates
      </Link>
    </>
  );
}
