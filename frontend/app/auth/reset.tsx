import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useToast } from "@/src/lib/toast";
import { api } from "@/src/lib/api";
import Button from "@/src/components/Button";
import Header from "@/src/components/Header";
import PasswordField from "@/src/components/PasswordField";

export default function Reset() {
  const router = useRouter();
  const { c, scale } = useTheme();
  const { show } = useToast();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const [identifier, setIdentifier] = useState(typeof params.identifier === "string" ? params.identifier : "");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !code.trim() || !pw || !pw2) { show("Please fill in all fields"); return; }
    if (pw.length < 6) { show("Password must be at least 6 characters"); return; }
    if (pw !== pw2) { show("Passwords do not match"); return; }
    if (code.trim().length !== 6) { show("Code must be 6 digits"); return; }
    setBusy(true);
    try {
      await api.reset(identifier.trim(), code.trim(), pw);
      show("Password updated. Please log in.");
      router.replace("/auth/login");
    } catch (e: any) {
      show(e?.message?.includes("400") ? "Invalid or expired code" : "Reset failed. Try again.");
    } finally { setBusy(false); }
  };

  const inputStyle = { color: c.onSurface, backgroundColor: c.surfaceSecondary, borderColor: c.border, fontSize: 17 * scale, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontWeight: "600" as const };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Reset Password" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Username or email</Text>
          <TextInput testID="reset-identifier" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} placeholderTextColor={c.muted} style={inputStyle} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>6-digit code</Text>
          <TextInput testID="reset-code" value={code} onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholderTextColor={c.muted} style={[inputStyle, { letterSpacing: 6, fontSize: 22 * scale }]} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>New password</Text>
          <PasswordField testID="reset-pw" value={pw} onChangeText={setPw} placeholder="At least 6 characters" placeholderTextColor={c.muted} inputStyle={inputStyle} iconColor={c.brand} />

          <Text style={[styles.label, { color: c.onSurface, fontSize: 16 * scale }]}>Confirm new password</Text>
          <PasswordField testID="reset-pw2" value={pw2} onChangeText={setPw2} placeholder="Re-enter password" placeholderTextColor={c.muted} inputStyle={inputStyle} iconColor={c.brand} />

          <View style={{ height: 8 }} />
          <Button testID="reset-submit" label="Reset password" onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  label: { fontWeight: "700", marginTop: 8 },
});
