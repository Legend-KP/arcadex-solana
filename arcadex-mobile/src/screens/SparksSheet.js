import { useEffect, useState } from "react";
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
import { colors } from "../theme";

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/** 4-segment ring — lit arcs = available Sparks. */
function SparkSegmentRing({ available, max = 4, infinite = false }) {
  const size = 92;
  const stroke = 9;
  const slotCount = Math.max(1, Math.floor(max));
  const lit = infinite
    ? slotCount
    : Math.max(0, Math.min(slotCount, Math.floor(available)));
  const gapDeg = 14;
  const sweep = (360 - gapDeg * slotCount) / slotCount;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Approximate each arc with a short rounded bar on the circle.
  const bars = Array.from({ length: slotCount }, (_, i) => {
    const mid = -90 + gapDeg / 2 + sweep / 2 + i * (sweep + gapDeg);
    const rad = (mid * Math.PI) / 180;
    const barLen = ((sweep / 360) * 2 * Math.PI * r) * 0.92;
    return {
      filled: infinite || i < lit,
      left: cx + r * Math.cos(rad) - barLen / 2,
      top: cy + r * Math.sin(rad) - stroke / 2,
      width: barLen,
      rotate: mid + 90,
    };
  });

  return (
    <View style={[styles.ring, { width: size, height: size }]}>
      {bars.map((bar, i) => (
        <View
          key={i}
          style={[
            styles.ringBar,
            {
              width: bar.width,
              height: stroke,
              left: bar.left,
              top: bar.top,
              backgroundColor: bar.filled
                ? "#fbbf24"
                : "rgba(251, 191, 36, 0.22)",
              transform: [{ rotate: `${bar.rotate}deg` }],
              shadowColor: bar.filled ? "#fbbf24" : "transparent",
            },
          ]}
        />
      ))}
      <Text style={styles.ringBolt}>{infinite ? "∞" : "⚡"}</Text>
    </View>
  );
}

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
  const available = sparks?.available ?? 0;
  const max = sparks?.max ?? 4;
  const isFull = available >= max;
  const hasInfinite = Boolean(sparks?.hasInfinite);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!visible || hasInfinite || isFull) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, hasInfinite, isFull]);

  const regeneratingAt = (sparks?.state?.slots || [])
    .filter((s) => typeof s === "number" && s > now)
    .sort((a, b) => a - b)[0];
  const nextMs =
    regeneratingAt && regeneratingAt > now ? regeneratingAt - now : 0;

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
            <Text style={styles.titleIconBolt}>⚡</Text>
          </View>

          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>×</Text>
          </Pressable>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.title}>SPARKS</Text>
            <Text style={styles.intro}>
              Use Sparks to play any game. Once inside, play freely and infinitely!
            </Text>

            <View style={styles.status}>
              {hasInfinite ? (
                <View style={styles.statusRow}>
                  <SparkSegmentRing available={max} max={max} infinite />
                  <View style={styles.statusCopy}>
                    <Text style={styles.countInfinite}>Infinite Spark active</Text>
                    <Text style={styles.infiniteHint}>
                      Play any game freely — no Spark cost while this lasts.
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.statusRow}>
                    <SparkSegmentRing available={available} max={max} />
                    <View style={styles.statusCopy}>
                      <Text style={styles.countValue}>
                        {available} / {max}
                      </Text>
                      <Text style={styles.countCaption}>Sparks Available</Text>
                      {isFull ? (
                        <Text style={styles.timer}>All Sparks are ready!</Text>
                      ) : nextMs > 0 ? (
                        <Text style={styles.timer}>
                          ⏱ Next Spark in {formatCountdown(nextMs)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.infoBox}>
                    <View style={styles.infoIcon}>
                      <Text style={styles.infoIconText}>i</Text>
                    </View>
                    <Text style={styles.infoText}>
                      1 Spark = 1 game entry. Sparks refill one at a time — each
                      takes 3 hours, and the next starts only after the previous
                      one is ready.
                    </Text>
                  </View>
                </>
              )}
            </View>

            <Text style={styles.shopTitle}>✦  GET MORE SPARKS  ✦</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {!connected ? (
              <Pressable style={styles.connectBtn} onPress={onConnect}>
                <Text style={styles.connectBtnText}>Connect wallet to buy</Text>
              </Pressable>
            ) : busy ? (
              <ActivityIndicator color="#7c3aed" style={{ marginVertical: 16 }} />
            ) : (
              <>
                <View style={styles.shopCard}>
                  <View style={styles.shopMain}>
                    <View style={[styles.shopIcon, styles.shopIconRefill]}>
                      <Text style={styles.shopIconText}>⚡</Text>
                    </View>
                    <View style={styles.shopCopy}>
                      <Text style={styles.shopName}>Spark Refill</Text>
                      <Text style={styles.shopDesc}>
                        Instantly refill your Spark bar to full.
                      </Text>
                      <View style={styles.tagGold}>
                        <Text style={styles.tagGoldText}>Best for quick top-up</Text>
                      </View>
                    </View>
                    <Pressable
                      style={[styles.priceBtn, isFull && styles.priceBtnDisabled]}
                      onPress={onRefill}
                      disabled={isFull}
                    >
                      <Text style={styles.priceBtnText}>$0.05</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.shopCard, styles.shopCardInfinite]}>
                  <View style={styles.shopMain}>
                    <View style={[styles.shopIcon, styles.shopIconInfinite]}>
                      <Text style={styles.shopIconText}>∞</Text>
                    </View>
                    <View style={styles.shopCopy}>
                      <Text style={styles.shopName}>Infinite Spark (24h)</Text>
                      <Text style={styles.shopDesc}>
                        Unlimited game access for 24 hours.
                      </Text>
                      <View style={styles.tagPurple}>
                        <Text style={styles.tagPurpleText}>Play without limits</Text>
                      </View>
                    </View>
                    <Pressable style={[styles.priceBtn, styles.priceBtnPurple]} onPress={onInfinite}>
                      <Text style={styles.priceBtnText}>$0.10</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            )}
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
    backgroundColor: "#fffaff",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(167, 139, 250, 0.35)",
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
    backgroundColor: "#5b21b6",
    borderWidth: 4,
    borderColor: "#ddd6fe",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  titleIconBolt: {
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
    color: "#7c3aed",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  intro: {
    textAlign: "center",
    color: "#52525b",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  status: {
    backgroundColor: "#1a0f45",
    borderRadius: 22,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 14,
    marginBottom: 18,
    gap: 14,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
  },
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  ringBar: {
    position: "absolute",
    borderRadius: 999,
    shadowOpacity: 0.55,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  ringBolt: {
    fontSize: 32,
    color: "#fbbf24",
  },
  countValue: {
    color: "#fbbf24",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 1,
  },
  countCaption: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
    marginBottom: 6,
  },
  timer: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "700",
  },
  countInfinite: {
    color: "#fbbf24",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  infiniteHint: {
    color: "#ddd6fe",
    fontSize: 13,
    lineHeight: 18,
  },
  infoBox: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(8, 6, 28, 0.55)",
    borderRadius: 14,
    padding: 12,
  },
  infoIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  infoIconText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    fontStyle: "italic",
  },
  infoText: {
    flex: 1,
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    lineHeight: 17,
  },
  shopTitle: {
    textAlign: "center",
    color: "#7c3aed",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
  },
  connectBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  connectBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
  shopCard: {
    borderWidth: 1.5,
    borderColor: "rgba(251, 191, 36, 0.55)",
    borderRadius: 18,
    backgroundColor: "#fff",
    padding: 14,
    marginBottom: 12,
  },
  shopCardInfinite: {
    borderColor: "rgba(168, 85, 247, 0.45)",
  },
  shopMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  shopIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  shopIconRefill: {
    backgroundColor: "#facc15",
  },
  shopIconInfinite: {
    backgroundColor: "#a855f7",
  },
  shopIconText: {
    fontSize: 26,
    color: "#fff",
    fontWeight: "800",
  },
  shopCopy: {
    flex: 1,
    minWidth: 0,
  },
  shopName: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 2,
  },
  shopDesc: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  tagGold: {
    alignSelf: "flex-start",
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.5)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagGoldText: {
    color: "#b45309",
    fontSize: 10,
    fontWeight: "700",
  },
  tagPurple: {
    alignSelf: "flex-start",
    backgroundColor: "#ede9fe",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.35)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagPurpleText: {
    color: "#6d28d9",
    fontSize: 10,
    fontWeight: "700",
  },
  priceBtn: {
    backgroundColor: "#f59e0b",
    borderRadius: 12,
    minWidth: 72,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  priceBtnPurple: {
    backgroundColor: "#7c3aed",
  },
  priceBtnDisabled: {
    opacity: 0.55,
  },
  priceBtnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
});
