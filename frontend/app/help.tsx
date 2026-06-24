import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Header from "@/src/components/Header";

const FAQ = [
  { q: "What is YouBelong?", a: "YouBelong is a warm, friendly community app for friendship, connection and community. Meet new friends, have a coffee chat, play games, and stay connected — at your own pace." },
  { q: "How do I make a friend?", a: "Open Find Friends from the bottom bar, browse members near you, and tap 'Send Friend Request'. When they accept, you can chat any time." },
  { q: "What is the Coffee Lounge?", a: "The Coffee Lounge is our virtual living room. Sit at any table for a friendly chat with others, just like a real café. New tables open every day." },
  { q: "What are Flutters?", a: "A Flutter is a gentle wave to someone — like saying 'hello, I'm here'. You can also send Flutters to congratulate friends on a game achievement." },
  { q: "What are Butterfly Points?", a: "You earn Butterfly Points for taking part — chatting, posting, playing games. They unlock fun badges to show off on your profile." },
  { q: "How do I keep my account safe?", a: "Never share passwords or bank details. Use the Report button if someone makes you uncomfortable, and Block them straight away. Our team reviews every report." },
  { q: "How do I make the text bigger?", a: "Tap Profile → Accessibility Settings. Slide the text size up, turn on Read Aloud, or pick High Contrast for easier reading." },
  { q: "I'm being bothered by another user — what do I do?", a: "Tap the three dots on their post or profile, then choose Report. Pick a reason and add details. You can also Block them so they can't reach you. We act on every report." },
  { q: "Why can't I post or message right now?", a: "If your account has been temporarily restricted, our team is reviewing recent activity. Please contact support — we'll get back to you quickly." },
  { q: "How do daily challenges work?", a: "Open Games Hub each day. Daily Trivia, Daily Bingo and Daily Jigsaw give bonus Butterfly Points and feed your daily streak." },
];

export default function HelpCentre() {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show } = useToast();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tab, setTab] = useState<"faq" | "contact" | "problem">("faq");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("Account help");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ;
    return FAQ.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [query]);

  const submitTicket = async (cat: string) => {
    if (!subject.trim() || !message.trim()) { show("Please add a subject and message"); return; }
    setSubmitting(true);
    try {
      await api.submitSupportTicket({ user_id: user?.id, user_email: user?.email, category: cat, subject, message });
      show("Thank you. We've received your message and will get back to you soon.");
      setSubject(""); setMessage("");
    } catch { show("Could not send. Please try again."); }
    finally { setSubmitting(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Help &amp; Support" emoji="🤗" subtitle="FAQs · Contact us · Resources" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 12 }}>
        {/* Tabs */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TabBtn label="FAQ" active={tab === "faq"} onPress={() => setTab("faq")} c={c} scale={scale} />
          <TabBtn label="Contact Support" active={tab === "contact"} onPress={() => setTab("contact")} c={c} scale={scale} />
          <TabBtn label="Report a Problem" active={tab === "problem"} onPress={() => setTab("problem")} c={c} scale={scale} />
        </View>

        {tab === "faq" && (
          <>
            <View style={[styles.searchBox, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <Ionicons name="search" size={20} color={c.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search the FAQ" placeholderTextColor={c.muted} style={{ flex: 1, color: c.onSurface, fontSize: 16 * scale }} />
            </View>
            <View style={{ gap: 8 }}>
              {filtered.map((f, i) => {
                const open = expanded === i;
                return (
                  <Pressable key={i} testID={`faq-${i}`} onPress={() => setExpanded(open ? null : i)} style={[styles.faqCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={{ flex: 1, color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{f.q}</Text>
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={c.muted} />
                    </View>
                    {open && <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22, marginTop: 8 }}>{f.a}</Text>}
                  </Pressable>
                );
              })}
              {filtered.length === 0 && <Text style={{ color: c.muted, padding: 20, textAlign: "center", fontSize: 15 * scale }}>No matches. Try different words.</Text>}
            </View>
          </>
        )}

        {(tab === "contact" || tab === "problem") && (
          <View style={{ gap: 10 }}>
            <Text style={{ color: c.onSurface, fontSize: 15 * scale, lineHeight: 22 }}>
              {tab === "contact"
                ? "Drop us a message and our team will get back to you within 1–2 business days."
                : "Spotted a bug or something broken? Let us know what happened so we can fix it."}
            </Text>
            {tab === "contact" && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {["Account help", "Suggestion / Feedback", "Other"].map(cat => (
                  <Pressable key={cat} onPress={() => setCategory(cat)} style={[styles.chip, { backgroundColor: category === cat ? c.brand : c.surfaceSecondary, borderColor: category === cat ? c.brand : c.border }]}>
                    <Text style={{ color: category === cat ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{cat}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={c.muted}
              style={[styles.field, { backgroundColor: c.surfaceSecondary, borderColor: c.border, color: c.onSurface, fontSize: 16 * scale }]} />
            <TextInput value={message} onChangeText={setMessage} placeholder={tab === "problem" ? "What happened? What did you expect?" : "How can we help?"} placeholderTextColor={c.muted}
              multiline style={[styles.field, { backgroundColor: c.surfaceSecondary, borderColor: c.border, color: c.onSurface, minHeight: 120, fontSize: 15 * scale, textAlignVertical: "top" }]} />
            <Pressable testID="support-submit" onPress={() => submitTicket(tab === "problem" ? "Bug / Technical issue" : category)} disabled={submitting} style={[styles.cta, { backgroundColor: c.brand, opacity: submitting ? 0.7 : 1 }]}>
              {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>{tab === "problem" ? "Send report" : "Send message"}</Text>}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function TabBtn({ label, active, onPress, c, scale }: any) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? c.brand : c.surfaceSecondary, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
      <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: "800", fontSize: 13 * scale }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  faqCard: { padding: 14, borderRadius: 14, borderWidth: 1, minHeight: 48 },
  field: { borderWidth: 1, borderRadius: 14, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  cta: { alignItems: "center", paddingVertical: 14, borderRadius: 999, marginTop: 6 },
});
