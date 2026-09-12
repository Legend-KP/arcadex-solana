import { Game } from "@/types";
import { injectImagePreload, preloadImage } from "@/lib/preload-image";

/** Folder names under public/games/ for each title. */
const LOCAL_GAME_FOLDERS = [
  "basedrop",
  "block-blast",
  "coin-sort",
  "dot-connect",
  "line-link",
  "math-run",
  "orbit-flow",
] as const;

/** Root-level logos under public/games/ for titles without a folder. */
const ROOT_GAME_LOGOS: Record<string, string> = {
  "jelly-jumble": "/games/jelly-logo.webp",
  jellyjumble: "/games/jelly-logo.webp",
  jelly: "/games/jelly-logo.webp",
  "line-link": "/games/line-logo.webp",
  linelink: "/games/line-logo.webp",
  "arrow-out": "/games/arrowout-logo.webp",
  arrowout: "/games/arrowout-logo.webp",
  burger: "/games/burger-logo.webp",
  "burger-game": "/games/burger-logo.webp",
  cake: "/games/cake-logo.webp",
  "cake-sort": "/games/cake-logo.webp",
  dunk: "/games/Dunk-logo.webp",
  "dunk-master": "/games/Dunk-logo.webp",
  sanddrop: "/games/sanddrop-logo.webp",
  "sand-drop": "/games/sanddrop-logo.webp",
};

function resolveRootLogo(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (ROOT_GAME_LOGOS[nameSlug]) return ROOT_GAME_LOGOS[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && ROOT_GAME_LOGOS[id]) return ROOT_GAME_LOGOS[id];

  const haystacks = [nameSlug, isFirestoreAutoId(id) ? "" : id].filter(Boolean);
  for (const [key, url] of Object.entries(ROOT_GAME_LOGOS)) {
    if (haystacks.some((h) => h === key || h.startsWith(`${key}-`))) {
      return url;
    }
  }

  if (nameSlug.includes("jelly") || (!isFirestoreAutoId(id) && id.includes("jelly"))) {
    return ROOT_GAME_LOGOS["jelly-jumble"];
  }

  return null;
}

export function slugifyGameName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Accept only real image paths/URLs. Rejects legacy emoji values (e.g. "🎮")
 * that were previously stored in Firestore as fallbackImage / emoji.
 */
export function normalizeImageAssetUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Paths and absolute URLs only — never emoji / plain text.
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("data:image/")
  ) {
    return trimmed;
  }

  return "";
}

function isFirestoreAutoId(id: string): boolean {
  return /^[a-zA-Z0-9]{15,}$/.test(id) && !id.includes("-");
}

function resolveLocalGameFolder(game: Game): string | null {
  const nameSlug = slugifyGameName(game.name);
  if (LOCAL_GAME_FOLDERS.includes(nameSlug as (typeof LOCAL_GAME_FOLDERS)[number])) {
    return nameSlug;
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    if (LOCAL_GAME_FOLDERS.includes(id as (typeof LOCAL_GAME_FOLDERS)[number])) {
      return id;
    }
  }

  return null;
}

function pushLocalGameAssets(
  push: (url?: string) => void,
  folder: string,
  kind: "logo" | "thumbnail"
) {
  if (kind === "thumbnail") {
    push(`/thumbnails/${folder}.webp`);
  }

  // Prefer webp; only fall through to png when webp is absent (e.g. block-blast).
  push(`/games/${folder}/logo.webp`);
  push(`/games/${folder}/logo.png`);
  if (kind === "thumbnail") {
    push(`/games/${folder}/thumbnail.webp`);
    push(`/games/${folder}/thumbnail.png`);
  }
}

/** Local / remote asset URLs to try, in priority order. */
export function gameAssetCandidates(
  game: Game,
  kind: "logo" | "thumbnail"
): string[] {
  const field = kind === "logo" ? game.logo : game.thumbnail;
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    const normalized = normalizeImageAssetUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  const localFolder = resolveLocalGameFolder(game);

  // Prefer bundled assets so they show even when remote URLs fail.
  if (kind === "logo") {
    push(resolveRootLogo(game) ?? undefined);
  }

  if (localFolder) {
    pushLocalGameAssets(push, localFolder, kind);
  }

  push(field);

  if (kind === "logo" && game.thumbnail?.trim()) {
    push(game.thumbnail);
  }

  if (localFolder) {
    return out;
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug) {
    pushLocalGameAssets(push, nameSlug, kind);
    push(ROOT_GAME_LOGOS[nameSlug]);
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id)) {
    pushLocalGameAssets(push, id, kind);
    push(ROOT_GAME_LOGOS[id]);
  }

  return out;
}

/**
 * Menu / card fallback URLs — prefer known-good files first to avoid
 * multi-step 404 cascades before the image appears.
 */
function pushLocalMenuAssets(push: (url?: string) => void, folder: string) {
  const prefix = folder.split("-")[0];
  // Real assets on disk today: coin-logo / line-logo, else logo.webp|.png
  push(`/games/${folder}/${prefix}-logo.webp`);
  push(`/games/${folder}/logo.webp`);
  push(`/games/${folder}/logo.png`);
  push(`/games/${folder}/fallback.webp`);
}

/** Fallback image URLs when thumbnail and logo are unavailable. */
export function gameFallbackCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    const normalized = normalizeImageAssetUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  push(resolveRootLogo(game) ?? undefined);

  // Admin-configured fallback is the fastest path when set.
  push(game.fallbackImage);

  const localFolder = resolveLocalGameFolder(game);
  if (localFolder) {
    pushLocalMenuAssets(push, localFolder);
  }

  const nameSlug = slugifyGameName(game.name);
  if (nameSlug && nameSlug !== localFolder) {
    pushLocalMenuAssets(push, nameSlug);
    push(ROOT_GAME_LOGOS[nameSlug]);
  }

  const id = game.id.trim().toLowerCase();
  if (id && !isFirestoreAutoId(id) && id !== localFolder && id !== nameSlug) {
    push(ROOT_GAME_LOGOS[id]);
  }

  return out;
}

/** Menu screen image URLs — fallback first, then logo, then thumbnail. */
export function gameMenuImageCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    const normalized = normalizeImageAssetUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  for (const url of gameFallbackCandidates(game)) push(url);
  for (const url of gameAssetCandidates(game, "logo")) push(url);
  for (const url of gameAssetCandidates(game, "thumbnail")) push(url);

  return out;
}

/** Blurred menu background — fallback first so it appears immediately. */
export function gameMenuBackgroundCandidates(game: Game): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url?: string) => {
    const normalized = normalizeImageAssetUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  for (const url of gameFallbackCandidates(game)) push(url);
  for (const url of gameAssetCandidates(game, "thumbnail")) push(url);
  for (const url of gameAssetCandidates(game, "logo")) push(url);

  return out;
}

/** Primary menu hero image — load this before revealing the game menu. */
export function getPrimaryGameMenuImage(game: Game): string | null {
  return gameMenuImageCandidates(game)[0] ?? null;
}

/**
 * Decode the primary fallback/menu image. Resolves once the bytes are ready
 * (or after a short timeout / error) so the menu can paint with art first.
 */
export function loadPrimaryGameMenuImage(game: Game): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(getPrimaryGameMenuImage(game));
  }

  const urls = gameMenuImageCandidates(game);
  if (urls.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let cancelled = false;
    let idx = 0;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        cancelled = true;
        resolve(urls[0] ?? null);
      }
    }, 2500);

    const tryNext = () => {
      if (cancelled) return;
      const url = urls[idx];
      if (!url) {
        window.clearTimeout(timeout);
        cancelled = true;
        resolve(null);
        return;
      }

      const img = new Image();
      img.decoding = "async";
      img.fetchPriority = "high";
      img.onload = () => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        cancelled = true;
        resolve(url);
      };
      img.onerror = () => {
        if (cancelled) return;
        idx += 1;
        tryNext();
      };
      img.src = url;
    };

    tryNext();
  });
}

/**
 * Warm the primary menu image. Optionally warm the tutorial too —
 * use high priority when the player has not seen it yet.
 */
export function preloadGameMenuAssets(
  game: Game,
  opts?: { includeTutorial?: boolean }
): void {
  if (typeof window === "undefined") return;

  const primary = getPrimaryGameMenuImage(game);
  if (primary) {
    injectImagePreload(primary, "high");
    void preloadImage(primary, "high");
  }

  if (opts?.includeTutorial) {
    const tutorialUrl = getGameTutorialUrl(game);
    if (tutorialUrl && tutorialUrl !== primary) {
      const unseen =
        window.localStorage.getItem(getGameTutorialSeenKey(game)) !== "1";
      const priority = unseen ? "high" : "low";
      injectImagePreload(tutorialUrl, priority);
      void preloadImage(tutorialUrl, priority);
    }
  }
}

/** Local tutorial images under public/tutorials/, keyed by game folder slug. */
const GAME_TUTORIAL_BY_FOLDER: Record<string, string> = {
  basedrop: "/tutorials/BASE-DROP.webp",
  "base-drop": "/tutorials/BASE-DROP.webp",
  "block-blast": "/tutorials/BLOCK-BLAST.webp",
  "coin-sort": "/tutorials/COIN-SORT.webp",
  coinsort: "/tutorials/COIN-SORT.webp",
  "dot-connect": "/tutorials/DOT-CONNECT.webp",
  "jelly-jumble": "/tutorials/JELLY-JUMBLE.webp",
  jellyjumble: "/tutorials/JELLY-JUMBLE.webp",
  jelly: "/tutorials/JELLY-JUMBLE.webp",
  "line-link": "/tutorials/LINE-LINK.webp",
  "math-run": "/tutorials/MATH-RUN.webp",
  "orbit-flow": "/tutorials/ORBIT-FLOW.webp",
};

function resolveTutorialKey(game: Game): string {
  return resolveLocalGameFolder(game) ?? (slugifyGameName(game.name) || game.id);
}

/** Tutorial URLs to try, in priority order (hyphenated name, then spaced filename). */
export function getGameTutorialCandidates(game: Game): string[] {
  const key = resolveTutorialKey(game);
  const nameSlug = slugifyGameName(game.name);
  const id = game.id.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  push(GAME_TUTORIAL_BY_FOLDER[key]);
  push(GAME_TUTORIAL_BY_FOLDER[nameSlug]);
  if (nameSlug.includes("jelly") || (!isFirestoreAutoId(id) && id.includes("jelly"))) {
    push(GAME_TUTORIAL_BY_FOLDER["jelly-jumble"]);
  }
  const hyphen = key.toUpperCase();
  const spaced = key.replace(/-/g, " ").toUpperCase();
  push(`/tutorials/${hyphen}.webp`);
  push(`/tutorials/${spaced}.webp`);

  return out;
}

/** Tutorial image URL for a game, or null when none is prepared yet. */
export function getGameTutorialUrl(game: Game): string | null {
  return getGameTutorialCandidates(game)[0] ?? null;
}

/** Decode the first tutorial image that exists. */
export function loadGameTutorialImage(game: Game): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(getGameTutorialUrl(game));
  }

  const urls = getGameTutorialCandidates(game);
  if (urls.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let cancelled = false;
    let idx = 0;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        cancelled = true;
        resolve(urls[0] ?? null);
      }
    }, 2000);

    const tryNext = () => {
      if (cancelled) return;
      const url = urls[idx];
      if (!url) {
        window.clearTimeout(timeout);
        cancelled = true;
        resolve(null);
        return;
      }

      const img = new Image();
      img.decoding = "async";
      img.fetchPriority = "high";
      img.onload = () => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        cancelled = true;
        resolve(url);
      };
      img.onerror = () => {
        if (cancelled) return;
        idx += 1;
        tryNext();
      };
      img.src = url;
    };

    tryNext();
  });
}

/** localStorage key for per-game first-time tutorial seen state. */
export function getGameTutorialSeenKey(game: Game): string {
  return `arcadex_tutorial_seen:${resolveTutorialKey(game)}`;
}
