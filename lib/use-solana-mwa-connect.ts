"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isArcadexNativeShell,
  requestMwaConnect,
  requestMwaDisconnect,
} from "@/lib/arcadex-native-bridge";
import {
  clearCachedSolanaAddress,
  getCachedSolanaAddress,
  getCachedSolanaLabel,
  setCachedSolanaAddress,
} from "@/lib/solana-address";

export function useSolanaMwaConnect() {
  const [native, setNative] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNative(isArcadexNativeShell());
    setAddress(getCachedSolanaAddress());
    setLabel(getCachedSolanaLabel());

    const onConnected = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string; label?: string | null }>)
        .detail;
      if (detail?.address) {
        setAddress(detail.address);
        setLabel(detail.label ?? null);
      }
    };
    const onDisconnected = () => {
      setAddress(null);
      setLabel(null);
    };
    window.addEventListener("arcadex-solana-connected", onConnected);
    window.addEventListener("arcadex-solana-disconnected", onDisconnected);
    return () => {
      window.removeEventListener("arcadex-solana-connected", onConnected);
      window.removeEventListener("arcadex-solana-disconnected", onDisconnected);
    };
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestMwaConnect();
      setCachedSolanaAddress(result.address, result.label ?? undefined);
      setAddress(result.address);
      setLabel(result.label ?? null);
      window.dispatchEvent(
        new CustomEvent("arcadex-solana-connected", {
          detail: { address: result.address, label: result.label ?? null },
        })
      );
      return result.address;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not connect wallet.";
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await requestMwaDisconnect();
    } catch {
      // Still clear local cache.
    }
    clearCachedSolanaAddress();
    setAddress(null);
    setLabel(null);
    window.dispatchEvent(new CustomEvent("arcadex-solana-disconnected"));
    setBusy(false);
  }, []);

  return {
    native,
    address,
    label,
    busy,
    error,
    setError,
    connected: Boolean(address),
    connect,
    disconnect,
  };
}

const PROMPT_SEEN_KEY = "arcadex_mwa_connect_prompt_seen";

export function hasSeenMwaConnectPromptThisSession(): boolean {
  if (typeof window === "undefined") return true;
  return sessionStorage.getItem(PROMPT_SEEN_KEY) === "1";
}

export function markMwaConnectPromptSeen(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PROMPT_SEEN_KEY, "1");
}
