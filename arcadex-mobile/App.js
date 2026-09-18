import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;

import { Component, useCallback, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { getArcadexWebUrl } from "./config";

const PAY_PURPOSES = new Set([
  "spark_refill",
  "infinite_spark",
  "score_submit",
]);

const INJECTED_SHELL_FLAG = `
  (function() {
    window.__ARCADEX_NATIVE_SHELL__ = true;
    window.__ARCADEX_BRIDGE__ = 'mwa-v1';
    true;
  })();
`;

class ShellErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.crash}>
          <Text style={styles.crashTitle}>ArcadeX failed to start</Text>
          <Text style={styles.crashBody}>
            {String(this.state.error?.message || this.state.error)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ShellErrorBoundary>
      <ArcadeShell />
    </ShellErrorBoundary>
  );
}

function ArcadeShell() {
  const uri = getArcadexWebUrl();
  const webRef = useRef(null);
  const authTokenRef = useRef(null);
  const busyRef = useRef(false);
  const [bootError, setBootError] = useState("");

  const reply = useCallback(async (payload) => {
    const { buildNativeReplyScript } = await import("./mwa");
    webRef.current?.injectJavaScript(buildNativeReplyScript(payload));
  }, []);

  const storage = useMemo(
    () => ({
      getItem: async () => authTokenRef.current,
      setItem: async (_key, value) => {
        authTokenRef.current = value;
      },
      removeItem: async () => {
        authTokenRef.current = null;
      },
    }),
    []
  );

  const onMessage = useCallback(
    async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!msg || msg.source !== "arcadex-web") return;

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
        const mwa = await import("./mwa");

        if (msg.type === "MWA_CONNECT" || msg.type === "MWA_SIGN_IN") {
          busyRef.current = true;
          try {
            const signedIn = await mwa.connectAndSignInMwaWallet(storage);
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
            const payerBase58 = msg.address || msg.payerBase58 || "";
            if (!PAY_PURPOSES.has(purpose)) {
              throw new Error("Unsupported payment purpose.");
            }
            if (!payerBase58) {
              throw new Error(
                "Connect & sign in with your Solana wallet first."
              );
            }
            const paid = await mwa.payArcadeFeeMwa(storage, {
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
            await mwa.disconnectMwaWallet(storage);
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
        setBootError(
          err instanceof Error ? err.message : "Wallet bridge failed to load."
        );
      }
    },
    [reply, storage]
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {bootError ? (
        <Text style={styles.banner} numberOfLines={3}>
          {bootError}
        </Text>
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
        injectedJavaScriptBeforeContentLoaded={INJECTED_SHELL_FLAG}
        onMessage={onMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  webview: { flex: 1 },
  banner: {
    color: "#fecaca",
    backgroundColor: "#450a0a",
    padding: 10,
    fontSize: 12,
  },
  crash: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  crashTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  crashBody: {
    color: "#fca5a5",
    fontSize: 13,
    textAlign: "center",
  },
});
