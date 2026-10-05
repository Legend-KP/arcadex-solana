"use client";

import { useEffect, useMemo } from "react";
import {
  FAQ_URL,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/app-footer-links";
import { getCachedSolanaAddress, truncateSolanaAddress } from "@/lib/solana-address";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

export type AppView =
  | "home"
  | "games"
  | "contests"
  | "leaderboard"
  | "achievements";

interface AppDrawerProps {
  open: boolean;
  view: AppView;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onOpenSparks: () => void;
}

const NAV: { id: AppView | "sparks"; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "games", label: "Games" },
  { id: "contests", label: "Contests" },
  { id: "leaderboard", label: "Weekly XP Board" },
  { id: "sparks", label: "Sparks" },
  { id: "achievements", label: "Achievements" },
];

export default function AppDrawer({
  open,
  view,
  onClose,
  onNavigate,
  onOpenSparks,
}: AppDrawerProps) {
  const { playerName, walletAddress, openNameEditor } =
    usePlayerProfile();
  const solana = getCachedSolanaAddress();
  const address = walletAddress || solana || "";
  const displayName = playerName || "Player";
  const initial = useMemo(() => {
    const ch = displayName.trim().charAt(0);
    return ch ? ch.toUpperCase() : "P";
  }, [displayName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="app-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="app-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="app-drawer__logo"
          aria-label="Home"
          onClick={() => {
            onNavigate("home");
            onClose();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="ArcadeX" className="app-drawer__mark" />
        </button>

        <div className="app-drawer__profile">
          <div className="app-drawer__avatar" aria-hidden>
            {initial}
          </div>
          <div className="app-drawer__who">
            <div className="app-drawer__name-row">
              <p className="app-drawer__name">{displayName}</p>
              <button
                type="button"
                className="app-drawer__edit"
                onClick={() => {
                  onClose();
                  openNameEditor();
                }}
              >
                Edit
              </button>
            </div>
            <p className="app-drawer__wallet">
              {address ? truncateSolanaAddress(address, 6, 4) : "No wallet yet"}
            </p>
          </div>
        </div>

        <nav className="app-drawer__nav" aria-label="App">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-drawer__item${
                item.id !== "sparks" && view === item.id ? " is-active" : ""
              }`}
              onClick={() => {
                onClose();
                if (item.id === "sparks") {
                  onOpenSparks();
                  return;
                }
                onNavigate(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="app-drawer__footer">
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
            Terms &amp; Conditions
          </a>
          <a href={FAQ_URL} target="_blank" rel="noopener noreferrer">
            FAQ
          </a>
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            Support
          </a>
        </div>
      </aside>
    </div>
  );
}
