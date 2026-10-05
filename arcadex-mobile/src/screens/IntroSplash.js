import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Asset } from "expo-asset";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { StatusBar } from "expo-status-bar";

/** Full-screen intro backdrop. */
export const INTRO_BG = "#FFFFFF";

const INTRO_MODULE = require("../../assets/app-loading.mp4");
/** Clip is ~4s; hard cap so a stalled player never blocks the app. */
const INTRO_FALLBACK_MS = 5500;

/**
 * Cold-start intro: resolve a real file URI first (same approach as catalog
 * previews), then mount the player so Android actually starts playback.
 */
export default function IntroSplash({ onFinished, onReady }) {
  const [uri, setUri] = useState(null);
  const finishedRef = useRef(false);
  const readyRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.();
  }, [onFinished]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(INTRO_MODULE);
        await asset.downloadAsync();
        if (cancelled) return;
        const next = asset.localUri || asset.uri;
        setUri(next || INTRO_MODULE);
      } catch (err) {
        console.warn("intro_asset_load_failed", err);
        if (!cancelled) setUri(INTRO_MODULE);
      } finally {
        if (!cancelled) markReady();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markReady]);

  // Safety: never leave users on a blank intro forever.
  useEffect(() => {
    const t = setTimeout(finish, INTRO_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [finish]);

  return (
    <View style={styles.root} accessibilityLabel="ArcadeX loading">
      <StatusBar style="dark" translucent backgroundColor={INTRO_BG} />
      {uri ? (
        <IntroPlayer uri={uri} onPlaying={markReady} onEnded={finish} />
      ) : null}
    </View>
  );
}

/** Mounted only after we have a playable URI — mirrors HomeScreen PreviewVideo. */
function IntroPlayer({ uri, onPlaying, onEnded }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const aspect = 720 / 1280;
  let videoW = winW;
  let videoH = winW / aspect;
  if (videoH > winH) {
    videoH = winH;
    videoW = winH * aspect;
  }

  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (status === "readyToPlay") {
      try {
        player.muted = true;
        player.loop = false;
        player.play();
      } catch {
        /* ignore */
      }
      onPlaying?.();
    }
    if (status === "error") {
      console.warn("intro_video_error", error);
      onEnded?.();
    }
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) onPlaying?.();
  });

  useEventListener(player, "playToEnd", () => {
    onEnded?.();
  });

  useEffect(() => {
    try {
      player.muted = true;
      player.loop = false;
      player.play();
    } catch {
      /* ignore */
    }

    // Android: surface sometimes attaches after first play() — keep kicking.
    const kick = setInterval(() => {
      try {
        if (!player.playing) player.play();
      } catch {
        /* ignore */
      }
    }, 400);

    return () => {
      clearInterval(kick);
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
      style={{ width: videoW, height: videoH }}
      contentFit="contain"
      nativeControls={false}
      surfaceType="textureView"
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: INTRO_BG,
    alignItems: "center",
    justifyContent: "center",
  },
});
