"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadGuestSparkData,
  spendGuestSpark,
} from "@/lib/spark-client";
import {
  computeSparkSnapshot,
  normalizeSparkState,
  coerceSparkState,
} from "@/lib/spark";
import { writeGuestSparkStateJson } from "@/lib/player-id";
import {
  purchaseInfiniteSparkOnSolana,
  purchaseSparkRefillOnSolana,
} from "@/lib/solana-purchases";
import { isArcadexNativeShell } from "@/lib/arcadex-native-bridge";
import {
  getCachedSolanaAddress,
  hasCachedSolanaSignIn,
} from "@/lib/solana-address";
import { SparkSnapshot, StoredSparkState } from "@/types";

export const WALLET_COMING_SOON =
  "Connect & sign in with your Solana wallet first.";

function canPayWithSolana(): boolean {
  return (
    isArcadexNativeShell() &&
    Boolean(getCachedSolanaAddress()) &&
    hasCachedSolanaSignIn()
  );
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
  const [state, setState] = useState<StoredSparkState>(
    () => loadGuestSparkData().state
  );
  const [loading, setLoading] = useState(true);

  const sparks = useMemo(() => computeSparkSnapshot(state), [state]);

  const refresh = useCallback(async () => {
    const guest = loadGuestSparkData();
    setState(guest.state);
  }, []);

  const spendForGame = useCallback(async (): Promise<boolean> => {
    const result = spendGuestSpark();
    setState(coerceSparkState(result.state));
    return result.spent;
  }, []);

  const purchaseInfiniteSpark = useCallback(async (): Promise<void> => {
    if (!canPayWithSolana()) {
      throw new Error(WALLET_COMING_SOON);
    }
    const result = await purchaseInfiniteSparkOnSolana("USDC");
    setState(coerceSparkState(result.state));
  }, []);

  const purchaseSparkRefill = useCallback(async (): Promise<void> => {
    if (!canPayWithSolana()) {
      throw new Error(WALLET_COMING_SOON);
    }
    const result = await purchaseSparkRefillOnSolana("USDC");
    setState(coerceSparkState(result.state));
  }, []);

  useEffect(() => {
    setState(loadGuestSparkData().state);
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setState((prev) => {
        const next = normalizeSparkState(prev);
        writeGuestSparkStateJson(JSON.stringify(next));
        return next;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

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
