import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, setAuthToken, registerUnauthorizedHandler } from "./api";
import { registerForPush } from "./push";

export type User = {
  id: string;
  first_name: string;
  username: string;
  email?: string;
  suburb: string;
  interests: string[];
  avatar: string;
  bio: string;
  points: number;
  badges: string[];
  friends: string[];
  blocked: string[];
  is_demo?: boolean;
  is_admin?: boolean;
  onboarding_completed?: boolean;
  favourite_games?: string[];
  birthday?: string;
  privacy_settings?: { profile_visibility: string; friend_requests: string; show_in_find_friends: boolean };
  restricted?: boolean;
  banned?: boolean;
};

type SignupBody = {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
  suburb?: string;
  suburb_postcode?: string;
  suburb_state?: string;
  location_visibility?: "suburb" | "private";
  interests?: string[];
  avatar?: string;
  birthday?: string;
};

type Ctx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signup: (b: SignupBody) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  loginWithGoogle: (session_id: string, referrer_id?: string | null) => Promise<{ isNew: boolean }>;
  loginWithApple: (identity_token: string, authorization_code?: string | null, first_name?: string | null, last_name?: string | null, referrer_id?: string | null) => Promise<{ isNew: boolean }>;
  demoLogin: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);
// Storage keys. Kept as `yb_*` so users upgrading from earlier builds
// don't get silently logged out on the next launch after the rebrand —
// their saved token/user survives untouched. New signups write to the
// same keys. If we ever want to migrate off these, we'll do it with a
// one-time copy step, not a rename here.
const USER_KEY = "yb_user";
const TOKEN_KEY = "yb_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) setLoading(false); }, 2500);
    (async () => {
      try {
        const [rawU, rawT] = await Promise.all([
          AsyncStorage.getItem(USER_KEY),
          AsyncStorage.getItem(TOKEN_KEY),
        ]);
        if (rawU) try { setUser(JSON.parse(rawU) as User); } catch {}
        if (rawT) setToken(rawT);
        // Sync into api.ts cache so cold-start requests are authed.
        setAuthToken(rawT || null);
      } catch {}
      if (!cancelled) setLoading(false);
      clearTimeout(t);
    })();
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Session-expired reset: when api.ts detects a 401 from a protected
  // endpoint it fires this handler. We clear the stored token + user so
  // the next `/home` guard bounces the user back to /auth/login instead
  // of leaving them stranded on repeated "Failed to load" toasts.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      (async () => {
        try {
          await AsyncStorage.removeItem(USER_KEY);
          await AsyncStorage.removeItem(TOKEN_KEY);
        } catch { /* no-op */ }
        setUser(null);
        setToken(null);
        setAuthToken(null);
      })();
    });
    return () => { registerUnauthorizedHandler(null); };
  }, []);

  const persist = async (u: User | null, tok: string | null) => {
    setUser(u);
    setToken(tok);
    // Push the token into api.ts's in-memory cache so every subsequent
    // fetch attaches the Authorization header without an AsyncStorage
    // round-trip. Also keeps the cache in sync on logout.
    setAuthToken(tok);
    try {
      if (u) await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
      else await AsyncStorage.removeItem(USER_KEY);
      if (tok) await AsyncStorage.setItem(TOKEN_KEY, tok);
      else await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {}
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        token,
        loading,
        signup: async (b) => {
          const r: any = await api.signup(b);
          await persist(r.user as User, r.access_token as string);
          registerForPush(r.user?.id).catch(() => {});
        },
        login: async (identifier, password) => {
          const r: any = await api.login(identifier, password);
          await persist(r.user as User, r.access_token as string);
          registerForPush(r.user?.id).catch(() => {});
        },
        loginWithGoogle: async (session_id, referrer_id) => {
          const r: any = await api.googleAuth(session_id, referrer_id || null);
          await persist(r.user as User, r.access_token as string);
          registerForPush(r.user?.id).catch(() => {});
          return { isNew: !!r.is_new };
        },
        loginWithApple: async (identity_token, authorization_code, first_name, last_name, referrer_id) => {
          const r: any = await api.appleAuth(identity_token, authorization_code || null, first_name || null, last_name || null, referrer_id || null);
          await persist(r.user as User, r.access_token as string);
          registerForPush(r.user?.id).catch(() => {});
          return { isNew: !!r.is_new };
        },
        demoLogin: async (username) => {
          const r: any = await api.demoLogin(username);
          await persist(r.user as User, r.access_token as string);
          registerForPush(r.user?.id).catch(() => {});
        },
        logout: async () => { await persist(null, null); },
        refresh: async () => {
          if (!user) return;
          try {
            // Silent variant — a background focus refresh must NEVER nuke
            // the local session on a transient 401, otherwise tabs like
            // Profile flicker on then bounce back to Home. If the token is
            // really dead the user's next explicit action (send message,
            // rsvp, etc.) will hit the standard 401 path and log them out
            // cleanly then.
            const u = await api.getUserSilent(user.id);
            setUser(u as User);
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
          } catch {}
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
