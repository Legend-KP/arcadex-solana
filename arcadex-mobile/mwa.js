import { PublicKey } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Buffer } from "buffer";
import { APP_IDENTITY, SOLANA_CHAIN } from "./config";

const AUTH_TOKEN_KEY = "arcadex_mwa_auth_token";

/** Serialize MWA sessions — overlapping transact() calls cancel each other. */
let mwaQueue = Promise.resolve();

function withMwaLock(fn) {
  const run = mwaQueue.then(
    () => fn(),
    () => fn()
  );
  mwaQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/**
 * MWA account.address is usually base64, but some wallets return base58.
 * Trying the wrong decode makes the "wallet changed" check fail and aborts
 * before the sign popup.
 */
export function mwaAddressToBase58(address) {
  if (address instanceof PublicKey) {
    return address.toBase58();
  }
  if (typeof address !== "string") {
    return new PublicKey(Buffer.from(address)).toBase58();
  }

  const trimmed = address.trim();
  // Already base58 (Solana pubkey charset, typical length 32–44).
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    try {
      return new PublicKey(trimmed).toBase58();
    } catch {
      /* fall through */
    }
  }

  try {
    return new PublicKey(Buffer.from(trimmed, "base64")).toBase58();
  } catch {
    /* fall through */
  }

  // Last resort: treat as raw base58 again (throws a clear error).
  return new PublicKey(trimmed).toBase58();
}

function buildSignInMessage(address) {
  return [
    "Sign in to ArcadeX",
    "Domain: arcadexseeker.trenchverse.com",
    `Wallet: ${address}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function errorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  const parts = [err.name, err.message, err.code, err.cause?.message];
  try {
    parts.push(JSON.stringify(err));
  } catch {
    /* ignore */
  }
  return parts.filter(Boolean).join(" ");
}

export function isUserCancellation(err) {
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes("cancellationexception") ||
    msg.includes("cancellation") ||
    msg.includes("canceled") ||
    msg.includes("cancelled") ||
    msg.includes("user rejected") ||
    msg.includes("user declined") ||
    msg.includes("declined the request")
  );
}

function isAuthFailure(err) {
  if (isUserCancellation(err)) return false;
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes("authorization") ||
    msg.includes("authorize") ||
    msg.includes("auth_token") ||
    msg.includes("not authorized") ||
    msg.includes("-32602") ||
    msg.includes("-1/")
  );
}

export function formatMwaError(err, fallback = "Wallet request failed.") {
  if (isUserCancellation(err)) {
    return "Wallet request was cancelled. Tap again and approve in Phantom.";
  }
  const msg = String(err?.message || err || "").trim();
  if (msg) return msg;
  return fallback;
}

async function authorizeWallet(wallet, authToken) {
  // Prefer reauthorize when we already have a token (avoids connect UI).
  if (authToken && typeof wallet.reauthorize === "function") {
    try {
      return await wallet.reauthorize({
        auth_token: authToken,
        identity: APP_IDENTITY,
      });
    } catch (err) {
      console.warn("MWA_PAY", "reauthorize_failed", err?.message);
      // Fall through to full authorize.
    }
  }
  return wallet.authorize({
    chain: SOLANA_CHAIN,
    identity: APP_IDENTITY,
    ...(authToken ? { auth_token: authToken } : {}),
  });
}

export async function connectAndSignInMwaWallet(AsyncStorage) {
  return withMwaLock(async () => {
    const storedAuthToken = AsyncStorage
      ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
      : null;

    const run = async (authToken) =>
      transact(async (wallet) => {
        const authorizationResult = await authorizeWallet(wallet, authToken);

        const account = authorizationResult.accounts?.[0];
        if (!account?.address) {
          throw new Error("Wallet connected but returned no account.");
        }

        const address = mwaAddressToBase58(account.address);
        const message = buildSignInMessage(address);
        const messageBytes = new Uint8Array(Buffer.from(message, "utf8"));

        const signed = await wallet.signMessages({
          addresses: [account.address],
          payloads: [messageBytes],
        });

        const signatureBytes = signed?.[0];
        if (!signatureBytes) {
          throw new Error("Wallet did not return a sign-in signature.");
        }

        return {
          address,
          label: account.label ?? null,
          authToken: authorizationResult.auth_token ?? null,
          message,
          signatureBase64: Buffer.from(signatureBytes).toString("base64"),
        };
      });

    let result;
    try {
      result = await run(storedAuthToken);
    } catch (err) {
      if (isUserCancellation(err)) {
        throw new Error(formatMwaError(err));
      }
      if (storedAuthToken && isAuthFailure(err)) {
        if (AsyncStorage) await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
        try {
          result = await run(null);
        } catch (err2) {
          throw new Error(formatMwaError(err2));
        }
      } else {
        throw new Error(formatMwaError(err));
      }
    }

    if (AsyncStorage && result.authToken) {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.authToken);
    }

    return result;
  });
}

export async function connectMwaWallet(AsyncStorage) {
  return connectAndSignInMwaWallet(AsyncStorage);
}

function logMwaPayError(label, err) {
  console.warn(
    "MWA_PAY_ERROR",
    label,
    err?.name,
    err?.code,
    err?.message,
    err?.stack
  );
}

/**
 * Paid SPL fee. Build the full tx OUTSIDE the wallet session.
 * Inside `transact`: authorize + sign only (we broadcast ourselves).
 * @param {{ purpose: string, token: string, payerBase58?: string }} opts
 */
export async function payArcadeFeeMwa(AsyncStorage, opts) {
  return withMwaLock(async () => {
    const { buildArcadePayTx, sendSignedArcadePayTx } = await import(
      "./solana-pay"
    );

    const payerBase58 = opts.payerBase58?.trim();
    if (!payerBase58) {
      throw new Error("Connect & sign in with your Solana wallet first.");
    }

    // ALL RPC + assembly before Phantom opens.
    let built;
    try {
      built = await buildArcadePayTx({
        payerBase58,
        purpose: opts.purpose,
        token: opts.token,
      });
    } catch (err) {
      logMwaPayError("build_tx", err);
      throw new Error(formatMwaError(err, "Payment failed."));
    }

    const storedAuthToken = AsyncStorage
      ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
      : null;

    console.warn(
      "MWA_PAY",
      "open_session",
      storedAuthToken ? "has_token" : "no_token",
      payerBase58.slice(0, 8)
    );

    const run = async (authToken) => {
      const result = await transact(async (wallet) => {
        console.warn("MWA_PAY", "authorize_start");
        const authorizationResult = await authorizeWallet(wallet, authToken);
        console.warn("MWA_PAY", "authorize_ok");

        const account = authorizationResult.accounts?.[0];
        if (!account?.address) {
          throw new Error("Wallet authorized but returned no account.");
        }

        const address = mwaAddressToBase58(account.address);
        console.warn("MWA_PAY", "authorized_address", address.slice(0, 8));

        if (address !== payerBase58) {
          // Do NOT call sign with a mismatched feePayer — Phantom would
          // close without a usable popup. Surface a clear error instead.
          throw new Error(
            `Wallet mismatch. Signed in as ${payerBase58.slice(0, 4)}… but Phantom authorized ${address.slice(0, 4)}…. Sign in again with the same wallet.`
          );
        }

        // Prefer signTransactions — Phantom shows the approve sheet more
        // reliably than signAndSend for some SPL transfers.
        console.warn("MWA_PAY", "sign_start");
        const signed = await wallet.signTransactions({
          transactions: [built.transaction],
        });
        console.warn("MWA_PAY", "sign_ok");

        const signedTx = signed?.[0];
        if (!signedTx) {
          throw new Error("Wallet did not return a signed payment.");
        }

        return {
          address,
          authToken: authorizationResult.auth_token ?? null,
          signedTx,
          purpose: opts.purpose,
          token: opts.token,
        };
      });

      if (AsyncStorage && result.authToken) {
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.authToken);
      }

      console.warn("MWA_PAY", "broadcast_start");
      try {
        const signature = await sendSignedArcadePayTx(result.signedTx);
        console.warn("MWA_PAY", "broadcast_ok", String(signature).slice(0, 12));
        return {
          address: result.address,
          purpose: result.purpose,
          token: result.token,
          signature:
            typeof signature === "string" ? signature : String(signature),
        };
      } catch (broadcastErr) {
        logMwaPayError("broadcast", broadcastErr);
        throw broadcastErr;
      }
    };

    try {
      return await run(storedAuthToken);
    } catch (err) {
      logMwaPayError("session", err);
      if (isUserCancellation(err)) {
        throw new Error(formatMwaError(err));
      }
      if (storedAuthToken && isAuthFailure(err)) {
        if (AsyncStorage) await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
        try {
          return await run(null);
        } catch (err2) {
          logMwaPayError("session_retry", err2);
          throw new Error(formatMwaError(err2, "Payment failed."));
        }
      }
      throw new Error(formatMwaError(err, "Payment failed."));
    }
  });
}

export async function disconnectMwaWallet(AsyncStorage) {
  return withMwaLock(async () => {
    const storedAuthToken = AsyncStorage
      ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
      : null;

    if (storedAuthToken) {
      try {
        await transact(async (wallet) => {
          await wallet.deauthorize({ auth_token: storedAuthToken });
        });
      } catch {
        // Best-effort
      }
    }

    if (AsyncStorage) {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    }
  });
}

export function buildNativeReplyScript(payload) {
  const b64 = toBase64UrlJson(payload);
  return `
    (function() {
      try {
        var raw = ${JSON.stringify(b64)};
        var json = JSON.parse(atob(raw));
        window.dispatchEvent(new CustomEvent('arcadex-native', { detail: json }));
        if (typeof window.__arcadexOnNativeMessage === 'function') {
          window.__arcadexOnNativeMessage(json);
        }
      } catch (e) {
        console.warn('[ArcadeX native bridge]', e);
      }
      true;
    })();
  `;
}

export const INJECTED_SHELL_FLAG = `
  (function() {
    window.__ARCADEX_NATIVE_SHELL__ = true;
    window.__ARCADEX_BRIDGE__ = 'mwa-v1';
    true;
  })();
`;
