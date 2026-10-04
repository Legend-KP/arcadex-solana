import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { truncateAddress } from "../api";
import { colors, spacing } from "../theme";

export default function WalletSheet({
  visible,
  session,
  busy,
  error,
  onConnect,
  onDisconnect,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const connected = Boolean(session?.address);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>
          {connected ? "Wallet connected" : "Connect wallet"}
        </Text>
        <Text style={styles.body}>
          {connected
            ? "ArcadeX uses Mobile Wallet Adapter on Solana mainnet for sign-in and in-app payments."
            : "Connect Phantom (or Seed Vault on Seeker) via Mobile Wallet Adapter, then approve a free sign-in message."}
        </Text>

        {connected ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Address</Text>
            <Text style={styles.infoValue}>
              {truncateAddress(session.address, 6, 6)}
            </Text>
            {session.label ? (
              <Text style={styles.infoMeta}>{session.label}</Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {busy ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
        ) : connected ? (
          <Pressable style={styles.dangerBtn} onPress={onDisconnect}>
            <Text style={styles.dangerBtnText}>Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={onConnect}>
            <Text style={styles.primaryBtnText}>Connect & sign in</Text>
          </Pressable>
        )}

        <Pressable style={styles.secondaryBtn} onPress={onClose}>
          <Text style={styles.secondaryBtnText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
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
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  infoBox: {
    backgroundColor: colors.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoLabel: { color: colors.textDim, fontSize: 12, marginBottom: 4 },
  infoValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
  infoMeta: { color: colors.textMuted, marginTop: 4, fontSize: 13 },
  error: {
    color: colors.danger,
    marginBottom: spacing.md,
    fontSize: 13,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: { color: "#041016", fontWeight: "800", fontSize: 15 },
  dangerBtn: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  dangerBtnText: { color: colors.danger, fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.textMuted, fontWeight: "600" },
});
