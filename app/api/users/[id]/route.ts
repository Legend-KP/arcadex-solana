import { NextResponse } from "next/server";
import { fetchUserFromServer, upsertUserOnServer } from "@/lib/player-backend";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  isWalletAddress,
  normalizeWalletAddress,
  tryNormalizeWalletAddress,
} from "@/lib/wallet-address";
import { requireWalletAuth } from "@/lib/wallet-session";

export const dynamic = "force-dynamic";

const NAME_RE = /^[\w\s.-]{1,20}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`users-get:ip:${ip}`, 90, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const wallet = tryNormalizeWalletAddress(id);
    if (!wallet) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const user = await fetchUserFromServer(wallet);
    return NextResponse.json({ user: user ?? null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`users-put:ip:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const body = (await request.json()) as {
      name?: string;
      walletAddress?: string;
    };

    const name = body.name?.trim() ?? "";
    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        { error: "Name must be 1–20 characters (letters, numbers, spaces)." },
        { status: 400 }
      );
    }

    const wallet =
      tryNormalizeWalletAddress(body.walletAddress) ??
      (isWalletAddress(id) ? normalizeWalletAddress(id) : null);

    if (!wallet) {
      return NextResponse.json(
        { error: "Wallet address is required." },
        { status: 400 }
      );
    }

    if (!(await checkRateLimit(`users-put:wallet:${wallet}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    const auth = await requireWalletAuth(request, wallet);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (isWalletAddress(id) && normalizeWalletAddress(id) !== wallet) {
      return NextResponse.json(
        { error: "Profile id does not match authenticated wallet." },
        { status: 403 }
      );
    }

    const user = await upsertUserOnServer(wallet, {
      name,
      walletAddress: wallet,
    });

    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
