import { PublicKey } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Buffer } from "buffer";
import { APP_IDENTITY, SOLANA_CHAIN } from "./config";

const AUTH_TOKEN_KEY = "arcadex_mwa_auth_token";

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function mwaAddressToBase58(address) {
  const bytes =
    typeof address === "string"
      ? Buffer.from(address, "base64")
      : Buffer.from(address);
  return new PublicKey(bytes).toBase58();
}

function buildSignInMessage(address) {
  return [
    "Sign in to ArcadeX",
    "Domain: arcadexseeker.trenchverse.com",
    `Wallet: ${address}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

function isAuthFailure(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("authorization") ||
    msg.includes("authorize") ||
    msg.includes("auth_token") ||
    msg.includes("not authorized") ||
    msg.includes("-1")
  );
}

async function authorizeWallet(wallet, authToken) {
  return wallet.authorize({
    chain: SOLANA_CHAIN,
    identity: APP_IDENTITY,
    ...(authToken ? { auth_token: authToken } : {}),
  });
}

export async function connectAndSignInMwaWallet(AsyncStorage) {
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
    if (storedAuthToken && isAuthFailure(err)) {
      if (AsyncStorage) await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      result = await run(null);
    } else {
      throw err;
    }
  }

  if (AsyncStorage && result.authToken) {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.authToken);
  }

  return result;
}

export async function connectMwaWallet(AsyncStorage) {
  return connectAndSignInMwaWallet(AsyncStorage);
}

/**
 * Paid SPL fee. Prepares tx OUTSIDE the wallet session, then authorize+send fast.
 * @param {{ purpose: string, token: string, payerBase58?: string }} opts
 */
export async function payArcadeFeeMwa(AsyncStorage, opts) {
  const {
    prepareArcadePay,
    assembleArcadePayTx,
    fetchFreshBlockhash,
  } = await import("./solana-pay");

  const payerBase58 = opts.payerBase58?.trim();
  if (!payerBase58) {
    throw new Error("Connect & sign in with your Solana wallet first.");
  }

  // Heavy RPC before opening Phantom — avoids MWA session timeout / -1 auth failures.
  const prepared = await prepareArcadePay({
    payerBase58,
    purpose: opts.purpose,
    token: opts.token,
  });

  const storedAuthToken = AsyncStorage
    ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
    : null;

  const run = async (authToken) =>
    transact(async (wallet) => {
      const authorizationResult = await authorizeWallet(wallet, authToken);

      if (AsyncStorage && authorizationResult.auth_token) {
        await AsyncStorage.setItem(
          AUTH_TOKEN_KEY,
          authorizationResult.auth_token
        );
      }

      const account = authorizationResult.accounts?.[0];
      if (!account?.address) {
        throw new Error("Wallet authorized but returned no account.");
      }

      const address = mwaAddressToBase58(account.address);
      if (address !== payerBase58) {
        throw new Error(
          "Connected wallet changed. Sign in again, then retry payment."
        );
      }

      const { blockhash, lastValidBlockHeight } = await fetchFreshBlockhash();
      const transaction = assembleArcadePayTx(
        prepared,
        blockhash,
        lastValidBlockHeight
      );

      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });

      const signature = signatures?.[0];
      if (!signature) {
        throw new Error("Wallet did not return a payment signature.");
      }

      return {
        address,
        purpose: opts.purpose,
        token: opts.token,
        signature: typeof signature === "string" ? signature : String(signature),
      };
    });

  try {
    return await run(storedAuthToken);
  } catch (err) {
    if (storedAuthToken && isAuthFailure(err)) {
      if (AsyncStorage) await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      return run(null);
    }
    throw err;
  }
}

export async function disconnectMwaWallet(AsyncStorage) {
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
