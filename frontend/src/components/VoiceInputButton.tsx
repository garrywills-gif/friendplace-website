/**
 * VoiceInputButton — tap-to-dictate microphone control for FriendPlace.
 *
 * WHY THIS EXISTS:
 *   Our audience skews older, and on a small phone keyboard typing is
 *   often the single biggest barrier to using the app. Adding a mic
 *   button next to every text input lets people speak instead — and the
 *   whisper-1 transcription that comes back on the wire drops straight
 *   into the same input field, so no other UX changes are needed.
 *
 * INTERACTION MODEL:
 *   1. IDLE   → mic icon. Tap to start recording.
 *   2. ARMING → we ask for the microphone permission (respecting the
 *               <handle_permissions_contract>: pre-permission rationale,
 *               forgiving of denials, "Open Settings" fallback on hard
 *               block). Once granted, we start capturing.
 *   3. RECORD → pulsing red dot + running mm:ss timer + waveform hint.
 *               Tap again to stop. Auto-stops at 60s.
 *   4. SEND   → activity indicator while we POST the m4a to
 *               /api/voice/transcribe.
 *   5. DONE   → text is appended to the parent's input value, we play a
 *               short haptic, and we snap back to IDLE.
 *
 * WHY TAP-TO-TOGGLE (not press-and-hold):
 *   Press-and-hold works great for walkie-talkie apps but is terrible
 *   for older users with reduced hand mobility — losing your finger
 *   grip mid-thought kills the recording. Tap-to-start, tap-to-stop is
 *   forgiving, familiar (matches iMessage's dictate button), and lets
 *   users glance at the screen while thinking.
 *
 * USAGE:
 *   <VoiceInputButton
 *     value={text}
 *     onChangeText={setText}
 *   />
 *
 *   Optional props:
 *     userId — passed to the backend so the endpoint can auth-check the
 *              caller and rate-limit misuse.
 *     appendMode — "append" (default) glues the transcription onto the
 *              existing input value with a leading space; "replace"
 *              wipes what's there first.
 *     onError — callback for the parent to show a toast when Whisper
 *              fails. Falls back to Alert if not provided.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Linking,
  Animated,
  Easing,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { useTheme } from "@/src/lib/theme";

// Hard cap so users don't accidentally leave the mic recording for a
// half-hour and get a 25 MB rejection at the backend. Chosen at 60s
// because most voice notes in the wild are 5-20s (see WhatsApp / iMessage
// telemetry); 60s is generous headroom.
const MAX_RECORD_SEC = 60;

type Props = {
  value: string;
  onChangeText: (next: string) => void;
  userId?: string;
  appendMode?: "append" | "replace";
  onError?: (msg: string) => void;
  /** Optional size override (defaults 44). Kept at 44 minimum to satisfy
   * the iOS HIG touch-target guideline for older users. */
  size?: number;
  /** Optional test ID for e2e. */
  testID?: string;
};

// TestFlight round-2 feedback (Garry, 28 July 2026): the previous
// `(process.env as any).EXPO_PUBLIC_BACKEND_URL` reference prevented
// Metro/Babel from statically inlining the value on native builds, so
// physical devices ended up POSTing to a relative `/api/voice/...`
// URL and native `fetch` rejected it as `Invalid URL`. Reference the
// env vars WITHOUT the `as any` cast so Metro's transform can replace
// them at bundle time.
const BACKEND_URL: string =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  process.env.EXPO_BACKEND_URL ||
  "";

export default function VoiceInputButton({
  value,
  onChangeText,
  userId,
  appendMode = "append",
  onError,
  size = 44,
  testID,
}: Props) {
  const { c } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [showRationale, setShowRationale] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pulse animation for the red recording dot — a slow 1.4s in-out
  // cycle. Native driver so the animation stays smooth even when the
  // JS thread is busy uploading.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state !== "recording") {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  const clearTimers = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  // ─── Kickoff ─────────────────────────────────────────────────────────
  const beginCapture = useCallback(async () => {
    try {
      // TestFlight round-4 (Garry, 29 July 2026): the "Empty audio
      // upload" issue on iOS is almost always an audio-session /
      // recorder-lifecycle problem. Steps to make recording bulletproof:
      //   1. Configure the session for recording (playsInSilentMode +
      //      allowsRecording) BEFORE preparing the recorder.
      //   2. Await `prepareToRecordAsync` fully — this both allocates
      //      the file and initialises the AVAudioSession category.
      //   3. Give iOS a short (~150ms) breath before `record()` starts
      //      so the underlying `AVAudioRecorder.record` call actually
      //      begins writing samples. Without this, `record()` can
      //      return immediately with the underlying encoder still
      //      warming up, producing an empty file when stopped quickly.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      await new Promise((r) => setTimeout(r, 150));
      recorder.record();
      // Guard against silent failures: if the recorder didn't actually
      // start, bail out with a friendly message rather than record 0
      // bytes and confuse the member.
      if (recorder.isRecording === false) {
        throw new Error("recorder failed to start");
      }
      setState("recording");
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      autoStopRef.current = setTimeout(() => {
        // Auto-stop respects the 60s cap. We call the same stop path so
        // the transcription pipeline runs identically to a manual stop.
        void stopAndTranscribe();
      }, MAX_RECORD_SEC * 1000);
    } catch (e: any) {
      if (__DEV__) console.warn('[VoiceInputButton] beginCapture failed:', e);
      onError?.("Sorry, I couldn't start recording. Please try again in a moment.");
      setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, onError]);

  // ─── Permission gate ─────────────────────────────────────────────────
  const handleMicPress = useCallback(async () => {
    if (state === "recording") return void stopAndTranscribe();
    if (state === "transcribing") return; // ignore while uploading

    // Fast path: already granted → just go.
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return beginCapture();
    if (!current.canAskAgain) {
      setShowBlocked(true);
      return;
    }
    // First-time (or "denied but can ask again"): show our rationale so
    // the user knows WHY we're about to prompt them. This is per the
    // FriendPlace permission contract — never fire the native prompt
    // without a plain-English "here's why".
    setShowRationale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, beginCapture]);

  const acceptRationaleAndRequest = useCallback(async () => {
    setShowRationale(false);
    const r = await requestRecordingPermissionsAsync();
    if (!r.granted) {
      if (!r.canAskAgain) setShowBlocked(true);
      return;
    }
    await beginCapture();
  }, [beginCapture]);

  // ─── Stop + upload ───────────────────────────────────────────────────
  const stopAndTranscribe = useCallback(async () => {
    clearTimers();
    let audioUri: string | null = null;
    try {
      await recorder.stop();
      // TestFlight round-3 (Garry, 29 July 2026 #16): on iOS the file
      // sometimes isn't flushed to disk before `recorder.uri` is read,
      // producing a 0-byte blob that the backend correctly rejects as
      // "Empty audio upload". Give the OS a moment to finalise the
      // container before we grab the URI.
      await new Promise((r) => setTimeout(r, 250));
      audioUri = recorder.uri;
    } catch (e: any) {
      onError?.("Sorry, I couldn't hear anything. Please try again.");
      if (__DEV__) console.warn('[VoiceInputButton] recorder.stop failed:', e);
      setState("idle");
      return;
    }
    if (!audioUri) {
      onError?.("Sorry, I couldn't hear anything. Please try again.");
      setState("idle");
      return;
    }
    setState("transcribing");
    try {
      const url = `${BACKEND_URL}/api/voice/transcribe${
        userId ? `?user_id=${encodeURIComponent(userId)}&language=en` : "?language=en"
      }`;
      const form = new FormData();
      // Cross-platform file upload: on web, React Native's shortcut
      // `{ uri, name, type }` FormData object gets stringified to
      // "[object Object]" (backend then rejects with a 422 "expected
      // UploadFile, received str"). On iOS/Android the shortcut works
      // but so does the Blob path. Fetching the local file:// URI and
      // appending the resulting Blob is the ONE approach that works on
      // every runtime we ship on — web preview, Expo Go, native dev
      // build, and TestFlight — so we use it unconditionally.
      const audioResp = await fetch(audioUri);
      const audioBlob = await audioResp.blob();
      // Round-3 (#16): guard against empty payloads — surfaces a
      // friendly message rather than the raw backend error text.
      if (!audioBlob || audioBlob.size < 500) {
        if (__DEV__) console.warn('[VoiceInputButton] empty/short blob:', audioBlob?.size);
        onError?.("Sorry, I couldn't hear anything. Please try again.");
        setState("idle");
        setElapsed(0);
        return;
      }
      // Some Safari versions strip the type from a file:// blob — fill
      // it in explicitly so multipart correctly labels the payload.
      const typedBlob =
        audioBlob.type && audioBlob.type !== ""
          ? audioBlob
          : new Blob([audioBlob], { type: "audio/m4a" });
      form.append("audio", typedBlob, "voice.m4a");
      const resp = await fetch(url, { method: "POST", body: form });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        if (__DEV__) console.warn('[VoiceInputButton] transcribe error:', resp.status, errBody);
        // Never surface raw backend JSON to members. Map to a warm
        // sentence and let __DEV__ logs surface the technical detail.
        throw new Error(
          resp.status === 401 || resp.status === 403
            ? "You'll need to sign in again to use voice input."
            : "Sorry, I couldn't hear you clearly. Please try again."
        );
      }
      const data = await resp.json();
      const transcript = String(data?.text || "").trim();
      if (transcript) {
        // Compose the new value based on appendMode. Append is the
        // safe default — the user may have already typed something.
        // We insert a leading space if there's existing text so we
        // don't fuse "hello" + "world" into "helloworld".
        const next =
          appendMode === "replace"
            ? transcript
            : value && value.trim().length
              ? `${value.trimEnd()} ${transcript}`
              : transcript;
        onChangeText(next);
      } else {
        onError?.("Sorry, I couldn't hear anything. Please try again.");
      }
    } catch (e: any) {
      // Never leak raw JSON like `{"detail":"Empty audio upload"}` to
      // members — always show a friendly, actionable line.
      const msg = e?.message && !e.message.startsWith('{')
        ? e.message
        : "Sorry, I couldn't hear anything. Please try again.";
      onError?.(msg);
    } finally {
      setState("idle");
      setElapsed(0);
    }
  }, [recorder, userId, value, onChangeText, appendMode, onError]);

  // ─── Rendering ───────────────────────────────────────────────────────
  const isRecording = state === "recording";
  const isBusy = state === "transcribing";
  const bg = isRecording ? "#EF4444" : c.surfaceSecondary;
  const iconColor = isRecording ? "#FFFFFF" : c.brand;

  return (
    <>
      <Pressable
        testID={testID}
        onPress={handleMicPress}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={
          isRecording
            ? "Stop recording and transcribe"
            : isBusy
              ? "Transcribing…"
              : "Speak to dictate a message"
        }
        style={({ pressed }) => [
          styles.btn,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            borderColor: isRecording ? "#EF4444" : c.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        hitSlop={6}
      >
        {isBusy ? (
          <ActivityIndicator size="small" color={c.brand} />
        ) : isRecording ? (
          <View style={{ alignItems: "center" }}>
            <Animated.View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: "#FFFFFF",
                opacity: pulse,
              }}
            />
            <Text style={styles.recTime}>
              {String(Math.floor(elapsed / 60)).padStart(1, "0")}:{String(elapsed % 60).padStart(2, "0")}
            </Text>
          </View>
        ) : (
          <Ionicons name="mic" size={22} color={iconColor} />
        )}
      </Pressable>

      {/* Pre-permission rationale — plain English, mic-relevant. */}
      <Modal
        visible={showRationale}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRationale(false)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 44 }}>🎤</Text>
            <Text style={[styles.modalTitle, { color: c.onSurface }]}>
              Speak instead of type
            </Text>
            <Text style={[styles.modalBody, { color: c.muted }]}>
              FriendPlace can turn your voice into text so you don&apos;t have to
              type. We&apos;ll ask for microphone access — audio is transcribed
              once and never stored.
            </Text>
            <Pressable
              testID="voice-allow-mic"
              onPress={acceptRationaleAndRequest}
              style={[styles.modalPrimary, { backgroundColor: c.brand }]}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>
                Enable microphone
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowRationale(false)}
              style={[styles.modalSecondary, { borderColor: c.border }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 }}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Hard block — user hit "Don't Allow" enough times that we can no
          longer ask. Send them to Settings so they can re-enable. */}
      <Modal
        visible={showBlocked}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBlocked(false)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 44 }}>🔒</Text>
            <Text style={[styles.modalTitle, { color: c.onSurface }]}>
              Microphone is turned off
            </Text>
            <Text style={[styles.modalBody, { color: c.muted }]}>
              To use voice input, open Settings and allow FriendPlace to use
              your microphone. You can still type as normal.
            </Text>
            <Pressable
              onPress={() => Linking.openSettings()}
              style={[styles.modalPrimary, { backgroundColor: c.brand }]}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>
                Open Settings
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowBlocked(false)}
              style={[styles.modalSecondary, { borderColor: c.border }]}
            >
              <Text style={{ color: c.onSurface, fontWeight: "800", fontSize: 15 }}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  recTime: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    gap: 8,
  },
  modalTitle: { fontSize: 20, fontWeight: "900", marginTop: 6, textAlign: "center" },
  modalBody: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 4 },
  modalPrimary: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 999,
    minWidth: 220,
    alignItems: "center",
  },
  modalSecondary: {
    marginTop: 10,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    minWidth: 220,
    alignItems: "center",
  },
});
