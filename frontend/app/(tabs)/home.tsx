import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, RefreshControl, Modal, Animated, Dimensions, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import { emitFlutter } from "@/src/lib/flutter-fx";
import SpeakButton from "@/src/components/SpeakButton";
import AvatarBubble from "@/src/components/AvatarBubble";
import ShareFriendPlace from "@/src/components/ShareFriendPlace";
import FirstRunCard from "@/src/components/FirstRunCard";
import BrandLockup from "@/src/components/BrandLockup";
import MyStatusCard from "@/src/components/status/MyStatusCard";
import { GeorgeRemembersBanner } from "@/src/components/george/GeorgeRemembersBanner";
import { getThoughtForDate, getRandomThought, loadFavourites, toggleFavourite } from "@/src/lib/thoughts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GeorgeButterflyMark } from "@/src/components/george/GeorgeButterflyMark";

type Tile = {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  bg: string;
  ink: string;
  sub?: string;      // secondary line under the title (2x3 tiles only)
  full?: boolean;    // hero tile (FP Café) — spans full width
  badge?: number;    // optional red unread-count badge (e.g. My Chats)
};

export default function Home() {
  const router = useRouter();
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const insets = useSafeAreaInsets();
  const [flutters, setFlutters] = useState<any[]>([]);
  // Batch B iter157 (Garry, Aug 2026 — P0 #5): incoming friend
  // requests surfaced ON Home so members don't miss them if they never
  // open the notifications bell. Polled on focus + on pull-to-refresh.
  const [pendingFriendReqs, setPendingFriendReqs] = useState<any[]>([]);
  const [unread, setUnread] = useState<number>(0);
  // DM unread total surfaces as a badge on the My Chats Home tile
  // (Garry, 4 Aug 2026 TestFlight polish — Chats needed a discoverable
  // Home entry point in addition to the tab bar). Same 15s poll cadence
  // as the ChatsIcon in the tab bar.
  const [chatsUnread, setChatsUnread] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [thought, setThought] = useState<string>(() => getThoughtForDate());
  const [isFav, setIsFav] = useState<boolean>(false);
  const [community, setCommunity] = useState<any>(null);
  const [invitedCount, setInvitedCount] = useState<number>(0);
  // Live "X of 250 Founding Members" counter — drives the Wall entry card
  // that sits just under the Butterfly Points tile. Null until the first
  // status fetch returns so the card stays hidden during the brief boot
  // window rather than flickering empty state.
  const [founderStatus, setFounderStatus] = useState<{ taken: number; cap: number; remaining: number; open: boolean } | null>(null);
  // Moment of the Week — populated from /api/moments/featured. Home
  // celebrates that member's moment with a small banner just above the
  // tile grid; the feed itself still shows a "Featured" badge in place.
  const [featuredMoment, setFeaturedMoment] = useState<any>(null);
  // Butterfly Points details modal — previously the whole tile did a hard
  // navigation to /profile, which made the Home screen "close" behind the
  // user with no context. Now the tile opens an inline modal that shows
  // the current total plus a friendly "how to earn more" breakdown, and
  // offers a secondary "View full profile" button for anyone who wants to
  // keep drilling in. Much less jarring for older users.
  const [pointsInfoOpen, setPointsInfoOpen] = useState(false);
  // Incoming-flutter arrival animation.
  //
  // First time this Home mounts after login (i.e., a fresh session)
  // AND the initial flutters fetch returns at least one flutter, we
  // play the "receive" butterfly animation: a small butterfly enters
  // from the top edge, glides down and lands on the flutter card,
  // then the card gently fades in. This creates a warm "look who
  // arrived while you were away" moment.
  //
  // Subsequent focuses (tab switches, refreshes) don't replay — the
  // butterfly's arrival is a signature login-only beat.
  const flutterCardRef = useRef<View>(null);
  // Ref to the notification bell pill in the top-right of the header —
  // the "receive" flutter animation flies from the bottom of the screen
  // up onto this bell (fits the "you have a new notification" story).
  const bellRef = useRef<View>(null);
  const flutterCardOpacity = useRef(new Animated.Value(0)).current;
  const flutterCardTranslate = useRef(new Animated.Value(-8)).current;
  // Reset the session flag + the fade-in animation whenever the
  // signed-in user changes so a fresh login (or account switch)
  // replays the arrival.
  // Reset the arrival card's animated values when the logged-in user
  // changes (e.g., someone switches accounts). The "already welcomed
  // flutter IDs" set is keyed per-user in AsyncStorage so it's isolated
  // automatically — no reset needed here.
  useEffect(() => {
    flutterCardOpacity.setValue(0);
    flutterCardTranslate.setValue(-8);
  }, [user?.id, flutterCardOpacity, flutterCardTranslate]);

  const shuffleThought = () => setThought((t) => getRandomThought(t));

  /**
   * Switch to a sibling tab (or push a stack route). expo-router's
   * router.push/replace/navigate silently no-ops when switching between
   * sibling tabs on web (iPad Safari), so we fall back to a hard URL
   * change there. On native, router.replace works correctly.
   */
  const goTo = useCallback((href: string) => {
    // Use push (not replace) so tab-to-tab navigation adds to the nav
    // stack rather than swapping in place. Fixes an iPad bug where
    // tapping tiles that route to tab screens (/profile, /friends,
    // /lounge) would flash and immediately return to Home.
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).location.assign(href);
    } else {
      router.push(href as any);
    }
  }, [router]);

  // Gate: send brand-new users through the welcome tour first.
  useEffect(() => {
    if (user && (user as any).onboarding_completed === false) {
      router.replace("/onboarding");
    }
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadFavourites();
      if (!cancelled) setIsFav(list.includes(thought));
    })();
    return () => { cancelled = true; };
  }, [thought]);

  const toggleFav = async () => {
    const r = await toggleFavourite(thought);
    setIsFav(r.isFav);
  };

  const loadFlutters = async () => {
    if (!user) return;
    try {
      const list = (await api.myFlutters(user.id)) as any[];
      setFlutters(list);
      // Play the "arrival" butterfly animation ONLY when at least one
      // flutter in the current list is genuinely new — i.e., we haven't
      // already welcomed it in a previous session. We persist the set
      // of welcomed flutter IDs to AsyncStorage per user so the check
      // survives: tab switches (which unmount Home), app restarts, and
      // even device restarts. First arrival → animation plays; every
      // subsequent Home focus with the same flutter still waiting →
      // silent (card just appears). This directly addresses tester
      // feedback that the flutter was replaying on every navigation.
      const seenKey = `flutter_welcomed_ids::${user.id}`;
      let seen: Set<string>;
      try {
        const raw = await AsyncStorage.getItem(seenKey);
        seen = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        seen = new Set<string>();
      }
      const currentIds = list.map((f: any) => String(f.id)).filter(Boolean);
      const unwelcomed = currentIds.filter((id) => !seen.has(id));

      if (list.length > 0 && unwelcomed.length > 0) {
        // Persist the welcomed-set FIRST so a fast second focus (e.g.
        // the user tabs away and back before the animation finishes)
        // doesn't accidentally kick off a second butterfly.
        unwelcomed.forEach((id) => seen.add(id));
        try {
          await AsyncStorage.setItem(seenKey, JSON.stringify(Array.from(seen)));
        } catch {}

        // Give the ScrollView one frame to lay out the flutter card
        // container so the measurement below returns valid coords.
        requestAnimationFrame(() => {
          const { width: winW, height: winH } = Dimensions.get("window");
          // Butterfly enters from the BOTTOM edge of the screen and
          // glides UP to land on the notification bell in the top-right
          // of the header — ties the celebration directly to the bell
          // where the unread count lives.
          const enterX = winW * (0.2 + Math.random() * 0.6);
          const enterY = winH + 40;
          emitFlutter({
            startX: enterX,
            startY: enterY,
            targetRef: bellRef.current || flutterCardRef.current || undefined,
            onLand: () => {
              Animated.parallel([
                Animated.timing(flutterCardOpacity, {
                  toValue: 1,
                  duration: 320,
                  useNativeDriver: true,
                }),
                Animated.timing(flutterCardTranslate, {
                  toValue: 0,
                  duration: 360,
                  useNativeDriver: true,
                }),
              ]).start();
            },
          });
        });
      } else {
        // Either no flutters at all, OR every flutter has already been
        // welcomed on a previous focus. Skip the animation and just
        // reveal the card immediately (or keep it hidden if no flutters).
        if (list.length > 0) {
          flutterCardOpacity.setValue(1);
          flutterCardTranslate.setValue(0);
        } else {
          flutterCardOpacity.setValue(0);
          flutterCardTranslate.setValue(-8);
        }
      }
    } catch {}
    try { const r: any = await api.notificationCount(user.id); setUnread(r?.unread || 0); } catch {}
    try { const r: any = await api.dmUnreadTotal(user.id); setChatsUnread(Math.max(0, Number(r?.unread) || 0)); } catch {}
    // Batch B iter157 — poll incoming friend-request inbox for the
    // Home card. Non-blocking; if it fails we just leave the card
    // hidden.
    try {
      const inbox: any = await api.friendsInbox(user.id);
      setPendingFriendReqs(Array.isArray(inbox?.incoming) ? inbox.incoming : []);
    } catch { setPendingFriendReqs([]); }
    try { await api.heartbeat(user.id); } catch {}
    try { setCommunity(await api.communityToday(user.id)); } catch {}
    try {
      const s: any = await api.inviteStats(user.id);
      setInvitedCount(Number(s?.count) || 0);
    } catch {}
    try { setFounderStatus(await api.founderStatus()); } catch {}
    // Moment of the Week — silent fetch. Absence returns `moment: null`,
    // in which case the banner just doesn't render (no error state).
    try {
      const r: any = await api.getFeaturedMoment(user?.id);
      setFeaturedMoment(r?.moment || null);
    } catch {}
  };
  useFocusEffect(useCallback(() => { loadFlutters(); }, [user?.id]));

  /**
   * Open a DM with the person who flutter-ed us. Locked with Garry
   * 2 Aug 2026: this NO LONGER auto-dismisses the flutter card. We
   * record the response on the card so a ✅ badge shows the recipient
   * has already acted, and they can still close the card manually
   * whenever they're ready.
   */
  const chatFromFlutter = async (f: any) => {
    if (!user) return;
    try {
      await api.respondToFlutter(f.id, "chat_started");
    } catch { /* non-fatal — still open the chat */ }
    setFlutters((arr) =>
      arr.map((x) => (x.id === f.id ? { ...x, responded_action: "chat_started" } : x))
    );
    try {
      const conv = await api.startDm(user.id, f.from_id);
      router.push(`/dm/${conv.id}?other_id=${f.from_id}` as any);
    } catch {
      show("Couldn't open chat — please try again.");
    }
  };
  /**
   * Send a flutter back to the original sender. Card stays visible with
   * a ✅ "Fluttered back" state — the recipient dismisses it themselves
   * when they're ready (Garry, 2 Aug 2026).
   */
  const flutterBack = async (f: any, tap?: { pageX: number; pageY: number }) => {
    if (!user) return;
    try {
      await api.sendFlutter({ from_id: user.id, to_id: f.from_id });
      try { await api.respondToFlutter(f.id, "fluttered_back"); } catch { /* non-fatal */ }
      setFlutters((arr) =>
        arr.map((x) => (x.id === f.id ? { ...x, responded_action: "fluttered_back" } : x))
      );
      // Signature single-butterfly celebration. The toast is deferred
      // until the butterfly lands (via onLand) so the message arrives
      // with the butterfly.
      emitFlutter({
        targetX: tap?.pageX,
        targetY: tap?.pageY,
        onLand: () => show(`Fluttered back to ${f.from_name || "them"} 🦋`),
      });
    } catch (e: any) {
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("cannot flutter") || msg.includes("blocked")) {
        show("They're not taking flutters from you right now.");
      } else if (msg.includes("409") || msg.includes("flutter_already_active")) {
        // Already-active flutter — treat as success for UX purposes so
        // the card flips to the "Fluttered back" state without a scary
        // error toast.
        setFlutters((arr) =>
          arr.map((x) => (x.id === f.id ? { ...x, responded_action: "fluttered_back" } : x))
        );
        show(`You've already fluttered ${f.from_name || "them"} — waiting for a reply.`);
      } else if (msg.includes("rate") || msg.includes("429")) {
        show("Whoa — slow down on the flutters! Try again in a bit.");
      } else if (msg.includes("not found") || msg.includes("404")) {
        show("That person isn't on FriendPlace any more.");
      } else {
        show("Couldn't send flutter. Please try again.");
      }
    }
  };
  const dismissFlutter = async (f: any) => {
    // Explicit close from the recipient — this is what actually marks
    // the flutter read on the backend. Everything else (Flutter back /
    // Chat) leaves the card in place with a ✅ state.
    try { await api.markFlutterRead(f.id); } catch { /* non-fatal */ }
    setFlutters((arr) => arr.filter((x) => x.id !== f.id));
  };

  // ── Friend-request card actions (Batch B iter157 P0 #5) ──────────
  const acceptFriendReq = async (r: any) => {
    try {
      await api.acceptReq(r.id);
      show(`You and ${r?.other?.first_name || "your new friend"} are now friends 🦋`);
      // Optimistically remove the card row; loadFlutters will
      // reconcile the list on next focus / pull-to-refresh.
      setPendingFriendReqs((arr) => arr.filter((x) => x.id !== r.id));
    } catch { show("Could not accept — please try again."); }
  };
  const declineFriendReq = async (r: any) => {
    try {
      await api.declineReq(r.id);
      setPendingFriendReqs((arr) => arr.filter((x) => x.id !== r.id));
    } catch { show("Could not update — please try again."); }
  };

  const tiles: Tile[] = [
    // Standard 2×3 grid — pastel backgrounds, dark ink text, short
    // taglines. FP Café now sits at the top of the grid (still important
    // — just no longer the hero, since it depends on members being
    // online at the same time). Locked with Garry 31 July 2026.
    //
    // My Chats added 4 Aug 2026 (TestFlight polish): needed a
    // discoverable Home entry so Chats isn't only reachable via the
    // small tab-bar icon. Sits first so conversations are the very
    // first thing on Home — mirrors the messaging-first mental model.
    { key: "chats",   title: "My Chats",           icon: "chatbubbles",     route: "/chats",    bg: "#DBEAFE", ink: "#1E3A8A", sub: "Your ongoing conversations", badge: chatsUnread },
    // My Friends added Batch B iter156 (Garry, Aug 2026 — P1 #4): a
    // discoverable Home entry for the member's *accepted* friends
    // (distinct from "Find Friends" which is discovery). Sits directly
    // under My Chats so the two "people I know" surfaces read together.
    { key: "my-friends", title: "My Friends",       icon: "heart",           route: "/friends/list", bg: "#FCE7F3", ink: "#9D174D", sub: (user?.friends?.length ? `${user.friends.length} friend${user.friends.length === 1 ? "" : "s"}` : "Your accepted friends") },
    { key: "lounge",  title: "FP Café",           icon: "cafe",            route: "/lounge",   bg: "#DFF2ED", ink: "#0F766E", sub: "Pull up a chair & join a chat" },
    { key: "friends", title: "Find Friends",       icon: "people",          route: "/friends",  bg: "#E0EAFB", ink: "#1E3A8A", sub: "Connect with people like you" },
    { key: "events",  title: "Local Events",       icon: "calendar",        route: "/events",   bg: "#EDE4FA", ink: "#5B21B6", sub: "See what's happening near you" },
    { key: "notices", title: "Notice Board",       icon: "newspaper",       route: "/notices",  bg: "#DBEEF3", ink: "#0E7490", sub: "Community updates and helpful info" },
    { key: "games",   title: "Games",              icon: "game-controller", route: "/games",    bg: "#DBE7FB", ink: "#1D4ED8", sub: "Fun games to enjoy on your own or with friends" },
    { key: "groups",  title: "Community Groups",   icon: "earth",           route: "/groups",   bg: "#D8F1E8", ink: "#065F46", sub: "Join groups that match your interests" },

    // Profile row card (last item — full width, slimmer).
    { key: "profile", title: "My Profile",         icon: "person-circle",   route: "/profile",  bg: "#EEF1F6", ink: "#334155", sub: "Your profile, settings and preferences", full: true },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/*
       * George's butterfly is now mounted globally in the root layout
       * (`app/_layout.tsx` → `<GeorgeGlobalHost />`) so he follows the
       * member across every screen — FP Café, Friends, Events,
       * Groups, Notice Board, Games, and so on. C1 Slice 3, locked
       * with Garry 22 July 2026. Do not re-mount him here.
       */}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadFlutters(); setRefreshing(false); }}
            tintColor={c.brand}
            colors={[c.brand]}
          />
        }
      >
        <View style={styles.headerRow}>
          {/* Left spacer keeps the brand optically balanced without
              stealing horizontal room from the notification/settings
              icons on the right. On narrow iPhones the previous 112pt
              spacer + 160pt lockup + 112pt actions overflowed the
              content area, hiding the bell entirely. 44pt is enough
              for visual balance while leaving plenty of room. */}
          <View style={styles.headerSideSpacer} pointerEvents="none" />
          {/* Brand lockup — uses the navy-ink variant so the wordmark + the
              butterfly/people in the "O" read clearly on the white Home
              surface. Header variant is compact: no tagline, since the
              wordmark alone is enough branding at that size, and the
              tagline was pushing the row too tall. */}
          <BrandLockup width={140} variant="navy" showTagline={false} testID="home-brand-lockup" />
          <View style={styles.headerActions}>
            <Pressable ref={bellRef} testID="home-notifications" onPress={() => router.push("/notifications")} style={[styles.iconBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
              {unread > 0 && (
                <View style={[styles.bellBadge, { backgroundColor: c.error }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11 }}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
            <Pressable testID="home-settings" onPress={() => router.push("/settings")} style={[styles.iconBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Ionicons name="settings-outline" size={26} color={c.onSurface} />
            </Pressable>
          </View>
        </View>
        {/* "Welcome back" line removed 1 Aug 2026 (Garry) — George's
            Daily Welcome now handles the greeting, and a stacked
            "Welcome back" + "Good afternoon, Margaret." reads as two
            voices competing. Keeping the name + butterfly as the sole
            personal anchor is warmer. */}
        {/* Round-8 polish (Garry, Jun 2026 #3): the butterfly badge was
            visually running into the name because it sat inside the
            same <Text> as `first_name` with only a single space. Split
            into a flex row with an explicit 10 pt gap so the emoji
            reads as a distinct badge, not part of the name string. */}
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: c.onSurface, fontSize: 28 * scale }]}>{user?.first_name || "Friend"}</Text>
          <GeorgeButterflyMark size={26 * scale} />
        </View>

        {/* George's voice on Home is the perched speech bubble beside
            the resting butterfly (see GeorgeButterfly.tsx). Private-
            message notifications slide UP from the bottom of the
            screen a few seconds AFTER George's greeting so his hello
            is never overlaid by an app alert (see GlobalDmPrompt.tsx
            → POST_GREET_DELAY_MS). */}

        {/* --- HERO: Share a Moment -------------------------------------
            Locked with Garry 31 July 2026 as the primary feature of
            the Home screen, and (Garry, 1 Aug 2026) moved to sit
            immediately below George's Daily Welcome so the very first
            action on Home every day is "what's your moment today?".
            "What's your moment today?" is a signature FriendPlace
            phrase — every member has moments worth sharing (a coffee,
            a walk, a flowering orchid, the grandkids), and this hero
            makes the ask feel warm and everyday, not performative.
            The whole card taps through to the feed; the inline CTA
            jumps straight into the composer. */}
        <View style={styles.momentHero}>
          <View style={styles.momentHeroInner}>
            <View style={styles.momentHeroHead}>
              <Text style={styles.momentHeroBadge}>✨ SHARE A MOMENT</Text>
              <Ionicons name="camera" size={22} color="#78350F" />
            </View>
            <Pressable
              testID="home-moment-hero-feed"
              onPress={() => goTo("/moments")}
              accessibilityLabel="Open Share a Moment"
              style={{ marginTop: 8 }}
            >
              <Text style={[styles.momentHeroTitle, { fontSize: 26 * scale }]}>
                What&apos;s your moment today?
              </Text>
              <Text style={[styles.momentHeroSub, { fontSize: 14 * scale }]}>
                Share a photo, a story, or something that made you smile today.
              </Text>
            </Pressable>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14, alignItems: "center" }}>
              <Pressable
                testID="home-moment-hero-share"
                onPress={() => goTo("/moments/new")}
                accessibilityLabel="Share a Moment"
                style={({ pressed }) => [
                  styles.momentHeroCta,
                  { opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale, marginLeft: 6 }}>
                  Share a Moment
                </Text>
              </Pressable>
              <Pressable
                testID="home-moment-hero-see-all"
                onPress={() => goTo("/moments")}
                accessibilityLabel="See all moments"
                style={styles.momentHeroSecondary}
              >
                <Text style={{ color: "#78350F", fontWeight: "800", fontSize: 14 * scale }}>See moments</Text>
                <Ionicons name="chevron-forward" size={16} color="#78350F" />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Moment of the Week — sits right under the hero as social proof
            and inspiration: "look what one of your neighbours shared this
            week". Hidden when no moment is currently featured. */}
        {featuredMoment ? (
          <Pressable
            testID="home-moment-of-the-week"
            onPress={() => router.push(`/moments/${featuredMoment.id}` as any)}
            accessibilityLabel={`Moment of the Week by ${featuredMoment.author_name}`}
            style={({ pressed }) => [
              styles.momentBanner,
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <View style={styles.momentBannerHead}>
              <Text style={styles.momentBannerBadge}>✨ MOMENT OF THE WEEK</Text>
              <Ionicons name="chevron-forward" size={18} color="#92400E" />
            </View>
            {/* MotW subtitle — never "most liked" or "trending" (locked
                with Garry 31 July 2026). This is a hand-picked
                celebration, not an algorithmic feed. */}
            <Text style={{ color: "#78350F", fontSize: 12 * scale, fontWeight: "700", marginTop: 4, opacity: 0.85, fontStyle: "italic" }}>
              🌟 Chosen by the FriendPlace team because it made us smile.
            </Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 10 }}>
              {featuredMoment.photos && featuredMoment.photos[0] ? (
                <View style={{ width: 72, height: 72, borderRadius: 14, overflow: "hidden", backgroundColor: "#FEF3C7" }}>
                  <Image source={{ uri: featuredMoment.photos[0] }} style={{ width: 72, height: 72 }} />
                </View>
              ) : (
                <View style={{ alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: 14, backgroundColor: "#FEF3C7" }}>
                  <GeorgeButterflyMark size={28} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                {/* Author line: their avatar emoji then their display
                    name — warm, no "Author" label (Garry 31 Jul 2026).
                    "🌺 Margaret" rather than "Author\nMargaret". */}
                <Text numberOfLines={1} style={{ color: "#7C5300", fontWeight: "900", fontSize: 14 * scale }}>
                  {featuredMoment.author_avatar || "🦋"}  {featuredMoment.author_name || "A member"}
                </Text>
                <Text numberOfLines={3} style={{ color: "#3C2A06", fontWeight: "600", fontSize: 14 * scale, marginTop: 3, lineHeight: 19 }}>
                  {featuredMoment.caption || "Shared a moment"}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="heart" size={14} color="#B45309" />
                    <Text style={{ color: "#7C5300", fontWeight: "800", fontSize: 12 * scale }}>{featuredMoment.likes_count || 0}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="chatbubble-ellipses" size={14} color="#B45309" />
                    <Text style={{ color: "#7C5300", fontWeight: "800", fontSize: 12 * scale }}>{featuredMoment.comments_count || 0}</Text>
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        ) : null}

        {/* Presence & Status — My Status card. Now sits under Share a
            Moment (Garry, 1 Aug 2026 reorder). Design ref: §5.1 in
            /app/memory/design-presence-and-status.md. */}
        <MyStatusCard />

        {/* Today's Thought — surfaced at the top of Home (above First-Run
            and Flutters) so the very first thing returning members read is
            something warm and grounding. Stays sticky across opens via
            the daily-rotation key but can be reshuffled manually. */}
        <View style={[styles.thoughtCard, { backgroundColor: c.surfaceSecondary, borderColor: c.brand }]} testID="todays-thought">
          <View style={styles.thoughtHead}>
            <View style={[styles.thoughtChip, { backgroundColor: c.brandTertiary }]}>
              <Ionicons name="sunny" size={14} color={c.brand} />
              <Text style={[styles.thoughtChipText, { color: c.brand, fontSize: 12 * scale }]}>TODAY&apos;S THOUGHT</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {prefs.readMessagesAloud && (
                <SpeakButton text={thought} color={c.brand} size={22} testID="thought-speak" />
              )}
              <Pressable testID="thought-fav" onPress={toggleFav} hitSlop={6} style={styles.thoughtIconBtn} accessibilityLabel={isFav ? "Remove from favourites" : "Save to favourites"}>
                <Ionicons name={isFav ? "heart" : "heart-outline"} size={22} color={isFav ? c.error : c.brand} />
              </Pressable>
              <Pressable testID="thought-shuffle" onPress={shuffleThought} hitSlop={6} style={styles.thoughtIconBtn} accessibilityLabel="Shuffle thought">
                <Ionicons name="shuffle" size={22} color={c.brand} />
              </Pressable>
            </View>
          </View>
          <Text style={[styles.thoughtText, { color: c.onSurface, fontSize: 18 * scale }]}>{thought}</Text>
        </View>

        {/* First-run guidance — visible only for the first ~3 opens after
            onboarding. Hidden once the user dismisses or taps into a step.
            Sits above-the-fold so it's the first thing brand-new members
            see when they land on Home. */}
        {user?.id ? (
          <FirstRunCard userId={user.id} firstName={user.first_name} />
        ) : null}

        {/* B7 — George Remembers: pre-event well-wishes + post-event
            follow-ups the organiser hasn't yet dismissed. Silent
            (returns null) when the inbox is empty. */}
        {user?.id ? <GeorgeRemembersBanner /> : null}

        {/* Friend requests — Batch B iter157 (Garry, Aug 2026 — P0 #5).
            Mirrors the flutter card so incoming friend requests are
            visible on Home even if the member never opens the
            notification bell. Shows up to 3; the CTA opens the full
            list. */}
        {pendingFriendReqs.length > 0 && (
          <View style={[styles.flutterBox, { borderColor: "#0EA5E9" }]} testID="home-friend-requests-card">
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Ionicons name="person-add" size={22} color="#0369A1" />
              <Text style={{ color: "#0369A1", fontWeight: "900", fontSize: 17 * scale, marginLeft: 6 }}>
                {pendingFriendReqs.length === 1 ? "New friend request" : `${pendingFriendReqs.length} new friend requests`}
              </Text>
            </View>
            {pendingFriendReqs.slice(0, 3).map((r) => (
              <View key={r.id} style={[styles.flutterItem, { backgroundColor: "#FFFFFF", borderColor: "#E0F2FE" }]}>
                <Pressable
                  testID={`friend-req-open-${r.id}`}
                  onPress={() => router.push(`/user/${r?.other?.id}` as any)}
                  accessibilityLabel={`View ${r?.other?.first_name}'s profile`}
                  style={styles.flutterSenderRow}
                  hitSlop={4}
                >
                  <AvatarBubble value={r?.other?.avatar} size={36} fallback="🙂" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: "#0F172A", fontWeight: "900", fontSize: 15 * scale }} numberOfLines={1}>
                      {r?.other?.first_name || "A member"}
                    </Text>
                    <Text style={{ color: "#475569", fontSize: 12 * scale, fontWeight: "600" }} numberOfLines={1}>
                      {r?.other?.suburb ? `📍 ${r.other.suburb} · Tap to see profile` : "Tap to see their profile"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                </Pressable>
                <View style={styles.flutterActions}>
                  <Pressable
                    testID={`friend-req-accept-${r.id}`}
                    onPress={() => acceptFriendReq(r)}
                    style={[styles.flutterActionBtn, { backgroundColor: "#0EA5E9", borderColor: "#0EA5E9" }]}
                  >
                    <Ionicons name="checkmark" size={14} color="#FFF" />
                    <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 * scale }}>Accept</Text>
                  </Pressable>
                  <Pressable
                    testID={`friend-req-later-${r.id}`}
                    onPress={() => show("We'll keep it here for you.")}
                    style={[styles.flutterActionBtn, { backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" }]}
                    accessibilityLabel="Decide later — request stays visible"
                  >
                    <Ionicons name="time-outline" size={14} color="#64748B" />
                    <Text style={{ color: "#334155", fontWeight: "800", fontSize: 13 * scale }}>Later</Text>
                  </Pressable>
                  <Pressable
                    testID={`friend-req-decline-${r.id}`}
                    onPress={() => declineFriendReq(r)}
                    style={styles.dismissBtn}
                    accessibilityLabel="Decline friend request"
                  >
                    <Ionicons name="close" size={18} color="#94A3B8" />
                  </Pressable>
                </View>
              </View>
            ))}
            {pendingFriendReqs.length > 3 && (
              <Pressable
                testID="home-friend-requests-see-all"
                onPress={() => router.push("/friends/list" as any)}
                style={{ alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ color: "#0369A1", fontWeight: "800", fontSize: 13 * scale }}>
                  See all {pendingFriendReqs.length} requests →
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {flutters.length > 0 && (
          <Animated.View
            ref={flutterCardRef}
            collapsable={false}
            style={[
              styles.flutterBox,
              {
                borderColor: "#8B5CF6",
                // Hidden (opacity 0, tiny upward offset) until the
                // butterfly lands on its first appearance this
                // session — then it fades in with a subtle drop.
                opacity: flutterCardOpacity,
                transform: [{ translateY: flutterCardTranslate }],
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <GeorgeButterflyMark size={24} />
              <Text style={{ color: "#6D28D9", fontWeight: "900", fontSize: 17 * scale, marginLeft: 6 }}>You&apos;ve got Flutters!</Text>
            </View>
            {flutters.slice(0, 3).map((f) => {
              const responded = f?.responded_action;
              const hasFlutteredBack = responded === "fluttered_back";
              const hasStartedChat = responded === "chat_started";
              return (
                <View key={f.id} style={[styles.flutterItem, { backgroundColor: "#FFFFFF", borderColor: "#EDE9FE" }]}>
                  {/* Sender identity row — the whole strip is a Pressable
                      that opens the sender's profile so recipients can
                      learn a little about them before Chat / Flutter Back. */}
                  <Pressable
                    testID={`flutter-open-profile-${f.id}`}
                    onPress={() => router.push(`/user/${f.from_id}` as any)}
                    accessibilityLabel={`View ${f.from_name}'s profile`}
                    style={styles.flutterSenderRow}
                    hitSlop={4}
                  >
                    <AvatarBubble value={f.from_avatar} size={36} fallback="🙂" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: "#1E293B", fontWeight: "900", fontSize: 15 * scale }} numberOfLines={1}>
                        {f.from_name}
                      </Text>
                      <Text style={{ color: "#64748B", fontSize: 12 * scale, fontWeight: "600" }}>
                        Tap to see their profile
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                  </Pressable>
                  <Text style={{ color: "#1E293B", fontSize: 15 * scale, marginTop: 8, lineHeight: 20 }} numberOfLines={4}>
                    {f.message}
                  </Text>
                  {responded ? (
                    <View style={styles.flutterRespondedRow} testID={`flutter-responded-${f.id}`}>
                      <Ionicons name="checkmark-circle" size={18} color="#059669" />
                      <Text style={{ color: "#065F46", fontWeight: "800", fontSize: 13 * scale }}>
                        {hasFlutteredBack ? `Fluttered back to ${f.from_name}` : hasStartedChat ? `Chat opened with ${f.from_name}` : "Responded"}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.flutterActions}>
                    {hasFlutteredBack ? (
                      <View style={[styles.flutterActionBtn, { backgroundColor: "#D1FAE5", borderColor: "#059669" }]}>
                        <Ionicons name="checkmark" size={14} color="#065F46" />
                        <Text style={{ color: "#065F46", fontWeight: "800", fontSize: 13 * scale }}>Fluttered back</Text>
                      </View>
                    ) : (
                      <Pressable
                        testID={`flutter-back-${f.id}`}
                        onPress={(e) => flutterBack(f, { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY })}
                        style={[styles.flutterActionBtn, { backgroundColor: "#EDE9FE", borderColor: "#8B5CF6" }]}
                      >
                        <GeorgeButterflyMark size={14} />
                        <Text style={{ color: "#6D28D9", fontWeight: "800", fontSize: 13 * scale }}>Flutter back</Text>
                      </Pressable>
                    )}
                    {hasStartedChat ? (
                      <Pressable
                        testID={`flutter-chat-again-${f.id}`}
                        onPress={() => chatFromFlutter(f)}
                        style={[styles.flutterActionBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" }]}
                      >
                        <Ionicons name="chatbubble" size={12} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 * scale }}>Re-open chat</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        testID={`flutter-chat-${f.id}`}
                        onPress={() => chatFromFlutter(f)}
                        style={[styles.flutterActionBtn, { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" }]}
                      >
                        <Ionicons name="chatbubble" size={12} color="#FFF" />
                        <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 * scale }}>Start chat</Text>
                      </Pressable>
                    )}
                    <Pressable
                      testID={`flutter-later-${f.id}`}
                      onPress={() => show("We'll keep it here for you.")}
                      style={[styles.flutterActionBtn, { backgroundColor: "#F1F5F9", borderColor: "#CBD5E1" }]}
                      accessibilityLabel="Decide later — the flutter card stays visible"
                    >
                      <Ionicons name="time-outline" size={14} color="#64748B" />
                      <Text style={{ color: "#334155", fontWeight: "800", fontSize: 13 * scale }}>Later</Text>
                    </Pressable>
                    <Pressable
                      testID={`flutter-dismiss-${f.id}`}
                      onPress={() => dismissFlutter(f)}
                      style={styles.dismissBtn}
                      accessibilityLabel="Close this flutter card"
                    >
                      <Ionicons name="close" size={18} color="#94A3B8" />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </Animated.View>
        )}

        <Pressable testID="home-points-card" onPress={() => setPointsInfoOpen(true)} style={[styles.pointsCard, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
            <Text numberOfLines={1} style={[styles.pointsLabel, { color: c.brand, fontSize: 12 * scale }]}>BUTTERFLY POINTS</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit allowFontScaling minimumFontScale={0.6} style={[styles.pointsNum, { color: c.onSurface, fontSize: 34 * scale }]}>{user?.points ?? 0}</Text>
          </View>
          {(user?.badges || []).length > 0 && (
            <View style={styles.badgesCol}>
              {(user?.badges || []).slice(0, 2).map((b) => (
                <View key={b} style={[styles.badgePill, { borderColor: c.brand, backgroundColor: c.surface }]}>
                  <Ionicons name="ribbon" size={12} color={c.brand} />
                  <Text numberOfLines={1} style={[styles.badgeText, { color: c.brand, fontSize: 11 * scale }]}>{b}</Text>
                </View>
              ))}
            </View>
          )}
        </Pressable>

        {/* Founders Wall entry — surfaced on every Home for both founders
            (a celebratory "view your crest") and non-founders (social-proof
            scarcity, encourages claiming a spot). Hidden if the cohort
            programme is disabled (cap=0). */}
        {founderStatus && founderStatus.cap > 0 ? (
          <Pressable
            testID="home-founders-wall"
            onPress={() => router.push("/founders")}
            accessibilityLabel="View the Founders Wall"
            style={({ pressed }) => [
              styles.founderCard,
              {
                backgroundColor: "#FEF3C7",
                borderColor: "#D4A017",
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <GeorgeButterflyMark size={30} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {(user as any)?.is_founder ? (
                <>
                  <Text numberOfLines={1} style={{ color: "#7C5300", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>
                    YOU&apos;RE FOUNDING MEMBER #{(user as any).founder_number}
                  </Text>
                  <Text numberOfLines={2} style={{ color: "#3C2A06", fontWeight: "800", fontSize: 15 * scale, marginTop: 2 }}>
                    See yourself on the Founders Wall →
                  </Text>
                </>
              ) : (
                <>
                  <Text numberOfLines={1} style={{ color: "#7C5300", fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>
                    FOUNDERS WALL
                  </Text>
                  <Text numberOfLines={2} style={{ color: "#3C2A06", fontWeight: "800", fontSize: 15 * scale, marginTop: 2 }}>
                    {founderStatus.taken > 0
                      ? `Meet the ${founderStatus.taken.toLocaleString()} Founding Members shaping FriendPlace`
                      : `Be among the first ${founderStatus.cap.toLocaleString()} Founding Members`}
                  </Text>
                </>
              )}
            </View>
            <Ionicons name="chevron-forward" size={22} color="#7C5300" />
          </Pressable>
        ) : null}

        {/* Prominent invite card — sits above-the-fold so growth is one tap away. */}
        <View style={{ marginTop: 4 }}>
          <ShareFriendPlace variant="highlight" testID="home-invite-highlight" invitedCount={invitedCount} />
        </View>

        {community && (community.birthdays?.length || community.new_members?.length || community.anniversaries?.length || community.milestones?.last_reached) ? (
          <View style={[styles.communityCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]} testID="community-card">
            <Text style={[styles.communityHead, { color: c.brand, fontSize: 12 * scale }]}>COMMUNITY TODAY</Text>
            {community.birthdays?.slice(0, 3).map((u: any) => (
              <Pressable key={`b-${u.id}`} testID={`bday-${u.id}`} onPress={() => router.push(`/user/${u.id}` as any)} style={styles.commRow}>
                <Text style={styles.commEmoji}>🎂</Text>
                <Text numberOfLines={1} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  It&apos;s {u.first_name}&apos;s birthday today! Send a wave.
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            ))}
            {community.anniversaries?.slice(0, 2).map((u: any) => (
              <Pressable key={`a-${u.id}`} onPress={() => router.push(`/user/${u.id}` as any)} style={styles.commRow}>
                <Text style={styles.commEmoji}>🎉</Text>
                <Text numberOfLines={1} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  {u.first_name} is celebrating {u.years} year{u.years > 1 ? "s" : ""} with FriendPlace!
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            ))}
            {community.new_members?.length > 0 && (
              <Pressable
                testID="new-members-row"
                onPress={() => {
                  // Single new member → straight to that person's profile.
                  // Multiple → focused "new this week" list (not the full
                  // Find Friends directory, which used to bury the new
                  // arrivals among everyone else).
                  const newOnes = community.new_members as any[];
                  if (newOnes.length === 1) {
                    router.push(`/user/${newOnes[0].id}` as any);
                  } else {
                    router.push("/friends/new-this-week" as any);
                  }
                }}
                style={styles.commRow}
              >
                <Text style={styles.commEmoji}>👋</Text>
                <Text numberOfLines={2} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 15 * scale }}>
                  {community.new_members.length === 1
                    ? `Say hello to ${community.new_members[0].first_name || community.new_members[0].username || "a new neighbour"} — they just joined`
                    : `Say hello to ${community.new_members.length} new neighbours this week`}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={c.muted} />
              </Pressable>
            )}
            {community.milestones?.last_reached && (
              <View style={styles.commRow}>
                <Text style={styles.commEmoji}>🏆</Text>
                <Text numberOfLines={2} style={{ flex: 1, color: c.onSurface, fontWeight: "700", fontSize: 14 * scale }}>
                  {community.milestones.last_reached.label}
                  {community.milestones.next ? ` · ${community.milestones.next.users - community.milestones.total_users} to next milestone` : ""}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <View style={styles.grid}>
          {tiles.map((t) => {
            const isProfileRow = t.full && t.key === "profile";
            const width = t.full ? "100%" : "48%";
            const minHeight = isProfileRow ? 76 : 160;
            const iconSize = isProfileRow ? 30 : 32;
            return (
              <Pressable
                key={t.key}
                testID={`tile-${t.key}`}
                onPress={() => goTo(t.route)}
                accessibilityLabel={t.title}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: t.bg,
                    width,
                    minHeight,
                    opacity: pressed ? 0.88 : 1,
                    flexDirection: isProfileRow ? "row" : "column",
                    alignItems: isProfileRow ? "center" : "flex-start",
                    justifyContent: isProfileRow ? "flex-start" : "space-between",
                    gap: isProfileRow ? 12 : 8,
                    padding: isProfileRow ? 16 : 18,
                  },
                ]}
              >
                <View>
                  <Ionicons name={t.icon} size={iconSize} color={t.ink} />
                  {t.badge && t.badge > 0 ? (
                    // Unread badge for Chats (Garry, 4 Aug 2026). Matches
                    // the tab-bar badge style so both feel like the same
                    // signal in different places.
                    <View
                      testID={`tile-${t.key}-badge`}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -10,
                        minWidth: 20,
                        height: 20,
                        borderRadius: 10,
                        paddingHorizontal: 6,
                        backgroundColor: c.error,
                        borderWidth: 2,
                        borderColor: t.bg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 11 }}>
                        {t.badge > 9 ? "9+" : String(t.badge)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: isProfileRow ? 1 : undefined, minWidth: 0 }}>
                  <Text
                    style={[
                      styles.tileTitle,
                      { color: t.ink, fontSize: (isProfileRow ? 17 : 20) * scale },
                    ]}
                  >
                    {t.title}
                  </Text>
                  {t.sub ? (
                    <Text
                      style={[
                        styles.tileSub,
                        { color: t.ink, opacity: 0.78, fontSize: 13 * scale, marginTop: 4 },
                      ]}
                    >
                      {t.sub}
                    </Text>
                  ) : null}
                </View>
                {isProfileRow ? (
                  <Ionicons name="chevron-forward" size={20} color={t.ink} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Butterfly Points details modal — opened from the points card.
          Shows the current total plus a plain-English "how to earn more"
          list. Keeping this local (instead of hard-navigating to Profile)
          makes the card feel like a peek panel rather than a page change,
          which was disorienting for older members ("the Home page just
          closed on me"). */}
      <Modal
        visible={pointsInfoOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setPointsInfoOpen(false)}
      >
        <Pressable
          style={styles.pointsBackdrop}
          onPress={() => setPointsInfoOpen(false)}
        >
          <Pressable
            testID="points-info-card"
            style={[styles.pointsInfoCard, { backgroundColor: c.surface, borderColor: c.brand }]}
            onPress={(e: any) => e.stopPropagation && e.stopPropagation()}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.brand, fontWeight: "900", fontSize: 12 * scale, letterSpacing: 0.6 }}>BUTTERFLY POINTS</Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={{ color: c.onSurface, fontWeight: "900", fontSize: 44 * scale, marginTop: 4 }}
                >
                  {user?.points ?? 0}
                </Text>
              </View>
              <GeorgeButterflyMark size={52} />
            </View>

            <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale, marginTop: 18 }}>
              How to earn more:
            </Text>
            <View style={{ marginTop: 10, gap: 10 }}>
              {[
                { emoji: "🦋", label: "Send a flutter", pts: "+2" },
                { emoji: "📸", label: "Share a Moment", pts: "+8" },
                { emoji: "☕", label: "Join or post in the FP Café", pts: "+3" },
                { emoji: "🤝", label: "Post in a Community Group", pts: "+4" },
                { emoji: "📅", label: "RSVP to a local event", pts: "+5" },
                { emoji: "🎮", label: "Complete a daily game", pts: "+10–15" },
                { emoji: "👋", label: "Invite a friend who joins", pts: "+25" },
              ].map((row) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 12,
                    backgroundColor: c.surfaceSecondary,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{row.emoji}</Text>
                  <Text style={{ flex: 1, marginLeft: 10, color: c.onSurface, fontSize: 15 * scale, fontWeight: "600" }}>
                    {row.label}
                  </Text>
                  <Text style={{ color: c.brand, fontWeight: "900", fontSize: 15 * scale }}>{row.pts}</Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable
                testID="points-info-close"
                onPress={() => setPointsInfoOpen(false)}
                style={({ pressed }) => [{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Close</Text>
              </Pressable>
              <Pressable
                testID="points-info-view-profile"
                onPress={() => { setPointsInfoOpen(false); goTo("/profile"); }}
                style={({ pressed }) => [{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: c.brand,
                  opacity: pressed ? 0.85 : 1,
                }]}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 15 * scale }}>View full profile</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // 44pt spacer balances the row visually while leaving enough real
  // estate for the bell+settings pair on narrow iPhones. Previously
  // 112pt (matching the actions width) pushed the actions off-screen
  // when combined with a 160pt lockup on iPhone SE/12 mini widths.
  headerSideSpacer: { width: 44, height: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { fontWeight: "900", letterSpacing: 0.3 },
  hello: { fontWeight: "600", marginTop: 6 },
  name: { fontWeight: "900" },
  // Row wrapper for "Alex 🦋" — gives the butterfly badge a small but
  // deliberate gap so it reads as a badge, not part of the name text.
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  iconBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  flutterBox: { borderWidth: 2, borderRadius: 18, padding: 14, backgroundColor: "#F5F3FF", gap: 8 },
  flutterItem: { padding: 12, borderRadius: 14, borderWidth: 1, gap: 4 },
  flutterSenderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  flutterActions: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  flutterActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5 },
  flutterRespondedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    alignSelf: "flex-start",
  },
  replyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  dismissBtn: { padding: 6 },
  pointsCard: { flexDirection: "row", alignItems: "center", borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18, marginTop: 20, marginBottom: 8, borderWidth: 1.5 },
  pointsLabel: { fontWeight: "900", letterSpacing: 0.6 },
  pointsNum: { fontWeight: "900", marginTop: 2 },
  badgesCol: { alignItems: "flex-end", gap: 6, maxWidth: "55%" },
  badgePill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, maxWidth: 170 },
  badgeText: { fontWeight: "800" },
  communityCard: { borderRadius: 18, padding: 14, borderWidth: 1, marginTop: 12, gap: 8 },
  communityHead: { fontWeight: "900", letterSpacing: 0.6, marginBottom: 2 },
  commRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  commEmoji: { fontSize: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  tile: { borderRadius: 22 },
  tileTitle: { fontWeight: "900", letterSpacing: 0.2 },
  tileSub: { fontWeight: "600", lineHeight: 18 },
  // --- Share a Moment hero (Home primary feature) ------------------------
  // Warm amber card with a slightly deeper amber panel inside. Kept
  // graphic-free on purpose so the copy carries the emotion. Locked
  // with Garry 31 July 2026. Extra top margin (Garry, 1 Aug 2026) so
  // the hero feels like a distinct next section rather than an
  // extension of George's greeting card above it.
  momentHero: {
    borderRadius: 26,
    backgroundColor: "#FEF3C7",
    borderWidth: 1.5,
    borderColor: "#F59E0B",
    padding: 4,
    marginTop: 18,
  },
  momentHeroInner: {
    borderRadius: 22,
    backgroundColor: "#FEF9E4",
    padding: 20,
  },
  momentHeroHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  momentHeroBadge: {
    color: "#78350F",
    fontWeight: "900",
    letterSpacing: 0.8,
    fontSize: 12,
  },
  momentHeroTitle: {
    color: "#78350F",
    fontWeight: "900",
    letterSpacing: 0.2,
    lineHeight: 32,
  },
  momentHeroSub: {
    color: "#92400E",
    fontWeight: "600",
    lineHeight: 20,
    marginTop: 6,
  },
  momentHeroCta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#B45309",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  momentHeroSecondary: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // Moment of the Week banner — celebratory amber card mirroring the
  // Founders Wall card treatment, so both "look up on Home" pieces feel
  // like one family.
  momentBanner: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#F59E0B",
    backgroundColor: "#FEF9E4",
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 4,
  },
  momentBannerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  momentBannerBadge: { color: "#92400E", fontWeight: "900", letterSpacing: 0.8, fontSize: 12 },
  momentThumbWrap: {},
  thoughtCard: { borderRadius: 20, padding: 16, borderWidth: 1.5, gap: 10, marginTop: 6 },
  thoughtHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  thoughtChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  thoughtChipText: { fontWeight: "800", letterSpacing: 0.6 },
  thoughtIconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  thoughtText: { fontWeight: "700", lineHeight: 26 },
  bellBadge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  founderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  // Points details modal — semi-transparent backdrop + centered card.
  pointsBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  pointsInfoCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
});
