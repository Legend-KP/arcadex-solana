import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

export default function SparksSheet({
  visible,
  sparks,
  connected,
  busy,
  error,
  onRefill,
  onInfinite,
  onConnect,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const label = sparks?.hasInfinite
    ? "Infinite Sparks active"
    : `${sparks?.available ?? 0} of ${sparks?.max ?? 4} Sparks ready`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Sparks</Text>
        <Text style={styles.body}>
          Sparks power each game start. Refill or unlock Infinite Sparks with a
          Solana USDC payment through Mobile Wallet Adapter.
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoValue}>{label}</Text>
          <Text style={styles.infoMeta}>Mainnet USDC · treasury fee</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!connected ? (
          <Pressable style={styles.primaryBtn} onPress={onConnect}>
            <Text style={styles.primaryBtnText}>Connect wallet to buy</Text>
          </Pressable>
        ) : busy ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
        ) : (
          <>
            <Pressable style={styles.primaryBtn} onPress={onRefill}>
              <Text style={styles.primaryBtnText}>Refill Sparks · $0.05</Text>
            </Pressable>
            <Pressable style={styles.secondaryAction} onPress={onInfinite}>
              <Text style={styles.secondaryActionText}>
                Infinite Sparks 24h · $0.10
              </Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.secondaryBtn} onPress={onClose}>
          <Text style={styles.secondaryBtnText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  infoBox: {
    backgroundColor: colors.sparkBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.sparkBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoValue: { color: colors.spark, fontSize: 16, fontWeight: "900" },
  infoMeta: { color: colors.textDim, marginTop: 4, fontSize: 12 },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: { color: "#422006", fontWeight: "900", fontSize: 15 },
  secondaryAction: {
    backgroundColor: "#fff",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryActionText: { color: colors.text, fontWeight: "800", fontSize: 15 },
  secondaryBtn: { borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: colors.textMuted, fontWeight: "700" },
});
