'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Auth page container — used by setup / login / forgot / reset. Keeps
 * those pages visually consistent without repeating layout code.
 */
export function AuthShell({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div style={outer}>
      <div style={card}>
        <Link href="/" style={brand}>
          <span style={{ fontSize: 26 }}>🦋</span>
          <span>FriendPlace</span>
        </Link>
        <div style={{ marginTop: 8, fontSize: 12, letterSpacing: '0.15em', color: '#14B8A6', fontWeight: 800, textTransform: 'uppercase' }}>
          Mini-CMS
        </div>
        <h1 style={h1}>{title}</h1>
        {subtitle && <p style={sub}>{subtitle}</p>}
        <div style={{ marginTop: 24 }}>{children}</div>
      </div>
    </div>
  );
}

const outer: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(180deg, #F0FDFA 0%, #FEFCF8 100%)',
  fontFamily: 'Public Sans, system-ui, sans-serif',
  padding: 24,
};
const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: '#FFFFFF',
  padding: 40,
  borderRadius: 24,
  border: '1px solid #E2E8F0',
  boxShadow: '0 20px 60px rgba(10,37,64,0.08)',
};
const brand: React.CSSProperties = {
  display: 'inline-flex',
  gap: 10,
  alignItems: 'center',
  color: '#0A2540',
  textDecoration: 'none',
  fontSize: 22,
  fontWeight: 900,
};
const h1: React.CSSProperties = { fontSize: 26, color: '#0A2540', marginTop: 16, marginBottom: 8, fontWeight: 900 };
const sub: React.CSSProperties = { color: '#475569', fontSize: 15, lineHeight: 1.6, marginTop: 0 };

export const authStyles = {
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 6 } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1.5px solid #CBD5E1',
    fontSize: 15,
    fontFamily: 'inherit',
    background: '#FFFFFF',
    color: '#0A2540',
    outline: 'none',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  primaryBtn: {
    width: '100%',
    padding: '14px 20px',
    borderRadius: 14,
    border: 'none',
    background: 'linear-gradient(135deg, #14B8A6, #0EA5A0)',
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(20,184,166,0.35)',
  } as React.CSSProperties,
  ghostLink: { color: '#14B8A6', fontSize: 14, fontWeight: 700, textDecoration: 'none' } as React.CSSProperties,
  errorBox: {
    padding: 14,
    borderRadius: 12,
    background: 'rgba(239,68,68,0.08)',
    color: '#B91C1C',
    fontSize: 14,
    border: '1px solid rgba(239,68,68,0.25)',
    marginBottom: 16,
  } as React.CSSProperties,
  successBox: {
    padding: 14,
    borderRadius: 12,
    background: 'rgba(20,184,166,0.10)',
    color: '#0F766E',
    fontSize: 14,
    border: '1px solid rgba(20,184,166,0.30)',
    marginBottom: 16,
  } as React.CSSProperties,
};
