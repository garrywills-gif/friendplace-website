import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";

/**
 * Tap-to-read accessibility button.
 * - Tap once: reads `text` aloud using expo-speech
 * - Tap again (while speaking): stops
 * - Auto-stops on unmount
 *
 * Designed to sit beside messages, posts, events and Today's Thought.
 */
export default function SpeakButton({
  text,
  size = 22,
  color = "#1E3A7F",
  bg = "transparent",
  testID,
  rate = 0.95,
  pitch = 1.02,
}: {
  text: string;
  size?: number;
  color?: string;
  bg?: string;
  testID?: string;
  rate?: number;
  pitch?: number;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      // stop any speech when the parent screen unmounts
      Speech.stop();
    };
  }, []);

  const onPress = async () => {
    try {
      const speaking = await Speech.isSpeakingAsync();
      if (speaking || playing) {
        await Speech.stop();
        setPlaying(false);
        return;
      }
      const clean = (text || "").toString().trim();
      if (!clean) return;
      setPlaying(true);
      Speech.speak(clean, {
        language: "en-US",
        rate,
        pitch,
        onDone: () => setPlaying(false),
        onStopped: () => setPlaying(false),
        onError: () => setPlaying(false),
      });
    } catch {
      setPlaying(false);
    }
  };

  // Hit area padding for large finger targets
  const pad = Math.max(8, Math.round(size * 0.4));
  const dim = size + pad * 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? "Stop reading aloud" : "Read aloud"}
      accessibilityHint="Reads the content aloud"
      testID={testID || "speak-button"}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: bg,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View>
        <Ionicons name={playing ? "stop-circle" : "volume-high"} size={size} color={color} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: "center", justifyContent: "center" },
});
