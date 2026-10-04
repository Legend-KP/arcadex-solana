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
        document.documentElement.classList.add('arcadex-native-shell');
        // Native GameScreen already clears the status bar — avoid a second inset.
        document.documentElement.style.setProperty('--app-safe-top', '0px');
        document.documentElement.style.setProperty('--app-safe-bottom', '0px');
      } catch (e) {}
      try {
        localStorage.setItem('arcadex_guest_sparks', ${escapeForJsString(sparkJson)});
      } catch (e) {}
      ${pairs}
      // Safety net: if the web app client-routes to "/", leave GameScreen
      // instead of nesting home under the native ← Games chrome.
      try {
        function __arcadexNotifyLeaveIfHome() {
          try {
            var path = location.pathname || '';
            if (path !== '/' && path !== '') return;
            if (!window.ReactNativeWebView) return;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              source: 'arcadex-web',
              type: 'LEAVE_GAME'
            }));
          } catch (e) {}
        }
        var __ps = history.pushState;
        history.pushState = function() {
          __ps.apply(this, arguments);
          __arcadexNotifyLeaveIfHome();
        };
        var __rs = history.replaceState;
        history.replaceState = function() {
          __rs.apply(this, arguments);
          __arcadexNotifyLeaveIfHome();
        };
        window.addEventListener('popstate', __arcadexNotifyLeaveIfHome);
      } catch (e) {}
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
