import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, Animated, Easing } from "react-native";
import { useTheme } from "./theme";

type Toast = { id: number; text: string };
type Ctx = { show: (text: string) => void };
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const { c, scale } = useTheme();

  const show = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(anim, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast(null));
    }, 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          testID="toast"
          style={[
            styles.toastWrap,
            {
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            },
          ]}
        >
          <View style={[styles.toast, { backgroundColor: c.surfaceInverse }]}>
            <Text style={[styles.text, { color: c.onSurfaceInverse, fontSize: 16 * scale }]}>{toast.text}</Text>
          </View>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: 120, alignItems: "center", zIndex: 9999 },
  toast: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, maxWidth: "85%" },
  text: { fontWeight: "600", textAlign: "center" },
});
