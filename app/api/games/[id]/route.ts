import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import {
  deleteGameOnServer,
  fetchGameFromServer,
  isGameVisible,
  updateGameOnServer,
} from "@/lib/firestore-server";
import { normalizeImageAssetUrl } from "@/lib/game-assets";
import { GAMES_API_CACHE_CONTROL } from "@/lib/game-cache";
import { Game } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);

    if (!game || !isGameVisible(game)) {
      return NextResponse.json({ error: "Game not found." }, { status: 404 });
    }

    return NextResponse.json(
      { game },
      {
        headers: {
          "Cache-Control": GAMES_API_CACHE_CONTROL,
          "CDN-Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load game.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<Omit<Game, "id">>;
    if ("fallbackImage" in body) {
      body.fallbackImage = normalizeImageAssetUrl(body.fallbackImage);
    }
    if ("thumbnail" in body) {
      body.thumbnail = normalizeImageAssetUrl(body.thumbnail);
    }
    if ("logo" in body) {
      body.logo = normalizeImageAssetUrl(body.logo) || undefined;
    }
    await updateGameOnServer(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Failed to update game.");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();

  try {
    const { id } = await params;
    await deleteGameOnServer(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Failed to delete game.");
  }
}
