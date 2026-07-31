import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";

/**
 * Recipes has been retired for members (locked with Garry, 31 July
 * 2026). Everyday sharing lives in Share a Moment now — cooking
 * included. Existing recipe data remains in the database in case we
 * bring it back later (e.g. as a food-themed Community Group), but
 * there is no member-facing UI.
 *
 * If someone deep-links to /recipes we quietly send them to /moments
 * so nothing dead-ends.
 */
export default function RecipesRetiredRedirect() {
  const router = useRouter();
  const { c } = useTheme();
  useEffect(() => {
    router.replace("/moments" as any);
  }, [router]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}
