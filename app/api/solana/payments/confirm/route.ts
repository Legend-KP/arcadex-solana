import { NextResponse } from "next/server";
import { requireD1 } from "@/lib/d1-client";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isSolanaAddress } from "@/lib/solana-address";
import {
  SOLANA_FEE_USD,
  type SolanaPayPurpose,
} from "@/lib/solana-config";
import {
  SolanaPaymentVerifyError,
  verifySolanaArcadePayment,
} from "@/lib/solana-payment-verify";

export const dynamic = "force-dynamic";

const PURPOSES = new Set<SolanaPayPurpose>([
  "spark_refill",
  "infinite_spark",
  "score_submit",
]);

function guardKey(purpose: SolanaPayPurpose, signature: string): string {
  return `solana:${purpose}:${signature}`;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`solana-pay:ip:${ip}`, 40, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      signature?: string;
      walletAddress?: string;
      purpose?: string;
    };

    const signature = body.signature?.trim() ?? "";
    const walletAddress = body.walletAddress?.trim() ?? "";
    const purpose = body.purpose?.trim() as SolanaPayPurpose | undefined;

    if (!isSolanaAddress(walletAddress)) {
      return NextResponse.json(
        { error: "A valid Solana wallet is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }
    if (!purpose || !PURPOSES.has(purpose)) {
      return NextResponse.json(
        { error: "Invalid payment purpose.", code: "INVALID_PURPOSE" },
        { status: 400 }
      );
    }
    if (!signature) {
      return NextResponse.json(
        { error: "signature is required.", code: "INVALID_TX" },
        { status: 400 }
      );
    }

    if (
      !(await checkRateLimit(`solana-pay:wallet:${walletAddress}`, 20, 60_000))
    ) {
      return rateLimitResponse();
    }

    const verified = await verifySolanaArcadePayment({
      signature,
      expectedPayer: walletAddress,
      expectedPurpose: purpose,
    });

    const db = await requireD1();
    const pk = guardKey(purpose, signature);
    const now = Date.now();
    const insert = await db
      .prepare(
        `INSERT OR IGNORE INTO payment_guards (tx_hash, kind, wallet, extra_json, used_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        pk,
        `solana_${purpose}`,
        walletAddress,
        JSON.stringify({
          signature,
          purpose,
          token: verified.token,
          amount: verified.amount,
          mint: verified.mint,
          activatedAt: now,
        }),
        now
      )
      .run();

    const created = insert.meta?.changes === 1;
    if (!created) {
      const existing = await db
        .prepare(`SELECT wallet FROM payment_guards WHERE tx_hash = ?`)
        .bind(pk)
        .first<{ wallet: string }>();
      if (existing?.wallet && existing.wallet !== walletAddress) {
        return NextResponse.json(
          {
            error: "This payment was already used by another wallet.",
            code: "TX_ALREADY_USED",
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      purpose,
      token: verified.token,
      amountUsd: SOLANA_FEE_USD[purpose],
      signature,
      alreadyUsed: !created,
    });
  } catch (err) {
    if (err instanceof SolanaPaymentVerifyError) {
      const status = err.code === "NOT_CONFIRMED" ? 409 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    const message =
      err instanceof Error ? err.message : "Could not confirm Solana payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
