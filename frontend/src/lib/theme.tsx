import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePrefs = {
  /** Larger text for older eyes. Scales fonts ~20%. */
  largeText: boolean;
  /** Higher contrast palette for low vision. */
  highContrast: boolean;
  /** Simplified mode — larger buttons, more padding, less clutter. */
  simplified: boolean;
  /** Show the speaker (read-aloud) icon beside messages, notices, events, thoughts. */
  readMessagesAloud: boolean;
  /** Auto-speak new incoming direct messages as they arrive. */
  autoReadNewMessages: boolean;
  /** Show the mic (voice-to-text) icon in message compose boxes. */
  voiceInputEnabled: boolean;
};

const DEFAULT: ThemePrefs = {
  largeText: false,
  highContrast: false,
  simplified: false,
  readMessagesAloud: true,
  autoReadNewMessages: false,
  voiceInputEnabled: false,
};

type Ctx = {
  prefs: ThemePrefs;
  setPref: (k: keyof ThemePrefs, v: boolean) => void;
  c: typeof palette.normal;
  scale: number;
  /** Multiplier used by Simplified mode for button heights / paddings. */
  size: number;
};

const palette = {
  normal: {
    surface: "#F8FAFC",
    onSurface: "#0D2A57",
    surfaceSecondary: "#FFFFFF",
    onSurfaceSecondary: "#1E3A7F",
    surfaceTertiary: "#F1F5F9",
    onSurfaceTertiary: "#1E3A7F",
    surfaceInverse: "#0D2A57",
    onSurfaceInverse: "#F8FAFC",
    brand: "#1E3A7F",
    brandPrimary: "#1E3A7F",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#2E9EE2",
    onBrandSecondary: "#FFFFFF",
    brandTertiary: "#E0F2FE",
    onBrandTertiary: "#1E3A7F",
    accent: "#2DD4BF",
    success: "#16A34A",
    warning: "#B45309",
    error: "#B91C1C",
    info: "#2E9EE2",
    border: "#CBD5E1",
    borderStrong: "#64748B",
    muted: "#64748B",
  },
  high: {
    surface: "#FFFFFF",
    onSurface: "#000000",
    surfaceSecondary: "#FFFFFF",
    onSurfaceSecondary: "#000000",
    surfaceTertiary: "#F1F5F9",
    onSurfaceTertiary: "#000000",
    surfaceInverse: "#000000",
    onSurfaceInverse: "#FFFFFF",
    brand: "#0D2A57",
    brandPrimary: "#0D2A57",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#0B5A9E",
    onBrandSecondary: "#FFFFFF",
    brandTertiary: "#DBEAFE",
    onBrandTertiary: "#0D2A57",
    accent: "#0F766E",
    success: "#004D00",
    warning: "#7A3D00",
    error: "#7A0000",
    info: "#0B5A9E",
    border: "#000000",
    borderStrong: "#000000",
    muted: "#1E293B",
  },
};

const ThemeCtx = createContext<Ctx | null>(null);
const KEY = "yb_theme_prefs";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(DEFAULT);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      if (raw) {
        try { setPrefs({ ...DEFAULT, ...JSON.parse(raw) }); } catch {}
      }
    });
  }, []);

  const setPref = (k: keyof ThemePrefs, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  };

  const value = useMemo<Ctx>(() => {
    const baseScale = prefs.largeText ? 1.2 : 1;
    const simplifiedScale = prefs.simplified ? 1.1 : 1;
    return {
      prefs,
      setPref,
      c: prefs.highContrast ? palette.high : palette.normal,
      scale: baseScale * simplifiedScale,
      size: prefs.simplified ? 1.15 : 1,
    };
  }, [prefs]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}

export const radius = { sm: 8, md: 16, lg: 24, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
