import { useRef } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { dailyShuffleUrl } from "../api";
import { buildBootstrapInject } from "../inject";

/**
 * Full-screen web overlay for Daily Streak — shown from native home on app open
 * (once / 24h), never from GameScreen. Host path remains /daily-shuffle for APK.
 */
export default function ShuffleSheet({
  visible,
  session,
  sparkState,
  onClose,
}) {
  const webRef = useRef(null);
  const uri = dailyShuffleUrl();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <WebView
          ref={webRef}
          source={{ uri }}
          style={styles.webview}
          domStorageEnabled
          javaScriptEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          injectedJavaScriptBeforeContentLoaded={buildBootstrapInject({
            session,
            sparkState,
          })}
          onMessage={(event) => {
            let msg;
            try {
              msg = JSON.parse(event.nativeEvent.data);
            } catch {
              return;
            }
            if (!msg || msg.source !== "arcadex-web") return;
            if (msg.type === "SHUFFLE_DONE" || msg.type === "LEAVE_GAME") {
              onClose?.();
            }
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070a20" },
  webview: { flex: 1, backgroundColor: "#070a20" },
});
