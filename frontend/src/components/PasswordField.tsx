import React, { useState } from "react";
import { View, TextInput, Pressable, StyleSheet, TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = TextInputProps & {
  containerStyle?: any;
  inputStyle?: any;
  iconColor?: string;
  testID?: string;
};

export default function PasswordField({ containerStyle, inputStyle, iconColor = "#1E3A7F", testID, ...rest }: Props) {
  const [show, setShow] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        {...rest}
        testID={testID}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, inputStyle]}
      />
      <Pressable
        accessibilityLabel={show ? "Hide password" : "Show password"}
        accessibilityRole="button"
        testID={testID ? `${testID}-toggle` : "password-toggle"}
        onPress={() => setShow((v) => !v)}
        hitSlop={10}
        style={styles.toggle}
      >
        <Ionicons name={show ? "eye-off" : "eye"} size={22} color={iconColor} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center" },
  input: { flex: 1, paddingRight: 44 },
  toggle: { position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center", alignItems: "center", width: 32 },
});
