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
  truncateSolanaAddress,
} from "@/lib/solana-address";
import { playTouchSfx } from "@/lib/sfx";

/**
 * Connect-only Solana wallet control for the Expo / Seeker shell.
 * Hidden in normal browsers (guest play continues without it).
 */
export default function ConnectWalletButton() {
  const [native, setNative] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNative(isArcadexNativeShell());
    setAddress(getCachedSolanaAddress());
    setLabel(getCachedSolanaLabel());
  }, []);

  const connect = useCallback(async () => {
    playTouchSfx();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect wallet.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    playTouchSfx();
    setBusy(true);
    setError("");
    try {
      await requestMwaDisconnect();
    } catch {
      // Still clear local cache so UI recovers.
    }
    clearCachedSolanaAddress();
    setAddress(null);
    setLabel(null);
    window.dispatchEvent(new CustomEvent("arcadex-solana-disconnected"));
    setBusy(false);
  }, []);

  if (!native) return null;

  return (
    <div className="connect-wallet">
      {address ? (
        <button
          type="button"
          className="connect-wallet__btn connect-wallet__btn--connected"
          onClick={() => void disconnect()}
          disabled={busy}
          title={address}
        >
          {busy
            ? "…"
            : label?.trim() || truncateSolanaAddress(address)}
        </button>
      ) : (
        <button
          type="button"
          className="connect-wallet__btn"
          onClick={() => void connect()}
          disabled={busy}
        >
          {busy ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {error ? (
        <p className="connect-wallet__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
