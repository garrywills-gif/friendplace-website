import type { ReactNode } from 'react';
import PreviewDiagnostics from './PreviewDiagnostics';

export default function CampaignComposerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PreviewDiagnostics />
      {children}
    </>
  );
}
