"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";
import {
  getCachedSolanaAddress,
  truncateSolanaAddress,
} from "@/lib/solana-address";
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
  const wallet = getCachedSolanaAddress();

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || saving) return;
    playTouchSfx();
    onSubmit(name.trim());
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
            : wallet
              ? "Your wallet is connected. Pick a display name to finish setting up your profile."
              : "This name is saved on this device. Pick something fun — you can keep playing without a wallet."}
        </p>

        {intent === "create" && wallet ? (
          <p className="connect-wallet-modal__status">
            Connected · {truncateSolanaAddress(wallet)}
          </p>
        ) : null}

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
            disabled={saving}
          />
          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="player-modal-submit"
            disabled={saving || !isValid}
          >
            {saving ? "Saving..." : intent === "edit" ? "Save" : "Continue"}
          </button>
          {intent === "edit" && onClose && (
            <button
              type="button"
              className="connect-wallet-modal__skip"
              onClick={() => {
                playTouchSfx();
                onClose();
              }}
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
