'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'friendplace.mcgs.campaignDisplayNames.v1';

type NameMap = Record<string, string>;

function readNames(): NameMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as NameMap : {};
  } catch {
    return {};
  }
}

function writeNames(names: NameMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Best effort only; the campaign remains usable even if storage is blocked.
  }
}

export function CampaignRenameEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    let stopped = false;
    let observer: MutationObserver | null = null;

    const applyListAliases = () => {
      const names = readNames();
      const links = Array.from(document.querySelectorAll('a[href^="/admin/campaigns/"]')) as HTMLAnchorElement[];
      for (const link of links) {
        const match = link.getAttribute('href')?.match(/^\/admin\/campaigns\/([^/?#]+)$/);
        if (!match) continue;
        const alias = names[match[1]];
        if (!alias) continue;
        const title = Array.from(link.querySelectorAll('div')).find(node => {
          const style = (node as HTMLElement).style;
          return style.fontWeight === '800' || style.fontWeight === '900';
        }) as HTMLElement | undefined;
        if (title && title.textContent !== alias) title.textContent = alias;
      }
    };

    const detailMatch = pathname?.match(/^\/admin\/campaigns\/([^/]+)$/);

    const installDetailRename = () => {
      if (!detailMatch || stopped) return;
      const campaignId = detailMatch[1];
      const names = readNames();

      const headings = Array.from(document.querySelectorAll('h2')) as HTMLHeadingElement[];
      const heading = headings.find(node => {
        const text = (node.textContent || '').trim();
        return text && text !== 'Campaign';
      });
      if (!heading || !heading.parentElement) return;

      const savedAlias = names[campaignId];
      if (savedAlias && heading.textContent !== savedAlias) heading.textContent = savedAlias;

      if (document.querySelector('[data-campaign-rename-button="1"]')) return;

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

      button.addEventListener('click', () => {
        const currentName = (heading.textContent || '').trim();
        const nextName = window.prompt('Campaign name', currentName)?.trim();
        if (!nextName || nextName === currentName) return;

        const currentNames = readNames();
        currentNames[campaignId] = nextName;
        writeNames(currentNames);
        heading.textContent = nextName;

        const oldText = button.textContent;
        button.textContent = '✓ Renamed';
        button.disabled = true;
        window.setTimeout(() => {
          button.textContent = oldText;
          button.disabled = false;
        }, 1200);
      });

      heading.parentElement.appendChild(button);
    };

    const install = () => {
      if (stopped) return;
      if (pathname === '/admin/campaigns') applyListAliases();
      installDetailRename();
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
