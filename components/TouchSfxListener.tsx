"use client";

import { useEffect } from "react";
import { playTouchSfx, preloadSfx } from "@/lib/sfx";

function isSfxButton(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("iframe, canvas, .iframe-wrap, [data-no-touch-sfx]")) {
    return false;
  }

  const btn = target.closest(
    "button, [role='button'], input[type='button'], input[type='submit']"
  );
  if (!btn) return false;
  if (btn instanceof HTMLButtonElement && btn.disabled) return false;
  if (btn instanceof HTMLInputElement && btn.disabled) return false;
  if (btn.getAttribute("aria-disabled") === "true") return false;
  return true;
}

/** Plays the touch clip only when the user taps a button. */
export default function TouchSfxListener() {
  useEffect(() => {
    preloadSfx();

    function onPointerDown(event: PointerEvent) {
      if (event.isPrimary === false) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!isSfxButton(event.target)) return;
      playTouchSfx();
    }

    document.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  return null;
}
