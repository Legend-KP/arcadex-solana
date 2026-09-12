import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { reorderGamesOnServer } from "@/lib/firestore-server";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const body = (await request.json()) as { order?: string[] };
    const order = body.order;

    if (!Array.isArray(order) || order.length === 0) {
      return NextResponse.json(
        { error: "order must be a non-empty array of game IDs." },
        { status: 400 }
      );
    }

    if (!order.every((id) => typeof id === "string" && id.trim())) {
      return NextResponse.json(
        { error: "Each game ID must be a non-empty string." },
        { status: 400 }
      );
    }

    await reorderGamesOnServer(order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Failed to reorder games.");
  }
}
