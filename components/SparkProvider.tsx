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
import { fetchHomeShell } from "@/lib/home-client";
import {
  fetchSparkData,
  localSparkData,
  spendSpark,
  activateInfiniteSpark,
  activateSparkRefill,
} from "@/lib/spark-client";
import {
  applySparkSpend,
  computeSparkSnapshot,
  normalizeSparkState,
  coerceSparkState,
} from "@/lib/spark";
import { purchaseInfiniteSparkOnChain } from "@/lib/infinite-spark-purchase";
import { purchaseSparkRefillOnChain } from "@/lib/spark-refill-purchase";
import { getGuestSparksKey } from "@/lib/player-id";
import { SparkSnapshot, StoredSparkState } from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

const ACTIVATE_RETRY_DELAYS_MS = [0, 800, 2000, 4000];
const WALLET_COMING_SOON = "Wallet coming soon.";

async function activateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < ACTIVATE_RETRY_DELAYS_MS.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, ACTIVATE_RETRY_DELAYS_MS[i]));
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not credit payment. Please try again.");
}

function readGuestSparkState(guestId: string): StoredSparkState {
  if (typeof window === "undefined" || !guestId) {
    return localSparkData().state;
  }
  try {
    const raw = localStorage.getItem(getGuestSparksKey(guestId));
    if (!raw) return localSparkData().state;
    return coerceSparkState(JSON.parse(raw));
  } catch {
    return localSparkData().state;
  }
}

function writeGuestSparkState(guestId: string, state: StoredSparkState): void {
  if (typeof window === "undefined" || !guestId) return;
  localStorage.setItem(getGuestSparksKey(guestId), JSON.stringify(state));
}

interface SparkContextValue {
  sparks: SparkSnapshot;
  loading: boolean;
  refresh: () => Promise<void>;
  spendForGame: () => Promise<boolean>;
  purchaseInfiniteSpark: () => Promise<void>;
  purchaseSparkRefill: () => Promise<void>;
}

const SparkContext = createContext<SparkContextValue | null>(null);

export function useSparks(): SparkContextValue {
  const ctx = useContext(SparkContext);
  if (!ctx) {
    throw new Error("useSparks must be used within SparkProvider");
  }
  return ctx;
}

export default function SparkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { walletAddress, playerId, isGuest, isReady } = usePlayerProfile();
  const [state, setState] = useState<StoredSparkState>(
    () => localSparkData().state
  );
  const [loading, setLoading] = useState(true);
  const sparkWalletRef = useRef("");

  const sparks = useMemo(() => computeSparkSnapshot(state), [state]);

  const refresh = useCallback(async () => {
    if (isGuest && playerId) {
      setState(normalizeSparkState(readGuestSparkState(playerId)));
      return;
    }
    if (!walletAddress) {
      setState(localSparkData().state);
      return;
    }

    const data = await fetchSparkData(walletAddress);
    setState(coerceSparkState(data.state));
  }, [walletAddress, isGuest, playerId]);

  const spendForGame = useCallback(async (): Promise<boolean> => {
    if (isGuest && playerId) {
      const current = normalizeSparkState(readGuestSparkState(playerId));
      if (computeSparkSnapshot(current).hasInfinite) {
        setState(current);
        writeGuestSparkState(playerId, current);
        return false;
      }
      const next = applySparkSpend(current);
      if (!next) {
        throw new Error("No Sparks left. Wait for a refill or try again later.");
      }
      setState(next);
      writeGuestSparkState(playerId, next);
      return true;
    }

    if (!walletAddress) {
      throw new Error(WALLET_COMING_SOON);
    }

    const result = await spendSpark(walletAddress);
    setState(coerceSparkState(result.state));
    return result.spent;
  }, [walletAddress, isGuest, playerId]);

  const purchaseInfiniteSpark = useCallback(async (): Promise<void> => {
    if (isGuest || !walletAddress) {
      throw new Error(WALLET_COMING_SOON);
    }

    const { txHash } = await purchaseInfiniteSparkOnChain();
    const result = await activateWithRetry(() =>
      activateInfiniteSpark(walletAddress, txHash)
    );
    setState(coerceSparkState(result.state));
  }, [walletAddress, isGuest]);

  const purchaseSparkRefill = useCallback(async (): Promise<void> => {
    if (isGuest || !walletAddress) {
      throw new Error(WALLET_COMING_SOON);
    }

    const { txHash } = await purchaseSparkRefillOnChain();
    const result = await activateWithRetry(() =>
      activateSparkRefill(walletAddress, txHash)
    );
    setState(coerceSparkState(result.state));
  }, [walletAddress, isGuest]);

  useEffect(() => {
    if (isGuest && playerId) {
      sparkWalletRef.current = playerId;
      setState(normalizeSparkState(readGuestSparkState(playerId)));
      setLoading(false);
      return;
    }

    if (!walletAddress) {
      sparkWalletRef.current = "";
      setState(localSparkData().state);
      setLoading(false);
      return;
    }

    if (sparkWalletRef.current !== walletAddress) {
      sparkWalletRef.current = walletAddress;
      setLoading(true);
    }

    let cancelled = false;

    async function load() {
      try {
        const home = await fetchHomeShell(walletAddress);
        if (cancelled) return;
        if (home.state) {
          setState(coerceSparkState(home.state));
          setLoading(false);
          return;
        }
        if (!isReady) return;

        const data = await fetchSparkData(walletAddress);
        if (!cancelled) setState(coerceSparkState(data.state));
      } catch {
        if (!cancelled) setState(localSparkData().state);
      } finally {
        if (!cancelled && isReady) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, isGuest, playerId, isReady]);

  useEffect(() => {
    if (!walletAddress && !(isGuest && playerId)) return;

    const id = window.setInterval(() => {
      setState((prev) => {
        const next = normalizeSparkState(prev);
        if (isGuest && playerId) writeGuestSparkState(playerId, next);
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [walletAddress, isGuest, playerId]);

  const value = useMemo(
    () => ({
      sparks,
      loading,
      refresh,
      spendForGame,
      purchaseInfiniteSpark,
      purchaseSparkRefill,
    }),
    [
      sparks,
      loading,
      refresh,
      spendForGame,
      purchaseInfiniteSpark,
      purchaseSparkRefill,
    ]
  );

  return (
    <SparkContext.Provider value={value}>{children}</SparkContext.Provider>
  );
}
