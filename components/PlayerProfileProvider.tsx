"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import OnboardingModal from "@/components/OnboardingModal";
import PlayerNameModal from "@/components/PlayerNameModal";
import ConnectWalletModal from "@/components/ConnectWalletModal";
import DailyShuffleModal from "@/components/DailyShuffleModal";
import DailyCheckInModal from "@/components/DailyCheckInModal";
import DailyStreakBrokenModal from "@/components/DailyStreakBrokenModal";
import {
  hasSeenMwaConnectPromptThisSession,
  markMwaConnectPromptSeen,
} from "@/lib/use-solana-mwa-connect";
import {
  isArcadexNativeShell,
  notifyNativeShuffleDone,
} from "@/lib/arcadex-native-bridge";
import {
  getCachedSolanaAddress,
  hasCachedSolanaSignIn,
} from "@/lib/solana-address";
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  preloadOnboardingSlides,
} from "@/lib/onboarding";
import {
  clearCachedPlayerName,
  clearInvalidCachedWallet,
  clearStaleGuestId,
  getCachedPlayerName,
  getCachedWallet,
  getOrCreateGuestId,
  setCachedPlayerName,
  setCachedWallet,
} from "@/lib/player-id";
import { fetchDailyPlayConfig } from "@/lib/daily-play-config-client";
import type { DailyPlayMode } from "@/lib/daily-play-mode";
import {
  hasShuffleDoneToday,
  markShuffleDoneToday,
} from "@/lib/shuffle-done-today";
import {
  hasSeenStreakBroken,
  markStreakBrokenSeen,
} from "@/lib/streak-broken-seen";
import {
  hasStreakPromptedToday,
  markStreakPromptedToday,
} from "@/lib/streak-prompted-today";
import {
  fetchStreakStatus,
  type StreakStatus,
} from "@/lib/streak-client";
import { savePlayerProfile } from "@/lib/player-profile-client";
import { grantGuestInfiniteSpark } from "@/lib/spark-client";
import { PlayerProfile } from "@/types";

interface PlayerProfileContextValue {
  playerId: string;
  profile: PlayerProfile | null;
  playerName: string;
  walletAddress: string;
  /** True when playing with a local guest UUID (no Solana wallet as player id). */
  isGuest: boolean;
  isReady: boolean;
  updateWalletAddress: (walletAddress: string) => Promise<void>;
  openOnboarding: () => void;
  openNameEditor: () => void;
  streakStatus: StreakStatus | null;
  refreshStreakStatus: () => Promise<void>;
}

const PlayerProfileContext = createContext<PlayerProfileContextValue | null>(
  null
);

export function usePlayerProfile(): PlayerProfileContextValue {
  const ctx = useContext(PlayerProfileContext);
  if (!ctx) {
    throw new Error("usePlayerProfile must be within PlayerProfileProvider");
  }
  return ctx;
}

function hasPlayerName(profile: PlayerProfile | null): boolean {
  return Boolean(profile?.name?.trim());
}

function syncNameCompletion(profile: PlayerProfile | null): boolean {
  const complete = hasPlayerName(profile);
  if (!complete) clearCachedPlayerName();
  return complete;
}

export default function PlayerProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";
  const isGameRoute = pathname.startsWith("/game");
  const isShuffleHostRoute =
    pathname === "/daily-shuffle" || pathname.startsWith("/daily-shuffle/");
  /** Shuffle / check-in only on home or the native shuffle overlay — never on games. */
  const canPromptDailyPlay = pathname === "/" || isShuffleHostRoute;

  const [playerId, setPlayerId] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [walletAddress, setWalletAddress] = useState(
    () => getCachedWallet() ?? ""
  );
  const [isReady, setIsReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [nameIntent, setNameIntent] = useState<"create" | "edit">("create");
  const [showConnectWallet, setShowConnectWallet] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [walletSignedIn, setWalletSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [dailyPlayMode, setDailyPlayMode] = useState<DailyPlayMode>("shuffle");
  const [dailyCampaignId, setDailyCampaignId] = useState(3);
  const [streakStatus, setStreakStatus] = useState<StreakStatus | null>(null);
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [streakBrokenDismissed, setStreakBrokenDismissed] = useState(false);
  const [dailyGateResolved, setDailyGateResolved] = useState(false);

  useEffect(() => {
    // Native shuffle overlay: skip onboarding chrome entirely.
    if (isShuffleHostRoute) {
      setShowOnboarding(false);
      return;
    }
    const unseen = !hasSeenOnboarding();
    setShowOnboarding(unseen);
    if (unseen) preloadOnboardingSlides();
  }, [isShuffleHostRoute]);

  const openOnboarding = useCallback(() => {
    setShowOnboarding(true);
  }, []);

  const openNameEditor = useCallback(() => {
    setError("");
    setNameIntent("edit");
    setShowModal(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    markOnboardingSeen();
    setShowOnboarding(false);
  }, []);

  useEffect(() => {
    clearInvalidCachedWallet();
    clearStaleGuestId();
    setError("");

    const cachedWallet = getCachedWallet();
    const guestId = getOrCreateGuestId();
    const cachedName = getCachedPlayerName()?.trim() ?? "";

    setWalletAddress(cachedWallet ?? "");
    setPlayerId(cachedWallet || guestId);

    if (cachedName) {
      const nextProfile: PlayerProfile = {
        id: cachedWallet || guestId,
        name: cachedName,
        ...(cachedWallet ? { walletAddress: cachedWallet } : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setProfile(nextProfile);
      syncNameCompletion(nextProfile);
    } else {
      setProfile(null);
      clearCachedPlayerName();
    }

    // Name is collected after wallet connect (not before).
    setWalletSignedIn(
      Boolean(getCachedSolanaAddress()) && hasCachedSolanaSignIn()
    );
    setShowModal(false);
    setIsReady(true);
  }, []);

  const needsPlayerName = useCallback(() => {
    return !hasPlayerName(profile) && !getCachedPlayerName()?.trim();
  }, [profile]);

  const promptNameAfterWallet = useCallback(() => {
    if (!needsPlayerName()) return;
    setError("");
    setNameIntent("create");
    setShowModal(true);
  }, [needsPlayerName]);

  const refreshStreakStatus = useCallback(async () => {
    const wallet =
      getCachedSolanaAddress() || getCachedWallet() || walletAddress;
    if (!wallet) {
      setStreakStatus(null);
      setCheckInVisible(false);
      setDailyGateResolved(true);
      return;
    }
    try {
      const config = await fetchDailyPlayConfig({ fresh: true });
      setDailyPlayMode(config.mode);
      setDailyCampaignId(config.campaignId);

      if (config.mode === "shuffle") {
        if (hasShuffleDoneToday(wallet, config.campaignId)) {
          setCheckInVisible(false);
          setDailyGateResolved(true);
          return;
        }
        try {
          const status = await fetchStreakStatus(wallet, config.campaignId, {
            fresh: true,
            mode: "shuffle",
          });
          setStreakStatus(status);
          if (!status.canCheckIn) {
            markShuffleDoneToday(
              wallet,
              config.campaignId,
              status.lastCheckInAt || Date.now()
            );
            setCheckInVisible(false);
          } else {
            setCheckInVisible(true);
          }
        } catch (err) {
          // Fail closed: never re-show jackpot on status errors (prevents
          // multiple plays within 24h when the API is briefly down).
          console.warn("shuffle status failed; keeping jackpot hidden", err);
          setCheckInVisible(false);
        }
      } else {
        // Once per UTC day on first app open. Server gates check-in by UTC day key;
        // local marker prevents re-prompting after dismiss/complete until next UTC day.
        if (hasStreakPromptedToday(wallet, config.campaignId)) {
          const status = await fetchStreakStatus(wallet, config.campaignId, {
            fresh: true,
            mode: "streak",
          });
          setStreakStatus(status);
          setCheckInVisible(false);
          setDailyGateResolved(true);
          return;
        }
        const status = await fetchStreakStatus(wallet, config.campaignId, {
          fresh: true,
          mode: "streak",
        });
        setStreakStatus(status);
        if (!status.canCheckIn) {
          markStreakPromptedToday(wallet, config.campaignId);
          setCheckInVisible(false);
        } else {
          markStreakPromptedToday(wallet, config.campaignId);
          setCheckInVisible(true);
        }
      }
    } catch (err) {
      console.warn("daily play refresh failed", err);
      setCheckInVisible(false);
    } finally {
      setDailyGateResolved(true);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!isReady) return;
    // Never prompt Daily Shuffle while a game is open (incl. native game WebView).
    if (isGameRoute || !canPromptDailyPlay) {
      setCheckInVisible(false);
      setDailyGateResolved(true);
      return;
    }
    if (showOnboarding === true) return;
    if (showModal) return;
    const wallet = getCachedSolanaAddress() || getCachedWallet();
    if (!wallet || !hasCachedSolanaSignIn()) {
      setDailyGateResolved(true);
      return;
    }
    void refreshStreakStatus();
  }, [
    isReady,
    isGameRoute,
    canPromptDailyPlay,
    showOnboarding,
    showModal,
    walletAddress,
    refreshStreakStatus,
  ]);

  // After Phantom connect/sign-in: ask for name (new users), then daily shuffle.
  useEffect(() => {
    const onConnected = () => {
      setWalletSignedIn(true);
      promptNameAfterWallet();
      void refreshStreakStatus();
    };
    window.addEventListener("arcadex-solana-connected", onConnected);
    return () =>
      window.removeEventListener("arcadex-solana-connected", onConnected);
  }, [promptNameAfterWallet, refreshStreakStatus]);

  const handleSubmit = useCallback(async (name: string) => {
    setSaving(true);
    setError("");

    try {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("Enter a player name.");
      }

      const guestId = getOrCreateGuestId();
      const cachedWallet = getCachedWallet();
      if (cachedWallet) {
        const user = await savePlayerProfile(cachedWallet, trimmed, cachedWallet);
        setCachedPlayerName(user.name);
        setPlayerId(cachedWallet);
        setWalletAddress(cachedWallet);
        setProfile(user);
        setShowModal(false);
        setNameIntent("create");
        return;
      }

      setCachedPlayerName(trimmed);
      const guestProfile: PlayerProfile = {
        id: cachedWallet || guestId,
        name: trimmed,
        ...(cachedWallet ? { walletAddress: cachedWallet } : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setPlayerId(cachedWallet || guestId);
      setWalletAddress(cachedWallet ?? "");
      setProfile(guestProfile);
      setShowModal(false);
      if (isArcadexNativeShell()) markMwaConnectPromptSeen();
    } catch (err) {
      setShowModal(true);
      setError(
        err instanceof Error ? err.message : "Could not save your name."
      );
    } finally {
      setSaving(false);
    }
  }, []);

  const updateWalletAddress = useCallback(
    async (nextWallet: string) => {
      const wallet = nextWallet.trim();
      if (!wallet) return;
      try {
        setCachedWallet(wallet);
      } catch {
        // invalid address — ignore
      }
      setWalletAddress(wallet);
      setPlayerId(wallet);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              id: wallet,
              walletAddress: wallet,
              updatedAt: Date.now(),
            }
          : prev
      );
    },
    []
  );

  const handleDailyComplete = useCallback(
    (result: {
      day: number;
      milestone: boolean;
      infiniteSparkGranted: boolean;
    }) => {
      const wallet =
        getCachedSolanaAddress() || getCachedWallet() || walletAddress;
      if (wallet && dailyPlayMode === "shuffle") {
        markShuffleDoneToday(wallet, dailyCampaignId);
      }
      if (wallet && dailyPlayMode === "streak") {
        markStreakPromptedToday(wallet, dailyCampaignId);
      }
      if (result.infiniteSparkGranted) {
        grantGuestInfiniteSpark();
      }
      setCheckInVisible(false);
      if (isShuffleHostRoute) {
        notifyNativeShuffleDone();
      }
      void refreshStreakStatus();
    },
    [
      walletAddress,
      dailyPlayMode,
      dailyCampaignId,
      isShuffleHostRoute,
      refreshStreakStatus,
    ]
  );

  const handleDailyCheckInClose = useCallback(() => {
    const wallet =
      getCachedSolanaAddress() || getCachedWallet() || walletAddress;
    if (wallet) markStreakPromptedToday(wallet, dailyCampaignId);
    setCheckInVisible(false);
    if (isShuffleHostRoute) {
      notifyNativeShuffleDone();
    }
  }, [walletAddress, dailyCampaignId, isShuffleHostRoute]);

  const handleStreakBrokenContinue = useCallback(() => {
    if (walletAddress && streakStatus?.lastCheckInAt) {
      markStreakBrokenSeen(walletAddress, streakStatus.lastCheckInAt);
    }
    setStreakBrokenDismissed(true);
  }, [walletAddress, streakStatus?.lastCheckInAt]);

  useEffect(() => {
    setStreakBrokenDismissed(false);
  }, [walletAddress, streakStatus?.lastCheckInAt]);

  const defaultName =
    profile?.name?.trim() || getCachedPlayerName()?.trim() || "";

  const isGuest = Boolean(playerId) && !walletAddress;

  const value = useMemo(
    () => ({
      playerId,
      profile,
      playerName: profile?.name?.trim() || getCachedPlayerName()?.trim() || "",
      walletAddress,
      isGuest,
      isReady,
      updateWalletAddress,
      openOnboarding,
      openNameEditor,
      streakStatus,
      refreshStreakStatus,
    }),
    [
      playerId,
      profile,
      walletAddress,
      isGuest,
      isReady,
      updateWalletAddress,
      openOnboarding,
      openNameEditor,
      streakStatus,
      refreshStreakStatus,
    ]
  );

  const onboardingVisible = showOnboarding === true;
  const onboardingResolved = showOnboarding !== null;

  // New flow: onboarding → wallet connect → name (required after connect).
  useEffect(() => {
    if (!isReady) return;
    if (isShuffleHostRoute || isGameRoute) return;
    if (!onboardingResolved || onboardingVisible) return;
    if (showModal) return;

    if (isArcadexNativeShell()) {
      if (!walletSignedIn) {
        if (!hasSeenMwaConnectPromptThisSession()) {
          setShowConnectWallet(true);
        }
        return;
      }
      setShowConnectWallet(false);
      if (needsPlayerName()) {
        setNameIntent("create");
        setShowModal(true);
      }
      return;
    }

    // Browser / non-native: keep a local name prompt after onboarding.
    if (needsPlayerName()) {
      setNameIntent("create");
      setShowModal(true);
    }
  }, [
    isReady,
    isShuffleHostRoute,
    isGameRoute,
    onboardingResolved,
    onboardingVisible,
    showModal,
    walletSignedIn,
    needsPlayerName,
  ]);

  const nameModalVisible =
    onboardingResolved &&
    !onboardingVisible &&
    showModal &&
    (!isArcadexNativeShell() || walletSignedIn || nameIntent === "edit");

  const connectWalletVisible =
    onboardingResolved &&
    !onboardingVisible &&
    !nameModalVisible &&
    showConnectWallet;

  const handleConnectWalletClose = useCallback(() => {
    markMwaConnectPromptSeen();
    setShowConnectWallet(false);
  }, []);

  const solanaWallet =
    getCachedSolanaAddress() || walletAddress || getCachedWallet() || "";

  const previousBrokenDays = streakStatus?.currentDay ?? 0;
  const lastBrokenCheckInAt = streakStatus?.lastCheckInAt ?? 0;
  const streakBrokenVisible =
    canPromptDailyPlay &&
    !isGameRoute &&
    dailyGateResolved &&
    dailyPlayMode === "streak" &&
    !streakBrokenDismissed &&
    Boolean(streakStatus?.streakWouldReset) &&
    Boolean(solanaWallet) &&
    !hasSeenStreakBroken(solanaWallet, lastBrokenCheckInAt);

  const dailyShuffleVisible =
    canPromptDailyPlay &&
    !isGameRoute &&
    dailyGateResolved &&
    dailyPlayMode === "shuffle" &&
    checkInVisible &&
    Boolean(solanaWallet) &&
    !connectWalletVisible &&
    !nameModalVisible &&
    !onboardingVisible;

  const dailyCheckInVisible =
    canPromptDailyPlay &&
    !isGameRoute &&
    dailyGateResolved &&
    dailyPlayMode === "streak" &&
    checkInVisible &&
    !streakBrokenVisible &&
    Boolean(solanaWallet) &&
    !connectWalletVisible &&
    !nameModalVisible &&
    !onboardingVisible;

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
      <OnboardingModal
        open={onboardingVisible}
        onComplete={handleOnboardingComplete}
      />
      <PlayerNameModal
        open={nameModalVisible}
        saving={saving}
        error={error}
        defaultName={defaultName}
        intent={nameIntent}
        onSubmit={handleSubmit}
        onClose={
          nameIntent === "edit" ? () => setShowModal(false) : undefined
        }
      />
      <ConnectWalletModal
        open={connectWalletVisible}
        onClose={handleConnectWalletClose}
        onConnected={(address) => {
          markMwaConnectPromptSeen();
          setWalletSignedIn(true);
          setShowConnectWallet(false);
          void updateWalletAddress(address);
          promptNameAfterWallet();
          void refreshStreakStatus();
        }}
      />
      <DailyShuffleModal
        open={dailyShuffleVisible}
        walletAddress={solanaWallet}
        campaignId={dailyCampaignId}
        status={streakStatus}
        onComplete={handleDailyComplete}
      />
      <DailyStreakBrokenModal
        open={streakBrokenVisible}
        previousDays={previousBrokenDays}
        onContinue={handleStreakBrokenContinue}
      />
      <DailyCheckInModal
        open={dailyCheckInVisible}
        walletAddress={solanaWallet}
        status={streakStatus}
        onComplete={handleDailyComplete}
        onClose={handleDailyCheckInClose}
      />
    </PlayerProfileContext.Provider>
  );
}
