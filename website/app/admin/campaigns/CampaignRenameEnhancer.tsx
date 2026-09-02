'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { API_BASE } from '@/lib/api-base';
import { clearAuth, getToken } from '@/lib/cms-auth';

const LEGACY_STORAGE_KEY = 'friendplace.mcgs.campaignDisplayNames.v1';

async function renameCampaign(campaignId: string, name: string): Promise<{ name: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/cms/campaigns/${encodeURIComponent(campaignId)}/rename`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name }),
    cache: 'no-store',
  });

  if (res.status === 401) clearAuth();
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { detail: text }; }

  if (!res.ok) {
    const message = json?.detail || json?.error || `Could not rename campaign (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  return { name: String(json?.name || name) };
}

export function CampaignRenameEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    // Remove the temporary browser-only aliases now that campaign names
    // are persisted by the backend rename-only endpoint.
    try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* storage blocked */ }

    const detailMatch = pathname?.match(/^\/admin\/campaigns\/([^/]+)$/);
    if (!detailMatch) return;
    const campaignId = detailMatch[1];

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
        const requestedName = window.prompt('Campaign name', currentName)?.trim();
        if (!requestedName || requestedName === currentName) return;

        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'Saving…';
        try {
          const renamed = await renameCampaign(campaignId, requestedName);
          heading.textContent = renamed.name;
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
