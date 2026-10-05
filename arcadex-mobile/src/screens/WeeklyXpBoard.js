import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  fetchActivityLeaderboard,
  formatActivityCountdown,
} from "../api";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function WeeklyXpBoard({ visible, walletAddress, onClose }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [endsAtMs, setEndsAtMs] = useState(0);
  const [countdown, setCountdown] = useState("");
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchActivityLeaderboard(walletAddress);
      setEntries(data.entries || []);
      setEndsAtMs(data.endsAtMs || data.endsAt || 0);
      setTotalParticipants(data.totalParticipants || 0);
      setMe(data.me);
      if (data.resetsIn) setCountdown(data.resetsIn);
    } catch (err) {
      setEntries([]);
      setMe(null);
      setTotalParticipants(0);
      setError(
        err instanceof Error ? err.message : "Could not load Weekly XP Board."
      );
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible || !endsAtMs) return;
    const tick = () =>
      setCountdown(formatActivityCountdown(endsAtMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visible, endsAtMs]);

  const myWallet = walletAddress?.toLowerCase?.() ?? "";

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.panel,
            {
              marginBottom: Math.max(insets.bottom, 16),
              marginTop: insets.top + 36,
            },
          ]}
        >
          <View style={styles.titleIcon} pointerEvents="none">
            <Text style={styles.titleIconTrophy}>🏆</Text>
          </View>

          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>×</Text>
          </Pressable>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.title}>Weekly XP Board</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>CONTEST LIVE</Text>
            </View>

            <View style={styles.timerPanel}>
              <View>
                <Text style={styles.timerLabel}>Time remaining</Text>
                <Text style={styles.timerValue}>{countdown || "…"}</Text>
              </View>
              <Text style={styles.timerTrophy}>🏆</Text>
            </View>

            {me ? (
              <Text style={styles.youLine}>
                You ·{" "}
                {me.score > 0 && me.rank != null ? `#${me.rank}` : "Unranked"} ·{" "}
                {Number(me.score || 0).toLocaleString()} XP
              </Text>
            ) : null}

            <View style={styles.tableHead}>
              <Text style={[styles.headCell, styles.headRank]}>#</Text>
              <Text style={[styles.headCell, styles.headPlayer]}>PLAYER</Text>
              <Text style={[styles.headCell, styles.headScore]}>SCORE</Text>
            </View>

            <View style={styles.list}>
              {loading ? (
                <ActivityIndicator color="#fbbf24" style={{ marginTop: 28 }} />
              ) : error ? (
                <Pressable onPress={load}>
                  <Text style={styles.empty}>{error}</Text>
                  <Text style={styles.retry}>Tap to retry</Text>
                </Pressable>
              ) : entries.length === 0 ? (
                <Text style={styles.empty}>
                  No XP yet this week — play a game or check in.
                </Text>
              ) : (
                entries.map((entry, index) => {
                  const wallet = entry.walletAddress || entry.wallet || "";
                  const isYou =
                    Boolean(myWallet) &&
                    String(wallet).toLowerCase() === myWallet;
                  const podium = index < 3;
                  return (
                    <View
                      key={`${wallet}-${index}`}
                      style={[
                        styles.row,
                        podium && styles.rowPodium,
                        index === 0 && styles.rowFirst,
                        isYou && styles.rowYou,
                      ]}
                    >
                      <Text style={styles.pos}>
                        {podium ? MEDALS[index] : `#${index + 1}`}
                      </Text>
                      <Text style={styles.name} numberOfLines={1}>
                        {entry.name || "Player"}
                        {isYou ? " (you)" : ""}
                      </Text>
                      <Text style={styles.score}>
                        🪙 {Number(entry.score ?? entry.xp ?? 0).toLocaleString()}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>

            {!loading && !error ? (
              <Text style={styles.stats}>
                {totalParticipants} Total Participants
              </Text>
            ) : null}

            <View style={styles.howto}>
              <Text style={styles.howtoIcon}>🎁</Text>
              <Text style={styles.howtoText}>
                <Text style={styles.howtoStrong}>
                  How it works: Top 10 Wins it All{"\n"}
                </Text>
                Weekly board resets every Monday 00:00 UTC. Play games or check in
                to earn XP and climb. 100% of the fees generated goes into the rewards!
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7, 10, 32, 0.66)",
  },
  panel: {
    backgroundColor: "#120a2e",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.35)",
    maxHeight: "88%",
    overflow: "visible",
    paddingTop: 44,
    shadowColor: "#070a20",
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  titleIcon: {
    position: "absolute",
    top: -36,
    left: "50%",
    width: 84,
    height: 84,
    marginLeft: -42,
    borderRadius: 42,
    backgroundColor: "#1a0f45",
    borderWidth: 4,
    borderColor: "rgba(251, 191, 36, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  titleIconTrophy: {
    fontSize: 36,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#7c3aed",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "600",
  },
  body: {
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  title: {
    textAlign: "center",
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  liveBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(34, 197, 94, 0.18)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 14,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22c55e",
  },
  liveText: {
    color: "#86efac",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  timerPanel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.35)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  timerLabel: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
  },
  timerValue: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  timerTrophy: { fontSize: 28 },
  youLine: {
    color: "#c4b5fd",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  tableHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  headCell: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headRank: { width: 40, textAlign: "center" },
  headPlayer: { flex: 1 },
  headScore: { minWidth: 72, textAlign: "right" },
  list: {
    minHeight: 120,
    maxHeight: 280,
  },
  empty: {
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 28,
    fontSize: 14,
  },
  retry: {
    color: "#fbbf24",
    textAlign: "center",
    marginTop: 8,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowPodium: {
    backgroundColor: "rgba(251, 191, 36, 0.08)",
    borderRadius: 12,
    borderBottomWidth: 0,
    marginBottom: 4,
  },
  rowFirst: {
    backgroundColor: "rgba(251, 191, 36, 0.16)",
  },
  rowYou: {
    borderWidth: 1,
    borderColor: "rgba(167, 139, 250, 0.55)",
    borderRadius: 12,
  },
  pos: { width: 40, textAlign: "center", fontSize: 16, fontWeight: "800" },
  name: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    paddingRight: 8,
  },
  score: {
    minWidth: 72,
    textAlign: "right",
    color: "#fbbf24",
    fontSize: 14,
    fontWeight: "800",
  },
  stats: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 12,
  },
  howto: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 12,
  },
  howtoIcon: { fontSize: 18 },
  howtoText: { flex: 1, color: "#cbd5e1", fontSize: 12, lineHeight: 17 },
  howtoStrong: { color: "#fff", fontWeight: "800" },
});
