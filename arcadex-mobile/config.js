/**
 * Web URL loaded by the ArcadeX Android WebView shell.
 *
 * After you create the new Cloudflare production Worker, set:
 *   EXPO_PUBLIC_ARCADEX_URL=https://your-new-domain.example
 * or edit DEFAULT_ARCADEX_WEB_URL below, then rebuild the preview APK.
 */
export const DEFAULT_ARCADEX_WEB_URL = "https://arcadexseeker.trenchverse.com";

export function getArcadexWebUrl() {
  const fromEnv =
    typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_ARCADEX_URL?.trim();
  return fromEnv || DEFAULT_ARCADEX_WEB_URL;
}
