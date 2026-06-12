import React from "react";
import { View, StyleSheet } from "react-native";

/**
 * Two-people-forming-an-O brand mark for YouBelong.
 * Two figures (head + curved body) meet to form a circle — friendship & connection.
 * Drawn with Views, no images, no SVG — scales cleanly on every device.
 */
export default function PeopleO({ size = 56, leftColor = "#0F766E", rightColor = "#5EEAD4" }: { size?: number; leftColor?: string; rightColor?: string }) {
  const stroke = size * 0.18;
  const head = size * 0.36;
  const ringInner = size; // outer width of ring

  return (
    <View style={{ width: size, height: size + head * 0.35, alignItems: "center", justifyContent: "flex-end" }}>
      {/* RING — two half-rings of different colour */}
      <View style={{ width: ringInner, height: ringInner }}>
        {/* Left half */}
        <View style={{ position: "absolute", left: 0, top: 0, width: ringInner / 2, height: ringInner, overflow: "hidden" }}>
          <View style={{ width: ringInner, height: ringInner, borderRadius: ringInner / 2, borderWidth: stroke, borderColor: leftColor }} />
        </View>
        {/* Right half */}
        <View style={{ position: "absolute", left: ringInner / 2, top: 0, width: ringInner / 2, height: ringInner, overflow: "hidden" }}>
          <View style={{ width: ringInner, height: ringInner, borderRadius: ringInner / 2, borderWidth: stroke, borderColor: rightColor, position: "absolute", left: -ringInner / 2 }} />
        </View>
      </View>

      {/* HEADS — sit at the top of each half-ring like two friends facing each other */}
      <View style={{ position: "absolute", top: 0, left: ringInner * 0.12, width: head, height: head, borderRadius: head / 2, backgroundColor: leftColor }} />
      <View style={{ position: "absolute", top: 0, right: ringInner * 0.12, width: head, height: head, borderRadius: head / 2, backgroundColor: rightColor }} />
    </View>
  );
}

const styles = StyleSheet.create({});
