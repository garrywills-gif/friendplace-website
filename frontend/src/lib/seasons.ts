/**
 * Seasonal Theme System
 * ---------------------
 * Central place that maps "today's date" to a Season theme used across
 * the games (backs, felt colours, decorative emojis, section headings).
 *
 * Priority order when picking today's theme:
 *   1. Holidays (fixed dates that trump ambient seasons): Christmas,
 *      Easter, Valentine's, Halloween, Australia Day, Mother's Day
 *   2. Ambient Southern-Hemisphere season: Summer / Autumn / Winter /
 *      Spring (YouBelong is Australian-first)
 *
 * We deliberately compute in local time — a user in Melbourne opening
 * the app on 25 December should always see Christmas, regardless of
 * server time. All windows are inclusive.
 *
 * Every theme is self-contained: colours are hex strings, decoration
 * is emoji-based (renders on every device without extra assets), and
 * the `suit` symbols follow Unicode so any future rendering path
 * (SVG, canvas, plain Text) can consume them without adaptation.
 *
 * Consumers should treat the returned object as *immutable* for the
 * lifetime of a single render — seasons only change at date rollover
 * so we memoise upstream where useful.
 */

export type SeasonKey =
  | "winter" | "spring" | "summer" | "autumn"
  | "christmas" | "easter" | "valentines" | "halloween"
  | "australia_day" | "mothers_day";

export type SeasonTheme = {
  key: SeasonKey;
  /** Short human label — used in headings ("Summer at YouBelong"). */
  label: string;
  /** Marketing-y sub label ("Long days, lazy afternoons"). */
  tagline: string;
  /** Primary decorative emoji — appears on the card back etc. */
  emoji: string;
  /** Small extras used to sprinkle the UI (max 4 recommended). */
  emojis: string[];
  /** Card felt / play area background. */
  felt: string;
  /** Foundation slot outline colour. */
  outline: string;
  /** Accent used for chips, hint highlight etc. */
  accent: string;
  /** Card-back primary tint (butterfly wing colour). */
  cardBackPrimary: string;
  /** Card-back secondary tint. */
  cardBackSecondary: string;
  /** Whether the season is a Big Holiday (drives party confetti etc). */
  festive: boolean;
};

const THEMES: Record<SeasonKey, SeasonTheme> = {
  winter: {
    key: "winter",
    label: "Winter",
    tagline: "Cosy afternoons and warm mugs",
    emoji: "❄️",
    emojis: ["❄️", "☃️", "🧣", "⛄"],
    felt: "#0B2E4F",
    outline: "#7DD3FC",
    accent: "#7DD3FC",
    cardBackPrimary: "#1E3A7F",
    cardBackSecondary: "#93C5FD",
    festive: false,
  },
  spring: {
    key: "spring",
    label: "Spring",
    tagline: "Fresh blooms and new beginnings",
    emoji: "🌸",
    emojis: ["🌸", "🌷", "🐝", "🌱"],
    felt: "#166534",
    outline: "#F9A8D4",
    accent: "#F472B6",
    cardBackPrimary: "#DB2777",
    cardBackSecondary: "#FBCFE8",
    festive: false,
  },
  summer: {
    key: "summer",
    label: "Summer",
    tagline: "Long days and lazy afternoons",
    emoji: "☀️",
    emojis: ["☀️", "🌊", "🍉", "🕶️"],
    felt: "#0E7490",
    outline: "#FDE68A",
    accent: "#FBBF24",
    cardBackPrimary: "#F59E0B",
    cardBackSecondary: "#FEF3C7",
    festive: false,
  },
  autumn: {
    key: "autumn",
    label: "Autumn",
    tagline: "Golden leaves and cool mornings",
    emoji: "🍂",
    emojis: ["🍂", "🍁", "🌰", "🎃"],
    felt: "#7C2D12",
    outline: "#FDBA74",
    accent: "#F97316",
    cardBackPrimary: "#B45309",
    cardBackSecondary: "#FED7AA",
    festive: false,
  },
  christmas: {
    key: "christmas",
    label: "Christmas",
    tagline: "Merry days ahead 🎄",
    emoji: "🎄",
    emojis: ["🎄", "⭐", "🎁", "❤️"],
    felt: "#14532D",
    outline: "#DC2626",
    accent: "#DC2626",
    cardBackPrimary: "#B91C1C",
    cardBackSecondary: "#FBBF24",
    festive: true,
  },
  easter: {
    key: "easter",
    label: "Easter",
    tagline: "Chocolate, bunnies & yellow blossoms",
    emoji: "🐣",
    emojis: ["🐣", "🐰", "🌷", "🥚"],
    felt: "#7C3AED",
    outline: "#FCD34D",
    accent: "#FCD34D",
    cardBackPrimary: "#A78BFA",
    cardBackSecondary: "#FEF3C7",
    festive: true,
  },
  valentines: {
    key: "valentines",
    label: "Valentine's",
    tagline: "Show some love ❤️",
    emoji: "💖",
    emojis: ["💖", "🌹", "💌", "✨"],
    felt: "#831843",
    outline: "#FDA4AF",
    accent: "#F43F5E",
    cardBackPrimary: "#E11D48",
    cardBackSecondary: "#FECDD3",
    festive: true,
  },
  halloween: {
    key: "halloween",
    label: "Halloween",
    tagline: "Spooky season — trick or treat 🎃",
    emoji: "🎃",
    emojis: ["🎃", "👻", "🦇", "🕸️"],
    felt: "#111827",
    outline: "#F97316",
    accent: "#F97316",
    cardBackPrimary: "#111827",
    cardBackSecondary: "#F97316",
    festive: true,
  },
  australia_day: {
    key: "australia_day",
    label: "Australia Day",
    tagline: "G'day mate — long weekend vibes",
    emoji: "🇦🇺",
    emojis: ["🇦🇺", "🦘", "🐨", "🌏"],
    felt: "#0C4A6E",
    outline: "#FBBF24",
    accent: "#EAB308",
    cardBackPrimary: "#0EA5E9",
    cardBackSecondary: "#FEF3C7",
    festive: true,
  },
  mothers_day: {
    key: "mothers_day",
    label: "Mother's Day",
    tagline: "Celebrate the mums in your life 💐",
    emoji: "💐",
    emojis: ["💐", "🌷", "💝", "🌸"],
    felt: "#9D174D",
    outline: "#FBCFE8",
    accent: "#EC4899",
    cardBackPrimary: "#DB2777",
    cardBackSecondary: "#FCE7F3",
    festive: true,
  },
};

/** All themes exposed so a Settings screen can preview / manually pick. */
export const ALL_THEMES: SeasonTheme[] = Object.values(THEMES);

export function getTheme(key: SeasonKey): SeasonTheme {
  return THEMES[key];
}

/**
 * Second Sunday in May — Australian Mother's Day.
 * Returns YYYY-MM-DD (local) for the given year.
 */
function mothersDayForYear(year: number): string {
  // May is month index 4. First day of May.
  const may1 = new Date(year, 4, 1);
  const dow = may1.getDay(); // 0 = Sunday
  // Days until the FIRST Sunday: (7 - dow) % 7 (0 if May 1 is Sunday)
  const firstSundayOffset = (7 - dow) % 7;
  const firstSunday = 1 + firstSundayOffset;
  const secondSunday = firstSunday + 7;
  const mm = "05";
  const dd = String(secondSunday).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Very small Easter approximation table (Australian dates, 2024–2032).
 * Easter Sunday is astronomically computed; hard-coding a decade covers
 * the practical lifetime of this build and dodges the whole Computus
 * calculation. Update when needed.
 */
const EASTER_SUNDAYS: Record<number, string> = {
  2024: "2024-03-31",
  2025: "2025-04-20",
  2026: "2026-04-05",
  2027: "2027-03-28",
  2028: "2028-04-16",
  2029: "2029-04-01",
  2030: "2030-04-21",
  2031: "2031-04-13",
  2032: "2032-03-28",
};

/**
 * Return the theme to display for a given local date. Defaults to now().
 * Priority: holidays first, then the ambient AU season.
 */
export function getSeasonForDate(d: Date = new Date()): SeasonTheme {
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  const day = d.getDate();

  // ---- Holidays (fixed windows) ----
  // Christmas: Dec 15 – Dec 31 (extended window to feel festive early)
  if (m === 12 && day >= 15) return THEMES.christmas;
  // Valentine's: Feb 13 – Feb 15
  if (m === 2 && day >= 13 && day <= 15) return THEMES.valentines;
  // Halloween: Oct 25 – Oct 31
  if (m === 10 && day >= 25) return THEMES.halloween;
  // Australia Day: Jan 24 – Jan 27
  if (m === 1 && day >= 24 && day <= 27) return THEMES.australia_day;
  // Easter: Good Friday (–2) through Easter Monday (+1)
  const easterISO = EASTER_SUNDAYS[y];
  if (easterISO) {
    const [ey, em, ed] = easterISO.split("-").map((n) => parseInt(n, 10));
    const easter = new Date(ey, em - 1, ed);
    const start = new Date(easter); start.setDate(easter.getDate() - 2);
    const end = new Date(easter); end.setDate(easter.getDate() + 1);
    if (d >= startOfDay(start) && d <= endOfDay(end)) return THEMES.easter;
  }
  // Mother's Day: the day itself, Australia
  const md = mothersDayForYear(y);
  const [my, mm, dd] = md.split("-").map((n) => parseInt(n, 10));
  if (y === my && m === mm && day === dd) return THEMES.mothers_day;

  // ---- Ambient AU (Southern Hemisphere) seasons ----
  // Summer: Dec, Jan, Feb
  if (m === 12 || m === 1 || m === 2) return THEMES.summer;
  // Autumn: Mar, Apr, May
  if (m >= 3 && m <= 5) return THEMES.autumn;
  // Winter: Jun, Jul, Aug
  if (m >= 6 && m <= 8) return THEMES.winter;
  // Spring: Sep, Oct, Nov
  return THEMES.spring;
}

function startOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function endOfDay(d: Date) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
}

/** Convenience — today's theme in Australian local time. */
export function getCurrentSeason(): SeasonTheme {
  return getSeasonForDate(new Date());
}
