const SOURCES = {
  touch: "/sounds/touch.mp3",
  success: "/sounds/success.mp3",
} as const;

export type SfxName = keyof typeof SOURCES;

const elements = new Map<SfxName, HTMLAudioElement>();

function getAudio(name: SfxName): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;

  let el = elements.get(name);
  if (!el) {
    el = new Audio(SOURCES[name]);
    el.preload = "auto";
    el.volume = name === "touch" ? 0.7 : 0.9;
    el.setAttribute("playsinline", "true");
    elements.set(name, el);
  }
  return el;
}

/** Create audio nodes early so the first tap is instant. */
export function preloadSfx() {
  getAudio("touch");
  getAudio("success");
}

function playElement(el: HTMLAudioElement, volume: number) {
  try {
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    el.volume = volume;
    void el.play().catch(() => {});
  } catch {
    // Autoplay blocked — ignore
  }
}

let lastTouchAt = 0;

export function playTouchSfx() {
  const now = Date.now();
  if (now - lastTouchAt < 40) return;
  lastTouchAt = now;

  const proto = getAudio("touch");
  if (!proto) return;

  // Clone so we never touch the success element on button taps.
  try {
    const node = proto.cloneNode(true) as HTMLAudioElement;
    node.volume = proto.volume;
    node.muted = false;
    void node.play().catch(() => playElement(proto, proto.volume));
  } catch {
    playElement(proto, proto.volume);
  }
}

/** Only for confirmed Spark Refill / Infinite Spark / daily streak-shuffle txs. */
export function playSuccessSfx() {
  const el = getAudio("success");
  if (!el) return;

  try {
    el.pause();
    el.currentTime = 0;
    el.muted = false;
    el.volume = 0.9;
    void el.play().catch(() => {
      const fallback = new Audio(SOURCES.success);
      fallback.volume = 0.9;
      void fallback.play().catch(() => {});
    });
  } catch {
    // Autoplay blocked — ignore
  }
}
