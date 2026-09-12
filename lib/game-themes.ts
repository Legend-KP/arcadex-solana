import { Game } from "@/types";
import { slugifyGameName } from "@/lib/game-assets";

export interface GameTheme {
  topbar: string;
  text: string;
}

const DEFAULT_THEME: GameTheme = {
  topbar: "#ffffff",
  text: "#1a1a2e",
};

/** Topbar colors matched to each game's in-game palette. */
const GAME_THEMES: Record<string, GameTheme> = {
  "dot-connect": { topbar: "#4a7fd4", text: "#ffffff" },
  basedrop: { topbar: "#1d4ed8", text: "#ffffff" },
  "block-blast": { topbar: "#7c3aed", text: "#ffffff" },
  "math-run": { topbar: "#16a34a", text: "#ffffff" },
  "orbit-flow": { topbar: "#0891b2", text: "#ffffff" },
};

export function getGameTheme(game: Pick<Game, "name" | "id">): GameTheme {
  const nameSlug = slugifyGameName(game.name);
  if (GAME_THEMES[nameSlug]) return GAME_THEMES[nameSlug];

  const id = game.id.trim().toLowerCase();
  if (id && GAME_THEMES[id]) return GAME_THEMES[id];

  return DEFAULT_THEME;
}
