'use client';

import { Suspense, useState, useEffect } from 'react';
import { AdminShell } from '@/components/admin/AdminShell';
import { GeorgeEventChat } from '@/components/mcgs/GeorgeEventChat';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

/**
 * The Admin Chat Surface — a focused place to create an event with
 * George through conversation. Reached from George's Workspace, the
 * Bridge's suggestion card, or directly.
 */
export default function NewEventPage() {
  return (
    <AdminShell>
      <div style={header}>
        <Link href="/admin/george" style={crumb}>&larr; George&rsquo;s Workspace</Link>
        <h1 style={h1}>Create an Event with George</h1>
        <p style={sub}>
          Just tell me about it in your own words. I&rsquo;ll pull the shape
          of it together and check with you before anything goes live.
        </p>
      </div>
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>Setting up&hellip;</div>}>
        <ChatShell />
      </Suspense>
    </AdminShell>
  );
}

function ChatShell() {
  const params = useSearchParams();
  const [seed, setSeed] = useState<string | undefined>();
  useEffect(() => {
    const s = params.get('seed');
    if (s) setSeed(s);
  }, [params]);
  return <GeorgeEventChat seedMessage={seed} />;
}

const header: React.CSSProperties = {
  maxWidth: 780, margin: '0 auto 8px', padding: '2px 4px',
};
const crumb: React.CSSProperties = {
  fontSize: 12, color: '#64748B', textDecoration: 'none',
  fontWeight: 600, display: 'inline-block', marginBottom: 8,
};
const h1: React.CSSProperties = {
  fontSize: 26, margin: '2px 0 4px', letterSpacing: '-0.01em', color: '#0F172A',
};
const sub: React.CSSProperties = {
  fontSize: 14, color: '#64748B', margin: 0, lineHeight: 1.6, maxWidth: 620,
};
