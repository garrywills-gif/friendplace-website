/**
 * Curated "Today's Thought" pool for YouBelong's home screen.
 * Deterministic pick by date, plus a manual shuffle and saved favourites.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const THOUGHTS: string[] = [
  "You belong here.",
  "A conversation can brighten someone's whole day.",
  "Today's a good day to meet someone new.",
  "The best friendships often start with a simple chat.",
  "A small hello can lead to a big friendship.",
  "You're never too old to make a new friend.",
  "Kind words cost nothing and mean everything.",
  "Reach out — someone is hoping you will.",
  "A shared cuppa is a shared moment.",
  "Every story is worth hearing.",
  "Your community is just one conversation away.",
  "Today, give a compliment to a stranger.",
  "Friends are the family we choose.",
  "It takes courage to say hello — be brave today.",
  "Old hobbies, new friends.",
  "You matter. To us, and to someone else today.",
  "Laughter shared is laughter doubled.",
  "Be the reason someone smiles today.",
  "A quiet day is a good day to plan a chat tomorrow.",
  "Sharing a memory is sharing a piece of yourself.",
  "Walk together, talk together.",
  "The world needs your stories.",
  "Connection is the simplest medicine.",
  "Wave to a neighbour today.",
  "Coffee tastes better with a friend.",
  "A good listener is worth a thousand words.",
  "Even small communities make big differences.",
  "Try something new this week — friends often follow.",
  "Compliment a stranger. You might just make their day.",
  "Be kind to yourself first; the rest follows.",
  "A short call can outlast a long day.",
  "Your presence is a gift.",
  "Old songs, new conversations.",
  "A friendly face changes everything.",
  "The door is always open here.",
];

export function getThoughtForDate(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const seed = yyyy * 10000 + mm * 100 + dd;
  return THOUGHTS[seed % THOUGHTS.length];
}

export function getRandomThought(exclude?: string): string {
  if (THOUGHTS.length <= 1) return THOUGHTS[0];
  let next = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)];
  while (exclude && next === exclude) {
    next = THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)];
  }
  return next;
}

// --------- Favourites ---------
const FAV_KEY = "yb_thought_favs";

export async function loadFavourites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x: any) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function saveFavourites(list: string[]): Promise<void> {
  try { await AsyncStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 200))); } catch {}
}

export async function toggleFavourite(thought: string): Promise<{ favourites: string[]; isFav: boolean }> {
  const list = await loadFavourites();
  const idx = list.indexOf(thought);
  if (idx >= 0) {
    list.splice(idx, 1);
    await saveFavourites(list);
    return { favourites: list, isFav: false };
  }
  list.unshift(thought);
  await saveFavourites(list);
  return { favourites: list, isFav: true };
}
