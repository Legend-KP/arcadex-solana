"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSparks } from "@/components/SparkProvider";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { isArcadexNativeShell } from "@/lib/arcadex-native-bridge";
import { getCachedSolanaAddress } from "@/lib/solana-address";
import { playSuccessSfx, playTouchSfx, preloadSfx } from "@/lib/sfx";
import { formatSparkCountdown } from "@/lib/spark";
import SparkSegmentRing from "@/components/SparkSegmentRing";

function paymentErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const msg = raw.toLowerCase();
  if (
    msg.includes("cancellation") ||
    msg.includes("canceled") ||
    msg.includes("cancelled")
  ) {
    return "Wallet request was cancelled. Tap again and approve in Phantom.";
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "Payment failed.";
}

export default function SparkBatteryBar() {
  const { sparks, loading, purchaseInfiniteSpark, purchaseSparkRefill } =
    useSparks();
  const { walletAddress, isGuest } = usePlayerProfile();
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [nativeShell, setNativeShell] = useState(false);
  const walletReady =
    (Boolean(walletAddress) && !isGuest) ||
    (nativeShell && Boolean(solanaAddress));
  const shopNote = nativeShell
    ? solanaAddress
      ? "Pay with USDC or USDT on Solana mainnet. Fees go to the ArcadeX treasury."
      : "Connect & sign in (welcome popup) to unlock Spark purchases."
    : "Open ArcadeX on Solana Seeker to connect a wallet and buy Sparks.";

  useEffect(() => {
    setNativeShell(isArcadexNativeShell());
    setSolanaAddress(getCachedSolanaAddress());
    const onConnected = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string }>).detail;
      if (detail?.address) setSolanaAddress(detail.address);
    };
    const onDisconnected = () => setSolanaAddress(null);
    window.addEventListener("arcadex-solana-connected", onConnected);
    window.addEventListener("arcadex-solana-disconnected", onDisconnected);
    return () => {
      window.removeEventListener("arcadex-solana-connected", onConnected);
      window.removeEventListener("arcadex-solana-disconnected", onDisconnected);
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [refillError, setRefillError] = useState("");
  const [successMessage, setSuccessMessage] = useState<{
    title: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("openSparkPanel") === "1") {
      sessionStorage.removeItem("openSparkPanel");
      setOpen(true);
    }
    const openPanel = () => setOpen(true);
    window.addEventListener("arcadex-open-sparks", openPanel);
    return () => window.removeEventListener("arcadex-open-sparks", openPanel);
  }, []);

  useEffect(() => {
    preloadSfx();
  }, []);

  useEffect(() => {
    if (!successMessage) return;

    playSuccessSfx();
    const id = window.setTimeout(() => setSuccessMessage(null), 4000);
    return () => window.clearTimeout(id);
  }, [successMessage]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const isFull = sparks.available >= sparks.max;
  const regeneratingSlot = sparks.slots.find(
    (slot) => slot.status === "regenerating"
  );

  async function handlePurchaseInfiniteSpark() {
    setPurchaseError("");
    setPurchasing(true);
    try {
      await purchaseInfiniteSpark();
      playSuccessSfx();
      setSuccessMessage({
        title: "Purchase successful!",
        body: "Infinite Spark is active for 24 hours. Play any game freely!",
      });
    } catch (err) {
      setPurchaseError(paymentErrorMessage(err));
    } finally {
      setPurchasing(false);
    }
  }

  async function handlePurchaseSparkRefill() {
    setRefillError("");
    setRefilling(true);
    try {
      await purchaseSparkRefill();
      playSuccessSfx();
      setSuccessMessage({
        title: "Purchase successful!",
        body: "Your Spark bar is full. You're ready to play!",
      });
    } catch (err) {
      setRefillError(paymentErrorMessage(err));
    } finally {
      setRefilling(false);
    }
  }

  const panel = open ? (
    <div
      className="spark-panel-backdrop"
      onClick={() => {
        playTouchSfx();
        setOpen(false);
      }}
      role="presentation"
    >
      <div
        className="spark-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spark-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="spark-panel__close"
          onClick={() => {
            playTouchSfx();
            setOpen(false);
          }}
          aria-label="Close"
        >
          ×
        </button>

        <span className="spark-panel__title-icon" aria-hidden>
          <span className="spark-panel__title-icon-bolt">⚡</span>
        </span>

        <div className="spark-panel__body">
          <header className="spark-panel__header">
            <h2 id="spark-panel-title" className="spark-panel__title">
              SPARKS
            </h2>
            <p className="spark-panel__intro">
              Use Sparks to play any game. Once inside, play freely and
              infinitely!
            </p>
          </header>

          {sparks.hasInfinite ? (
            <section className="spark-panel__status">
              <div className="spark-panel__status-row">
                <SparkSegmentRing
                  available={sparks.max}
                  max={sparks.max}
                  infinite
                />
                <div className="spark-panel__status-copy">
                  <p className="spark-panel__count-text spark-panel__count-text--infinite">
                    Infinite Spark active
                  </p>
                  <p className="spark-panel__infinite-hint">
                    Play any game freely — no Spark cost while this lasts.
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <section className="spark-panel__status">
              <div className="spark-panel__status-row">
                <SparkSegmentRing
                  available={sparks.available}
                  max={sparks.max}
                />
                <div className="spark-panel__status-copy">
                  <p className="spark-panel__count-text">
                    <strong>
                      {sparks.available} / {sparks.max}
                    </strong>
                  </p>
                  <p className="spark-panel__count-caption">Sparks Available</p>
                  {isFull ? (
                    <span className="spark-panel__timer">
                      All Sparks are ready!
                    </span>
                  ) : regeneratingSlot ? (
                    <span className="spark-panel__timer">
                      <span className="spark-panel__timer-icon" aria-hidden>
                        ⏱
                      </span>
                      Next Spark in{" "}
                      {formatSparkCountdown(regeneratingSlot.timeRemainingMs)}
                    </span>
                  ) : null}
                </div>
              </div>

              <p className="spark-panel__info">
                <span className="spark-panel__info-icon" aria-hidden>
                  i
                </span>
                <span>
                  1 Spark = 1 game entry. Sparks refill one at a time — each
                  takes 3 hours, and the next starts only after the previous one
                  is ready.
                </span>
              </p>
            </section>
          )}

          <section className="spark-panel__shop">
            <h3 className="spark-panel__shop-title">
              <span aria-hidden>✦</span>
              <span>GET MORE SPARKS</span>
              <span aria-hidden>✦</span>
            </h3>

            {!walletReady && (
              <p className="spark-panel__shop-note" role="status">
                {shopNote}
              </p>
            )}

            <div className="spark-shop-card">
              <div className="spark-shop-card__main">
                <span
                  className="spark-shop-card__icon spark-shop-card__icon--refill"
                  aria-hidden
                >
                  ⚡
                </span>
                <div className="spark-shop-card__copy">
                  <p className="spark-shop-card__name">Spark Refill</p>
                  <p className="spark-shop-card__desc">
                    Instantly refill your Spark bar to full.
                  </p>
                  <span className="spark-shop-card__tag spark-shop-card__tag--gold">
                    Best for quick top-up
                  </span>
                </div>
                <button
                  type="button"
                  className="spark-shop-card__price"
                  disabled={
                    !walletReady ||
                    refilling ||
                    loading ||
                    sparks.available >= sparks.max
                  }
                  onClick={() => {
                    playTouchSfx();
                    if (!walletReady) {
                      setRefillError("Wallet coming soon");
                      return;
                    }
                    void handlePurchaseSparkRefill();
                  }}
                >
                  {!walletReady ? "Soon" : refilling ? "…" : "$0.05"}
                </button>
              </div>
              {refillError && (
                <p className="spark-panel__purchase-error" role="alert">
                  {refillError}
                </p>
              )}
            </div>

            <div className="spark-shop-card spark-shop-card--infinite">
              <div className="spark-shop-card__main">
                <span
                  className="spark-shop-card__icon spark-shop-card__icon--infinite"
                  aria-hidden
                >
                  ∞
                </span>
                <div className="spark-shop-card__copy">
                  <p className="spark-shop-card__name">Infinite Spark (24h)</p>
                  <p className="spark-shop-card__desc">
                    Unlimited game access for 24 hours.
                  </p>
                  <span className="spark-shop-card__tag spark-shop-card__tag--purple">
                    Play without limits
                  </span>
                </div>
                <button
                  type="button"
                  className="spark-shop-card__price"
                  disabled={!walletReady || purchasing || loading}
                  onClick={() => {
                    playTouchSfx();
                    if (!walletReady) {
                      setPurchaseError("Wallet coming soon");
                      return;
                    }
                    void handlePurchaseInfiniteSpark();
                  }}
                >
                  {!walletReady ? "Soon" : purchasing ? "…" : "$0.10"}
                </button>
              </div>
              {purchaseError && (
                <p className="spark-panel__purchase-error" role="alert">
                  {purchaseError}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  ) : null;

  const successPopup =
    successMessage && typeof document !== "undefined"
      ? createPortal(
          <div
            className="spark-success-backdrop"
            role="presentation"
            onClick={() => {
              playTouchSfx();
              setSuccessMessage(null);
            }}
          >
            <div
              className="spark-success-popup"
              role="alertdialog"
              aria-live="polite"
              aria-labelledby="spark-success-title"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="spark-success-popup__icon" aria-hidden>
                ✓
              </span>
              <h3 id="spark-success-title" className="spark-success-popup__title">
                {successMessage.title}
              </h3>
              <p className="spark-success-popup__body">{successMessage.body}</p>
              <button
                type="button"
                className="spark-success-popup__btn"
                onClick={() => {
                  playTouchSfx();
                  setSuccessMessage(null);
                }}
              >
                Great!
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="spark-battery-wrap">
        <button
          type="button"
          className="spark-battery"
          onClick={() => {
            playTouchSfx();
            setOpen(true);
          }}
          aria-expanded={open}
          aria-label={
            sparks.hasInfinite
              ? "Infinite Sparks active"
              : `${sparks.available} of ${sparks.max} Sparks available`
          }
          disabled={loading}
        >
          <span className="spark-battery__label" aria-hidden>
            {sparks.hasInfinite ? (
              <>⚡∞</>
            ) : (
              <>
                ⚡{sparks.available}/{sparks.max}
              </>
            )}
          </span>
        </button>
      </div>

      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : panel}

      {successPopup}
    </>
  );
}
