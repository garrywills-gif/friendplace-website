import React from "react";
import { Pressable, Text, StyleSheet, ViewStyle, ActivityIndicator } from "react-native";
import { useTheme, radius } from "../lib/theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export default function Button({ label, onPress, variant = "primary", icon, loading, disabled, style, testID }: Props) {
  const { c, scale } = useTheme();
  const palette: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.brandPrimary, fg: c.onBrandPrimary },
    secondary: { bg: c.brandSecondary, fg: c.onBrandSecondary },
    outline: { bg: "transparent", fg: c.brandPrimary, border: c.brandPrimary },
    ghost: { bg: "transparent", fg: c.onSurface },
  };
  const p = palette[variant];
  return (
    <Pressable
      testID={testID}
      onPress={loading || disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: p.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderColor: p.border, borderWidth: p.border ? 2 : 0 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, { color: p.fg, fontSize: 20 * scale, marginLeft: icon ? 10 : 0 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 60,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  label: { fontWeight: "700", letterSpacing: 0.2 },
});
