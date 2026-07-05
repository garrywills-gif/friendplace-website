/**
 * Klondike Solitaire — pure engine
 * ---------------------------------
 * No React, no rendering — just types + reducer-style functions the play
 * screen can consume. The game state is a plain immutable object so undo
 * is a simple state-stack push/pop and testing is trivial.
 *
 * Board:
 *   • 7 tableau piles (numbered 0..6). Cards below the top are `faceUp`
 *     iff they were revealed by the player. New tableau piles start with
 *     N face-down cards then 1 face-up card on top.
 *   • 4 foundations (♠ ♥ ♦ ♣). Empty by default. Foundations only accept
 *     the next-rank card of their suit (A→2→…→K).
 *   • 1 stock (draw pile). Ordered face-down list.
 *   • 1 waste (discard pile). Cards flipped from stock are face-up.
 *
 * Rules implemented:
 *   • Draw 3 (default). `drawCount` is configurable so a future settings
 *     panel can flip to Draw 1 without engine changes.
 *   • Tableau builds in alternating colours, descending rank.
 *   • Foundation builds in same-suit, ascending rank starting at Ace.
 *   • Empty tableau accepts King only.
 *   • Auto-flip of the newly exposed tableau top card after a move.
 *   • Stock re-deals from waste when exhausted (unlimited redeals).
 *   • Win = all 52 cards on foundations.
 *   • `hint()` returns the first legally beneficial move, or null.
 *   • `canAutoComplete()` = every tableau card face-up AND stock/waste
 *     empty. When true the UI can offer "Finish the game" and the engine
 *     will flush all cards to foundations automatically.
 */

export type Suit = "S" | "H" | "D" | "C";
export const SUITS: Suit[] = ["S", "H", "D", "C"];
export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_LABEL: Record<Suit, string> = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
export function isRed(suit: Suit): boolean { return suit === "H" || suit === "D"; }

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export const RANK_LABEL: Record<Rank, string> = {
  1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K",
};

export type Card = {
  id: string; // e.g. "H7", stable across shuffles
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
};

export type GameState = {
  tableau: Card[][]; // 7 piles
  foundations: Record<Suit, Card[]>; // stack per suit (top of foundation = last)
  stock: Card[]; // face-down (last is next to draw)
  waste: Card[]; // face-up (last is topmost)
  drawCount: 1 | 3;
  moves: number;
  seed: number;
};

export type HintMove =
  | { kind: "waste-to-foundation"; suit: Suit }
  | { kind: "waste-to-tableau"; toPile: number }
  | { kind: "tableau-to-foundation"; fromPile: number; suit: Suit }
  | { kind: "tableau-to-tableau"; fromPile: number; fromIndex: number; toPile: number };

export type PileRef =
  | { kind: "tableau"; pile: number; index: number }
  | { kind: "waste" }
  | { kind: "foundation"; suit: Suit };

// ---------- deck helpers ----------

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) {
    for (let r = 1 as Rank; r <= 13; r = (r + 1) as Rank) {
      d.push({ id: `${s}${r}`, suit: s, rank: r, faceUp: false });
    }
  }
  return d;
}

/** Deterministic Mulberry32 PRNG so a `seed` reproduces identical shuffles. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  const rnd = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newGame(opts?: { seed?: number; drawCount?: 1 | 3 }): GameState {
  const seed = opts?.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const drawCount = opts?.drawCount ?? 3;
  const deck = shuffle(freshDeck(), seed);

  const tableau: Card[][] = Array.from({ length: 7 }, () => []);
  let k = 0;
  // Deal 1,2,3,4,5,6,7 cards — only the top of each pile is face-up.
  for (let col = 0; col < 7; col++) {
    for (let r = 0; r <= col; r++) {
      const card = { ...deck[k++], faceUp: r === col };
      tableau[col].push(card);
    }
  }
  const stock = deck.slice(k).map((c) => ({ ...c, faceUp: false }));
  return {
    tableau,
    foundations: { S: [], H: [], D: [], C: [] },
    stock,
    waste: [],
    drawCount,
    moves: 0,
    seed,
  };
}

// ---------- rule checks ----------

export function canDropOnTableau(card: Card, dest: Card[]): boolean {
  if (dest.length === 0) return card.rank === 13; // Kings only on empty column
  const top = dest[dest.length - 1];
  if (!top.faceUp) return false;
  return (top.rank as number) === (card.rank as number) + 1 && isRed(card.suit) !== isRed(top.suit);
}

export function canDropOnFoundation(card: Card, foundation: Card[]): boolean {
  if (foundation.length === 0) return card.rank === 1;
  const top = foundation[foundation.length - 1];
  if (top.suit !== card.suit) return false;
  return (card.rank as number) === (top.rank as number) + 1;
}

// ---------- actions (all pure — return a NEW state) ----------

function clone(state: GameState): GameState {
  return {
    tableau: state.tableau.map((p) => p.slice()),
    foundations: { S: state.foundations.S.slice(), H: state.foundations.H.slice(), D: state.foundations.D.slice(), C: state.foundations.C.slice() },
    stock: state.stock.slice(),
    waste: state.waste.slice(),
    drawCount: state.drawCount,
    moves: state.moves,
    seed: state.seed,
  };
}

/** Draw N cards from stock to waste (flipping face-up). If stock empty,
 *  recycle the entire waste back to stock reversed & face-down. */
export function draw(state: GameState): GameState {
  const s = clone(state);
  if (s.stock.length === 0) {
    if (s.waste.length === 0) return state; // no-op
    // Reverse waste onto stock, all face-down.
    s.stock = s.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    s.waste = [];
    s.moves += 1;
    return s;
  }
  const n = Math.min(s.drawCount, s.stock.length);
  const taken = s.stock.splice(s.stock.length - n, n).reverse().map((c) => ({ ...c, faceUp: true }));
  s.waste = s.waste.concat(taken);
  s.moves += 1;
  return s;
}

/** Move a slice of tableau cards (from `fromPile`, starting at `fromIndex`)
 *  to tableau `toPile`. All cards in the slice must be face-up and form
 *  a valid alternating-colour descending run. */
export function moveTableauToTableau(state: GameState, fromPile: number, fromIndex: number, toPile: number): GameState | null {
  if (fromPile === toPile) return null;
  const src = state.tableau[fromPile];
  if (fromIndex < 0 || fromIndex >= src.length) return null;
  const slice = src.slice(fromIndex);
  if (slice.some((c) => !c.faceUp)) return null;
  // Validate the slice itself is a legal descending alt-colour run.
  for (let i = 0; i < slice.length - 1; i++) {
    const a = slice[i], b = slice[i + 1];
    if ((a.rank as number) - 1 !== (b.rank as number)) return null;
    if (isRed(a.suit) === isRed(b.suit)) return null;
  }
  if (!canDropOnTableau(slice[0], state.tableau[toPile])) return null;
  const s = clone(state);
  s.tableau[toPile] = s.tableau[toPile].concat(slice);
  s.tableau[fromPile] = s.tableau[fromPile].slice(0, fromIndex);
  // Auto-flip newly exposed card
  const rest = s.tableau[fromPile];
  if (rest.length > 0 && !rest[rest.length - 1].faceUp) {
    rest[rest.length - 1] = { ...rest[rest.length - 1], faceUp: true };
  }
  s.moves += 1;
  return s;
}

export function moveWasteToTableau(state: GameState, toPile: number): GameState | null {
  if (state.waste.length === 0) return null;
  const card = state.waste[state.waste.length - 1];
  if (!canDropOnTableau(card, state.tableau[toPile])) return null;
  const s = clone(state);
  s.waste = s.waste.slice(0, -1);
  s.tableau[toPile] = s.tableau[toPile].concat(card);
  s.moves += 1;
  return s;
}

export function moveWasteToFoundation(state: GameState): GameState | null {
  if (state.waste.length === 0) return null;
  const card = state.waste[state.waste.length - 1];
  if (!canDropOnFoundation(card, state.foundations[card.suit])) return null;
  const s = clone(state);
  s.waste = s.waste.slice(0, -1);
  s.foundations[card.suit] = s.foundations[card.suit].concat(card);
  s.moves += 1;
  return s;
}

export function moveTableauToFoundation(state: GameState, fromPile: number): GameState | null {
  const src = state.tableau[fromPile];
  if (src.length === 0) return null;
  const card = src[src.length - 1];
  if (!card.faceUp) return null;
  if (!canDropOnFoundation(card, state.foundations[card.suit])) return null;
  const s = clone(state);
  s.tableau[fromPile] = src.slice(0, -1);
  s.foundations[card.suit] = s.foundations[card.suit].concat(card);
  // Auto-flip newly exposed card
  const rest = s.tableau[fromPile];
  if (rest.length > 0 && !rest[rest.length - 1].faceUp) {
    rest[rest.length - 1] = { ...rest[rest.length - 1], faceUp: true };
  }
  s.moves += 1;
  return s;
}

/** Return the first non-trivial move we can find, or null. Preferred
 *  order: send-to-foundation, then reveal a face-down card, then any
 *  tableau→tableau or waste→tableau. */
export function findHint(state: GameState): HintMove | null {
  // 1) tableau → foundation
  for (let p = 0; p < 7; p++) {
    const src = state.tableau[p];
    if (src.length === 0) continue;
    const t = src[src.length - 1];
    if (t.faceUp && canDropOnFoundation(t, state.foundations[t.suit])) {
      return { kind: "tableau-to-foundation", fromPile: p, suit: t.suit };
    }
  }
  // 2) waste → foundation
  if (state.waste.length > 0) {
    const t = state.waste[state.waste.length - 1];
    if (canDropOnFoundation(t, state.foundations[t.suit])) return { kind: "waste-to-foundation", suit: t.suit };
  }
  // 3) tableau → tableau that reveals a face-down card
  for (let p = 0; p < 7; p++) {
    const src = state.tableau[p];
    if (src.length === 0) continue;
    // Try to find first face-up index in this pile
    let firstFaceUp = -1;
    for (let i = 0; i < src.length; i++) if (src[i].faceUp) { firstFaceUp = i; break; }
    if (firstFaceUp <= 0) continue; // no face-down under this run
    const head = src[firstFaceUp];
    for (let q = 0; q < 7; q++) {
      if (q === p) continue;
      if (canDropOnTableau(head, state.tableau[q])) {
        return { kind: "tableau-to-tableau", fromPile: p, fromIndex: firstFaceUp, toPile: q };
      }
    }
  }
  // 4) waste → tableau (any pile)
  if (state.waste.length > 0) {
    const t = state.waste[state.waste.length - 1];
    for (let q = 0; q < 7; q++) {
      if (canDropOnTableau(t, state.tableau[q])) return { kind: "waste-to-tableau", toPile: q };
    }
  }
  return null;
}

export function isWon(state: GameState): boolean {
  return SUITS.every((s) => state.foundations[s].length === 13);
}

/** All tableau cards face-up and no draw pile left = we can flush. */
export function canAutoComplete(state: GameState): boolean {
  if (state.stock.length > 0 || state.waste.length > 0) return false;
  return state.tableau.every((p) => p.every((c) => c.faceUp));
}

/** Run the game to completion by repeatedly sending the smallest-rank
 *  legal tableau top to its foundation. Returns the final state. */
export function autoComplete(state: GameState): GameState {
  let s = state;
  let safety = 200;
  while (!isWon(s) && safety-- > 0) {
    let moved = false;
    for (let p = 0; p < 7; p++) {
      const next = moveTableauToFoundation(s, p);
      if (next) { s = next; moved = true; break; }
    }
    if (!moved) break;
  }
  return s;
}
