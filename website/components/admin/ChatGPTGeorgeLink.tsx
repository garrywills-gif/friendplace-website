'use client';

import { usePathname } from 'next/navigation';

export function ChatGPTGeorgeLink() {
  const pathname = usePathname();

  if (!pathname || pathname === '/admin/login') return null;

  return (
    <a
      href="https://chatgpt.com/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ask George in ChatGPT"
      title="Open ChatGPT in a new tab"
      style={{
        position: 'fixed',
        left: 20,
        bottom: 126,
        zIndex: 1100,
        width: 200,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '9px 12px',
        borderRadius: 10,
        border: '1px solid rgba(94,234,212,0.38)',
        background: 'rgba(15,46,82,0.94)',
        color: '#E6FFFB',
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 800,
        lineHeight: 1.2,
        boxShadow: '0 8px 22px rgba(2,6,23,0.22)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span aria-hidden>🦋</span>
      <span>Ask George in ChatGPT</span>
      <span aria-hidden>↗</span>
    </a>
  );
}
