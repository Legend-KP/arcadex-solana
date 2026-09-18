/**
 * ArcadeX Seeker shell config.
 * Web URL + MWA app identity for connect-only authorize.
 */
export const DEFAULT_ARCADEX_WEB_URL = "https://arcadexseeker.trenchverse.com";

/** MWA chain id — Solana mainnet (MWA 2.0 identifier). */
export const SOLANA_CHAIN = "solana:mainnet";

export const APP_IDENTITY = {
  name: "ArcadeX",
  uri: "https://arcadexseeker.trenchverse.com",
  // Absolute icon is more reliable for Phantom / Seed Vault association UI.
  icon: "https://arcadexseeker.trenchverse.com/favicon.ico",
};

export function getArcadexWebUrl() {
  const fromEnv =
    typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_ARCADEX_URL?.trim();
  return fromEnv || DEFAULT_ARCADEX_WEB_URL;
}
