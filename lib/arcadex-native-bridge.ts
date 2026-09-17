/**
 * Bridge between ArcadeX web (Cloudflare) and the Expo native shell.
 * Step 4: connect · Step 5: free sign-in message (same MWA session).
 */

export type NativeBridgeMessage =
  | {
      source: "arcadex-native";
      type: "MWA_CONNECT_RESULT";
      requestId: string | null;
      ok: true;
      address: string;
      label?: string | null;
      message?: string;
      signatureBase64?: string;
      signedIn?: boolean;
    }
  | {
      source: "arcadex-native";
      type: "MWA_CONNECT_RESULT";
      requestId: string | null;
      ok: false;
      error: string;
    }
  | {
      source: "arcadex-native";
      type: "MWA_DISCONNECT_RESULT";
      requestId: string | null;
      ok: boolean;
      error?: string;
    };

declare global {
  interface Window {
    __ARCADEX_NATIVE_SHELL__?: boolean;
    __ARCADEX_BRIDGE__?: string;
    __arcadexOnNativeMessage?: (msg: NativeBridgeMessage) => void;
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

export function isArcadexNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.__ARCADEX_NATIVE_SHELL__ === true ||
    Boolean(window.ReactNativeWebView)
  );
}

function postToNative(payload: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.ReactNativeWebView) {
    throw new Error("Native wallet bridge is not available in this browser.");
  }
  window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}

function waitForNativeResult<T extends NativeBridgeMessage>(
  type: T["type"],
  requestId: string,
  timeoutMs = 120_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Wallet request timed out. Try again."));
    }, timeoutMs);

    function onEvent(event: Event) {
      const detail = (event as CustomEvent<NativeBridgeMessage>).detail;
      if (!detail || detail.source !== "arcadex-native") return;
      if (detail.type !== type) return;
      if (detail.requestId != null && detail.requestId !== requestId) return;
      cleanup();
      resolve(detail as T);
    }

    function onDirect(msg: NativeBridgeMessage) {
      if (!msg || msg.source !== "arcadex-native") return;
      if (msg.type !== type) return;
      if (msg.requestId != null && msg.requestId !== requestId) return;
      cleanup();
      resolve(msg as T);
    }

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("arcadex-native", onEvent);
      if (window.__arcadexOnNativeMessage === onDirect) {
        delete window.__arcadexOnNativeMessage;
      }
    }

    window.addEventListener("arcadex-native", onEvent);
    window.__arcadexOnNativeMessage = onDirect;
  });
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface MwaSignInResult {
  address: string;
  label?: string | null;
  message: string;
  signatureBase64: string;
  signedIn: boolean;
}

/**
 * Authorize + sign a free ArcadeX sign-in message in one wallet session.
 * Not a paid on-chain transfer.
 */
export async function requestMwaConnectAndSignIn(): Promise<MwaSignInResult> {
  const requestId = newRequestId();
  const pending = waitForNativeResult<
    Extract<NativeBridgeMessage, { type: "MWA_CONNECT_RESULT" }>
  >("MWA_CONNECT_RESULT", requestId);

  postToNative({
    source: "arcadex-web",
    type: "MWA_SIGN_IN",
    requestId,
  });

  const result = await pending;
  if (!result.ok) {
    throw new Error(result.error || "Wallet connect / sign-in failed.");
  }
  if (!result.message || !result.signatureBase64) {
    throw new Error("Wallet connected but sign-in signature was missing.");
  }
  return {
    address: result.address,
    label: result.label,
    message: result.message,
    signatureBase64: result.signatureBase64,
    signedIn: true,
  };
}

/** @deprecated Use requestMwaConnectAndSignIn — Step 5 always signs in. */
export async function requestMwaConnect(): Promise<{
  address: string;
  label?: string | null;
}> {
  const result = await requestMwaConnectAndSignIn();
  return { address: result.address, label: result.label };
}

export async function requestMwaDisconnect(): Promise<void> {
  const requestId = newRequestId();
  const pending = waitForNativeResult<
    Extract<NativeBridgeMessage, { type: "MWA_DISCONNECT_RESULT" }>
  >("MWA_DISCONNECT_RESULT", requestId);

  postToNative({
    source: "arcadex-web",
    type: "MWA_DISCONNECT",
    requestId,
  });

  const result = await pending;
  if (!result.ok) {
    throw new Error(result.error || "Wallet disconnect failed.");
  }
}
