"use client";

import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import { useSolanaMwaConnect } from "@/lib/use-solana-mwa-connect";
import { truncateSolanaAddress } from "@/lib/solana-address";
import { playTouchSfx } from "@/lib/sfx";

interface ConnectWalletModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: (address: string) => void;
}

/** Returning-user popup: ask to connect Solana wallet (skippable). */
export default function ConnectWalletModal({
  open,
  onClose,
  onConnected,
}: ConnectWalletModalProps) {
  const { address, busy, error, connect } = useSolanaMwaConnect();

  if (!open) return null;

  async function handleConnect() {
    playTouchSfx();
    try {
      const next = await connect();
      onConnected?.(next);
      onClose();
    } catch {
      // Error shown via hook state.
    }
  }

  function handleLater() {
    playTouchSfx();
    onClose();
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-wallet-title"
      >
        <Logo variant="login" />
        <p className="player-modal-subtitle">Welcome back</p>
        <h2 id="connect-wallet-title" className="player-modal-title">
          Connect your Solana wallet
        </h2>
        <p className="player-modal-hint">
          Link Phantom, Seed Vault, Solflare, or any MWA wallet on this device.
          You can skip and keep playing as a guest.
        </p>

        {address ? (
          <p className="connect-wallet-modal__status">
            Connected · {truncateSolanaAddress(address)}
          </p>
        ) : null}

        {error ? <p className="error-msg">{error}</p> : null}

        <div className="connect-wallet-modal__actions">
          <button
            type="button"
            className="player-modal-submit"
            onClick={() => void handleConnect()}
            disabled={busy}
          >
            {busy ? "Connecting…" : address ? "Connected — Continue" : "Connect wallet"}
          </button>
          <button
            type="button"
            className="connect-wallet-modal__skip"
            onClick={handleLater}
            disabled={busy}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
