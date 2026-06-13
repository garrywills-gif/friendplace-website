import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** What is being reported. */
  target_type: "user" | "notice" | "message" | "dm" | "profile";
  target_id?: string;
  target_user_id?: string;
  target_user_name?: string;
  /** Optional: after submitting, offer extra safety actions (Block / Hide posts). */
  onAfterReport?: (info: { auto_restricted?: boolean }) => void;
};

const FALLBACK_REASONS = [
  "Spam",
  "Harassment / Bullying",
  "Inappropriate Content",
  "Fake Profile",
  "Scam / Suspicious Behaviour",
  "Other",
];

export default function ReportSheet({ visible, onClose, target_type, target_id, target_user_id, target_user_name, onAfterReport }: Props) {
  const { c, scale } = useTheme();
  const { user } = useAuth();
  const { show, confirm } = useToast();
  const [reasons, setReasons] = useState<string[]>(FALLBACK_REASONS);
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<"choose" | "thanks">("choose");
  const [autoRestricted, setAutoRestricted] = useState(false);

  useEffect(() => {
    if (!visible) { setReason(""); setNotes(""); setStage("choose"); setAutoRestricted(false); return; }
    api.safetyReasons().then((r: any) => { if (r?.reasons?.length) setReasons(r.reasons); }).catch(() => {});
  }, [visible]);

  const submit = async () => {
    if (!user || !reason) { show("Please choose a reason"); return; }
    setSubmitting(true);
    try {
      const r: any = await api.submitReport({
        reporter_id: user.id,
        target_user_id,
        target_type,
        target_id,
        reason,
        notes,
      });
      setAutoRestricted(!!r.auto_restricted);
      setStage("thanks");
      onAfterReport?.({ auto_restricted: !!r.auto_restricted });
    } catch {
      show("Could not submit report. Please try again.");
    } finally { setSubmitting(false); }
  };

  const blockUser = async () => {
    if (!user || !target_user_id) return;
    const ok = await confirm({ title: `Block ${target_user_name || "this user"}?`, message: "You won't see their posts and they can't message you.", confirmLabel: "Block", destructive: true });
    if (!ok) return;
    try { await api.blockUser(user.id, target_user_id); show("User blocked"); onClose(); } catch { show("Could not block"); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.surface }]} onPress={() => {}}>
          {stage === "choose" ? (
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30, gap: 12 }}>
              <View style={{ alignItems: "center" }}>
                <View style={{ width: 40, height: 4, backgroundColor: c.border, borderRadius: 2, marginBottom: 8 }} />
              </View>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale }}>Report {target_user_name ? target_user_name : target_type}</Text>
              <Text style={{ color: c.muted, fontSize: 14 * scale }}>Tell us what&apos;s wrong. Our team will review within 24 hours. False reports may affect your account.</Text>
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale, letterSpacing: 0.4, marginTop: 6 }}>REASON</Text>
              <View style={{ gap: 8 }}>
                {reasons.map((r) => {
                  const active = r === reason;
                  return (
                    <Pressable key={r} testID={`report-reason-${r}`} onPress={() => setReason(r)} style={[styles.reasonRow, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
                      <Text style={{ color: active ? "#FFF" : c.onSurface, fontWeight: active ? "900" : "700", fontSize: 15 * scale }}>{r}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: c.muted, fontWeight: "800", fontSize: 12 * scale, letterSpacing: 0.4, marginTop: 4 }}>EXTRA DETAILS (optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Add anything that will help our team review this."
                placeholderTextColor={c.muted}
                style={{ minHeight: 80, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, color: c.onSurface, fontSize: 15 * scale, backgroundColor: c.surfaceSecondary }}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
                </Pressable>
                <Pressable testID="report-submit" onPress={submit} disabled={!reason || submitting} style={[styles.btn, { backgroundColor: c.brand, borderColor: c.brand, opacity: !reason || submitting ? 0.55 : 1 }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>{submitting ? "Sending…" : "Submit report"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View style={{ padding: 22, gap: 10, alignItems: "center" }}>
              <Text style={{ fontSize: 60 }}>{"\u{1F64F}"}</Text>
              <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 22 * scale, textAlign: "center" }}>Thank you.</Text>
              <Text style={{ color: c.muted, fontSize: 15 * scale, textAlign: "center", lineHeight: 22 }}>We&apos;ve received your report and will review it.</Text>
              {autoRestricted && (
                <View style={[styles.banner, { backgroundColor: "#DC262622", borderColor: "#DC2626" }]}>
                  <Text style={{ color: "#DC2626", fontWeight: "900", fontSize: 13 * scale }}>This account has now been auto-restricted while we review.</Text>
                </View>
              )}
              <View style={{ width: "100%", gap: 8, marginTop: 8 }}>
                {target_user_id && (
                  <Pressable testID="report-block" onPress={blockUser} style={[styles.btn, { backgroundColor: "#DC2626", borderColor: "#DC2626" }]}>
                    <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Block this user</Text>
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: c.brand, borderColor: c.brand }]}>
                  <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>Done</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  reasonRow: { paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, minHeight: 50, justifyContent: "center" },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 999, borderWidth: 1.5, alignItems: "center" },
  banner: { padding: 10, borderRadius: 12, borderWidth: 1, alignSelf: "stretch" },
});
