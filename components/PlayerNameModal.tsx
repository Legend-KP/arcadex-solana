"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import { useSolanaMwaConnect } from "@/lib/use-solana-mwa-connect";
import { truncateSolanaAddress } from "@/lib/solana-address";
import { playTouchSfx } from "@/lib/sfx";

interface PlayerNameModalProps {
  open: boolean;
  saving: boolean;
  error?: string;
  defaultName?: string;
  intent?: "create" | "edit";
  onSubmit: (name: string) => void;
  onClose?: () => void;
}

export default function PlayerNameModal({
  open,
  saving,
  error,
  defaultName = "",
  intent = "create",
  onSubmit,
  onClose,
}: PlayerNameModalProps) {
  const [name, setName] = useState(defaultName);
  const {
    native,
    address,
    busy: connecting,
    error: connectError,
    connect,
    signedIn,
  } = useSolanaMwaConnect();

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
  }, [open]);

  useEffect(() => {
    if (!open || !defaultName) return;
    setName((prev) => prev.trim() || defaultName);
  }, [open, defaultName]);

  if (!open) return null;

  const isValid = name.trim().length >= 1;
  const busy = saving || connecting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || busy) return;
    onSubmit(name.trim());
  }

  async function handleConnectThenContinue() {
    playTouchSfx();
    if (!isValid || busy) return;
    try {
      if (!address || !signedIn) await connect();
      onSubmit(name.trim());
    } catch {
      // Stay on modal; connectError shown.
    }
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-modal-title"
      >
        <Logo variant="login" />
        <p className="player-modal-subtitle">
          {intent === "edit" ? "ArcadeX" : "Welcome to ArcadeX"}
        </p>
        <h2 id="player-modal-title" className="player-modal-title">
          {intent === "edit" ? "Edit your name" : "Choose your player name"}
        </h2>
        <p className="player-modal-hint">
          {intent === "edit"
            ? "This updates the name on your signed-in profile."
            : native
            ? "Pick a name, then connect & sign in with your Solana wallet (free message — no SOL spent). Or continue as a guest."
            : "This name is saved on this device. Pick something fun — you can keep playing without a wallet."}
        </p>

        <form onSubmit={handleSubmit} className="player-modal-form">
          <label className="form-label" htmlFor="player-name">
            Player name
          </label>
          <input
            id="player-name"
            className={`form-input${error ? " input-error" : ""}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PixelPro"
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            disabled={busy}
          />
          {error && <p className="error-msg">{error}</p>}
          {connectError && <p className="error-msg">{connectError}</p>}

          {intent === "edit" || !native ? (
            <>
              <button
                type="submit"
                className="player-modal-submit"
                disabled={busy || !isValid}
              >
                {saving ? "Saving..." : intent === "edit" ? "Save" : "Continue"}
              </button>
              {intent === "edit" && onClose && (
                <button
                  type="button"
                  className="connect-wallet-modal__skip"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              {address ? (
                <p className="connect-wallet-modal__status">
                  {signedIn ? "Signed in" : "Connected"} ·{" "}
                  {truncateSolanaAddress(address)}
                </p>
              ) : null}

              <button
                type="button"
                className="player-modal-submit"
                disabled={busy || !isValid}
                onClick={() => void handleConnectThenContinue()}
              >
                {connecting
                  ? "Waiting for wallet…"
                  : address && signedIn
                    ? saving
                      ? "Saving..."
                      : "Continue"
                    : "Connect, sign in & continue"}
              </button>
              <button
                type="submit"
                className="connect-wallet-modal__skip"
                disabled={busy || !isValid}
              >
                {saving ? "Saving..." : "Continue without wallet"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
