import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";
import { truncateAddress } from "../api";

export default function PlayerNameSheet({
  visible,
  walletAddress,
  busy,
  error,
  intent = "setup",
  defaultName = "",
  onSubmit,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (visible) setName(defaultName || "");
  }, [visible, defaultName]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1;
  const isEdit = intent === "edit";

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {
        if (isEdit) onClose?.();
      }}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (isEdit) onClose?.();
          }}
        />
        <View style={[styles.card, { marginBottom: insets.bottom + 16 }]}>
          {isEdit ? (
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          ) : null}
          <Text style={styles.subtitle}>
            {isEdit ? "ArcadeX" : "Welcome to ArcadeX"}
          </Text>
          <Text style={styles.title}>
            {isEdit ? "Edit your player name" : "Choose your player name"}
          </Text>
          <Text style={styles.hint}>
            {isEdit
              ? "Update the display name shown on leaderboards and your profile."
              : "Your wallet is connected. Pick a display name to finish setting up your profile."}
          </Text>

          {walletAddress ? (
            <Text style={styles.wallet}>
              Connected · {truncateAddress(walletAddress, 6, 4)}
            </Text>
          ) : null}

          <Text style={styles.label}>Player name</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. PixelPro"
            placeholderTextColor={colors.textDim}
            maxLength={20}
            autoFocus
            editable={!busy}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => {
              if (valid && !busy) onSubmit(trimmed);
            }}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.submit, (!valid || busy) && styles.submitDisabled]}
            disabled={!valid || busy}
            onPress={() => onSubmit(trimmed)}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {isEdit ? "Save" : "Continue"}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7, 10, 32, 0.66)",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(167, 139, 250, 0.35)",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#7c3aed",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "600",
  },
  subtitle: {
    textAlign: "center",
    color: "#7c3aed",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  title: {
    textAlign: "center",
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 8,
  },
  hint: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  wallet: {
    textAlign: "center",
    color: "#6d28d9",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 16,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#fafafa",
    marginBottom: 10,
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 10,
  },
  submit: {
    backgroundColor: "#7c3aed",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitDisabled: {
    opacity: 0.55,
  },
  submitText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});
