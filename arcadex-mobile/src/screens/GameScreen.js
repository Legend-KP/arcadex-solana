import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gamePlayUrl } from "../api";
import { buildBootstrapInject, buildSparksExportScript } from "../inject";
import { colors } from "../theme";

const PAY_PURPOSES = new Set([
  "spark_refill",
  "infinite_spark",
  "score_submit",
]);

export default function GameScreen({
  game,
  session,
  sparkState,
  onBack,
  onSparksExport,
  onWalletBusyError,
}) {
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);
  const busyRef = useRef(false);
  const leavingRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const uri = gamePlayUrl(game.id);

  const reply = useCallback(async (payload) => {
    const { buildNativeReplyScript } = await import("../../mwa");
    webRef.current?.injectJavaScript(buildNativeReplyScript(payload));
  }, []);

  const finishLeave = useCallback(() => {
    if (!leavingRef.current) return;
    leavingRef.current = false;
    onBack();
  }, [onBack]);

  const handleBack = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    webRef.current?.injectJavaScript(buildSparksExportScript());
    // Fallback if WebView cannot post the export message.
    setTimeout(finishLeave, 400);
  }, [finishLeave]);

  const onMessage = useCallback(
    async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!msg || msg.source !== "arcadex-web") return;

      if (msg.type === "SPARKS_EXPORT") {
        Promise.resolve(onSparksExport?.(msg.stateJson || ""))
          .catch(() => {})
          .finally(() => {
            if (leavingRef.current) finishLeave();
          });
        return;
      }

      const requestId = msg.requestId ?? null;
      const isWalletOp =
        msg.type === "MWA_CONNECT" ||
        msg.type === "MWA_SIGN_IN" ||
        msg.type === "MWA_PAY" ||
        msg.type === "MWA_DISCONNECT";

      if (isWalletOp && busyRef.current) {
        await reply({
          source: "arcadex-native",
          type:
            msg.type === "MWA_PAY"
              ? "MWA_PAY_RESULT"
              : msg.type === "MWA_DISCONNECT"
                ? "MWA_DISCONNECT_RESULT"
                : "MWA_CONNECT_RESULT",
          requestId,
          ok: false,
          error:
            "Another wallet request is already open. Finish or close it, then try again.",
        });
        return;
      }

      try {
        const mwa = await import("../../mwa");
        const AsyncStorage = (
          await import("@react-native-async-storage/async-storage")
        ).default;

        if (msg.type === "MWA_CONNECT" || msg.type === "MWA_SIGN_IN") {
          busyRef.current = true;
          try {
            const signedIn = await mwa.connectAndSignInMwaWallet(AsyncStorage);
            await reply({
              source: "arcadex-native",
              type: "MWA_CONNECT_RESULT",
              requestId,
              ok: true,
              address: signedIn.address,
              label: signedIn.label,
              message: signedIn.message,
              signatureBase64: signedIn.signatureBase64,
              signedIn: true,
            });
          } catch (err) {
            await reply({
              source: "arcadex-native",
              type: "MWA_CONNECT_RESULT",
              requestId,
              ok: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Wallet connect / sign-in failed.",
            });
          } finally {
            busyRef.current = false;
          }
          return;
        }

        if (msg.type === "MWA_PAY") {
          busyRef.current = true;
          try {
            const purpose = msg.purpose;
            const token = msg.token === "USDT" ? "USDT" : "USDC";
            const payerBase58 = msg.address || msg.payerBase58 || session?.address || "";
            if (!PAY_PURPOSES.has(purpose)) {
              throw new Error("Unsupported payment purpose.");
            }
            if (!payerBase58) {
              throw new Error("Connect & sign in with your Solana wallet first.");
            }
            const paid = await mwa.payArcadeFeeMwa(AsyncStorage, {
              purpose,
              token,
              payerBase58,
            });
            await reply({
              source: "arcadex-native",
              type: "MWA_PAY_RESULT",
              requestId,
              ok: true,
              purpose: paid.purpose,
              token: paid.token,
              signature: paid.signature,
              address: paid.address,
            });
          } catch (err) {
            await reply({
              source: "arcadex-native",
              type: "MWA_PAY_RESULT",
              requestId,
              ok: false,
              error: err instanceof Error ? err.message : "Payment failed.",
            });
          } finally {
            busyRef.current = false;
          }
          return;
        }

        if (msg.type === "MWA_DISCONNECT") {
          busyRef.current = true;
          try {
            await mwa.disconnectMwaWallet(AsyncStorage);
            await reply({
              source: "arcadex-native",
              type: "MWA_DISCONNECT_RESULT",
              requestId,
              ok: true,
            });
          } catch (err) {
            await reply({
              source: "arcadex-native",
              type: "MWA_DISCONNECT_RESULT",
              requestId,
              ok: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Wallet disconnect failed.",
            });
          } finally {
            busyRef.current = false;
          }
        }
      } catch (err) {
        busyRef.current = false;
        onWalletBusyError?.(
          err instanceof Error ? err.message : "Wallet bridge failed."
        );
      }
    },
    [finishLeave, onSparksExport, onWalletBusyError, reply, session?.address]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backText}>← Games</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {game.name}
        </Text>
        <View style={{ width: 72 }} />
      </View>

      {loadError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={handleBack}>
            <Text style={styles.errorLink}>Back to games</Text>
          </Pressable>
        </View>
      ) : null}

      <WebView
        ref={webRef}
        source={{ uri }}
        style={styles.webview}
        domStorageEnabled
        javaScriptEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        injectedJavaScriptBeforeContentLoaded={buildBootstrapInject({
          session,
          sparkState,
        })}
        onMessage={onMessage}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
        onError={() => setLoadError("Could not load this game. Check your connection.")}
        onHttpError={() =>
          setLoadError("Game server returned an error. Try again shortly.")
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 72 },
  backText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  title: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
    fontWeight: "700",
    fontSize: 15,
  },
  webview: { flex: 1, backgroundColor: "#000" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  errorBox: {
    backgroundColor: "#450a0a",
    padding: 12,
  },
  errorText: { color: "#fecaca", fontSize: 13 },
  errorLink: { color: "#fca5a5", marginTop: 6, fontWeight: "700" },
});
