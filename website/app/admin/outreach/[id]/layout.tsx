'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Contact-detail navigation helper.
 *
 * When a contact is opened from a category/contact list, Back returns through
 * browser history to that exact list (including its in-memory filters/scroll
 * state when Next/browser preserves them). Direct/deep links fall back to the
 * Organisation Outreach landing page.
 */
export default function OutreachContactDetailLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/admin/outreach');
  };

  return (
    <>
      {children}
      <button
        type="button"
        onClick={goBack}
        aria-label="Back to contact list"
        title="Back to contact list"
        style={{
          position: 'fixed',
          left: 260,
          top: 82,
          zIndex: 40,
          border: '1px solid #CBD5E1',
          borderRadius: 999,
          background: '#FFFFFF',
          color: '#0F766E',
          fontSize: 13,
          fontWeight: 800,
          padding: '8px 12px',
          boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)',
          cursor: 'pointer',
        }}
      >
        ← Back to contact list
      </button>
    </>
  );
}
