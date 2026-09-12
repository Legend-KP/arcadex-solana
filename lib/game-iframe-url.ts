export interface GameIframeConfig {
  gameId: string;
  shellOrigin: string;
  walletAddress?: string;
  playerName?: string;
  hasLeaderboard: boolean;
  sessionToken?: string;
}

/** Shell origin for Unity HTTP calls back to `/api/games/{id}/progress`. */
export function getShellOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return "";
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

/**
 * Append ArcadeX session params so Unity can read config in Awake and
 * self-fetch progress from the shell API (cross-origin).
 */
export function buildGameIframeUrl(
  baseUrl: string,
  config: GameIframeConfig
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("arcadexGameId", config.gameId);
  url.searchParams.set("arcadexShell", config.shellOrigin);

  if (config.walletAddress) {
    url.searchParams.set("arcadexWallet", config.walletAddress);
  }
  if (config.playerName) {
    url.searchParams.set("arcadexPlayer", config.playerName);
  }
  if (config.sessionToken) {
    url.searchParams.set("arcadexSession", config.sessionToken);
  }

  url.searchParams.set(
    "arcadexHasLeaderboard",
    config.hasLeaderboard ? "1" : "0"
  );

  return url.toString();
}
