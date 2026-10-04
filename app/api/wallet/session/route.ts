import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import { normalizeWalletAddress } from "@/lib/wallet-address";
import {
  createWalletSessionToken,
  isWalletAuthEnabled,
} from "@/lib/wallet-session";
import { bootstrapUserOnServer } from "@/lib/player-backend";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_AGE_MS = 15 * 60 * 1000;

function parseSignInMessage(message: string): {
  wallet: string;
  issuedAt: number;
} | null {
  const lines = message.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== "Sign in to ArcadeX") return null;
  if (!lines.some((l) => l.startsWith("Domain:"))) return null;

  const walletLine = lines.find((l) => l.startsWith("Wallet:"));
  const issuedLine = lines.find((l) => l.startsWith("Issued At:"));
  if (!walletLine || !issuedLine) return null;

  const wallet = walletLine.slice("Wallet:".length).trim();
  const issuedRaw = issuedLine.slice("Issued At:".length).trim();
  const issuedAt = Date.parse(issuedRaw);
  if (!wallet || !Number.isFinite(issuedAt)) return null;
  return { wallet, issuedAt };
}

function verifyEd25519Message(
  wallet: string,
  message: string,
  signatureBase64: string
): boolean {
  try {
    const pubkey = new PublicKey(wallet).toBytes();
    const msg = new TextEncoder().encode(message);
    const sig = Buffer.from(signatureBase64, "base64");
    if (sig.length < 64) return false;
    return nacl.sign.detached.verify(msg, sig.subarray(0, 64), pubkey);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`wallet-session:ip:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  try {
    if (!isWalletAuthEnabled()) {
      return NextResponse.json(
        {
          error:
            "Server authentication is not configured. Set WALLET_SESSION_SECRET.",
          code: "AUTH_DISABLED",
        },
        { status: 503 }
      );
    }

    const body = (await request.json()) as {
      walletAddress?: string;
      message?: string;
      signatureBase64?: string;
    };

    const walletRaw = body.walletAddress?.trim() ?? "";
    const message = body.message?.trim() ?? "";
    const signatureBase64 = body.signatureBase64?.trim() ?? "";

    if (!walletRaw || !isSolanaAddress(walletRaw)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!message || !signatureBase64) {
      return NextResponse.json(
        { error: "message and signatureBase64 are required.", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const parsed = parseSignInMessage(message);
    if (!parsed) {
      return NextResponse.json(
        { error: "Unrecognized sign-in message.", code: "BAD_MESSAGE" },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(walletRaw);
    const messageWallet = normalizeWalletAddress(parsed.wallet);
    if (wallet !== messageWallet) {
      return NextResponse.json(
        { error: "Wallet does not match signed message.", code: "WALLET_MISMATCH" },
        { status: 403 }
      );
    }

    const age = Date.now() - parsed.issuedAt;
    if (age < -60_000 || age > MAX_MESSAGE_AGE_MS) {
      return NextResponse.json(
        { error: "Sign-in message expired. Connect again.", code: "EXPIRED" },
        { status: 401 }
      );
    }

    if (!verifyEd25519Message(wallet, message, signatureBase64)) {
      return NextResponse.json(
        { error: "Invalid wallet signature.", code: "BAD_SIGNATURE" },
        { status: 401 }
      );
    }

    if (!(await checkRateLimit(`wallet-session:wallet:${wallet}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    const [token, user] = await Promise.all([
      createWalletSessionToken(wallet),
      bootstrapUserOnServer(wallet).catch(() => null),
    ]);

    return NextResponse.json({
      ok: true,
      token,
      walletAddress: wallet,
      user,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create wallet session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
