import React from "react";
import { Redirect } from "expo-router";

/**
 * Legacy `/messages` route → forwards to the new Chats bottom tab.
 *
 * Kept only so any pre-existing deep links (push notifications,
 * `router.push('/messages')` calls that we may have missed) don't
 * dead-end. The new source of truth is `/app/(tabs)/chats.tsx`.
 */
export default function LegacyMessages() {
  return <Redirect href="/chats" />;
}
