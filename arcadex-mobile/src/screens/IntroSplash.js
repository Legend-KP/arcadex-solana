import { useCallback, useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { StatusBar } from "expo-status-bar";

/** Matches keyed intro video + native splash. */
export const INTRO_BG = "#FFFFFF";

const INTRO_SOURCE = require("../../assets/app-loading.mp4");
const INTRO_POSTER = require("../../assets/intro-poster.png");
/** Clip is ~4s; hard cap so a stalled player never blocks the app. */
const INTRO_FALLBACK_MS = 4800;

/**
 * Cold-start intro: muted full-bleed portrait clip.
 * Poster sits under the player so hiding the native splash never flashes white.
 * Splash should only hide once the video is actually playing (onReady).
 */
export default function IntroSplash({ onFinished, onReady }) {
  const finishedRef = useRef(false);
  const readyRef = useRef(false);
  const [videoVisible, setVideoVisible] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.();
  }, [onFinished]);

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setVideoVisible(true);
    onReady?.();
  }, [onReady]);

  const player = useVideoPlayer(INTRO_SOURCE, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay") {
      try {
        player.muted = true;
        player.play();
      } catch {
        /* ignore */
      }
    }
    if (status === "error") {
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

    // If decode stalls, still unlock — never leave users on a stuck splash.
    const readyTimer = setTimeout(markReady, 1200);
    const endTimer = setTimeout(finish, INTRO_FALLBACK_MS);
    return () => {
      clearTimeout(readyTimer);
      clearTimeout(endTimer);
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    };
  }, [player, finish, markReady]);

  return (
    <View style={styles.root} accessibilityLabel="ArcadeX loading">
      <StatusBar style="dark" translucent backgroundColor={INTRO_BG} />
      {/* Instant first-frame paint — no white between native splash and video */}
      <Image
        source={INTRO_POSTER}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <View
        style={[styles.videoWrap, !videoVisible && styles.videoHidden]}
        pointerEvents="none"
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
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
  },
  videoWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  videoHidden: {
    opacity: 0,
  },
});
