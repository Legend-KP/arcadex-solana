import { NextResponse } from "next/server";
import {
  bindWalletSessionDevice,
  getDeviceSeenAt,
  getWalletSessionDeviceHash,
  recordDeviceSeenIfAbsent,
} from "@/lib/player-backend";

export const DEVICE_COOKIE_NAME = "ax_did";
const DEVICE_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const DEVICE_ID_RE = /^[a-f0-9]{32}$/;
/** Allow block-time vs Worker clock drift without accepting post-tx status polls. */
const ON_CHAIN_CLOCK_SKEW_MS = 5_000;

function isSecureCookie(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CF_PAGES === "1" ||
    Boolean(process.env.CF_WORKER)
  );
}

function parseCookieHeader(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export function readDeviceCookie(request: Request): string | null {
  const raw = parseCookieHeader(
    request.headers.get("Cookie"),
    DEVICE_COOKIE_NAME
  );
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  return DEVICE_ID_RE.test(id) ? id : null;
}

export function createDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function deviceCookieHeader(deviceId: string): string {
  const secure = isSecureCookie() ? "; Secure" : "";
  return `${DEVICE_COOKIE_NAME}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_COOKIE_MAX_AGE_SEC}${secure}`;
}

export async function hashDeviceId(deviceId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(deviceId)
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export function withDeviceCookie(
  response: NextResponse,
  setCookie: string | null
): NextResponse {
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
}

/**
 * Issue or reuse the HttpOnly device cookie and remember first-seen time
 * for this wallet. Used on status + shuffle prepare (before the on-chain tx).
 */
export async function ensureDeviceBinding(
  request: Request,
  wallet: string
): Promise<{
  deviceId: string;
  deviceHash: string;
  setCookie: string | null;
  firstSeenAt: number;
}> {
  let deviceId = readDeviceCookie(request);
  let setCookie: string | null = null;
  if (!deviceId) {
    deviceId = createDeviceId();
    setCookie = deviceCookieHeader(deviceId);
  }
  const deviceHash = await hashDeviceId(deviceId);
  const firstSeenAt = await recordDeviceSeenIfAbsent(wallet, deviceHash);
  return { deviceId, deviceHash, setCookie, firstSeenAt };
}

export function deviceSeenBeforeOnChainTx(
  seenAtMs: number,
  txTimestamp: bigint | number
): boolean {
  const raw = Number(txTimestamp);
  if (!Number.isFinite(raw) || raw <= 0) return false;
  const txMs = raw > 1e12 ? raw : raw * 1000;
  return seenAtMs <= txMs + ON_CHAIN_CLOCK_SKEW_MS;
}

export async function canMintDailySession(opts: {
  wallet: string;
  deviceHash: string;
  txTimestamp?: bigint | number;
  lastCheckInAtSec?: number;
}): Promise<boolean> {
  const bound = await getWalletSessionDeviceHash(opts.wallet);
  if (bound && bound === opts.deviceHash) return true;

  const seenAt = await getDeviceSeenAt(opts.wallet, opts.deviceHash);
  if (!seenAt) return false;

  if (opts.txTimestamp !== undefined) {
    return deviceSeenBeforeOnChainTx(seenAt, opts.txTimestamp);
  }

  if (typeof opts.lastCheckInAtSec === "number" && opts.lastCheckInAtSec > 0) {
    if (deviceSeenBeforeOnChainTx(seenAt, opts.lastCheckInAtSec)) {
      return true;
    }
    // Pre-cookie check-in today: first MiniPay tab to restore a session
    // binds this device. Attackers after that fail the hash match above.
    if (!bound) return true;
  }

  return false;
}

export async function markDailySessionDevice(
  wallet: string,
  deviceHash: string
): Promise<void> {
  await bindWalletSessionDevice(wallet, deviceHash);
}
