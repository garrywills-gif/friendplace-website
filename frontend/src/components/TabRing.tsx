import React from "react";
import { View } from "react-native";

// iter249 (TestFlight): shared look for BOTH bottom bars — the (tabs)
// bar and GlobalBottomNav — so they can never drift apart again.
export const TAB_ACTIVE = "#FFFFFF";
export const TAB_INACTIVE = "#A9BEDC"; // soft grey-blue on navy

/** Explicitly sized ring around a tab icon. react-navigation renders
 *  tabBarIcon inside a fixed ~28pt box; an unsized padded wrapper got
 *  squeezed there and collapsed the glyph to zero width. A fixed size
 *  can't be compressed. Selected = thin white ring; unselected keeps a
 *  transparent ring of the same size so nothing shifts. */
export function TabRing({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  return (
    <View
      style={{
        width: 60,
        height: 34,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: focused ? TAB_ACTIVE : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}
