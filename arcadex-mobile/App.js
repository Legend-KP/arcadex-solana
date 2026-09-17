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
  connectMwaWallet,
  disconnectMwaWallet,
} from "./mwa";

/**
 * Step 4 shell: WebView + connect-only Mobile Wallet Adapter bridge.
 * Web posts MWA_CONNECT / MWA_DISCONNECT; native opens the installed MWA wallet.
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

      if (msg.type === "MWA_CONNECT") {
        try {
          const connected = await connectMwaWallet(storage);
          reply({
            source: "arcadex-native",
            type: "MWA_CONNECT_RESULT",
            requestId,
            ok: true,
            address: connected.address,
            label: connected.label,
          });
        } catch (err) {
          reply({
            source: "arcadex-native",
            type: "MWA_CONNECT_RESULT",
            requestId,
            ok: false,
            error:
              err instanceof Error ? err.message : "Wallet connection failed.",
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
