/**
 * GeorgeGlobalHost — the single mount point for FriendPlace's George
 * butterfly (C1 Slice 3, locked with Garry 22 July 2026).
 *
 * Renders `<GeorgeButterfly />` at the root of the app so it lives on
 * every member screen — Home, Coffee Lounge, Friends, Events, Groups,
 * Notice Board, Games, Recipes, Profile, Chats, Settings, Help, and any
 * secondary pages under those.
 *
 * Hides itself on:
 *   - `/`                (landing / splash)
 *   - `/auth/*`          (login, signup, forgot, reset, welcome)
 *   - `/onboarding`      (dedicated onboarding conversation flow)
 *   - `/waitlist`        (pre-invite waiting room)
 *   - When there is no authenticated user (belt-and-braces).
 *
 * The visibility rules live in `george-context.tsx` via the
 * `butterflyVisible` derived flag; this component simply respects it.
 */
import React from 'react';
import { GeorgeButterfly } from './GeorgeButterfly';
import { useGeorge } from '@/src/lib/george-context';
import { useAuth } from '@/src/lib/auth';

export default function GeorgeGlobalHost() {
  const { butterflyVisible } = useGeorge();
  const { user } = useAuth();

  // Only ever show the butterfly to an authenticated FriendPlace member.
  // The visibility flag from the context handles route-level hiding.
  if (!user || !butterflyVisible) return null;

  return <GeorgeButterfly />;
}
