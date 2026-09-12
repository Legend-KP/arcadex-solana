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
import { fetchSparkData, localSparkData, spendSpark, activateInfiniteSpark, activateSparkRefill } from "@/lib/spark-client";
import { computeSparkSnapshot, normalizeSparkState, coerceSparkState } from "@/lib/spark";
import { purchaseInfiniteSparkOnChain } from "@/lib/infinite-spark-purchase";
import { purchaseSparkRefillOnChain } from "@/lib/spark-refill-purchase";
import { SparkSnapshot, StoredSparkState } from "@/types";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

const ACTIVATE_RETRY_DELAYS_MS = [0, 800, 2000, 4000];

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
  const { walletAddress, isReady } = usePlayerProfile();
  const [state, setState] = useState<StoredSparkState>(
    () => localSparkData().state
  );
  const [loading, setLoading] = useState(true);
  const sparkWalletRef = useRef("");

  const sparks = useMemo(
    () => computeSparkSnapshot(state),
    [state]
  );

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState(localSparkData().state);
      return;
    }

    const data = await fetchSparkData(walletAddress);
    setState(coerceSparkState(data.state));
  }, [walletAddress]);

  const spendForGame = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) {
      throw new Error("Connect your wallet in MiniPay to play.");
    }

    const result = await spendSpark(walletAddress);
    setState(coerceSparkState(result.state));
    return result.spent;
  }, [walletAddress]);

  const purchaseInfiniteSpark = useCallback(async (): Promise<void> => {
    if (!walletAddress) {
      throw new Error("Connect your wallet in MiniPay to purchase Infinite Spark.");
    }

    const { txHash } = await purchaseInfiniteSparkOnChain();
    const result = await activateWithRetry(() =>
      activateInfiniteSpark(walletAddress, txHash)
    );
    setState(coerceSparkState(result.state));
  }, [walletAddress]);

  const purchaseSparkRefill = useCallback(async (): Promise<void> => {
    if (!walletAddress) {
      throw new Error("Connect your wallet in MiniPay to purchase Spark Refill.");
    }

    const { txHash } = await purchaseSparkRefillOnChain();
    const result = await activateWithRetry(() =>
      activateSparkRefill(walletAddress, txHash)
    );
    setState(coerceSparkState(result.state));
  }, [walletAddress]);

  useEffect(() => {
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
        // No session yet — wait for profile/streak to finish, then retry.
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
  }, [walletAddress, isReady]);

  useEffect(() => {
    if (!walletAddress) return;

    const id = window.setInterval(() => {
      setState((prev) => normalizeSparkState(prev));
    }, 1000);

    return () => window.clearInterval(id);
  }, [walletAddress]);

  const value = useMemo(
    () => ({
      sparks,
      loading,
      refresh,
      spendForGame,
      purchaseInfiniteSpark,
      purchaseSparkRefill,
    }),
    [sparks, loading, refresh, spendForGame, purchaseInfiniteSpark, purchaseSparkRefill]
  );

  return (
    <SparkContext.Provider value={value}>{children}</SparkContext.Provider>
  );
}
