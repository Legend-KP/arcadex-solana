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
    }),
    [
      playerId,
      profile,
      walletAddress,
      isGuest,
      isReady,
      updateWalletAddress,
      openOnboarding,
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
        onConnected={() => {
          markMwaConnectPromptSeen();
        }}
      />
    </PlayerProfileContext.Provider>
  );
}
