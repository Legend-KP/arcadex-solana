import { getArcadexWebUrl } from "../config";

function baseUrl() {
  return getArcadexWebUrl().replace(/\/$/, "");
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Only these slugs ship short looping preview videos under /thumbnails.
 * Avoids 404 spam for games without assets. No Firestore field.
 */
const LOCAL_PREVIEW_VIDEO_FOLDERS = new Set([
  "dot-connect",
  "jelly-jumble",
  "fruit-game",
  "hungry-hole",
  "coin-sort",
  "block-blast",
  "orbit-flow",
  "line-link",
  "basedrop",
  "free-fall",
  "burger-game",
]);

/** Name/id aliases → folder slug when catalog naming drifts. */
const PREVIEW_VIDEO_ALIASES = {
  "base-drop": "basedrop",
  basedrop: "basedrop",
  jellyjumble: "jelly-jumble",
  jelly: "jelly-jumble",
  fruit: "fruit-game",
  "fruit-slice": "fruit-game",
  burger: "burger-game",
  freefall: "free-fall",
  "hungryhole": "hungry-hole",
  coinsort: "coin-sort",
  blockblast: "block-blast",
  orbitflow: "orbit-flow",
  linelink: "line-link",
  dotconnect: "dot-connect",
};

function isFirestoreAutoId(id) {
  return /^[a-z0-9]{15,}$/i.test(id) && !id.includes("-");
}

/**
 * Resolve the local preview-video folder for a game, or null if not allowlisted.
 */
export function resolvePreviewVideoFolder(game) {
  const nameSlug = slugify(game?.name);
  const id = String(game?.id || "")
    .trim()
    .toLowerCase();

  const candidates = [
    PREVIEW_VIDEO_ALIASES[nameSlug],
    nameSlug,
    !isFirestoreAutoId(id) ? PREVIEW_VIDEO_ALIASES[id] : null,
    !isFirestoreAutoId(id) ? id : null,
  ].filter(Boolean);

  for (const key of candidates) {
    if (LOCAL_PREVIEW_VIDEO_FOLDERS.has(key)) return key;
  }
  return null;
}

/**
 * Static preview video URLs for catalog cards.
 * Returns null when the game has no local preview video.
 * Mobile prefers MP4 (Android/iOS); webm is optional for WebView.
 */
export function gameVideoSources(game) {
  const folder = resolvePreviewVideoFolder(game);
  if (!folder) return null;
  const root = baseUrl();
  return {
    slug: folder,
    poster: `${root}/thumbnails/${folder}.webp`,
    mp4: `${root}/thumbnails/${folder}.mp4`,
    webm: `${root}/thumbnails/${folder}.webm`,
  };
}

/** Normalize catalog paths so RN Image can load them. */
export function absolutizeAssetUrl(value) {
  if (typeof value !== "string") return "";
  let trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) return "";

  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("data:image/")
  ) {
    return trimmed;
  }

  // "thumbnails/foo.webp" or "thumbnails\\foo.webp" → "/thumbnails/foo.webp"
  if (!trimmed.startsWith("/")) trimmed = `/${trimmed}`;

  return `${baseUrl()}${trimmed}`;
}

function push(out, seen, url) {
  const abs = absolutizeAssetUrl(url);
  if (!abs || seen.has(abs)) return;
  seen.add(abs);
  out.push(abs);
}

/**
 * Candidate image URLs for a game card (mirrors web game-assets priority).
 */
export function gameImageCandidates(game) {
  const out = [];
  const seen = new Set();
  const slug = slugify(game?.name);
  const id = String(game?.id || "")
    .trim()
    .toLowerCase();

  push(out, seen, game?.thumbnail);
  push(out, seen, game?.logo);
  push(out, seen, game?.fallbackImage);

  if (slug) {
    push(out, seen, `/thumbnails/${slug}.webp`);
    push(out, seen, `/games/${slug}/logo.webp`);
    push(out, seen, `/games/${slug}/logo.png`);
    push(out, seen, `/games/${slug}/thumbnail.webp`);
  }

  // Known root logos used on web
  const rootLogos = {
    "jelly-jumble": "/games/jelly-logo.webp",
    jellyjumble: "/games/jelly-logo.webp",
    "line-link": "/games/line-logo.webp",
    linelink: "/games/line-logo.webp",
  };
  if (slug && rootLogos[slug]) push(out, seen, rootLogos[slug]);
  if (slug?.includes("jelly")) push(out, seen, "/games/jelly-logo.webp");

  if (id && !/^[a-z0-9]{20,}$/i.test(id)) {
    push(out, seen, `/thumbnails/${id}.webp`);
    push(out, seen, `/games/${id}/logo.webp`);
  }

  return out;
}
