import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

/** Guest-play shell URL (Cloudflare production after guest-mode deploy). */
const ARCADEX_URL = 'https://arcadex-celo.kushal5paliwal.workers.dev';

/**
 * Step 1 shell: bare WebView loading ArcadeX.
 * No wallet / Solana bridge yet — prove games load on a real device first.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <WebView
        source={{ uri: ARCADEX_URL }}
        style={styles.webview}
        domStorageEnabled
        javaScriptEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
  },
});
