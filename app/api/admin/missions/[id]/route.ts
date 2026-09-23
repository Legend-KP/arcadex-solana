import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { parseMissionWrite } from "@/lib/achievements";
import { deleteMission, updateMission } from "@/lib/d1-achievements";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const { id } = await params;
    const mission = await updateMission(id, parseMissionWrite(await request.json()));
    if (!mission) {
      return NextResponse.json({ error: "Mission not found." }, { status: 404 });
    }
    return NextResponse.json({ mission });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update mission.";
    const status = message.includes("must") || message.includes("required") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const { id } = await params;
    const removed = await deleteMission(id);
    if (!removed) {
      return NextResponse.json({ error: "Mission not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err, "Could not delete mission.");
  }
}
