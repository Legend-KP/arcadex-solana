import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getArcadexWebUrl } from './config';

/**
 * Step 1 shell: bare WebView loading ArcadeX web build.
 * Point EXPO_PUBLIC_ARCADEX_URL (or config.js) at your new Cloudflare URL.
 */
export default function App() {
  const uri = getArcadexWebUrl();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <WebView
        source={{ uri }}
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
