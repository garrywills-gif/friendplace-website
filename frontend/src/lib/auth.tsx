import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
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
      } catch {}
      if (!cancelled) setLoading(false);
      clearTimeout(t);
    })();
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  const persist = async (u: User | null, tok: string | null) => {
    setUser(u);
    setToken(tok);
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
            const u = await api.getUser(user.id);
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
