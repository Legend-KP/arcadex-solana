/**
 * ArcadeX Seeker shell config.
 * Web URL + MWA app identity for connect-only authorize.
 */
export const DEFAULT_ARCADEX_WEB_URL = "https://arcadexseeker.trenchverse.com";

/** MWA chain id — mainnet for Seeker production testing. */
export const SOLANA_CHAIN = "solana:mainnet";

export const APP_IDENTITY = {
  name: "ArcadeX",
  uri: "https://arcadexseeker.trenchverse.com",
  icon: "favicon.ico",
};

export function getArcadexWebUrl() {
  const fromEnv =
    typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_ARCADEX_URL?.trim();
  return fromEnv || DEFAULT_ARCADEX_WEB_URL;
}
