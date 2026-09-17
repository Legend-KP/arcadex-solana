import { PublicKey } from "@solana/web3.js";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Buffer } from "buffer";
import { APP_IDENTITY, SOLANA_CHAIN } from "./config";

const AUTH_TOKEN_KEY = "arcadex_mwa_auth_token";

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/**
 * Convert MWA account address (base64 pubkey bytes) → base58 Solana address.
 */
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

/**
 * Step 4+5: authorize + free sign-in message in one MWA session.
 * Not a paid SOL transfer — ownership proof only (no gas).
 */
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

/** @deprecated Prefer connectAndSignInMwaWallet for Step 5. */
export async function connectMwaWallet(AsyncStorage) {
  return connectAndSignInMwaWallet(AsyncStorage);
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
      // Best-effort — still clear local token.
    }
  }

  if (AsyncStorage) {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

/** Build injectJavaScript snippet that delivers a bridge event to the web app. */
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
