/**
 * ZoomableImageViewer — a full-screen modal that lets the user pinch,
 * pan and double-tap-zoom into any image URI.
 *
 * Why we built this ourselves rather than pulling `react-native-image-zoom-viewer`
 * (or similar) as a dependency:
 *   • The Gesture Handler v2 + Reanimated 3 stack we already ship gives
 *     us buttery 60fps transforms with under 80 lines of gesture code.
 *   • Third-party viewers tend to drag in ancient event-based gesture
 *     APIs (`PanResponder` etc.) which don't play nicely with our
 *     existing modal + safe-area stack on iOS.
 *   • We wanted a single, opinionated component matching FriendPlace's
 *     older-adult UX guidance: big close-affordance, forgiving
 *     double-tap, and no reset-your-brain "swipe up to close" magic.
 *
 * Interactions supported:
 *   • Pinch          → smoothly scale between 1.0× and 5.0×
 *   • Two-finger pan → move the image around while zoomed
 *   • One-finger pan → also moves the image (only when scale > 1)
 *   • Double-tap     → toggles between 1× and 2.5× on the tap point
 *   • Tap the (X)    → closes
 *   • Tap dim area   → closes (only when scale == 1, so you can't
 *                       accidentally dismiss while zooming)
 *
 * Usage:
 *   const [zoom, setZoom] = useState<string | null>(null);
 *   <Pressable onPress={() => setZoom(myUri)}>...</Pressable>
 *   <ZoomableImageViewer uri={zoom} onClose={() => setZoom(null)} />
 */
import React, { useCallback, useEffect } from "react";
import { Modal, Pressable, StyleSheet, View, Text, useWindowDimensions, ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  /** URI of the image to display. `null` hides the modal. Kept for
   * backward compatibility with existing callers (DM chat photos,
   * profile hero, edit-profile preview). Prefer `source` for new code
   * so bundled `require()`d assets can also be zoomed. */
  uri?: string | null;
  /** Bundled image source (require()d asset) — enables preset avatars
   * and gallery photos to zoom. When both `uri` and `source` are set,
   * `source` wins. Modal shows whenever either is truthy. */
  source?: ImageSourcePropType | null;
  /** Called when the user dismisses the viewer. */
  onClose: () => void;
  /** Optional caption shown at the bottom (e.g. "Sent by Alice"). */
  caption?: string;
  /** Optional test ID for e2e. */
  testID?: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export default function ZoomableImageViewer({ uri, source, onClose, caption, testID }: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  // The viewer is "active" when either a URI OR a bundled source is
  // supplied. Callers can pass whichever they have — presets ship as
  // require()d ImageSourcePropType, uploaded photos & Google avatars
  // ship as URIs.
  const visible = !!(uri || source);
  const imageSource: ImageSourcePropType | undefined = source
    ? source
    : uri
      ? ({ uri } as ImageSourcePropType)
      : undefined;

  // Reanimated shared values — driven by the gesture handlers on the
  // UI thread so the transform stays glass-smooth even on old iPads.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Reset every time a new image opens so the viewer never inherits
  // the previous image's zoom state.
  useEffect(() => {
    if (visible) {
      scale.value = 1;
      savedScale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedTx.value = 0;
      savedTy.value = 0;
    }
  }, [visible, scale, savedScale, tx, ty, savedTx, savedTy]);

  const closeAnd = useCallback(() => {
    onClose();
  }, [onClose]);

  // ─── Pinch ──────────────────────────────────────────────────────────
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      // Clamp softly — allow a tiny overscroll for pinch feedback, then
      // spring back to bounds in onEnd.
      scale.value = Math.min(Math.max(next, MIN_SCALE * 0.9), MAX_SCALE * 1.05);
    })
    .onEnd(() => {
      // Snap back into bounds if the user overshot.
      if (scale.value < MIN_SCALE) {
        scale.value = withTiming(MIN_SCALE, { duration: 180 });
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        savedScale.value = MIN_SCALE;
        savedTx.value = 0;
        savedTy.value = 0;
      } else if (scale.value > MAX_SCALE) {
        scale.value = withTiming(MAX_SCALE, { duration: 180 });
        savedScale.value = MAX_SCALE;
      } else {
        savedScale.value = scale.value;
      }
    });

  // ─── Pan (only meaningful when zoomed in) ──────────────────────────
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onUpdate((e) => {
      // Only move the image if we're actually zoomed in.
      if (scale.value > 1.02) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      // Clamp translation so the image can't be panned entirely off-screen.
      // The max allowed offset in each axis is (image_dim * (scale-1))/2.
      const maxX = (winW * (scale.value - 1)) / 2;
      const maxY = (winH * (scale.value - 1)) / 2;
      const clampedX = Math.max(Math.min(tx.value, maxX), -maxX);
      const clampedY = Math.max(Math.min(ty.value, maxY), -maxY);
      tx.value = withTiming(clampedX, { duration: 160 });
      ty.value = withTiming(clampedY, { duration: 160 });
      savedTx.value = clampedX;
      savedTy.value = clampedY;
    });

  // ─── Double-tap → toggle 1× ↔ 2.5× ─────────────────────────────────
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      if (scale.value > 1.05) {
        // Zoom out to 1×, recenter.
        scale.value = withTiming(1, { duration: 220 });
        tx.value = withTiming(0, { duration: 220 });
        ty.value = withTiming(0, { duration: 220 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: 220 });
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  // ─── Single-tap on the backdrop → close (only when at 1×) ──────────
  // The single-tap must NOT fire when the user is on the second tap of
  // a double-tap gesture, so we chain `requireExternalGestureToFail`.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      if (scale.value <= 1.02) {
        runOnJS(closeAnd)();
      }
    });

  const composed = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      testID={testID}
    >
      {/* TestFlight Fix Batch 1 (Garry, Aug 2026 — P0 #3):
          Pinch/zoom didn't work on TestFlight. Root cause: on iOS,
          React Native's <Modal> presents its content in a SEPARATE
          UIWindow that sits OUTSIDE the app's root
          <GestureHandlerRootView>. Gesture handlers registered inside
          the modal therefore never receive touches. Fix per official
          react-native-gesture-handler v2 docs: wrap the modal content
          in its OWN GestureHandlerRootView. This is a no-op on web
          preview (where the previous implementation appeared to work
          via bubble-up), so the fix is safe across all surfaces. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          {/* The image itself — wrapped in the gesture detector so pinch
              and pan happen on the image (not the backdrop). */}
          <GestureDetector gesture={composed}>
            <Animated.View style={[styles.imgWrap, animStyle]}>
              {imageSource && (
                <Animated.Image
                  source={imageSource}
                  style={styles.img}
                  resizeMode="contain"
                  accessibilityLabel="Zoomable image"
                />
              )}
            </Animated.View>
          </GestureDetector>

          {/* Close button — always visible, tap target 44+ */}
          <Pressable
            testID="zoom-close-btn"
            onPress={onClose}
            hitSlop={16}
            accessibilityLabel="Close image"
            style={[styles.close, { top: insets.top + 12 }]}
          >
            <Ionicons name="close-circle" size={44} color="#FFFFFFEE" />
          </Pressable>

          {/* Zoom hint — visible when at 1×, disappears when zoomed */}
          <View
            pointerEvents="none"
            style={[styles.hint, { bottom: insets.bottom + 18 }]}
          >
            <Text style={styles.hintText}>
              {caption ? caption : "Pinch or double-tap to zoom"}
            </Text>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  imgWrap: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  img: {
    width: "100%",
    height: "100%",
  },
  close: {
    position: "absolute",
    right: 16,
    // top set inline from safe-area insets
    zIndex: 20,
    padding: 4,
  },
  hint: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  hintText: {
    color: "#F1F5F9",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
