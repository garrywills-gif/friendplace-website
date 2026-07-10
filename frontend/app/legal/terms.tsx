/**
 * Terms of Use — public route, no auth required.
 *
 * Companion to the Privacy Policy. Both are referenced from the sign-up
 * screen and from Settings, and are the URLs handed to the Apple/Google
 * store listings.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

const LAST_UPDATED = "18 June 2026";
const CONTACT_EMAIL = "support@friendplace.com.au";

export default function Terms() {
  const { c, scale } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Terms of Use" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 14 }}>
        <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>FriendPlace Terms of Use</Text>
        <Text style={[styles.meta, { color: c.muted, fontSize: 13 * scale }]}>Last updated: {LAST_UPDATED}</Text>
        <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
          Welcome to FriendPlace — a warm, friendly place for friendship,
          connection and community. These Terms set out the simple rules that
          let us keep FriendPlace a kind, safe space. By creating an account
          you agree to these Terms and our Privacy Policy.
        </Text>

        <Section title="Who can use FriendPlace" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>You must be at least 13 years old.</Bullet>
          <Bullet c={c} scale={scale}>You may only hold one personal account.</Bullet>
          <Bullet c={c} scale={scale}>Provide truthful information — pretending to be someone else is not allowed.</Bullet>
        </Section>

        <Section title="Be kind. Always." c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            FriendPlace has zero tolerance for harassment, hate speech,
            discrimination, threats, or any behaviour that targets people on
            the basis of who they are. We reserve the right to remove content
            and terminate accounts that breach our Community Guidelines (see
            Settings → Community Guidelines).
          </Text>
        </Section>

        <Section title="This is a friendship community — not a dating app" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            FriendPlace exists to help people meet new friends, join local
            events, and feel connected. It is not a dating service. Soliciting
            romantic or sexual contact is not appropriate here.
          </Text>
        </Section>

        <Section title="Things you must not do" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>Post content that is illegal, threatening, defamatory, obscene, or that infringes someone else's rights.</Bullet>
          <Bullet c={c} scale={scale}>Share other people's personal information without their consent.</Bullet>
          <Bullet c={c} scale={scale}>Spam, scrape, or attempt to attack or reverse-engineer the service.</Bullet>
          <Bullet c={c} scale={scale}>Use FriendPlace to advertise or sell goods or services without our written permission.</Bullet>
          <Bullet c={c} scale={scale}>Pretend to be a FriendPlace staff member or a moderator.</Bullet>
        </Section>

        <Section title="Your content" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            You own the photos and posts you share. By posting, you grant us a
            non-exclusive licence to display them inside FriendPlace so other
            members can see them. You can remove your content at any time by
            editing or deleting it, or by deleting your account.
          </Text>
        </Section>

        <Section title="Reports and moderation" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            We rely on you to tell us when something is wrong. Use the Report
            button on any profile, message, or post. Our moderators review
            reports and may warn, suspend, or remove accounts. We can also
            remove content at our discretion if it breaches these Terms.
          </Text>
        </Section>

        <Section title="Suspending or closing an account" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>You can delete your account any time from Settings → Delete Account.</Bullet>
          <Bullet c={c} scale={scale}>We can suspend or close any account that breaches these Terms.</Bullet>
          <Bullet c={c} scale={scale}>If your account is closed by us, we'll tell you why and how to appeal.</Bullet>
        </Section>

        <Section title="No warranty / no liability" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            FriendPlace is provided “as is”. We work hard to keep it safe and
            reliable, but we don't promise it will always be available or
            error-free. To the maximum extent permitted by law, we are not
            liable for any indirect or consequential losses arising from your
            use of the app.
          </Text>
        </Section>

        <Section title="Changes to these Terms" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            We may update these Terms from time to time. Significant changes
            will be announced in-app. Continuing to use FriendPlace after a
            change means you accept the updated Terms.
          </Text>
        </Section>

        <Section title="Contact us" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            Questions? Email <Text style={styles.b}>{CONTACT_EMAIL}</Text>.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, c, scale, children }: any) {
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <Text style={[styles.h2, { color: c.onSurface, fontSize: 20 * scale }]}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ c, scale, children }: any) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: c.brand, fontWeight: "900", fontSize: 16 * scale, marginTop: 1 }}>•</Text>
      <Text style={{ flex: 1, color: c.onSurface, fontSize: 16 * scale, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontWeight: "900" },
  h2: { fontWeight: "900", marginTop: 8 },
  meta: { fontStyle: "italic" },
  body: { lineHeight: 22 },
  b: { fontWeight: "800" },
});
