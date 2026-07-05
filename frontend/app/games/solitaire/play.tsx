import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import { getCurrentSeason } from "@/src/lib/seasons";
import {
  newGame, draw, moveWasteToTableau, moveWasteToFoundation,
  moveTableauToTableau, moveTableauToFoundation, autoComplete, canAutoComplete,
  findHint, isWon, SUITS, SUIT_SYMBOL, RANK_LABEL, isRed,
  type Card, type GameState, type Suit,
} from "@/src/lib/solitaire";

/**
 * Klondike Solitaire — play screen
 *
 * All requested features from launch spec (June 2026):
 *   • Draw 3 (default) with drawCount plumbed for a future Draw 1 toggle.
 *   • 4 foundations (♠ ♥ ♦ ♣).
 *   • Unlimited Undo (state stack).
 *   • Hint button — engine returns the first beneficial move.
 *   • Auto-complete when the game is solvable (button appears when
 *     ready; fires the engine's autoComplete() then declares a win).
 *   • Butterfly-themed card backs — rendered via colour + emoji so no
 *     asset shipping is needed; picks up the current seasonal palette.
 *   • Butterfly Points — awarded via /api/games/solitaire/award on
 *     every finished session (+2 played, +10 won).
 *
 * Interaction model (mobile-first): tap-to-select-then-tap-to-drop.
 * Drag & drop is a nice-to-have but tap is more accessible for older
 * players and works identically on iOS / Android / Web.
 */

export default function SolitairePlay() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const season = useMemo(() => getCurrentSeason(), []);

  const [state, setState] = useState<GameState>(() => newGame({ drawCount: 3 }));
  const [history, setHistory] = useState<GameState[]>([]);
  const [sel, setSel] = useState<null | { kind: "waste" } | { kind: "tableau"; pile: number; index: number }>(null);
  const [hintFlash, setHintFlash] = useState<null | { pile?: number; suit?: Suit; label: string }>(null);
  const [awarded, setAwarded] = useState<"played" | "won" | null>(null);
  const startedAt = useRef<number>(Date.now());
  const [lifetime, setLifetime] = useState<{ wins: number; played: number }>({ wins: 0, played: 0 });

  // Fetch lifetime counters so the header can show "Wins 12".
  useEffect(() => {
    if (!user) return;
    api.solitaireStats(user.id).then((s: any) => setLifetime({ wins: s.lifetime_wins || 0, played: s.lifetime_played || 0 })).catch(() => {});
  }, [user?.id]);

  // Detect a win — declare it once, award points, refresh user.
  useEffect(() => {
    if (isWon(state) && awarded !== "won") {
      setAwarded("won");
      if (user) {
        const dur = Math.round((Date.now() - startedAt.current) / 1000);
        api.solitaireAward(user.id, { outcome: "won", moves: state.moves, duration_seconds: dur, seed: state.seed })
          .then((r: any) => {
            setLifetime({ wins: r.lifetime_wins || 0, played: r.lifetime_played || 0 });
            refresh().catch(() => {});
          })
          .catch(() => {});
      }
      show("🦋 You won! +10 Butterfly Points");
    }
  }, [state, awarded, user?.id, refresh, show]);

  const push = useCallback((next: GameState | null) => {
    if (!next) return;
    setHistory((h) => h.concat(state));
    setState(next);
    setSel(null);
  }, [state]);

  const undo = () => {
    if (history.length === 0) return;
    setHistory((h) => {
      const last = h[h.length - 1];
      setState(last);
      return h.slice(0, -1);
    });
    setSel(null);
  };

  const newDeal = async () => {
    // Award "played" points on abandoning an unfinished game — matches
    // "+2 pts per session" spec regardless of result.
    if (user && awarded !== "won" && state.moves > 3) {
      try {
        const dur = Math.round((Date.now() - startedAt.current) / 1000);
        const r: any = await api.solitaireAward(user.id, { outcome: "played", moves: state.moves, duration_seconds: dur, seed: state.seed });
        setLifetime({ wins: r.lifetime_wins || 0, played: r.lifetime_played || 0 });
        refresh().catch(() => {});
        show("+2 Butterfly Points for playing 🦋");
      } catch { /* silent */ }
    }
    startedAt.current = Date.now();
    setState(newGame({ drawCount: 3 }));
    setHistory([]);
    setSel(null);
    setAwarded(null);
  };

  // Award "played" pts once when the user leaves — do a best-effort
  // on unmount so the counter feels natural even if they never win.
  useEffect(() => {
    return () => {
      if (user && awarded !== "won" && state.moves > 3) {
        try {
          const dur = Math.round((Date.now() - startedAt.current) / 1000);
          api.solitaireAward(user.id, { outcome: "played", moves: state.moves, duration_seconds: dur, seed: state.seed }).catch(() => {});
        } catch { /* silent */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- interaction ----------

  const onDraw = () => push(draw(state));

  const onTapWaste = () => {
    if (state.waste.length === 0) return;
    // If nothing selected, select the waste top.
    if (!sel) { setSel({ kind: "waste" }); return; }
    // If waste is already selected, try foundation as a shortcut.
    if (sel.kind === "waste") {
      const next = moveWasteToFoundation(state);
      if (next) push(next); else setSel(null);
    }
  };

  const onTapTableauCard = (pile: number, index: number) => {
    const p = state.tableau[pile];
    const card = p[index];
    if (!card || !card.faceUp) return;
    if (!sel) { setSel({ kind: "tableau", pile, index }); return; }
    // Attempt move sel -> this pile (only if tapping the top of dest)
    if (sel.kind === "tableau" && sel.pile !== pile) {
      const next = moveTableauToTableau(state, sel.pile, sel.index, pile);
      if (next) { push(next); return; }
    }
    if (sel.kind === "waste") {
      const next = moveWasteToTableau(state, pile);
      if (next) { push(next); return; }
    }
    // Reselect
    setSel({ kind: "tableau", pile, index });
  };

  const onTapEmptyTableau = (pile: number) => {
    if (!sel) return;
    if (sel.kind === "tableau") {
      const next = moveTableauToTableau(state, sel.pile, sel.index, pile);
      if (next) { push(next); return; }
    } else if (sel.kind === "waste") {
      const next = moveWasteToTableau(state, pile);
      if (next) { push(next); return; }
    }
    setSel(null);
  };

  const onTapFoundation = (suit: Suit) => {
    if (!sel) return;
    if (sel.kind === "waste") {
      const w = state.waste[state.waste.length - 1];
      if (w && w.suit === suit) {
        const next = moveWasteToFoundation(state);
        if (next) { push(next); return; }
      }
    } else if (sel.kind === "tableau") {
      const p = state.tableau[sel.pile];
      if (sel.index === p.length - 1) {
        const t = p[p.length - 1];
        if (t.suit === suit) {
          const next = moveTableauToFoundation(state, sel.pile);
          if (next) { push(next); return; }
        }
      }
    }
    setSel(null);
  };

  const onHint = () => {
    const h = findHint(state);
    if (!h) { show("No obvious moves — try the stock pile 🃏"); setHintFlash(null); return; }
    let label = "";
    let flash: any = {};
    if (h.kind === "waste-to-foundation") { label = `Move waste card to ${SUIT_SYMBOL[h.suit]} foundation`; flash = { suit: h.suit }; }
    if (h.kind === "waste-to-tableau") { label = `Move waste card to column ${h.toPile + 1}`; flash = { pile: h.toPile }; }
    if (h.kind === "tableau-to-foundation") { label = `Send column ${h.fromPile + 1} to ${SUIT_SYMBOL[h.suit]} foundation`; flash = { pile: h.fromPile, suit: h.suit }; }
    if (h.kind === "tableau-to-tableau") { label = `Move column ${h.fromPile + 1} → column ${h.toPile + 1}`; flash = { pile: h.toPile }; }
    setHintFlash({ ...flash, label });
    show(label);
    setTimeout(() => setHintFlash(null), 2500);
  };

  const onAutoComplete = () => {
    if (!canAutoComplete(state)) { show("Not yet — flip all face-down cards first"); return; }
    setHistory((h) => h.concat(state));
    setState(autoComplete(state));
  };

  const won = isWon(state);

  return (
    <View style={{ flex: 1, backgroundColor: season.felt }}>
      <Header
        title="Solitaire"
        emoji="🦋"
        subtitle={`Klondike · Draw 3 · ${season.label}`}
        backHref="/games/solitaire"
      />

      {/* Top bar: foundations + stock + waste. Sticks at top so the
          large tableau below can scroll if needed on small phones. */}
      <View style={[styles.topBar, { backgroundColor: season.felt }]}>
        <View style={styles.foundationsRow}>
          {SUITS.map((s) => {
            const stack = state.foundations[s];
            const top = stack[stack.length - 1];
            const isFlashed = hintFlash?.suit === s;
            return (
              <Pressable
                key={s}
                testID={`foundation-${s}`}
                onPress={() => onTapFoundation(s)}
                style={[styles.slot, { borderColor: isFlashed ? season.accent : season.outline }]}
              >
                {top ? (
                  <CardFace card={top} />
                ) : (
                  <Text style={[styles.slotSuit, { color: isRed(s) ? "#FCA5A5" : "#CBD5E1" }]}>{SUIT_SYMBOL[s]}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.stockRow}>
          <Pressable testID="solitaire-stock" onPress={onDraw} style={[styles.slot, { borderColor: season.outline }]}>
            {state.stock.length > 0 ? (
              <CardBack season={season} />
            ) : (
              <View style={styles.recycle}>
                <Ionicons name="refresh" size={26} color="#CBD5E1" />
              </View>
            )}
          </Pressable>
          <Pressable
            testID="solitaire-waste"
            onPress={onTapWaste}
            style={[styles.slot, {
              borderColor: sel?.kind === "waste" ? season.accent : season.outline,
              borderWidth: sel?.kind === "waste" ? 3 : 2,
            }]}
          >
            {state.waste.length > 0 ? (
              <CardFace card={state.waste[state.waste.length - 1]} />
            ) : (
              <Text style={[styles.slotSuit, { color: "#CBD5E1" }]}>—</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Tableau — 7 columns. Cards stack with a partial reveal so you
          can still tap the card underneath. On phones this fits when
          each card is ~44px wide and the pile stagger is ~22px. */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 4, paddingBottom: 100 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.tableauRow}>
          {state.tableau.map((pile, pi) => {
            const isFlashed = hintFlash?.pile === pi;
            return (
              <View key={pi} style={styles.tableauCol}>
                {pile.length === 0 ? (
                  <Pressable
                    testID={`tableau-empty-${pi}`}
                    onPress={() => onTapEmptyTableau(pi)}
                    style={[styles.slot, styles.tableauEmpty, { borderColor: isFlashed ? season.accent : season.outline }]}
                  >
                    <Text style={[styles.slotSuit, { color: "#CBD5E1" }]}>K</Text>
                  </Pressable>
                ) : (
                  pile.map((card, ci) => {
                    const isSel = sel?.kind === "tableau" && sel.pile === pi && sel.index <= ci;
                    return (
                      <Pressable
                        key={card.id}
                        testID={`tableau-${pi}-${ci}`}
                        onPress={() => onTapTableauCard(pi, ci)}
                        style={[
                          styles.tableauCard,
                          { top: ci * (card.faceUp ? 24 : 14) },
                          isSel && { borderColor: season.accent, borderWidth: 3 },
                          isFlashed && ci === pile.length - 1 && { borderColor: season.accent, borderWidth: 3 },
                        ]}
                      >
                        {card.faceUp ? <CardFace card={card} /> : <CardBack season={season} />}
                      </Pressable>
                    );
                  })
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable testID="solitaire-undo" onPress={undo} disabled={history.length === 0} style={[styles.ctrlBtn, { backgroundColor: history.length ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)" }]}>
          <Ionicons name="arrow-undo" size={20} color="#FFF" />
          <Text style={styles.ctrlText}>Undo</Text>
        </Pressable>
        <Pressable testID="solitaire-hint" onPress={onHint} style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Ionicons name="bulb" size={20} color="#FDE68A" />
          <Text style={styles.ctrlText}>Hint</Text>
        </Pressable>
        {canAutoComplete(state) && !won && (
          <Pressable testID="solitaire-auto" onPress={onAutoComplete} style={[styles.ctrlBtn, { backgroundColor: season.accent }]}>
            <Ionicons name="sparkles" size={20} color="#0F172A" />
            <Text style={[styles.ctrlText, { color: "#0F172A" }]}>Finish</Text>
          </Pressable>
        )}
        <Pressable testID="solitaire-newdeal" onPress={newDeal} style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Ionicons name="reload" size={20} color="#FFF" />
          <Text style={styles.ctrlText}>New Deal</Text>
        </Pressable>
      </View>

      {/* Win overlay */}
      {won && (
        <View pointerEvents="box-none" style={styles.winOverlay}>
          <View style={[styles.winCard, { backgroundColor: c.surface, borderColor: season.accent }]}>
            <Text style={{ fontSize: 44 }}>🦋</Text>
            <Text style={[styles.winTitle, { color: c.onSurface, fontSize: 24 * scale }]}>You won!</Text>
            <Text style={{ color: c.muted, fontSize: 15 * scale, marginTop: 4 }}>
              +10 Butterfly Points · lifetime wins {lifetime.wins}
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16, alignSelf: "stretch" }}>
              <Pressable testID="solitaire-win-close" onPress={() => router.replace("/games/solitaire" as any)} style={[styles.winBtn, { borderColor: c.border, borderWidth: 1.5 }]}>
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Done</Text>
              </Pressable>
              <Pressable testID="solitaire-win-again" onPress={newDeal} style={[styles.winBtn, { backgroundColor: season.accent }]}>
                <Text style={{ color: "#0F172A", fontWeight: "900", fontSize: 15 * scale }}>Play again</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ---------- card visuals ----------

function CardFace({ card }: { card: Card }) {
  const red = isRed(card.suit);
  return (
    <View style={styles.card}>
      <Text style={[styles.cardCorner, { color: red ? "#DC2626" : "#0F172A", top: 4, left: 4 }]}>
        {RANK_LABEL[card.rank]}
        {"\n"}
        {SUIT_SYMBOL[card.suit]}
      </Text>
      <Text style={[styles.cardCenter, { color: red ? "#DC2626" : "#0F172A" }]}>{SUIT_SYMBOL[card.suit]}</Text>
    </View>
  );
}

function CardBack({ season }: { season: ReturnType<typeof getCurrentSeason> }) {
  // Butterfly-themed back — a chevron of two seasonal colours with a
  // giant butterfly emoji in the centre. Ships with zero image assets
  // so it looks correct on iOS, Android, and Web without any bundling.
  return (
    <View style={[styles.cardBack, { backgroundColor: season.cardBackPrimary }]}>
      <View style={[styles.cardBackDiag, { backgroundColor: season.cardBackSecondary }]} />
      <Text style={styles.cardBackEmoji}>🦋</Text>
    </View>
  );
}

// ---------- styles ----------

const CARD_W = 44;
const CARD_H = 62;

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  foundationsRow: { flexDirection: "row", gap: 6 },
  stockRow: { flexDirection: "row", gap: 6 },
  slot: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  slotSuit: { fontSize: 26, fontWeight: "700" },
  recycle: { alignItems: "center", justifyContent: "center" },
  tableauRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, gap: 4 },
  tableauCol: { width: CARD_W, minHeight: 400, position: "relative" },
  tableauEmpty: { alignSelf: "flex-start" },
  tableauCard: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
    borderRadius: 6,
    left: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#0F172A",
    backgroundColor: "#FFFFFF",
    ...Platform.select({ web: { boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }, default: {} }),
  },
  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    padding: 2,
    justifyContent: "space-between",
  },
  cardCorner: { position: "absolute", fontSize: 12, fontWeight: "900", lineHeight: 12, textAlign: "left" },
  cardCenter: { fontSize: 26, alignSelf: "center", marginTop: 16, fontWeight: "700" },
  cardBack: {
    flex: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardBackDiag: {
    position: "absolute",
    width: "160%",
    height: 14,
    top: "50%",
    left: "-30%",
    transform: [{ rotate: "-20deg" }],
    opacity: 0.55,
  },
  cardBackEmoji: { fontSize: 24 },
  controls: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingTop: 10,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderTopColor: "rgba(255,255,255,0.1)",
    borderTopWidth: 1,
  },
  ctrlBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ctrlText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  winOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  winCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 22,
    borderWidth: 2,
    padding: 24,
    alignItems: "center",
  },
  winTitle: { fontWeight: "900", marginTop: 6 },
  winBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
