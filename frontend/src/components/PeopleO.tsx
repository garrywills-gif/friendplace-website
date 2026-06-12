import React from "react";
import { View } from "react-native";

/**
 * YouBelong brand mark: two friends forming an "O".
 *
 * The outer O is a two-tone ring. Inside the ring, two clearly recognisable
 * person silhouettes (round head + rounded shoulder/bust) face each other.
 * The inner area is clipped to a circle so the figures fill the O without
 * spilling outside it — making them read instantly as "two people" even at
 * small sizes (e.g. inside a wordmark).
 */
export default function PeopleO({
  size = 56,
  leftColor = "#0F766E",
  rightColor = "#5EEAD4",
}: {
  size?: number;
  leftColor?: string;
  rightColor?: string;
}) {
  const ring = size;
  const stroke = ring * 0.13;
  const innerD = ring - stroke * 2 - ring * 0.04; // small breathing room
  const innerR = innerD / 2;

  // Person silhouette dimensions (sit INSIDE the inner clipped circle)
  const headD = innerD * 0.46;           // head diameter
  const shoulderW = innerD * 0.62;       // shoulder/bust width (wide → clipped by circle)
  const shoulderH = innerD * 0.55;       // shoulder/bust height
  const gap = innerD * 0.14;             // visible gap between the two figures
  const headTop = innerD * 0.06;         // head sits near top of inner circle
  const shoulderTop = headTop + headD * 0.78;

  return (
    <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
      {/* ---------- INNER FIGURES (clipped to a circle so they fill the O) ---------- */}
      <View
        style={{
          position: "absolute",
          width: innerD,
          height: innerD,
          borderRadius: innerR,
          overflow: "hidden",
        }}
      >
        {/* LEFT person */}
        <View
          style={{
            position: "absolute",
            top: shoulderTop,
            left: innerR - gap / 2 - shoulderW,
            width: shoulderW,
            height: shoulderH,
            backgroundColor: leftColor,
            borderTopLeftRadius: shoulderW * 0.55,
            borderTopRightRadius: shoulderW * 0.30,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: headTop,
            left: innerR - gap / 2 - shoulderW / 2 - headD / 2,
            width: headD,
            height: headD,
            borderRadius: headD / 2,
            backgroundColor: leftColor,
          }}
        />

        {/* RIGHT person */}
        <View
          style={{
            position: "absolute",
            top: shoulderTop,
            left: innerR + gap / 2,
            width: shoulderW,
            height: shoulderH,
            backgroundColor: rightColor,
            borderTopLeftRadius: shoulderW * 0.30,
            borderTopRightRadius: shoulderW * 0.55,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: headTop,
            left: innerR + gap / 2 + shoulderW / 2 - headD / 2,
            width: headD,
            height: headD,
            borderRadius: headD / 2,
            backgroundColor: rightColor,
          }}
        />
      </View>

      {/* ---------- TWO-TONE O RING (sits on top so the people are framed) ---------- */}
      <View style={{ position: "absolute", width: ring, height: ring }}>
        {/* Left half */}
        <View style={{ position: "absolute", left: 0, top: 0, width: ring / 2, height: ring, overflow: "hidden" }}>
          <View style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: leftColor }} />
        </View>
        {/* Right half */}
        <View style={{ position: "absolute", left: ring / 2, top: 0, width: ring / 2, height: ring, overflow: "hidden" }}>
          <View style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: rightColor, position: "absolute", left: -ring / 2 }} />
        </View>
      </View>
    </View>
  );
}
