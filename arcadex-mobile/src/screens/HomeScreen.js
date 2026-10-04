import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  fetchActivityLeaderboard,
  fetchGames,
  logoFallbackUrl,
  logoUrl,
  truncateAddress,
} from "../api";
import { gameImageCandidates, gameVideoSources } from "../game-images";
import {
  formatContestCountdown,
  formatPlayCount,
  gameHasContestLive,
  gameIsLive,
  isNewArrival,
  readRecentPlayIds,
  sortGames,
} from "../game-utils";
import { colors, spacing } from "../theme";

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 15,
  minimumViewTime: 80,
};

function ThumbImage({ game, style, square }) {
  const candidates = useMemo(() => gameImageCandidates(game), [game]);
  const [idx, setIdx] = useState(0);
  const uri = candidates[idx] || null;
  return uri ? (
    <Image
      source={{ uri }}
      style={[style, square && styles.squareThumb]}
      resizeMode="cover"
      onError={() => setIdx((i) => (i + 1 < candidates.length ? i + 1 : i))}
    />
  ) : (
    <View style={[style, styles.thumbFallback, square && styles.squareThumb]}>
      <Text style={styles.thumbFallbackText}>{(game.name || "?").slice(0, 1)}</Text>
    </View>
  );
}

/** Mounted only while a catalog card is in view — muted looping preview. */
function PreviewVideo({ uri, onError }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onError?.();
  });

  useEffect(() => {
    try {
      player.play();
    } catch {
      /* ignore */
    }
    return () => {
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    };
  }, [player]);

  return (
    <VideoView
      player={player}
      style={styles.catalogVideo}
      contentFit="cover"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}

function ContestCard({ game, now, onPress }) {
  const left =
    typeof game.contestEndsAt === "number"
      ? formatContestCountdown(game.contestEndsAt - now)
      : "";
  return (
    <Pressable
      style={({ pressed }) => [styles.contestCard, pressed && styles.pressed]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(game);
      }}
    >
      <View style={styles.contestThumbWrap}>
        <ThumbImage game={game} style={styles.contestThumb} square />
        <View style={styles.contestBadge}>
          <Text style={styles.contestBadgeText}>CONTEST LIVE</Text>
        </View>
      </View>
      <Text style={styles.contestTitle} numberOfLines={1}>
        {game.name}
      </Text>
      {left ? <Text style={styles.contestMeta}>{left}</Text> : null}
    </Pressable>
  );
}

function CatalogCard({ game, playCount, onPress, isVisible, reduceMotion }) {
  const live = gameIsLive(game);
  const neu = isNewArrival(game);
  const video = useMemo(() => gameVideoSources(game), [game]);
  const [videoFailed, setVideoFailed] = useState(false);

  // Poster always paints; video mounts only when visible + allowlisted + live.
  const mountVideo =
    live &&
    !!video?.mp4 &&
    isVisible &&
    !reduceMotion &&
    !videoFailed;

  // Retry after scroll-away (transient network / decode errors).
  useEffect(() => {
    if (!isVisible) setVideoFailed(false);
  }, [isVisible]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.catalogCard,
        pressed && styles.pressed,
        !live && styles.cardDisabled,
      ]}
      disabled={!live}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(game);
      }}
    >
      <View style={styles.catalogThumbWrap}>
        <ThumbImage game={game} style={styles.catalogThumb} />
        {mountVideo ? (
          <PreviewVideo uri={video.mp4} onError={() => setVideoFailed(true)} />
        ) : null}
        {neu ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW ARRIVAL</Text>
          </View>
        ) : null}
        {!live ? (
          <View style={styles.soonOverlay}>
            <Text style={styles.soonOverlayText}>Coming Soon</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.catalogTitle} numberOfLines={1}>
        {game.name}
      </Text>
      <Text style={styles.catalogMeta}>
        {live ? `${formatPlayCount(playCount)} plays` : "Coming soon"}
      </Text>
    </Pressable>
  );
}

function WinnersBar({ entries }) {
  if (!entries?.length) return null;
  return (
    <View style={styles.winnersBar}>
      <Text style={styles.winnersLabel}>WINNERS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.winnersRow}
      >
        {entries.slice(0, 12).map((entry, i) => {
          const wallet = entry.walletAddress || entry.wallet || entry.id || "";
          const score = entry.score ?? entry.xp ?? 0;
          return (
            <Text key={`${wallet}-${i}`} style={styles.winnersItem}>
              <Text style={styles.winnersAddr}>
                {truncateAddress(String(wallet), 4, 4)}
              </Text>
              <Text style={styles.winnersScore}> {score} XP</Text>
              {i < Math.min(entries.length, 12) - 1 ? (
                <Text style={styles.winnersSep}>  ·  </Text>
              ) : null}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MenuDrawer({ visible, session, onClose, onWallet, onSparks }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.drawerBackdrop} onPress={onClose} />
      <View style={[styles.drawer, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.drawerTitle}>ArcadeX</Text>
        <Text style={styles.drawerSub}>Solana Mobile</Text>
        <Pressable
          style={styles.drawerItem}
          onPress={() => {
            onClose();
            onWallet();
          }}
        >
          <Text style={styles.drawerItemText}>
            {session?.address
              ? `Wallet · ${truncateAddress(session.address)}`
              : "Connect wallet"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.drawerItem}
          onPress={() => {
            onClose();
            onSparks();
          }}
        >
          <Text style={styles.drawerItemText}>Sparks shop</Text>
        </Pressable>
        <Pressable style={styles.drawerItem} onPress={onClose}>
          <Text style={styles.drawerItemText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
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
  const listRef = useRef(null);
  const [games, setGames] = useState([]);
  const [playCounts, setPlayCounts] = useState({});
  const [winners, setWinners] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState("default");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [continueOnly, setContinueOnly] = useState(false);
  const [logoSrc, setLogoSrc] = useState(logoUrl());
  const [visibleIds, setVisibleIds] = useState(() => new Set());
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      if (mounted) setReduceMotion(!!v);
    });
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (v) => setReduceMotion(!!v)
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const next = new Set();
    for (const entry of viewableItems) {
      if (entry?.isViewable && entry?.item?.id) next.add(entry.item.id);
    }
    setVisibleIds(next);
  }).current;

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const [catalog, recent, lb] = await Promise.all([
          fetchGames(),
          readRecentPlayIds(),
          fetchActivityLeaderboard().catch(() => []),
        ]);
        setGames((catalog.games || []).filter((g) => g.active !== false));
        setPlayCounts(catalog.playCounts || {});
        setRecentIds(recent);
        setWinners(lb);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load games.");
      } finally {
        setLoading(false);
        setRefreshing(false);
        onReady?.();
      }
    },
    [onReady]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const ordered = useMemo(() => {
    const withPlays = games.map((g) => ({
      ...g,
      _plays: (playCounts[g.id] ?? Number(g.plays)) || 0,
    }));
    return sortGames(withPlays, sortMode);
  }, [games, playCounts, sortMode]);

  const live = useMemo(() => ordered.filter((g) => gameIsLive(g)), [ordered]);
  const contests = useMemo(
    () => live.filter((g) => gameHasContestLive(g, now)),
    [live, now]
  );
  const continuePlaying = useMemo(() => {
    const byId = new Map(live.map((g) => [g.id, g]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean);
  }, [live, recentIds]);

  const catalog = useMemo(() => {
    let list = continueOnly ? continuePlaying : live;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((g) => String(g.name || "").toLowerCase().includes(q));
    return list;
  }, [continueOnly, continuePlaying, live, query]);

  const sparkLabel = sparks?.hasInfinite
    ? "∞"
    : `${sparks?.available ?? 0}/${sparks?.max ?? 4}`;

  const cycleSort = () => {
    Haptics.selectionAsync();
    setSortMode((m) =>
      m === "default" ? "plays" : m === "plays" ? "name" : m === "name" ? "newest" : "default"
    );
  };

  const sortLabel =
    sortMode === "plays"
      ? "Plays"
      : sortMode === "name"
        ? "A–Z"
        : sortMode === "newest"
          ? "Newest"
          : "Sort";

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topbar}>
        <View style={styles.topbarLeft}>
          <Pressable
            style={styles.menuBtn}
            onPress={() => {
              Haptics.selectionAsync();
              setMenuOpen(true);
            }}
          >
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
          </Pressable>
          <Image
            source={{ uri: logoSrc }}
            style={styles.logo}
            resizeMode="contain"
            onError={() => setLogoSrc(logoFallbackUrl())}
          />
        </View>
        <View style={styles.topbarRight}>
          <Pressable
            style={styles.xpChip}
            onPress={() => {
              Haptics.selectionAsync();
              onOpenWallet();
            }}
          >
            <Text style={styles.xpChipText}>🏆 XP</Text>
          </Pressable>
          <Pressable
            style={styles.sparkChip}
            onPress={() => {
              Haptics.selectionAsync();
              onOpenSparks();
            }}
          >
            <Text style={styles.sparkChipText}>⚡ {sparkLabel}</Text>
          </Pressable>
        </View>
      </View>

      <WinnersBar entries={winners} />

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
          ref={listRef}
          data={catalog}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 28,
            paddingTop: 8,
          }}
          viewabilityConfig={VIEWABILITY_CONFIG}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View>
              {contests.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>LIVE CONTESTS</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{contests.length}</Text>
                    </View>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                  >
                    {contests.map((game) => (
                      <ContestCard
                        key={game.id}
                        game={game}
                        now={now}
                        onPress={onOpenGame}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>
                  ALL GAMES
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filters}
                >
                  <Pressable style={styles.filterBtn} onPress={cycleSort}>
                    <Text style={styles.filterText}>{sortLabel}</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.filterBtn,
                      continueOnly && styles.filterBtnActive,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setContinueOnly((v) => !v);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        continueOnly && styles.filterTextActive,
                      ]}
                    >
                      Continue playing
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.filterBtn, searchOpen && styles.filterBtnActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSearchOpen((v) => !v);
                      if (searchOpen) setQuery("");
                    }}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        searchOpen && styles.filterTextActive,
                      ]}
                    >
                      Search
                    </Text>
                  </Pressable>
                </ScrollView>
                {searchOpen ? (
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search games"
                    placeholderTextColor={colors.textDim}
                    style={styles.searchInput}
                    autoFocus
                  />
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {continueOnly
                ? "Play a game to see it here."
                : "No games yet. Check back soon!"}
            </Text>
          }
          renderItem={({ item }) => (
            <CatalogCard
              game={item}
              playCount={playCounts[item.id] ?? 0}
              onPress={onOpenGame}
              isVisible={visibleIds.has(item.id)}
              reduceMotion={reduceMotion}
            />
          )}
        />
      )}

      <MenuDrawer
        visible={menuOpen}
        session={session}
        onClose={() => setMenuOpen(false)}
        onWallet={onOpenWallet}
        onSparks={onOpenSparks}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgSoft },
  topbar: {
    marginHorizontal: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  topbarLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  topbarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  menuBar: { width: 16, height: 2, borderRadius: 1, backgroundColor: "#0f172a" },
  logo: { width: 128, height: 40 },
  xpChip: {
    backgroundColor: "#fef3c7",
    borderColor: "rgba(245,158,11,0.35)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  xpChipText: { color: "#92400e", fontWeight: "800", fontSize: 12 },
  sparkChip: {
    backgroundColor: colors.sparkBg,
    borderColor: colors.sparkBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  sparkChipText: { color: colors.spark, fontWeight: "800", fontSize: 13 },
  winnersBar: {
    marginTop: 10,
    backgroundColor: colors.winnersBg,
    paddingVertical: 8,
    paddingLeft: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  winnersLabel: {
    color: colors.winnersLabel,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.4,
  },
  winnersRow: { paddingRight: 16, alignItems: "center" },
  winnersItem: { fontSize: 12 },
  winnersAddr: { color: "#0f172a", fontWeight: "700" },
  winnersScore: { color: colors.winnersLabel, fontWeight: "800" },
  winnersSep: { color: "#d6d3d1" },
  section: { marginBottom: 8 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  countBadge: {
    backgroundColor: colors.danger,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  countBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  rail: { paddingHorizontal: spacing.lg, gap: 14, paddingBottom: 8 },
  contestCard: { width: 148 },
  contestThumbWrap: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2.5,
    borderColor: colors.borderGold,
    backgroundColor: "#0f172a",
  },
  contestThumb: { width: "100%", aspectRatio: 1 },
  squareThumb: { aspectRatio: 1 },
  contestBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: colors.contestBadge,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  contestBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  contestTitle: {
    marginTop: 8,
    color: colors.text,
    fontWeight: "800",
    fontSize: 15,
  },
  contestMeta: { marginTop: 2, color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  filters: {
    paddingHorizontal: spacing.lg,
    gap: 8,
    paddingBottom: 12,
  },
  filterBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterBtnActive: {
    borderColor: colors.accent,
    backgroundColor: "#fffbeb",
  },
  filterText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  filterTextActive: { color: "#92400e" },
  searchInput: {
    marginHorizontal: spacing.lg,
    marginBottom: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  gridRow: {
    paddingHorizontal: spacing.lg,
    gap: 16,
    marginBottom: 16,
  },
  catalogCard: { flex: 1 },
  catalogThumbWrap: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2.5,
    borderColor: colors.borderGold,
    backgroundColor: "#0f172a",
  },
  catalogThumb: { width: "100%", aspectRatio: 4 / 5 },
  catalogVideo: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  catalogTitle: {
    marginTop: 8,
    textAlign: "center",
    color: colors.text,
    fontWeight: "800",
    fontSize: 15,
  },
  catalogMeta: {
    marginTop: 2,
    textAlign: "center",
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 12,
  },
  newBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: colors.newBadge,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  soonOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  soonOverlayText: { color: "#fff", fontWeight: "800" },
  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e293b",
  },
  thumbFallbackText: { color: "#cbd5e1", fontSize: 34, fontWeight: "800" },
  pressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  cardDisabled: { opacity: 0.55 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 28,
    paddingHorizontal: 24,
  },
  errorBanner: {
    marginHorizontal: 12,
    marginTop: 10,
    backgroundColor: "#fee2e2",
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: "#991b1b", fontSize: 13 },
  errorRetry: { color: "#b91c1c", fontSize: 12, marginTop: 4, fontWeight: "700" },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "78%",
    maxWidth: 320,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  drawerTitle: { color: colors.text, fontSize: 24, fontWeight: "900" },
  drawerSub: { color: colors.textMuted, marginBottom: 20, marginTop: 2 },
  drawerItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerItemText: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
