import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * ErrorBoundary — top-level React error boundary. Catches any runtime
 * rendering error thrown by a descendant component and renders a friendly
 * fallback screen instead of the white-screen-of-death.
 *
 * Older members are the most exposed to crashes — a blank screen with no
 * recovery path is scarier than the actual error. This component gives
 * them a clear "Something went wrong" message, a big Try again button
 * that resets the boundary in-place (no reload = no lost session), and
 * an optional secondary "Go Home" button that hard-navigates if the
 * in-tree recovery still isn't enough.
 *
 * Errors are logged to console so the (deferred) Sentry integration can
 * pick them up automatically once wired.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[FriendPlace] Unhandled render error:", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  goHome = () => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any)?.window?.location?.assign?.("/");
    }
    // On native the reset alone is enough — the app tree re-renders and
    // whatever screen was mounted before will remount cleanly.
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const msg = this.state.error?.message || "Something went wrong.";
    return (
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Ionicons name="warning" size={54} color="#F59E0B" />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            FriendPlace hit a small hiccup. Your account is safe — you don&apos;t need to sign in again. Please try again below.
          </Text>
          {!!msg && (
            <Text style={styles.detail} numberOfLines={4}>{msg}</Text>
          )}
          <View style={styles.actions}>
            <Pressable
              testID="error-boundary-retry"
              onPress={this.reset}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.primaryBtnText}>Try again</Text>
            </Pressable>
            <Pressable
              testID="error-boundary-home"
              onPress={this.goHome}
              accessibilityRole="button"
              accessibilityLabel="Go to Home"
              style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={styles.ghostBtnText}>Go to Home</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F172A",
    marginTop: 8,
    textAlign: "center",
  },
  body: {
    fontSize: 16,
    color: "#334155",
    textAlign: "center",
    lineHeight: 22,
    marginTop: 4,
  },
  detail: {
    fontSize: 12,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    width: "100%",
  },
  primaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E3A7F",
  },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  ghostBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
  },
  ghostBtnText: { color: "#0F172A", fontWeight: "800", fontSize: 16 },
});
