import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePrefs = {
  largeText: boolean;
  highContrast: boolean;
};

const DEFAULT: ThemePrefs = { largeText: false, highContrast: false };

type Ctx = {
  prefs: ThemePrefs;
  setPref: (k: keyof ThemePrefs, v: boolean) => void;
  c: typeof palette.normal;
  scale: number; // font scale multiplier
};

const palette = {
  normal: {
    surface: "#F8FAFC",
    onSurface: "#0F172A",
    surfaceSecondary: "#FFFFFF",
    onSurfaceSecondary: "#1E293B",
    surfaceTertiary: "#F1F5F9",
    onSurfaceTertiary: "#334155",
    surfaceInverse: "#0F172A",
    onSurfaceInverse: "#F8FAFC",
    brand: "#0F766E",
    brandPrimary: "#0F766E",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#0369A1",
    onBrandSecondary: "#FFFFFF",
    brandTertiary: "#CCFBF1",
    onBrandTertiary: "#0F766E",
    accent: "#0EA5E9",
    success: "#15803D",
    warning: "#B45309",
    error: "#B91C1C",
    info: "#0369A1",
    border: "#E2E8F0",
    borderStrong: "#94A3B8",
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
    brand: "#003D7A",
    brandPrimary: "#003D7A",
    onBrandPrimary: "#FFFFFF",
    brandSecondary: "#001F3F",
    onBrandSecondary: "#FFFFFF",
    brandTertiary: "#E6F0FF",
    onBrandTertiary: "#001F3F",
    accent: "#003D7A",
    success: "#004D00",
    warning: "#7A3D00",
    error: "#7A0000",
    info: "#001F3F",
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

  const value = useMemo<Ctx>(() => ({
    prefs,
    setPref,
    c: prefs.highContrast ? palette.high : palette.normal,
    scale: prefs.largeText ? 1.2 : 1,
  }), [prefs]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}

export const radius = { sm: 8, md: 16, lg: 24, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
