/**
 * Community Group photo lookup.
 *
 * TestFlight Fix Batch 1 (Garry, Aug 2026 — P2 #4): replaces the
 * emoji-only tiles on `/groups` with warm real photographs consistent
 * with the upgraded FriendPlace visual style (Notice Board / Events
 * gallery). Emoji fallback is preserved so an unmapped group (custom
 * member-suggested groups etc.) still renders correctly.
 *
 * Uses photos ALREADY generated for the shared FriendPlace gallery
 * (`/app/frontend/src/lib/gallery.ts`) — the same Nano Banana pipeline
 * that produced Notice Board / Events photos. No new asset generation
 * is required for launch; the mapping simply reuses existing bundled
 * images so we ship a single, coherent visual language.
 *
 * The lookup is name-based (case-insensitive, punctuation-tolerant) so
 * seeded categories AND admin-suggested equivalents like "Walking
 * Group" and "Walking & Trails" resolve to the same warm bushwalk
 * photo. Extend the map when new starter categories are added.
 */
import type { ImageSourcePropType } from 'react-native';
import { GALLERY_THEMES } from './gallery';

/** Pick a stable representative image from a theme so the tile doesn't
 *  churn between renders. We use index 0 as the "hero" for each theme. */
function themeHero(themeKey: string): ImageSourcePropType | null {
  const theme = GALLERY_THEMES.find((t) => t.key === themeKey);
  return theme?.images[0]?.source ?? null;
}

/** Canonicalise a group name: lowercase, strip punctuation & the word
 *  "the", collapse whitespace. Makes matching robust to trivial
 *  variations ("Pet Lovers" / "Pet-lovers" / "The Pet Lovers"). */
function canon(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map canonical group name → gallery theme key. */
const NAME_TO_THEME: Record<string, string> = {
  // Walking-oriented groups → bush walks / walking groups
  'walking and trails': 'bush-walks-walking-groups',
  'walking group': 'bush-walks-walking-groups',
  'walking': 'bush-walks-walking-groups',
  'bush walkers': 'bush-walks-walking-groups',
  'bushwalking': 'bush-walks-walking-groups',
  'hiking': 'bush-walks-walking-groups',
  'trails': 'bush-walks-walking-groups',

  // Gardening
  'gardening': 'gardening-garden-groups',
  'garden club': 'gardening-garden-groups',
  'garden': 'gardening-garden-groups',
  'gardeners': 'gardening-garden-groups',

  // Classic cars
  'classic cars': 'classic-cars-car-meets',
  'classic car club': 'classic-cars-car-meets',
  'car meets': 'classic-cars-car-meets',
  'cars': 'classic-cars-car-meets',
  'motoring': 'classic-cars-car-meets',

  // Pet Lovers
  'pet lovers': 'pets-dog-meetups',
  'pets': 'pets-dog-meetups',
  'dog lovers': 'pets-dog-meetups',
  'dog owners': 'pets-dog-meetups',
  'cat lovers': 'pets-dog-meetups',
  'pet owners': 'pets-dog-meetups',

  // New Friends / social / introductions
  'new friends': 'social-get-togethers',
  'introductions': 'social-get-togethers',
  'welcome': 'social-get-togethers',
  'meet new people': 'social-get-togethers',

  // FP Café / coffee catch-ups / morning coffee
  'fp cafe crew': 'coffee-catchups',
  'coffee catch ups': 'coffee-catchups',
  'coffee catchups': 'coffee-catchups',
  'morning coffee': 'coffee-catchups',
  'coffee lovers': 'coffee-catchups',

  // Community volunteers → community activities
  'community volunteers': 'community-activities',
  'volunteers': 'community-activities',
  'community helpers': 'community-activities',
  'community group': 'community-activities',
  'sydney locals': 'community-activities',
  'melbourne locals': 'community-activities',
  'brisbane locals': 'community-activities',
  'locals': 'community-activities',

  // Travel enthusiasts → social get-togethers as a warm fallback
  'travel enthusiasts': 'social-get-togethers',
  'travel': 'social-get-togethers',
  'travellers': 'social-get-togethers',

  // Book club / reading groups
  'book club': 'book-clubs-reading-groups',
  'book clubs': 'book-clubs-reading-groups',
  'reading group': 'book-clubs-reading-groups',
  'readers': 'book-clubs-reading-groups',

  // Men's Shed / craft groups → BBQs & sausage sizzles (warm blokes-outdoors vibe)
  'men s shed': 'bbqs-sausage-sizzles',
  'mens shed': 'bbqs-sausage-sizzles',
  'blokes': 'bbqs-sausage-sizzles',
  'craft': 'bbqs-sausage-sizzles',
};

/** Return the group tile photo for a given group name, or null if no
 *  mapping exists (caller should render the emoji fallback). */
export function groupImageForName(name?: string | null): ImageSourcePropType | null {
  if (!name) return null;
  const key = canon(name);
  const themeKey = NAME_TO_THEME[key];
  if (themeKey) return themeHero(themeKey);
  // Fuzzy fallback — if the canonical name CONTAINS a mapped keyword.
  for (const [k, t] of Object.entries(NAME_TO_THEME)) {
    if (key.includes(k)) return themeHero(t);
  }
  return null;
}
