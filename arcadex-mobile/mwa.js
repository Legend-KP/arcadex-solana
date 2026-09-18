import { PublicKey } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Buffer } from "buffer";
import { APP_IDENTITY, SOLANA_CHAIN } from "./config";
import { buildArcadePayTransaction } from "./solana-pay";

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

export async function connectAndSignInMwaWallet(AsyncStorage) {
  const storedAuthToken = AsyncStorage
    ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
    : null;

  const result = await transact(async (wallet) => {
    const authorizationResult = await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: APP_IDENTITY,
      ...(storedAuthToken ? { auth_token: storedAuthToken } : {}),
    });

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

  if (AsyncStorage && result.authToken) {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.authToken);
  }

  return result;
}

export async function connectMwaWallet(AsyncStorage) {
  return connectAndSignInMwaWallet(AsyncStorage);
}

/** Paid SPL USDC/USDT fee → treasury + memo via MWA. */
export async function payArcadeFeeMwa(AsyncStorage, { purpose, token }) {
  const storedAuthToken = AsyncStorage
    ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
    : null;

  return transact(async (wallet) => {
    const authorizationResult = await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: APP_IDENTITY,
      ...(storedAuthToken ? { auth_token: storedAuthToken } : {}),
    });

    if (AsyncStorage && authorizationResult.auth_token) {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, authorizationResult.auth_token);
    }

    const account = authorizationResult.accounts?.[0];
    if (!account?.address) {
      throw new Error("Wallet authorized but returned no account.");
    }

    const address = mwaAddressToBase58(account.address);
    const { transaction } = await buildArcadePayTransaction({
      payerBase58: address,
      purpose,
      token,
    });

    const signatures = await wallet.signAndSendTransactions({
      transactions: [transaction],
    });

    const signature = signatures?.[0];
    if (!signature) {
      throw new Error("Wallet did not return a payment signature.");
    }

    return {
      address,
      purpose,
      token,
      signature: typeof signature === "string" ? signature : String(signature),
    };
  });
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
