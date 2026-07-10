import React from "react";
import { View, StyleSheet } from "react-native";

/**
 * Flat two-tone butterfly drawn with Views — no images, no SVG.
 * Left wings = deep teal/blue, right wings = mint/light teal,
 * matching the FriendPlace brand mark.
 */
export default function ButterflyLogo({ size = 96 }: { size?: number }) {
  const wingW = size * 0.46;
  const wingH = size * 0.52;
  const bodyW = size * 0.06;
  const bodyH = size * 0.42;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Top-left wing (deep teal/blue) */}
      <View
        style={[
          styles.wing,
          {
            width: wingW,
            height: wingH,
            backgroundColor: "#0E7490",
            left: size * 0.04,
            top: size * 0.08,
            transform: [{ rotate: "-22deg" }],
            borderTopLeftRadius: wingW * 0.9,
            borderTopRightRadius: wingW * 0.5,
            borderBottomLeftRadius: wingW * 0.7,
            borderBottomRightRadius: wingW * 0.4,
          },
        ]}
      />
      {/* Top-right wing (mint) */}
      <View
        style={[
          styles.wing,
          {
            width: wingW,
            height: wingH,
            backgroundColor: "#5EEAD4",
            right: size * 0.04,
            top: size * 0.08,
            transform: [{ rotate: "22deg" }],
            borderTopRightRadius: wingW * 0.9,
            borderTopLeftRadius: wingW * 0.5,
            borderBottomRightRadius: wingW * 0.7,
            borderBottomLeftRadius: wingW * 0.4,
          },
        ]}
      />
      {/* Bottom-left wing (slightly darker teal) */}
      <View
        style={[
          styles.wing,
          {
            width: wingW * 0.78,
            height: wingH * 0.78,
            backgroundColor: "#0F766E",
            left: size * 0.1,
            top: size * 0.46,
            transform: [{ rotate: "32deg" }],
            borderRadius: wingW * 0.55,
            borderBottomLeftRadius: wingW * 0.85,
          },
        ]}
      />
      {/* Bottom-right wing (light mint) */}
      <View
        style={[
          styles.wing,
          {
            width: wingW * 0.78,
            height: wingH * 0.78,
            backgroundColor: "#99F6E4",
            right: size * 0.1,
            top: size * 0.46,
            transform: [{ rotate: "-32deg" }],
            borderRadius: wingW * 0.55,
            borderBottomRightRadius: wingW * 0.85,
          },
        ]}
      />
      {/* Body */}
      <View
        style={{
          position: "absolute",
          width: bodyW,
          height: bodyH,
          backgroundColor: "#083344",
          borderRadius: bodyW,
          top: size * 0.22,
        }}
      />
      {/* Head */}
      <View
        style={{
          position: "absolute",
          width: bodyW * 1.8,
          height: bodyW * 1.8,
          backgroundColor: "#083344",
          borderRadius: bodyW,
          top: size * 0.14,
        }}
      />
      {/* Antennae */}
      <View
        style={{
          position: "absolute",
          width: size * 0.02,
          height: size * 0.16,
          backgroundColor: "#083344",
          borderRadius: size,
          top: size * 0.0,
          left: size * 0.42,
          transform: [{ rotate: "-18deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.02,
          height: size * 0.16,
          backgroundColor: "#083344",
          borderRadius: size,
          top: size * 0.0,
          right: size * 0.42,
          transform: [{ rotate: "18deg" }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wing: { position: "absolute" },
});
