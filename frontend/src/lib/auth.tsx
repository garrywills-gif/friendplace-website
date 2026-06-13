import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

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
};

type SignupBody = {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
  suburb?: string;
  interests?: string[];
  avatar?: string;
};

type Ctx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signup: (b: SignupBody) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
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
        },
        login: async (identifier, password) => {
          const r: any = await api.login(identifier, password);
          await persist(r.user as User, r.access_token as string);
        },
        demoLogin: async (username) => {
          const r: any = await api.demoLogin(username);
          await persist(r.user as User, r.access_token as string);
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
