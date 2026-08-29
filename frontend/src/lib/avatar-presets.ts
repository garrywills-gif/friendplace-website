/**
 * Avatar preset catalog — the 72 FriendPlace 3D preset portraits.
 *
 * Members either pick one of these presets ("preset:portrait-17") or
 * upload their own photo ("data:image/jpeg;base64,…") or use the
 * legacy emoji builder ("👨🏽‍🦳::g"). All three formats flow through
 * `AvatarBubble` for rendering — this file just powers the picker
 * grid and the `preset:` → image-source resolver.
 *
 * Filenames follow `portrait-01.jpg … portrait-72.jpg`. The `age`
 * and `group` metadata drive the picker's age-band filter tabs.
 *
 * Adding a new preset: drop the JPEG under assets/avatars/presets/
 * and add a row to PRESETS. That's it — no schema, no migration.
 */

import type { ImageSourcePropType } from 'react-native';

export type AvatarPresetGroup = 'young' | 'adult' | 'mature' | 'senior' | 'elder';

export interface AvatarPreset {
  id: string;              // "portrait-01"
  group: AvatarPresetGroup;
  age: string;             // human label e.g. "50s"
  source: ImageSourcePropType;
}

// prettier-ignore
const R = {
  p01: require('../../assets/avatars/presets/portrait-01.jpg'),
  p02: require('../../assets/avatars/presets/portrait-02.jpg'),
  p03: require('../../assets/avatars/presets/portrait-03.jpg'),
  p04: require('../../assets/avatars/presets/portrait-04.jpg'),
  p05: require('../../assets/avatars/presets/portrait-05.jpg'),
  p06: require('../../assets/avatars/presets/portrait-06.jpg'),
  p07: require('../../assets/avatars/presets/portrait-07.jpg'),
  p08: require('../../assets/avatars/presets/portrait-08.jpg'),
  p09: require('../../assets/avatars/presets/portrait-09.jpg'),
  p10: require('../../assets/avatars/presets/portrait-10.jpg'),
  p11: require('../../assets/avatars/presets/portrait-11.jpg'),
  p12: require('../../assets/avatars/presets/portrait-12.jpg'),
  p13: require('../../assets/avatars/presets/portrait-13.jpg'),
  p14: require('../../assets/avatars/presets/portrait-14.jpg'),
  p15: require('../../assets/avatars/presets/portrait-15.jpg'),
  p16: require('../../assets/avatars/presets/portrait-16.jpg'),
  p17: require('../../assets/avatars/presets/portrait-17.jpg'),
  p18: require('../../assets/avatars/presets/portrait-18.jpg'),
  p19: require('../../assets/avatars/presets/portrait-19.jpg'),
  p20: require('../../assets/avatars/presets/portrait-20.jpg'),
  p21: require('../../assets/avatars/presets/portrait-21.jpg'),
  p22: require('../../assets/avatars/presets/portrait-22.jpg'),
  p23: require('../../assets/avatars/presets/portrait-23.jpg'),
  p24: require('../../assets/avatars/presets/portrait-24.jpg'),
  p25: require('../../assets/avatars/presets/portrait-25.jpg'),
  p26: require('../../assets/avatars/presets/portrait-26.jpg'),
  p27: require('../../assets/avatars/presets/portrait-27.jpg'),
  p28: require('../../assets/avatars/presets/portrait-28.jpg'),
  p29: require('../../assets/avatars/presets/portrait-29.jpg'),
  p30: require('../../assets/avatars/presets/portrait-30.jpg'),
  p31: require('../../assets/avatars/presets/portrait-31.jpg'),
  p32: require('../../assets/avatars/presets/portrait-32.jpg'),
  p33: require('../../assets/avatars/presets/portrait-33.jpg'),
  p34: require('../../assets/avatars/presets/portrait-34.jpg'),
  p35: require('../../assets/avatars/presets/portrait-35.jpg'),
  p36: require('../../assets/avatars/presets/portrait-36.jpg'),
  p37: require('../../assets/avatars/presets/portrait-37.jpg'),
  p38: require('../../assets/avatars/presets/portrait-38.jpg'),
  p39: require('../../assets/avatars/presets/portrait-39.jpg'),
  p40: require('../../assets/avatars/presets/portrait-40.jpg'),
  p41: require('../../assets/avatars/presets/portrait-41.jpg'),
  p42: require('../../assets/avatars/presets/portrait-42.jpg'),
  p43: require('../../assets/avatars/presets/portrait-43.jpg'),
  p44: require('../../assets/avatars/presets/portrait-44.jpg'),
  p45: require('../../assets/avatars/presets/portrait-45.jpg'),
  p46: require('../../assets/avatars/presets/portrait-46.jpg'),
  p47: require('../../assets/avatars/presets/portrait-47.jpg'),
  p48: require('../../assets/avatars/presets/portrait-48.jpg'),
  p49: require('../../assets/avatars/presets/portrait-49.jpg'),
  p50: require('../../assets/avatars/presets/portrait-50.jpg'),
  p51: require('../../assets/avatars/presets/portrait-51.jpg'),
  p52: require('../../assets/avatars/presets/portrait-52.jpg'),
  p53: require('../../assets/avatars/presets/portrait-53.jpg'),
  p54: require('../../assets/avatars/presets/portrait-54.jpg'),
  p55: require('../../assets/avatars/presets/portrait-55.jpg'),
  p56: require('../../assets/avatars/presets/portrait-56.jpg'),
  p57: require('../../assets/avatars/presets/portrait-57.jpg'),
  p58: require('../../assets/avatars/presets/portrait-58.jpg'),
  p59: require('../../assets/avatars/presets/portrait-59.jpg'),
  p60: require('../../assets/avatars/presets/portrait-60.jpg'),
  p61: require('../../assets/avatars/presets/portrait-61.jpg'),
  p62: require('../../assets/avatars/presets/portrait-62.jpg'),
  p63: require('../../assets/avatars/presets/portrait-63.jpg'),
  p64: require('../../assets/avatars/presets/portrait-64.jpg'),
  p65: require('../../assets/avatars/presets/portrait-65.jpg'),
  p66: require('../../assets/avatars/presets/portrait-66.jpg'),
  p67: require('../../assets/avatars/presets/portrait-67.jpg'),
  p68: require('../../assets/avatars/presets/portrait-68.jpg'),
  p69: require('../../assets/avatars/presets/portrait-69.jpg'),
  p70: require('../../assets/avatars/presets/portrait-70.jpg'),
  p71: require('../../assets/avatars/presets/portrait-71.jpg'),
  p72: require('../../assets/avatars/presets/portrait-72.jpg'),
} as const;

/**
 * The full catalog. Order-sensitive: the picker renders in this order.
 * Younger adults surface first so members opening the picker see a
 * relatable option immediately regardless of age. Ages then flow
 * upward through the mature bands.
 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  // Younger (18–25) — 4
  { id: 'portrait-61', group: 'young',  age: 'early 20s',  source: R.p61 },
  { id: 'portrait-62', group: 'young',  age: 'early 20s',  source: R.p62 },
  { id: 'portrait-63', group: 'young',  age: 'mid 20s',    source: R.p63 },
  { id: 'portrait-64', group: 'young',  age: 'mid 20s',    source: R.p64 },
  // Adult (25–35) — 4
  { id: 'portrait-65', group: 'adult',  age: 'late 20s',   source: R.p65 },
  { id: 'portrait-66', group: 'adult',  age: 'early 30s',  source: R.p66 },
  { id: 'portrait-67', group: 'adult',  age: 'early 30s',  source: R.p67 },
  { id: 'portrait-68', group: 'adult',  age: 'mid 30s',    source: R.p68 },
  // Mature (35–45) — 4
  { id: 'portrait-69', group: 'mature', age: 'late 30s',   source: R.p69 },
  { id: 'portrait-70', group: 'mature', age: 'early 40s',  source: R.p70 },
  { id: 'portrait-71', group: 'mature', age: 'early 40s',  source: R.p71 },
  { id: 'portrait-72', group: 'mature', age: 'mid 40s',    source: R.p72 },
  // Senior (50–65) — 28
  { id: 'portrait-01', group: 'senior', age: '50s',        source: R.p01 },
  { id: 'portrait-02', group: 'senior', age: '50s',        source: R.p02 },
  { id: 'portrait-03', group: 'senior', age: '50s',        source: R.p03 },
  { id: 'portrait-04', group: 'senior', age: '50s',        source: R.p04 },
  { id: 'portrait-05', group: 'senior', age: '50s',        source: R.p05 },
  { id: 'portrait-06', group: 'senior', age: '50s',        source: R.p06 },
  { id: 'portrait-07', group: 'senior', age: '50s',        source: R.p07 },
  { id: 'portrait-08', group: 'senior', age: '50s',        source: R.p08 },
  { id: 'portrait-09', group: 'senior', age: '50s',        source: R.p09 },
  { id: 'portrait-10', group: 'senior', age: '50s',        source: R.p10 },
  { id: 'portrait-11', group: 'senior', age: '50s',        source: R.p11 },
  { id: 'portrait-12', group: 'senior', age: '50s',        source: R.p12 },
  { id: 'portrait-13', group: 'senior', age: '60s',        source: R.p13 },
  { id: 'portrait-14', group: 'senior', age: '60s',        source: R.p14 },
  { id: 'portrait-15', group: 'senior', age: '60s',        source: R.p15 },
  { id: 'portrait-16', group: 'senior', age: '60s',        source: R.p16 },
  { id: 'portrait-17', group: 'senior', age: '60s',        source: R.p17 },
  { id: 'portrait-18', group: 'senior', age: '60s',        source: R.p18 },
  { id: 'portrait-19', group: 'senior', age: '60s',        source: R.p19 },
  { id: 'portrait-20', group: 'senior', age: '60s',        source: R.p20 },
  { id: 'portrait-21', group: 'senior', age: '60s',        source: R.p21 },
  { id: 'portrait-22', group: 'senior', age: '60s',        source: R.p22 },
  { id: 'portrait-23', group: 'senior', age: '60s',        source: R.p23 },
  { id: 'portrait-24', group: 'senior', age: '60s',        source: R.p24 },
  { id: 'portrait-25', group: 'senior', age: '60s',        source: R.p25 },
  { id: 'portrait-26', group: 'senior', age: '60s',        source: R.p26 },
  { id: 'portrait-27', group: 'senior', age: '60s',        source: R.p27 },
  { id: 'portrait-28', group: 'senior', age: '60s',        source: R.p28 },
  // Elder (70+) — 28
  { id: 'portrait-29', group: 'elder',  age: '70s',        source: R.p29 },
  { id: 'portrait-30', group: 'elder',  age: '70s',        source: R.p30 },
  { id: 'portrait-31', group: 'elder',  age: '70s',        source: R.p31 },
  { id: 'portrait-32', group: 'elder',  age: '70s',        source: R.p32 },
  { id: 'portrait-33', group: 'elder',  age: '70s',        source: R.p33 },
  { id: 'portrait-34', group: 'elder',  age: '70s',        source: R.p34 },
  { id: 'portrait-35', group: 'elder',  age: '70s',        source: R.p35 },
  { id: 'portrait-36', group: 'elder',  age: '70s',        source: R.p36 },
  { id: 'portrait-37', group: 'elder',  age: '70s',        source: R.p37 },
  { id: 'portrait-38', group: 'elder',  age: '70s',        source: R.p38 },
  { id: 'portrait-39', group: 'elder',  age: '70s',        source: R.p39 },
  { id: 'portrait-40', group: 'elder',  age: '70s',        source: R.p40 },
  { id: 'portrait-41', group: 'elder',  age: '70s',        source: R.p41 },
  { id: 'portrait-42', group: 'elder',  age: '70s',        source: R.p42 },
  { id: 'portrait-43', group: 'elder',  age: '70s',        source: R.p43 },
  { id: 'portrait-44', group: 'elder',  age: '70s',        source: R.p44 },
  { id: 'portrait-45', group: 'elder',  age: '80s',        source: R.p45 },
  { id: 'portrait-46', group: 'elder',  age: '80s',        source: R.p46 },
  { id: 'portrait-47', group: 'elder',  age: '80s',        source: R.p47 },
  { id: 'portrait-48', group: 'elder',  age: '80s',        source: R.p48 },
  { id: 'portrait-49', group: 'elder',  age: '80s',        source: R.p49 },
  { id: 'portrait-50', group: 'elder',  age: '80s',        source: R.p50 },
  { id: 'portrait-51', group: 'elder',  age: '80s',        source: R.p51 },
  { id: 'portrait-52', group: 'elder',  age: '80s',        source: R.p52 },
  { id: 'portrait-53', group: 'elder',  age: '80s',        source: R.p53 },
  { id: 'portrait-54', group: 'elder',  age: '80s',        source: R.p54 },
  { id: 'portrait-55', group: 'elder',  age: '80s',        source: R.p55 },
  { id: 'portrait-56', group: 'elder',  age: '80s',        source: R.p56 },
  { id: 'portrait-57', group: 'senior', age: '60s',        source: R.p57 },
  { id: 'portrait-58', group: 'elder',  age: '70s',        source: R.p58 },
  { id: 'portrait-59', group: 'senior', age: '50s',        source: R.p59 },
  { id: 'portrait-60', group: 'elder',  age: '70s',        source: R.p60 },
];

export const AVATAR_PRESET_GROUPS: { key: AvatarPresetGroup; label: string; hint: string }[] = [
  { key: 'young',  label: 'Younger',   hint: '18–25' },
  { key: 'adult',  label: 'Adult',     hint: '25–35' },
  { key: 'mature', label: 'Mature',    hint: '35–45' },
  { key: 'senior', label: 'Senior',    hint: '50–65' },
  { key: 'elder',  label: 'Elder',     hint: '70+'   },
];

const PRESET_INDEX: Record<string, AvatarPreset> = Object.fromEntries(
  AVATAR_PRESETS.map((p) => [p.id, p]),
);

/** Prefix marker used inside `user.avatar` for preset picks. */
export const PRESET_PREFIX = 'preset:';

/** Convert a preset id to the storage-string that lands in `user.avatar`. */
export function presetToAvatarString(id: string): string {
  return `${PRESET_PREFIX}${id}`;
}

/** Resolve a preset avatar string ("preset:portrait-17") to its image
 * source. Returns null if the string isn't a preset ref or the id is
 * unknown (defensive fall-through so a stale id doesn't crash the app). */
export function resolvePresetSource(value?: string | null): ImageSourcePropType | null {
  if (!value || !value.startsWith(PRESET_PREFIX)) return null;
  const id = value.slice(PRESET_PREFIX.length);
  return PRESET_INDEX[id]?.source ?? null;
}

/** True if the string is a preset reference. Cheap `startsWith` check. */
export function isPresetAvatar(value?: string | null): boolean {
  return !!value && value.startsWith(PRESET_PREFIX);
}
