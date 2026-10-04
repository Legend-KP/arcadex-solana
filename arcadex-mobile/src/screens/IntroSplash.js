import { useCallback, useEffect, useRef } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";
import { Asset } from "expo-asset";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { StatusBar } from "expo-status-bar";

/** Matches whitened intro video + native splash. */
export const INTRO_BG = "#FFFFFF";

const INTRO_SOURCE = require("../../assets/app-loading.mp4");
const INTRO_POSTER = require("../../assets/intro-poster.png");
/** Clip is ~4s; hard cap so a stalled player never blocks the app. */
const INTRO_FALLBACK_MS = 5200;

/**
 * Cold-start intro: muted, centered, full play once.
 * Preloads the bundled asset, keeps VideoView visible (no opacity gate),
 * and retries play so Android actually starts the clip.
 */
export default function IntroSplash({ onFinished, onReady }) {
  const finishedRef = useRef(false);
  const readyRef = useRef(false);
  const { width: winW, height: winH } = useWindowDimensions();

  // Source is 720×1280 — contain/center on white (same placement).
  const aspect = 720 / 1280;
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

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady?.();
  }, [onReady]);

  // Warm the asset into a real file path before / while the player starts.
  useEffect(() => {
    Asset.fromModule(INTRO_SOURCE)
      .downloadAsync()
      .then(() => markReady())
      .catch(() => markReady());
  }, [markReady]);

  const player = useVideoPlayer(INTRO_SOURCE, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (status === "readyToPlay") {
      try {
        player.muted = true;
        player.currentTime = 0;
        player.play();
      } catch {
        /* ignore */
      }
      markReady();
    }
    if (status === "error") {
      console.warn("intro_video_error", error);
      markReady();
      finish();
    }
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) markReady();
  });

  useEventListener(player, "playToEnd", () => {
    finish();
  });

  useEffect(() => {
    try {
      player.muted = true;
      player.loop = false;
      player.play();
    } catch {
      /* ignore */
    }

    // Android sometimes needs a second play() after the surface attaches.
    const kick = setInterval(() => {
      try {
        if (!finishedRef.current && !player.playing) {
          player.play();
        }
      } catch {
        /* ignore */
      }
    }, 350);

    const endTimer = setTimeout(finish, INTRO_FALLBACK_MS);
    return () => {
      clearInterval(kick);
      clearTimeout(endTimer);
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    };
  }, [player, finish]);

  return (
    <View style={styles.root} accessibilityLabel="ArcadeX loading">
      <StatusBar style="dark" translucent backgroundColor={INTRO_BG} />
      {/* Poster underneath only until first decoded frame paints */}
      <Image
        source={INTRO_POSTER}
        style={[styles.poster, { width: videoW, height: videoH }]}
        resizeMode="contain"
      />
      <View
        style={[styles.videoWrap, { width: videoW, height: videoH }]}
        pointerEvents="none"
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
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
  poster: {
    position: "absolute",
  },
  videoWrap: {
    overflow: "hidden",
    backgroundColor: "transparent",
  },
});
