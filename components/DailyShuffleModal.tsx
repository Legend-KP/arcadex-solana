"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { formatChainError } from "@/lib/celo-public-client";
import { DEFAULT_SHUFFLE_CAMPAIGN_ID } from "@/lib/daily-play-mode";
import {
  claimDailyShuffleReward,
  performDailyShuffle,
  type ShufflePrepareResult,
  type ShuffleTheaterCard,
} from "@/lib/shuffle-client";
import { playShuffleSound } from "@/lib/shuffle-sound";
import { playSuccessSfx, playTouchSfx } from "@/lib/sfx";
import {
  fetchStreakStatus,
  refreshSessionFromCheckIn,
  type StreakStatus,
} from "@/lib/streak-client";
import {
  hasShuffleDoneToday,
  markShuffleDoneToday,
} from "@/lib/shuffle-done-today";
import { ensureWalletSession } from "@/lib/walletAuth";

type Phase =
  | "intro"
  | "busy"
  | "showcase"
  | "shuffling"
  | "pick"
  | "reveal"
  | "claiming"
  | "done";

interface DailyShuffleModalProps {
  open: boolean;
  walletAddress: string;
  campaignId?: number;
  status: StreakStatus | null;
  onComplete: (result: {
    day: number;
    milestone: boolean;
    infiniteSparkGranted: boolean;
  }) => void;
}

const TICKET_TONES = [
  "lavender",
  "mint",
  "blush",
  "sky",
  "butter",
  "periwinkle",
] as const;

/** Intro preview — the three USDT prizes, then flip to ?. */
const INTRO_USDT_PREVIEW = [
  { tone: "lavender" as const, label: "1 USDT" },
  { tone: "mint" as const, label: "0.05 USDT" },
  { tone: "blush" as const, label: "0.001 USDT" },
];

const SHOWCASE_MS = 3800;
const SHUFFLE_MS = 3200;
const INTRO_REVEAL_MS = 2400;
const INTRO_FLIP_MS = 700;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function TicketSpark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        d="M12 1C12.35 8.1 15.9 11.65 23 12C15.9 12.35 12.35 15.9 12 23C11.65 15.9 8.1 12.35 1 12C8.1 11.65 11.65 8.1 12 1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TicketShell({
  tone,
  children,
  faceDown,
}: {
  tone: (typeof TICKET_TONES)[number];
  children?: ReactNode;
  faceDown?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const goldId = `ticket-gold-${tone}-${uid}`;

  if (faceDown) {
    return (
      <span className={`daily-shuffle-ticket tone-${tone} is-face-down`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="daily-shuffle-ticket-img"
          src={`/daily-shuffle/ticket-${tone}.png`}
          alt=""
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span className={`daily-shuffle-ticket tone-${tone}`}>
      <svg
        className="daily-shuffle-ticket-shape"
        viewBox="0 0 100 148"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F6DE8A" />
            <stop offset="42%" stopColor="#E8C04A" />
            <stop offset="100%" stopColor="#C4921A" />
          </linearGradient>
        </defs>
        <path
          className="daily-shuffle-ticket-path"
          d="M 18 2
             H 36
             A 14 14 0 0 1 64 2
             H 82
             A 8 8 0 0 1 98 18
             V 56
             V 92
             V 130
             A 8 8 0 0 1 82 146
             H 64
             A 14 14 0 0 1 36 146
             H 18
             A 8 8 0 0 1 2 130
             V 18
             A 8 8 0 0 1 18 2
             Z"
          stroke={`url(#${goldId})`}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          className="daily-shuffle-ticket-stitch"
          d="M 22 12
             H 37
             A 11 11 0 0 1 63 12
             H 78
             A 6 6 0 0 1 90 24
             V 124
             A 6 6 0 0 1 78 136
             H 63
             A 11 11 0 0 1 37 136
             H 22
             A 6 6 0 0 1 10 124
             V 24
             A 6 6 0 0 1 22 12
             Z"
          fill="none"
          stroke={`url(#${goldId})`}
          strokeWidth="1.15"
          strokeDasharray="3.2 2.6"
          opacity="0.95"
        />
      </svg>
      <span className="daily-shuffle-ticket-content">{children}</span>
    </span>
  );
}

function CardFaceContent({
  glyph,
  label,
}: {
  glyph?: string | null;
  label: string;
}) {
  return (
    <>
      {glyph ? (
        <span className="daily-shuffle-card-glyph">{glyph}</span>
      ) : null}
      <span className="daily-shuffle-card-label">{label}</span>
    </>
  );
}

export default function DailyShuffleModal({
  open,
  walletAddress,
  campaignId: campaignIdProp,
  status,
  onComplete,
}: DailyShuffleModalProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState("");
  const [theater, setTheater] = useState<ShuffleTheaterCard[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ShufflePrepareResult["outcome"] | null>(
    null
  );
  const [needsClaim, setNeedsClaim] = useState(false);
  const [infiniteSparkGranted, setInfiniteSparkGranted] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** Intro: show USDT amounts, then flip to ?. */
  const [introFaceUp, setIntroFaceUp] = useState(true);
  const [introFlipping, setIntroFlipping] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const campaignId =
    (typeof campaignIdProp === "number" && Number.isFinite(campaignIdProp)
      ? campaignIdProp
      : null) ??
    (status?.campaignId && Number.isFinite(status.campaignId)
      ? Number(status.campaignId)
      : DEFAULT_SHUFFLE_CAMPAIGN_ID);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setPhase("intro");
      setError("");
      setTheater([]);
      setWinnerId(null);
      setOutcome(null);
      setNeedsClaim(false);
      setPickedId(null);
      setIntroFaceUp(true);
      setIntroFlipping(false);
      return;
    }

    // Safety net: if already done, close immediately — never show Shuffle UI.
    if (
      hasShuffleDoneToday(walletAddress, campaignId) ||
      (status && !status.canCheckIn && status.lastCheckInAt > 0)
    ) {
      markShuffleDoneToday(walletAddress, campaignId);
      onCompleteRef.current({
        day: status?.currentDay || 1,
        milestone: false,
        infiniteSparkGranted: false,
      });
      return;
    }

    let cancelled = false;
    setIntroFaceUp(true);
    setIntroFlipping(false);

    const flipTimer = window.setTimeout(() => {
      if (cancelled) return;
      setIntroFlipping(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setIntroFaceUp(false);
        setIntroFlipping(false);
      }, INTRO_FLIP_MS);
    }, INTRO_REVEAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(flipTimer);
    };
  }, [open, walletAddress, campaignId, status]);

  const winnerCard = useMemo(
    () => theater.find((c) => c.id === winnerId) ?? null,
    [theater, winnerId]
  );

  async function enterAfterAlreadyDone(fresh?: StreakStatus | null) {
    markShuffleDoneToday(walletAddress, campaignId);
    try {
      await refreshSessionFromCheckIn(walletAddress, campaignId);
    } catch {
      try {
        await ensureWalletSession(walletAddress);
      } catch {
        // Still dismiss UI — do not ask for another shuffle tx.
      }
    }
    onCompleteRef.current({
      day: fresh?.currentDay || status?.currentDay || 1,
      milestone: false,
      infiniteSparkGranted: false,
    });
  }

  async function recoverIfAlreadyDone() {
    if (hasShuffleDoneToday(walletAddress, campaignId)) {
      await enterAfterAlreadyDone(status);
      return true;
    }
    const fresh = await fetchStreakStatus(walletAddress, campaignId, {
      fresh: true,
    });
    if (!fresh.canCheckIn && fresh.lastCheckInAt > 0) {
      await enterAfterAlreadyDone(fresh);
      return true;
    }
    return false;
  }

  async function handleShuffle() {
    if (phase !== "intro" && phase !== "done") return;
    setError("");
    setPhase("busy");

    try {
      // Never prompt MiniPay if today is already done.
      if (await recoverIfAlreadyDone()) return;

      const fresh = await fetchStreakStatus(walletAddress, campaignId, {
        fresh: true,
      });
      if (!fresh.canCheckIn) {
        await enterAfterAlreadyDone(fresh);
        return;
      }

      const { prepare, sync } = await performDailyShuffle(
        walletAddress,
        campaignId
      );

      markShuffleDoneToday(walletAddress, campaignId);
      playSuccessSfx();

      setTheater(prepare.theater);
      setWinnerId(prepare.outcome.id);
      setOutcome(prepare.outcome);
      setNeedsClaim(Boolean(sync.needsClaim));
      setInfiniteSparkGranted(Boolean(sync.infiniteSparkGranted));

      setPhase("showcase");
      await sleep(SHOWCASE_MS);

      setPhase("shuffling");
      const stopSound = playShuffleSound();
      try {
        await sleep(SHUFFLE_MS);
      } finally {
        stopSound();
      }

      setPhase("pick");
    } catch (err) {
      try {
        if (await recoverIfAlreadyDone()) return;
      } catch {
        // keep original error
      }
      setError(formatChainError(err));
      setPhase("intro");
    }
  }

  function handlePick(cardId: string) {
    if (phase !== "pick" || !winnerId) return;
    playTouchSfx();
    setPickedId(cardId);
    // Theater only: the tapped card reveals the server outcome (not the
    // fixed grid slot that happened to hold that outcome id).
    setPhase("reveal");
  }

  async function handleContinue() {
    playTouchSfx();
    if (needsClaim) {
      setPhase("claiming");
      setError("");
      try {
        await claimDailyShuffleReward(campaignId);
        markShuffleDoneToday(walletAddress, campaignId);
        setNeedsClaim(false);
        setPhase("done");
        onComplete({
          day: 1,
          milestone: outcome?.type === "spark",
          infiniteSparkGranted,
        });
      } catch (err) {
        setError(formatChainError(err));
        setPhase("reveal");
      }
      return;
    }

    markShuffleDoneToday(walletAddress, campaignId);
    onComplete({
      day: 1,
      milestone: outcome?.type === "spark",
      infiniteSparkGranted,
    });
  }

  function revealLabel(card: ShuffleTheaterCard | null): string {
    if (!card) return "";
    if (card.type === "usdt" && card.amount != null) return `${card.amount} USDT`;
    return card.label;
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="player-modal-backdrop daily-shuffle-backdrop" role="presentation">
      <div
        className={`daily-shuffle-modal${
          phase === "reveal" || phase === "claiming" ? " is-reveal" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-shuffle-title"
      >
        <div className="daily-shuffle-sparkles" aria-hidden>
          <TicketSpark className="daily-shuffle-sparkle s1" />
          <TicketSpark className="daily-shuffle-sparkle s2" />
          <TicketSpark className="daily-shuffle-sparkle s3" />
          <TicketSpark className="daily-shuffle-sparkle s4" />
          <TicketSpark className="daily-shuffle-sparkle s5" />
        </div>

        <h2 id="daily-shuffle-title" className="daily-shuffle-title">
          Daily Jackpot
        </h2>
        <p className="daily-shuffle-sub">
          One no-cost shuffle per day (resets 00:00 UTC).
        </p>

        {phase === "intro" || phase === "busy" ? (
          <div className="daily-shuffle-hero">
            <div className="daily-shuffle-hero-cards" aria-hidden>
              {INTRO_USDT_PREVIEW.map((card) => (
                <div
                  key={card.tone}
                  className={`daily-shuffle-hero-flip ${
                    introFlipping ? "is-flipping" : ""
                  } ${introFaceUp ? "is-face-up" : "is-face-down"}`}
                >
                  <div className="daily-shuffle-hero-flip-inner">
                    <div className="daily-shuffle-hero-face daily-shuffle-hero-face-front">
                      <TicketShell tone={card.tone}>
                        <CardFaceContent label={card.label} />
                      </TicketShell>
                    </div>
                    <div className="daily-shuffle-hero-face daily-shuffle-hero-face-back">
                      <TicketShell tone={card.tone} faceDown />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(phase === "showcase" ||
          phase === "shuffling" ||
          phase === "pick" ||
          phase === "reveal" ||
          phase === "claiming") && (
          <div className="daily-shuffle-stage">
            <div className="daily-shuffle-divider" aria-hidden>
              <span />
              <TicketSpark />
              <span />
            </div>
            {phase === "shuffling" ? (
              <div className="daily-shuffle-pile" aria-live="polite">
                <span>Shuffling…</span>
                <div className="daily-shuffle-pile-cards">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`daily-shuffle-pile-card tone-${TICKET_TONES[i]}`}
                    >
                      <TicketShell tone={TICKET_TONES[i]} faceDown />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div
                className={`daily-shuffle-grid ${
                  phase === "pick" ? "is-pick" : ""
                } ${
                  phase === "reveal" || phase === "claiming" ? "is-reveal" : ""
                }`}
              >
                {theater.map((card, index) => {
                  const isPicked = card.id === pickedId;
                  const faceDown = phase === "pick";
                  // Reveal the card the user tapped — show server outcome there.
                  const showFront =
                    phase === "showcase" ||
                    ((phase === "reveal" || phase === "claiming") && isPicked);
                  const tone = TICKET_TONES[index % TICKET_TONES.length];
                  const display =
                    (phase === "reveal" || phase === "claiming") && isPicked
                      ? winnerCard ?? card
                      : card;

                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`daily-shuffle-card ${
                        faceDown ? "is-back" : ""
                      } ${
                        phase === "reveal" || phase === "claiming"
                          ? isPicked
                            ? "is-winner"
                            : "is-loser"
                          : ""
                      } ${isPicked ? "is-picked" : ""}`}
                      disabled={phase !== "pick"}
                      onClick={() => handlePick(card.id)}
                    >
                      <TicketShell tone={tone} faceDown={!showFront}>
                        {showFront && display ? (
                          <CardFaceContent
                            glyph={
                              display.type === "usdt" ? null : display.glyph
                            }
                            label={revealLabel(display)}
                          />
                        ) : null}
                      </TicketShell>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(phase === "reveal" || phase === "claiming") && winnerCard ? (
          <div className="daily-shuffle-result">
            <p className="daily-shuffle-result-title">
              {outcome?.type === "usdt"
                ? "You won!"
                : outcome?.type === "spark"
                  ? "Infinite Spark!"
                  : winnerCard.label}
            </p>
            <p className="daily-shuffle-result-amt">
              {outcome?.type === "usdt" && outcome.amount != null
                ? `${outcome.amount} USDT`
                : outcome?.type === "spark"
                  ? "Unlimited plays · 24h"
                  : "Come back tomorrow for another shot."}
            </p>
          </div>
        ) : null}

        {error ? <p className="daily-shuffle-error">{error}</p> : null}

        <div className="daily-shuffle-actions">
          {phase === "intro" || phase === "busy" ? (
            <button
              type="button"
              className="daily-shuffle-cta"
              disabled={phase === "busy"}
              onClick={() => {
                playTouchSfx();
                void handleShuffle();
              }}
            >
              {phase === "busy" ? "Confirm in MiniPay…" : "Shuffle now · No cost"}
            </button>
          ) : null}

          {phase === "pick" ? (
            <p className="daily-shuffle-hint daily-shuffle-hint-ornament">
              <span aria-hidden>
                · · <TicketSpark className="daily-shuffle-hint-spark" /> · ·
              </span>
              <span>Pick a card to reveal today&apos;s reward</span>
              <span aria-hidden>
                · · <TicketSpark className="daily-shuffle-hint-spark" /> · ·
              </span>
            </p>
          ) : null}

          {phase === "reveal" || phase === "claiming" ? (
            <button
              type="button"
              className="daily-shuffle-cta"
              disabled={phase === "claiming"}
              onClick={() => void handleContinue()}
            >
              {phase === "claiming"
                ? "Claiming USDT…"
                : needsClaim
                  ? "Claim USDT"
                  : "Continue"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
