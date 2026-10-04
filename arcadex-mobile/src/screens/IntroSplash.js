import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { StatusBar } from "expo-status-bar";

/** Wall color sampled from the intro clip (letterbox / safe fallback). */
export const INTRO_BG = "#A27336";

const INTRO_SOURCE = require("../../assets/app-loading.mp4");
/** Clip is ~3s; hard cap so a stalled player never blocks the app. */
const INTRO_FALLBACK_MS = 3800;

/**
 * Cold-start intro: muted, full play, centered contain on matching bg.
 * Bundled asset — no network. Finishes via playToEnd or fallback timer.
 */
export default function IntroSplash({ onFinished, onReady }) {
  const finishedRef = useRef(false);
  const { width: winW, height: winH } = useWindowDimensions();

  // Landscape source (740×552) — size to fit width, keep aspect, center.
  const aspect = 740 / 552;
  let videoW = winW;
  let videoH = winW / aspect;
  if (videoH > winH) {
    videoH = winH;
    videoW = winH * aspect;
  }

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.();
  }, [onFinished]);

  const player = useVideoPlayer(INTRO_SOURCE, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay") {
      onReady?.();
      try {
        player.muted = true;
        player.play();
      } catch {
        /* ignore */
      }
    }
    if (status === "error") {
      // Bundled asset should not fail; still unblock the app.
      finish();
    }
  });

  useEventListener(player, "playToEnd", () => {
    finish();
  });

  useEffect(() => {
    onReady?.();
    try {
      player.muted = true;
      player.loop = false;
      player.play();
    } catch {
      /* ignore */
    }

    const timer = setTimeout(finish, INTRO_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    };
  }, [player, finish, onReady]);

  return (
    <View style={styles.root} accessibilityLabel="ArcadeX loading">
      <StatusBar style="light" translucent backgroundColor={INTRO_BG} />
      <View pointerEvents="none">
        <VideoView
          player={player}
          style={{ width: videoW, height: videoH }}
          contentFit="contain"
          nativeControls={false}
          surfaceType="textureView"
        />
      </View>
    </View>
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
