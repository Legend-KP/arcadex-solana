import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { fetchGames, truncateAddress } from "../api";
import { colors, spacing } from "../theme";

function gameImage(game) {
  return game.thumbnail || game.logo || game.fallbackImage || null;
}

function GameCard({ game, playCount, onPress }) {
  const live = game.live !== false;
  const active = game.active !== false;
  const uri = gameImage(game);
  const disabled = !active || !live;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && !disabled && styles.cardPressed,
        disabled && styles.cardDisabled,
      ]}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(game);
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.cardImage} resizeMode="cover" />
      ) : (
        <View style={[styles.cardImage, styles.cardImageFallback]}>
          <Text style={styles.cardImageFallbackText}>
            {(game.name || "?").slice(0, 1)}
          </Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {game.name}
        </Text>
        <Text style={styles.cardMeta}>
          {!live
            ? "Coming soon"
            : `${playCount ?? game.plays ?? 0} plays`}
        </Text>
      </View>
    </Pressable>
  );
}

export default function HomeScreen({
  session,
  sparks,
  onOpenWallet,
  onOpenSparks,
  onOpenGame,
  onReady,
}) {
  const insets = useSafeAreaInsets();
  const [games, setGames] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await fetchGames();
      const list = data.games.filter((g) => g.active !== false);
      setGames(list);
      setPlayCounts(data.playCounts || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load games.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      onReady?.();
    }
  }, [onReady]);

  useEffect(() => {
    load(false);
  }, [load]);

  const sparkLabel = sparks?.hasInfinite
    ? "∞"
    : `${sparks?.available ?? 0}/${sparks?.max ?? 4}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ArcadeX</Text>
          <Text style={styles.tagline}>Play on Solana Mobile</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.sparkChip}
            onPress={() => {
              Haptics.selectionAsync();
              onOpenSparks();
            }}
          >
            <Text style={styles.sparkChipText}>⚡ {sparkLabel}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.walletBtn,
              session?.address && styles.walletBtnConnected,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              onOpenWallet();
            }}
          >
            <Text style={styles.walletBtnText}>
              {session?.address
                ? truncateAddress(session.address)
                : "Connect"}
            </Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => load(false)}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorRetry}>Tap to retry</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingBottom: insets.bottom + 28,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>All games</Text>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No games available right now.</Text>
          }
          renderItem={({ item }) => (
            <GameCard
              game={item}
              playCount={playCounts[item.id]}
              onPress={onOpenGame}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  brand: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  headerActions: { alignItems: "flex-end", gap: 8 },
  sparkChip: {
    backgroundColor: "rgba(250, 204, 21, 0.12)",
    borderColor: "rgba(250, 204, 21, 0.35)",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
  },
  sparkChipText: {
    color: colors.spark,
    fontWeight: "700",
    fontSize: 13,
  },
  walletBtn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  walletBtnConnected: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
  },
  walletBtnText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  cardDisabled: { opacity: 0.45 },
  cardImage: { width: "100%", aspectRatio: 1.05, backgroundColor: "#0f0f16" },
  cardImageFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardImageFallbackText: {
    color: colors.textMuted,
    fontSize: 36,
    fontWeight: "800",
  },
  cardBody: { padding: 12, gap: 4 },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
  cardMeta: { color: colors.textDim, fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: 40 },
  errorBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: "#450a0a",
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: "#fecaca", fontSize: 13 },
  errorRetry: { color: "#fca5a5", fontSize: 12, marginTop: 4 },
});
