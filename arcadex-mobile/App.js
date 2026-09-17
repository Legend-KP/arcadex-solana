import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;

import { useCallback, useMemo, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { getArcadexWebUrl } from "./config";
import {
  INJECTED_SHELL_FLAG,
  buildNativeReplyScript,
  connectAndSignInMwaWallet,
  disconnectMwaWallet,
} from "./mwa";

/**
 * WebView + MWA bridge.
 * Step 4: connect · Step 5: free sign-in message (same wallet session).
 */
export default function App() {
  const uri = getArcadexWebUrl();
  const webRef = useRef(null);
  const authTokenRef = useRef(null);

  const reply = useCallback((payload) => {
    const script = buildNativeReplyScript(payload);
    webRef.current?.injectJavaScript(script);
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

      if (msg.type === "MWA_CONNECT" || msg.type === "MWA_SIGN_IN") {
        try {
          const signedIn = await connectAndSignInMwaWallet(storage);
          reply({
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
          reply({
            source: "arcadex-native",
            type: "MWA_CONNECT_RESULT",
            requestId,
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "Wallet connect / sign-in failed.",
          });
        }
        return;
      }

      if (msg.type === "MWA_DISCONNECT") {
        try {
          await disconnectMwaWallet(storage);
          reply({
            source: "arcadex-native",
            type: "MWA_DISCONNECT_RESULT",
            requestId,
            ok: true,
          });
        } catch (err) {
          reply({
            source: "arcadex-native",
            type: "MWA_DISCONNECT_RESULT",
            requestId,
            ok: false,
            error:
              err instanceof Error ? err.message : "Wallet disconnect failed.",
          });
        }
      }
    },
    [reply, storage]
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
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
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
  },
});
