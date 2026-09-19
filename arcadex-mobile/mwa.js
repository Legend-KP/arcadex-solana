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

/**
 * True only for errors that mean the stored auth token is stale/rejected.
 * MWA code -1 = ERROR_AUTHORIZATION_FAILED ("-1/authorization request failed").
 */
function isAuthFailure(err) {
  if (isUserCancellation(err)) return false;
  const msg = errorText(err).toLowerCase();
  return (
    msg.includes("auth_token") ||
    msg.includes("not authorized") ||
    msg.includes("authorization request failed") ||
    msg.includes("-32602") ||
    /(^|\s|")-1\//.test(msg)
  );
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`Timed out: ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

export function formatMwaError(err, fallback = "Wallet request failed.") {
  if (isUserCancellation(err)) {
    return "Wallet request was cancelled. Tap again and approve in Phantom.";
  }
  const msg = String(err?.message || err || "").trim();
  if (msg.toLowerCase().includes("authorization request failed")) {
    return "Phantom rejected the connection. In Phantom, go to Settings → Connected apps, remove ArcadeX, then tap again.";
  }
  if (msg) return msg;
  return fallback;
}

async function freshAuthorize(wallet) {
  return wallet.authorize({ chain: SOLANA_CHAIN, identity: APP_IDENTITY });
}

/**
 * Reuse a stored token when Phantom still accepts it; otherwise fall back to
 * a fresh authorize in the SAME session. Retrying with a rejected token gives
 * "-1/authorization request failed" every time, so never resend it.
 */
async function authorizeWallet(wallet, authToken) {
  if (!authToken) return freshAuthorize(wallet);

  try {
    if (typeof wallet.reauthorize === "function") {
      return await wallet.reauthorize({
        auth_token: authToken,
        identity: APP_IDENTITY,
      });
    }
    return await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: APP_IDENTITY,
      auth_token: authToken,
    });
  } catch (err) {
    if (isUserCancellation(err)) throw err;
    console.warn("MWA_PAY", "token_authorize_failed", err?.code, err?.message);
  }

  console.warn("MWA_PAY", "fresh_authorize");
  return freshAuthorize(wallet);
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
    const {
      prepareArcadePay,
      fetchFreshBlockhash,
      assembleArcadePayTx,
      sendSignedArcadePayTx,
    } = await import("./solana-pay");

    const payerBase58 = opts.payerBase58?.trim();
    if (!payerBase58) {
      throw new Error("Connect & sign in with your Solana wallet first.");
    }

    // Balance / ATA checks before Phantom opens. The blockhash is fetched
    // INSIDE the session right before signing: a blockhash only lives ~60-90s
    // and Phantom's popup + the user's confirm can easily exceed that.
    let prepared;
    try {
      prepared = await prepareArcadePay({
        payerBase58,
        purpose: opts.purpose,
        token: opts.token,
      });
    } catch (err) {
      logMwaPayError("prepare", err);
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

    let step = "init";

    const run = async (authToken) => {
      const result = await withTimeout(
        transact(async (wallet) => {
          step = "authorize";
          const auth = await authorizeWallet(wallet, authToken);
          const account = auth.accounts?.[0];
          if (!account?.address) throw new Error("Wallet returned no account.");

          const address = mwaAddressToBase58(account.address);
          if (address !== payerBase58) {
            throw new Error(
              `Wallet mismatch: signed in ${payerBase58.slice(0, 4)}…, Phantom gave ${address.slice(0, 4)}…`
            );
          }

          // Fresh blockhash as late as possible, then assemble (no RPC).
          step = "blockhash";
          const { blockhash, lastValidBlockHeight } = await fetchFreshBlockhash();
          const transaction = assembleArcadePayTx(
            prepared,
            blockhash,
            lastValidBlockHeight
          );
          console.warn("MWA_PAY", "tx_ready", blockhash.slice(0, 8));

          // Sign only; we broadcast + confirm ourselves. If the session times
          // out after this point nothing has been sent, so no funds move.
          step = "signTransactions";
          const [signedTx] = await wallet.signTransactions({
            transactions: [transaction],
          });
          if (!signedTx) throw new Error("Wallet did not return a signed payment.");
          return {
            address,
            authToken: auth.auth_token ?? null,
            signedTx,
            blockhash,
            lastValidBlockHeight,
          };
        }),
        180_000,
        "wallet session"
      );

      if (AsyncStorage && result.authToken) {
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.authToken);
      }

      step = "broadcast";
      const signature = await sendSignedArcadePayTx(result.signedTx, {
        blockhash: result.blockhash,
        lastValidBlockHeight: result.lastValidBlockHeight,
      });
      console.warn("MWA_PAY", "broadcast_ok", signature.slice(0, 12));
      return { address: result.address, purpose: opts.purpose, token: opts.token, signature };
    };

    try {
      return await run(storedAuthToken);
    } catch (err) {
      logMwaPayError("session", err);
      if (isUserCancellation(err)) throw new Error(formatMwaError(err));
      // Only retry with a fresh authorize if the failure happened during authorize.
      if (storedAuthToken && step === "authorize" && isAuthFailure(err)) {
        if (AsyncStorage) await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
        try {
          return await run(null);
        } catch (err2) {
          logMwaPayError("session_retry", err2);
          throw new Error(`${formatMwaError(err2, "Payment failed.")} [step: ${step}]`);
        }
      }
      throw new Error(`${formatMwaError(err, "Payment failed.")} [step: ${step}]`);
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
