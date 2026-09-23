import { Mission, MissionProgressView, MissionType } from "@/lib/achievements";
import { walletAuthHeaders } from "@/lib/wallet-session-client";

export interface AchievementsPayload {
  xp: number;
  missions: MissionProgressView[];
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

export async function fetchAchievements(): Promise<AchievementsPayload> {
  const res = await fetch("/api/achievements", {
    cache: "no-store",
    headers: walletAuthHeaders(),
  });
  const data = await readJson<AchievementsPayload>(res);
  return {
    xp: data.xp ?? 0,
    missions: data.missions ?? [],
  };
}

export async function claimAchievement(
  missionId: string
): Promise<{ xp: number; mission: MissionProgressView }> {
  const res = await fetch("/api/achievements", {
    method: "POST",
    headers: walletAuthHeaders(),
    body: JSON.stringify({ missionId }),
  });
  return readJson<{ xp: number; mission: MissionProgressView }>(res);
}

export interface MissionDraft {
  gameId: string;
  title: string;
  description?: string;
  type: MissionType;
  threshold: number;
  mode?: string;
  xpReward: number;
  active?: boolean;
  sortOrder?: number;
}

export async function fetchAdminMissions(): Promise<Mission[]> {
  const res = await fetch("/api/admin/missions", {
    cache: "no-store",
    credentials: "include",
  });
  const data = await readJson<{ missions: Mission[] }>(res);
  return data.missions ?? [];
}

export async function createAdminMission(draft: MissionDraft): Promise<Mission> {
  const res = await fetch("/api/admin/missions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const data = await readJson<{ mission: Mission }>(res);
  if (!data.mission) throw new Error("Could not create mission.");
  return data.mission;
}

export async function updateAdminMission(
  id: string,
  draft: MissionDraft
): Promise<Mission> {
  const res = await fetch(`/api/admin/missions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const data = await readJson<{ mission: Mission }>(res);
  if (!data.mission) throw new Error("Could not update mission.");
  return data.mission;
}

export async function deleteAdminMission(id: string): Promise<void> {
  const res = await fetch(`/api/admin/missions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  await readJson<{ ok: boolean }>(res);
}
