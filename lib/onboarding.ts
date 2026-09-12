import { injectImagePreload, preloadImage } from "@/lib/preload-image";

export const ONBOARDING_SEEN_KEY = "arcadex_onboarding_seen";

export const ONBOARDING_SLIDES = [
  "/onboarding/TUTORIAL-1.webp",
  "/onboarding/TUTORIAL-2.webp",
  "/onboarding/TUTORIAL-3.webp",
  "/onboarding/TUTORIAL-4.webp",
] as const;

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
}

export function markOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}

/** Start fetching onboarding art as soon as we know the user is new. */
export function preloadOnboardingSlides(): void {
  if (typeof window === "undefined") return;
  if (hasSeenOnboarding()) return;

  ONBOARDING_SLIDES.forEach((src, index) => {
    // Last slide is large — wait until the user advances before fetching it.
    if (index >= 3) return;
    const priority = index === 0 ? "high" : "low";
    if (index === 0) injectImagePreload(src, "high");
    void preloadImage(src, priority);
  });
}
