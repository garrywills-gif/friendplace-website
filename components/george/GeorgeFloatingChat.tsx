'use client';

/**
 * A small floating chat sheet that opens when someone taps the
 * resting butterfly. It mounts the shared `GeorgeConversation`
 * component inside a compact bottom-right dialog, so George feels
 * present wherever you are rather than a place you have to go to.
 *
 * If the conversation needs more room (the Action Preview lands, or
 * the user simply wants the full canvas), the sheet exposes an
 * “Open my Workspace” link so the workspace feels like a
 * continuation, not a detour.
 */

import { useEffect } from 'react';
import { GeorgeConversation, type GeorgeConversationChrome } from './GeorgeConversation';

interface Props {
  onClose: () => void;
  onOpenWorkspace: () => void;
  seedMessage?: string;
}

export function GeorgeFloatingChat({ onClose, onOpenWorkspace, seedMessage }: Props) {
  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chrome: GeorgeConversationChrome = {
    onLeave: onClose,
    leaveLabel: 'Close',
    successActions: [
      { label: 'Back', onSelect: onClose },
    ],
  };

  return (
    <>
      <div style={backdrop} onClick={onClose} aria-hidden />
      <div style={sheet} role="dialog" aria-label="Talk to George">
        <div style={sheetHeader}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={dot} aria-hidden />
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Talking with George</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" onClick={onOpenWorkspace} style={openWorkspaceBtn}>
              Open my Workspace →
            </button>
            <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">×</button>
          </div>
        </div>
        <div style={sheetBody}>
          <GeorgeConversation seedMessage={seedMessage} chrome={chrome} />
        </div>
      </div>
      <style>{sheetKeyframes}</style>
    </>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(15,23,42,0.14)',
  zIndex: 950,
  animation: 'fp-fade-in 200ms ease-out',
};
const sheet: React.CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 96,
  width: 'min(560px, calc(100vw - 32px))',
  maxHeight: '78vh',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 20,
  boxShadow: '0 20px 50px rgba(15,23,42,0.18)',
  zIndex: 951,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  animation: 'fp-sheet-bloom 260ms cubic-bezier(0.2, 0.9, 0.3, 1)',
};
const sheetHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 16px', borderBottom: '1px solid #F1F5F9',
  background: '#F8FAFC',
};
const sheetBody: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: '4px 12px 12px',
};
const dot: React.CSSProperties = {
  width: 8, height: 8, borderRadius: 4,
  background: '#14B8A6', boxShadow: '0 0 0 4px rgba(20,184,166,0.18)',
};
const openWorkspaceBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 12, color: '#0F766E', fontWeight: 700,
  cursor: 'pointer', padding: '4px 6px',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: 24, color: '#64748B', cursor: 'pointer',
  padding: 0, lineHeight: 1,
};

const sheetKeyframes = `
@keyframes fp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fp-sheet-bloom {
  0%   { transform: translateY(20px) scale(0.96); opacity: 0; }
  100% { transform: translateY(0)   scale(1);    opacity: 1; }
}
`;
