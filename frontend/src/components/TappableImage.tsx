/**
 * TappableImage — one wrapper, one behaviour, everywhere a member
 * would reasonably expect to enlarge an image.
 *
 * Under the hood: `<Pressable>` around `<Image>` that opens the shared
 * `ZoomableImageViewer` (pinch / pan / double-tap / clear-X close).
 * The zoom state is owned by this component, so callers don't have
 * to plumb useState + a viewer per surface.
 *
 * Two source shapes accepted (one wins, in order):
 *   • `source` — a `require()`d bundled asset (preset avatars, gallery
 *     photos) OR a `{ uri: "..." }` object.
 *   • `uri`    — a plain string (data:image/... URI or http(s) URL).
 *
 * Automatic no-ops when there's nothing to zoom:
 *   • Neither `source` nor `uri` provided → renders nothing (safe).
 *   • `disabled` prop set → renders the image, but tap is inert
 *     (used to keep composer previews non-zoomable).
 *
 * Explicit rendering-only path: pass `disabled={true}` when the image
 * is decorative (butterflies, brand marks) or a tiny thumbnail that
 * routes to another screen — those callers should NOT reach for
 * TappableImage at all; use `<Image>` directly.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  Pressable,
  StyleProp,
  ViewStyle,
} from "react-native";
import ZoomableImageViewer from "./ZoomableImageViewer";

type Props = {
  /** Bundled asset (require()d) or `{uri}` object. Wins over `uri`. */
  source?: ImageSourcePropType | null;
  /** Plain URI string (http/https/data:). Used if `source` isn't set. */
  uri?: string | null;
  /** Style applied to the on-screen thumbnail. Circle avatars pass a
   * borderRadius here; full-width cards pass a width/aspectRatio pair. */
  style?: StyleProp<ImageStyle>;
  /** `contain` | `cover` | `stretch` | `center` — mirrors `Image`. */
  resizeMode?: "cover" | "contain" | "stretch" | "center" | "repeat";
  /** Optional caption shown at the bottom of the zoom view. */
  caption?: string;
  /** Escape hatch — render the image but don't open zoom on tap. */
  disabled?: boolean;
  /** Style applied to the outer Pressable — useful when the image is
   * inside a layout that needs a specific container behaviour. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Accessibility hint (falls back to a sensible default). */
  accessibilityLabel?: string;
  /** Test id for the outer Pressable — makes e2e easier. */
  testID?: string;
};

export default function TappableImage({
  source,
  uri,
  style,
  resizeMode = "cover",
  caption,
  disabled = false,
  containerStyle,
  accessibilityLabel,
  testID,
}: Props) {
  const [open, setOpen] = useState(false);

  // Normalise the image source once. `source` (a require()d ImageSource
  // or an already-built {uri} object) wins; otherwise we synthesise
  // `{ uri }` from the string. When neither is set, render nothing —
  // this lets callers pass a nullable value without wrapping the whole
  // component in a ternary at each callsite.
  const imgSource: ImageSourcePropType | null = useMemo(() => {
    if (source) return source;
    if (uri) return { uri };
    return null;
  }, [source, uri]);

  const onPress = useCallback(() => {
    if (disabled) return;
    if (!imgSource) return;
    setOpen(true);
  }, [disabled, imgSource]);

  if (!imgSource) return null;

  // Extract the pieces the ZoomableImageViewer expects. It accepts
  // both a bundled `source` and a URI, so we forward whichever we
  // have. `typeof source === "object"` covers both `require()`d
  // numbers-in-metro-web AND explicit `{uri}` objects — the viewer
  // itself handles both cleanly.
  const zoomProps = ((): { source?: ImageSourcePropType; uri?: string } => {
    if (source) return { source };
    if (uri) return { uri };
    return {};
  })();

  return (
    <>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        style={containerStyle}
        accessibilityRole={disabled ? undefined : "imagebutton"}
        accessibilityLabel={accessibilityLabel || (disabled ? undefined : "View image larger")}
        // Older-adult UX: generous hitSlop so a slightly-off tap still
        // opens the zoom. Only applies when the image is tappable.
        hitSlop={disabled ? undefined : 6}
      >
        <Image source={imgSource} style={style} resizeMode={resizeMode} />
      </Pressable>
      {open ? (
        <ZoomableImageViewer
          {...zoomProps}
          caption={caption}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
