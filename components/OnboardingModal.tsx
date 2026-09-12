"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ONBOARDING_SLIDES,
  preloadOnboardingSlides,
} from "@/lib/onboarding";
import { preloadImage } from "@/lib/preload-image";

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

export default function OnboardingModal({
  open,
  onComplete,
}: OnboardingModalProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [slideVisible, setSlideVisible] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setSlideIndex(0);
      setSlideVisible(true);
      return;
    }

    let cancelled = false;

    async function prepare() {
      setReady(false);
      setSlideIndex(0);
      setSlideVisible(true);
      preloadOnboardingSlides();

      await preloadImage(ONBOARDING_SLIDES[0], "high");
      if (cancelled) return;
      setReady(true);

      void Promise.all(
        ONBOARDING_SLIDES.slice(1, 3).map((src) => preloadImage(src, "low"))
      );
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const next = ONBOARDING_SLIDES[slideIndex + 1];
    if (next) void preloadImage(next, "high");
  }, [open, slideIndex]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const isLast = slideIndex >= ONBOARDING_SLIDES.length - 1;
  const src = ONBOARDING_SLIDES[slideIndex];

  function handlePrimary() {
    if (isLast) {
      onComplete();
      return;
    }

    setSlideVisible(false);
    window.setTimeout(() => {
      setSlideIndex((prev) => prev + 1);
      requestAnimationFrame(() => {
        setSlideVisible(true);
      });
    }, 180);
  }

  const modal = (
    <div className="onboarding-backdrop" role="presentation">
      <div
        className={`onboarding-panel${ready ? " onboarding-panel--ready" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`ArcadeX tutorial, step ${slideIndex + 1} of ${ONBOARDING_SLIDES.length}`}
        aria-hidden={!ready}
      >
        <div className="onboarding-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            alt={`ArcadeX tutorial step ${slideIndex + 1}`}
            className={`onboarding-img${ready && slideVisible ? " onboarding-img--visible" : ""}`}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <button
          type="button"
          className="game-tutorial-btn onboarding-btn"
          onClick={handlePrimary}
          disabled={!ready || !slideVisible}
        >
          {isLast ? "Let's Go" : "Next"}
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
