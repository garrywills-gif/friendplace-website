'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { campaignsApi } from '@/lib/cms-api';

export function CampaignRenameEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    const match = pathname?.match(/^\/admin\/campaigns\/([^/]+)$/);
    if (!match) return;
    const campaignId = match[1];

    let stopped = false;
    let observer: MutationObserver | null = null;

    const install = () => {
      if (stopped) return;
      if (document.querySelector('[data-campaign-rename-button="1"]')) return;

      const headings = Array.from(document.querySelectorAll('h2')) as HTMLHeadingElement[];
      const heading = headings.find(node => {
        const text = (node.textContent || '').trim();
        return text && text !== 'Campaign';
      });
      if (!heading || !heading.parentElement) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.campaignRenameButton = '1';
      button.textContent = '✏️ Rename campaign';
      Object.assign(button.style, {
        marginTop: '10px',
        border: '1px solid #CBD5E1',
        background: '#FFFFFF',
        color: '#0F766E',
        borderRadius: '10px',
        padding: '7px 11px',
        fontSize: '12px',
        fontWeight: '800',
        cursor: 'pointer',
      });

      button.addEventListener('click', async () => {
        const currentName = (heading.textContent || '').trim();
        const nextName = window.prompt('Campaign name', currentName)?.trim();
        if (!nextName || nextName === currentName) return;

        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'Saving…';
        try {
          await campaignsApi.update(campaignId, { name: nextName });
          heading.textContent = nextName;
          button.textContent = '✓ Renamed';
          window.setTimeout(() => {
            button.textContent = oldText;
            button.disabled = false;
          }, 1200);
        } catch (error: any) {
          button.textContent = oldText;
          button.disabled = false;
          window.alert(error?.message || 'Could not rename campaign');
        }
      });

      heading.parentElement.appendChild(button);
    };

    install();
    observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      stopped = true;
      observer?.disconnect();
      document.querySelector('[data-campaign-rename-button="1"]')?.remove();
    };
  }, [pathname]);

  return null;
}
