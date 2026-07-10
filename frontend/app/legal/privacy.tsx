/**
 * Privacy Policy — public route, no auth required.
 *
 * Hosted in-app so the URL we hand to the Apple App Store and Google Play
 * store listings (and to the sign-up screen disclosure) is stable, mobile-
 * friendly, and updates with every app release.
 *
 * The wording below is a sensible starting draft tailored to FriendPlace's
 * actual data flow — it should be reviewed by the user (and ideally a
 * lawyer in the launch jurisdiction) before public submission. The
 * **Last updated** date below is the single source of truth: bump it
 * whenever the copy changes so users can see when the policy moved.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTheme } from "@/src/lib/theme";
import Header from "@/src/components/Header";

// Bump this whenever the policy is materially updated. Used at the top
// of the page and surfaced to users by date so they can re-read changes.
const LAST_UPDATED = "18 June 2026";
const CONTACT_EMAIL = "support@youbelongapp.com";

export default function PrivacyPolicy() {
  const { c, scale } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <Header title="Privacy Policy" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 14 }}>
        <Text style={[styles.h1, { color: c.onSurface, fontSize: 26 * scale }]}>FriendPlace Privacy Policy</Text>
        <Text style={[styles.meta, { color: c.muted, fontSize: 13 * scale }]}>Last updated: {LAST_UPDATED}</Text>
        <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
          FriendPlace is a community app for friendship, connection and belonging.
          Your trust is important to us. This policy explains what we collect, how
          we use it, and the choices you have.
        </Text>

        <Section title="What we collect" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>Account details you give us: first name, username, email (if provided), suburb, postcode, and any interests, bio or avatar you choose to add.</Bullet>
          <Bullet c={c} scale={scale}>Content you create: messages, group posts, notice-board posts, event RSVPs, photos, and friend/block relationships.</Bullet>
          <Bullet c={c} scale={scale}>Basic technical info: app version, device type, and event logs needed to keep the service running and to investigate problems.</Bullet>
          <Bullet c={c} scale={scale}>Reports or support tickets you raise.</Bullet>
          <Bullet c={c} scale={scale}>We do <Text style={styles.b}>not</Text> sell your personal information.</Bullet>
        </Section>

        <Section title="How we use it" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>To run FriendPlace — show your profile to friends, deliver your messages, suggest people nearby (by suburb), and let you join groups, events and Coffee Lounge tables.</Bullet>
          <Bullet c={c} scale={scale}>To keep the community safe — review reports, prevent abuse, and apply our community guidelines.</Bullet>
          <Bullet c={c} scale={scale}>To send service notifications (e.g. event reminders, friend requests). You can turn these off in Settings.</Bullet>
          <Bullet c={c} scale={scale}>To improve the app — measure aggregate usage (never tied to your identity in marketing reports).</Bullet>
        </Section>

        <Section title="Who we share it with" c={c} scale={scale}>
          <Bullet c={c} scale={scale}>Other FriendPlace members — only the parts of your profile you choose to share (e.g. first name, suburb, interests, avatar).</Bullet>
          <Bullet c={c} scale={scale}>Service providers that help us run the app (e.g. cloud hosting, email delivery). They handle data on our behalf under strict contracts and never use it for their own purposes.</Bullet>
          <Bullet c={c} scale={scale}>Law-enforcement, if we are legally required, or to protect the safety of our community.</Bullet>
        </Section>

        <Section title="Your choices and rights" c={c} scale={scale}>
          <Bullet c={c} scale={scale}><Text style={styles.b}>Edit your profile</Text> at any time from Profile → Edit Profile.</Bullet>
          <Bullet c={c} scale={scale}><Text style={styles.b}>Block or report</Text> any member from their profile page.</Bullet>
          <Bullet c={c} scale={scale}><Text style={styles.b}>Delete your account</Text> at any time from Settings → Delete Account. This permanently removes your profile, messages, posts and friend connections. Group posts are anonymised so threads stay coherent for other members.</Bullet>
          <Bullet c={c} scale={scale}>You can ask us for a copy of the data we hold about you, or ask us to correct it, by writing to {CONTACT_EMAIL}.</Bullet>
        </Section>

        <Section title="Children" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            FriendPlace is not designed for children under 13 and we do not knowingly
            collect data from them. If you believe a child has signed up, please
            contact us and we will remove the account.
          </Text>
        </Section>

        <Section title="Keeping your data safe" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            We use industry-standard encryption in transit and at rest, restrict
            staff access to a need-to-know basis, and review our security
            controls regularly. No system is 100% secure — please choose a strong
            password and tell us if you spot anything unusual.
          </Text>
        </Section>

        <Section title="Changes to this policy" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            We may update this policy from time to time. When we do we will
            update the date above and, for significant changes, let you know
            in the app. Continuing to use FriendPlace after a change means you
            accept the updated policy.
          </Text>
        </Section>

        <Section title="Contact us" c={c} scale={scale}>
          <Text style={[styles.body, { color: c.onSurface, fontSize: 16 * scale }]}>
            Questions or concerns? Email <Text style={styles.b}>{CONTACT_EMAIL}</Text>.
            We aim to respond within 7 days.
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
