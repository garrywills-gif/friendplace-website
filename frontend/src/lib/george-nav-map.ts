/**
 * George's authoritative navigation map (C1 Slice 2).
 *
 * Locked with Garry 21 July 2026. Every `navigate_to.key` George
 * produces MUST be one of the keys below. The router only routes to
 * paths from this file — no free-form path is ever passed through to
 * expo-router.
 *
 * If you add a new destination, add it here AND update the
 * `_NAVIGATE_KEYS` / `_NAVIGATE_DEFAULT_LABELS` sets in
 * `/app/backend/services/george/event_creation/service.py` — the two
 * whitelists must stay in sync.
 */
import type { Href } from 'expo-router';

export type GeorgeNavKey =
  | 'home'
  | 'chats'
  | 'friends'
  | 'lounge'
  | 'profile'
  | 'games'
  | 'groups'
  | 'notices'
  | 'events'
  | 'recipes'
  | 'founders'
  | 'help'
  | 'notifications'
  | 'settings';

export interface GeorgeNavTarget {
  key: GeorgeNavKey;
  /** expo-router Href — MUST match a real route file in `/app/frontend/app/`. */
  href: Href;
  /** Human label used as a fallback if the LLM didn't include one. */
  fallbackLabel: string;
}

export const GEORGE_NAV_MAP: Record<GeorgeNavKey, GeorgeNavTarget> = {
  home:          { key: 'home',          href: '/(tabs)/home',    fallbackLabel: 'Take me home' },
  chats:         { key: 'chats',         href: '/(tabs)/chats',   fallbackLabel: 'Open Chats' },
  friends:       { key: 'friends',       href: '/(tabs)/friends', fallbackLabel: 'Open Friends' },
  lounge:        { key: 'lounge',        href: '/(tabs)/lounge',  fallbackLabel: 'Open the Coffee Lounge' },
  profile:       { key: 'profile',       href: '/(tabs)/profile', fallbackLabel: 'Open my Profile' },
  games:         { key: 'games',         href: '/games',          fallbackLabel: 'Take me to Games' },
  groups:        { key: 'groups',        href: '/groups',         fallbackLabel: 'Open Groups' },
  notices:       { key: 'notices',       href: '/notices',        fallbackLabel: 'Open the Notice Board' },
  events:        { key: 'events',        href: '/events',         fallbackLabel: 'See Events' },
  recipes:       { key: 'recipes',       href: '/recipes',        fallbackLabel: 'Open Recipes' },
  founders:      { key: 'founders',      href: '/founders',       fallbackLabel: 'Meet the Founders' },
  help:          { key: 'help',          href: '/help',           fallbackLabel: 'Open Help' },
  notifications: { key: 'notifications', href: '/notifications',  fallbackLabel: 'Open Notifications' },
  settings:      { key: 'settings',      href: '/settings',       fallbackLabel: 'Open Settings' },
};

/**
 * Resolve a raw `navigate_to` object from the George API into a
 * safe target. Returns `null` when the key is not on the whitelist —
 * the caller should never navigate on an unresolved hint.
 */
export function resolveGeorgeNavigate(
  raw: { key?: string | null; label?: string | null } | null | undefined,
): { target: GeorgeNavTarget; label: string } | null {
  if (!raw || typeof raw.key !== 'string') return null;
  const key = raw.key.trim().toLowerCase() as GeorgeNavKey;
  const target = GEORGE_NAV_MAP[key];
  if (!target) return null;
  const label = (raw.label && raw.label.trim()) || target.fallbackLabel;
  return { target, label };
}
