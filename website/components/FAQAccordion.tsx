'use client';

import { useState } from 'react';
import type { FAQ } from '@/lib/api';

export default function FAQAccordion({ faqs }: { faqs: FAQ[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {faqs.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            style={{
              background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              style={{
                width: '100%', textAlign: 'left', padding: '20px 24px',
                background: 'transparent', border: 0,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 16, fontSize: 17, fontWeight: 700, color: '#0A2540',
              }}
            >
              <span>{f.q}</span>
              <span style={{
                width: 32, height: 32, borderRadius: 999,
                background: isOpen ? '#14B8A6' : '#F1F5F9',
                color: isOpen ? '#FFFFFF' : '#475569',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, fontWeight: 800, flexShrink: 0,
                transition: 'all 180ms',
              }}>{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 24px 20px', color: '#334155', fontSize: 16, lineHeight: 1.7 }}>
                {f.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
