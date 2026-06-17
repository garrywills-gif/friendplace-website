/**
 * YouBelong post-signup onboarding wizard.
 *
 * Replaces the old feature-tour with a data-collection flow that gets new
 * members engaged in under a minute. Six steps, with a progress bar and
 * Back / Skip / Next on every screen:
 *
 *   0  Welcome           — warm hello, butterfly mascot, "Get Started"
 *   1  Choose interests  — tap-to-toggle chips, pick any number
 *   2  Where are you?    — Aussie suburb picker (re-uses signup component)
 *   3  Add a photo       — emoji avatar grid (camera/gallery on native)
 *   4  Join groups       — suggested groups, big "Join All" CTA
 *   5  All set!          — celebration + "Take me to the Coffee Lounge"
 *
 * Submits everything at once via POST /api/onboarding/complete on the final
 * step. Skipping individual steps just sends empty values for those fields.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import SuburbField from "@/src/components/SuburbField";
import AvatarBubble from "@/src/components/AvatarBubble";
import PeopleAvatarPicker from "@/src/components/PeopleAvatarPicker";

// Interest chip set — kept friendly and Australia-leaning to match the seed
// data. 16 keeps the grid balanced on phone widths.
const INTERESTS = [
  "Coffee chats", "Walking & fitness", "Books & films", "Cooking",
  "Gardening", "Travel", "Games & puzzles", "Music",
  "Arts & crafts", "Faith & spirituality", "Volunteering", "Tech help",
  "Pets", "Classic cars", "History", "Local meetups",
];

// Same emoji set used by the signup screen so chosen avatars stay consistent
// if the user already picked one earlier in signup.
const AVATARS = ["🌸", "🦋", "🌳", "🌻", "🐦", "☕", "📚", "🎵", "🌈", "🍰", "🧶", "🎨", "🏏", "🔨", "🧓"];

type SuggestedGroup = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  member_count: number;
  is_starter: boolean;
  match: number;
};

export default function OnboardingWizard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, scale } = useTheme();
  const { user, refresh } = useAuth();
  const { show } = useToast();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Step 5 lets the user pick where to land. Defaults to Coffee Lounge —
  // proven to be the warmest first-touch (real-time chat, no scheduling).
  const [finishDestination, setFinishDestination] = useState<"lounge" | "events" | "friends">("lounge");
  const scrollRef = useRef<ScrollView>(null);

  // Pre-seed from whatever signup may have already collected so the wizard
  // doesn't feel redundant for email signups.
  const [interests, setInterests] = useState<string[]>(() => (user?.interests || []).slice());
  const [suburb, setSuburb] = useState<{ name: string; postcode?: string; state?: string } | null>(
    user?.suburb ? { name: user.suburb } : null,
  );
  const [locationPrivate, setLocationPrivate] = useState(false);
  const [avatar, setAvatar] = useState<string>(user?.avatar || "🦋");
  const [groups, setGroups] = useState<SuggestedGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [joinedAll, setJoinedAll] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Lazy-load suggested groups when the user lands on the groups step so the
  // backend can already see their picked interests and rank accordingly.
  useEffect(() => {
    if (step !== 4 || !user?.id || groups.length) return;
    (async () => {
      setGroupsLoading(true);
      try {
        // Persist interests *before* asking for suggestions so the ranker
        // sees the latest selection. Fire-and-forget — the final commit will
        // re-send them too.
        if (interests.length) {
          try { await api.updateProfile(user.id, { interests }); } catch {}
        }
        const r: any = await api.onboardingSuggestedGroups(user.id);
        const list: SuggestedGroup[] = (r?.groups || []).slice(0, 8);
        setGroups(list);
        // Default-select the top 3 to make "Continue" feel like progress.
        setSelectedGroupIds(list.slice(0, 3).map((g) => g.id));
      } catch (e) {
        // Fall back to empty — user can still skip the step.
      } finally {
        setGroupsLoading(false);
      }
    })();
  }, [step, user?.id]);

  // Scroll back to the top whenever the step changes so long scrollable steps
  // don't appear mid-way through.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  // Onboarding is now a slim 3-step wizard: Welcome explainer → Groups
  // picker → Destination picker. The old interests / location / avatar
  // steps were folded into the new 2-step /auth/signup so we don't ask
  // for the same thing twice. (Step keys are still 0/1/2 here to keep
  // the existing stepView memo + footer logic intact.)
  const totalSteps = 3;
  const progress = (step + 1) / totalSteps;

  const goNext = () => setStep((s) => Math.min(totalSteps - 1, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const toggleInterest = (label: string) => {
    setInterests((cur) =>
      cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label],
    );
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
    setJoinedAll(false);
  };

  const joinAll = () => {
    setSelectedGroupIds(groups.map((g) => g.id));
    setJoinedAll(true);
  };

  const finishWizard = async (skipGroups: boolean = false) => {
    if (!user?.id) {
      router.replace("/" as any);
      return;
    }
    setBusy(true);
    // Where to send the user after onboarding. Coffee Lounge is the default
    // (warmest first touch). They can override via the tiles on Step 5.
    const destinationRoute =
      finishDestination === "events" ? "/events" :
      finishDestination === "friends" ? "/friends" :
      "/lounge";
    try {
      await api.onboardingFinish({
        user_id: user.id,
        interests,
        suburb: locationPrivate ? "" : suburb?.name || "",
        suburb_postcode: locationPrivate ? "" : suburb?.postcode || "",
        suburb_state: locationPrivate ? "" : suburb?.state || "",
        location_visibility: locationPrivate ? "private" : "suburb",
        avatar,
        group_ids: skipGroups ? [] : selectedGroupIds,
        joined_all: !skipGroups && joinedAll,
      });
      try { await refresh?.(); } catch {}
      show("You're all set up! Welcome to YouBelong 🦋");
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).location.assign(destinationRoute);
      } else {
        router.replace(destinationRoute as any);
      }
    } catch (e: any) {
      show("Couldn't save your choices. You can update them later from Profile.");
      // Best-effort: still send them to home so they're not stuck.
      try { await refresh?.(); } catch {}
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).location.assign("/home");
      } else {
        router.replace("/home" as any);
      }
    } finally {
      setBusy(false);
    }
  };

  // -------- step content --------
  const Step0 = (
    <View style={[styles.stepWrap]}>
      <View style={styles.heroBadge}>
        <Text style={{ fontSize: 84 }}>🦋</Text>
      </View>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 30 * scale, textAlign: "center" }]}>
        Welcome to YouBelong
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 17 * scale, textAlign: "center" }]}>
        A warm, friendly place to meet new people and stay connected — built especially for adults living alone.
      </Text>

      {/* Three-bullet "what YouBelong is" explainer so brand-new users
          form the right mental model before they start filling forms. */}
      <View style={[styles.featureList, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
        <View style={styles.featureRow}>
          <Text style={styles.featureEmoji}>☕</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>Coffee Lounge</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>
              Drop into a real-time chat with friendly faces — no scheduling needed.
            </Text>
          </View>
        </View>
        <View style={styles.featureRow}>
          <Text style={styles.featureEmoji}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>Local Events</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>
              Walks, lunches, classes and meet-ups happening right near you.
            </Text>
          </View>
        </View>
        <View style={styles.featureRow}>
          <Text style={styles.featureEmoji}>👋</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 16 * scale }}>Friendship Groups</Text>
            <Text style={{ color: c.muted, fontSize: 14 * scale, marginTop: 2 }}>
              Join groups around your interests and chat with kindred spirits.
            </Text>
          </View>
        </View>
      </View>

      <Text style={[styles.body, { color: c.muted, fontSize: 14 * scale, marginTop: 4, textAlign: "center" }]}>
        Setup takes about a minute. You can change anything later from your Profile.
      </Text>
    </View>
  );

  const Step1 = (
    <View style={styles.stepWrap}>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>
        What do you enjoy?
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 15 * scale }]}>
        Pick a few — we&apos;ll use these to suggest people and groups. Tap any that interest you.
      </Text>
      <View style={styles.chips}>
        {INTERESTS.map((label) => {
          const on = interests.includes(label);
          return (
            <Pressable
              key={label}
              testID={`onb-interest-${label}`}
              onPress={() => toggleInterest(label)}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? c.brand : c.surfaceSecondary,
                  borderColor: on ? c.brand : c.border,
                },
              ]}
            >
              <Text
                style={{
                  color: on ? c.onBrandPrimary : c.onSurface,
                  fontSize: 15 * scale,
                  fontWeight: "700",
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.helper, { color: c.muted, fontSize: 13 * scale }]}>
        {interests.length === 0 ? "Tip: pick at least 2–3 to get better suggestions" : `${interests.length} selected`}
      </Text>
    </View>
  );

  const Step2 = (
    <View style={styles.stepWrap}>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>
        Where are you?
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 15 * scale }]}>
        We&apos;ll show you local events and people nearby. We never share your exact address.
      </Text>
      <SuburbField
        initialValue={suburb?.name || ""}
        preferNotToSay={locationPrivate}
        testID="onb-suburb"
        onChange={(s, pns) => {
          setSuburb(s);
          setLocationPrivate(!!pns);
        }}
      />
    </View>
  );

  const Step3 = (
    <View style={styles.stepWrap}>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>
        Pick a profile picture
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 15 * scale }]}>
        Build a friendly face — or pick a fun emoji further down.
      </Text>
      <View style={{ marginTop: 8 }}>
        <PeopleAvatarPicker value={avatar} onChange={setAvatar} previewSize={92} />
      </View>
      <Text style={[styles.body, { color: c.muted, fontSize: 13 * scale, marginTop: 14 }]}>
        Or pick a fun emoji
      </Text>
      <View style={styles.avatarGrid}>
        {AVATARS.map((a) => (
          <Pressable
            key={a}
            testID={`onb-avatar-${a}`}
            onPress={() => setAvatar(a)}
            style={[
              styles.avatarBtn,
              {
                backgroundColor: avatar === a ? c.brandTertiary : c.surfaceSecondary,
                borderColor: avatar === a ? c.brand : c.border,
              },
            ]}
          >
            <Text style={{ fontSize: 30 }}>{a}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const Step4 = (
    <View style={styles.stepWrap}>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>
        Join a few groups
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 15 * scale }]}>
        Groups are the easiest way to start chatting. Pick any you like — or tap the big button below to join all the popular starter groups in one go.
      </Text>

      <Pressable
        testID="onb-join-all"
        onPress={joinAll}
        style={[styles.joinAllBtn, { backgroundColor: c.brand }]}
      >
        <Ionicons name="sparkles" size={22} color={c.onBrandPrimary} />
        <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 18 * scale }}>
          Join All Suggested Groups
        </Text>
      </Pressable>

      <Text style={[styles.helper, { color: c.muted, fontSize: 13 * scale, marginBottom: 4 }]}>
        …or pick & choose:
      </Text>

      {groupsLoading ? (
        <View style={{ paddingVertical: 30, alignItems: "center" }}>
          <ActivityIndicator size="large" color={c.brand} />
        </View>
      ) : (
        groups.map((g) => {
          const on = selectedGroupIds.includes(g.id);
          return (
            <Pressable
              key={g.id}
              testID={`onb-group-${g.id}`}
              onPress={() => toggleGroup(g.id)}
              style={[
                styles.groupRow,
                {
                  backgroundColor: on ? c.brandTertiary : c.surfaceSecondary,
                  borderColor: on ? c.brand : c.border,
                },
              ]}
            >
              <Text style={{ fontSize: 34 }}>{g.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>{g.name}</Text>
                  {g.match > 0 && (
                    <View style={[styles.matchBadge, { backgroundColor: c.brand }]}>
                      <Text style={{ color: c.onBrandPrimary, fontSize: 11 * scale, fontWeight: "800" }}>GREAT MATCH</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }} numberOfLines={2}>
                  {g.description}
                </Text>
              </View>
              <Ionicons
                name={on ? "checkmark-circle" : "ellipse-outline"}
                size={28}
                color={on ? c.brand : c.muted}
              />
            </Pressable>
          );
        })
      )}
    </View>
  );

  const Step5 = (
    <View style={[styles.stepWrap, { alignItems: "center" }]}>
      <View style={styles.heroBadge}>
        <Text style={{ fontSize: 80 }}>🎉</Text>
      </View>
      <Text style={[styles.h1, { color: c.onSurface, fontSize: 28 * scale, textAlign: "center" }]}>
        You&apos;re all set!
      </Text>
      <Text style={[styles.body, { color: c.muted, fontSize: 16 * scale, textAlign: "center" }]}>
        Where would you like to start? Tap one and we&apos;ll take you straight there.
      </Text>

      {/* Destination picker — the warmth of YouBelong comes from real
          contact with other members, so we give the user three concrete
          first-touch options rather than dumping them onto Home. The
          footer CTA below mirrors whichever tile is selected. */}
      <View style={{ width: "100%", gap: 10, marginTop: 6 }}>
        {([
          { key: "lounge",  emoji: "☕", title: "Coffee Lounge", body: "Drop into a real-time chat — friendly faces are usually around." },
          { key: "events",  emoji: "📅", title: "Local Events",   body: "See what's happening near you this week — walks, lunches, classes." },
          { key: "friends", emoji: "👋", title: "Find Friends",   body: "Say hi to a neighbour who shares your interests." },
        ] as const).map((d) => {
          const on = finishDestination === d.key;
          return (
            <Pressable
              key={d.key}
              testID={`onb-dest-${d.key}`}
              onPress={() => setFinishDestination(d.key)}
              style={[
                styles.destTile,
                {
                  backgroundColor: on ? c.brandTertiary : c.surfaceSecondary,
                  borderColor: on ? c.brand : c.border,
                },
              ]}
            >
              <Text style={{ fontSize: 32 }}>{d.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 17 * scale }}>{d.title}</Text>
                <Text style={{ color: c.muted, fontSize: 13 * scale, marginTop: 2 }} numberOfLines={2}>
                  {d.body}
                </Text>
              </View>
              <Ionicons
                name={on ? "checkmark-circle" : "ellipse-outline"}
                size={26}
                color={on ? c.brand : c.muted}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.recapCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border, marginTop: 16 }]}>
        <View style={styles.recapRow}>
          <Ionicons name="heart" size={18} color={c.brand} />
          <Text style={{ color: c.onSurface, fontSize: 14 * scale, flex: 1 }}>
            {interests.length ? `${interests.length} interest${interests.length > 1 ? "s" : ""} picked` : "Interests skipped — add them later"}
          </Text>
        </View>
        <View style={styles.recapRow}>
          <Ionicons name="location" size={18} color={c.brand} />
          <Text style={{ color: c.onSurface, fontSize: 14 * scale, flex: 1 }}>
            {locationPrivate ? "Location private" : suburb?.name ? `In ${suburb.name}${suburb.state ? ", " + suburb.state : ""}` : "Suburb not set"}
          </Text>
        </View>
        <View style={styles.recapRow}>
          <Ionicons name="people" size={18} color={c.brand} />
          <Text style={{ color: c.onSurface, fontSize: 14 * scale, flex: 1 }}>
            {selectedGroupIds.length
              ? `Joining ${selectedGroupIds.length} group${selectedGroupIds.length > 1 ? "s" : ""}`
              : "No groups joined yet"}
          </Text>
        </View>
      </View>
    </View>
  );

  const stepView = useMemo(() => {
    switch (step) {
      case 0: return Step0;   // Welcome explainer
      case 1: return Step3;   // Groups picker (was Step3 in the 6-step layout)
      case 2: return Step5;   // Destination picker (was Step5)
      default: return Step0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, interests, suburb, locationPrivate, avatar, groups, selectedGroupIds, groupsLoading, finishDestination]);

  // -------- footer CTAs --------
  const isLast = step === totalSteps - 1;
  const isFirst = step === 0;
  const showSkip = step > 0 && !isLast;
  const lastLabel =
    finishDestination === "events" ? "Browse events" :
    finishDestination === "friends" ? "Find friends" :
    "Take me to the Coffee Lounge";
  const primaryLabel = isFirst ? "Get Started" : isLast ? lastLabel : "Continue";

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      {/* Header with progress bar */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: c.brand }]} />
        </View>
        <Text style={{ color: c.muted, fontSize: 12 * scale, fontWeight: "700", marginTop: 6 }}>
          Step {step + 1} of {totalSteps}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {stepView}
      </ScrollView>

      {/* Footer — back / skip / next */}
      <View style={[styles.footer, { borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {!isFirst && (
            <Pressable
              testID="onb-back"
              onPress={goBack}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: c.border, opacity: busy ? 0.5 : 1 }]}
            >
              <Ionicons name="chevron-back" size={20} color={c.onSurface} />
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Back</Text>
            </Pressable>
          )}
          {showSkip && (
            <Pressable
              testID="onb-skip"
              onPress={() => (step === 4 ? finishWizard(true) : goNext())}
              disabled={busy}
              style={{ paddingHorizontal: 12, paddingVertical: 10 }}
            >
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 14 * scale }}>Skip</Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          <Pressable
            testID="onb-next"
            disabled={busy}
            onPress={() => (isLast ? finishWizard(false) : (step === 4 ? finishWizard(false) : goNext()))}
            style={[styles.primaryBtn, { backgroundColor: c.brand, opacity: busy ? 0.7 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={c.onBrandPrimary} />
            ) : (
              <>
                <Text style={{ color: c.onBrandPrimary, fontWeight: "900", fontSize: 17 * scale }}>{primaryLabel}</Text>
                {!isLast && <Ionicons name="chevron-forward" size={20} color={c.onBrandPrimary} />}
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  stepWrap: { paddingTop: 18, gap: 14 },
  heroBadge: { alignSelf: "center", marginTop: 4, marginBottom: 4 },

  h1: { fontWeight: "900", letterSpacing: 0.2 },
  body: { lineHeight: 23, fontWeight: "500" },
  helper: { marginTop: 6, fontWeight: "600" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2 },

  avatarPreviewWrap: {
    alignSelf: "center",
    width: 120, height: 120, borderRadius: 60,
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, marginTop: 6, marginBottom: 6,
  },
  avatarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 4 },
  avatarBtn: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center", borderWidth: 2,
  },

  joinAllBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 18, borderRadius: 16, marginTop: 8, marginBottom: 12,
    shadowColor: "#0D2A57", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  groupRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 2, marginTop: 8,
  },
  matchBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6 },

  featureList: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 14,
    marginTop: 8,
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  featureEmoji: { fontSize: 36, lineHeight: 40 },

  destTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 2,
    minHeight: 76,
  },

  recapCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  recapRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  footer: { paddingHorizontal: 18, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  primaryBtn: {
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 999,
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: 52,
  },
  secondaryBtn: {
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, borderWidth: 2,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
});
