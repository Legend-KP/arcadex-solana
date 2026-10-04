import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;

import { Component, useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Haptics from "expo-haptics";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  bootstrapPlayer,
  confirmSolanaPayment,
  createWalletSession,
  fetchShuffleCanCheckIn,
  hasStreakPromptedToday,
  markStreakPromptedToday,
  savePlayerName,
} from "./src/api";
import { clearSession, loadSession, saveSession } from "./src/session";
import {
  grantSparkPurpose,
  importSparkStateJson,
  loadSparkState,
} from "./src/sparks";
import HomeScreen from "./src/screens/HomeScreen";
import IntroSplash, { INTRO_BG } from "./src/screens/IntroSplash";
import WalletSheet from "./src/screens/WalletSheet";
import SparksSheet from "./src/screens/SparksSheet";
import PlayerNameSheet from "./src/screens/PlayerNameSheet";
import ShuffleSheet from "./src/screens/ShuffleSheet";
import GameScreen from "./src/screens/GameScreen";
import { pushRecentPlayId } from "./src/game-utils";
import { colors } from "./src/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

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
    <SafeAreaProvider>
      <ShellErrorBoundary>
        <ArcadeShell />
      </ShellErrorBoundary>
    </SafeAreaProvider>
  );
}

function ArcadeShell() {
  const [session, setSession] = useState(null);
  const [sparks, setSparks] = useState(null);
  const [screen, setScreen] = useState("home");
  const [activeGame, setActiveGame] = useState(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [sparksOpen, setSparksOpen] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [sparksError, setSparksError] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameIntent, setNameIntent] = useState("setup");
  const [booted, setBooted] = useState(false);
  /** Cold-start only — resets when the process restarts, not when leaving a game. */
  const [introDone, setIntroDone] = useState(false);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const shufflePromptedForRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedSession, sparkSnap] = await Promise.all([
        loadSession(),
        loadSparkState(),
      ]);
      if (cancelled) return;
      setSession(savedSession);
      setSparks(sparkSnap);
      // Returning signed-in users without a name must finish profile setup.
      if (savedSession?.address && !savedSession?.playerName?.trim()) {
        setNameIntent("setup");
        setNameOpen(true);
      }
      setBooted(true);
    })().catch(() => {
      if (!cancelled) {
        setBooted(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hideSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Daily Streak: once per UTC day on first home open — never when a game is open.
  useEffect(() => {
    if (!booted || screen !== "home") return;
    if (nameOpen || walletOpen || sparksOpen || shuffleOpen) return;
    const wallet = session?.address?.trim();
    if (!wallet) return;
    if (!session?.playerName?.trim()) return;
    if (shufflePromptedForRef.current === wallet) return;

    let cancelled = false;
    (async () => {
      try {
        if (await hasStreakPromptedToday(wallet)) {
          if (!cancelled) shufflePromptedForRef.current = wallet;
          return;
        }
        const can = await fetchShuffleCanCheckIn(wallet);
        if (cancelled) return;
        shufflePromptedForRef.current = wallet;
        if (can) {
          await markStreakPromptedToday(wallet);
          if (!cancelled) setShuffleOpen(true);
        } else {
          await markStreakPromptedToday(wallet);
        }
      } catch {
        if (!cancelled) shufflePromptedForRef.current = wallet;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    booted,
    screen,
    nameOpen,
    walletOpen,
    sparksOpen,
    shuffleOpen,
    session?.address,
    session?.playerName,
  ]);

  const connectWallet = useCallback(async () => {
    setWalletBusy(true);
    setWalletError("");
    try {
      const mwa = await import("./mwa");
      const signedIn = await mwa.connectAndSignInMwaWallet(AsyncStorage);

      let token = null;
      try {
        const sessionRes = await createWalletSession({
          walletAddress: signedIn.address,
          message: signedIn.message,
          signatureBase64: signedIn.signatureBase64,
        });
        token = sessionRes.token || null;
        if (token) {
          await bootstrapPlayer(signedIn.address, token).catch(() => null);
        }
      } catch (err) {
        // Payments still work without JWT; games that need server auth may be limited.
        console.warn("wallet_session_failed", err?.message || err);
      }

      const existingName = session?.playerName?.trim() || null;
      const next = {
        token,
        address: signedIn.address,
        label: signedIn.label ?? null,
        playerName: existingName,
        message: signedIn.message,
        signatureBase64: signedIn.signatureBase64,
      };
      await saveSession(next);
      setSession(next);
      setWalletOpen(false);
      if (!existingName) {
        setNameError("");
        setNameIntent("setup");
        setNameOpen(true);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setWalletError(
        err instanceof Error ? err.message : "Wallet connect failed."
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setWalletBusy(false);
    }
  }, [session?.playerName]);

  const disconnectWallet = useCallback(async () => {
    setWalletBusy(true);
    setWalletError("");
    try {
      const mwa = await import("./mwa");
      await mwa.disconnectMwaWallet(AsyncStorage);
    } catch {
      // Still clear local session.
    }
    await clearSession();
    setSession({
      token: null,
      address: null,
      label: null,
      playerName: null,
      message: null,
      signatureBase64: null,
    });
    setNameOpen(false);
    setWalletBusy(false);
  }, []);

  const submitPlayerName = useCallback(
    async (name) => {
      if (!session?.address) return;
      setNameBusy(true);
      setNameError("");
      try {
        await savePlayerName(session.address, name, session.token).catch(
          () => null
        );
        const next = {
          ...session,
          playerName: name,
          label: name,
        };
        await saveSession(next);
        setSession(next);
        setNameOpen(false);
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
      } catch (err) {
        setNameError(
          err instanceof Error ? err.message : "Could not save your name."
        );
      } finally {
        setNameBusy(false);
      }
    },
    [session]
  );

  const buySpark = useCallback(
    async (purpose) => {
      if (!session?.address) {
        setSparksOpen(false);
        setWalletOpen(true);
        return;
      }
      setPayBusy(true);
      setSparksError("");
      try {
        const mwa = await import("./mwa");
        const paid = await mwa.payArcadeFeeMwa(AsyncStorage, {
          purpose,
          token: "USDC",
          payerBase58: session.address,
        });
        await confirmSolanaPayment({
          signature: paid.signature,
          walletAddress: paid.address || session.address,
          purpose,
        });
        const next = await grantSparkPurpose(purpose);
        setSparks(next);
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
      } catch (err) {
        setSparksError(
          err instanceof Error ? err.message : "Payment failed."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setPayBusy(false);
      }
    },
    [session?.address]
  );

  // Cold open: play full intro even if session/sparks already loaded.
  // Returning from a game keeps introDone=true so this never re-runs.
  if (!introDone) {
    return (
      <IntroSplash
        onReady={hideSplash}
        onFinished={() => setIntroDone(true)}
      />
    );
  }

  if (!booted) {
    return <View style={[styles.boot, { backgroundColor: INTRO_BG }]} />;
  }

  if (screen === "game" && activeGame) {
    return (
      <>
        <StatusBar style="light" translucent={false} backgroundColor="#000000" />
        <GameScreen
          game={activeGame}
          session={session}
          sparkState={sparks?.state}
          onBack={(opts = {}) => {
            setScreen("home");
            setActiveGame(null);
            if (opts?.openSparks) {
              setSparksError("");
              setSparksOpen(true);
            }
            loadSparkState().then(setSparks).catch(() => {});
          }}
          onSparksExport={async (stateJson) => {
            const next = await importSparkStateJson(stateJson);
            setSparks(next);
          }}
          onWalletBusyError={setWalletError}
        />
      </>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <HomeScreen
        session={session}
        sparks={sparks}
        onReady={hideSplash}
        onOpenWallet={() => {
          setWalletError("");
          setWalletOpen(true);
        }}
        onOpenSparks={() => {
          setSparksError("");
          setSparksOpen(true);
        }}
        onEditName={() => {
          if (!session?.address) {
            setWalletError("");
            setWalletOpen(true);
            return;
          }
          setNameError("");
          setNameIntent("edit");
          setNameOpen(true);
        }}
        onOpenGame={(game) => {
          pushRecentPlayId(game.id).catch(() => {});
          setActiveGame(game);
          setScreen("game");
        }}
      />

      <WalletSheet
        visible={walletOpen}
        session={session}
        busy={walletBusy}
        error={walletError}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
        onClose={() => setWalletOpen(false)}
      />

      <SparksSheet
        visible={sparksOpen}
        sparks={sparks}
        connected={Boolean(session?.address)}
        busy={payBusy}
        error={sparksError}
        onConnect={() => {
          setSparksOpen(false);
          setWalletOpen(true);
        }}
        onRefill={() => buySpark("spark_refill")}
        onInfinite={() => buySpark("infinite_spark")}
        onClose={() => setSparksOpen(false)}
      />

      <PlayerNameSheet
        visible={nameOpen}
        walletAddress={session?.address}
        busy={nameBusy}
        error={nameError}
        intent={nameIntent}
        defaultName={session?.playerName || ""}
        onSubmit={submitPlayerName}
        onClose={() => {
          if (nameIntent === "edit") setNameOpen(false);
        }}
      />

      <ShuffleSheet
        visible={shuffleOpen}
        session={session}
        sparkState={sparks?.state}
        onClose={() => {
          const wallet = session?.address?.trim();
          if (wallet) void markStreakPromptedToday(wallet);
          setShuffleOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgSoft },
  boot: { flex: 1, backgroundColor: INTRO_BG },
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
