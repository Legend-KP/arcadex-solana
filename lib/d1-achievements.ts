import { requireD1 } from "@/lib/d1-client";
import {
  Mission,
  MissionProgressView,
  MissionType,
  isMissionType,
  toMissionProgress,
} from "@/lib/achievements";
import { StoredGameProgress } from "@/types";

interface MissionRow {
  id: string;
  game_id: string;
  title: string;
  description: string;
  type: string;
  threshold: number;
  mode: string;
  xp_reward: number;
  active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface ProgressRow {
  game_id: string;
  s: number | null;
  l: number | null;
  st_json: string | null;
}

function rowToMission(row: MissionRow): Mission | null {
  if (!isMissionType(row.type)) return null;
  return {
    id: row.id,
    gameId: row.game_id,
    title: row.title,
    description: row.description ?? "",
    type: row.type,
    threshold: row.threshold,
    mode: row.mode ?? "",
    xpReward: row.xp_reward,
    active: row.active === 1,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProgress(row: ProgressRow): StoredGameProgress {
  const stored: StoredGameProgress = {};
  if (typeof row.s === "number") stored.s = row.s;
  if (typeof row.l === "number") stored.l = row.l;
  if (row.st_json) {
    try {
      const st = JSON.parse(row.st_json) as unknown;
      if (st && typeof st === "object" && !Array.isArray(st)) {
        stored.st = st as Record<string, unknown>;
      }
    } catch {
      // ignore malformed checkpoint JSON
    }
  }
  return stored;
}

export async function listMissions(activeOnly: boolean): Promise<Mission[]> {
  const db = await requireD1();
  const sql = activeOnly
    ? `SELECT id, game_id, title, description, type, threshold, mode, xp_reward,
              active, sort_order, created_at, updated_at
       FROM missions WHERE active = 1
       ORDER BY sort_order ASC, created_at ASC`
    : `SELECT id, game_id, title, description, type, threshold, mode, xp_reward,
              active, sort_order, created_at, updated_at
       FROM missions
       ORDER BY sort_order ASC, created_at ASC`;
  const result = await db.prepare(sql).all<MissionRow>();
  return (result.results ?? [])
    .map(rowToMission)
    .filter((mission): mission is Mission => mission !== null);
}

export async function getMission(id: string): Promise<Mission | null> {
  const db = await requireD1();
  const row = await db
    .prepare(
      `SELECT id, game_id, title, description, type, threshold, mode, xp_reward,
              active, sort_order, created_at, updated_at
       FROM missions WHERE id = ?`
    )
    .bind(id)
    .first<MissionRow>();
  return row ? rowToMission(row) : null;
}

async function listProgress(
  wallet: string
): Promise<Map<string, StoredGameProgress>> {
  const db = await requireD1();
  const result = await db
    .prepare(
      `SELECT game_id, s, l, st_json FROM game_progress WHERE wallet = ?`
    )
    .bind(wallet)
    .all<ProgressRow>();
  const map = new Map<string, StoredGameProgress>();
  for (const row of result.results ?? []) {
    map.set(row.game_id, rowToProgress(row));
  }
  return map;
}

async function listClaimedIds(wallet: string): Promise<Set<string>> {
  const db = await requireD1();
  const result = await db
    .prepare(`SELECT mission_id FROM achievement_claims WHERE wallet = ?`)
    .bind(wallet)
    .all<{ mission_id: string }>();
  return new Set((result.results ?? []).map((row) => row.mission_id));
}

export async function readPlayerXp(wallet: string): Promise<number> {
  const db = await requireD1();
  const row = await db
    .prepare(`SELECT xp FROM users WHERE wallet = ?`)
    .bind(wallet)
    .first<{ xp: number | null }>();
  return typeof row?.xp === "number" ? row.xp : 0;
}

/** Progress is computed from existing game_progress. This does not write. */
export async function listAchievementProgress(wallet: string): Promise<{
  xp: number;
  missions: MissionProgressView[];
}> {
  const [missions, progress, claimed, xp] = await Promise.all([
    listMissions(true),
    listProgress(wallet),
    listClaimedIds(wallet),
    readPlayerXp(wallet),
  ]);

  return {
    xp,
    missions: missions.map((mission) =>
      toMissionProgress(
        mission,
        progress.get(mission.gameId) ?? null,
        claimed.has(mission.id)
      )
    ),
  };
}

export interface MissionInput {
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

export async function createMission(input: MissionInput): Promise<Mission> {
  const db = await requireD1();
  const now = Date.now();
  const id = crypto.randomUUID();
  const mission: Mission = {
    id,
    gameId: input.gameId,
    title: input.title,
    description: input.description?.trim() ?? "",
    type: input.type,
    threshold: input.threshold,
    mode: input.mode?.trim() ?? "",
    xpReward: input.xpReward,
    active: input.active !== false,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .prepare(
      `INSERT INTO missions (
         id, game_id, title, description, type, threshold, mode, xp_reward,
         active, sort_order, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      mission.id,
      mission.gameId,
      mission.title,
      mission.description,
      mission.type,
      mission.threshold,
      mission.mode,
      mission.xpReward,
      mission.active ? 1 : 0,
      mission.sortOrder,
      mission.createdAt,
      mission.updatedAt
    )
    .run();

  return mission;
}

export async function updateMission(
  id: string,
  input: MissionInput
): Promise<Mission | null> {
  const db = await requireD1();
  const now = Date.now();
  const row = await db
    .prepare(
      `UPDATE missions SET
         game_id = ?, title = ?, description = ?, type = ?, threshold = ?,
         mode = ?, xp_reward = ?, active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?
       RETURNING id, game_id, title, description, type, threshold, mode,
                 xp_reward, active, sort_order, created_at, updated_at`
    )
    .bind(
      input.gameId,
      input.title,
      input.description?.trim() ?? "",
      input.type,
      input.threshold,
      input.mode?.trim() ?? "",
      input.xpReward,
      input.active !== false ? 1 : 0,
      input.sortOrder ?? 0,
      now,
      id
    )
    .first<MissionRow>();
  return row ? rowToMission(row) : null;
}

export async function deleteMission(id: string): Promise<boolean> {
  const db = await requireD1();
  const result = await db
    .prepare(`DELETE FROM missions WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function claimMission(
  wallet: string,
  missionId: string
): Promise<{ xp: number; mission: MissionProgressView }> {
  const mission = await getMission(missionId);
  if (!mission || !mission.active) {
    throw new Error("Mission not found.");
  }

  const db = await requireD1();
  const user = await db
    .prepare(`SELECT xp FROM users WHERE wallet = ?`)
    .bind(wallet)
    .first<{ xp: number | null }>();
  if (!user) {
    throw new Error("Save your player name while signed in before claiming.");
  }

  const progressRow = await db
    .prepare(
      `SELECT game_id, s, l, st_json FROM game_progress WHERE wallet = ? AND game_id = ?`
    )
    .bind(wallet, mission.gameId)
    .first<ProgressRow>();
  const current = toMissionProgress(
    mission,
    progressRow ? rowToProgress(progressRow) : null,
    false
  ).current;
  if (current < mission.threshold) {
    throw new Error("Mission is not complete yet.");
  }

  const now = Date.now();
  try {
    const inserted = await db
      .prepare(
        `INSERT INTO achievement_claims (wallet, mission_id, claimed_at, xp_awarded)
         VALUES (?, ?, ?, ?)`
      )
      .bind(wallet, mission.id, now, mission.xpReward)
      .run();

    if ((inserted.meta?.changes ?? 0) !== 1) {
      throw new Error("Already claimed.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("Already claimed") || /constraint|UNIQUE/i.test(message)) {
      throw new Error("Already claimed.");
    }
    throw err;
  }

  const xpRow = await db
    .prepare(
      `UPDATE users SET xp = COALESCE(xp, 0) + ? WHERE wallet = ?
       RETURNING xp`
    )
    .bind(mission.xpReward, wallet)
    .first<{ xp: number }>();

  return {
    xp: xpRow?.xp ?? (user.xp ?? 0) + mission.xpReward,
    mission: {
      ...mission,
      current,
      claimed: true,
      claimable: false,
    },
  };
}
