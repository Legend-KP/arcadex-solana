import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  unauthorizedResponse,
  verifyAdminRequest,
} from "@/lib/admin-auth";
import { parseMissionWrite } from "@/lib/achievements";
import { createMission, listMissions } from "@/lib/d1-achievements";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const missions = await listMissions(false);
    return NextResponse.json({ missions });
  } catch (err) {
    return apiErrorResponse(err, "Could not load missions.");
  }
}

export async function POST(request: Request) {
  if (!(await verifyAdminRequest(request))) return unauthorizedResponse();
  try {
    const mission = await createMission(parseMissionWrite(await request.json()));
    return NextResponse.json({ mission });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create mission.";
    const status = message.includes("must") || message.includes("required") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
