import { sessionForInject } from "./session";
import { sparkStateJsonForInject } from "./sparks";

function escapeForJsString(value) {
  return JSON.stringify(String(value ?? ""));
}

/**
 * Runs before page JS — marks native shell and seeds localStorage the web
 * client already reads (session, wallet, sparks).
 */
export function buildBootstrapInject({ session, sparkState }) {
  const storage = sessionForInject(session || {});
  const sparkJson = sparkStateJsonForInject(sparkState || {});
  const pairs = Object.entries(storage)
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `try{localStorage.setItem(${escapeForJsString(k)},${escapeForJsString(v)});sessionStorage.setItem(${escapeForJsString(k)},${escapeForJsString(v)});}catch(e){}`
    )
    .join("\n");

  return `
    (function() {
      window.__ARCADEX_NATIVE_SHELL__ = true;
      window.__ARCADEX_BRIDGE__ = 'mwa-v1';
      try {
        localStorage.setItem('arcadex_guest_sparks', ${escapeForJsString(sparkJson)});
      } catch (e) {}
      ${pairs}
      true;
    })();
  `;
}

export function buildSparksExportScript() {
  return `
    (function() {
      try {
        var raw = localStorage.getItem('arcadex_guest_sparks') || '';
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            source: 'arcadex-web',
            type: 'SPARKS_EXPORT',
            stateJson: raw
          }));
        }
      } catch (e) {}
      true;
    })();
  `;
}
