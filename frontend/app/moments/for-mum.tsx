/**
 * For Mum ❤️ — tribute screen reached from the slim strip at the top of
 * Share a Moment.
 *
 * iter216 (Garry, Oct 2026): the strip stays compact on the feed; this
 * screen is where the full dedication lives. We render the tribute image
 * at full width (preserving its aspect ratio) over a very soft blue wash,
 * with a small back button in the corner. No chrome on the image itself
 * — the artwork already contains "For Mum ❤️", the quote, and the
 * illustrations.
 *
 * The image is served from the uploaded customer asset so it never gets
 * garbage-collected or re-encoded by Metro at build time.
 */
import React from "react";
import { View, Image, StyleSheet, ScrollView, Pressable, Text, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TRIBUTE_IMAGE_URI =
  "https://customer-assets-jai6qajn.emergentagent.net/job_a80ec07d-4f57-4c91-b9bc-efc7bf50eb01/artifacts/41octtls_Unknown.jpeg";

// The uploaded tribute is a tall portrait graphic — intrinsic size ≈
// 1138 × 1440 (ratio ~0.79). We lock the aspect so the whole dedication
// renders cleanly on narrow and wide phones alike without a crop.
const TRIBUTE_ASPECT = 1138 / 1440;

export default function ForMumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom, alignItems: "center" }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: insets.top + 8 }} />
        <View style={{ width: "100%", aspectRatio: TRIBUTE_ASPECT, maxWidth: 560 }}>
          <Image
            source={{ uri: TRIBUTE_IMAGE_URI }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
            testID="for-mum-image"
            accessibilityLabel="For Mum tribute: You showed me how much it matters to make people feel cared for, included and never alone. That spirit lives quietly inside FriendPlace."
          />
        </View>
        <Text style={styles.ariaCaption} accessibilityElementsHidden importantForAccessibility="no">
          A quiet thank you — kept here, always.
        </Text>
      </ScrollView>
      {/* Back pill — floats top-left so the dedication stays uninterrupted. */}
      <Pressable
        testID="for-mum-back"
        onPress={() => { try { router.back(); } catch { /* noop */ } }}
        style={[styles.backBtn, { top: insets.top + 10 }]}
        accessibilityRole="button"
        accessibilityLabel="Close the For Mum dedication"
        hitSlop={10}
      >
        <Ionicons name="chevron-back" size={22} color="#0F2A4D" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Soft blue wash matching the artwork's background so edges blend
    // seamlessly on any phone size.
    backgroundColor: "#F1F6FC",
  },
  backBtn: {
    position: "absolute",
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#D6E2EF",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#0F2A4D",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  ariaCaption: {
    marginTop: 14,
    fontSize: 13,
    color: "#4A6B8F",
    fontStyle: "italic",
    paddingHorizontal: 24,
    textAlign: "center",
  },
});
