"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
import { isArcadexNativeShell } from "@/lib/arcadex-native-bridge";
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
  fetchStreakStatus,
  type StreakStatus,
} from "@/lib/streak-client";
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
  const [playerId, setPlayerId] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [walletAddress, setWalletAddress] = useState(
    () => getCachedWallet() ?? ""
  );
  const [isReady, setIsReady] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showConnectWallet, setShowConnectWallet] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [dailyPlayMode, setDailyPlayMode] = useState<DailyPlayMode>("shuffle");
  const [dailyCampaignId, setDailyCampaignId] = useState(3);
  const [streakStatus, setStreakStatus] = useState<StreakStatus | null>(null);
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [streakBrokenDismissed, setStreakBrokenDismissed] = useState(false);
  const [dailyGateResolved, setDailyGateResolved] = useState(false);

  useEffect(() => {
    const unseen = !hasSeenOnboarding();
    setShowOnboarding(unseen);
    if (unseen) preloadOnboardingSlides();
  }, []);

  const openOnboarding = useCallback(() => {
    setShowOnboarding(true);
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
      setShowModal(false);
    } else {
      setProfile(null);
      setShowModal(true);
    }

    setIsReady(true);
  }, []);

  const refreshStreakStatus = useCallback(async () => {
    const wallet =
      getCachedSolanaAddress() || getCachedWallet() || walletAddress;
    if (!wallet) {
      setStreakStatus(null);
      setDailyGateResolved(true);
      return;
    }
    try {
      const config = await fetchDailyPlayConfig();
      setDailyPlayMode(config.mode);
      setDailyCampaignId(config.campaignId);
      const status = await fetchStreakStatus(wallet, config.campaignId, {
        fresh: true,
        mode: config.mode,
      });
      setStreakStatus(status);

      if (config.mode === "shuffle") {
        const shuffleAlreadyDone = hasShuffleDoneToday(
          wallet,
          config.campaignId
        );
        if (shuffleAlreadyDone || !status.canCheckIn) {
          markShuffleDoneToday(wallet, config.campaignId);
          setCheckInVisible(false);
        } else {
          setCheckInVisible(true);
        }
      } else {
        // Streak mode — open check-in when due.
        setCheckInVisible(Boolean(status.canCheckIn));
      }
    } catch {
      setCheckInVisible(false);
    } finally {
      setDailyGateResolved(true);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!isReady) return;
    if (showOnboarding === true) return;
    if (showModal) return;
    const wallet = getCachedSolanaAddress() || getCachedWallet();
    if (!wallet || !hasCachedSolanaSignIn()) {
      setDailyGateResolved(true);
      return;
    }
    void refreshStreakStatus();
  }, [isReady, showOnboarding, showModal, walletAddress, refreshStreakStatus]);

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
      if (!profile?.name) return;
      const wallet = nextWallet.trim();
      setProfile({
        ...profile,
        id: wallet || profile.id,
        walletAddress: wallet || undefined,
        updatedAt: Date.now(),
      });
      setPlayerId(wallet || profile.id);
      setWalletAddress(wallet);
    },
    [profile]
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
      if (result.infiniteSparkGranted) {
        grantGuestInfiniteSpark();
      }
      setCheckInVisible(false);
      void refreshStreakStatus();
    },
    [walletAddress, dailyPlayMode, dailyCampaignId, refreshStreakStatus]
  );

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
      playerName: profile?.name ?? "",
      walletAddress,
      isGuest,
      isReady,
      updateWalletAddress,
      openOnboarding,
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
      streakStatus,
      refreshStreakStatus,
    ]
  );

  const onboardingVisible = showOnboarding === true;
  const onboardingResolved = showOnboarding !== null;
  const nameModalVisible =
    onboardingResolved && !onboardingVisible && showModal;

  useEffect(() => {
    if (!isReady) return;
    if (!onboardingResolved || onboardingVisible) return;
    if (showModal) return;
    if (!isArcadexNativeShell()) return;
    if (getCachedSolanaAddress() && hasCachedSolanaSignIn()) return;
    if (hasSeenMwaConnectPromptThisSession()) return;
    if (!hasPlayerName(profile) && !getCachedPlayerName()?.trim()) return;

    setShowConnectWallet(true);
  }, [
    isReady,
    onboardingResolved,
    onboardingVisible,
    showModal,
    profile,
  ]);

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
    dailyGateResolved &&
    dailyPlayMode === "streak" &&
    !streakBrokenDismissed &&
    Boolean(streakStatus?.streakWouldReset) &&
    Boolean(solanaWallet) &&
    !hasSeenStreakBroken(solanaWallet, lastBrokenCheckInAt);

  const dailyShuffleVisible =
    dailyGateResolved &&
    dailyPlayMode === "shuffle" &&
    checkInVisible &&
    Boolean(solanaWallet) &&
    !connectWalletVisible &&
    !nameModalVisible &&
    !onboardingVisible;

  const dailyCheckInVisible =
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
        onSubmit={handleSubmit}
      />
      <ConnectWalletModal
        open={connectWalletVisible}
        onClose={handleConnectWalletClose}
        onConnected={(address) => {
          markMwaConnectPromptSeen();
          void updateWalletAddress(address);
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
      />
    </PlayerProfileContext.Provider>
  );
}
