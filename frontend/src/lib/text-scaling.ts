/**
 * Global text-scaling defaults for FriendPlace.
 *
 * WHY THIS FILE EXISTS:
 *   By default `<Text>` in React Native respects the user's system-wide
 *   font-scale preference (iOS Dynamic Type / Android "Font size"). Set
 *   `allowFontScaling={true}` — which is the default on iOS — and the OS
 *   automatically multiplies the resolved fontSize by the user's chosen
 *   scale.
 *
 *   The catch is TWO-FOLD:
 *     1. Not every part of our code passes `allowFontScaling` explicitly,
 *        and it's easy for a random dev (or a snippet copy-pasted from
 *        the web) to accidentally disable it. By setting the value on
 *        `Text.defaultProps` we make "on" the app-wide baseline.
 *     2. Without a cap, a user with iOS "Larger Text – Accessibility
 *        Sizes" turned all the way up (~3.5×) will explode our layouts —
 *        buttons wrap onto three lines, avatars get pushed off-screen,
 *        etc. `maxFontSizeMultiplier` gives us a hard upper bound.
 *
 * WHAT VALUE DO WE CAP AT?
 *   Our in-app Text Size setting already scales by 0.9× / 1.0× / 1.2× / 1.4×
 *   (Small / Default / Large / Extra). If we allow the system to also
 *   scale by up to 1.4× *on top* of our own scale, the total ceiling
 *   works out to ≈2× the design size — enough for genuine visual
 *   comfort without breaking layouts we've hand-tuned for older users.
 *
 *   The value 1.4 matches iOS's default "Larger Text" range (100% → 235%
 *   at the settings screen; ~1.35× is the largest "non-accessibility"
 *   size). Users who need bigger than that will still get *some* extra
 *   scaling via our in-app Extra step, and iOS's Accessibility Zoom
 *   remains available at the system level.
 *
 * WHAT ABOUT TEXTINPUT?
 *   By default TextInput on iOS does NOT respect Dynamic Type — the
 *   font size is treated as a literal pixel value. We opt it in here
 *   with the same cap so forms and message boxes grow along with body
 *   copy.
 *
 * IMPORT ONCE, EARLY:
 *   This file is imported for its side-effects from `app/_layout.tsx`
 *   before any screen renders, so the defaults are in place before the
 *   first `<Text>` is measured.
 */
import { Text, TextInput } from "react-native";

// Cap at 1.4× beyond fontSize we resolve — see comments above.
const MAX_MULTIPLIER = 1.4;

// `defaultProps` is a legacy React feature we're using here on purpose:
// there is no first-class React Native API for "set this prop on every
// Text globally", and everyone (Facebook included) still uses this.
// Suppress the console warning React 18 emits by only setting the
// values if they are not already present.
type WithDefaults<T> = T & { defaultProps?: Record<string, unknown> };

const TextAny = Text as unknown as WithDefaults<typeof Text>;
TextAny.defaultProps = TextAny.defaultProps || {};
if (TextAny.defaultProps.allowFontScaling === undefined) {
  TextAny.defaultProps.allowFontScaling = true;
}
if (TextAny.defaultProps.maxFontSizeMultiplier === undefined) {
  TextAny.defaultProps.maxFontSizeMultiplier = MAX_MULTIPLIER;
}

const TextInputAny = TextInput as unknown as WithDefaults<typeof TextInput>;
TextInputAny.defaultProps = TextInputAny.defaultProps || {};
if (TextInputAny.defaultProps.allowFontScaling === undefined) {
  TextInputAny.defaultProps.allowFontScaling = true;
}
if (TextInputAny.defaultProps.maxFontSizeMultiplier === undefined) {
  TextInputAny.defaultProps.maxFontSizeMultiplier = MAX_MULTIPLIER;
}

// This module has no exports — its whole job is the side effects above.
export {};
