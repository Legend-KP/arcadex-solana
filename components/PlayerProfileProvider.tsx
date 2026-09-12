"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DailyCheckInModal from "@/components/DailyCheckInModal";
import DailyShuffleModal from "@/components/DailyShuffleModal";
import DailyStreakBrokenModal from "@/components/DailyStreakBrokenModal";
import OnboardingModal from "@/components/OnboardingModal";
import PlayerNameModal from "@/components/PlayerNameModal";
import { fetchDailyPlayConfig } from "@/lib/daily-play-config-client";
import type { DailyPlayMode } from "@/lib/daily-play-mode";
import {
  hasShuffleDoneToday,
  markShuffleDoneToday,
} from "@/lib/shuffle-done-today";
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  preloadOnboardingSlides,
} from "@/lib/onboarding";
import {
  hasSeenStreakBroken,
  markStreakBrokenSeen,
} from "@/lib/streak-broken-seen";
import { fetchHomeShell } from "@/lib/home-client";
import {
  bootstrapPlayerProfile,
  savePlayerProfile,
} from "@/lib/player-profile-client";
import {
  clearCachedPlayerName,
  clearInvalidCachedWallet,
  clearStaleGuestId,
  getCachedPlayerName,
  getCachedWallet,
  setCachedPlayerName,
  setCachedWallet,
} from "@/lib/player-id";
import {
  ensureWalletSession,
  readWalletImmediately,
  resolveWalletForSave,
  resolveWalletOnAppOpen,
} from "@/lib/walletAuth";
import {
  isWalletAddress,
  normalizeWalletAddress,
} from "@/lib/wallet-address";
import { isArcadeXRewardsConfigured } from "@/lib/arcadex-rewards";
import {
  fetchStreakStatus,
  refreshSessionFromCheckIn,
  SessionRefreshError,
  type StreakStatus,
} from "@/lib/streak-client";
import {
  clearWalletSessionToken,
  hasValidWalletSession,
} from "@/lib/wallet-session-client";
import { PlayerProfile } from "@/types";

interface PlayerProfileContextValue {
  playerId: string;
  profile: PlayerProfile | null;
  playerName: string;
  walletAddress: string;
  isReady: boolean;
  streakStatus: StreakStatus | null;
  updateWalletAddress: (walletAddress: string) => Promise<void>;
  refreshStreakStatus: () => Promise<void>;
  openOnboarding: () => void;
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

function shouldShowNameModal(profile: PlayerProfile | null): boolean {
  return !hasPlayerName(profile);
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
  const [showCheckIn, setShowCheckIn] = useState(false);
  /** After the broken-streak animation, skip it for this session break. */
  const [streakBrokenDismissed, setStreakBrokenDismissed] = useState(false);
  /** null = resolving localStorage (blocks streak/name so they don't flash first) */
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [dailyPlayMode, setDailyPlayMode] = useState<DailyPlayMode>("streak");
  const [dailyCampaignId, setDailyCampaignId] = useState(1);
  const [streakStatus, setStreakStatus] = useState<StreakStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameCompleteRef = useRef(false);
  const pendingWalletRef = useRef<string | null>(null);

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

  const handleStreakBrokenContinue = useCallback(() => {
    if (walletAddress && streakStatus?.lastCheckInAt) {
      markStreakBrokenSeen(walletAddress, streakStatus.lastCheckInAt);
    }
    setStreakBrokenDismissed(true);
  }, [walletAddress, streakStatus?.lastCheckInAt]);

  useEffect(() => {
    setStreakBrokenDismissed(false);
  }, [walletAddress, streakStatus?.lastCheckInAt]);

  const refreshStreakStatus = useCallback(async () => {
    const wallet = walletAddress || getCachedWallet();
    if (!wallet || !isArcadeXRewardsConfigured()) {
      setStreakStatus(null);
      return;
    }
    try {
      const config = await fetchDailyPlayConfig();
      setDailyPlayMode(config.mode);
      setDailyCampaignId(config.campaignId);
      const status = await fetchStreakStatus(wallet, config.campaignId, {
        fresh: config.shuffle,
      });
      setStreakStatus(status);
    } catch {
      // Status is best-effort for UI
    }
  }, [walletAddress]);

  const finishProfileLoad = useCallback(async (wallet: string) => {
    const home = await fetchHomeShell(wallet);
    let user = home.user;
    if (!user) {
      user = await bootstrapPlayerProfile(wallet);
    } else {
      bootstrapPlayerProfile(wallet).catch(() => {
        // Spark/profile sync is best-effort after a cached profile load.
      });
    }

    setProfile(user);
    if (user.name) setCachedPlayerName(user.name);

    if (shouldShowNameModal(user)) {
      nameCompleteRef.current = false;
      setShowModal(true);
    } else {
      nameCompleteRef.current = syncNameCompletion(user);
      setShowModal(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolveWallet(): Promise<string | null> {
      const immediate = readWalletImmediately();
      if (immediate) return immediate;
      return resolveWalletOnAppOpen();
    }

    async function loadProfile() {
      clearInvalidCachedWallet();
      clearStaleGuestId();
      setError("");

      const cached = getCachedWallet();
      if (cached) {
        setCachedWallet(cached);
        setWalletAddress(cached);
        setPlayerId(cached);
      }

      const wallet = (await resolveWallet()) ?? cached;
      if (cancelled) return;

      if (!wallet) {
        setShowModal(true);
        nameCompleteRef.current = false;
        setIsReady(true);
        return;
      }

      setCachedWallet(wallet);
      setWalletAddress(wallet);
      setPlayerId(wallet);
      pendingWalletRef.current = wallet;

      try {
        // Catalog, plays, and sparks — do not wait on the Celo streak read.
        void fetchHomeShell(wallet);

        // Sign-in: ArcadeXRewards checkIn/spin → session JWT.
        if (isArcadeXRewardsConfigured()) {
          // Runtime config (Cloudflare vars) — do not rely on build-time NEXT_PUBLIC alone.
          const config = await fetchDailyPlayConfig({ fresh: true });
          if (cancelled) return;
          setDailyPlayMode(config.mode);
          setDailyCampaignId(config.campaignId);

          const status = await fetchStreakStatus(wallet, config.campaignId, {
            fresh: true,
          });
          if (cancelled) return;
          setStreakStatus(status);

          const shuffleAlreadyDone =
            config.shuffle &&
            (hasShuffleDoneToday(wallet, config.campaignId) ||
              (!status.canCheckIn && status.lastCheckInAt > 0));

          if (shuffleAlreadyDone) {
            markShuffleDoneToday(wallet, config.campaignId);
          }

          // Shuffle UI only when today is still available — never reopen if done.
          if (status.canCheckIn && !shuffleAlreadyDone) {
            clearWalletSessionToken();
            setShowCheckIn(true);
            setIsReady(true);
            return;
          }

          if (!hasValidWalletSession(wallet)) {
            try {
              await refreshSessionFromCheckIn(wallet, config.campaignId);
            } catch (err) {
              if (
                err instanceof SessionRefreshError &&
                err.code === "NEED_CHECKIN"
              ) {
                clearWalletSessionToken();
                // Already done today: restore session silently — do not show Shuffle UI.
                if (!status.canCheckIn || shuffleAlreadyDone) {
                  try {
                    await ensureWalletSession(wallet);
                  } catch {
                    // Continue into the app; API calls may prompt auth later.
                  }
                  await finishProfileLoad(wallet);
                  return;
                }
                setShowCheckIn(true);
                setIsReady(true);
                return;
              }
              throw err;
            }
          }
        } else if (!hasValidWalletSession(wallet)) {
          try {
            await ensureWalletSession(wallet);
          } catch {
            // personal_sign optional when rewards/auth not fully configured
          }
        }

        await finishProfileLoad(wallet);
      } catch (err) {
        if (cancelled) return;

        const cachedName = getCachedPlayerName()?.trim();
        if (cachedName) {
          const fallbackProfile: PlayerProfile = {
            id: wallet,
            name: cachedName,
            walletAddress: wallet,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          setProfile(fallbackProfile);
          nameCompleteRef.current = true;
          setShowModal(false);
          setError("");
          return;
        }

        nameCompleteRef.current = false;
        setShowModal(true);
        setError(
          err instanceof Error
            ? err.message
            : "Could not load your profile. Please try again."
        );
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [finishProfileLoad]);

  const handleCheckInComplete = useCallback(
    async (result: {
      day: number;
      milestone: boolean;
      infiniteSparkGranted: boolean;
    }) => {
      setShowCheckIn(false);
      const wallet = pendingWalletRef.current || walletAddress;
      if (!wallet) return;

      if (dailyPlayMode === "shuffle") {
        markShuffleDoneToday(wallet, dailyCampaignId);
      }

      try {
        await refreshStreakStatus();
        await finishProfileLoad(wallet);
        if (result.infiniteSparkGranted) {
          // SparkProvider will refresh via wallet / focus; status already updated
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Checked in, but could not load your profile."
        );
        setShowModal(true);
      }
    },
    [
      dailyCampaignId,
      dailyPlayMode,
      finishProfileLoad,
      refreshStreakStatus,
      walletAddress,
    ]
  );

  const handleSubmit = useCallback(
    async (name: string) => {
      setSaving(true);
      setError("");

      try {
        let wallet =
          walletAddress ||
          getCachedWallet() ||
          profile?.walletAddress ||
          readWalletImmediately();

        if (!wallet) {
          wallet = await resolveWalletForSave();
        }

        if (!isWalletAddress(wallet)) {
          throw new Error(
            "Could not connect your wallet. Open ArcadeX in MiniPay and try again."
          );
        }

        wallet = normalizeWalletAddress(wallet);

        if (!hasValidWalletSession(wallet)) {
          if (isArcadeXRewardsConfigured()) {
            const config = await fetchDailyPlayConfig();
            setDailyPlayMode(config.mode);
            setDailyCampaignId(config.campaignId);
            const status = await fetchStreakStatus(wallet, config.campaignId, {
              fresh: true,
            });
            setStreakStatus(status);
            if (status.canCheckIn && !hasShuffleDoneToday(wallet, config.campaignId)) {
              setShowCheckIn(true);
              throw new Error(
                config.shuffle
                  ? "Complete today's shuffle first."
                  : "Complete today's check-in first."
              );
            }
          }
          await ensureWalletSession(wallet);
        }

        const saved = await savePlayerProfile(wallet, name, wallet);

        setCachedWallet(wallet);
        setCachedPlayerName(saved.name);
        setWalletAddress(saved.walletAddress ?? wallet);
        setPlayerId(saved.id);
        setProfile(saved);
        nameCompleteRef.current = true;
        setShowModal(false);
      } catch (err) {
        nameCompleteRef.current = false;
        setShowModal(true);
        setError(
          err instanceof Error ? err.message : "Could not save your name."
        );
      } finally {
        setSaving(false);
      }
    },
    [walletAddress, profile?.walletAddress]
  );

  const updateWalletAddress = useCallback(
    async (nextWallet: string) => {
      if (!profile?.name) return;

      const wallet = nextWallet.trim();
      if (!hasValidWalletSession(wallet)) {
        await ensureWalletSession(wallet);
      }
      const saved = await savePlayerProfile(wallet, profile.name, wallet);
      setProfile(saved);
      setPlayerId(saved.id);
      setWalletAddress(wallet);
      setCachedWallet(wallet);
    },
    [profile?.name]
  );

  const defaultName =
    profile?.name?.trim() || getCachedPlayerName()?.trim() || "";

  const value = useMemo(
    () => ({
      playerId,
      profile,
      playerName: profile?.name ?? "",
      walletAddress,
      isReady,
      streakStatus,
      updateWalletAddress,
      refreshStreakStatus,
      openOnboarding,
    }),
    [
      playerId,
      profile,
      walletAddress,
      isReady,
      streakStatus,
      updateWalletAddress,
      refreshStreakStatus,
      openOnboarding,
    ]
  );

  // New-user order: onboarding → streak broken (if needed) → daily streak → name modal
  const onboardingVisible = showOnboarding === true;
  const onboardingResolved = showOnboarding !== null;
  const checkInVisible =
    onboardingResolved && !onboardingVisible && showCheckIn;

  const previousBrokenDays = streakStatus?.currentDay ?? 0;
  const lastBrokenCheckInAt = streakStatus?.lastCheckInAt ?? 0;
  const streakBrokenVisible =
    checkInVisible &&
    dailyPlayMode !== "shuffle" &&
    !streakBrokenDismissed &&
    Boolean(streakStatus?.streakWouldReset) &&
    previousBrokenDays > 0 &&
    Boolean(walletAddress) &&
    lastBrokenCheckInAt > 0 &&
    !hasSeenStreakBroken(walletAddress, lastBrokenCheckInAt);

  const dailyCheckInVisible =
    checkInVisible && dailyPlayMode !== "shuffle" && !streakBrokenVisible;
  const shuffleVisible =
    checkInVisible &&
    dailyPlayMode === "shuffle" &&
    Boolean(walletAddress) &&
    !hasShuffleDoneToday(walletAddress, dailyCampaignId) &&
    streakStatus?.canCheckIn === true;
  const nameModalVisible =
    onboardingResolved &&
    !onboardingVisible &&
    !showCheckIn &&
    showModal;

  return (
    <PlayerProfileContext.Provider value={value}>
      {children}
      <OnboardingModal
        open={onboardingVisible}
        onComplete={handleOnboardingComplete}
      />
      <DailyStreakBrokenModal
        open={streakBrokenVisible}
        previousDays={previousBrokenDays}
        onContinue={handleStreakBrokenContinue}
      />
      <DailyCheckInModal
        open={dailyCheckInVisible}
        walletAddress={walletAddress}
        status={streakStatus}
        onComplete={handleCheckInComplete}
      />
      <DailyShuffleModal
        open={shuffleVisible}
        walletAddress={walletAddress}
        campaignId={dailyCampaignId}
        status={streakStatus}
        onComplete={handleCheckInComplete}
      />
      <PlayerNameModal
        open={nameModalVisible}
        saving={saving}
        error={error}
        defaultName={defaultName}
        onSubmit={handleSubmit}
      />
    </PlayerProfileContext.Provider>
  );
}
