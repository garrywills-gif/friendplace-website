import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import { useFocusEffect, useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import ReportSheet from "@/src/components/ReportSheet";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";
import Button from "@/src/components/Button";
import SpeakButton from "@/src/components/SpeakButton";
import AvatarBubble from "@/src/components/AvatarBubble";
import FounderMark from "@/src/components/FounderMark";
import { useComposerLock } from "@/src/lib/composer-lock";
import GalleryPicker, { resolveImageSource } from "@/src/components/GalleryPicker";

// Notice Board categories — Garry, 2 Aug 2026. Each category carries
// its own emoji so the picker feels warm and skimmable, and so the
// listing shows the emoji next to the title as a quick visual cue.
// One category per notice (the previous implementation was already
// single-select). Order is deliberate: high-frequency posts first.
const CATEGORY_LIST = [
  { key: "Announcement", emoji: "📢" },
  { key: "Question",     emoji: "❓" },
  { key: "Event",        emoji: "🎉" },
  { key: "Kindness",     emoji: "❤️" },
  { key: "Buy & Sell",   emoji: "🛒" },
  { key: "Community",    emoji: "🏡" },
  { key: "Help Needed",  emoji: "🙋" },
  { key: "Giveaway",     emoji: "🎁" },
] as const;
// Emoji lookup used by category chips + notice-row badges.
const CATEGORY_EMOJI: Record<string, string> = CATEGORY_LIST.reduce(
  (acc, c) => ({ ...acc, [c.key]: c.emoji }),
  {} as Record<string, string>,
);
const CATS = ["All", ...CATEGORY_LIST.map((c) => c.key)];
const POST_CATS = CATEGORY_LIST.map((c) => c.key);

const REACTIONS = [
  { kind: "well_done", emoji: "👏", label: "Well Done" },
  { kind: "support",   emoji: "❤️", label: "Support" },
  { kind: "chat",      emoji: "☕", label: "Let's Chat" },
  { kind: "flutter",   emoji: "🦋", label: "Flutter" },
  { kind: "congrats",  emoji: "🎉", label: "Congratulations" },
];

export default function Notices() {
  const { c, scale, prefs } = useTheme();
  const { user } = useAuth();
  const { show, confirm } = useToast();
  const router = useRouter();
  const navigation = useNavigation();

  // ── Batch B iter159 (Garry, Aug 2026 — real-iPhone Bug 1) ─────
  // RCA of the "Back → Login" bug: two paths could exit this screen
  //   (a) our Header's back button (Pressable in <Header>) — used our
  //       `onBack` prop.
  //   (b) iOS's swipe-back gesture on the underlying react-navigation
  //       Stack — bypassed our Header entirely and popped the router
  //       stack. When Notice Board was opened from Home, the stack
  //       underneath was `/` (Welcome), NOT `/home`. Popping landed
  //       on Welcome, whose `useEffect` auto-redirected back to /home
  //       — but for a split second Welcome rendered with its "Login"
  //       button visible, which is what Garry saw.
  //
  // Fix (belt-and-braces so BOTH paths can only land on /home):
  //   1. Header `onBack` now uses `router.replace("/home")` — matches
  //      every other screen. The `/(tabs)/home` form was an outlier
  //      and doesn't resolve consistently across expo-router
  //      versions on iOS.
  //   2. Intercept the react-navigation `beforeRemove` event so ANY
  //      pop attempt (swipe-back, hardware back, programmatic) is
  //      redirected to `/home` explicitly, cancelling the default
  //      pop that would drop to Welcome.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      // If we're navigating deliberately elsewhere (e.g. router.push
      // to open a notice detail modal), let it through. `data.action`
      // is set for programmatic navigations we control.
      const action = e?.data?.action;
      const type = action?.type;
      // Only intercept the "GO_BACK" / "POP" actions — everything
      // else is a legitimate forward/lateral navigation we should
      // permit.
      if (type && type !== "GO_BACK" && type !== "POP") return;
      // eslint-disable-next-line no-console
      console.log("[notices/back] beforeRemove intercepted", { type });
      e.preventDefault();
      // Small delay so react-navigation can settle its internal
      // beforeRemove state before we push the new route.
      setTimeout(() => {
        try { router.replace("/home" as any); }
        catch { /* noop */ }
      }, 0);
    });
    return unsub;
  }, [navigation, router]);
  const [notices, setNotices] = useState<any[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [pTitle, setPTitle] = useState("");
  const [pBody, setPBody] = useState("");
  const [pCat, setPCat] = useState("Announcement");
  // Optional image attached to the notice — gallery ref, data URI or "".
  const [pImage, setPImage] = useState<string>("");
  const [pImagePicker, setPImagePicker] = useState<boolean>(false);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ commentId: string; userName: string } | null>(null);
  const [actionMenuFor, setActionMenuFor] = useState<any | null>(null);
  const [reportFor, setReportFor] = useState<any | null>(null);

  // Composer-lock (approved 24 Jun 2026): hold the global composer
  // lock while the member is drafting a notice OR a comment so the
  // GlobalDmPrompt defers to the next poll cycle instead of
  // interrupting them.
  useComposerLock(
    posting ||
      pTitle.length > 0 ||
      pBody.length > 0 ||
      commentText.length > 0,
  );

  const load = async () => {
    if (!user) return;
    try {
      setNotices(await api.listNotices({ user_id: user.id, q: query || undefined, category }) as any[]);
    } catch {}
  };
  useFocusEffect(useCallback(() => { load(); }, [user?.id, category, query]));

  const startCreate = () => { setEditing(null); setPTitle(""); setPBody(""); setPCat("Announcement"); setPImage(""); setPosting(true); };
  const startEdit = (n: any) => { setEditing(n); setPTitle(n.title); setPBody(n.body); setPCat(n.category); setPImage(n.image || ""); setPosting(true); };

  const submitPost = async () => {
    if (!user || !pTitle.trim() || !pBody.trim()) { show("Add a title and message"); return; }
    try {
      if (editing) {
        await api.editNotice(editing.id, { user_id: user.id, title: pTitle.trim(), body: pBody.trim(), category: pCat, image: pImage });
        show("Notice updated");
      } else {
        // The backend may hold the notice for moderator review if the
        // shared business-content / prolific-poster heuristic fires
        // (iter153). In that case the response carries
        // `held_for_review: true` and a calm, generic
        // `moderation_message`. We surface exactly that message so
        // the poster sees a routine safety-check tone rather than
        // any accusation. Locked with Garry.
        const resp: any = await api.createNotice({
          user_id: user.id,
          user_name: user.first_name || user.username,
          avatar: user.avatar,
          title: pTitle.trim(),
          body: pBody.trim(),
          category: pCat,
          image: pImage,
        });
        if (resp && resp.held_for_review) {
          show(resp.moderation_message ||
            "We're just checking this notice fits our community guidelines. We'll let you know as soon as it's been reviewed.");
        } else {
          show("Posted to Notice Board");
        }
      }
      setPosting(false); setEditing(null);
      load();
    } catch { show("Could not save"); }
  };

  const onReact = async (n: any, kind: string) => {
    if (!user) return;
    try {
      const r: any = await api.reactNotice(n.id, user.id, kind);
      setNotices((list) => list.map((x) => (x.id === n.id ? { ...x, reactions: r.reactions } : x)));
    } catch {}
  };

  const sendComment = async (n: any) => {
    if (!user || !commentText.trim()) return;
    try {
      if (replyTo) {
        const r: any = await api.replyNoticeComment(n.id, replyTo.commentId, { user_id: user.id, user_name: user.first_name || user.username, avatar: user.avatar, text: commentText.trim() });
        setNotices((list) => list.map((x) => x.id === n.id ? { ...x, comments: (x.comments || []).map((cm: any) => cm.id === replyTo.commentId ? { ...cm, replies: [...(cm.replies || []), r] } : cm) } : x));
      } else {
        const c2: any = await api.commentNotice(n.id, { user_id: user.id, user_name: user.first_name || user.username, avatar: user.avatar, text: commentText.trim() });
        setNotices((list) => list.map((x) => x.id === n.id ? { ...x, comments: [...(x.comments || []), c2] } : x));
      }
      setCommentText(""); setReplyTo(null);
    } catch { show("Could not send"); }
  };

  const toggleSolved = async (n: any) => {
    if (!user) return;
    try {
      const r: any = await api.solveNotice(n.id, user.id, !n.solved);
      show(r.solved ? "Marked as solved ✓" : "Reopened question");
      load();
    } catch (e: any) { show("Only the author can do that"); }
  };

  const onReport = (n: any) => {
    if (!user) return;
    setReportFor(n);
  };

  const onBlock = async (n: any) => {
    if (!user) return;
    const ok = await confirm({ title: `Block ${n.user_name}?`, message: "You won't see posts from this user any more.", confirmLabel: "Block", destructive: true });
    if (!ok) return;
    try { await api.blockUser(user.id, n.user_id); show("User blocked"); load(); } catch {}
  };

  const onDelete = async (n: any) => {
    if (!user) return;
    const ok = await confirm({ title: "Delete this notice?", message: "This cannot be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    try { await api.deleteNotice(n.id, user.id); show("Notice deleted"); load(); } catch {}
  };

  const showActions = (n: any) => {
    if (!user) return;
    setActionMenuFor(n);
  };

  // Renders actions list as a bottom-sheet modal for cross-platform reliability.
  const actionMenu = actionMenuFor ? (() => {
    const n = actionMenuFor;
    const isMine = n.user_id === user?.id;
    const opts: { label: string; destructive?: boolean; onPress: () => void }[] = [];
    if (isMine) {
      opts.push({ label: "Edit notice", onPress: () => { setActionMenuFor(null); startEdit(n); } });
      opts.push({ label: "Delete notice", destructive: true, onPress: () => { setActionMenuFor(null); onDelete(n); } });
      if (n.category === "Question") opts.push({ label: n.solved ? "Reopen question" : "Mark as solved", onPress: () => { setActionMenuFor(null); toggleSolved(n); } });
    } else {
      opts.push({ label: "Report notice", destructive: true, onPress: () => { setActionMenuFor(null); setReportFor(n); } });
      opts.push({ label: `Block ${n.user_name}`, destructive: true, onPress: () => { setActionMenuFor(null); onBlock(n); } });
    }
    return opts;
  })() : null;

  // ------- rendering helpers -------
  const reactionCounts = (n: any) => {
    const counts: Record<string, number> = {};
    Object.values(n.reactions || {}).forEach((k) => { counts[k as string] = (counts[k as string] || 0) + 1; });
    return counts;
  };

  const renderItem = ({ item: n }: { item: any }) => {
    const mine = user?.id === n.user_id;
    const counts = reactionCounts(n);
    const myKind = (n.reactions || {})[user?.id || ""];
    const expanded = openCommentsFor === n.id;
    return (
      <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border, opacity: n.solved ? 0.85 : 1 }]}>
        <View style={styles.head}>
          <AvatarBubble value={n.avatar} size={28} fallback="🙂" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={[styles.author, { color: c.onSurface, fontSize: 16 * scale }]} numberOfLines={1}>{n.user_name}</Text>
              <FounderMark isFounder={n.user_is_founder} founderNumber={n.user_founder_number} size={14} testID={`notice-founder-${n.id}`} />
            </View>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <View style={[styles.catChip, { backgroundColor: c.brandTertiary }]}><Text style={{ color: c.brand, fontWeight: "800", fontSize: 11 * scale }}>{CATEGORY_EMOJI[n.category] ? `${CATEGORY_EMOJI[n.category]} ` : ""}{n.category}</Text></View>
              {n.solved && (
                <View style={[styles.solvedChip, { backgroundColor: c.success }]}>
                  <Ionicons name="checkmark" size={11} color="#FFF" />
                  <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 11 * scale }}>SOLVED</Text>
                </View>
              )}
              {n.edited_at && <Text style={{ color: c.muted, fontSize: 10 * scale }}>edited</Text>}
            </View>
          </View>
          {prefs.readMessagesAloud && <SpeakButton text={`${n.title}. ${n.body}`} color={c.brand} size={22} />}
          <Pressable onPress={() => showActions(n)} hitSlop={6} style={{ padding: 6 }}>
            <Ionicons name="ellipsis-horizontal" size={22} color={c.muted} />
          </Pressable>
        </View>

        <Text style={[styles.title, { color: c.onSurface, fontSize: 18 * scale }]}>{n.title}</Text>
        <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>{n.body}</Text>
        {n.image ? (() => {
          const src = resolveImageSource(n.image);
          return src ? (
            <Image source={src} style={styles.noticeCardImage} resizeMode="cover" />
          ) : null;
        })() : null}

        {/* Reactions row */}
        <View style={styles.reactionsRow}>
          {REACTIONS.map((r) => {
            const active = myKind === r.kind;
            const count = counts[r.kind] || 0;
            return (
              <Pressable key={r.kind} testID={`react-${r.kind}-${n.id}`} onPress={() => onReact(n, r.kind)} hitSlop={4} style={[styles.reactBtn, { backgroundColor: active ? c.brand : c.surfaceTertiary, borderColor: active ? c.brand : c.border }]}>
                <Text style={{ fontSize: 16 }}>{r.emoji}</Text>
                {count > 0 && <Text style={{ color: active ? "#FFF" : c.muted, fontWeight: "800", fontSize: 12 * scale }}>{count}</Text>}
              </Pressable>
            );
          })}
          <Pressable testID={`open-comments-${n.id}`} onPress={() => { setOpenCommentsFor(expanded ? null : n.id); setReplyTo(null); }} style={[styles.reactBtn, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
            <Ionicons name="chatbubble-outline" size={16} color={c.muted} />
            {(n.comments || []).length > 0 && <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale }}>{(n.comments || []).length}</Text>}
          </Pressable>
          {mine && n.category === "Question" && (
            <Pressable testID={`solve-${n.id}`} onPress={() => toggleSolved(n)} hitSlop={4} style={[styles.reactBtn, { backgroundColor: n.solved ? c.success : c.surfaceTertiary, borderColor: n.solved ? c.success : c.border }]}>
              <Ionicons name={n.solved ? "checkmark-circle" : "checkmark-circle-outline"} size={18} color={n.solved ? "#FFF" : c.success} />
            </Pressable>
          )}
        </View>

        {/* Comments / replies */}
        {expanded && (
          <View style={{ marginTop: 8, gap: 8 }}>
            {(n.comments || []).map((cm: any) => (
              <View key={cm.id} style={[styles.commentBox, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <AvatarBubble value={cm.avatar} size={16} fallback="🙂" />
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 14 * scale, flex: 1 }}>{cm.user_name}</Text>
                  {prefs.readMessagesAloud && <SpeakButton text={cm.text} color={c.brand} size={18} />}
                </View>
                <Text style={{ color: c.onSurface, fontSize: 15 * scale, marginTop: 2 }}>{cm.text}</Text>
                <Pressable onPress={() => setReplyTo({ commentId: cm.id, userName: cm.user_name })} hitSlop={6} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                  <Text style={{ color: c.brandSecondary, fontWeight: "700", fontSize: 12 * scale }}>Reply</Text>
                </Pressable>
                {(cm.replies || []).map((rp: any) => (
                  <View key={rp.id} style={[styles.replyBox, { borderLeftColor: c.brand }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <AvatarBubble value={rp.avatar} size={14} fallback="🙂" />
                      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale, flex: 1 }}>{rp.user_name}</Text>
                      {prefs.readMessagesAloud && <SpeakButton text={rp.text} color={c.brand} size={16} />}
                    </View>
                    <Text style={{ color: c.onSurface, fontSize: 14 * scale, marginTop: 2 }}>{rp.text}</Text>
                  </View>
                ))}
              </View>
            ))}
            {(n.comments || []).length === 0 && <Text style={{ color: c.muted, fontSize: 13 * scale, fontStyle: "italic" }}>No comments yet — be the first to say hi.</Text>}
            <View style={[styles.composer, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
              {replyTo && (
                <View style={[styles.replyPill, { backgroundColor: c.brandTertiary }]}>
                  <Text style={{ color: c.brand, fontWeight: "800", fontSize: 12 * scale }}>Replying to {replyTo.userName}</Text>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={6} style={{ padding: 2 }}>
                    <Ionicons name="close" size={14} color={c.brand} />
                  </Pressable>
                </View>
              )}
              <TextInput testID={`comment-${n.id}`} placeholder={replyTo ? "Write a reply…" : "Add a kind comment…"} value={openCommentsFor === n.id ? commentText : ""} onChangeText={setCommentText} placeholderTextColor={c.muted} style={{ flex: 1, color: c.onSurface, fontSize: 15 * scale, paddingVertical: 8 }} multiline />
              <Pressable testID={`send-comment-${n.id}`} onPress={() => sendComment(n)} style={[styles.sendBtn, { backgroundColor: c.brand }]}>
                <Ionicons name="send" size={18} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 16 * scale, borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Notice Board" backHref="/home" emoji="📋" subtitle="Local notices · Share what's on" onBack={() => { console.log("[notices/back] Header onBack tapped"); router.replace("/home" as any); }} right={(
        <Pressable testID="new-notice" onPress={startCreate} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.brand, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }}>
          <Ionicons name="add" size={20} color="#FFF" />
          {/* Renamed 2026-08-14 (Garry launch-polish): explicit "Add a
              post" reads as a clear action rather than a cryptic "+"
              icon alone. Matches app-wide voice ("share a moment",
              "create an event"). */}
          <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 14 * scale }}>Add a post</Text>
        </Pressable>
      )} />
      <View style={[styles.searchBar, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
        <Ionicons name="search" size={18} color={c.muted} />
        <TextInput testID="notice-search" placeholder="Search notices…" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} returnKeyType="search" style={{ flex: 1, color: c.onSurface, fontSize: 15 * scale, paddingHorizontal: 8, paddingVertical: 10 }} />
        {!!query && <Pressable hitSlop={6} onPress={() => setQuery("")}><Ionicons name="close-circle" size={20} color={c.muted} /></Pressable>}
      </View>
      <View style={{ height: 56 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catsRow}>
          {CATS.map((cat) => {
            const active = cat === category;
            const emoji = CATEGORY_EMOJI[cat] || "";
            return (
              <Pressable key={cat} testID={`cat-${cat}`} onPress={() => setCategory(cat)} style={[styles.catFilter, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
                <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{emoji ? `${emoji} ` : ""}{cat}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 80, gap: 10 }}
        renderItem={renderItem}
        ListEmptyComponent={() => (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <Ionicons name="newspaper-outline" size={42} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "600", marginTop: 8, fontSize: 16 * scale }}>No notices match. Try another filter or post the first one!</Text>
          </View>
        )}
      />

      {/* Structured report sheet */}
      {reportFor && (
        <ReportSheet
          visible={!!reportFor}
          onClose={() => setReportFor(null)}
          target_type="notice"
          target_id={reportFor.id}
          target_user_id={reportFor.user_id}
          target_user_name={reportFor.user_name}
          onAfterReport={() => load()}
        />
      )}

      {/* Action sheet (cross-platform — Alert.alert is silent on web) */}
      <Modal visible={!!actionMenuFor} transparent animationType="fade" onRequestClose={() => setActionMenuFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }} onPress={() => setActionMenuFor(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.surface }]} onPress={() => {}}>
            <Text style={{ color: c.muted, fontSize: 13 * scale, fontWeight: "800", letterSpacing: 0.4, textAlign: "center", marginBottom: 8 }}>NOTICE OPTIONS</Text>
            {(actionMenu || []).map((o) => (
              <Pressable key={o.label} onPress={o.onPress} style={[styles.sheetBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <Text style={{ color: o.destructive ? c.error : c.onSurface, fontWeight: "800", fontSize: 16 * scale, textAlign: "center" }}>{o.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setActionMenuFor(null)} style={[styles.sheetBtn, { backgroundColor: c.surfaceTertiary, borderColor: c.border, marginTop: 4 }]}>
              <Text style={{ color: c.onSurface, fontWeight: "700", fontSize: 16 * scale, textAlign: "center" }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>


      <Modal visible={posting} animationType="slide" transparent onRequestClose={() => setPosting(false)}>
        <View style={styles.modalWrap}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
            <View style={[styles.modalSheet, { backgroundColor: c.surface }]}>
              <View style={styles.modalHead}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale }}>{editing ? "Edit notice" : "Post a notice"}</Text>
                <Pressable onPress={() => setPosting(false)} hitSlop={8} style={{ padding: 6 }}><Ionicons name="close" size={26} color={c.onSurface} /></Pressable>
              </View>
              <Text style={[styles.label, { color: c.muted, fontSize: 13 * scale }]}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {POST_CATS.map((cat) => (
                  <Pressable key={cat} onPress={() => setPCat(cat)} style={[styles.catFilter, { backgroundColor: pCat === cat ? c.brand : c.surfaceSecondary, borderColor: pCat === cat ? c.brand : c.border }]}>
                    <Text style={{ color: pCat === cat ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{CATEGORY_EMOJI[cat]} {cat}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={[styles.label, { color: c.muted, fontSize: 13 * scale, marginTop: 12 }]}>Title</Text>
              <TextInput testID="post-title" value={pTitle} onChangeText={setPTitle} placeholder="A short headline" placeholderTextColor={c.muted} style={inputStyle} />
              <Text style={[styles.label, { color: c.muted, fontSize: 13 * scale, marginTop: 12 }]}>Message</Text>
              <TextInput testID="post-body" value={pBody} onChangeText={setPBody} placeholder="What would you like to share?" placeholderTextColor={c.muted} multiline numberOfLines={5} style={[inputStyle, { height: 120, textAlignVertical: "top" }]} />

              {/* Optional photo — pick from the FriendPlace gallery or upload
                  your own. Emits a plain string that lands in the Notice's
                  `image` field (gallery ref / data URI / empty). */}
              <Text style={[styles.label, { color: c.muted, fontSize: 13 * scale, marginTop: 12 }]}>Photo (optional)</Text>
              {pImage ? (
                <View style={styles.photoPreviewWrap}>
                  {(() => {
                    const src = resolveImageSource(pImage);
                    return src ? (
                      <Image source={src} style={styles.photoPreview} resizeMode="cover" />
                    ) : null;
                  })()}
                  <View style={styles.photoPreviewActions}>
                    <Pressable
                      testID="post-photo-change"
                      onPress={() => setPImagePicker(true)}
                      style={[styles.photoBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                    >
                      <Ionicons name="images" size={16} color={c.onSurface} />
                      <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>Change photo</Text>
                    </Pressable>
                    <Pressable
                      testID="post-photo-remove"
                      onPress={() => setPImage("")}
                      style={[styles.photoBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                    >
                      <Ionicons name="close-circle" size={16} color={c.muted} />
                      <Text style={{ color: c.muted, fontWeight: "800", fontSize: 13 * scale }}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  testID="post-photo-add"
                  onPress={() => setPImagePicker(true)}
                  style={[styles.photoAddBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                >
                  <Ionicons name="camera" size={22} color={c.brand} />
                  <Text style={{ color: c.brand, fontWeight: "800", fontSize: 14 * scale }}>Add a photo</Text>
                </Pressable>
              )}

              <View style={{ height: 14 }} />
              <Button testID="post-submit" label={editing ? "Save changes" : "Post to Notice Board"} onPress={submitPost} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Gallery picker sheet — shared with Local Events. */}
      <GalleryPicker
        visible={pImagePicker}
        onClose={() => setPImagePicker(false)}
        onPick={setPImage}
        currentValue={pImage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginHorizontal: 12, marginTop: 10, borderRadius: 14, borderWidth: 1, gap: 4 },
  catsRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  catFilter: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 2, minHeight: 40 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
  author: { fontWeight: "800" },
  catChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  solvedChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  title: { fontWeight: "900", marginTop: 2 },
  body: { lineHeight: 22 },
  noticeCardImage: { width: "100%", height: 180, borderRadius: 12, marginTop: 8 },
  reactionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  reactBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, minHeight: 40 },
  commentBox: { padding: 10, borderRadius: 12, borderWidth: 1 },
  replyBox: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 4, marginTop: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 6, borderRadius: 14, borderWidth: 1, gap: 6, flexWrap: "wrap" },
  replyPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, width: "100%", justifyContent: "space-between" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  photoPreviewWrap: { gap: 8 },
  photoPreview: { width: "100%", height: 160, borderRadius: 12 },
  photoPreviewActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
  },
  photoAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    minHeight: 52,
  },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "85%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  label: { fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 28, gap: 8 },
  sheetBtn: { padding: 14, borderRadius: 14, borderWidth: 1 },
});
