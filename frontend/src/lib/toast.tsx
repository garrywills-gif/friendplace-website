import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, Animated, Easing, Modal, Pressable } from "react-native";
import { useTheme } from "./theme";

type Toast = { id: number; text: string };

type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};
type ConfirmState = ConfirmOpts & { resolve: (ok: boolean) => void };

type Ctx = {
  show: (text: string) => void;
  /** Cross-platform confirm dialog. Returns a promise that resolves to true (confirm) or false (cancel). */
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
};
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const { c, scale } = useTheme();

  const show = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const confirm = useCallback((opts: ConfirmOpts): Promise<boolean> => {
    return new Promise((resolve) => setConfirmState({ ...opts, resolve }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    Animated.timing(anim, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast(null));
    }, 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const closeConfirm = (ok: boolean) => {
    if (!confirmState) return;
    const r = confirmState.resolve;
    setConfirmState(null);
    r(ok);
  };

  return (
    <ToastCtx.Provider value={{ show, confirm }}>
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
      <Modal visible={!!confirmState} transparent animationType="fade" onRequestClose={() => closeConfirm(false)}>
        <Pressable testID="confirm-backdrop" style={styles.confirmBackdrop} onPress={() => closeConfirm(false)}>
          <Pressable style={[styles.confirmCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={{ color: c.onSurface, fontWeight: "900", fontSize: 20 * scale, marginBottom: 6 }}>{confirmState?.title}</Text>
            {!!confirmState?.message && (
              <Text style={{ color: c.muted, fontSize: 15 * scale, lineHeight: 22, marginBottom: 14 }}>{confirmState.message}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                testID="confirm-cancel"
                onPress={() => closeConfirm(false)}
                style={[styles.confirmBtn, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
              >
                <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 16 * scale }}>{confirmState?.cancelLabel || "Cancel"}</Text>
              </Pressable>
              <Pressable
                testID="confirm-ok"
                onPress={() => closeConfirm(true)}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: confirmState?.destructive ? c.error : c.brand, borderColor: confirmState?.destructive ? c.error : c.brand },
                ]}
              >
                <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 * scale }}>{confirmState?.confirmLabel || "Confirm"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  confirmCard: { width: "100%", maxWidth: 380, padding: 20, borderRadius: 20, borderWidth: 1 },
  confirmBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 999, borderWidth: 1.5 },
});
