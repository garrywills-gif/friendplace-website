/**
 * Share a Moment hero — image pool.
 *
 * Reuses FriendPlace's existing curated community photo gallery (the
 * same 33 warm, natural, Australian photos already bundled for the
 * Event / Notice composers — coffee catch-ups, bush walks, gardens,
 * book clubs, pets, social lunches, fetes & markets, community
 * activities, etc.). No separate hero image set is bundled: the gallery
 * photos are 3:2 landscape and read well behind the hero's gradient
 * scrim, so they double perfectly as the hero background.
 *
 * One image is chosen per fresh app launch / login session, and we
 * avoid repeating the image shown in the previous session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';
import { GALLERY_THEMES } from './gallery';

// Flatten the shared gallery into a single hero pool (33 images).
export const HERO_IMAGES: ImageSourcePropType[] =
  GALLERY_THEMES.flatMap((t) => t.images.map((im) => im.source));

const LAST_KEY = '@friendplace/hero_last_idx';

// Memoised for the JS session so the hero stays stable while the member
// uses the app; a cold launch resets module state (new pick), and a
// login/account switch forces a re-pick (see Home's effect).
let _sessionIndex: number | null = null;
let _pending: Promise<number> | null = null;

/**
 * Pick the hero image index for this session. Avoids repeating the
 * index used in the previous session (persisted in AsyncStorage).
 * @param force re-pick even if one is already chosen (e.g. on login).
 */
export async function pickSessionHeroIndex(force = false): Promise<number> {
  if (!force && _sessionIndex != null) return _sessionIndex;
  if (!force && _pending) return _pending;
  _pending = (async () => {
    let last = -1;
    try {
      const raw = await AsyncStorage.getItem(LAST_KEY);
      if (raw != null) last = parseInt(raw, 10);
    } catch { /* ignore */ }
    let idx = Math.floor(Math.random() * HERO_IMAGES.length);
    if (HERO_IMAGES.length > 1 && idx === last) {
      idx = (idx + 1) % HERO_IMAGES.length;
    }
    _sessionIndex = idx;
    try { await AsyncStorage.setItem(LAST_KEY, String(idx)); } catch { /* ignore */ }
    return idx;
  })();
  return _pending;
}
