import { PublicKey } from "@solana/web3.js";
import {
  transact,
} from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
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

export async function connectMwaWallet(AsyncStorage) {
  const storedAuthToken = AsyncStorage
    ? await AsyncStorage.getItem(AUTH_TOKEN_KEY)
    : null;

  const result = await transact(async (wallet) => {
    const authorizationResult = await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: APP_IDENTITY,
      ...(storedAuthToken ? { auth_token: storedAuthToken } : {}),
    });
    return authorizationResult;
  });

  const account = result.accounts?.[0];
  if (!account?.address) {
    throw new Error("Wallet connected but returned no account.");
  }

  const address = mwaAddressToBase58(account.address);
  if (AsyncStorage && result.auth_token) {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, result.auth_token);
  }

  return {
    address,
    authToken: result.auth_token ?? null,
    label: account.label ?? null,
  };
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
