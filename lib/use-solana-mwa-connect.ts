"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isArcadexNativeShell,
  requestMwaConnectAndSignIn,
  requestMwaDisconnect,
} from "@/lib/arcadex-native-bridge";
import {
  clearCachedSolanaAddress,
  getCachedSolanaAddress,
  getCachedSolanaLabel,
  hasCachedSolanaSignIn,
  setCachedSolanaAddress,
  setCachedSolanaSignIn,
} from "@/lib/solana-address";

export function useSolanaMwaConnect() {
  const [native, setNative] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNative(isArcadexNativeShell());
    setAddress(getCachedSolanaAddress());
    setLabel(getCachedSolanaLabel());
    setSignedIn(hasCachedSolanaSignIn());

    const onConnected = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          address?: string;
          label?: string | null;
          signedIn?: boolean;
        }>
      ).detail;
      if (detail?.address) {
        setAddress(detail.address);
        setLabel(detail.label ?? null);
        setSignedIn(Boolean(detail.signedIn) || hasCachedSolanaSignIn());
      }
    };
    const onDisconnected = () => {
      setAddress(null);
      setLabel(null);
      setSignedIn(false);
    };
    window.addEventListener("arcadex-solana-connected", onConnected);
    window.addEventListener("arcadex-solana-disconnected", onDisconnected);
    return () => {
      window.removeEventListener("arcadex-solana-connected", onConnected);
      window.removeEventListener("arcadex-solana-disconnected", onDisconnected);
    };
  }, []);

  /** Step 4+5: connect wallet and sign free ArcadeX sign-in message. */
  const connect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestMwaConnectAndSignIn();
      setCachedSolanaAddress(result.address, result.label ?? undefined);
      setCachedSolanaSignIn(result.message, result.signatureBase64);
      setAddress(result.address);
      setLabel(result.label ?? null);
      setSignedIn(true);
      window.dispatchEvent(
        new CustomEvent("arcadex-solana-connected", {
          detail: {
            address: result.address,
            label: result.label ?? null,
            signedIn: true,
          },
        })
      );
      return result.address;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not connect / sign in with wallet.";
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
    setSignedIn(false);
    window.dispatchEvent(new CustomEvent("arcadex-solana-disconnected"));
    setBusy(false);
  }, []);

  return {
    native,
    address,
    label,
    signedIn,
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
