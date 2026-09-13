/**
 * FriendPlace shared photo gallery — 33 curated photographs across 11
 * community themes. Available both from the Notice Board post composer
 * and the Local Events composer (shared library, single source of truth).
 *
 * Members can either pick one of these photos ("gallery:coffee-catchups/01")
 * or upload their own. All existing image handling paths that already
 * work with base64 data URIs / http URLs keep working — only the
 * `gallery:` prefix is new and gets resolved to a bundled asset at
 * render time via `resolveGallerySource`.
 */

import type { ImageSourcePropType } from 'react-native';

export interface GalleryImage {
  id: string;                // "coffee-catchups/01"
  source: ImageSourcePropType;
}

export interface GalleryTheme {
  key: string;
  label: string;
  emoji: string;
  images: GalleryImage[];
}

// prettier-ignore
const M = {
  bbq1: require('../../assets/gallery/bbqs-sausage-sizzles/01.jpg'),
  bbq2: require('../../assets/gallery/bbqs-sausage-sizzles/02.jpg'),
  bbq3: require('../../assets/gallery/bbqs-sausage-sizzles/03.jpg'),

  bush1: require('../../assets/gallery/bush-walks-walking-groups/01.jpg'),
  bush2: require('../../assets/gallery/bush-walks-walking-groups/02.jpg'),
  bush3: require('../../assets/gallery/bush-walks-walking-groups/03.jpg'),

  gs1: require('../../assets/gallery/garage-sales/01.jpg'),
  gs2: require('../../assets/gallery/garage-sales/02.jpg'),
  gs3: require('../../assets/gallery/garage-sales/03.jpg'),

  fete1: require('../../assets/gallery/fetes-fairs-cake-stalls/01.jpg'),
  fete2: require('../../assets/gallery/fetes-fairs-cake-stalls/02.jpg'),
  fete3: require('../../assets/gallery/fetes-fairs-cake-stalls/03.jpg'),

  coffee1: require('../../assets/gallery/coffee-catchups/01.jpg'),
  coffee2: require('../../assets/gallery/coffee-catchups/02.jpg'),
  coffee3: require('../../assets/gallery/coffee-catchups/03.jpg'),

  book1: require('../../assets/gallery/book-clubs-reading-groups/01.jpg'),
  book2: require('../../assets/gallery/book-clubs-reading-groups/02.jpg'),
  book3: require('../../assets/gallery/book-clubs-reading-groups/03.jpg'),

  garden1: require('../../assets/gallery/gardening-garden-groups/01.jpg'),
  garden2: require('../../assets/gallery/gardening-garden-groups/02.jpg'),
  garden3: require('../../assets/gallery/gardening-garden-groups/03.jpg'),

  pets1: require('../../assets/gallery/pets-dog-meetups/01.jpg'),
  pets2: require('../../assets/gallery/pets-dog-meetups/02.jpg'),
  pets3: require('../../assets/gallery/pets-dog-meetups/03.jpg'),

  cars1: require('../../assets/gallery/classic-cars-car-meets/01.jpg'),
  cars2: require('../../assets/gallery/classic-cars-car-meets/02.jpg'),
  cars3: require('../../assets/gallery/classic-cars-car-meets/03.jpg'),

  social1: require('../../assets/gallery/social-get-togethers/01.jpg'),
  social2: require('../../assets/gallery/social-get-togethers/02.jpg'),
  social3: require('../../assets/gallery/social-get-togethers/03.jpg'),

  comm1: require('../../assets/gallery/community-activities/01.jpg'),
  comm2: require('../../assets/gallery/community-activities/02.jpg'),
  comm3: require('../../assets/gallery/community-activities/03.jpg'),
} as const;

export const GALLERY_THEMES: GalleryTheme[] = [
  {
    key: 'bbqs-sausage-sizzles', label: 'BBQs & sausage sizzles', emoji: '🍢',
    images: [
      { id: 'bbqs-sausage-sizzles/01', source: M.bbq1 },
      { id: 'bbqs-sausage-sizzles/02', source: M.bbq2 },
      { id: 'bbqs-sausage-sizzles/03', source: M.bbq3 },
    ],
  },
  {
    key: 'bush-walks-walking-groups', label: 'Bush walks & walking groups', emoji: '🥾',
    images: [
      { id: 'bush-walks-walking-groups/01', source: M.bush1 },
      { id: 'bush-walks-walking-groups/02', source: M.bush2 },
      { id: 'bush-walks-walking-groups/03', source: M.bush3 },
    ],
  },
  {
    key: 'garage-sales', label: 'Garage sales', emoji: '🏷️',
    images: [
      { id: 'garage-sales/01', source: M.gs1 },
      { id: 'garage-sales/02', source: M.gs2 },
      { id: 'garage-sales/03', source: M.gs3 },
    ],
  },
  {
    key: 'fetes-fairs-cake-stalls', label: 'Fêtes, fairs & cake stalls', emoji: '🎪',
    images: [
      { id: 'fetes-fairs-cake-stalls/01', source: M.fete1 },
      { id: 'fetes-fairs-cake-stalls/02', source: M.fete2 },
      { id: 'fetes-fairs-cake-stalls/03', source: M.fete3 },
    ],
  },
  {
    key: 'coffee-catchups', label: 'Coffee catch-ups', emoji: '☕',
    images: [
      { id: 'coffee-catchups/01', source: M.coffee1 },
      { id: 'coffee-catchups/02', source: M.coffee2 },
      { id: 'coffee-catchups/03', source: M.coffee3 },
    ],
  },
  {
    key: 'book-clubs-reading-groups', label: 'Book clubs & reading groups', emoji: '📚',
    images: [
      { id: 'book-clubs-reading-groups/01', source: M.book1 },
      { id: 'book-clubs-reading-groups/02', source: M.book2 },
      { id: 'book-clubs-reading-groups/03', source: M.book3 },
    ],
  },
  {
    key: 'gardening-garden-groups', label: 'Gardening & garden groups', emoji: '🌱',
    images: [
      { id: 'gardening-garden-groups/01', source: M.garden1 },
      { id: 'gardening-garden-groups/02', source: M.garden2 },
      { id: 'gardening-garden-groups/03', source: M.garden3 },
    ],
  },
  {
    key: 'pets-dog-meetups', label: 'Pets & dog meet-ups', emoji: '🐾',
    images: [
      { id: 'pets-dog-meetups/01', source: M.pets1 },
      { id: 'pets-dog-meetups/02', source: M.pets2 },
      { id: 'pets-dog-meetups/03', source: M.pets3 },
    ],
  },
  {
    key: 'classic-cars-car-meets', label: 'Classic cars & car meets', emoji: '🚗',
    images: [
      { id: 'classic-cars-car-meets/01', source: M.cars1 },
      { id: 'classic-cars-car-meets/02', source: M.cars2 },
      { id: 'classic-cars-car-meets/03', source: M.cars3 },
    ],
  },
  {
    key: 'social-get-togethers', label: 'Social get-togethers', emoji: '🥗',
    images: [
      { id: 'social-get-togethers/01', source: M.social1 },
      { id: 'social-get-togethers/02', source: M.social2 },
      { id: 'social-get-togethers/03', source: M.social3 },
    ],
  },
  {
    key: 'community-activities', label: 'Community activities', emoji: '🏛️',
    images: [
      { id: 'community-activities/01', source: M.comm1 },
      { id: 'community-activities/02', source: M.comm2 },
      { id: 'community-activities/03', source: M.comm3 },
    ],
  },
];

const IMAGE_INDEX: Record<string, GalleryImage> = Object.fromEntries(
  GALLERY_THEMES.flatMap((t) => t.images.map((im) => [im.id, im])),
);

export const GALLERY_PREFIX = 'gallery:';

export function galleryToImageString(id: string): string {
  return `${GALLERY_PREFIX}${id}`;
}

export function isGalleryImage(value?: string | null): boolean {
  return !!value && value.startsWith(GALLERY_PREFIX);
}

export function resolveGallerySource(value?: string | null): ImageSourcePropType | null {
  if (!value || !value.startsWith(GALLERY_PREFIX)) return null;
  const id = value.slice(GALLERY_PREFIX.length);
  return IMAGE_INDEX[id]?.source ?? null;
}
