import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { reconcileGameFlags } from "@/lib/reconcile-game-flags";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Admin-only: compare Firestore games vs RTDB gameFlags.
 * GET  → report only
 * POST ?repair=1 → report + repair missing/mismatched/orphan flags
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`reconcile-flags:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const report = await reconcileGameFlags({ repair: false });
    return NextResponse.json(report);
  } catch (err) {
    return apiErrorResponse(err, "Failed to reconcile game flags.");
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`reconcile-flags-repair:${ip}`, 10, 60_000))) {
    return rateLimitResponse();
  }

  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);
    const repair =
      searchParams.get("repair") === "1" ||
      searchParams.get("repair") === "true";

    const report = await reconcileGameFlags({ repair });
    return NextResponse.json(report);
  } catch (err) {
    return apiErrorResponse(err, "Failed to reconcile game flags.");
  }
}
