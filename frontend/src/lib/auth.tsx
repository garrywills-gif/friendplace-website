import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

export type User = {
  id: string;
  first_name: string;
  username: string;
  suburb: string;
  interests: string[];
  avatar: string;
  bio: string;
  points: number;
  badges: string[];
  friends: string[];
  blocked: string[];
};

type Ctx = {
  user: User | null;
  loading: boolean;
  signup: (b: { first_name: string; username: string; suburb?: string; interests?: string[]; avatar?: string }) => Promise<void>;
  login: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);
const KEY = "yb_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) setLoading(false); }, 2500); // hard fallback so UI never hangs
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          try { setUser(JSON.parse(raw) as User); } catch {}
        }
      } catch {}
      if (!cancelled) setLoading(false);
      clearTimeout(t);
    })();
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  const persist = async (u: User | null) => {
    setUser(u);
    try {
      if (u) await AsyncStorage.setItem(KEY, JSON.stringify(u));
      else await AsyncStorage.removeItem(KEY);
    } catch {}
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        signup: async (b) => {
          const u = await api.signup(b);
          await persist(u);
        },
        login: async (username) => {
          const u = await api.login(username);
          await persist(u);
        },
        logout: async () => { await persist(null); },
        refresh: async () => {
          if (!user) return;
          try {
            const u = await api.getUser(user.id);
            await persist(u);
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
