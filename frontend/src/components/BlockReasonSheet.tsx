/**
 * BlockReasonSheet — modal shown before blocking a member.
 *
 * iter212 (Garry, Oct 2026 — Next Action #3): when a member blocks
 * someone, we optionally capture a short PRIVATE note ("Called me names
 * on a story") so the blocker can later open their Blocked list and
 * remember why. The note is only visible to the blocker — never shared
 * with the blocked member or anyone else.
 *
 * Flow:
 *   • Modal appears titled "Block {name}?"
 *   • Short explainer: posts hidden, no messages/game invites
 *   • Multiline TextInput, optional, 500-char cap
 *   • [Cancel] [Block] buttons — Block is destructive-red
 *
 * UX decisions:
 *   • Note is OPTIONAL — Block button is enabled even with empty text
 *     so a member in distress can just block fast without typing.
 *   • TextInput is a shade of the surface so it's clearly editable.
 *   • autoFocus=false — we don't want the keyboard shoving the sheet
 *     up before the member reads the title.
 */
import React, { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useTheme } from "@/src/lib/theme";

export type BlockReasonSheetProps = {
  visible: boolean;
  memberName: string;
  onCancel: () => void;
  onConfirm: (note: string) => void | Promise<void>;
};

export default function BlockReasonSheet({ visible, memberName, onCancel, onConfirm }: BlockReasonSheetProps) {
  const { c, scale } = useTheme();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setNote("");
      setSubmitting(false);
    }
  }, [visible]);

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm((note || "").trim().slice(0, 500));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%", alignItems: "center" }}>
          <Pressable style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => { /* swallow */ }}>
            <Text style={[styles.title, { color: c.onSurface, fontSize: 20 * scale }]}>
              Block {memberName || "this member"}?
            </Text>
            <Text style={[styles.body, { color: c.muted, fontSize: 14 * scale }]}>
              You won&apos;t see their posts and they can&apos;t message or Flutter you. Add a private note so you remember why — only you can see it.
            </Text>
            <TextInput
              testID="block-reason-input"
              value={note}
              onChangeText={(t) => setNote(t.slice(0, 500))}
              placeholder="e.g. was rude in a comment (optional)"
              placeholderTextColor={c.muted}
              multiline
              maxLength={500}
              style={[styles.input, {
                backgroundColor: c.surfaceSecondary,
                borderColor: c.border,
                color: c.onSurface,
                fontSize: 15 * scale,
              }]}
            />
            <Text style={{ color: c.muted, fontSize: 12 * scale, alignSelf: "flex-end", marginTop: 4 }}>
              {note.length}/500 · optional, only you see this
            </Text>
            <View style={styles.actions}>
              <Pressable
                testID="block-reason-cancel"
                onPress={onCancel}
                style={[styles.btn, { borderColor: c.border }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 * scale }}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="block-reason-confirm"
                disabled={submitting}
                onPress={confirm}
                style={[styles.btn, { backgroundColor: "#D62828", borderColor: "#D62828", opacity: submitting ? 0.7 : 1 }]}
              >
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 15 * scale }}>
                  {submitting ? "Blocking…" : "Block"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  title: { fontWeight: "900", marginBottom: 8 },
  body: { lineHeight: 20, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 90,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 14, justifyContent: "flex-end" },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
});
