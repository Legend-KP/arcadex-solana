"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSparks } from "@/components/SparkProvider";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { formatChainError } from "@/lib/celo-public-client";
import { playSuccessSfx, playTouchSfx, preloadSfx } from "@/lib/sfx";
import { formatSparkCountdown } from "@/lib/spark";

export default function SparkBatteryBar() {
  const { sparks, loading, purchaseInfiniteSpark, purchaseSparkRefill } = useSparks();
  const { walletAddress } = usePlayerProfile();
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
      setPurchaseError(formatChainError(err));
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
      setRefillError(formatChainError(err));
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
          ⚡
        </span>

        <div className="spark-panel__body">
        <header className="spark-panel__header">
          <div className="spark-panel__title-row">
            <h2 id="spark-panel-title" className="spark-panel__title">
              Sparks
            </h2>
          </div>
          <p className="spark-panel__intro">
            Use Sparks to play any game. Once inside, play freely and infinitely!
          </p>
        </header>

        {sparks.hasInfinite ? (
          <section className="spark-panel__status">
            <div className="spark-panel__count-row">
              <span className="spark-panel__count-icon" aria-hidden>
                ∞
              </span>
              <p className="spark-panel__count-text spark-panel__count-text--infinite">
                Infinite Spark active
              </p>
            </div>
            <p className="spark-panel__infinite-hint">
              Play any game freely — no Spark cost while this lasts.
            </p>
          </section>
        ) : (
          <section className="spark-panel__status">
            <p className="spark-panel__status-label">Your Sparks</p>
            <div className="spark-panel__count-row">
              <span className="spark-panel__count-icon" aria-hidden>
                ⚡
              </span>
              <p className="spark-panel__count-text">
                <strong>{sparks.available}</strong>
                <span className="spark-panel__count-sep">/</span>
                {sparks.max} Sparks Available
              </p>
            </div>

            <div
              className="spark-panel__segments"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, sparks.max)}, 1fr)`,
              }}
            >
              {sparks.slots.map((slot) => (
                <div key={slot.index} className="spark-panel__segment-col">
                  <div className="spark-panel__segment">
                    <span
                      className="spark-panel__segment-fill"
                      style={{ width: `${slot.fillPercent}%` }}
                    />
                  </div>
                  {slot.status === "regenerating" ? (
                    <span className="spark-panel__segment-time">
                      {formatSparkCountdown(slot.timeRemainingMs)}
                    </span>
                  ) : slot.status === "queued" ? (
                    <span className="spark-panel__segment-time spark-panel__segment-time--queued">
                      Waiting
                    </span>
                  ) : (
                    <span className="spark-panel__segment-time spark-panel__segment-time--ready">
                      Ready
                    </span>
                  )}
                </div>
              ))}
            </div>

            {isFull && (
              <span className="spark-panel__badge">All Sparks are full! ✦</span>
            )}

            <p className="spark-panel__info">
              <span aria-hidden>ℹ</span> 1 Spark = 1 game entry. Sparks refill
              one at a time — each takes 3 hours, and the next starts only after
              the previous one is ready.
            </p>
          </section>
        )}

        <section className="spark-panel__shop">
          <h3 className="spark-panel__shop-title">
            <span aria-hidden>✦</span>
            <span>Get More Sparks</span>
            <span aria-hidden>✦</span>
          </h3>

          <div className="spark-shop-card">
            <div className="spark-shop-card__main">
              <span className="spark-shop-card__icon spark-shop-card__icon--refill" aria-hidden>
                ⚡
              </span>
              <div className="spark-shop-card__copy">
                <p className="spark-shop-card__name">Spark Refill</p>
                <p className="spark-shop-card__desc">
                  Instantly refill your Spark bar to full.
                </p>
              </div>
              <button
                type="button"
                className="spark-shop-card__price"
                disabled={refilling || loading || !walletAddress || sparks.available >= sparks.max}
                onClick={() => {
                  playTouchSfx();
                  void handlePurchaseSparkRefill();
                }}
              >
                {refilling ? "…" : "$0.05"}
              </button>
            </div>
            <span className="spark-shop-card__tag spark-shop-card__tag--gold">
              Best for quick top-up
            </span>
            {refillError && (
              <p className="spark-panel__purchase-error" role="alert">
                {refillError}
              </p>
            )}
          </div>

          <div className="spark-shop-card spark-shop-card--infinite">
            <div className="spark-shop-card__main">
              <span className="spark-shop-card__icon spark-shop-card__icon--infinite" aria-hidden>
                ∞
              </span>
              <div className="spark-shop-card__copy">
                <p className="spark-shop-card__name">Infinite Spark (24h)</p>
                <p className="spark-shop-card__desc">
                  Unlimited game access for 24 hours.
                </p>
              </div>
              <button
                type="button"
                className="spark-shop-card__price"
                disabled={purchasing || loading || !walletAddress}
                onClick={() => {
                  playTouchSfx();
                  void handlePurchaseInfiniteSpark();
                }}
              >
                {purchasing ? "…" : "$0.10"}
              </button>
            </div>
            <span className="spark-shop-card__tag spark-shop-card__tag--purple">
              Play without limits
            </span>
            {purchaseError && (
              <p className="spark-panel__purchase-error" role="alert">
                {purchaseError}
              </p>
            )}
          </div>

          <p className="spark-panel__shop-note">
            <span aria-hidden>🛡</span> Infinite Spark removes the entry gate
            only.
          </p>
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
