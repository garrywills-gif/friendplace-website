/**
 * Data & Credits — public route, no auth required.
 *
 * Records third-party datasets used in FriendPlace along with any
 * required attributions. Any dataset added to the app whose licence
 * requires attribution (e.g. CC BY 4.0) MUST have a line here.
 *
 * Current entries:
 *   • Australian suburb + locality data — Matthew Proctor, CC BY 4.0
 *
 * Bump the LAST_UPDATED date whenever a new entry is added.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const LAST_UPDATED = "1 September 2026";

export default function DataCredits() {
  const { c, scale } = useTheme();

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Data & Credits" showGeorge />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
        <Text style={[styles.h1, { color: c.onSurface, fontSize: 24 * scale }]}>
          Data & Credits
        </Text>
        <Text style={[styles.meta, { color: c.muted, fontSize: 13 * scale }]}>
          Last updated {LAST_UPDATED}
        </Text>
        <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
          FriendPlace uses a handful of open datasets to make the app work well
          across Australia. We list the sources here so you can see what we
          use, and we thank the maintainers of each dataset for making their
          work available.
        </Text>

        <Section title="Australian suburbs & localities" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            Suburb suggestions, postcodes, and location matches inside the app
            (signup, profile, event search) are powered by an Australia-wide
            locality dataset.
          </Text>
          <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text style={[styles.body, { color: c.onSurface, fontSize: 15 * scale, fontWeight: "700" }]}>
              Suburb & locality data © Matthew Proctor, licensed under Creative Commons Attribution 4.0.
            </Text>
            <View style={{ marginTop: 8, gap: 4 }}>
              <Pressable
                testID="credits-mp-source"
                onPress={() => openLink("https://www.matthewproctor.com/australian_postcodes")}
                accessibilityRole="link"
                accessibilityLabel="Open source dataset website"
              >
                <Text style={{ color: c.brand, fontSize: 14 * scale, fontWeight: "700" }}>
                  Source: matthewproctor.com/australian_postcodes ↗
                </Text>
              </Pressable>
              <Pressable
                testID="credits-mp-licence"
                onPress={() => openLink("https://creativecommons.org/licenses/by/4.0/")}
                accessibilityRole="link"
                accessibilityLabel="Open Creative Commons Attribution 4.0 licence"
              >
                <Text style={{ color: c.brand, fontSize: 14 * scale, fontWeight: "700" }}>
                  Licence: CC BY 4.0 ↗
                </Text>
              </Pressable>
            </View>
          </View>
          <Text style={[styles.meta, { color: c.muted, fontSize: 13 * scale }]}>
            The dataset is refreshed periodically so newly-gazetted suburbs
            appear in the picker within a release or two.
          </Text>
        </Section>

        <Section title="Something not right?" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            If you spot a missing suburb, an incorrect attribution, or another
            data-credit issue, email{" "}
            <Text style={styles.b}>support@friendplace.com.au</Text> and we&rsquo;ll
            get it looked at.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, c, scale, children }: any) {
  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      <Text style={[styles.h2, { color: c.onSurface, fontSize: 20 * scale }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontWeight: "900" },
  h2: { fontWeight: "900", marginTop: 8 },
  meta: { fontStyle: "italic" },
  body: { lineHeight: 22 },
  b: { fontWeight: "800" },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
});
